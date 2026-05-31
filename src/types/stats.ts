import { z } from "zod";

const FreqPair = z.tuple([z.string(), z.number()]);

export const LexicalStatsSchema = z.object({
  total_tokens: z.number().int().nonnegative(),
  unique_tokens: z.number().int().nonnegative(),
  top_words: z.array(FreqPair),
  top_bigrams: z.array(FreqPair),
  signature_phrases: z.array(FreqPair),
  swear_count: z.number().int().nonnegative(),
  swear_rate_per_1k_messages: z.number(),
  language_mix: z.object({
    en_ratio: z.number(),
    zh_ratio: z.number(),
    other_ratio: z.number(),
  }),
  code_switch_rate_per_msg: z.number(),
});
export type LexicalStats = z.infer<typeof LexicalStatsSchema>;

export const PunctuationStatsSchema = z.object({
  ending_punctuation: z.record(z.string(), z.number()),
  caps_rate: z.number(),
  ellipsis_rate: z.number(),
  question_rate: z.number(),
  exclamation_rate: z.number(),
  comma_rate: z.number(),
  no_terminal_rate: z.number(),
});
export type PunctuationStats = z.infer<typeof PunctuationStatsSchema>;

export const EmojiStatsSchema = z.object({
  top_emojis: z.array(FreqPair),
  total_emoji_count: z.number().int().nonnegative(),
  emojis_per_message: z.number(),
  messages_with_emoji_ratio: z.number(),
});
export type EmojiStats = z.infer<typeof EmojiStatsSchema>;

export const StructureStatsSchema = z.object({
  message_length_histogram: z.record(z.string(), z.number()),
  median_length_chars: z.number(),
  mean_length_chars: z.number(),
  p90_length_chars: z.number(),
  burst: z.object({
    avg_messages_per_burst: z.number(),
    avg_gap_within_burst_seconds: z.number(),
    avg_gap_between_bursts_seconds: z.number(),
  }),
});
export type StructureStats = z.infer<typeof StructureStatsSchema>;

export const TimingStatsSchema = z.object({
  hour_histogram: z.array(z.number()).length(24),
  weekday_histogram: z.array(z.number()).length(7),
  median_reply_latency_seconds: z.number(),
});
export type TimingStats = z.infer<typeof TimingStatsSchema>;

export const StatsBundleSchema = z.object({
  lexical: LexicalStatsSchema,
  punctuation: PunctuationStatsSchema,
  emoji: EmojiStatsSchema,
  structure: StructureStatsSchema,
  timing: TimingStatsSchema,
});
export type StatsBundle = z.infer<typeof StatsBundleSchema>;

export const GlobalStatsSchema = z.object({
  generated_at: z.coerce.date(),
  total_messages: z.number().int().nonnegative(),
  total_messages_from_me: z.number().int().nonnegative(),
  total_contacts: z.number().int().nonnegative(),
  contacts_above_threshold: z.number().int().nonnegative(),
  stats: StatsBundleSchema,
});
export type GlobalStats = z.infer<typeof GlobalStatsSchema>;

export const PerContactStatsSchema = z.object({
  contact_id: z.string(),
  contact_name: z.string(),
  message_count: z.number().int().nonnegative(),
  stats: StatsBundleSchema,
});
export type PerContactStats = z.infer<typeof PerContactStatsSchema>;
