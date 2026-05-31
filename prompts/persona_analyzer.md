# persona_analyzer.md — phase 2 of `/generate-tone`

Phase 1 (stats) is deterministic and already done. You are running Phase 2: the LLM extraction pass that turns `stats.json` plus message samples into structured findings. Phase 3 (`persona_builder.md`) will template those findings into `memory/tone.md`. **You are not writing tone.md in this pass.**

## Precondition gate (do this first)

1. Run `bun run src/cli/check_freshness.ts stats`. If non-zero exit, stop and tell the user to run `/stats` first.
2. Run `bun run src/cli/validate.ts global_stats exports/stats.json` and `bun run src/cli/validate.ts per_contact_stats exports/per_contact_stats.json`. If either fails, stop.
3. Run `bun run src/cli/validate.ts classified_contacts exports/contacts_classified.json`. If fails, stop and tell the user to run `/classify-contacts` first.

## Input

- `exports/stats.json` — global stats over "from me" messages
- `exports/per_contact_stats.json` — per-contact stats (for register-table)
- `exports/contacts_classified.json` — labels per contact
- Samples: `bun run src/cli/sample.ts persona --mode persona --n 800`. This runs label-quota sampling, so high-volume labels (close_friend) do not drown out low-volume labels (work_hierarchy). The output at `exports/samples/persona_pool.json` is grouped by label; iterate by label when extracting register shifts.

## Output

Write `exports/persona_findings.json` with this shape (matches `PersonaFindingsSchema` in `src/types/findings.ts`). After writing, validate:

```
bun run src/cli/validate.ts persona_findings exports/persona_findings.json
```

If validation fails, stop. The builder will not consume malformed findings.

<!-- valid-example schema=persona_findings -->
```json
{
  "generated_at": "2026-05-31T00:00:00Z",
  "source_stats_path": "exports/stats.json",
  "categories": {
    "lexical_fingerprint": [
      {
        "claim": "uses 'lmao' as default amusement marker",
        "anchor": { "count": 87, "rate": "1 per 34 messages (2.9%)", "denominator": 2964 },
        "examples": ["lmaoo wait what", "lmao ok same"],
        "generalizes": true,
        "register_locked": null
      }
    ],
    "punctuation_and_caps": [],
    "emoji": [],
    "message_structure": [],
    "conversational_moves": [],
    "hard_donts": []
  },
  "register_table": {
    "close_friend": {
      "lexicon_shift": "+ bro, mate, lmao",
      "punctuation_shift": "drops terminals 80%",
      "emoji_shift": "rare hearts",
      "length_shift": "~global",
      "swear_shift": "3x global",
      "n_contacts": 4
    }
  }
}
```

All fields shown are required by the schema. In particular: `source_stats_path` (top level) and `n_contacts` (per register entry, positive integer) are mandatory; omitting them fails validation. Allowed register labels are the values in `RelationshipLabel` from `src/types/contact.ts`. Use `null` for `register_locked` when a finding generalizes across registers; otherwise use a label string.

A `Finding` is:

```json
{
  "claim": "uses 'lmao' as default amusement marker",
  "anchor": { "count": 87, "rate": "1 per 34 messages (2.9%)", "denominator": 2964 },
  "examples": ["lmaoo wait what", "lmao ok same", "lmaooo"],
  "generalizes": true,
  "register_locked": null
}
```

- `anchor` is mandatory. If you cannot anchor a claim to a count or rate, drop it.
- `examples` are 1-3 quotes, ≤30 characters each. Truncate with `…`.
- `generalizes` = true means this pattern appears across most contacts (not just one). Compute by checking whether the term appears in the lexical stats of contacts spanning ≥2 distinct labels.
- `register_locked` = a label string when the pattern is specific to one register (e.g. swearing only with `close_friend`). Use this for emoji-with-romantic-partner, swear-with-friends, etc.

## The six categories

### 1. lexical_fingerprint

What words and phrases recur in the user's voice.

- Pull `top_words`, `top_bigrams`, `signature_phrases` from stats.
- Filter: drop stopwords (the, a, of, is, 的, 了, 是). The interesting tokens are content words and discourse markers.
- For each surviving high-count token, decide if it's a true fingerprint feature. Discourse markers (`lol`, `lmao`, `bro`, `yo`, `babe`, `like`, `tbh`) are gold. Function words are not.
- Note signature *phrases* — recurring multi-token sequences that read distinctively (e.g. "skill issue mate", "deal weekend?").

### 2. punctuation_and_caps

- Ending punctuation distribution (from `stats.punctuation.ending_punctuation`). Translate to claims: "drops terminal punctuation on 68% of messages" rather than copy-pasting the histogram.
- Caps rate as a claim: "almost never uses ALL CAPS (0.4%)" or "uses ALL CAPS for emphasis ~3% of messages".
- Ellipsis, question mark, exclamation rates.
- Special markers: trailing letters ("lmaooo"), repeated punctuation ("!!!"), comma-as-pause.

### 3. emoji

- Top emojis with raw counts and per-message rate.
- Density: claim like "1 emoji per 11 messages overall, 1 per 3 with intimate_partner".
- Register lock: which emojis appear ONLY in certain registers (hearts only with partner; thumbs-up only at work; crying-laugh everywhere).
- Notable absences: common emojis the user never uses (compare against the platform default top-50 if you have it; otherwise skip).

### 4. message_structure

- Length distribution as a claim: "median message is 14 chars; 72% are ≤25 chars".
- Burst pattern: "sends in bursts of 3-5 short messages within 30s, rather than one long message".
- Single-line vs multi-line: rate of messages containing newline.

### 5. conversational_moves

This is the hardest category and is sample-dependent. Patterns to look for in samples:

- **Openings**: how the user starts a conversation cold ("yo", "hey", "在吗", "u up").
- **Closings**: how they end ("goodnight", "晚安", "ttyl", drops off).
- **Agreement / disagreement markers**: "ye", "true", "nah", "fair", "idk man".
- **Gratitude**: "thanks", "ty", "cheers", "感谢", or absence ("never says thanks explicitly, deflects with humor").
- **Frustration tells**: short replies, dropped punctuation, switch to lowercase, "..." trails.
- **Humor moves**: self-deprecation, callbacks, exaggerated complaint, dry one-liner.
- **Self-disclosure tells**: hedging phrases ("idk why but", "not gonna lie"), late-night timing, longer messages.

Cite samples for every claim.

### 6. hard_donts

**Absence is information.** What does the user *never* do that the LLM might do by default?

- Never uses em dashes? Note it.
- Never says "I appreciate you"? Note it.
- Never apologizes formally ("I'm sorry for the delay")? Note it.
- Never uses bullet points in chat? Note it.
- Never gives unsolicited advice? Note it (harder to verify, skip if uncertain).

Each don't must be backed by a count of zero (or near-zero) in the stats, OR by an explicit comparison ("typed in 0 of 2,964 messages while AI assistants default to it ~10% of the time").

## Register table

For each `RelationshipLabel` that appears in `contacts_classified.json` with ≥2 contacts, compute the per-register shifts using `per_contact_stats.json`. Each shift is a short string comparing to the global baseline.

Example for `intimate_partner` (one row in the `register_table` map):

```json
"intimate_partner": {
  "lexicon_shift": "+ 'love' (47x), 'love you' (12x); − 'fuck' (-78% vs global)",
  "punctuation_shift": "ellipsis rate 2x global; question mark rate 1.6x global",
  "emoji_shift": "❤️ 33x (vs 0 outside this register); 🥺 8x",
  "length_shift": "median +6 chars vs global",
  "swear_shift": "near-zero with this contact",
  "n_contacts": 1
}
```

`n_contacts` is the number of classified contacts contributing to this row; it is required by the schema. When `n_contacts` is 1, the builder treats the row as suggestive rather than canonical.

## Persona stack (priority order for downstream rules)

When `persona_builder.md` writes `tone.md`, the order of sections matters. They embody a priority stack from highest to lowest:

1. **Hard rules** (Quick rules section + Hard don'ts)
2. **Identity markers** (lexical fingerprint anchors that read as "the user")
3. **Speech style** (punctuation, caps, emoji density)
4. **Emotional patterns** (conversational moves)
5. **Interpersonal behavior** (register table, latency)

In `findings.json` you do not need to flag this stack explicitly; the builder reads `categories` in this fixed order. Just ensure each category is populated correctly.

## Hard rules for this prompt

- Every finding must have an `anchor`. No anchor → drop the finding.
- Examples ≤ 30 chars, 1-3 per finding, verbatim quotes.
- Never output personality labels, MBTI, astrology, attachment style, love language, or any taxonomy of *who* the user is. Only describe *what they type*.
- If a category has fewer than 3 findings with valid anchors, leave it shorter rather than pad with weak claims.
- Do not invent the register_table for labels with zero contacts in `contacts_classified.json`. Only fill labels that exist.
- Do not modify `memory/tone.md` in this pass. Only write to `exports/persona_findings.json`.
