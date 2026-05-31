#!/usr/bin/env bun
import { z } from "zod";
import { computeGroupRelationshipSignals } from "../analyzers/group.ts";
import { ContactStatsSchema } from "../types/contact.ts";
import {
  die,
  parseArgs,
  readGroupMessagesJsonl,
  readJson,
  writeJson,
} from "./util.ts";

const USAGE = `usage: bun run src/cli/group_signals.ts [--groups exports/normalized/group_messages.jsonl] [--contacts exports/contacts_passed.json] [--out exports/group_relationship_signals.json]`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const groupsPath = String(flags.groups ?? "exports/normalized/group_messages.jsonl");
  const contactsPath = String(flags.contacts ?? "exports/contacts_passed.json");
  const outPath = String(flags.out ?? "exports/group_relationship_signals.json");

  const groupMessages = await readGroupMessagesJsonl(groupsPath);
  const contactsRaw = await readJson<unknown>(contactsPath);
  const contacts = z
    .array(ContactStatsSchema)
    .parse(Array.isArray(contactsRaw) ? contactsRaw : (contactsRaw as { contacts?: unknown }).contacts);
  const signals = computeGroupRelationshipSignals(groupMessages, contacts);
  await writeJson(outPath, signals);
  process.stderr.write(
    `wrote ${signals.length} weak group relationship signal(s) → ${outPath}\n`,
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
