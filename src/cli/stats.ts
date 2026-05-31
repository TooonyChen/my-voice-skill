#!/usr/bin/env bun
import {
  computeGlobalStats,
  computePerContactStats,
} from "../analyzers/stats.ts";
import {
  computeContactStats,
  DEFAULT_THRESHOLDS,
  filterContacts,
} from "../analyzers/filter_contacts.ts";
import {
  die,
  parseArgs,
  readMessagesJsonl,
  writeJson,
} from "./util.ts";

const USAGE = `usage: bun run src/cli/stats.ts [--in exports/normalized/messages.jsonl] [--out-global exports/stats.json] [--out-per-contact exports/per_contact_stats.json]`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const inPath = String(flags.in ?? "exports/normalized/messages.jsonl");
  const outGlobal = String(flags["out-global"] ?? "exports/stats.json");
  const outPer = String(flags["out-per-contact"] ?? "exports/per_contact_stats.json");

  process.stderr.write(`reading ${inPath}...\n`);
  const messages = await readMessagesJsonl(inPath);
  process.stderr.write(`loaded ${messages.length} messages.\n`);

  const contactStats = computeContactStats(messages);
  const passed = filterContacts(contactStats, DEFAULT_THRESHOLDS);

  const global = computeGlobalStats(messages);
  global.contacts_above_threshold = passed.length;

  const perContact = computePerContactStats(messages);

  await writeJson(outGlobal, global);
  process.stderr.write(`wrote global stats → ${outGlobal}\n`);

  await writeJson(outPer, perContact);
  process.stderr.write(`wrote per-contact stats → ${outPer}\n`);

  process.stderr.write(
    `\n${contactStats.length} contacts; ${passed.length} above default threshold (${DEFAULT_THRESHOLDS.total} total, ${DEFAULT_THRESHOLDS.eachWay} each-way).\n`,
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

// touch USAGE so linters don't drop it
void USAGE;
