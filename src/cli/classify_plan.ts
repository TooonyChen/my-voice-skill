#!/usr/bin/env bun
import { mkdir, readdir, unlink } from "node:fs/promises";
import {
  buildClassificationTasks,
  chunkTasks,
  parseClassifiedPayload,
  parseContactsPayload,
  parseGroupSignals,
  readClassifiedFiles,
} from "../analyzers/classification_queue.ts";
import { die, parseArgs, readJson, writeJson } from "./util.ts";

const USAGE = `usage: bun run src/cli/classify_plan.ts [--contacts exports/contacts_passed.json] [--classified exports/contacts_classified.json] [--results exports/classifications] [--samples exports/samples/classify] [--groups exports/group_relationship_signals.json] [--out exports/classification_tasks] [--shard-size 5]

Creates shard JSON files for subagents. Workers must write one ClassifiedContact JSON per task to task.result_path and must not edit exports/contacts_classified.json.`;

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return await readJson<unknown>(path);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}

async function removeOldShardFiles(outDir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(outDir);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return;
    throw e;
  }

  await Promise.all(
    files
      .filter((file) => /^shard_\d+\.json$/.test(file))
      .map((file) => unlink(`${outDir}/${file}`)),
  );
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const contactsPath = String(flags.contacts ?? "exports/contacts_passed.json");
  const classifiedPath = String(flags.classified ?? "exports/contacts_classified.json");
  const resultsDir = String(flags.results ?? "exports/classifications");
  const samplesDir = String(flags.samples ?? "exports/samples/classify");
  const groupsPath = String(flags.groups ?? "exports/group_relationship_signals.json");
  const outDir = String(flags.out ?? "exports/classification_tasks");
  const shardSize = flags["shard-size"] ? Number(flags["shard-size"]) : 5;

  const contacts = parseContactsPayload(await readJson<unknown>(contactsPath));
  const classified = parseClassifiedPayload(await readJsonIfExists(classifiedPath));
  const completedResults = await readClassifiedFiles(resultsDir);
  const groupSignals = parseGroupSignals(await readJsonIfExists(groupsPath));
  const tasks = buildClassificationTasks(contacts, {
    classified,
    completedResults,
    groupSignals,
    resultDir: resultsDir,
    sampleDir: samplesDir,
  });
  const shards = chunkTasks(tasks, shardSize);

  await mkdir(outDir, { recursive: true });
  await removeOldShardFiles(outDir);
  const shardFiles: string[] = [];
  for (const shard of shards) {
    const path = `${outDir}/shard_${String(shard.shard_index).padStart(3, "0")}.json`;
    await writeJson(path, shard);
    shardFiles.push(path);
  }

  await writeJson(`${outDir}/manifest.json`, {
    generated_at: new Date(),
    contacts_path: contactsPath,
    classified_path: classifiedPath,
    results_dir: resultsDir,
    samples_dir: samplesDir,
    total_contacts: contacts.length,
    existing_classified_count: classified.length,
    completed_result_count: completedResults.length,
    remaining_task_count: tasks.length,
    shard_size: shardSize,
    shard_count: shards.length,
    shard_files: shardFiles,
  });

  process.stdout.write(
    `classification plan: ${tasks.length} task(s), ${shards.length} shard(s), shard_size=${shardSize}\n`,
  );
  for (const file of shardFiles) process.stdout.write(`- ${file}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
void USAGE;
