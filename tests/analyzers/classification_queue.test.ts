import { describe, expect, test } from "bun:test";
import {
  buildClassificationTasks,
  chunkTasks,
  mergeClassifications,
  parseContactsPayload,
  resultFileName,
} from "../../src/analyzers/classification_queue.ts";
import type {
  ClassifiedContact,
  ContactStats,
  RelationshipLabel,
} from "../../src/types/contact.ts";
import type { GroupRelationshipSignal } from "../../src/types/group.ts";

function contact(contact_id: string, overrides: Partial<ContactStats> = {}): ContactStats {
  return {
    contact_id,
    contact_name: contact_id,
    username: null,
    message_count_total: 200,
    message_count_from_me: 100,
    message_count_from_them: 100,
    first_message_at: new Date("2026-01-01T00:00:00Z"),
    last_message_at: new Date("2026-01-02T00:00:00Z"),
    span_days: 1,
    ...overrides,
  };
}

function classified(
  contact_id: string,
  label: RelationshipLabel = "friend",
  label_source: ClassifiedContact["label_source"] = "classifier",
  overrides: Partial<ClassifiedContact> = {},
): ClassifiedContact {
  return {
    ...contact(contact_id),
    label,
    confidence: 0.8,
    label_source,
    context_tags: [],
    register_tags: [],
    signals: [],
    alt_labels: [],
    ...overrides,
  };
}

function groupSignal(
  contact_id: string,
  overrides: Partial<GroupRelationshipSignal> = {},
): GroupRelationshipSignal {
  return {
    contact_id,
    contact_name: contact_id,
    matched_participant_ids: [`participant-${contact_id}`],
    matched_participant_names: [contact_id],
    shared_groups: 1,
    group_message_count_from_me: 5,
    group_message_count_from_participant: 7,
    address_terms_from_me: [{ term: contact_id, count: 2 }],
    evidence_source: "group_chat",
    weight: "weak",
    ...overrides,
  };
}

describe("parseContactsPayload", () => {
  test("accepts a raw contact array and a wrapped contacts payload", () => {
    const rawContact = {
      ...contact("raw-array"),
      first_message_at: "2026-01-01T00:00:00.000Z",
      last_message_at: "2026-01-02T00:00:00.000Z",
    };

    const fromArray = parseContactsPayload([rawContact]);
    const fromWrapper = parseContactsPayload({ contacts: [rawContact] });

    expect(fromArray).toEqual(fromWrapper);
    expect(fromArray.map((entry) => entry.contact_id)).toEqual(["raw-array"]);
    expect(fromArray[0]?.first_message_at).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
  });
});

describe("resultFileName", () => {
  test("is deterministic and safe for filesystem paths", () => {
    const unsafeId = "wxid/alex@example.com";
    const first = resultFileName(unsafeId);

    expect(first).toBe("d3hpZC9hbGV4QGV4YW1wbGUuY29t.json");
    expect(resultFileName(unsafeId)).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]+\.json$/);
    expect(first).not.toContain("/");
    expect(first).not.toContain("@");
  });
});

describe("buildClassificationTasks", () => {
  test("skips classified and completed contacts and attaches matching group signals", () => {
    const matchingSignal = groupSignal("needs-classification");
    const tasks = buildClassificationTasks(
      [
        contact("already-classified"),
        contact("already-completed"),
        contact("needs-classification"),
        contact("no-signal"),
      ],
      {
        classified: [classified("already-classified")],
        completedResults: [classified("already-completed")],
        groupSignals: [groupSignal("unrelated-contact"), matchingSignal],
        resultDir: "tmp/results",
      },
    );

    expect(tasks.map((task) => task.contact.contact_id)).toEqual([
      "needs-classification",
      "no-signal",
    ]);
    expect(tasks[0]?.group_signal).toEqual(matchingSignal);
    expect(tasks[0]?.sample_command).toContain("--out");
    expect(tasks[0]?.sample_path).toBe(
      `exports/samples/classify/${resultFileName("needs-classification")}`,
    );
    expect(tasks[0]?.result_path).toBe(
      `tmp/results/${resultFileName("needs-classification")}`,
    );
    expect(tasks[1]?.group_signal).toBeNull();
  });
});

describe("chunkTasks", () => {
  test("splits tasks into numbered shards by shard size", () => {
    const tasks = buildClassificationTasks([
      contact("a"),
      contact("b"),
      contact("c"),
      contact("d"),
      contact("e"),
    ]);

    const shards = chunkTasks(tasks, 2);

    expect(shards.map((shard) => shard.shard_index)).toEqual([1, 2, 3]);
    expect(shards.map((shard) => shard.total_shards)).toEqual([3, 3, 3]);
    expect(shards.map((shard) => shard.task_count)).toEqual([2, 2, 1]);
    expect(shards[2]?.tasks.map((task) => task.contact.contact_id)).toEqual(["e"]);
  });
});

describe("mergeClassifications", () => {
  test("preserves overrides and reports missing contacts plus duplicate results", () => {
    const manual = classified("manual", "close_friend", "manual_override", {
      label_source_note: "user supplied",
    });
    const correction = classified(
      "correction",
      "family_close",
      "correction_override",
      { label_source_note: "corrected after review" },
    );

    const resultForManual = classified("manual", "work_peer");
    const resultForCorrection = classified("correction", "work_hierarchy");
    const resultForFresh = classified("fresh", "acquaintance");
    const duplicateResult = classified("duplicate-result", "friend");

    const merged = mergeClassifications(
      [contact("manual"), contact("correction"), contact("fresh"), contact("missing")],
      [manual, correction],
      [
        resultForManual,
        resultForCorrection,
        resultForFresh,
        duplicateResult,
        classified("duplicate-result", "work_peer"),
      ],
    );

    expect(merged.duplicates).toEqual(["duplicate-result"]);
    expect(merged.missing.map((entry) => entry.contact_id)).toEqual(["missing"]);
    expect(merged.merged.find((entry) => entry.contact_id === "manual")).toEqual(manual);
    expect(merged.merged.find((entry) => entry.contact_id === "correction")).toEqual(
      correction,
    );
    expect(merged.merged.find((entry) => entry.contact_id === "fresh")).toEqual(
      resultForFresh,
    );
  });
});
