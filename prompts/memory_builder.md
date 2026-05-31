# memory_builder.md — phase 3 of `/generate-memory <slug>`

Take `exports/memory_findings/{slug}.json` and template it into `memory/person/{slug}.md`. Templating, not analysis.

## Filename derivation

`{slug}` = `{first_name_lowercased}-{username_sanitized}`. Use `slugify()` in `src/types/contact.ts`.

Example: contact name "Min Park" with username `min_p` → `min-minp.md`.

If two contacts collide on slug, append a short hash of their `contact_id` to disambiguate.

## Preserve before write

If `memory/person/{slug}.md` already exists:

1. Read the file.
2. Extract verbatim:
   - `## Manual notes` (entire section including subheadings)
   - `## Corrections` (entire section)
3. Hold these for re-insertion. Never overwrite them.
4. If the file has a `archived: true` frontmatter flag, abort and ask the user (the user has explicitly archived this contact).

## Section order (mandatory)

```
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

Sections marked ⚠️ are **always rendered** even if empty, because the runtime checks them on every message. An empty Sensitivities section reads as `_no sensitivities recorded_`, not omitted.

## Frontmatter

```yaml
---
contact_id: "..."
contact_name: "..."
slug: "..."
label: "intimate_partner"
classification_confidence: 0.85
generated_at: "<ISO>"
based_on_messages: 1247
span_days: 287
last_message_at: "<ISO>"
archived: false
---
```

## Snapshot (loaded independently by runtime)

The runtime sometimes loads ONLY the Snapshot section to make a fast pre-check before deciding whether to load the full file. Snapshot must be self-contained: a reader who sees only this section should know who this is, what the label is, the active stakes, and any high-severity sensitivities.

Format:

```
3-5 sentences. Plain prose. No bullets.

Sentence 1: who this is, label, message volume, span.
Sentence 2: current communication rhythm in one line.
Sentence 3: highest-priority ongoing thread (one).
Sentence 4: any high-severity sensitivity in one line.
Sentence 5 (optional): one notable register lock or hard-don't for this contact.
```

Example:

```
Min Park, intimate partner, 1,247 messages over 287 days, daily contact since August 2025. Usual rhythm is an evening check-in 20:00-23:00 local time (with allowance for their timezone offset), reply latency from me averages 4 minutes, from them under 90 seconds. Active open thread: whether I will visit them in June, they are waiting on my commitment before booking their return flights. High-severity sensitivity: any framing of their residency program that questions its value or timeline. Register is relaxed: pet names default, swearing is near-zero with them even though it appears with close friends.
```

## Section content templates

### Relationship label

```
**Label**: intimate_partner
**Confidence**: 0.85
**Top alt labels**: close_friend (0.10), friend (0.04)
**Source**: classifier 2026-05-04 (or `manual override from config.json` if applicable)
```

### Address terms

Render two columns (me → them, them → me) as a small table. Include switch signals at the bottom.

```
| From me | Count | Registers |
|---|---|---|
| love | 47 | normal |
| Min | 6 | serious_conversation |

| From them | Count | Registers |
|---|---|---|
| Sam | 12 | normal |
| love | 39 | normal |

**Switch signal**: Use of full name correlates with serious conversation or argument.
```

### Timeline

Bulleted, chronological. Each item has a date and evidence note.

```
- 2025-08-04 — started dating  _(first 'love' usage by either party)_
- 2025-10-01 — Min moved to Berlin for residency program
- 2026-03-15 — first big fight, 4-day cooldown
```

### Recurring topics

```
- Min's residency program timeline — 38 mentions, register: serious, last: 2026-05-04
- Golf and weekend plans — 29 mentions, register: casual, last: 2026-05-04
```

### Inside jokes

Bulleted, each with first-seen date and a one-line context.

```
- `skill issue mate` — first seen 2025-11-22, 5 occurrences with her. Used after either of us misses a shot in climbing.
```

If empty: `_no contact-specific jokes identified_`.

### Ongoing threads ⚠️

Always render this heading, even if empty.

```
> **Open threads matter most for proxy safety.** The runtime should load this section before any reply.

- **Deciding whether to visit her in Berlin in June**
  - Last message: 2026-05-04
  - My position: wants to go but waiting on climbing trip dates
  - Her position: wants me to commit before booking flights
  - Quote: `let me check with the boys first ok`
```

If empty: `_no open threads in the last 90 days_`.

### Communication rhythm

```
- Typical active hours: 20:00-23:00 local
- Weekly pattern: daily M-F, weekends spike after dinner
- Median reply latency: me 4m, them 1m20s
- Burst pattern: she bursts 5-9 msgs, I cluster 2-3
- **Preferred register**: relaxed
```

The `Preferred register` line is critical. The runtime uses it to decide whether to apply the conservative register modifier. Allowed values: `relaxed | conservative`.

### Sensitivities ⚠️

Always render. If empty: `_no sensitivities recorded_`.

```
> **The runtime checks every incoming message against this list before drafting.** See `agent.md` for the severity → action mapping.

- **Her residency program extension** — severity: high — last triggered: 2026-05-03
  - Why flagged: every mention precedes longer thread, higher punctuation density, slower replies.
  - Recent quote: `i just need a date love`
- **Their relationship with a specific family member** — severity: medium — last triggered: never (in sample)
  - Why flagged: user added a manual note asking to avoid the topic
```

### Conflict patterns

```
- When I delay decision-making, she escalates with shorter terse replies and full-name use.
  - Observed 3 times.
  - Resolution pattern: I commit to a date; she downshifts within 2 hours.
```

If empty: `_no conflict patterns observed_`.

### Last state

```
**Covering**: last 50 messages, 2026-04-28 → 2026-05-04.

Discussion has been mostly logistics around her placement extension. She is anxious about timing of her return; I have been supportive but non-committal about visiting in June. Last exchange ended on goodnight with no resolution on the June visit. No active conflict.
```

### Manual notes

```
This section is preserved verbatim across all regenerations. Add private context that the analyzer would not pick up from chat alone (off-platform conversations, things you do not want the LLM to extract directly from messages).

<preserved verbatim from prior version, or empty>
```

### Corrections

```
This section is preserved verbatim across all regenerations. the user adds rules here via `/correct` with `--scope per-contact --target {slug}`. The runtime applies these as the highest-priority overrides for this contact.

<preserved verbatim from prior version, or empty>
```

## Update `_index.md`

After writing `{slug}.md`, regenerate `memory/person/_index.md`. The index is a table of contacts:

```
# Contact index

Generated: <ISO>

| Slug | Name | Label | Confidence | Msgs | Span | Last msg | High-severity sensitivities |
|---|---|---|---|---|---|---|---|
| min-minp | Min Park | intimate_partner | 0.85 | 1247 | 287d | 2026-05-04 | residency program extension |
| riley-rileytan | Riley Tanaka | close_friend | 0.78 | 412 | 467d | 2026-05-04 | (none) |
```

Sort by `last_msg` descending.

## Hard rules

- Preserve `## Manual notes` and `## Corrections` verbatim. If you cannot, abort.
- Render ⚠️ sections even when empty.
- Do not introduce claims not present in the findings JSON.
- Quotes ≤ 30 characters, backticked.
- The Snapshot must be standalone-readable. A runtime that loads only Snapshot must have enough to decide whether to escalate on a hot topic.
- Slug derivation must be deterministic. If a contact has a slug collision with another, append a short hash.
