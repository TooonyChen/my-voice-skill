import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type Message,
  type MediaType,
} from "../types/message.ts";

const RawMetaParticipant = z.object({
  name: z.string(),
});

const RawMetaMessage = z.object({
  sender_name: z.string(),
  timestamp_ms: z.number(),
  content: z.string().optional(),
  type: z.string().optional(),
  is_unsent: z.boolean().optional(),
  photos: z.array(z.unknown()).optional(),
  videos: z.array(z.unknown()).optional(),
  audio_files: z.array(z.unknown()).optional(),
  sticker: z.unknown().optional(),
  gifs: z.array(z.unknown()).optional(),
  files: z.array(z.unknown()).optional(),
  share: z.unknown().optional(),
  call_duration: z.number().optional(),
  reactions: z.array(z.unknown()).optional(),
});

const RawMetaThread = z.object({
  participants: z.array(RawMetaParticipant),
  messages: z.array(RawMetaMessage),
  title: z.string().optional(),
  thread_path: z.string().optional(),
});

export function fixMojibake(s: string): string {
  if (!s) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) return s;
    bytes[i] = code;
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return s;
  }
}

function classifyMediaType(raw: z.infer<typeof RawMetaMessage>): MediaType {
  if (raw.content && raw.content.length > 0) return "text";
  if (raw.photos && raw.photos.length > 0) return "image";
  if (raw.videos && raw.videos.length > 0) return "video";
  if (raw.audio_files && raw.audio_files.length > 0) return "voice";
  if (raw.gifs && raw.gifs.length > 0) return "gif";
  if (raw.sticker) return "sticker";
  if (raw.files && raw.files.length > 0) return "file";
  if (raw.share) return "share";
  if (typeof raw.call_duration === "number") return "call";
  return "unknown";
}

function isThreadEvent(type: string | undefined): boolean {
  if (!type) return false;
  return type === "Subscribe" || type === "Unsubscribe";
}

export interface ParseOptions {
  myName: string;
  myAliases?: string[];
  contactIdOverride?: string;
}

export interface ParsedThread {
  messages: Message[];
  contactName: string;
  contactId: string;
}

export function parseThreadJson(json: unknown, opts: ParseOptions): ParsedThread {
  const thread = RawMetaThread.parse(json);
  const myNames = new Set(
    [opts.myName, ...(opts.myAliases ?? [])].map(fixMojibake),
  );

  const fixedParticipants = thread.participants.map((p) => fixMojibake(p.name));
  const others = fixedParticipants.filter((n) => !myNames.has(n));
  const contactName = others[0] ?? "unknown";
  const contactId =
    opts.contactIdOverride ??
    thread.thread_path?.split("/").pop() ??
    contactName.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const messages: Message[] = [];
  for (const raw of thread.messages) {
    if (raw.is_unsent) continue;
    if (isThreadEvent(raw.type)) continue;
    const senderName = fixMojibake(raw.sender_name);
    const sender = myNames.has(senderName) ? "me" : "them";
    const text = raw.content ? fixMojibake(raw.content) : null;
    const media_type = classifyMediaType(raw);
    if (media_type === "unknown" && !text) continue;
    messages.push({
      contact_id: contactId,
      contact_name: contactName,
      timestamp: new Date(raw.timestamp_ms),
      sender,
      text,
      media_type,
      reply_to_timestamp: null,
      platform: "messenger",
    });
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { messages, contactName, contactId };
}

async function findInbox(root: string): Promise<string | null> {
  const candidates = [
    join(root, "inbox"),
    join(root, "your_facebook_activity", "messages", "inbox"),
    join(root, "messages", "inbox"),
    join(root, "your_activity_across_facebook", "messages", "inbox"),
  ];
  for (const c of candidates) {
    const s = await stat(c).catch(() => null);
    if (s?.isDirectory()) return c;
  }
  const rs = await stat(root).catch(() => null);
  if (rs?.isDirectory()) {
    const entries = await readdir(root).catch(() => []);
    for (const e of entries) {
      const sub = join(root, e);
      const ss = await stat(sub).catch(() => null);
      if (ss?.isDirectory()) {
        const files = await readdir(sub).catch(() => []);
        if (files.some((f) => f.startsWith("message_") && f.endsWith(".json"))) {
          return root;
        }
      }
    }
  }
  return null;
}

export async function parseMessengerExport(
  exportRoot: string,
  myName: string,
  myAliases: string[] = [],
): Promise<Message[]> {
  const inboxPath = await findInbox(exportRoot);
  if (!inboxPath) {
    throw new Error(`Could not find inbox/ directory under ${exportRoot}`);
  }

  const threadDirs = await readdir(inboxPath);
  const all: Message[] = [];
  for (const dir of threadDirs) {
    const dirPath = join(inboxPath, dir);
    const dirStat = await stat(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const files = await readdir(dirPath);
    const jsonFiles = files
      .filter((f) => f.startsWith("message_") && f.endsWith(".json"))
      .sort();
    for (const f of jsonFiles) {
      const content = await readFile(join(dirPath, f), "utf-8");
      const parsed = parseThreadJson(JSON.parse(content), {
        myName,
        myAliases,
        contactIdOverride: dir,
      });
      all.push(...parsed.messages);
    }
  }
  all.sort((a, b) => {
    if (a.contact_id !== b.contact_id) {
      return a.contact_id.localeCompare(b.contact_id);
    }
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
  return all;
}
