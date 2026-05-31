# memory/person/{slug}.md schema

Canonical structure for per-contact relational memory files. The runtime agent loads these files when an incoming message arrives from the contact. `memory_builder.md` writes this format; `merger.md` preserves Manual notes and Corrections verbatim.

## Slug format

`{first_name_lowercased}-{username_sanitized}`. Implemented in `src/types/contact.ts` `slugify()`.

Collision rule: if two contacts produce the same slug, append a 6-char hash of `contact_id` to disambiguate.

## File layout

```
---
contact_id: "..."
contact_name: "..."
slug: "..."
label: "<RelationshipLabel>"
classification_confidence: <0..1>
generated_at: "<ISO>"
based_on_messages: <int>
span_days: <int>
last_message_at: "<ISO>"
archived: <bool>
---

# {Contact Name}

## Snapshot
## Relationship label
## Address terms
## Timeline
## Recurring topics
## Inside jokes
## Ongoing threads ⚠️
## Communication rhythm
## Sensitivities ⚠️
## Conflict patterns
## Last state
## Manual notes
## Corrections
```

## Required sections

All sections are required. ⚠️ sections render an empty-state line (`_no <thing> recorded_`) when they have no content, but the heading must be present so the runtime knows the file is well-formed.

## Section semantics

### Snapshot

3-5 sentences of plain prose. Must be standalone-readable: a runtime that loads only this section should know who this contact is, the current rhythm, the highest-priority open thread, and any high-severity sensitivity.

This section is intentionally redundant with the structured sections below — Snapshot exists so the agent can do a fast pre-load before deciding whether to read the full file.

### Relationship label

Bold-key format:

```
**Label**: <RelationshipLabel>
**Confidence**: <0..1>
**Top alt labels**: <label> (<conf>), ...
**Source**: classifier <ISO date> | manual override from config.json
```

### Address terms

Two tables:

1. `From me | Count | Registers`
2. `From them | Count | Registers`

Followed by `**Switch signal**: <observation>` lines, only when supported by ≥3 examples.

### Timeline

Bulleted, chronological. Each line:

```
- <ISO date> — <event>  _(<short evidence>)_
```

Events without dates are not allowed.

### Recurring topics

Bulleted. Each line:

```
- <topic> — <count> mentions, register: <r>, last: <ISO date>
```

### Inside jokes

Bulleted. Each line:

```
- `<phrase>` — first seen <date>, <count> occurrences with them, <other-count> with others. Context: <short line>.
```

Cross-contact uniqueness is required (count with others < 2). If empty: `_no contact-specific jokes identified_`.

### Ongoing threads ⚠️

Each thread:

```
- **<thread title>**
  - Last message: <ISO date>
  - My position: <inferred>
  - Their position: <inferred>
  - Quote: `<≤30 chars>`
```

If a position cannot be inferred, write `position_unknown: true` instead of fabricating.

If empty: `_no open threads in the last 90 days_`.

### Communication rhythm

Bulleted:

- Typical active hours
- Weekly pattern
- Median reply latency (me / them)
- Burst pattern
- `**Preferred register**: <relaxed | conservative>` (this line is required and consumed by the runtime to decide whether to apply the conservative register modifier from agent.md)

### Sensitivities ⚠️

Each sensitivity:

```
- **<topic>** — severity: <low|medium|high> — last triggered: <ISO date | never>
  - Why flagged: <observational rationale>
  - Recent quote: `<≤30 chars>` (optional)
```

If empty: `_no sensitivities recorded_`.

The runtime checks every incoming message against this list before drafting any reply. See `memory/agent.md` for severity → action mapping.

### Conflict patterns

Bulleted. Each pattern:

```
- <observation>.
  - Observed <count> times.
  - Resolution pattern: <observation>.
```

If empty: `_no conflict patterns observed_`.

### Last state

```
**Covering**: last 50 messages, <ISO date> → <ISO date>.

<3-5 sentence summary>
```

### Manual notes

Preserved verbatim. User-authored. Used for context the analyzer cannot pick up from chat alone (off-platform conversations, things the user does not want extracted from messages directly).

### Corrections

Preserved verbatim. User-authored via `/correct --scope per-contact --target {slug}`. Format documented in `prompts/correction_handler.md`.

## Frontmatter

| Field | Type | Required | Notes |
|---|---|---|---|
| `contact_id` | string | yes | Stable per thread, sourced from parser |
| `contact_name` | string | yes | Human-readable |
| `slug` | string | yes | Matches filename |
| `label` | enum | yes | One of `RelationshipLabel` |
| `classification_confidence` | number 0..1 | yes | From classifier or 1.0 for manual override |
| `generated_at` | ISO timestamp | yes | When this file was last regenerated |
| `based_on_messages` | int | yes | Number of messages used to derive findings |
| `span_days` | int | yes | First to last message |
| `last_message_at` | ISO timestamp | yes | Most recent message timestamp in source |
| `archived` | bool | yes | If true, contact dropped below threshold; runtime should not auto-load |

## Archival flag

When the merger detects a contact below threshold in a refresh:

- Sets `archived: true`
- Adds an `## Archived` section at the top of the body (above Snapshot) with reason and date
- Does NOT delete the file

Archived files can still be loaded by the runtime if the user explicitly invokes the contact (e.g. they message you again after a long gap).

## Runtime loading order

When the runtime agent receives a message from a contact, it loads this file and parses sections in this priority order:

1. Corrections (highest, always wins)
2. Manual notes
3. Sensitivities (checked first against incoming message)
4. Ongoing threads (loaded into context to maintain continuity)
5. Communication rhythm (decides register modifier)
6. Last state (gives recent context)
7. Address terms (decides how to address the contact)
8. Inside jokes (decides if a callback is in-bounds)
9. Recurring topics (passive context)
10. Timeline (passive context)
11. Relationship label (decides escalation threshold per agent.md)
12. Conflict patterns (consulted only if sentiment is non-neutral)
13. Snapshot (used only if no specific section applied; effectively a fallback summary)

The runtime never loads more than is needed for a given message; Snapshot is the cheap pre-check before the rest.
