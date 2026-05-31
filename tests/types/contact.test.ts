import { describe, expect, test } from "bun:test";
import {
  ClassifiedContactSchema,
  ContextTag,
  LabelSource,
  RegisterTag,
  slugify,
} from "../../src/types/contact.ts";

describe("ClassifiedContact label_source", () => {
  const base = {
    contact_id: "c1",
    contact_name: "C",
    username: null,
    message_count_total: 200,
    message_count_from_me: 100,
    message_count_from_them: 100,
    first_message_at: new Date(0),
    last_message_at: new Date(1000),
    span_days: 30,
    label: "close_friend" as const,
    confidence: 0.8,
    signals: [],
    alt_labels: [],
  };

  test("accepts label_source = classifier", () => {
    const ok = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "classifier",
    });
    expect(ok.success).toBe(true);
  });

  test("accepts explicit context and register tags", () => {
    const ok = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "classifier",
      context_tags: ["gaming", "tech"],
      register_tags: ["gaming_banter", "profanity_ok"],
    });
    expect(ok.success).toBe(true);
  });

  test("defaults missing context and register tags for old files", () => {
    const ok = ClassifiedContactSchema.parse({
      ...base,
      label_source: "classifier",
    });
    expect(ok.context_tags).toEqual([]);
    expect(ok.register_tags).toEqual([]);
  });

  test("rejects unknown context or register tags", () => {
    const badContext = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "classifier",
      context_tags: ["game_friend"],
      register_tags: [],
    });
    const badRegister = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "classifier",
      context_tags: [],
      register_tags: ["trash_talk"],
    });
    expect(badContext.success).toBe(false);
    expect(badRegister.success).toBe(false);
  });

  test("accepts label_source = manual_override", () => {
    const ok = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "manual_override",
    });
    expect(ok.success).toBe(true);
  });

  test("accepts label_source = correction_override", () => {
    const ok = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "correction_override",
    });
    expect(ok.success).toBe(true);
  });

  test("rejects unknown label_source value", () => {
    const bad = ClassifiedContactSchema.safeParse({
      ...base,
      label_source: "user_brain",
    });
    expect(bad.success).toBe(false);
  });

  test("requires label_source to be present", () => {
    const bad = ClassifiedContactSchema.safeParse(base);
    expect(bad.success).toBe(false);
  });

  test("LabelSource enum matches", () => {
    expect(LabelSource.options).toEqual([
      "classifier",
      "manual_override",
      "correction_override",
    ]);
  });

  test("tag enums match the supported classifier vocabulary", () => {
    expect(ContextTag.options).toEqual([
      "gaming",
      "work",
      "tech",
      "school",
      "family",
      "logistics",
      "personal_life",
      "group_chat",
    ]);
    expect(RegisterTag.options).toEqual([
      "gaming_banter",
      "profanity_ok",
      "casual_banter",
      "formal",
      "affectionate",
      "vulnerable",
      "practical_logistics",
    ]);
  });
});

describe("slugify", () => {
  test("first name + sanitized username", () => {
    expect(slugify("Min Park", "min_p")).toBe("min-minp");
  });
  test("falls back to first name when no username", () => {
    expect(slugify("Riley Tanaka", null)).toBe("riley");
  });
  test("strips punctuation", () => {
    expect(slugify("M.X. Liu", "mx-liu")).toBe("mx-mxliu");
  });
});
