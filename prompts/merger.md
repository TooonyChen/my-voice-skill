# merger.md — `/update [--since DATE]`

Run after `/parse → /stats → /filter → /classify-contacts → /generate-tone → /generate-all-memories` on fresh data. Reconcile the freshly generated outputs with the prior versions instead of overwriting.

## Critical pre-classify rule (read before doing anything else)

Before re-classification runs in `/update`, load the existing `exports/contacts_classified.json`. For every contact with `label_source ∈ {"manual_override", "correction_override"}`:

- Skip re-classification entirely. Carry the existing classified record into the new `contacts_classified.json` verbatim.
- These labels exist because the user (or correction_handler) explicitly set them. The classifier must not second-guess them.
- The drift report still notes "<slug> label preserved by source=<source>" for the audit trail.

If the classifier somehow produces a different label for a manual-override contact in the new run (e.g. the classifier was invoked directly without checking), the merger overrides it back to the existing label and flags this as `integrity_violation` in the drift report. Roll back the run if this happens more than 5% of contacts (probable classifier prompt drift).

Inputs (newly generated, freshly written to disk by the regen pass):

- `memory/tone.md` (just rewritten by `persona_builder.md`)
- `memory/person/*.md` (just rewritten by `memory_builder.md`)

Inputs (prior versions, MUST be captured before the regen pass overwrites them; in practice the persona_builder and memory_builder steps already do this preservation for Corrections/Manual notes, but the merger handles the deeper drift):

- Git diff of prior vs new versions, OR a snapshot from `docs/drift/_pre_merge_snapshot/`

If you find that prior versions were not preserved (Corrections section missing, Manual notes lost), abort and tell the user to `git restore memory/` before re-running.

## Per-section merge strategy

| Section | Strategy | Why |
|---|---|---|
| Quick rules | Full replace | Derived deterministically from highest-anchor findings; stale rules should go. |
| Lexical fingerprint | Full replace | Stats are authoritative. |
| Punctuation and caps | Full replace | Stats are authoritative. |
| Emoji | Full replace | Stats are authoritative. |
| Message structure | Full replace | Stats are authoritative. |
| Conversational moves | Full replace | Sample-derived; replace each regen. |
| Register table | Full replace | Stats are authoritative. |
| Timing and latency | Full replace | Stats are authoritative. |
| Hard don'ts | Append + dedupe | New "never used" entries add to the list; old ones don't get removed unless explicitly contradicted. |
| Corrections | Preserve verbatim | User-authored. Never modified by merger. |
| Manual notes | Preserve verbatim | User-authored. Never modified by merger. |
| Address terms | Full replace | Counts are stats-derived. |
| Timeline | Append + dedupe | Events are immutable history; new events add but don't replace. |
| Recurring topics | Full replace | Stats-derived. |
| Inside jokes | Append + dedupe | Once a joke is recorded, it stays until manually removed. Old jokes may degrade in usage but the runtime can still recognize them. |
| Ongoing threads | Resolve-aware diff | See below. |
| Communication rhythm | Full replace | Stats-derived. |
| Sensitivities | Severity decay | See below. |
| Conflict patterns | Append + dedupe | Patterns are durable. |
| Last state | Full replace | Always reflects latest 50 msgs. |
| Snapshot | Full replace | Generated each regen. |

## Ongoing threads — resolve-aware diff

For each thread in the prior version:

- If the same thread (matched by topic similarity) still appears in the new version → keep it, update fields.
- If the same thread does NOT appear in the new version → do not delete. Mark as:

  ```
  - **<thread title>** _(status: resolved or stale, last seen: <prior date>)_
  ```

  The runtime needs to know "this used to be open; if it comes back, here's the prior position".

- If a new thread appears that wasn't in the prior → add to the list.

Never delete an ongoing thread silently. The agent's continuity depends on this.

## Sensitivities — severity decay

For each sensitivity in the prior version:

| Condition | Action |
|---|---|
| Appears in new findings with same or higher severity | Update with new evidence and `last_triggered_at`. |
| Appears in new findings with lower severity | Update severity downward. Note in drift report. |
| Does not appear in new findings, but `last_triggered_at` is within 30 days | Keep as-is (rare trigger, still alive). |
| Does not appear in new findings, `last_triggered_at` is 30-90 days old | Downgrade severity by one level (high → medium → low). |
| Does not appear, `last_triggered_at` > 90 days | Demote to low. Do not delete. |

For new sensitivities not in the prior: add. For severity downgrades: note in drift report.

**Never delete a sensitivity.** A high-severity topic that goes quiet is exactly the kind of thing that bites when it re-emerges. Decay, don't delete.

## Corrections always win

When a `## Corrections` rule contradicts a newly computed claim:

- The Corrections rule stands. Do not modify it.
- The contradicted claim is **omitted** from the corresponding section of the regenerated file.
- The drift report notes the conflict: `"correction X overrode new finding Y"`.

This applies recursively: if the user said "never use 'lmao' with Mom" and the analyzer found `lmao` count high with Mom, the analyzer's claim is dropped, the correction stands.

## Drift report

Write to `docs/drift/{ISO date}.md` after every merge. Format:

```
# Drift report — <ISO date>

## Summary
- <N> sections updated
- <N> sensitivities decayed
- <N> ongoing threads resolved
- <N> corrections preserved
- <N> conflicts between corrections and new findings

## tone.md changes
- <section>: <one-line summary>
- ...

## Per contact

### {slug}

- Label: <prior> → <new>  (if changed; flag if confidence dropped >0.15)
- Sensitivities decayed: <list>
- Threads resolved: <list>
- Threads added: <list>
- Conflicts with corrections: <list>

## Corrections vs new findings (conflicts)

- {scope: tone, target: lexicon} correction "never use 'lmao' with Mom" overrode new finding "lmao count high in mom-mom thread"
```

The drift report is the user's audit trail. If it is empty, write `_no meaningful drift since prior generation_`.

## Failure handling

If any of the following happens, **roll back** the regen pass:

- A `## Corrections` section is missing from a generated file
- A `## Manual notes` section is missing from a generated file with prior content
- The drift report has > 30% of contacts changing label (probable bug in classifier, not real drift)
- The drift report shows > 50% of sensitivities deleted (probable bug, not real decay)

Rollback: `git restore memory/` (after confirming with the user), then report what happened. Do not auto-retry.

## Archival, not deletion

If a contact drops below threshold (fewer than 100 total or 50 each-way in the new pass):

- Do NOT delete `memory/person/{slug}.md`.
- Add `archived: true` to the frontmatter.
- Add an `## Archived` section at top with reason and date.
- Keep the file. The runtime can still load it if the user explicitly invokes the contact.

## Hard rules

- Never delete a sensitivity, thread, or person file. Decay, mark, archive.
- Corrections always win. Conflicts go in the drift report; the correction is not modified.
- Generated sections are stats-authoritative; appended sections (Hard don'ts, Timeline, Inside jokes, Conflict patterns) never lose entries.
- Roll back on integrity violations, do not patch around them.
- Always produce a drift report, even if empty.
