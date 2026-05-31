import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message } from "../types/message.ts";
import type { GroupMessage } from "../types/group.ts";

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJsonl<T>(path: string, items: Iterable<T>): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const lines: string[] = [];
  let n = 0;
  for (const item of items) {
    lines.push(JSON.stringify(item));
    n++;
  }
  await writeFile(path, lines.join("\n") + "\n");
  return n;
}

export async function readMessagesJsonl(path: string): Promise<Message[]> {
  const raw = await readFile(path, "utf-8");
  const out: Message[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    out.push({
      ...obj,
      timestamp: new Date(obj.timestamp),
      reply_to_timestamp: obj.reply_to_timestamp
        ? new Date(obj.reply_to_timestamp)
        : null,
    });
  }
  return out;
}

export async function readGroupMessagesJsonl(path: string): Promise<GroupMessage[]> {
  const raw = await readFile(path, "utf-8");
  const out: GroupMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    out.push({
      ...obj,
      timestamp: new Date(obj.timestamp),
      reply_to_timestamp: obj.reply_to_timestamp
        ? new Date(obj.reply_to_timestamp)
        : null,
    });
  }
  return out;
}

export function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function die(msg: string, code = 1): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}
