#!/usr/bin/env bun
import { computeGroupToneStats } from "../analyzers/group.ts";
import { die, parseArgs, readGroupMessagesJsonl, writeJson } from "./util.ts";

const USAGE = `usage: bun run src/cli/group_stats.ts [--in exports/normalized/group_messages.jsonl] [--out exports/group_tone_stats.json]`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const inPath = String(flags.in ?? "exports/normalized/group_messages.jsonl");
  const outPath = String(flags.out ?? "exports/group_tone_stats.json");

  process.stderr.write(`reading ${inPath}...\n`);
  const messages = await readGroupMessagesJsonl(inPath);
  process.stderr.write(`loaded ${messages.length} group messages.\n`);

  const stats = computeGroupToneStats(messages, inPath);
  await writeJson(outPath, stats);
  process.stderr.write(`wrote group tone stats → ${outPath}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
