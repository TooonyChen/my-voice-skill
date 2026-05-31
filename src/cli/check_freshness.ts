#!/usr/bin/env bun
import { stat } from "node:fs/promises";
import { die, parseArgs } from "./util.ts";

const USAGE = `usage: bun run src/cli/check_freshness.ts <target>

targets:
  stats       — checks exports/stats.json and exports/per_contact_stats.json exist and are at least as new as exports/normalized/messages.jsonl.
  classified  — checks exports/contacts_classified.json exists and is at least as new as exports/stats.json.
  messages    — checks exports/normalized/messages.jsonl exists.

exit codes:
  0 — fresh
  1 — missing or stale (with a one-line reason on stderr)`;

interface MtimeResult {
  path: string;
  exists: boolean;
  mtimeMs: number;
}

async function getMtime(path: string): Promise<MtimeResult> {
  try {
    const s = await stat(path);
    return { path, exists: true, mtimeMs: s.mtimeMs };
  } catch {
    return { path, exists: false, mtimeMs: 0 };
  }
}

function fail(reason: string): never {
  process.stderr.write(`stale: ${reason}\n`);
  process.exit(1);
}

async function checkStats() {
  const msgs = await getMtime("exports/normalized/messages.jsonl");
  if (!msgs.exists) {
    fail("exports/normalized/messages.jsonl missing — run /parse first");
  }
  const global = await getMtime("exports/stats.json");
  if (!global.exists) {
    fail("exports/stats.json missing — run /stats first");
  }
  const perContact = await getMtime("exports/per_contact_stats.json");
  if (!perContact.exists) {
    fail("exports/per_contact_stats.json missing — run /stats first");
  }
  if (global.mtimeMs < msgs.mtimeMs) {
    fail(
      "exports/stats.json is older than messages.jsonl — re-run /stats to refresh",
    );
  }
  if (perContact.mtimeMs < msgs.mtimeMs) {
    fail(
      "exports/per_contact_stats.json is older than messages.jsonl — re-run /stats to refresh",
    );
  }
  process.stdout.write("fresh: stats\n");
}

async function checkClassified() {
  const stats = await getMtime("exports/stats.json");
  if (!stats.exists) {
    fail("exports/stats.json missing — run /stats first");
  }
  const classified = await getMtime("exports/contacts_classified.json");
  if (!classified.exists) {
    fail(
      "exports/contacts_classified.json missing — run /classify-contacts first",
    );
  }
  if (classified.mtimeMs < stats.mtimeMs) {
    fail(
      "exports/contacts_classified.json is older than stats.json — re-run /classify-contacts",
    );
  }
  process.stdout.write("fresh: classified\n");
}

async function checkMessages() {
  const msgs = await getMtime("exports/normalized/messages.jsonl");
  if (!msgs.exists) {
    fail("exports/normalized/messages.jsonl missing — run /parse first");
  }
  process.stdout.write("fresh: messages\n");
}

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  if (positional.length < 1) die(USAGE);
  const target = positional[0]!;
  switch (target) {
    case "stats":
      return checkStats();
    case "classified":
      return checkClassified();
    case "messages":
      return checkMessages();
    default:
      die(`unknown target "${target}". valid: stats | classified | messages`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
