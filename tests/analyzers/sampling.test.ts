import { describe, expect, test } from "bun:test";
import {
  planPersonaQuota,
  timeStratifiedSample,
  uniformStride,
} from "../../src/analyzers/sampling.ts";
import type { Message } from "../../src/types/message.ts";
import type { ClassifiedContact } from "../../src/types/contact.ts";

function msg(
  contact_id: string,
  ts: Date,
  sender: "me" | "them" = "me",
  text = "x",
): Message {
  return {
    contact_id,
    contact_name: contact_id,
    timestamp: ts,
    sender,
    text,
    media_type: "text",
    reply_to_timestamp: null,
    platform: "messenger",
  };
}

describe("uniformStride", () => {
  test("returns all when n >= length", () => {
    expect(uniformStride([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  test("returns evenly spaced subset", () => {
    const out = uniformStride([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(out.length).toBe(5);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(8);
  });
});

describe("timeStratifiedSample", () => {
  test("returns all when n >= length", () => {
    const items = [msg("a", new Date(0)), msg("a", new Date(1000))];
    expect(timeStratifiedSample(items, 10).length).toBe(2);
  });

  test("draws from each time bucket", () => {
    const items: Message[] = [];
    for (let i = 0; i < 100; i++) {
      items.push(msg("a", new Date(i * 1000)));
    }
    const sampled = timeStratifiedSample(items, 10, 5);
    expect(sampled.length).toBe(10);
    const stamps = sampled.map((m) => m.timestamp.getTime());
    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    expect(min).toBeLessThan(20_000);
    expect(max).toBeGreaterThan(80_000);
  });

  test("redistributes quota from empty buckets", () => {
    const items: Message[] = [];
    for (let i = 0; i < 30; i++) items.push(msg("a", new Date(i * 1000)));
    for (let i = 0; i < 30; i++) items.push(msg("a", new Date((i + 1000) * 1000)));
    const sampled = timeStratifiedSample(items, 25, 5);
    expect(sampled.length).toBe(25);
  });

  test("output is sorted chronologically", () => {
    const items: Message[] = [];
    for (let i = 0; i < 100; i++) items.push(msg("a", new Date(i * 1000)));
    const sampled = timeStratifiedSample(items, 20, 5);
    for (let i = 1; i < sampled.length; i++) {
      expect(sampled[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
        sampled[i - 1]!.timestamp.getTime(),
      );
    }
  });
});

function classified(contact_id: string, label: ClassifiedContact["label"]): ClassifiedContact {
  return {
    contact_id,
    contact_name: contact_id,
    username: null,
    message_count_total: 200,
    message_count_from_me: 100,
    message_count_from_them: 100,
    first_message_at: new Date(0),
    last_message_at: new Date(1000),
    span_days: 30,
    label,
    confidence: 0.8,
    label_source: "classifier",
    signals: [],
    alt_labels: [],
  };
}

describe("planPersonaQuota", () => {
  test("distributes total evenly across labels", () => {
    const plan = planPersonaQuota(
      [
        classified("a", "intimate_partner"),
        classified("b", "close_friend"),
        classified("c", "work_peer"),
      ],
      300,
    );
    expect(Object.keys(plan.per_label).length).toBe(3);
    expect(Object.values(plan.per_label).map((p) => p.quota).reduce((a, b) => a + b, 0)).toBe(300);
  });

  test("a label with more contacts splits its quota across them", () => {
    const plan = planPersonaQuota(
      [
        classified("a1", "close_friend"),
        classified("a2", "close_friend"),
        classified("a3", "close_friend"),
        classified("b1", "work_peer"),
      ],
      80,
    );
    expect(plan.per_label["close_friend"]!.quota).toBe(40);
    expect(plan.per_label["work_peer"]!.quota).toBe(40);
    const closeFriendContacts = plan.per_label["close_friend"]!.contact_ids;
    let totalCloseFriend = 0;
    for (const id of closeFriendContacts) {
      totalCloseFriend += plan.per_contact[id]!.quota;
    }
    expect(totalCloseFriend).toBe(40);
  });

  test("low-volume label still gets its share (no volume bias)", () => {
    const plan = planPersonaQuota(
      [
        classified("popular_friend_1", "close_friend"),
        classified("popular_friend_2", "close_friend"),
        classified("popular_friend_3", "close_friend"),
        classified("boss", "work_hierarchy"),
      ],
      200,
    );
    expect(plan.per_label["close_friend"]!.quota).toBe(100);
    expect(plan.per_label["work_hierarchy"]!.quota).toBe(100);
  });

  test("empty input returns empty plan", () => {
    const plan = planPersonaQuota([], 200);
    expect(plan.total_requested).toBe(200);
    expect(Object.keys(plan.per_label).length).toBe(0);
  });
});
