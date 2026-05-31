# memory_analyzer.md — phase 2 of `/generate-memory <slug>`

Run per contact. Extract structured relational findings that `memory_builder.md` will template into `memory/person/{slug}.md`.

## Precondition gate (do this first)

1. Run `bun run src/cli/check_freshness.ts stats`. If non-zero, stop and tell the user to run `/stats` first.
2. Run `bun run src/cli/validate.ts classified_contacts exports/contacts_classified.json`. If fails, stop.
3. Confirm the target contact exists in the classified file.

Input:

- Contact metadata from `exports/contacts_classified.json`
- Per-contact stats from `exports/per_contact_stats.json`
- A sample from this contact: `bun run src/cli/sample.ts <contact_id> --mode classify --n 300 --sender all`
- If the contact has more than 5,000 messages total, switch to `--mode memory` and run once per 6-month window (`--from`, `--to`), then merge per the chunking section below.

Output: `exports/memory_findings/{slug}.json`. The file must conform to `MemoryFindingsSchema` in `src/types/findings.ts`. The nine categories below are the body; they sit inside this root envelope:

<!-- valid-example schema=memory_findings -->
```json
{
  "contact_id": "min_park_abc123",
  "slug": "min-minp",
  "generated_at": "2026-05-31T00:00:00Z",
  "source_stats_path": "exports/per_contact_stats.json",
  "address_terms": {
    "from_me_to_them": [{ "term": "love", "count": 47, "registers": ["normal"] }],
    "from_them_to_me": [{ "term": "Sam", "count": 12, "registers": ["normal"] }],
    "switch_signals": []
  },
  "timeline_events": [
    { "date": "2025-08-04", "event": "started dating" }
  ],
  "recurring_topics": [],
  "inside_jokes": [],
  "ongoing_threads": [],
  "communication_rhythm": {
    "typical_active_hours": "20:00-23:00 local",
    "weekly_pattern": "daily M-F",
    "median_reply_latency_from_me_seconds": 240,
    "median_reply_latency_from_them_seconds": 80,
    "burst_pattern": "they burst 5-9 msgs; I cluster 2-3",
    "preferred_register": "relaxed"
  },
  "sensitivities": [],
  "conflict_patterns": [],
  "last_state_summary": {
    "covering_messages": 50,
    "date_range": ["2026-04-28", "2026-05-04"],
    "summary": "Recent exchanges have stayed on logistics; no active conflict."
  }
}
```

All four root fields (`contact_id`, `slug`, `generated_at`, `source_stats_path`) are required by the schema. The nine categories below describe what goes inside each of the body fields. `communication_rhythm.preferred_register` must be `relaxed` or `conservative`.

After writing, validate the output:
```
bun run src/cli/validate.ts memory_findings exports/memory_findings/{slug}.json
```
If validation fails, stop. The builder will not consume malformed findings.

## Chunking for high-volume contacts

If the contact has > 5,000 messages, do not load everything. Process in 6-month windows. For each window, extract findings. After all windows, merge:

- `timeline_events`: concatenate
- `recurring_topics`: union with counts summed
- `inside_jokes`: union with first-seen date
- `ongoing_threads`: keep only those still active (most recent window)
- `sensitivities`: take the max severity across windows
- `last_state_summary`: only from the most recent window

## The nine categories

### 1. address_terms

How the user and contact address each other.

```json
{
  "from_me_to_them": [
    { "term": "love", "count": 47, "registers": ["normal"], "first_seen": "2025-09-12" },
    { "term": "Min", "count": 6, "registers": ["serious_conversation"], "first_seen": "2025-10-03" }
  ],
  "from_them_to_me": [
    { "term": "Sam", "count": 12, "registers": ["normal"] },
    { "term": "love", "count": 39, "registers": ["normal"] }
  ],
  "switch_signals": [
    "When using full name ('Min', 'Sam Lee'): correlates with serious conversation or argument."
  ]
}
```

Capture `switch_signals` only when there is a clear, observable trigger (≥3 examples).

### 2. timeline_events

Milestones, only with a date. No vague claims.

```json
[
  { "date": "2025-08-04", "event": "started dating", "evidence": "first 'love' usage by either party" },
  { "date": "2025-10-01", "event": "Min moved abroad for residency program", "evidence": "user message: 'she lands tomorrow'" },
  { "date": "2026-03-15", "event": "first big fight", "evidence": "argument span 4 days, no terms of endearment used" }
]
```

A row without a date is excluded. Cite evidence with ≤30 char quote or a structural observation.

### 3. recurring_topics

Topics that appear ≥5 times in the sample.

```json
[
  { "topic": "Min's residency program timeline", "count": 38, "register": "serious", "last_mentioned": "2026-05-04" },
  { "topic": "climbing and weekend plans", "count": 29, "register": "casual", "last_mentioned": "2026-05-04" }
]
```

### 4. inside_jokes

Phrases or callbacks specific to this contact. Validation: appears ≥3 times in THIS contact's messages AND <2 times in any other contact's messages (cross-check `per_contact_stats.json`).

```json
[
  { "phrase": "skill issue mate", "first_seen": "2025-11-22", "count_with_them": 5, "count_with_others": 0, "context": "used after each other falls off a route at the gym" }
]
```

If unable to verify cross-contact uniqueness, skip the joke.

### 5. ongoing_threads ⚠️

Conversations from the **last 90 days** that have not reached resolution. **This is the highest-priority field for proxy safety** — the agent will lose context here first when taking over a thread.

```json
[
  {
    "thread": "deciding whether to visit them in June",
    "last_message": "2026-05-04",
    "status": "open",
    "user_position": "wants to go but waiting on climbing trip dates to clarify",
    "their_position": "wants user to commit before she books flights home",
    "evidence_quote": "let me check with the boys first ok"
  }
]
```

Open threads must have:

- `last_message` within 90 days
- `user_position` and `their_position` if they can be inferred from samples
- one `evidence_quote` ≤30 chars

If you cannot fill `user_position` and `their_position`, still include the thread but mark `position_unknown: true`.

### 6. communication_rhythm

```json
{
  "typical_active_hours": "20:00-23:00 local (intimate evening check-in)",
  "weekly_pattern": "daily contact M-F; weekends spike after dinner",
  "median_reply_latency_from_me_seconds": 240,
  "median_reply_latency_from_them_seconds": 80,
  "burst_pattern": "she sends in long bursts (5-9 msgs), I reply in clusters of 2-3",
  "preferred_register": "relaxed"
}
```

`preferred_register` is one of `relaxed | conservative` and tells the runtime whether to apply the conservative register modifier or not. Default `conservative` if uncertain.

### 7. sensitivities ⚠️

Topics that are emotionally charged with this contact. Each carries a severity.

```json
[
  {
    "topic": "her residency program extension",
    "severity": "high",
    "rationale": "every mention precedes longer thread, higher punctuation density, slower replies",
    "last_triggered_at": "2026-05-03",
    "evidence_quotes": ["i just need a date love"]
  },
  {
    "topic": "a specific family member",
    "severity": "medium",
    "rationale": "user has noted in past 'avoid this topic'",
    "last_triggered_at": null
  }
]
```

- `severity` ∈ `low | medium | high`. The runtime escalates differently per level (see `memory/agent.md`).
- `last_triggered_at` is null if not seen in the sample window; the merger updates this on each regen.
- `rationale` must be observational, not interpretive ("topic precedes longer thread", not "topic makes her anxious").

### 8. conflict_patterns

Only if a conflict pattern can be identified from samples.

```json
[
  {
    "pattern": "when user delays decision-making, contact escalates via shorter terse replies and full-name use",
    "frequency": "3 observed episodes",
    "resolution_pattern": "user commits to a date; contact downshifts within 2 hours"
  }
]
```

Leave empty if not observable. **Never fabricate conflict patterns from a single episode.**

### 9. last_state_summary

A 3-5 sentence summary of the last 50 messages between user and contact. Focus on:

- What was being discussed
- Emotional tenor
- Whether anything was left unresolved

```json
{
  "covering_messages": 50,
  "date_range": ["2026-04-28", "2026-05-04"],
  "summary": "Discussion has been mostly logistics around her placement extension. She is anxious about timing of her return; user has been supportive but non-committal about visiting in June. Last exchange ended on goodnight with no resolution on the June visit. No active conflict."
}
```

## Hard rules

- No psychology. Do not write "she is feeling abandoned", write "she has mentioned feeling left out three times this month".
- No future prediction. Do not write "she will probably ask about X". Write what's open in `ongoing_threads` instead.
- No personality summary of the contact. This is relational memory, not a profile of them.
- Quotes ≤ 30 characters.
- If a category has insufficient data, leave it empty. Do not pad.
- `inside_jokes` requires cross-contact uniqueness; otherwise skip the entry.
- `ongoing_threads` and `sensitivities` are the highest-stakes fields. If unsure, mark `confidence: "low"` rather than omit.
- Output strict JSON. The builder consumes this; bad JSON fails the pipeline.
