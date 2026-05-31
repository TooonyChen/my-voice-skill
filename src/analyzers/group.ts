import type { ContactStats } from "../types/contact.ts";
import type {
  CountedTerm,
  GroupContext,
  GroupContextBundle,
  GroupMessage,
  GroupRelationshipSignal,
  GroupToneStats,
} from "../types/group.ts";
import type { Message } from "../types/message.ts";
import { computeGlobalStats } from "./stats.ts";
import { tokenize } from "./tokenize.ts";

const STOPWORDS = new Set([
  "the",
  "and",
  "you",
  "that",
  "this",
  "for",
  "with",
  "have",
  "not",
  "are",
  "was",
  "but",
  "just",
  "啊",
  "吗",
  "吧",
  "呢",
  "的",
  "了",
  "是",
  "我",
  "你",
  "他",
  "她",
  "它",
  "们",
  "在",
  "就",
  "都",
  "和",
]);

function toMessage(m: GroupMessage): Message {
  return {
    contact_id: m.group_id,
    contact_name: m.group_name,
    timestamp: m.timestamp,
    sender: m.sender === "me" ? "me" : "them",
    text: m.text,
    media_type: m.media_type,
    reply_to_timestamp: m.reply_to_timestamp,
    platform: m.platform,
  };
}

function topN<T>(map: Map<T, number>, n: number): Array<[T, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function normalizeIdentity(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function countTerms(texts: string[], n: number): CountedTerm[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      const term = token.text.trim();
      if (term.length <= 1) continue;
      if (STOPWORDS.has(term.toLowerCase())) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return topN(counts, n).map(([term, count]) => ({ term, count }));
}

function countLiteralMentions(texts: string[], terms: string[]): CountedTerm[] {
  const out: CountedTerm[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (t.length < 2) continue;
    let count = 0;
    for (const text of texts) {
      let idx = text.indexOf(t);
      while (idx >= 0) {
        count++;
        idx = text.indexOf(t, idx + t.length);
      }
    }
    if (count > 0) out.push({ term: t, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 10);
}

export function computeGroupToneStats(
  groupMessages: GroupMessage[],
  sourceMessagesPath: string,
): GroupToneStats {
  const converted = groupMessages.map(toMessage);
  const stats = computeGlobalStats(converted);
  return {
    generated_at: new Date(),
    source_messages_path: sourceMessagesPath,
    total_group_messages: groupMessages.length,
    total_messages_from_me: groupMessages.filter((m) => m.sender === "me").length,
    total_groups: new Set(groupMessages.map((m) => m.group_id)).size,
    stats: stats.stats,
  };
}

export function computeGroupContexts(
  groupMessages: GroupMessage[],
  sourceMessagesPath: string,
): GroupContextBundle {
  const byGroup = new Map<string, GroupMessage[]>();
  for (const message of groupMessages) {
    let arr = byGroup.get(message.group_id);
    if (!arr) {
      arr = [];
      byGroup.set(message.group_id, arr);
    }
    arr.push(message);
  }

  const groups: GroupContext[] = [];
  for (const [groupId, arr] of byGroup) {
    arr.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const first = arr[0]!;
    const last = arr[arr.length - 1]!;
    const participantCounts = new Map<
      string,
      { participant_id: string; participant_name: string; message_count: number }
    >();
    const participants = new Set<string>();
    for (const m of arr) {
      participants.add(m.participant_id);
      if (m.sender === "me") continue;
      const existing = participantCounts.get(m.participant_id);
      if (existing) {
        existing.message_count++;
      } else {
        participantCounts.set(m.participant_id, {
          participant_id: m.participant_id,
          participant_name: m.participant_name,
          message_count: 1,
        });
      }
    }

    groups.push({
      group_id: groupId,
      group_name: first.group_name,
      platform: first.platform,
      message_count: arr.length,
      message_count_from_me: arr.filter((m) => m.sender === "me").length,
      participant_count: participants.size,
      first_message_at: first.timestamp,
      last_message_at: last.timestamp,
      top_participants: [...participantCounts.values()]
        .sort((a, b) => b.message_count - a.message_count)
        .slice(0, 20),
      top_terms_from_me: countTerms(
        arr.filter((m) => m.sender === "me" && m.text !== null).map((m) => m.text!),
        25,
      ),
      top_terms_all: countTerms(
        arr.filter((m) => m.text !== null).map((m) => m.text!),
        25,
      ),
    });
  }

  return {
    generated_at: new Date(),
    source_messages_path: sourceMessagesPath,
    groups: groups.sort((a, b) => b.message_count - a.message_count),
  };
}

export function computeGroupRelationshipSignals(
  groupMessages: GroupMessage[],
  contacts: ContactStats[],
): GroupRelationshipSignal[] {
  const groupIdsByParticipant = new Map<string, Set<string>>();
  const messagesByParticipant = new Map<string, GroupMessage[]>();
  const namesByParticipant = new Map<string, Set<string>>();

  for (const m of groupMessages) {
    const keys = new Set([
      normalizeIdentity(m.participant_id),
      normalizeIdentity(m.participant_name),
    ]);
    for (const key of keys) {
      if (!key) continue;
      let groupSet = groupIdsByParticipant.get(key);
      if (!groupSet) {
        groupSet = new Set();
        groupIdsByParticipant.set(key, groupSet);
      }
      groupSet.add(m.group_id);

      let msgArr = messagesByParticipant.get(key);
      if (!msgArr) {
        msgArr = [];
        messagesByParticipant.set(key, msgArr);
      }
      msgArr.push(m);

      let nameSet = namesByParticipant.get(key);
      if (!nameSet) {
        nameSet = new Set();
        namesByParticipant.set(key, nameSet);
      }
      nameSet.add(m.participant_name);
    }
  }

  const byGroup = new Map<string, GroupMessage[]>();
  for (const m of groupMessages) {
    let arr = byGroup.get(m.group_id);
    if (!arr) {
      arr = [];
      byGroup.set(m.group_id, arr);
    }
    arr.push(m);
  }

  const signals: GroupRelationshipSignal[] = [];
  for (const contact of contacts) {
    const keys = new Set([
      normalizeIdentity(contact.contact_id),
      normalizeIdentity(contact.contact_name),
    ]);
    const sharedGroups = new Set<string>();
    const participantMessages: GroupMessage[] = [];
    const participantIds = new Set<string>();
    const participantNames = new Set<string>();
    for (const key of keys) {
      for (const groupId of groupIdsByParticipant.get(key) ?? []) {
        sharedGroups.add(groupId);
      }
      for (const message of messagesByParticipant.get(key) ?? []) {
        participantMessages.push(message);
        participantIds.add(message.participant_id);
        participantNames.add(message.participant_name);
      }
      for (const name of namesByParticipant.get(key) ?? []) {
        participantNames.add(name);
      }
    }
    if (sharedGroups.size === 0) continue;

    const messagesFromMeInSharedGroups: string[] = [];
    let groupMessageCountFromMe = 0;
    for (const groupId of sharedGroups) {
      for (const message of byGroup.get(groupId) ?? []) {
        if (message.sender !== "me") continue;
        groupMessageCountFromMe++;
        if (message.text) messagesFromMeInSharedGroups.push(message.text);
      }
    }

    const addressTerms = countLiteralMentions(messagesFromMeInSharedGroups, [
      contact.contact_name,
      ...participantNames,
    ]);

    signals.push({
      contact_id: contact.contact_id,
      contact_name: contact.contact_name,
      matched_participant_ids: [...participantIds].sort(),
      matched_participant_names: [...participantNames].sort(),
      shared_groups: sharedGroups.size,
      group_message_count_from_me: groupMessageCountFromMe,
      group_message_count_from_participant: participantMessages.length,
      address_terms_from_me: addressTerms,
      evidence_source: "group_chat",
      weight: "weak",
    });
  }

  return signals.sort((a, b) => {
    if (b.shared_groups !== a.shared_groups) return b.shared_groups - a.shared_groups;
    return b.group_message_count_from_participant - a.group_message_count_from_participant;
  });
}
