#!/usr/bin/env bun
import { computeGroupContexts } from "../analyzers/group.ts";
import { die, parseArgs, readGroupMessagesJsonl, writeJson } from "./util.ts";

const USAGE = `usage: bun run src/cli/group_context.ts [--in exports/normalized/group_messages.jsonl] [--out exports/group_contexts.json]`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const inPath = String(flags.in ?? "exports/normalized/group_messages.jsonl");
  const outPath = String(flags.out ?? "exports/group_contexts.json");

  const messages = await readGroupMessagesJsonl(inPath);
  const contexts = computeGroupContexts(messages, inPath);
  await writeJson(outPath, contexts);
  process.stderr.write(
    `wrote ${contexts.groups.length} deterministic group context(s) → ${outPath}\n`,
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
