#!/usr/bin/env bun
import { stat, readFile } from "node:fs/promises";
import { z } from "zod";
import { normalizeGroupMessages } from "../analyzers/normalize.ts";
import { parseInstagramGroupExport } from "../parsers/instagram.ts";
import { parseMessengerGroupExport } from "../parsers/messenger.ts";
import { parseWeFlowGroupExport } from "../parsers/weflow.ts";
import { CustomPatternSchema, type CustomPattern } from "../types/config.ts";
import type { GroupMessage } from "../types/group.ts";
import { die, parseArgs, writeJsonl } from "./util.ts";

async function loadCustomPatterns(): Promise<CustomPattern[]> {
  const path = "config.json";
  try {
    const s = await stat(path);
    if (!s.isFile()) return [];
  } catch {
    return [];
  }
  try {
    const raw = await readFile(path, "utf-8");
    const json = JSON.parse(raw);
    const arr = json?.redaction?.custom_patterns;
    if (!Array.isArray(arr)) return [];
    return z.array(CustomPatternSchema).parse(arr);
  } catch (e) {
    process.stderr.write(
      `warning: config.json present but custom_patterns malformed; skipping. (${e instanceof Error ? e.message : e})\n`,
    );
    return [];
  }
}

const USAGE = `usage: bun run src/cli/parse_groups.ts <platform> <export-path> [--me "<my name>"] [--aliases "alias1,alias2"] [--out exports/normalized/group_messages.jsonl] [--no-redact]

platforms: messenger | instagram | wechat

examples:
  bun run src/cli/parse_groups.ts wechat ./exports/raw/weflow
  bun run src/cli/parse_groups.ts messenger ./exports/raw/facebook --me "Your Name"`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 2) die(USAGE);
  const platform = positional[0]!;
  const exportPath = positional[1]!;
  const myName = flags.me ? String(flags.me) : "";
  const aliases = flags.aliases
    ? String(flags.aliases)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const outPath = String(flags.out ?? "exports/normalized/group_messages.jsonl");
  const redactOn = flags["no-redact"] !== true;

  if (platform !== "messenger" && platform !== "instagram" && platform !== "wechat") {
    die(`unknown platform "${platform}". supported: messenger | instagram | wechat`);
  }
  if (platform !== "wechat" && !flags.me) {
    die(`--me is required for ${platform} group exports so sender_name can be mapped to "me"`);
  }

  process.stderr.write(`parsing ${platform} group export at ${exportPath}...\n`);
  let messages: GroupMessage[];
  if (platform === "instagram") {
    messages = await parseInstagramGroupExport(exportPath, myName, aliases);
  } else if (platform === "wechat") {
    messages = await parseWeFlowGroupExport(exportPath, myName, aliases);
  } else {
    messages = await parseMessengerGroupExport(exportPath, myName, aliases);
  }
  process.stderr.write(`parsed ${messages.length} group messages.\n`);

  if (redactOn) {
    const customPatterns = await loadCustomPatterns();
    messages = normalizeGroupMessages(messages, {
      phone: true,
      email: true,
      address: true,
      secrets: true,
      custom_patterns: customPatterns,
    });
    const extra = customPatterns.length > 0 ? ` + ${customPatterns.length} custom pattern(s)` : "";
    process.stderr.write(`redaction pass: phone/email/address/secrets scrubbed${extra}.\n`);
  }

  const n = await writeJsonl(outPath, messages);
  process.stderr.write(`wrote ${n} group messages to ${outPath}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
