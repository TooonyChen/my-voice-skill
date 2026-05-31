#!/usr/bin/env bun
import { stat, readFile } from "node:fs/promises";
import { parseMessengerExport } from "../parsers/messenger.ts";
import { parseInstagramExport } from "../parsers/instagram.ts";
import { normalize } from "../analyzers/normalize.ts";
import { CustomPatternSchema, type CustomPattern } from "../types/config.ts";
import { z } from "zod";
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

const USAGE = `usage: bun run src/cli/parse.ts <platform> <export-path> --me "<my name>" [--aliases "alias1,alias2"] [--out exports/normalized/messages.jsonl] [--no-redact]

platforms: messenger | instagram

examples:
  bun run src/cli/parse.ts messenger ./exports/raw/facebook --me "Your Name"
  bun run src/cli/parse.ts messenger ./exports/raw/fb --me "Your Name" --aliases "Nickname,中文名"
  bun run src/cli/parse.ts instagram ./exports/raw/instagram --me "your_ig_handle"`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 2 || !flags.me) {
    die(USAGE);
  }
  const platform = positional[0]!;
  const exportPath = positional[1]!;
  const myName = String(flags.me);
  const aliases = flags.aliases
    ? String(flags.aliases)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const outPath = String(flags.out ?? "exports/normalized/messages.jsonl");
  const redactOn = flags["no-redact"] !== true;

  if (platform !== "messenger" && platform !== "instagram") {
    die(`unknown platform "${platform}". supported: messenger | instagram`);
  }

  process.stderr.write(`parsing ${platform} export at ${exportPath}...\n`);
  let messages =
    platform === "instagram"
      ? await parseInstagramExport(exportPath, myName, aliases)
      : await parseMessengerExport(exportPath, myName, aliases);
  process.stderr.write(`parsed ${messages.length} messages.\n`);

  if (redactOn) {
    const customPatterns = await loadCustomPatterns();
    messages = normalize(messages, {
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
  process.stderr.write(`wrote ${n} messages to ${outPath}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
