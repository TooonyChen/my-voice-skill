import { readdir, readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  ClassifiedContactSchema,
  ContactStatsSchema,
  type ClassifiedContact,
  type ContactStats,
} from "../types/contact.ts";
import {
  GroupRelationshipSignalSchema,
  type GroupRelationshipSignal,
} from "../types/group.ts";

export interface ClassificationTask {
  contact: ContactStats;
  sample_command: string[];
  sample_path: string;
  result_path: string;
  group_signal: GroupRelationshipSignal | null;
}

export interface ClassificationShard {
  shard_index: number;
  total_shards: number;
  task_count: number;
  tasks: ClassificationTask[];
}

export function parseContactsPayload(raw: unknown): ContactStats[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as { contacts?: unknown }).contacts
      : undefined;
  return z.array(ContactStatsSchema).parse(source);
}

export function parseClassifiedPayload(raw: unknown | null): ClassifiedContact[] {
  if (raw === null) return [];
  return z.array(ClassifiedContactSchema).parse(raw);
}

export function resultFileName(contactId: string): string {
  return `${Buffer.from(contactId).toString("base64url")}.json`;
}

export function buildClassificationTasks(
  contacts: ContactStats[],
  opts: {
    classified?: ClassifiedContact[];
    completedResults?: ClassifiedContact[];
    groupSignals?: GroupRelationshipSignal[];
    resultDir?: string;
    sampleDir?: string;
  } = {},
): ClassificationTask[] {
  const classifiedIds = new Set((opts.classified ?? []).map((c) => c.contact_id));
  const completedIds = new Set((opts.completedResults ?? []).map((c) => c.contact_id));
  const signalByContact = new Map(
    (opts.groupSignals ?? []).map((signal) => [signal.contact_id, signal]),
  );
  const resultDir = opts.resultDir ?? "exports/classifications";
  const sampleDir = opts.sampleDir ?? "exports/samples/classify";

  return contacts
    .filter((contact) => !classifiedIds.has(contact.contact_id))
    .filter((contact) => !completedIds.has(contact.contact_id))
    .map((contact) => {
      const samplePath = `${sampleDir}/${resultFileName(contact.contact_id)}`;
      return {
        contact,
        sample_command: [
          "bun",
          "run",
          "src/cli/sample.ts",
          contact.contact_id,
          "--mode",
          "classify",
          "--n",
          "200",
          "--out",
          samplePath,
        ],
        sample_path: samplePath,
        result_path: `${resultDir}/${resultFileName(contact.contact_id)}`,
        group_signal: signalByContact.get(contact.contact_id) ?? null,
      };
    });
}

export function chunkTasks(
  tasks: ClassificationTask[],
  shardSize: number,
): ClassificationShard[] {
  const size = Math.max(1, Math.floor(shardSize));
  const total = Math.ceil(tasks.length / size);
  const shards: ClassificationShard[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = tasks.slice(i * size, (i + 1) * size);
    shards.push({
      shard_index: i + 1,
      total_shards: total,
      task_count: chunk.length,
      tasks: chunk,
    });
  }
  return shards;
}

export function mergeClassifications(
  contacts: ContactStats[],
  existing: ClassifiedContact[],
  resultFiles: ClassifiedContact[],
): {
  merged: ClassifiedContact[];
  missing: ContactStats[];
  duplicates: string[];
} {
  const resultById = new Map<string, ClassifiedContact>();
  const duplicates = new Set<string>();

  for (const result of resultFiles) {
    if (resultById.has(result.contact_id)) duplicates.add(result.contact_id);
    resultById.set(result.contact_id, result);
  }

  const existingById = new Map(existing.map((entry) => [entry.contact_id, entry]));
  const merged: ClassifiedContact[] = [];
  const missing: ContactStats[] = [];

  for (const contact of contacts) {
    const existingEntry = existingById.get(contact.contact_id);
    if (
      existingEntry?.label_source === "manual_override" ||
      existingEntry?.label_source === "correction_override"
    ) {
      merged.push(existingEntry);
      continue;
    }

    const result = resultById.get(contact.contact_id) ?? existingEntry;
    if (result) {
      merged.push(result);
    } else {
      missing.push(contact);
    }
  }

  return { merged, missing, duplicates: [...duplicates].sort() };
}

export async function readClassifiedFiles(dir: string): Promise<ClassifiedContact[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const out: ClassifiedContact[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(await readFile(`${dir}/${file}`, "utf-8"));
    out.push(ClassifiedContactSchema.parse(raw));
  }
  return out;
}

export function parseGroupSignals(raw: unknown | null): GroupRelationshipSignal[] {
  if (raw === null) return [];
  return z.array(GroupRelationshipSignalSchema).parse(raw);
}
