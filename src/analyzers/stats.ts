import type { Message } from "../types/message.ts";
import { hasText } from "../types/message.ts";
import type {
  EmojiStats,
  GlobalStats,
  LexicalStats,
  PerContactStats,
  PunctuationStats,
  StatsBundle,
  StructureStats,
  TimingStats,
} from "../types/stats.ts";
import { bigrams, detectLang, hasCodeSwitch, tokenize } from "./tokenize.ts";

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const SWEAR_PATTERNS = [
  /\bfuck(ing|ed|er|s)?\b/i,
  /\bshit(ty|s)?\b/i,
  /\bdamn(ed)?\b/i,
  /\bbitch(es|ing|y)?\b/i,
  /\bass(hole|holes)?\b/i,
  /\bcunt\b/i,
  /\bbastard\b/i,
  /操|草(?!莓)|卧槽|妈的|靠|尼玛|傻逼|垃圾/u,
];

const BURST_GAP_MS = 5 * 60_000;

function topN<T>(map: Map<T, number>, n: number): Array<[T, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const flagged = p.flags.includes("g") ? p : new RegExp(p.source, p.flags + "g");
    const m = text.match(flagged);
    if (m) n += m.length;
  }
  return n;
}

function lexicalStats(textMessages: string[]): LexicalStats {
  const wordCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  const trigramCounts = new Map<string, number>();
  let langEnTokens = 0;
  let langZhTokens = 0;
  let langOtherTokens = 0;
  let totalTokens = 0;
  let codeSwitchMessages = 0;
  let swearCount = 0;

  for (const text of textMessages) {
    swearCount += countMatches(text, SWEAR_PATTERNS);
    const tokens = tokenize(text);
    if (hasCodeSwitch(tokens)) codeSwitchMessages++;
    for (const t of tokens) {
      wordCounts.set(t.text, (wordCounts.get(t.text) ?? 0) + 1);
      if (t.lang === "en") langEnTokens++;
      else if (t.lang === "zh") langZhTokens++;
      else langOtherTokens++;
      totalTokens++;
    }
    const bg = bigrams(tokens);
    for (const b of bg) {
      bigramCounts.set(b, (bigramCounts.get(b) ?? 0) + 1);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      const parts = [tokens[i]!, tokens[i + 1]!, tokens[i + 2]!];
      const allZh = parts.every((p) => p.lang === "zh");
      const joiner = allZh ? "" : " ";
      const tg = parts.map((p) => p.text).join(joiner);
      trigramCounts.set(tg, (trigramCounts.get(tg) ?? 0) + 1);
    }
  }

  const totalLang = Math.max(1, langEnTokens + langZhTokens + langOtherTokens);
  const messageCount = Math.max(1, textMessages.length);

  return {
    total_tokens: totalTokens,
    unique_tokens: wordCounts.size,
    top_words: topN(wordCounts, 50),
    top_bigrams: topN(bigramCounts, 30),
    signature_phrases: topN(trigramCounts, 20).filter(([_, c]) => c >= 3),
    swear_count: swearCount,
    swear_rate_per_1k_messages: (swearCount / messageCount) * 1000,
    language_mix: {
      en_ratio: langEnTokens / totalLang,
      zh_ratio: langZhTokens / totalLang,
      other_ratio: langOtherTokens / totalLang,
    },
    code_switch_rate_per_msg: codeSwitchMessages / messageCount,
  };
}

function punctuationStats(textMessages: string[]): PunctuationStats {
  const ending = new Map<string, number>();
  let totalAlpha = 0;
  let upperAlpha = 0;
  let ellipsisN = 0;
  let questionN = 0;
  let exclamationN = 0;
  let commaN = 0;
  let noTerminalN = 0;
  const total = Math.max(1, textMessages.length);

  for (const text of textMessages) {
    for (const ch of text) {
      if (/[a-zA-Z]/.test(ch)) {
        totalAlpha++;
        if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) upperAlpha++;
      }
    }
    if (/\.\.\.|…/.test(text)) ellipsisN++;
    if (/[?？]/.test(text)) questionN++;
    if (/[!！]/.test(text)) exclamationN++;
    if (/[,，]/.test(text)) commaN++;

    const trimmed = text.trimEnd();
    const last = trimmed.slice(-1);
    if (!last) continue;
    if (/[.!?。！？…]/.test(last)) {
      const key = /[.。]/.test(last)
        ? "."
        : /[!！]/.test(last)
          ? "!"
          : /[?？]/.test(last)
            ? "?"
            : "…";
      ending.set(key, (ending.get(key) ?? 0) + 1);
    } else {
      noTerminalN++;
    }
  }

  const endingPct: Record<string, number> = {};
  for (const [k, v] of ending) endingPct[k] = v / total;
  endingPct["none"] = noTerminalN / total;

  return {
    ending_punctuation: endingPct,
    caps_rate: totalAlpha > 0 ? upperAlpha / totalAlpha : 0,
    ellipsis_rate: ellipsisN / total,
    question_rate: questionN / total,
    exclamation_rate: exclamationN / total,
    comma_rate: commaN / total,
    no_terminal_rate: noTerminalN / total,
  };
}

function emojiStats(textMessages: string[]): EmojiStats {
  const counts = new Map<string, number>();
  let total = 0;
  let messagesWithEmoji = 0;
  for (const text of textMessages) {
    const matches = text.match(EMOJI_RE);
    if (!matches) continue;
    messagesWithEmoji++;
    for (const e of matches) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
      total++;
    }
  }
  const msgCount = Math.max(1, textMessages.length);
  return {
    top_emojis: topN(counts, 25),
    total_emoji_count: total,
    emojis_per_message: total / msgCount,
    messages_with_emoji_ratio: messagesWithEmoji / msgCount,
  };
}

function structureStats(messages: Message[]): StructureStats {
  const texts = messages.filter(hasText).map((m) => m.text);
  const lengths = texts.map((t) => t.length);
  const buckets = new Map<string, number>();
  const labels = ["0-10", "11-25", "26-50", "51-100", "101-200", "201+"];
  for (const l of lengths) {
    let label: string;
    if (l <= 10) label = labels[0]!;
    else if (l <= 25) label = labels[1]!;
    else if (l <= 50) label = labels[2]!;
    else if (l <= 100) label = labels[3]!;
    else if (l <= 200) label = labels[4]!;
    else label = labels[5]!;
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
  const hist: Record<string, number> = {};
  for (const l of labels) hist[l] = buckets.get(l) ?? 0;

  // Burst analysis on my-side messages by timestamp
  const sorted = [...messages].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  let burstSizes: number[] = [];
  let withinBurstGaps: number[] = [];
  let betweenBurstGaps: number[] = [];
  let curr: Message[] = [];
  let lastBurstEnd: number | null = null;

  const flush = () => {
    if (curr.length === 0) return;
    burstSizes.push(curr.length);
    if (lastBurstEnd !== null) {
      betweenBurstGaps.push(curr[0]!.timestamp.getTime() - lastBurstEnd);
    }
    lastBurstEnd = curr[curr.length - 1]!.timestamp.getTime();
    curr = [];
  };

  for (const m of sorted) {
    if (curr.length === 0) {
      curr.push(m);
      continue;
    }
    const prev = curr[curr.length - 1]!;
    const gap = m.timestamp.getTime() - prev.timestamp.getTime();
    if (gap <= BURST_GAP_MS) {
      withinBurstGaps.push(gap);
      curr.push(m);
    } else {
      flush();
      curr.push(m);
    }
  }
  flush();

  return {
    message_length_histogram: hist,
    median_length_chars: median(lengths),
    mean_length_chars: mean(lengths),
    p90_length_chars: quantile(lengths, 0.9),
    burst: {
      avg_messages_per_burst: mean(burstSizes),
      avg_gap_within_burst_seconds: mean(withinBurstGaps) / 1000,
      avg_gap_between_bursts_seconds: mean(betweenBurstGaps) / 1000,
    },
  };
}

function timingStats(
  myMessages: Message[],
  allMessages: Message[],
): TimingStats {
  const hour = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  for (const m of myMessages) {
    hour[m.timestamp.getHours()] = (hour[m.timestamp.getHours()] ?? 0) + 1;
    weekday[m.timestamp.getDay()] = (weekday[m.timestamp.getDay()] ?? 0) + 1;
  }

  // Reply latency: gap from "them" message to next "me" message in same thread
  const byContact = new Map<string, Message[]>();
  for (const m of allMessages) {
    let arr = byContact.get(m.contact_id);
    if (!arr) {
      arr = [];
      byContact.set(m.contact_id, arr);
    }
    arr.push(m);
  }

  const latencies: number[] = [];
  for (const arr of byContact.values()) {
    arr.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]!.sender !== "them") continue;
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j]!.sender === "me") {
          latencies.push(
            arr[j]!.timestamp.getTime() - arr[i]!.timestamp.getTime(),
          );
          break;
        }
      }
    }
  }

  return {
    hour_histogram: hour,
    weekday_histogram: weekday,
    median_reply_latency_seconds: median(latencies) / 1000,
  };
}

function bundle(myMessages: Message[], allMessages: Message[]): StatsBundle {
  const myTexts = myMessages.filter(hasText).map((m) => m.text);
  return {
    lexical: lexicalStats(myTexts),
    punctuation: punctuationStats(myTexts),
    emoji: emojiStats(myTexts),
    structure: structureStats(myMessages),
    timing: timingStats(myMessages, allMessages),
  };
}

export function computeGlobalStats(allMessages: Message[]): GlobalStats {
  const myMessages = allMessages.filter((m) => m.sender === "me");
  const contactIds = new Set(allMessages.map((m) => m.contact_id));
  return {
    generated_at: new Date(),
    total_messages: allMessages.length,
    total_messages_from_me: myMessages.length,
    total_contacts: contactIds.size,
    contacts_above_threshold: 0, // filled in by caller after filter
    stats: bundle(myMessages, allMessages),
  };
}

export function computePerContactStats(
  allMessages: Message[],
): PerContactStats[] {
  const byContact = new Map<string, Message[]>();
  for (const m of allMessages) {
    let arr = byContact.get(m.contact_id);
    if (!arr) {
      arr = [];
      byContact.set(m.contact_id, arr);
    }
    arr.push(m);
  }
  const out: PerContactStats[] = [];
  for (const [contact_id, arr] of byContact) {
    const myMsgs = arr.filter((m) => m.sender === "me");
    out.push({
      contact_id,
      contact_name: arr[0]!.contact_name,
      message_count: arr.length,
      stats: bundle(myMsgs, arr),
    });
  }
  return out;
}

export function detectLanguageOnText(text: string): "zh" | "en" | "other" {
  return detectLang(text);
}
