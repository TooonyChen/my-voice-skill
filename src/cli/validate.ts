#!/usr/bin/env bun
import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  MemoryFindingsSchema,
  PersonaFindingsSchema,
} from "../types/findings.ts";
import { ClassifiedContactSchema } from "../types/contact.ts";
import { SkillConfigSchema } from "../types/config.ts";
import { GlobalStatsSchema, PerContactStatsSchema } from "../types/stats.ts";
import { die, parseArgs } from "./util.ts";

const USAGE = `usage: bun run src/cli/validate.ts <schema> <path>

schemas: persona_findings | memory_findings | classified_contacts | config | global_stats | per_contact_stats

Exits 0 on success and prints "ok: <schema>". Exits 1 with a JSON-formatted list of errors on failure.`;

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  persona_findings: PersonaFindingsSchema,
  memory_findings: MemoryFindingsSchema,
  classified_contacts: z.array(ClassifiedContactSchema),
  config: SkillConfigSchema,
  global_stats: GlobalStatsSchema,
  per_contact_stats: z.array(PerContactStatsSchema),
};

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) die(USAGE);
  const schemaName = positional[0]!;
  const path = positional[1]!;
  const schema = SCHEMAS[schemaName];
  if (!schema) {
    die(`unknown schema "${schemaName}". valid: ${Object.keys(SCHEMAS).join(", ")}`);
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    die(`could not read ${path}: ${e instanceof Error ? e.message : e}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    die(`${path} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }

  const result = schema.safeParse(json);
  if (result.success) {
    process.stdout.write(`ok: ${schemaName} (${path})\n`);
    process.exit(0);
  }

  const errors = result.error.issues.map((i) => ({
    path: i.path.join("."),
    code: i.code,
    message: i.message,
  }));
  process.stderr.write(
    `validation failed for ${schemaName} at ${path}:\n${JSON.stringify(errors, null, 2)}\n`,
  );
  process.exit(1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
