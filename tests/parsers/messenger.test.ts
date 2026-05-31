import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  fixMojibake,
  parseMessengerExport,
  parseThreadJson,
} from "../../src/parsers/messenger.ts";

const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures", "messenger");

describe("fixMojibake", () => {
  test("decodes a known double-encoded latin-1 sequence", () => {
    expect(fixMojibake("cafÃ©")).toBe("café");
  });

  test("leaves clean UTF-8 untouched (Chinese)", () => {
    expect(fixMojibake("晚安")).toBe("晚安");
  });

  test("leaves ASCII untouched", () => {
    expect(fixMojibake("hello world")).toBe("hello world");
  });

  test("returns empty string unchanged", () => {
    expect(fixMojibake("")).toBe("");
  });

  test("does not attempt fix when string contains chars above 0xFF", () => {
    // Mixed content with non-latin-1 chars (emoji) is left alone
    const s = "hello 你好";
    expect(fixMojibake(s)).toBe(s);
  });
});

describe("parseThreadJson — Min fixture", () => {
  test("parses messages, identifies sender, applies mojibake fix", async () => {
    const file = Bun.file(
      join(FIXTURE_ROOT, "inbox/min_park_abc123/message_1.json"),
    );
    const json = await file.json();
    const parsed = parseThreadJson(json, {
      myName: "Sam Lee",
      contactIdOverride: "min_park_abc123",
    });

    expect(parsed.contactName).toBe("Min Park");
    expect(parsed.contactId).toBe("min_park_abc123");

    // 18 raw, minus 1 is_unsent minus 1 Subscribe = 16
    expect(parsed.messages.length).toBe(16);

    // Mojibake should be fixed
    const cafe = parsed.messages.find((m) => m.text?.includes("café"));
    expect(cafe).toBeDefined();
    expect(cafe?.text).toContain("café");
    expect(cafe?.text).not.toContain("cafÃ©");

    // Chinese stays clean
    const cn = parsed.messages.find((m) => m.text === "晚安");
    expect(cn).toBeDefined();
    expect(cn?.sender).toBe("me");

    // Sender mapping
    expect(parsed.messages.filter((m) => m.sender === "me").length).toBeGreaterThan(0);
    expect(parsed.messages.filter((m) => m.sender === "them").length).toBeGreaterThan(0);

    // Photo and sticker media types
    expect(parsed.messages.some((m) => m.media_type === "image")).toBe(true);
    expect(parsed.messages.some((m) => m.media_type === "sticker")).toBe(true);

    // Chronological order
    for (let i = 1; i < parsed.messages.length; i++) {
      expect(parsed.messages[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
        parsed.messages[i - 1]!.timestamp.getTime(),
      );
    }
  });

  test("filters is_unsent messages", async () => {
    const file = Bun.file(
      join(FIXTURE_ROOT, "inbox/min_park_abc123/message_1.json"),
    );
    const json = await file.json();
    const parsed = parseThreadJson(json, { myName: "Sam Lee" });
    const unsent = parsed.messages.find((m) => m.text === "should be unsent");
    expect(unsent).toBeUndefined();
  });

  test("filters Subscribe events", async () => {
    const file = Bun.file(
      join(FIXTURE_ROOT, "inbox/min_park_abc123/message_1.json"),
    );
    const json = await file.json();
    const parsed = parseThreadJson(json, { myName: "Sam Lee" });
    const subscribe = parsed.messages.find((m) =>
      m.text?.includes("added something"),
    );
    expect(subscribe).toBeUndefined();
  });
});

describe("parseMessengerExport — full export", () => {
  test("walks inbox, merges multi-file threads, sorts by contact then time", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");

    // Min: 16 (file 1) + 2 (file 2) = 18
    // Riley: 20
    // Sam: 5
    // Total: 43
    expect(messages.length).toBe(43);

    const min = messages.filter(
      (m) => m.contact_id === "min_park_abc123",
    );
    expect(min.length).toBe(18);

    const riley = messages.filter((m) => m.contact_id === "riley_tanaka_def456");
    expect(riley.length).toBe(20);

    const sam = messages.filter((m) => m.contact_id === "casey_wong_ghi789");
    expect(sam.length).toBe(5);

    // Per-contact chronological order
    for (const group of [min, riley, sam]) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
          group[i - 1]!.timestamp.getTime(),
        );
      }
    }

    // All messages have valid platform tag
    expect(messages.every((m) => m.platform === "messenger")).toBe(true);

    // Sender identification across export
    const fromMe = messages.filter((m) => m.sender === "me");
    const fromThem = messages.filter((m) => m.sender === "them");
    expect(fromMe.length + fromThem.length).toBe(messages.length);
  });

  test("preserves the 2 older messages from message_2.json", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const minOldest = messages
      .filter((m) => m.contact_id === "min_park_abc123")
      .slice(0, 2);
    // Oldest two should be the message_2.json contents
    expect(minOldest[0]?.text).toBe("hey are you up?");
    expect(minOldest[1]?.text).toBe("yeah whats up love");
  });
});
