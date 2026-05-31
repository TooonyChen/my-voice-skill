import { z } from "zod";

export const RelationshipLabel = z.enum([
  "intimate_partner",
  "family_close",
  "family_extended",
  "close_friend",
  "friend",
  "work_peer",
  "work_hierarchy",
  "acquaintance",
  "unclassified",
]);
export type RelationshipLabel = z.infer<typeof RelationshipLabel>;

export const SignalWeight = z.enum(["strong", "medium", "weak"]);
export type SignalWeight = z.infer<typeof SignalWeight>;

export const ContactStatsSchema = z.object({
  contact_id: z.string(),
  contact_name: z.string(),
  username: z.string().nullable(),
  message_count_total: z.number().int().nonnegative(),
  message_count_from_me: z.number().int().nonnegative(),
  message_count_from_them: z.number().int().nonnegative(),
  first_message_at: z.coerce.date(),
  last_message_at: z.coerce.date(),
  span_days: z.number().int().nonnegative(),
});
export type ContactStats = z.infer<typeof ContactStatsSchema>;

export const ClassificationSignal = z.object({
  type: z.string(),
  evidence: z.string(),
  weight: SignalWeight,
});
export type ClassificationSignal = z.infer<typeof ClassificationSignal>;

export const LabelSource = z.enum([
  "classifier",
  "manual_override",
  "correction_override",
]);
export type LabelSource = z.infer<typeof LabelSource>;

export const ClassifiedContactSchema = ContactStatsSchema.extend({
  label: RelationshipLabel,
  confidence: z.number().min(0).max(1),
  label_source: LabelSource,
  label_source_note: z.string().nullable().optional(),
  signals: z.array(ClassificationSignal),
  alt_labels: z.array(
    z.object({
      label: RelationshipLabel,
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ClassifiedContact = z.infer<typeof ClassifiedContactSchema>;

export function slugify(name: string, username: string | null): string {
  const first = name
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "") ?? "unknown";
  const u = (username ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return u ? `${first}-${u}` : first;
}
