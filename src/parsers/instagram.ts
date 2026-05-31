import type { Message } from "../types/message.ts";
import { parseMetaExport } from "./meta.ts";

/**
 * Instagram DM parser. Instagram's Meta export uses the same per-thread JSON
 * shape as Messenger (see meta.ts); it differs only in the inbox directory
 * layout. Real conversations are split across `inbox/` and `message_requests/`,
 * so both are scanned.
 */
const INSTAGRAM_INBOX_CANDIDATES = [
  "your_instagram_activity/messages/inbox",
  "messages/inbox",
  "inbox",
  "your_instagram_activity/messages/message_requests",
  "messages/message_requests",
  "message_requests",
];

export async function parseInstagramExport(
  exportRoot: string,
  myName: string,
  myAliases: string[] = [],
): Promise<Message[]> {
  return parseMetaExport(exportRoot, myName, myAliases, {
    platform: "instagram",
    inboxCandidates: INSTAGRAM_INBOX_CANDIDATES,
  });
}
