import { z } from "zod";
import { MediaType, Platform } from "./message.ts";
import { StatsBundleSchema } from "./stats.ts";

export const GroupSender = z.enum(["me", "participant"]);
export type GroupSender = z.infer<typeof GroupSender>;

export const GroupMessageSchema = z.object({
  group_id: z.string(),
  group_name: z.string(),
  platform: Platform,
  timestamp: z.coerce.date(),
  sender: GroupSender,
  participant_id: z.string(),
  participant_name: z.string(),
  text: z.string().nullable(),
  media_type: MediaType,
  reply_to_timestamp: z.coerce.date().nullable(),
});
export type GroupMessage = z.infer<typeof GroupMessageSchema>;

export const GroupToneStatsSchema = z.object({
  generated_at: z.coerce.date(),
  source_messages_path: z.string(),
  total_group_messages: z.number().int().nonnegative(),
  total_messages_from_me: z.number().int().nonnegative(),
  total_groups: z.number().int().nonnegative(),
  stats: StatsBundleSchema,
});
export type GroupToneStats = z.infer<typeof GroupToneStatsSchema>;

const CountedTermSchema = z.object({
  term: z.string(),
  count: z.number().int().nonnegative(),
});
export type CountedTerm = z.infer<typeof CountedTermSchema>;

export const GroupRelationshipSignalSchema = z.object({
  contact_id: z.string(),
  contact_name: z.string(),
  matched_participant_ids: z.array(z.string()),
  matched_participant_names: z.array(z.string()),
  shared_groups: z.number().int().nonnegative(),
  group_message_count_from_me: z.number().int().nonnegative(),
  group_message_count_from_participant: z.number().int().nonnegative(),
  address_terms_from_me: z.array(CountedTermSchema),
  evidence_source: z.literal("group_chat"),
  weight: z.literal("weak"),
});
export type GroupRelationshipSignal = z.infer<typeof GroupRelationshipSignalSchema>;

export const GroupContextSchema = z.object({
  group_id: z.string(),
  group_name: z.string(),
  platform: Platform,
  message_count: z.number().int().nonnegative(),
  message_count_from_me: z.number().int().nonnegative(),
  participant_count: z.number().int().nonnegative(),
  first_message_at: z.coerce.date(),
  last_message_at: z.coerce.date(),
  top_participants: z.array(
    z.object({
      participant_id: z.string(),
      participant_name: z.string(),
      message_count: z.number().int().nonnegative(),
    }),
  ),
  top_terms_from_me: z.array(CountedTermSchema),
  top_terms_all: z.array(CountedTermSchema),
});
export type GroupContext = z.infer<typeof GroupContextSchema>;

export const GroupContextBundleSchema = z.object({
  generated_at: z.coerce.date(),
  source_messages_path: z.string(),
  groups: z.array(GroupContextSchema),
});
export type GroupContextBundle = z.infer<typeof GroupContextBundleSchema>;
