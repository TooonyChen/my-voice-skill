#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  parseClassifiedPayload,
  parseContactsPayload,
} from "../analyzers/classification_queue.ts";
import { die, parseArgs } from "./util.ts";

const USAGE = `usage: bun run src/cli/classify_progress.ts [--contacts exports/contacts_passed.json] [--classified exports/contacts_classified.json] [--next 10] [--fail-if-remaining] [--json]

Reports how many contacts still need /classify-contacts processing.
Exits 1 with --fail-if-remaining when any contact is still unclassified.`;

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const contactsPath = String(flags.contacts ?? "exports/contacts_passed.json");
  const classifiedPath = String(flags.classified ?? "exports/contacts_classified.json");
  const nextN = flags.next ? Number(flags.next) : 10;
  const jsonOut = flags.json === true;
  const failIfRemaining = flags["fail-if-remaining"] === true;

  const contactsRaw = await readJsonIfExists(contactsPath);
  if (contactsRaw === null) die(`${contactsPath} missing — run /filter first`);

  const contacts = parseContactsPayload(contactsRaw);
  const classified = parseClassifiedPayload(await readJsonIfExists(classifiedPath));
  const classifiedIds = new Set(classified.map((c) => c.contact_id));
  const remaining = contacts.filter((c) => !classifiedIds.has(c.contact_id));
  const duplicateCount = classified.length - classifiedIds.size;

  const payload = {
    contacts_path: contactsPath,
    classified_path: classifiedPath,
    total_contacts: contacts.length,
    classified_count: contacts.filter((c) => classifiedIds.has(c.contact_id)).length,
    extra_classified_count: classified.filter(
      (c) => !contacts.some((contact) => contact.contact_id === c.contact_id),
    ).length,
    duplicate_classified_count: duplicateCount,
    remaining_count: remaining.length,
    next: remaining.slice(0, nextN).map((c) => ({
      contact_id: c.contact_id,
      contact_name: c.contact_name,
      message_count_total: c.message_count_total,
      message_count_from_me: c.message_count_from_me,
      message_count_from_them: c.message_count_from_them,
    })),
  };

  if (jsonOut) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(
      `classification progress: ${payload.classified_count}/${payload.total_contacts} classified, ${payload.remaining_count} remaining\n`,
    );
    if (payload.duplicate_classified_count > 0) {
      process.stdout.write(
        `warning: ${payload.duplicate_classified_count} duplicate classified entr${payload.duplicate_classified_count === 1 ? "y" : "ies"}\n`,
      );
    }
    if (payload.extra_classified_count > 0) {
      process.stdout.write(
        `note: ${payload.extra_classified_count} classified entr${payload.extra_classified_count === 1 ? "y is" : "ies are"} not in current contacts_passed.json\n`,
      );
    }
    if (payload.next.length > 0) {
      process.stdout.write("next contacts:\n");
      for (const c of payload.next) {
        process.stdout.write(
          `- ${c.contact_id} (${c.contact_name}) total=${c.message_count_total} me=${c.message_count_from_me} them=${c.message_count_from_them}\n`,
        );
      }
    }
  }

  if (failIfRemaining && remaining.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
