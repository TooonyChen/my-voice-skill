# persona_builder.md — phase 3 of `/generate-tone`

Take `exports/persona_findings.json` + `exports/stats.json` and template them into `memory/tone.md`. This pass is **templating, not analysis**. Do not introduce new claims, do not omit findings, do not reorder priorities. The structure here is the runtime contract that the agent depends on.

## Preserve before write

If `memory/tone.md` already exists, **read it first** and extract these regions verbatim:

- `## Corrections` (everything between this header and the next `##`)
- `## Manual notes` (if present)

These survive any regeneration. If you cannot preserve them, abort and tell the user.

## Section order (mandatory, do not change)

The section order encodes the runtime application priority. The agent reads from the top and earlier sections override later ones.

```
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
```

## Frontmatter

```yaml
---
generated_at: <ISO timestamp>
based_on:
  total_messages_from_me: <number>
  contacts_classified: <number>
  span_days: <number>
priority_stack: [hard_rules, identity, speech_style, emotional_patterns, interpersonal_behavior]
---
```

## Section templates

### Quick rules

6–10 imperative one-liners that the runtime applies first. Derive these from the highest-confidence findings across categories. Form: "Do X" or "Don't do Y". Examples:

- Drop terminal punctuation on short replies.
- Use lowercase by default; reserve caps for emphasis only.
- Never use em dashes.
- Default emoji density is one per ~10 messages; do not exceed unless register is `intimate_partner`.
- Code-switch CN ↔ EN freely; tech terms stay in English even inside Chinese sentences.

Cap at 10 lines.

### Lexical fingerprint

Two sub-blocks: high-frequency tokens and signature phrases.

```
**High-frequency tokens** (top 15 after stopword filter):

| Token | Count | Rate | Register lock |
|---|---|---|---|
| lmao | 87 | 1 per 34 msgs (2.9%) | none |
| love | 47 | 1 per 63 msgs | intimate_partner only |
| ... |

**Signature phrases** (3-grams that recur ≥3 times):

- `skill issue mate` (5 occurrences, all with close_friend)
- `let me confirm` (8 occurrences, mixed registers)
```

Each row must have a count. Quote examples in backticks, ≤30 chars.

### Punctuation and caps

Bulleted claims from findings. Each claim has a number.

- Drops terminal punctuation on 68% of messages.
- Uses `...` to soften, not to trail off (1 per 22 messages).
- ALL CAPS reserved for irony; 0.4% of alpha chars.
- Comma as pause more often than period (comma rate 1.4x period rate).

### Emoji

```
**Top emojis used**:

| Emoji | Count | Per message | Register lock |
|---|---|---|---|
| ❤️ | 33 | 1 per 90 | intimate_partner only |
| 😂 | 21 | 1 per 141 | close_friend, friend |
| ... |

**Density**: 1 emoji per 11 messages overall; 1 per 3 with intimate_partner.

**Never used**: 🙏 (0 occurrences), 💯 (0 occurrences).
```

### Message structure

- Median length: <N> chars.
- 72% of messages are ≤25 chars.
- Sends in bursts of 3-5 short messages within 30s rather than a single long message (avg 4.2 messages per burst, avg gap within burst 8s).
- Newline rate: <X>% of messages contain a newline.

### Conversational moves

Subheaders per move type. Each bullet has a quoted example ≤30 chars.

```
**Openings**: `yo` (close_friend), `love` (intimate), `hey` (default).
**Closings**: `gn` / `晚安` (intimate); often drops off without closing (friend, close_friend).
**Agreement**: `ye`, `true`, `fair`. Never `I concur` or `agreed`.
**Disagreement**: `nah` (soft), `idk man` (hedged), silence (frustrated).
**Gratitude**: `cheers` > `thanks` > `ty`. Almost never `thank you so much`.
**Frustration tells**: terse one-word replies, drops emoji, all lowercase.
**Humor**: self-deprecation about a recurring hobby, callbacks to inside jokes with close_friend.
```

### Register table

Render as a markdown table from `register_table` in findings. Rows = register labels that appeared. Columns = the 5 shifts.

```
| Register | Lexicon shift | Punctuation shift | Emoji shift | Length shift | Swear shift |
|---|---|---|---|---|---|
| intimate_partner | + love, miss you; − fuck | ellipsis 2x global | ❤️ 33x; 🥺 8x | +6 chars vs median | near-zero |
| close_friend | + bro, mate, lmao | drops terminals 80% | 😂 21x; rare hearts | ~global | 3x global rate |
| work_peer | formal hedging, please | complete sentences | thumbs-up only | longer, 2-3 lines | zero |
```

If a row has `n=1`, append a note: `_(based on 1 contact; treat as suggestive)_`.

### Timing and latency

- Active hours: <peak hour ranges from histogram>
- Median reply latency to incoming messages: <N> seconds (note that 5+ min latency triggers the agent; pull this from `stats.timing.median_reply_latency_seconds`).
- Late-night cluster (00:00-04:00): mostly `intimate_partner` and `close_friend`.

### Hard don'ts

Bulleted absences with anchors.

- Never uses em dashes (`—`): 0 occurrences in 2,964 messages.
- Never says `I appreciate you` or `I am here for you`: 0 occurrences.
- Never apologizes with `I'm sorry for the inconvenience`: 0 occurrences.
- Never uses bullet points in chat: 0 occurrences.
- Never opens with `Hi <Name>,`: 0 occurrences (this is email register, not chat).

### Corrections

```
This section is preserved verbatim across regenerations. the user adds rules here via `/correct`. The runtime applies these as the highest-priority overrides above everything else in this file.

<preserved verbatim from prior version, or empty>
```

## Section length caps

- Each section ≤ 60 lines.
- If a category in findings has more entries than fit, take the highest-anchor ones (highest count or rate).

## Append a changelog

At the bottom of `tone.md`, after Corrections, append:

```
---
## Changelog

- <ISO date> — <one-line summary of what changed since prior generation>
```

If this is the first generation, write `initial generation`.

## Hard rules

- Do not introduce claims that are not in `persona_findings.json`. You are templating, not analyzing.
- Do not drop a finding silently. If you cannot fit it, log it in changelog as "deferred: <claim>".
- Frequencies are expressed as both raw count and rate. Never one without the other.
- Examples must be quoted (backticks for inline) and ≤30 chars.
- Never write a section heading without populating it. If the category is empty, write `_no anchored findings_` under the heading rather than skipping the heading.
- Preserve Corrections and Manual notes verbatim.
