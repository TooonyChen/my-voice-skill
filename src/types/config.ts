import { z } from "zod";
import { Platform } from "./message.ts";

export const CustomPatternSchema = z.object({
  pattern: z.string().min(1),
  is_regex: z.boolean().default(false),
  flags: z.string().default("gi"),
  replacement: z.string().default("[redacted-custom]"),
  added_at: z.string(),
  source: z.string().default("user via /redact"),
});
export type CustomPattern = z.infer<typeof CustomPatternSchema>;

export const RedactionConfigSchema = z.object({
  phone: z.boolean().default(true),
  email: z.boolean().default(true),
  address: z.boolean().default(true),
  secrets: z.boolean().default(true),
  custom_patterns: z.array(CustomPatternSchema).default([]),
});
export type RedactionConfig = z.infer<typeof RedactionConfigSchema>;

export const SkillConfigSchema = z.object({
  platform: Platform,
  export_path: z.string(),
  my_name: z.string(),
  my_aliases: z.array(z.string()).default([]),
  contact_threshold_total: z.number().int().positive().default(100),
  contact_threshold_each_way: z.number().int().positive().default(50),
  time_window: z
    .object({
      from: z.coerce.date().nullable(),
      to: z.coerce.date().nullable(),
    })
    .default({ from: null, to: null }),
  redaction: RedactionConfigSchema.default({}),
  manual_hints: z.record(z.string(), z.string()).default({}),
});
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
