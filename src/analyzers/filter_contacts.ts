import type { Message } from "../types/message.ts";
import type { ContactStats } from "../types/contact.ts";

const MS_PER_DAY = 86400000;

export interface FilterThresholds {
  total: number;
  eachWay: number;
}

export const DEFAULT_THRESHOLDS: FilterThresholds = {
  total: 100,
  eachWay: 50,
};

export function computeContactStats(messages: Message[]): ContactStats[] {
  const byContact = new Map<string, Message[]>();
  for (const m of messages) {
    let arr = byContact.get(m.contact_id);
    if (!arr) {
      arr = [];
      byContact.set(m.contact_id, arr);
    }
    arr.push(m);
  }

  const out: ContactStats[] = [];
  for (const [contact_id, arr] of byContact) {
    arr.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const fromMe = arr.filter((m) => m.sender === "me").length;
    const fromThem = arr.length - fromMe;
    const first = arr[0]!.timestamp;
    const last = arr[arr.length - 1]!.timestamp;
    out.push({
      contact_id,
      contact_name: arr[0]!.contact_name,
      username: null,
      message_count_total: arr.length,
      message_count_from_me: fromMe,
      message_count_from_them: fromThem,
      first_message_at: first,
      last_message_at: last,
      span_days: Math.max(
        1,
        Math.round((last.getTime() - first.getTime()) / MS_PER_DAY),
      ),
    });
  }
  return out.sort((a, b) => b.message_count_total - a.message_count_total);
}

export function filterContacts(
  stats: ContactStats[],
  thresholds: FilterThresholds = DEFAULT_THRESHOLDS,
): ContactStats[] {
  return stats.filter(
    (s) =>
      s.message_count_total >= thresholds.total &&
      s.message_count_from_me >= thresholds.eachWay &&
      s.message_count_from_them >= thresholds.eachWay,
  );
}
