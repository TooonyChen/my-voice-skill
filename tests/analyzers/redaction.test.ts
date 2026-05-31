import { describe, expect, test } from "bun:test";
import { redactText } from "../../src/analyzers/normalize.ts";
import type { CustomPattern } from "../../src/types/config.ts";

const baseRules = {
  phone: true,
  email: true,
  address: true,
  secrets: true,
};

function mkPattern(
  pattern: string,
  is_regex = false,
  replacement = "[REDACTED]",
): CustomPattern {
  return {
    pattern,
    is_regex,
    flags: "gi",
    replacement,
    added_at: new Date().toISOString(),
    source: "test",
  };
}

describe("custom_patterns", () => {
  test("plain string pattern is matched literally", () => {
    const out = redactText("hey check 12 Cherry Lane", {
      ...baseRules,
      address: false,
      custom_patterns: [mkPattern("Cherry Lane", false, "[X]")],
    });
    expect(out).toContain("[X]");
  });

  test("regex pattern with --regex semantics is applied", () => {
    const out = redactText("tracking id ABC-1234 then ABC-9999", {
      ...baseRules,
      custom_patterns: [mkPattern("ABC-\\d{4}", true, "[ID]")],
    });
    expect(out).toContain("[ID]");
    expect(out).not.toContain("ABC-1234");
    expect(out).not.toContain("ABC-9999");
  });

  test("multiple patterns apply in order", () => {
    const out = redactText("foo bar baz", {
      ...baseRules,
      custom_patterns: [
        mkPattern("foo", false, "X"),
        mkPattern("baz", false, "Z"),
      ],
    });
    expect(out).toBe("X bar Z");
  });

  test("plain pattern with regex special chars is escaped", () => {
    const out = redactText("price $1.99 here", {
      ...baseRules,
      custom_patterns: [mkPattern("$1.99", false, "[REDACTED_PRICE]")],
    });
    expect(out).toContain("[REDACTED_PRICE]");
    expect(out).not.toContain("$1.99");
  });

  test("case-insensitive by default", () => {
    const out = redactText("HELLO world Hello world", {
      ...baseRules,
      custom_patterns: [mkPattern("hello", false, "X")],
    });
    expect(out.match(/X/g)?.length).toBe(2);
  });

  test("built-in patterns still run even with custom patterns", () => {
    const out = redactText("call +64 27 123 4567 about Cherry Lane", {
      ...baseRules,
      address: false,
      custom_patterns: [mkPattern("Cherry Lane", false)],
    });
    expect(out).toContain("[redacted-phone]");
    expect(out).toContain("[REDACTED]");
  });
});
