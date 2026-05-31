import { z } from "zod";
import { RelationshipLabel } from "./contact.ts";

const Anchor = z.object({
  count: z.number().int().nonnegative(),
  rate: z.string(),
  denominator: z.number().int().positive(),
});

const Finding = z.object({
  claim: z.string().min(1),
  anchor: Anchor,
  examples: z.array(z.string().max(30)).min(0).max(3),
  generalizes: z.boolean(),
  register_locked: RelationshipLabel.nullable(),
});
export type Finding = z.infer<typeof Finding>;

const RegisterShifts = z.object({
  lexicon_shift: z.string(),
  punctuation_shift: z.string(),
  emoji_shift: z.string(),
  length_shift: z.string(),
  swear_shift: z.string(),
  n_contacts: z.number().int().positive(),
});

export const PersonaFindingsSchema = z.object({
  generated_at: z.string(),
  source_stats_path: z.string(),
  categories: z.object({
    lexical_fingerprint: z.array(Finding),
    punctuation_and_caps: z.array(Finding),
    emoji: z.array(Finding),
    message_structure: z.array(Finding),
    conversational_moves: z.array(Finding),
    hard_donts: z.array(Finding),
  }),
  register_table: z.record(RelationshipLabel, RegisterShifts),
});
export type PersonaFindings = z.infer<typeof PersonaFindingsSchema>;

const AddressTerm = z.object({
  term: z.string().min(1),
  count: z.number().int().nonnegative(),
  registers: z.array(z.string()),
  first_seen: z.string().nullable().optional(),
});

const TimelineEvent = z.object({
  date: z.string(),
  event: z.string().min(1),
  evidence: z.string().max(80).optional(),
});

const RecurringTopic = z.object({
  topic: z.string().min(1),
  count: z.number().int().nonnegative(),
  register: z.string(),
  last_mentioned: z.string(),
});

const InsideJoke = z.object({
  phrase: z.string().min(1),
  first_seen: z.string(),
  count_with_them: z.number().int().nonnegative(),
  count_with_others: z.number().int().nonnegative(),
  context: z.string(),
});

const OngoingThread = z.object({
  thread: z.string().min(1),
  last_message: z.string(),
  status: z.enum(["open", "stalled"]),
  user_position: z.string().nullable(),
  their_position: z.string().nullable(),
  position_unknown: z.boolean().optional(),
  evidence_quote: z.string().max(30).optional(),
});

const CommunicationRhythm = z.object({
  typical_active_hours: z.string(),
  weekly_pattern: z.string(),
  median_reply_latency_from_me_seconds: z.number().nonnegative(),
  median_reply_latency_from_them_seconds: z.number().nonnegative(),
  burst_pattern: z.string(),
  preferred_register: z.enum(["relaxed", "conservative"]),
});

const Sensitivity = z.object({
  topic: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  last_triggered_at: z.string().nullable(),
  evidence_quotes: z.array(z.string().max(30)).max(3).optional(),
});

const ConflictPattern = z.object({
  pattern: z.string().min(1),
  frequency: z.string(),
  resolution_pattern: z.string().optional(),
});

const LastState = z.object({
  covering_messages: z.number().int().positive(),
  date_range: z.tuple([z.string(), z.string()]),
  summary: z.string().min(1),
});

export const MemoryFindingsSchema = z.object({
  contact_id: z.string(),
  slug: z.string(),
  generated_at: z.string(),
  source_stats_path: z.string(),
  address_terms: z.object({
    from_me_to_them: z.array(AddressTerm),
    from_them_to_me: z.array(AddressTerm),
    switch_signals: z.array(z.string()),
  }),
  timeline_events: z.array(TimelineEvent),
  recurring_topics: z.array(RecurringTopic),
  inside_jokes: z.array(InsideJoke),
  ongoing_threads: z.array(OngoingThread),
  communication_rhythm: CommunicationRhythm,
  sensitivities: z.array(Sensitivity),
  conflict_patterns: z.array(ConflictPattern),
  last_state_summary: LastState,
});
export type MemoryFindings = z.infer<typeof MemoryFindingsSchema>;
