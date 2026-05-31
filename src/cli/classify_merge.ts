#!/usr/bin/env bun
import { z } from "zod";
import {
  mergeClassifications,
  parseClassifiedPayload,
  parseContactsPayload,
  readClassifiedFiles,
} from "../analyzers/classification_queue.ts";
import { ClassifiedContactSchema } from "../types/contact.ts";
import { die, parseArgs, readJson, writeJson } from "./util.ts";

const USAGE = `usage: bun run src/cli/classify_merge.ts [--contacts exports/contacts_passed.json] [--classified exports/contacts_classified.json] [--results exports/classifications] [--out exports/contacts_classified.json] [--require-all]

Merges per-contact worker result files into contacts_classified.json. Preserves manual/correction overrides from the existing classified file.`;

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return await readJson<unknown>(path);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const contactsPath = String(flags.contacts ?? "exports/contacts_passed.json");
  const classifiedPath = String(flags.classified ?? "exports/contacts_classified.json");
  const resultsDir = String(flags.results ?? "exports/classifications");
  const outPath = String(flags.out ?? "exports/contacts_classified.json");
  const requireAll = flags["require-all"] === true;

  const contacts = parseContactsPayload(await readJson<unknown>(contactsPath));
  const existing = parseClassifiedPayload(await readJsonIfExists(classifiedPath));
  const resultFiles = await readClassifiedFiles(resultsDir);
  const { merged, missing, duplicates } = mergeClassifications(
    contacts,
    existing,
    resultFiles,
  );

  z.array(ClassifiedContactSchema).parse(merged);
  await writeJson(outPath, merged);

  process.stdout.write(
    `merged classifications: ${merged.length}/${contacts.length} contact(s), missing=${missing.length}, result_files=${resultFiles.length}\n`,
  );
  if (duplicates.length > 0) {
    process.stdout.write(`warning: duplicate result ids: ${duplicates.join(", ")}\n`);
  }
  if (missing.length > 0) {
    process.stdout.write("missing contacts:\n");
    for (const contact of missing.slice(0, 20)) {
      process.stdout.write(`- ${contact.contact_id} (${contact.contact_name})\n`);
    }
    if (missing.length > 20) {
      process.stdout.write(`... ${missing.length - 20} more\n`);
    }
  }
  if (requireAll && missing.length > 0) process.exit(1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
