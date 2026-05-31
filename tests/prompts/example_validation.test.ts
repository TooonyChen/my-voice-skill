import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  MemoryFindingsSchema,
  PersonaFindingsSchema,
} from "../../src/types/findings.ts";
import { ClassifiedContactSchema } from "../../src/types/contact.ts";
import { SkillConfigSchema } from "../../src/types/config.ts";
import {
  GlobalStatsSchema,
  PerContactStatsSchema,
} from "../../src/types/stats.ts";

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  persona_findings: PersonaFindingsSchema,
  memory_findings: MemoryFindingsSchema,
  classified_contacts: z.array(ClassifiedContactSchema),
  config: SkillConfigSchema,
  global_stats: GlobalStatsSchema,
  per_contact_stats: z.array(PerContactStatsSchema),
};

interface MarkedExample {
  file: string;
  schema: string;
  json: string;
  line: number;
}

const MARKER_RE = /<!--\s*valid-example\s+schema=([a-z_]+)\s*-->/i;
const FENCE_OPEN_RE = /^```json\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;

function extractMarkedExamples(
  filePath: string,
  text: string,
): MarkedExample[] {
  const lines = text.split("\n");
  const out: MarkedExample[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i]!.match(MARKER_RE);
    if (!marker) continue;
    const schema = marker[1]!;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j >= lines.length || !FENCE_OPEN_RE.test(lines[j]!.trim())) {
      throw new Error(
        `${filePath}:${i + 1}: <!-- valid-example --> marker not immediately followed by \`\`\`json fence`,
      );
    }
    const fenceStart = j + 1;
    let k = fenceStart;
    while (k < lines.length && !FENCE_CLOSE_RE.test(lines[k]!.trim())) k++;
    if (k >= lines.length) {
      throw new Error(
        `${filePath}:${j + 1}: unterminated \`\`\`json fence after valid-example marker`,
      );
    }
    out.push({
      file: filePath,
      schema,
      json: lines.slice(fenceStart, k).join("\n"),
      line: i + 1,
    });
    i = k;
  }
  return out;
}

async function collectAllExamples(): Promise<MarkedExample[]> {
  const root = join(import.meta.dir, "..", "..", "prompts");
  const files = await readdir(root);
  const all: MarkedExample[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const path = join(root, f);
    const text = await readFile(path, "utf-8");
    all.push(...extractMarkedExamples(path, text));
  }
  return all;
}

describe("prompt examples must validate against their declared schemas", () => {
  test("every <!-- valid-example schema=X --> block parses + passes safeParse", async () => {
    const examples = await collectAllExamples();
    expect(examples.length).toBeGreaterThan(0);

    const failures: Array<{
      file: string;
      line: number;
      schema: string;
      reason: string;
    }> = [];

    for (const ex of examples) {
      const schema = SCHEMAS[ex.schema];
      if (!schema) {
        failures.push({
          file: ex.file,
          line: ex.line,
          schema: ex.schema,
          reason: `unknown schema name; valid: ${Object.keys(SCHEMAS).join(", ")}`,
        });
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(ex.json);
      } catch (e) {
        failures.push({
          file: ex.file,
          line: ex.line,
          schema: ex.schema,
          reason: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      const result = schema.safeParse(json);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        failures.push({
          file: ex.file,
          line: ex.line,
          schema: ex.schema,
          reason: `schema rejected: ${issues}`,
        });
      }
    }

    if (failures.length > 0) {
      const msg = failures
        .map(
          (f) =>
            `\n  ${f.file}:${f.line} (schema=${f.schema})\n    ${f.reason}`,
        )
        .join("");
      throw new Error(
        `${failures.length} prompt example(s) failed validation:${msg}`,
      );
    }
  });

  test("at least one marked example exists for each LLM-output schema we ship", async () => {
    const examples = await collectAllExamples();
    const present = new Set(examples.map((e) => e.schema));
    const required = ["persona_findings", "memory_findings", "classified_contacts"];
    for (const r of required) {
      expect(present).toContain(r);
    }
  });

  test("relationship classifier example treats gaming profanity as register evidence", async () => {
    const file = join(
      import.meta.dir,
      "..",
      "..",
      "prompts",
      "relationship_classifier.md",
    );
    const text = await readFile(file, "utf-8");
    const example = extractMarkedExamples(file, text).find(
      (entry) => entry.schema === "classified_contacts",
    );
    expect(example).toBeDefined();

    const parsed = z
      .array(ClassifiedContactSchema)
      .parse(JSON.parse(example!.json));
    expect(parsed[0]?.label).toBe("friend");
    expect(parsed[0]?.context_tags).toContain("gaming");
    expect(parsed[0]?.register_tags).toContain("gaming_banter");
    expect(parsed[0]?.register_tags).toContain("profanity_ok");
  });
});
