#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ClassifiedContactSchema } from "../types/contact.ts";
import { planPersonaQuota, timeStratifiedSample } from "../analyzers/sampling.ts";
import type { Message } from "../types/message.ts";
import {
  die,
  parseArgs,
  readMessagesJsonl,
  writeJson,
} from "./util.ts";

const USAGE = `usage: bun run src/cli/sample.ts <contact_id|persona> [options]

modes (--mode flag, default: classify):
  classify  — single-contact, time-stratified across <buckets> equal time slices.
              positional arg is the contact_id.
  persona   — cross-contact, label-quota sampling. positional arg must be "persona".
              reads exports/contacts_classified.json and balances samples across labels.
  memory    — like classify, but supports --from / --to for time-windowed analysis.

shared flags:
  --n N             total sample size (default 200 for classify/memory, 800 for persona)
  --in PATH         messages.jsonl path (default exports/normalized/messages.jsonl)
  --sender ME|THEM|ALL  filter by sender (default ALL)
  --buckets N       time buckets for stratification (default 5)
  --from ISO        only include messages on or after this date (memory mode)
  --to ISO          only include messages on or before this date (memory mode)
  --classified PATH path to contacts_classified.json (persona mode, default exports/contacts_classified.json)
  --out PATH        override output path

output:
  classify/memory → exports/samples/<contact_id>.json
  persona         → exports/samples/persona_pool.json`;

interface SampleEntry {
  ts: string;
  sender: Message["sender"];
  text: string | null;
  media_type: Message["media_type"];
}

function toEntry(m: Message): SampleEntry {
  return {
    ts: m.timestamp.toISOString(),
    sender: m.sender,
    text: m.text,
    media_type: m.media_type,
  };
}

function filterPool(
  all: Message[],
  opts: {
    contactId?: string;
    sender: "me" | "them" | "all";
    from?: Date | null;
    to?: Date | null;
  },
): Message[] {
  let pool = all.filter((m) => m.text !== null);
  if (opts.contactId) {
    pool = pool.filter((m) => m.contact_id === opts.contactId);
  }
  if (opts.sender !== "all") {
    pool = pool.filter((m) => m.sender === opts.sender);
  }
  if (opts.from) {
    pool = pool.filter((m) => m.timestamp >= opts.from!);
  }
  if (opts.to) {
    pool = pool.filter((m) => m.timestamp <= opts.to!);
  }
  return pool;
}

async function runClassifyOrMemory(
  mode: "classify" | "memory",
  positional: string[],
  flags: Record<string, string | boolean>,
) {
  const contactId = positional[0]!;
  const n = flags.n ? Number(flags.n) : 200;
  const inPath = String(flags.in ?? "exports/normalized/messages.jsonl");
  const sender = (
    (flags.sender ? String(flags.sender) : "all").toLowerCase()
  ) as "me" | "them" | "all";
  const buckets = flags.buckets ? Number(flags.buckets) : 5;
  const from = flags.from ? new Date(String(flags.from)) : null;
  const to = flags.to ? new Date(String(flags.to)) : null;
  const outPath = String(
    flags.out ?? `exports/samples/${contactId}.json`,
  );

  const all = await readMessagesJsonl(inPath);
  const pool = filterPool(all, { contactId, sender, from, to });
  if (pool.length === 0) {
    die(
      `no messages for contact_id=${contactId} (sender=${sender}${from || to ? `, window=${from?.toISOString() ?? "*"}..${to?.toISOString() ?? "*"}` : ""})`,
    );
  }
  const sampled = timeStratifiedSample(pool, n, buckets);
  await writeJson(outPath, {
    mode,
    contact_id: contactId,
    total_in_pool: pool.length,
    sampled: sampled.length,
    buckets,
    sender_filter: sender,
    window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    messages: sampled.map(toEntry),
  });
  process.stderr.write(
    `[${mode}] sampled ${sampled.length} of ${pool.length} → ${outPath}\n`,
  );
}

async function runPersona(flags: Record<string, string | boolean>) {
  const n = flags.n ? Number(flags.n) : 800;
  const inPath = String(flags.in ?? "exports/normalized/messages.jsonl");
  const classifiedPath = String(
    flags.classified ?? "exports/contacts_classified.json",
  );
  const buckets = flags.buckets ? Number(flags.buckets) : 5;
  const outPath = String(flags.out ?? "exports/samples/persona_pool.json");

  const rawClassified = JSON.parse(await readFile(classifiedPath, "utf-8"));
  const classified = z
    .array(ClassifiedContactSchema)
    .parse(rawClassified)
    .filter((c) => c.label !== "unclassified");

  if (classified.length === 0) {
    die(`no classified contacts in ${classifiedPath} (after dropping unclassified)`);
  }

  const plan = planPersonaQuota(classified, n);
  const all = await readMessagesJsonl(inPath);

  const byLabel: Record<
    string,
    { quota: number; contacts: Array<{ contact_id: string; sampled: SampleEntry[] }> }
  > = {};

  for (const label of Object.keys(plan.per_label)) {
    byLabel[label] = { quota: plan.per_label[label]!.quota, contacts: [] };
  }

  let totalSampled = 0;
  for (const contact_id of Object.keys(plan.per_contact)) {
    const cp = plan.per_contact[contact_id]!;
    const pool = filterPool(all, {
      contactId: contact_id,
      sender: "me",
      from: null,
      to: null,
    });
    if (pool.length === 0) continue;
    const sampled = timeStratifiedSample(pool, cp.quota, buckets);
    byLabel[cp.label]!.contacts.push({
      contact_id,
      sampled: sampled.map(toEntry),
    });
    totalSampled += sampled.length;
  }

  await writeJson(outPath, {
    mode: "persona",
    total_requested: plan.total_requested,
    total_sampled: totalSampled,
    buckets,
    sender_filter: "me",
    by_label: byLabel,
  });
  process.stderr.write(
    `[persona] sampled ${totalSampled} of ${plan.total_requested} requested, across ${Object.keys(byLabel).length} labels → ${outPath}\n`,
  );
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 1) die(USAGE);
  const mode = (flags.mode ? String(flags.mode) : "classify") as
    | "classify"
    | "persona"
    | "memory";
  if (mode === "persona") {
    return runPersona(flags);
  }
  if (mode === "classify" || mode === "memory") {
    return runClassifyOrMemory(mode, positional, flags);
  }
  die(`unknown mode: ${mode}. valid: classify | persona | memory`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
