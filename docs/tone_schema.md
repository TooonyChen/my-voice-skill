# tone.md schema

Canonical structure for `memory/tone.md`. The runtime agent and `merger.md` rely on this layout. Any deviation breaks loading. The builder prompt (`prompts/persona_builder.md`) writes this format; the merger preserves Corrections and Manual notes verbatim across regenerations.

## File layout

```
---
generated_at: <ISO timestamp>
based_on:
  total_messages_from_me: <int>
  contacts_classified: <int>
  span_days: <int>
priority_stack: [hard_rules, identity, speech_style, emotional_patterns, interpersonal_behavior]
---

# tone.md

## Quick rules
## Lexical fingerprint
## Punctuation and caps
## Emoji
## Message structure
## Conversational moves
## Register table
## Timing and latency
## Hard don'ts
## Corrections

---
## Changelog
```

## Section semantics

### Quick rules

- 6 to 10 imperative one-liners.
- The runtime applies these first.
- Derived from highest-anchor findings only.

### Lexical fingerprint

Two sub-blocks:

1. **High-frequency tokens** — markdown table with columns: `Token | Count | Rate | Register lock`.
2. **Signature phrases** — bulleted list, each line `\`{phrase}\` ({count} occurrences{, optional register})`.

Rate format: `1 per N messages (X.Y%)`. Always both forms.

### Punctuation and caps

Bulleted claims, each anchored to a number. Order: terminal punctuation, caps rate, ellipsis, question mark, exclamation, comma.

### Emoji

1. Table: `Emoji | Count | Per message | Register lock`.
2. Density line: `**Density**: 1 emoji per {N} messages overall; 1 per {M} with {label}`.
3. Optional `**Never used**:` list (only when an explicit zero is informative).

### Message structure

Bulleted claims about length, burst pattern, newline rate.

### Conversational moves

Subheaders per move type. Allowed move types (use these names exactly):

- `Openings`
- `Closings`
- `Agreement`
- `Disagreement`
- `Gratitude`
- `Frustration tells`
- `Humor`
- `Self-disclosure tells`

Each subheader has 1-4 bulleted examples in backticks ≤30 chars.

### Register table

Markdown table. Columns (fixed order):

`Register | Lexicon shift | Punctuation shift | Emoji shift | Length shift | Swear shift`

Rows are the `RelationshipLabel` values that appeared in `contacts_classified.json` with ≥1 contact. Cells are short strings describing the shift vs the global baseline. Cells may be empty (`—`) if no shift was detected.

If a row is based on n=1 contact, append `_(n=1, suggestive)_` to the row.

### Timing and latency

Bulleted:

- Active hours peak range.
- Median reply latency in seconds (this is the threshold around which the agent decides to take over; values < 300 mean agent rarely activates).
- Late-night cluster registers (which labels appear in 00:00-04:00).

### Hard don'ts

Bulleted absences. Each line ends with `(0 occurrences in N messages)` or an explicit comparison anchor.

### Corrections

**Preserved verbatim across regenerations.** Format documented in `prompts/correction_handler.md`. Subsections may include `### Register: {label}` groupings.

### Changelog

Bottom of file. Each line: `- {ISO date} — {one-line summary}`.

## Frontmatter validation

The merger validates that frontmatter contains all required keys before merging:

- `generated_at`
- `based_on.total_messages_from_me`
- `based_on.contacts_classified`
- `based_on.span_days`
- `priority_stack` (always the literal `[hard_rules, identity, speech_style, emotional_patterns, interpersonal_behavior]`)

If frontmatter is missing or malformed, the merger aborts and asks the user.

## Runtime loading order

When the runtime agent loads `tone.md`, it parses sections in this order and applies them as a stack. Earlier sections override later ones when the runtime resolves conflicts:

1. Corrections (always wins)
2. Quick rules
3. Hard don'ts
4. Register table (selects the row matching the active contact's label)
5. Conversational moves
6. Lexical fingerprint
7. Punctuation and caps
8. Emoji
9. Message structure
10. Timing and latency

This priority order is also documented in `prompts/correction_handler.md` for cross-file priority.
