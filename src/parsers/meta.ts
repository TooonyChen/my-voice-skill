import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type Message,
  type MediaType,
  type Platform,
} from "../types/message.ts";

/**
 * Shared parser for Meta "Download Your Information" JSON exports. Messenger and
 * Instagram DMs use the same per-thread shape (participants + messages with
 * sender_name/timestamp_ms/content/media fields) and share the latin1↔UTF-8
 * mojibake quirk; they differ only in the inbox directory layout and the
 * platform tag. Platform-specific wrappers live in messenger.ts / instagram.ts.
 */

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
  /** Platform tag stamped on every produced message. Defaults to "messenger". */
  platform?: Platform;
}

export interface ParsedThread {
  messages: Message[];
  contactName: string;
  contactId: string;
}

export function parseThreadJson(json: unknown, opts: ParseOptions): ParsedThread {
  const thread = RawMetaThread.parse(json);
  const platform: Platform = opts.platform ?? "messenger";
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
      platform,
    });
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { messages, contactName, contactId };
}

/**
 * Collect every existing inbox-like directory under the export root. Unlike a
 * first-match lookup, this returns all candidates that exist because Instagram
 * splits real conversations across `inbox/` and `message_requests/`. When none
 * of the candidates resolve, fall back to treating the root itself as an inbox
 * if it directly contains thread folders with `message_*.json` files.
 */
async function collectInboxDirs(
  exportRoot: string,
  candidates: string[],
): Promise<string[]> {
  const found: string[] = [];
  for (const c of candidates) {
    const p = join(exportRoot, c);
    const s = await stat(p).catch(() => null);
    if (s?.isDirectory()) found.push(p);
  }
  if (found.length > 0) return found;

  const rs = await stat(exportRoot).catch(() => null);
  if (rs?.isDirectory()) {
    const entries = await readdir(exportRoot).catch(() => []);
    for (const e of entries) {
      const sub = join(exportRoot, e);
      const ss = await stat(sub).catch(() => null);
      if (ss?.isDirectory()) {
        const files = await readdir(sub).catch(() => []);
        if (files.some((f) => f.startsWith("message_") && f.endsWith(".json"))) {
          return [exportRoot];
        }
      }
    }
  }
  return [];
}

export interface MetaExportConfig {
  platform: Platform;
  /** Inbox-like directories to scan, relative to the export root, in priority order. */
  inboxCandidates: string[];
}

export async function parseMetaExport(
  exportRoot: string,
  myName: string,
  myAliases: string[],
  config: MetaExportConfig,
): Promise<Message[]> {
  const inboxDirs = await collectInboxDirs(exportRoot, config.inboxCandidates);
  if (inboxDirs.length === 0) {
    throw new Error(
      `Could not find an inbox directory for ${config.platform} under ${exportRoot} (looked for: ${config.inboxCandidates.join(", ")})`,
    );
  }

  const all: Message[] = [];
  for (const inboxPath of inboxDirs) {
    const threadDirs = await readdir(inboxPath);
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
          platform: config.platform,
        });
        all.push(...parsed.messages);
      }
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
