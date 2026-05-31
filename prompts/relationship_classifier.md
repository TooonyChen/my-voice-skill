# relationship_classifier.md — `/classify-contacts`

## Precondition gate (do this first, every run)

Before any classification:

1. Run `bun run src/cli/check_freshness.ts stats`. If the script exits non-zero, stop and tell the user to run `/stats` first. Do not proceed.
2. Run `bun run src/cli/validate.ts global_stats exports/stats.json` and `bun run src/cli/validate.ts per_contact_stats exports/per_contact_stats.json`. If either fails, stop and report.
3. If `exports/contacts_classified.json` already exists, load it. For any contact with `label_source` in `{"manual_override", "correction_override"}`, **skip re-classification and preserve the existing record verbatim** — even if the new run would compute a different label. This is the protection against /update silently reverting user corrections.
4. If `exports/normalized/group_messages.jsonl` exists, run `bun run src/cli/check_freshness.ts groups`. If non-zero, stop and tell the user to refresh the group side-channel commands.
5. Run `bun run src/cli/classify_progress.ts --next 20`. If it reports `0 remaining`, validate `exports/contacts_classified.json`, print the label summary, and stop.

For each remaining contact in `exports/contacts_passed.json`, classify the relationship into one of nine labels. The final aggregate must be `exports/contacts_classified.json`, an array of objects matching the `ClassifiedContact` schema (see `src/types/contact.ts`).

## Execution protocol

This command is a full-loop workflow, not a one-contact task.

1. Treat `exports/contacts_passed.json` as the source of truth. It may be either a raw array or an object with a `contacts` array; use the contacts array.
2. Build the work queue with `bun run src/cli/classify_plan.ts --shard-size 5`. This writes `exports/classification_tasks/manifest.json` and `shard_*.json`.
3. If subagent tooling is available, run a bounded worker pool. Start 4-8 subagents at a time unless the host gives a stricter limit, assign one shard file per worker, wait for completion, then assign the next shard. Do not spawn unlimited workers blindly.
4. If subagent tooling is not available, process the shard files sequentially in the main agent. Use the exact same worker contract below.
5. Worker contract: a worker reads one shard JSON, iterates all `tasks`, runs `task.sample_command`, reads `task.sample_path`, reads matching per-contact stats and the optional `task.group_signal`, then writes exactly one `ClassifiedContact` object to each `task.result_path`. After each write, run `bun run src/cli/validate.ts classified_contact <task.result_path>`.
6. Workers must not edit `exports/contacts_classified.json`. This avoids concurrent writes to the aggregate file.
7. The coordinator runs `bun run src/cli/classify_merge.ts` after a batch of workers finishes. This preserves existing `manual_override` and `correction_override` entries and merges all per-contact result files.
8. The coordinator then runs `bun run src/cli/validate.ts classified_contacts exports/contacts_classified.json` and `bun run src/cli/classify_progress.ts --next 10`.
9. If contacts remain, run `bun run src/cli/classify_plan.ts --shard-size 5` again and continue. Do not ask the user for confirmation between batches.
10. You may stop early only if context budget is genuinely too low. If that happens, leave valid per-contact result files and a valid partial `exports/contacts_classified.json` on disk, then report the exact remaining count from `classify_progress`; do not say classification is complete.
11. Before final completion, run `bun run src/cli/classify_merge.ts --require-all` and `bun run src/cli/classify_progress.ts --fail-if-remaining`. If either exits non-zero, continue classifying remaining contacts instead of finalizing.

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
| 3 | **Private-life evidence** | Vulnerability, offline meetups, family/emotion/life-decision discussion, or sustained care outside the main activity context. Required before upgrading a casual friendship to `close_friend`. | strong |
| 4 | **Emoji type and frequency** | Hearts and crying-laugh in intimate; thumbs-up and handshake in work; few or none in formal. | medium |
| 5 | **Language switching** (CN ↔ EN, Cantonese, etc.) | Code-switching indicates shared linguistic intimacy; absence in CN speaker = work or new contact. | medium |
| 6 | **Time-of-day distribution** | Late-night messaging (00:00–04:00) clusters with intimate / close-friend. Strict 09:00–18:00 weekdays = work. | medium |
| 7 | **Topic mix** | Family-specific (mom's health), work-specific (deadlines, deliverables), planning, vulnerable disclosure. | weak |
| 8 | **Formality / register** | Hedged requests, complete sentences, "please/thank you" frequency. | weak |
| 9 | **Swear rate in context** | Profanity is register evidence, not intimacy evidence. If profanity clusters around gaming/group banter terms, record `gaming_banter` / `profanity_ok` and do not use it to raise the relationship label. | weak |

## Decision rule

- Confidence **> 0.7** requires at least 2 strong signals OR at least 3 medium signals, all citing evidence.
- `intimate_partner` REQUIRES at least one terms-of-address signal (strong). Without it, fall back to `close_friend` or `unclassified`.
- `close_friend` REQUIRES private-life evidence: vulnerability, offline meetups, ongoing personal-life updates, family/emotion/life-decision discussion, or sustained non-gaming/non-work care. High volume, casual banter, late-night gaming, and profanity are not enough.
- If gaming terms dominate the topic profile or sample and profanity appears mainly near gaming terms (e.g. game, queue, match, role, voice, win/loss, rank, 开黑), classify the profanity as register/context evidence: add `context_tags: ["gaming"]` and `register_tags` including `gaming_banter` and `profanity_ok`. Do not treat that profanity as a `close_friend` signal.
- If the main evidence is gaming frequency plus profanity, the label ceiling is `friend` unless there is separate private-life evidence.
- If the conversation spans **< 30 days**, cap confidence at **0.5** regardless of signal strength. Too short to know.
- If the contact appears in `config.json` `manual_hints`, use that label with confidence 1.0, set `label_source: "manual_override"`, and note the override in `signals` as `{type: "manual_override", evidence: "from intake or /correct", weight: "strong"}`. For all other contacts, set `label_source: "classifier"`.
- If signals split between two labels and you cannot decide, emit `unclassified` with the top two candidates in `alt_labels`.

## Input

For each contact:

1. Load `exports/contacts_passed.json` for the metadata.
2. In sharded mode, run `task.sample_command`; otherwise run `bun run src/cli/sample.ts <contact_id> --mode classify --n 200`. This outputs all text for small contacts (≤30k total text chars by default) and topic-aware + time-stratified samples for larger contacts.
3. In sharded mode, read `task.sample_path`; otherwise read the sample file produced at `exports/samples/<contact_id>.json`. Use its `sample_strategy`, `total_chars`, and `topic_profile` fields when deciding whether the sample is full or topic-balanced.
4. Read `exports/per_contact_stats.json` and find this contact's stats.
5. Optional: if `exports/group_relationship_signals.json` exists, validate it with `bun run src/cli/validate.ts group_relationship_signals exports/group_relationship_signals.json` and read only the signal matching this contact.

Group signals are weak evidence. They can support labels like `work_peer`, `friend`, or `acquaintance` when private evidence is ambiguous, but they cannot alone establish `intimate_partner`, `family_close`, or `close_friend`. If a label depends mainly on group signals, cap confidence at 0.5 and include a signal with `type: "group_chat_weak_signal"`.

## Output schema (per contact)

For prompt validation, the example below is wrapped in the final aggregate array. A per-contact worker result file contains just the object inside the array.

<!-- valid-example schema=classified_contacts -->
```json
[
  {
    "contact_id": "wxid_game_friend",
    "contact_name": "Badu",
    "username": null,
    "message_count_total": 2253,
    "message_count_from_me": 899,
    "message_count_from_them": 1354,
    "first_message_at": "2024-06-08T17:14:22Z",
    "last_message_at": "2026-05-21T12:37:26Z",
    "span_days": 712,
    "label": "friend",
    "confidence": 0.78,
    "label_source": "classifier",
    "label_source_note": null,
    "context_tags": ["gaming"],
    "register_tags": ["gaming_banter", "profanity_ok", "casual_banter"],
    "signals": [
      { "type": "topic_profile", "evidence": "gaming terms dominate: rank, steam, 开黑", "weight": "medium" },
      { "type": "swear_context", "evidence": "profanity appears in match/queue banter", "weight": "weak" },
      { "type": "private_life_absent", "evidence": "no clear vulnerability/offline-life evidence", "weight": "weak" }
    ],
    "alt_labels": [
      { "label": "close_friend", "confidence": 0.18 }
    ]
  }
]
```

`label_source_note` is optional and may be `null` (use a string when `label_source` is `manual_override` or `correction_override` to record where the override came from).
`context_tags` and `register_tags` are required in new worker outputs. Use `[]` when there is no clear tag evidence; do not invent tags outside the schema.

In sharded mode, write each contact object to its assigned `task.result_path`; then the coordinator aggregates them into `exports/contacts_classified.json` with `bun run src/cli/classify_merge.ts`.

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
- Swear rate cannot by itself raise a contact to `close_friend`. Always classify profanity by surrounding context first.
- Quote evidence ≤ 60 characters. Truncate longer quotes with `…`.
