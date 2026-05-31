import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import type { MediaType, Message } from "../types/message.ts";

const StringOrNumber = z.union([z.string(), z.number()]);

const ChatLabMetaSchema = z
  .object({
    name: z.string().optional(),
    platform: z.string().optional(),
    type: z.string().optional(),
    groupId: StringOrNumber.optional(),
    ownerId: StringOrNumber.optional(),
  })
  .passthrough();

const ChatLabMemberSchema = z
  .object({
    platformId: StringOrNumber.optional(),
    accountName: z.string().optional(),
    groupNickname: z.string().optional(),
  })
  .passthrough();

const ChatLabMessageSchema = z
  .object({
    sender: StringOrNumber,
    accountName: z.string().optional(),
    groupNickname: z.string().optional(),
    timestamp: StringOrNumber,
    type: z.number(),
    content: z.unknown().nullable().optional(),
    platformMessageId: StringOrNumber.optional(),
    replyToMessageId: StringOrNumber.optional(),
  })
  .passthrough();

const ChatLabExportSchema = z
  .object({
    meta: ChatLabMetaSchema,
    members: z.array(ChatLabMemberSchema).optional().default([]),
    messages: z.array(ChatLabMessageSchema),
  })
  .passthrough();

const RawWeFlowMessageSchema = z
  .object({
    localId: StringOrNumber.optional(),
    serverId: StringOrNumber.optional(),
    localType: StringOrNumber.optional(),
    createTime: StringOrNumber,
    isSend: z.union([z.number(), z.boolean(), z.string()]).optional(),
    senderUsername: StringOrNumber.optional(),
    content: z.unknown().nullable().optional(),
    rawContent: z.unknown().nullable().optional(),
    parsedContent: z.unknown().nullable().optional(),
    replyToMessageId: StringOrNumber.optional(),
    mediaType: z.string().optional(),
  })
  .passthrough();

const RawWeFlowExportSchema = z
  .object({
    talker: StringOrNumber.optional(),
    displayName: z.string().optional(),
    sessionName: z.string().optional(),
    messages: z.array(RawWeFlowMessageSchema),
  })
  .passthrough();

export interface ParseWeFlowOptions {
  includeGroups?: boolean;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function contentToText(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = contentToText(value);
    if (text !== null) return text;
  }
  return null;
}

function dateFromEpoch(value: string | number): Date {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) {
    throw new Error(`invalid Unix timestamp: ${String(value)}`);
  }
  return new Date(n > 10_000_000_000 ? n : n * 1000);
}

function stem(path: string): string {
  const base = basename(path);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function buildMyKeys(myName: string, aliases: string[]): Set<string> {
  return new Set(
    [myName, ...aliases]
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function isMeIdentity(
  identity: {
    id?: string;
    accountName?: string;
    groupNickname?: string;
  },
  ownerId: string | undefined,
  myKeys: Set<string>,
): boolean {
  if (ownerId && identity.id === ownerId) return true;
  return [identity.id, identity.accountName, identity.groupNickname].some(
    (v) => !!v && myKeys.has(v),
  );
}

function chatLabMediaType(type: number): MediaType {
  switch (type) {
    case 0:
    case 25:
      return "text";
    case 1:
      return "image";
    case 2:
      return "voice";
    case 3:
      return "video";
    case 4:
      return "file";
    case 5:
      return "sticker";
    case 7:
    case 24:
    case 26:
    case 27:
      return "share";
    case 23:
      return "call";
    default:
      return "unknown";
  }
}

function isChatLabTextType(type: number): boolean {
  return type === 0 || type === 25;
}

function shouldSkipChatLabType(type: number): boolean {
  return type === 80 || type === 81;
}

function rawLocalType(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : undefined;
}

function mediaTypeFromRawMedia(mediaType: string | undefined): MediaType | null {
  if (!mediaType) return null;
  const normalized = mediaType.toLowerCase();
  if (normalized.includes("image")) return "image";
  if (normalized.includes("voice") || normalized.includes("audio")) return "voice";
  if (normalized.includes("video")) return "video";
  if (normalized.includes("emoji") || normalized.includes("sticker")) return "sticker";
  if (normalized.includes("file")) return "file";
  if (normalized.includes("share") || normalized.includes("link")) return "share";
  if (normalized.includes("call")) return "call";
  return "unknown";
}

function rawMediaType(raw: z.infer<typeof RawWeFlowMessageSchema>): MediaType {
  const fromMedia = mediaTypeFromRawMedia(raw.mediaType);
  if (fromMedia) return fromMedia;

  const type = rawLocalType(raw.localType);
  if (type === 1 || raw.replyToMessageId !== undefined) return "text";
  if (type === 3) return "image";
  if (type === 34) return "voice";
  if (type === 43) return "video";
  if (type === 47) return "sticker";
  if (type === 49) return "share";
  if (type === 50) return "call";
  return "unknown";
}

function isRawTextMessage(raw: z.infer<typeof RawWeFlowMessageSchema>): boolean {
  const type = rawLocalType(raw.localType);
  return type === 1 || raw.replyToMessageId !== undefined;
}

function shouldSkipRawMessage(raw: z.infer<typeof RawWeFlowMessageSchema>): boolean {
  const type = rawLocalType(raw.localType);
  return type === 10000 || type === 10002;
}

function isRawFromMe(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

async function collectJsonFiles(root: string): Promise<string[]> {
  const s = await stat(root);
  if (s.isFile()) {
    if (root.toLowerCase().endsWith(".json")) return [root];
    throw new Error(`WeFlow static import expects a .json file, got ${root}`);
  }
  if (!s.isDirectory()) {
    throw new Error(`WeFlow static import expects a file or directory, got ${root}`);
  }

  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        out.push(full);
      }
    }
  }

  await walk(root);
  return out;
}

function parseChatLabFile(
  json: unknown,
  filePath: string,
  myKeys: Set<string>,
  opts: ParseWeFlowOptions,
): Message[] | null {
  const result = ChatLabExportSchema.safeParse(json);
  if (!result.success) return null;

  const data = result.data;
  if (data.meta.platform && data.meta.platform !== "wechat") {
    throw new Error(
      `${filePath}: expected ChatLab meta.platform "wechat", got "${data.meta.platform}"`,
    );
  }

  const ownerId = asString(data.meta.ownerId);
  const isGroup = data.meta.type === "group";
  if (isGroup && !opts.includeGroups) return [];

  const memberById = new Map<string, z.infer<typeof ChatLabMemberSchema>>();
  for (const member of data.members) {
    const id = asString(member.platformId);
    if (id) memberById.set(id, member);
  }

  const otherMember = data.members.find(
    (member) =>
      !isMeIdentity(
        {
          id: asString(member.platformId),
          accountName: member.accountName,
          groupNickname: member.groupNickname,
        },
        ownerId,
        myKeys,
      ),
  );
  const otherMessage = data.messages.find(
    (message) =>
      !isMeIdentity(
        {
          id: asString(message.sender),
          accountName: message.accountName,
          groupNickname: message.groupNickname,
        },
        ownerId,
        myKeys,
      ),
  );

  const contactId =
    isGroup
      ? (asString(data.meta.groupId) ?? stem(filePath))
      : (asString(otherMember?.platformId) ??
        asString(otherMessage?.sender) ??
        asString(data.meta.groupId) ??
        stem(filePath));
  const contactName =
    isGroup
      ? (data.meta.name ?? contactId)
      : (otherMember?.accountName ??
        otherMember?.groupNickname ??
        otherMessage?.accountName ??
        otherMessage?.groupNickname ??
        data.meta.name ??
        contactId);

  const timestampByMessageId = new Map<string, Date>();
  for (const raw of data.messages) {
    const id = asString(raw.platformMessageId);
    if (id) timestampByMessageId.set(id, dateFromEpoch(raw.timestamp));
  }

  const messages: Message[] = [];
  for (const raw of data.messages) {
    if (shouldSkipChatLabType(raw.type)) continue;

    const senderId = asString(raw.sender);
    const member = senderId ? memberById.get(senderId) : undefined;
    const sender = isMeIdentity(
      {
        id: senderId,
        accountName: raw.accountName ?? member?.accountName,
        groupNickname: raw.groupNickname ?? member?.groupNickname,
      },
      ownerId,
      myKeys,
    )
      ? "me"
      : "them";
    const media_type = chatLabMediaType(raw.type);
    const text = isChatLabTextType(raw.type) ? contentToText(raw.content) : null;
    if (media_type === "unknown" && text === null) continue;

    const replyTo = asString(raw.replyToMessageId);
    messages.push({
      contact_id: contactId,
      contact_name: contactName,
      timestamp: dateFromEpoch(raw.timestamp),
      sender,
      text,
      media_type,
      reply_to_timestamp: replyTo ? (timestampByMessageId.get(replyTo) ?? null) : null,
      platform: "wechat",
    });
  }
  return messages;
}

function parseRawWeFlowFile(
  json: unknown,
  filePath: string,
  opts: ParseWeFlowOptions,
): Message[] | null {
  const result = RawWeFlowExportSchema.safeParse(json);
  if (!result.success) return null;

  const data = result.data;
  const talker = asString(data.talker) ?? stem(filePath);
  const isGroup = talker.endsWith("@chatroom");
  if (isGroup && !opts.includeGroups) return [];

  const timestampByMessageId = new Map<string, Date>();
  for (const raw of data.messages) {
    const id = asString(raw.serverId) ?? asString(raw.localId);
    if (id) timestampByMessageId.set(id, dateFromEpoch(raw.createTime));
  }

  const contactName = data.displayName ?? data.sessionName ?? talker;
  const messages: Message[] = [];
  for (const raw of data.messages) {
    if (shouldSkipRawMessage(raw)) continue;

    const media_type = rawMediaType(raw);
    const text = isRawTextMessage(raw)
      ? firstText(raw.parsedContent, raw.content, raw.rawContent)
      : null;
    if (media_type === "unknown" && text === null) continue;

    const replyTo = asString(raw.replyToMessageId);
    messages.push({
      contact_id: talker,
      contact_name: contactName,
      timestamp: dateFromEpoch(raw.createTime),
      sender: isRawFromMe(raw.isSend) ? "me" : "them",
      text,
      media_type,
      reply_to_timestamp: replyTo ? (timestampByMessageId.get(replyTo) ?? null) : null,
      platform: "wechat",
    });
  }
  return messages;
}

export async function parseWeFlowExport(
  exportPath: string,
  myName: string,
  myAliases: string[] = [],
  opts: ParseWeFlowOptions = {},
): Promise<Message[]> {
  const files = await collectJsonFiles(exportPath);
  if (files.length === 0) {
    throw new Error(`No .json files found under ${exportPath}`);
  }

  const myKeys = buildMyKeys(myName, myAliases);
  const all: Message[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    const json = JSON.parse(raw);
    const parsed =
      parseChatLabFile(json, file, myKeys, opts) ??
      parseRawWeFlowFile(json, file, opts);
    if (!parsed) {
      throw new Error(
        `${file}: unsupported WeFlow JSON. Expected ChatLab JSON or saved /api/v1/messages JSON.`,
      );
    }
    all.push(...parsed);
  }

  all.sort((a, b) => {
    if (a.contact_id !== b.contact_id) {
      return a.contact_id.localeCompare(b.contact_id);
    }
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
  return all;
}
