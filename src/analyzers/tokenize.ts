import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

export type Lang = "zh" | "en" | "other";

export interface Token {
  text: string;
  lang: Lang;
}

const ZH_RE = /[一-鿿]/;
const EN_RE = /[a-zA-Z]/;

let _jieba: Jieba | null = null;
function getJieba(): Jieba {
  if (!_jieba) _jieba = Jieba.withDict(dict);
  return _jieba;
}

export function detectLang(s: string): Lang {
  if (ZH_RE.test(s)) return "zh";
  if (EN_RE.test(s)) return "en";
  return "other";
}

export function tokenize(text: string): Token[] {
  if (!text) return [];
  const segments = getJieba().cut(text, true);
  const tokens: Token[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    if (/^\s+$/.test(seg)) continue;
    if (!ZH_RE.test(seg) && !EN_RE.test(seg)) continue;
    if (/\s/.test(seg)) {
      for (const sub of seg.split(/\s+/)) {
        if (!sub) continue;
        if (!ZH_RE.test(sub) && !EN_RE.test(sub)) continue;
        const lang = detectLang(sub);
        tokens.push({ text: lang === "en" ? sub.toLowerCase() : sub, lang });
      }
    } else {
      const lang = detectLang(seg);
      tokens.push({ text: lang === "en" ? seg.toLowerCase() : seg, lang });
    }
  }
  return tokens;
}

export function bigrams(tokens: Token[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    if (a.lang === "zh" && b.lang === "zh") {
      out.push(`${a.text}${b.text}`);
    } else {
      out.push(`${a.text} ${b.text}`);
    }
  }
  return out;
}

export function hasCodeSwitch(tokens: Token[]): boolean {
  let sawEn = false;
  let sawZh = false;
  for (const t of tokens) {
    if (t.lang === "en") sawEn = true;
    if (t.lang === "zh") sawZh = true;
    if (sawEn && sawZh) return true;
  }
  return false;
}
