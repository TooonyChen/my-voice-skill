import type { Message } from "../types/message.ts";
import type { ClassifiedContact } from "../types/contact.ts";

export const DEFAULT_BUCKETS = 5;
export const DEFAULT_FULL_UNDER_CHARS = 30_000;

export const SAMPLE_TOPICS = [
  "gaming",
  "tech",
  "work",
  "school",
  "family",
  "logistics",
  "personal_life",
] as const;
export type SampleTopic = (typeof SAMPLE_TOPICS)[number];

export type SampleStrategy = "full" | "topic_time_stratified";

export interface TopicProfileEntry {
  message_count: number;
  match_count: number;
  top_terms: Array<[string, number]>;
}

export type TopicProfile = Record<SampleTopic, TopicProfileEntry>;

export interface ContactSamplePlan {
  sampled: Message[];
  sample_strategy: SampleStrategy;
  total_chars: number;
  topic_profile: TopicProfile;
}

const TOPIC_TERMS: Record<SampleTopic, string[]> = {
  gaming: [
    "game",
    "games",
    "游戏",
    "开黑",
    "queue",
    "排队",
    "match",
    "对局",
    "排位",
    "rank",
    "ranked",
    "voice",
    "语音",
    "teammate",
    "队友",
    "win",
    "lose",
    "loss",
    "输",
    "赢",
    "role",
    "角色",
    "hero",
    "英雄",
    "steam",
    "discord",
    "vc",
  ],
  tech: [
    "ip",
    "电脑",
    "server",
    "服务器",
    "代码",
    "github",
    "bug",
    "域名",
    "dns",
    "vpn",
    "linux",
    "mac",
    "windows",
    "api",
    "部署",
    "docker",
  ],
  work: [
    "工作",
    "meeting",
    "会议",
    "deadline",
    "project",
    "老板",
    "客户",
    "需求",
    "deliverable",
    "handoff",
    "offer",
  ],
  school: [
    "学校",
    "上课",
    "作业",
    "考试",
    "老师",
    "同学",
    "class",
    "exam",
    "assignment",
    "semester",
  ],
  family: [
    "爸",
    "妈",
    "父母",
    "家里",
    "家庭",
    "family",
    "sister",
    "brother",
    "parents",
  ],
  logistics: [
    "几点",
    "什么时候",
    "地址",
    "到哪",
    "安排",
    "今天",
    "明天",
    "schedule",
    "time",
    "where",
    "when",
    "tomorrow",
  ],
  personal_life: [
    "最近",
    "心情",
    "难过",
    "压力",
    "焦虑",
    "开心",
    "身体",
    "生病",
    "情绪",
    "生活",
    "人生",
    "relationship",
    "feel",
    "miss",
  ],
};

function sortedByTime(items: Message[]): Message[] {
  return [...items].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTerm(text: string, term: string): number {
  const escaped = escapeRegex(term);
  const flags = /[a-z0-9]/i.test(term) ? "gi" : "gu";
  const source = /^[a-z0-9_]+$/i.test(term)
    ? `\\b${escaped}\\b`
    : escaped;
  return text.match(new RegExp(source, flags))?.length ?? 0;
}

function emptyTopicProfile(): TopicProfile {
  const out = {} as TopicProfile;
  for (const topic of SAMPLE_TOPICS) {
    out[topic] = { message_count: 0, match_count: 0, top_terms: [] };
  }
  return out;
}

export function totalTextChars(items: Message[]): number {
  return items.reduce((sum, item) => sum + (item.text?.length ?? 0), 0);
}

export function messageTopicMatches(message: Message): SampleTopic[] {
  if (!message.text) return [];
  const out: SampleTopic[] = [];
  for (const topic of SAMPLE_TOPICS) {
    if (TOPIC_TERMS[topic].some((term) => countTerm(message.text!, term) > 0)) {
      out.push(topic);
    }
  }
  return out;
}

export function computeTopicProfile(items: Message[]): TopicProfile {
  const profile = emptyTopicProfile();
  const termCounts: Record<SampleTopic, Map<string, number>> = {} as Record<
    SampleTopic,
    Map<string, number>
  >;

  for (const topic of SAMPLE_TOPICS) {
    termCounts[topic] = new Map();
  }

  for (const item of items) {
    if (!item.text) continue;
    for (const topic of SAMPLE_TOPICS) {
      let messageMatches = 0;
      for (const term of TOPIC_TERMS[topic]) {
        const count = countTerm(item.text, term);
        if (count === 0) continue;
        messageMatches += count;
        termCounts[topic].set(term, (termCounts[topic].get(term) ?? 0) + count);
      }
      if (messageMatches > 0) {
        profile[topic].message_count++;
        profile[topic].match_count += messageMatches;
      }
    }
  }

  for (const topic of SAMPLE_TOPICS) {
    profile[topic].top_terms = [...termCounts[topic].entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10);
  }

  return profile;
}

function addUnique(
  selected: Map<Message, Message>,
  candidates: Message[],
  limit: number,
): void {
  for (const item of candidates) {
    if (selected.size >= limit) return;
    selected.set(item, item);
  }
}

export function topicAwareTimeStratifiedSample(
  items: Message[],
  n: number,
  buckets: number = DEFAULT_BUCKETS,
): Message[] {
  const limit = Math.max(1, Math.floor(n));
  if (items.length <= limit) return sortedByTime(items);

  const selected = new Map<Message, Message>();
  const baseQuota = Math.max(1, Math.floor(limit * 0.65));
  addUnique(selected, timeStratifiedSample(items, baseQuota, buckets), limit);

  const activeTopics = SAMPLE_TOPICS.map((topic) => {
    const topicMessages = items.filter((item) =>
      messageTopicMatches(item).includes(topic),
    );
    return { topic, topicMessages };
  })
    .filter((entry) => entry.topicMessages.length > 0)
    .sort(
      (a, b) =>
        b.topicMessages.length - a.topicMessages.length ||
        SAMPLE_TOPICS.indexOf(a.topic) - SAMPLE_TOPICS.indexOf(b.topic),
    );

  for (let i = 0; i < activeTopics.length; i++) {
    const remaining = limit - selected.size;
    if (remaining <= 0) break;
    const remainingTopics = activeTopics.length - i;
    const quota = Math.max(1, Math.ceil(remaining / remainingTopics));
    addUnique(
      selected,
      uniformStride(activeTopics[i]!.topicMessages, quota),
      limit,
    );
  }

  if (selected.size < limit) {
    const leftover = items.filter((item) => !selected.has(item));
    addUnique(
      selected,
      timeStratifiedSample(leftover, limit - selected.size, buckets),
      limit,
    );
  }

  return sortedByTime([...selected.values()]);
}

export function buildContactSamplePlan(
  items: Message[],
  opts: {
    n: number;
    buckets?: number;
    fullUnderChars?: number;
  },
): ContactSamplePlan {
  const total_chars = totalTextChars(items);
  const topic_profile = computeTopicProfile(items);
  const fullUnderChars = opts.fullUnderChars ?? DEFAULT_FULL_UNDER_CHARS;
  const buckets = opts.buckets ?? DEFAULT_BUCKETS;
  const n = Math.max(1, Math.floor(opts.n));

  if (total_chars <= fullUnderChars) {
    return {
      sampled: sortedByTime(items),
      sample_strategy: "full",
      total_chars,
      topic_profile,
    };
  }

  return {
    sampled: topicAwareTimeStratifiedSample(items, n, buckets),
    sample_strategy: "topic_time_stratified",
    total_chars,
    topic_profile,
  };
}

export function timeStratifiedSample(
  items: Message[],
  n: number,
  buckets: number = DEFAULT_BUCKETS,
): Message[] {
  if (items.length <= n) return [...items];
  const sorted = sortedByTime(items);
  const start = sorted[0]!.timestamp.getTime();
  const end = sorted[sorted.length - 1]!.timestamp.getTime();
  if (end === start) return uniformStride(sorted, n);

  const span = end - start;
  const bucketSize = span / buckets;
  const grouped: Message[][] = Array.from({ length: buckets }, () => []);
  for (const m of sorted) {
    let idx = Math.floor((m.timestamp.getTime() - start) / bucketSize);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    grouped[idx]!.push(m);
  }

  const out: Message[] = [];
  const baseQuota = Math.floor(n / buckets);
  const remainder = n - baseQuota * buckets;

  let unfilled = 0;
  for (let i = 0; i < buckets; i++) {
    const bucket = grouped[i]!;
    const quota = baseQuota + (i < remainder ? 1 : 0);
    if (bucket.length <= quota) {
      out.push(...bucket);
      unfilled += quota - bucket.length;
    } else {
      out.push(...uniformStride(bucket, quota));
    }
  }

  if (unfilled > 0) {
    const leftover = sorted.filter((m) => !out.includes(m));
    out.push(...uniformStride(leftover, Math.min(unfilled, leftover.length)));
  }

  out.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return out;
}

export function uniformStride<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const stride = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.floor(i * stride)]!);
  }
  return out;
}

export interface PersonaQuotaPlan {
  total_requested: number;
  per_label: Record<string, { quota: number; contact_ids: string[] }>;
  per_contact: Record<string, { contact_id: string; label: string; quota: number }>;
}

export function planPersonaQuota(
  classified: ClassifiedContact[],
  totalN: number,
): PersonaQuotaPlan {
  const byLabel = new Map<string, ClassifiedContact[]>();
  for (const c of classified) {
    let arr = byLabel.get(c.label);
    if (!arr) {
      arr = [];
      byLabel.set(c.label, arr);
    }
    arr.push(c);
  }
  const labels = [...byLabel.keys()];
  if (labels.length === 0) {
    return { total_requested: totalN, per_label: {}, per_contact: {} };
  }
  const perLabel = Math.floor(totalN / labels.length);
  const labelRemainder = totalN - perLabel * labels.length;

  const per_label: PersonaQuotaPlan["per_label"] = {};
  const per_contact: PersonaQuotaPlan["per_contact"] = {};

  let i = 0;
  for (const label of labels) {
    const labelQuota = perLabel + (i < labelRemainder ? 1 : 0);
    const contacts = byLabel.get(label)!;
    const perContact = Math.floor(labelQuota / contacts.length);
    const contactRemainder = labelQuota - perContact * contacts.length;
    per_label[label] = {
      quota: labelQuota,
      contact_ids: contacts.map((c) => c.contact_id),
    };
    let j = 0;
    for (const c of contacts) {
      const quota = perContact + (j < contactRemainder ? 1 : 0);
      per_contact[c.contact_id] = {
        contact_id: c.contact_id,
        label: c.label,
        quota,
      };
      j++;
    }
    i++;
  }

  return { total_requested: totalN, per_label, per_contact };
}
