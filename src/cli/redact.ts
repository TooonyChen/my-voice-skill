#!/usr/bin/env bun
import { readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CustomPatternSchema, type CustomPattern } from "../types/config.ts";
import { normalize } from "../analyzers/normalize.ts";
import {
  die,
  parseArgs,
  readMessagesJsonl,
  writeJson,
  writeJsonl,
} from "./util.ts";

const USAGE = `usage: bun run src/cli/redact.ts <slug> <pattern> [--regex] [--flags gi] [--replacement "[redacted]"] [--messages exports/normalized/messages.jsonl]

slug:     person memory slug, e.g. "min-minp". Use "_global_" to apply to config + messages only.
pattern:  plain string (default) or regex source (with --regex).
--regex:  treat pattern as a regex source.
--flags:  regex flags (default "gi"). Only used with --regex.
--replacement: redaction replacement (default "[redacted-custom]").

Effects:
  1. Appends the pattern to config.json -> redaction.custom_patterns (creates config.json if absent).
  2. Re-normalizes the existing messages.jsonl in place (with a .bak backup). Skipped if file missing.
  3. Scrubs occurrences from memory/person/<slug>.md (skipped for _global_).
  4. Appends an entry to that file's ## Manual notes section.`;

function todayIso(): string {
  return new Date().toISOString();
}

const ConfigShape = z
  .object({
    redaction: z
      .object({
        custom_patterns: z.array(CustomPatternSchema).default([]),
      })
      .passthrough()
      .default({ custom_patterns: [] }),
  })
  .passthrough();

function isEnoent(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

async function loadOrInitConfig(): Promise<z.infer<typeof ConfigShape>> {
  let raw: string;
  try {
    raw = await readFile("config.json", "utf-8");
  } catch (e) {
    if (isEnoent(e)) {
      return { redaction: { custom_patterns: [] } };
    }
    throw new Error(
      `could not read config.json (refusing to overwrite): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `config.json exists but is not valid JSON; refusing to overwrite. fix or delete and re-run. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const parsed = ConfigShape.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `config.json exists but does not match the expected shape; refusing to overwrite. fix or delete and re-run.\n${issues}`,
    );
  }
  return parsed.data;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function appendManualNote(
  filePath: string,
  pattern: string,
  isRegex: boolean,
): Promise<void> {
  const raw = await readFile(filePath, "utf-8");
  const noteLine = `- ${todayIso()} — /redact applied: pattern ${isRegex ? "(regex) " : ""}\`${pattern}\` scrubbed from this file and added to config.redaction.custom_patterns.`;

  const lines = raw.split("\n");
  const manualIdx = lines.findIndex((l) => /^##\s+Manual notes\b/i.test(l));
  if (manualIdx === -1) {
    process.stderr.write(
      `warning: ${filePath} has no '## Manual notes' section; appending one at the end.\n`,
    );
    const appended =
      raw.replace(/\s+$/, "") +
      `\n\n## Manual notes\n\n${noteLine}\n`;
    await writeFile(filePath, appended);
    return;
  }
  let insertAt = lines.length;
  for (let i = manualIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, noteLine);
  await writeFile(filePath, lines.join("\n"));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) die(USAGE);
  const slug = positional[0]!;
  const pattern = positional[1]!;
  const isRegex = flags.regex === true;
  const flagsStr = flags.flags ? String(flags.flags) : "gi";
  const replacement = flags.replacement
    ? String(flags.replacement)
    : "[redacted-custom]";
  const messagesPath = String(
    flags.messages ?? "exports/normalized/messages.jsonl",
  );

  // 1. Update config.json
  const config = await loadOrInitConfig();
  const newPattern: CustomPattern = {
    pattern,
    is_regex: isRegex,
    flags: flagsStr,
    replacement,
    added_at: todayIso(),
    source: slug === "_global_" ? "user via /redact (global)" : `user via /redact (${slug})`,
  };
  config.redaction.custom_patterns.push(newPattern);
  await writeJson("config.json", config);
  process.stderr.write(
    `appended pattern to config.json (now ${config.redaction.custom_patterns.length} custom pattern(s))\n`,
  );

  // 2. Re-normalize messages.jsonl if present
  if (await fileExists(messagesPath)) {
    await copyFile(messagesPath, `${messagesPath}.bak`);
    const messages = await readMessagesJsonl(messagesPath);
    const cleaned = normalize(messages, {
      phone: true,
      email: true,
      address: true,
      secrets: true,
      custom_patterns: config.redaction.custom_patterns,
    });
    await writeJsonl(messagesPath, cleaned);
    process.stderr.write(
      `re-normalized ${cleaned.length} messages → ${messagesPath} (backup at ${messagesPath}.bak)\n`,
    );
  } else {
    process.stderr.write(
      `no messages at ${messagesPath}; pattern will apply on next /parse run.\n`,
    );
  }

  // 3. Scrub from memory/person/{slug}.md
  if (slug === "_global_") {
    process.stderr.write(`slug=_global_; skipping person file scrub.\n`);
    return;
  }
  const personPath = join("memory", "person", `${slug}.md`);
  if (!(await fileExists(personPath))) {
    process.stderr.write(
      `warning: ${personPath} does not exist; pattern still added to config and will apply on next /generate-memory.\n`,
    );
    return;
  }

  await copyFile(personPath, `${personPath}.bak`);
  const original = await readFile(personPath, "utf-8");
  let scrubbed = original;
  if (isRegex) {
    scrubbed = scrubbed.replace(new RegExp(pattern, flagsStr), replacement);
  } else {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    scrubbed = scrubbed.replace(new RegExp(escaped, flagsStr || "gi"), replacement);
  }
  await writeFile(personPath, scrubbed);
  process.stderr.write(
    `scrubbed pattern from ${personPath} (backup at ${personPath}.bak)\n`,
  );

  // 4. Manual notes entry
  await appendManualNote(personPath, pattern, isRegex);
  process.stderr.write(`appended Manual notes entry to ${personPath}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
