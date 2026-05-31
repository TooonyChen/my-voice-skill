# relationship_classifier.md — `/classify-contacts`

## Precondition gate (do this first, every run)

Before any classification:

1. Run `bun run src/cli/check_freshness.ts stats`. If the script exits non-zero, stop and tell the user to run `/stats` first. Do not proceed.
2. Run `bun run src/cli/validate.ts global_stats exports/stats.json` and `bun run src/cli/validate.ts per_contact_stats exports/per_contact_stats.json`. If either fails, stop and report.
3. If `exports/contacts_classified.json` already exists, load it. For any contact with `label_source` in `{"manual_override", "correction_override"}`, **skip re-classification and preserve the existing record verbatim** — even if the new run would compute a different label. This is the protection against /update silently reverting user corrections.
4. If `exports/normalized/group_messages.jsonl` exists, run `bun run src/cli/check_freshness.ts groups`. If non-zero, stop and tell the user to refresh the group side-channel commands.

For each remaining contact in `exports/contacts_passed.json`, classify the relationship into one of nine labels. Process contacts one at a time. Write the result to `exports/contacts_classified.json` as an array of objects matching the `ClassifiedContact` schema (see `src/types/contact.ts`).

## Labels

| Label | Meaning |
|---|---|
| `intimate_partner` | Romantic partner. Must show terms of endearment, daily check-ins, life-coordination conversations. |
| `family_close` | Parents, siblings, primary caregivers. Frequent contact, low formality, family-specific topics. |
| `family_extended` | Aunts, uncles, cousins, grandparents. Lower frequency than close family, mixed formality. |
| `close_friend` | Years of history, casual register, inside jokes, willingness to share vulnerable content. |
| `friend` | Friendly but lower intimacy. Plans, banter, no deep self-disclosure. |
| `work_peer` | Coworker at similar level. Mixed casual/professional register. |
| `work_hierarchy` | Manager, report, senior leader, mentor with formal asymmetry. Professional register dominant. |
| `acquaintance` | Knows the user but limited shared context. Transactional or occasional. |
| `unclassified` | Cannot determine with sufficient confidence. |

## Signal weights (importance order)

For each contact, evaluate these signals against the sample. Cite specific evidence for each one you fire on.

| # | Signal | Why it matters | Weight |
|---|---|---|---|
| 1 | **Terms of address** (love, honey, mom, dad, 老婆, 爸, boss, sir, first-name only, full name) | Single highest-information signal. Specific terms map cleanly to specific labels. | strong |
| 2 | **Goodnight / good morning rituals** | Daily check-ins are a marker of intimate or close-family relationships. | strong |
| 3 | **Swear rate** | High swear rate = close friend / intimate partner; near-zero = work or acquaintance. | medium |
| 4 | **Emoji type and frequency** | Hearts and crying-laugh in intimate; thumbs-up and handshake in work; few or none in formal. | medium |
| 5 | **Language switching** (CN ↔ EN, Cantonese, etc.) | Code-switching indicates shared linguistic intimacy; absence in CN speaker = work or new contact. | medium |
| 6 | **Time-of-day distribution** | Late-night messaging (00:00–04:00) clusters with intimate / close-friend. Strict 09:00–18:00 weekdays = work. | medium |
| 7 | **Topic mix** | Family-specific (mom's health), work-specific (deadlines, deliverables), planning, vulnerable disclosure. | weak |
| 8 | **Formality / register** | Hedged requests, complete sentences, "please/thank you" frequency. | weak |

## Decision rule

- Confidence **> 0.7** requires at least 2 strong signals OR at least 3 medium signals, all citing evidence.
- `intimate_partner` REQUIRES at least one terms-of-address signal (strong). Without it, fall back to `close_friend` or `unclassified`.
- If the conversation spans **< 30 days**, cap confidence at **0.5** regardless of signal strength. Too short to know.
- If the contact appears in `config.json` `manual_hints`, use that label with confidence 1.0, set `label_source: "manual_override"`, and note the override in `signals` as `{type: "manual_override", evidence: "from intake or /correct", weight: "strong"}`. For all other contacts, set `label_source: "classifier"`.
- If signals split between two labels and you cannot decide, emit `unclassified` with the top two candidates in `alt_labels`.

## Input

For each contact:

1. Load `exports/contacts_passed.json` for the metadata.
2. Run `bun run src/cli/sample.ts <contact_id> --mode classify --n 200`. This produces time-stratified samples across 5 equal time slices, ensuring register diversity even when activity clumps.
3. Read the sample file produced at `exports/samples/<contact_id>.json`.
4. Read `exports/per_contact_stats.json` and find this contact's stats.
5. Optional: if `exports/group_relationship_signals.json` exists, validate it with `bun run src/cli/validate.ts group_relationship_signals exports/group_relationship_signals.json` and read only the signal matching this contact.

Group signals are weak evidence. They can support labels like `work_peer`, `friend`, or `acquaintance` when private evidence is ambiguous, but they cannot alone establish `intimate_partner`, `family_close`, or `close_friend`. If a label depends mainly on group signals, cap confidence at 0.5 and include a signal with `type: "group_chat_weak_signal"`.

## Output schema (per contact)

The full file is a JSON array. One entry per contact looks like this:

<!-- valid-example schema=classified_contacts -->
```json
[
  {
    "contact_id": "min_park_abc123",
    "contact_name": "Min Park",
    "username": null,
    "message_count_total": 1247,
    "message_count_from_me": 612,
    "message_count_from_them": 635,
    "first_message_at": "2025-08-04T12:00:00Z",
    "last_message_at": "2026-05-04T20:30:00Z",
    "span_days": 273,
    "label": "intimate_partner",
    "confidence": 0.85,
    "label_source": "classifier",
    "label_source_note": null,
    "signals": [
      { "type": "address_term", "evidence": "\"love\" used 47x by me; \"honey\" 23x by them", "weight": "strong" },
      { "type": "goodnight_ritual", "evidence": "\"晚安\" exchanges on 42 of 67 active days", "weight": "strong" }
    ],
    "alt_labels": [
      { "label": "close_friend", "confidence": 0.10 }
    ]
  }
]
```

`label_source_note` is optional and may be `null` (use a string when `label_source` is `manual_override` or `correction_override` to record where the override came from).

Aggregate all contact objects into `exports/contacts_classified.json` as an array.

After writing, validate the output:
```
bun run src/cli/validate.ts classified_contacts exports/contacts_classified.json
```
If validation fails, stop and report. Do not proceed to /generate-tone or /generate-memory with malformed classifications.

Then print a summary table to the user: `label | count | manual_override_count` so they can spot mislabels.

## Hard rules

- Cite specific evidence with counts, not vibes. "Feels intimate" is not a signal.
- Never classify based on the contact's name alone (e.g. assuming "Mom" → family_close). The name might be sarcastic or a nickname.
- Manual overrides from `config.json` are absolute. Do not second-guess them.
- If a contact has near-zero signal on every axis, `unclassified` is the correct answer. Do not force a label.
- Quote evidence ≤ 60 characters. Truncate longer quotes with `…`.
