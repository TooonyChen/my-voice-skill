#!/usr/bin/env bun
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

const USAGE = `usage: bun run src/cli/filter.ts [--in exports/normalized/messages.jsonl] [--out exports/contacts_passed.json] [--total 100] [--each-way 50]`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const inPath = String(flags.in ?? "exports/normalized/messages.jsonl");
  const outPath = String(flags.out ?? "exports/contacts_passed.json");
  const total = flags.total ? Number(flags.total) : DEFAULT_THRESHOLDS.total;
  const eachWay = flags["each-way"]
    ? Number(flags["each-way"])
    : DEFAULT_THRESHOLDS.eachWay;

  process.stderr.write(`reading ${inPath}...\n`);
  const messages = await readMessagesJsonl(inPath);

  const all = computeContactStats(messages);
  const passed = filterContacts(all, { total, eachWay });

  await writeJson(outPath, {
    thresholds: { total, eachWay },
    total_contacts: all.length,
    passed_count: passed.length,
    contacts: passed,
  });

  process.stderr.write(
    `${all.length} contacts; ${passed.length} above threshold (${total} total, ${eachWay} each-way).\n`,
  );
  process.stderr.write(`wrote ${outPath}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

void USAGE;
