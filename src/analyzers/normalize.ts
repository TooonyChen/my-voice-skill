import type { Message } from "../types/message.ts";
import type { CustomPattern } from "../types/config.ts";

export interface RedactionRules {
  phone: boolean;
  email: boolean;
  address: boolean;
  secrets: boolean;
  custom_patterns?: CustomPattern[];
}

function compileCustomPattern(p: CustomPattern): RegExp {
  if (p.is_regex) {
    return new RegExp(p.pattern, p.flags);
  }
  const escaped = p.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, p.flags || "gi");
}

const PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{32,}\b/g,
];
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][A-Za-z\s]{2,40}(Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Crescent|Place|Pl|Way|Court|Ct|Highway|Hwy)\b\.?/gi;

export function redactText(text: string, rules: RedactionRules): string {
  let out = text;
  if (rules.email) out = out.replace(EMAIL_RE, "[redacted-email]");
  if (rules.phone) out = out.replace(PHONE_RE, "[redacted-phone]");
  if (rules.address) out = out.replace(ADDRESS_RE, "[redacted-address]");
  if (rules.secrets) {
    for (const re of SECRET_PATTERNS) {
      out = out.replace(re, "[redacted-secret]");
    }
  }
  if (rules.custom_patterns && rules.custom_patterns.length > 0) {
    for (const p of rules.custom_patterns) {
      out = out.replace(compileCustomPattern(p), p.replacement);
    }
  }
  return out;
}

export function normalize(
  messages: Message[],
  rules: RedactionRules,
): Message[] {
  return messages.map((m) => {
    if (m.text === null) return m;
    return { ...m, text: redactText(m.text, rules) };
  });
}
