import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseMessengerExport } from "../../src/parsers/messenger.ts";
import {
  computeContactStats,
  DEFAULT_THRESHOLDS,
  filterContacts,
} from "../../src/analyzers/filter_contacts.ts";
import {
  computeGlobalStats,
  computePerContactStats,
} from "../../src/analyzers/stats.ts";
import { tokenize, detectLang, hasCodeSwitch } from "../../src/analyzers/tokenize.ts";
import { normalize, redactText } from "../../src/analyzers/normalize.ts";

const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures", "messenger");

describe("tokenize", () => {
  test("segments Chinese with jieba", () => {
    const tokens = tokenize("我今天去打高尔夫了");
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.every((t) => t.lang === "zh")).toBe(true);
  });

  test("segments English by word", () => {
    const tokens = tokenize("hey what's up love");
    const texts = tokens.map((t) => t.text);
    expect(texts).toContain("hey");
    expect(texts).toContain("love");
  });

  test("detects code switching", () => {
    const tokens = tokenize("babe 我 confirm 一下");
    expect(hasCodeSwitch(tokens)).toBe(true);
  });

  test("detectLang classifies", () => {
    expect(detectLang("hello")).toBe("en");
    expect(detectLang("你好")).toBe("zh");
    expect(detectLang("123!!")).toBe("other");
  });
});

describe("normalize / redaction", () => {
  test("redacts email", () => {
    expect(
      redactText("contact me at user@example.com", {
        phone: true,
        email: true,
        address: true,
        secrets: true,
      }),
    ).toContain("[redacted-email]");
  });

  test("redacts phone", () => {
    expect(
      redactText("call +64 27 123 4567", {
        phone: true,
        email: true,
        address: true,
        secrets: true,
      }),
    ).toContain("[redacted-phone]");
  });

  test("leaves benign text alone", () => {
    expect(
      redactText("just sending vibes", {
        phone: true,
        email: true,
        address: true,
        secrets: true,
      }),
    ).toBe("just sending vibes");
  });
});

describe("contact filtering", () => {
  test("computes per-contact totals correctly", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computeContactStats(messages);

    const min = stats.find((s) => s.contact_id === "min_park_abc123");
    expect(min?.message_count_total).toBe(18);
    expect(
      min!.message_count_from_me + min!.message_count_from_them,
    ).toBe(18);

    const riley = stats.find((s) => s.contact_id === "riley_tanaka_def456");
    expect(riley?.message_count_total).toBe(20);

    const casey = stats.find((s) => s.contact_id === "casey_wong_ghi789");
    expect(casey?.message_count_total).toBe(5);
  });

  test("default threshold filters all fixture contacts (small dataset)", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computeContactStats(messages);
    const passed = filterContacts(stats);
    expect(passed.length).toBe(0); // none of the fixtures hit 50/50/100
  });

  test("relaxed threshold lets the real contacts through", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computeContactStats(messages);
    const passed = filterContacts(stats, { total: 15, eachWay: 5 });
    const ids = new Set(passed.map((p) => p.contact_id));
    expect(ids.has("min_park_abc123")).toBe(true);
    expect(ids.has("riley_tanaka_def456")).toBe(true);
    expect(ids.has("casey_wong_ghi789")).toBe(false);
  });
});

describe("global stats", () => {
  test("computes lexical / punctuation / emoji / structure / timing", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computeGlobalStats(messages);

    expect(stats.total_messages).toBe(43);
    expect(stats.total_messages_from_me).toBeGreaterThan(0);
    expect(stats.total_contacts).toBe(3);

    expect(stats.stats.lexical.total_tokens).toBeGreaterThan(0);
    expect(stats.stats.lexical.top_words.length).toBeGreaterThan(0);

    // We expect some emoji from the user's messages (e.g. ❤️)
    expect(stats.stats.emoji.total_emoji_count).toBeGreaterThan(0);

    // Structure histogram has at least one bucket populated
    const histTotal = Object.values(stats.stats.structure.message_length_histogram).reduce(
      (a, b) => a + b,
      0,
    );
    expect(histTotal).toBeGreaterThan(0);

    // Hour histogram has 24 buckets and sums to messages-from-me count
    expect(stats.stats.timing.hour_histogram.length).toBe(24);
    const hourSum = stats.stats.timing.hour_histogram.reduce((a, b) => a + b, 0);
    expect(hourSum).toBe(stats.total_messages_from_me);

    // Language mix sums to ~1
    const lm = stats.stats.lexical.language_mix;
    expect(lm.en_ratio + lm.zh_ratio + lm.other_ratio).toBeCloseTo(1, 5);
  });

  test("per-contact stats are computed for each contact", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computePerContactStats(messages);
    expect(stats.length).toBe(3);
    for (const s of stats) {
      expect(s.stats.lexical).toBeDefined();
      expect(s.stats.punctuation).toBeDefined();
    }
  });

  test("Riley-only stats catch swearing rate, Casey-only stats do not", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const stats = computePerContactStats(messages);
    const riley = stats.find((s) => s.contact_id === "riley_tanaka_def456");
    const casey = stats.find((s) => s.contact_id === "casey_wong_ghi789");
    expect(riley).toBeDefined();
    expect(casey).toBeDefined();
    // The user swears in the Riley thread ("fuck", "lmaoo"); not with Casey
    expect(casey!.stats.lexical.swear_count).toBe(0);
  });
});

describe("DEFAULT_THRESHOLDS", () => {
  test("matches handoff spec (100 total, 50 each way)", () => {
    expect(DEFAULT_THRESHOLDS.total).toBe(100);
    expect(DEFAULT_THRESHOLDS.eachWay).toBe(50);
  });
});

describe("normalize on Message[]", () => {
  test("preserves message count, scrubs PII", async () => {
    const messages = await parseMessengerExport(FIXTURE_ROOT, "Sam Lee");
    const dirty = [
      ...messages,
      {
        ...messages[0]!,
        text: "ping me at user@example.com or 027-555-1234",
      },
    ];
    const cleaned = normalize(dirty, {
      phone: true,
      email: true,
      address: true,
      secrets: true,
    });
    expect(cleaned.length).toBe(dirty.length);
    expect(cleaned[cleaned.length - 1]?.text).toContain("[redacted-email]");
    expect(cleaned[cleaned.length - 1]?.text).toContain("[redacted-phone]");
  });
});
