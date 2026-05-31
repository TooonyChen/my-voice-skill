import { describe, expect, test } from "bun:test";
import {
  MemoryFindingsSchema,
  PersonaFindingsSchema,
} from "../../src/types/findings.ts";

const validPersona = {
  generated_at: "2026-05-31T00:00:00Z",
  source_stats_path: "exports/stats.json",
  categories: {
    lexical_fingerprint: [
      {
        claim: "uses 'lmao' as amusement marker",
        anchor: { count: 87, rate: "1 per 34 (2.9%)", denominator: 2964 },
        examples: ["lmaoo wait", "lmao ok"],
        generalizes: true,
        register_locked: null,
      },
    ],
    punctuation_and_caps: [],
    emoji: [],
    message_structure: [],
    conversational_moves: [],
    hard_donts: [],
  },
  register_table: {
    close_friend: {
      lexicon_shift: "+ bro, mate",
      punctuation_shift: "drops terminals 80%",
      emoji_shift: "rare hearts",
      length_shift: "~global",
      swear_shift: "3x global",
      n_contacts: 4,
    },
  },
};

const validMemory = {
  contact_id: "min_park_abc123",
  slug: "min-minp",
  generated_at: "2026-05-31T00:00:00Z",
  source_stats_path: "exports/per_contact_stats.json",
  address_terms: {
    from_me_to_them: [{ term: "love", count: 47, registers: ["normal"] }],
    from_them_to_me: [{ term: "Sam", count: 12, registers: ["normal"] }],
    switch_signals: [],
  },
  timeline_events: [
    { date: "2025-08-04", event: "started dating" },
  ],
  recurring_topics: [],
  inside_jokes: [],
  ongoing_threads: [],
  communication_rhythm: {
    typical_active_hours: "20:00-23:00",
    weekly_pattern: "daily",
    median_reply_latency_from_me_seconds: 240,
    median_reply_latency_from_them_seconds: 80,
    burst_pattern: "she bursts 5-9, I cluster 2-3",
    preferred_register: "relaxed" as const,
  },
  sensitivities: [],
  conflict_patterns: [],
  last_state_summary: {
    covering_messages: 50,
    date_range: ["2026-04-28", "2026-05-04"] as [string, string],
    summary: "ok",
  },
};

describe("PersonaFindingsSchema", () => {
  test("accepts a well-formed object", () => {
    expect(PersonaFindingsSchema.safeParse(validPersona).success).toBe(true);
  });

  test("rejects when a finding lacks an anchor", () => {
    const bad = JSON.parse(JSON.stringify(validPersona));
    bad.categories.lexical_fingerprint[0].anchor = undefined;
    expect(PersonaFindingsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects when an example exceeds 30 chars", () => {
    const bad = JSON.parse(JSON.stringify(validPersona));
    bad.categories.lexical_fingerprint[0].examples = [
      "x".repeat(40),
    ];
    expect(PersonaFindingsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects an unknown register-table key", () => {
    const bad = JSON.parse(JSON.stringify(validPersona));
    bad.register_table = {
      not_a_real_label: validPersona.register_table.close_friend,
    };
    expect(PersonaFindingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("MemoryFindingsSchema", () => {
  test("accepts a well-formed object", () => {
    expect(MemoryFindingsSchema.safeParse(validMemory).success).toBe(true);
  });

  test("rejects unsupported severity", () => {
    const bad = JSON.parse(JSON.stringify(validMemory));
    bad.sensitivities = [
      { topic: "x", severity: "critical", rationale: "y", last_triggered_at: null },
    ];
    expect(MemoryFindingsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects when preferred_register is invalid", () => {
    const bad = JSON.parse(JSON.stringify(validMemory));
    bad.communication_rhythm.preferred_register = "casual";
    expect(MemoryFindingsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects ongoing thread with too-long evidence_quote", () => {
    const bad = JSON.parse(JSON.stringify(validMemory));
    bad.ongoing_threads = [
      {
        thread: "x",
        last_message: "2026-05-04",
        status: "open",
        user_position: "a",
        their_position: "b",
        evidence_quote: "y".repeat(40),
      },
    ];
    expect(MemoryFindingsSchema.safeParse(bad).success).toBe(false);
  });
});
