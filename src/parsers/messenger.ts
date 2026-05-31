import type { Message } from "../types/message.ts";
import type { GroupMessage } from "../types/group.ts";
import { parseMetaExport, parseMetaGroupExport } from "./meta.ts";

// Re-exported so existing imports (and tests) keep resolving these from the
// messenger module. The implementations are shared in meta.ts.
export {
  fixMojibake,
  parseThreadJson,
  type ParseOptions,
  type ParsedThread,
} from "./meta.ts";

const MESSENGER_INBOX_CANDIDATES = [
  "inbox",
  "your_facebook_activity/messages/inbox",
  "messages/inbox",
  "your_activity_across_facebook/messages/inbox",
];

export async function parseMessengerExport(
  exportRoot: string,
  myName: string,
  myAliases: string[] = [],
): Promise<Message[]> {
  return parseMetaExport(exportRoot, myName, myAliases, {
    platform: "messenger",
    inboxCandidates: MESSENGER_INBOX_CANDIDATES,
  });
}

export async function parseMessengerGroupExport(
  exportRoot: string,
  myName: string,
  myAliases: string[] = [],
): Promise<GroupMessage[]> {
  return parseMetaGroupExport(exportRoot, myName, myAliases, {
    platform: "messenger",
    inboxCandidates: MESSENGER_INBOX_CANDIDATES,
  });
}
