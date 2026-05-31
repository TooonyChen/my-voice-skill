---
name: my-voice
description: Distill the user's language fingerprint and per-contact relational memory from exported chat history (Messenger and Instagram), so a runtime agent can reply on the user's behalf in the user's voice. Use when the user wants to (a) generate or refresh their `memory/tone.md` and `memory/person/*.md` files from chat exports, (b) classify contacts by relationship type, (c) apply corrections to the voice or per-contact memory, or (d) preview what the agent would draft for a given contact. Not for replying to messages directly; that lives in the runtime agent process which loads these memory files.
---

# my-voice

This skill produces two artifacts under `memory/`:

- `memory/tone.md` — the user's global language fingerprint (lexicon, punctuation, emoji, structure, register table, latency, hard don'ts)
- `memory/person/{first-name}-{username}.md` — one file per contact above the activity threshold (default: 100 total messages, ≥50 each way), containing relational memory (timeline, recurring topics, sensitivities, ongoing threads)

A third artifact, `memory/agent.md`, is user-authored. It encodes who the runtime agent is, what it must escalate, and the hard nopes. This skill does not regenerate it; treat it as input. The repo ships `memory/agent.template.md` as a starting point; copy it to `memory/agent.md` and personalize before going live. The personalized file is gitignored.

## Design principles

1. **Statistics first, then LLM.** Every claim in `tone.md` and `person/*.md` must be anchored to a number or a quoted example. The pipeline runs deterministic stats (`src/analyzers/stats.ts`) before any prompt fires. LLM passes only see stats summaries and bounded samples, never the raw firehose.
2. **Observable over labeling.** No MBTI, astrology, attachment style, love language. Only countable features (top words, swear rate, emoji density, message-length histogram, code-switch rate) and quoted examples.
3. **Register-aware.** Tone shifts by relationship class. The classifier (`prompts/relationship_classifier.md`) assigns each contact a label; downstream prompts must respect register differences across labels.
4. **Incremental.** Every output supports refresh. Hand-authored sections (Manual notes, Corrections) survive regen verbatim. The merger (`prompts/merger.md`) handles drift.
5. **Proxy-safe.** The runtime agent that consumes these files is a *proxy* for the user. It must not improvise the user's harder edges (sarcasm, conflict register) without explicit precedent. `agent.md` already defines escalation rules; this skill must produce memory that supports those rules (e.g. sensitivity tags with severity).

## Workflow

```
[Meta export]
   │
   │  /init-voice            (intake.md walks the user through setup; writes config.json)
   ▼
[config.json]
   │
   │  /parse messenger <path>   (src/cli/parse.ts → messages.jsonl, redacted)
   ▼
[exports/normalized/messages.jsonl]
   │
   │  /stats                    (src/cli/stats.ts → stats.json + per_contact_stats.json)
   │  /filter                   (src/cli/filter.ts → contacts_passed.json)
   ▼
[stats.json] [contacts_passed.json]
   │
   │  /classify-contacts        (prompts/relationship_classifier.md, LLM per contact)
   ▼
[contacts_classified.json]
   │
   │  /generate-tone            (persona_analyzer.md → findings; persona_builder.md → tone.md)
   │  /generate-all-memories    (memory_analyzer.md → per-contact findings; memory_builder.md → person/*.md)
   ▼
[memory/tone.md] [memory/person/*.md]
   │
   │  /correct "..."            (correction_handler.md — writes to Corrections sections)
   │  /update --since DATE      (re-runs pipeline; merger.md handles drift)
   ▼
[runtime agent loads memory/*]
```

## Slash commands

| Command | What Claude does |
|---|---|
| `/init-voice` | Follow `prompts/intake.md`. Walks user through platform choice, export path, "who is me", threshold, time window, redaction, manual hints. Writes `config.json`. Supports `--resume`. |
| `/parse <platform> <path>` | Invoke `bun run src/cli/parse.ts <platform> <path> --me "<my name>"`. Writes `exports/normalized/messages.jsonl`. |
| `/stats` | Invoke `bun run src/cli/stats.ts`. Writes `exports/stats.json` and `exports/per_contact_stats.json`. Required before any LLM-driven step. |
| `/filter [--total N] [--each-way N]` | Invoke `bun run src/cli/filter.ts`. Writes `exports/contacts_passed.json`. |
| `/classify-contacts` | For each contact in `contacts_passed.json`, follow `prompts/relationship_classifier.md` using a sample from `bun run src/cli/sample.ts <contact_id>`. Output `exports/contacts_classified.json`. |
| `/generate-tone` | Two-phase: (1) follow `prompts/persona_analyzer.md` using `stats.json` and samples from "me" messages across all classified contacts to produce `exports/persona_findings.json`. (2) follow `prompts/persona_builder.md` to template `memory/tone.md`. Preserves the `## Corrections` section if `tone.md` already exists. |
| `/generate-memory <slug>` | For one contact: follow `prompts/memory_analyzer.md` then `prompts/memory_builder.md` to produce `memory/person/{slug}.md`. Preserves `## Manual notes` and `## Corrections` sections. |
| `/generate-all-memories` | Iterate `/generate-memory` over every contact in `contacts_classified.json`. |
| `/update [--since DATE]` | Re-run `/parse` → `/stats` → `/filter` → `/classify-contacts` → `/generate-tone` → `/generate-all-memories`. Apply `prompts/merger.md` to reconcile new findings with existing files. **Labels with `label_source: manual_override` or `correction_override` are preserved verbatim and never re-classified.** Write drift report to `docs/drift/{date}.md`. |
| `/correct "<text>"` | Follow `prompts/correction_handler.md`. Parse scope (global / per-contact / register / agent), strength (hard / soft), target. Write to the appropriate `## Corrections` section verbatim. Implicit reclassifications update both `config.json` `manual_hints` AND `exports/contacts_classified.json` `label_source`, so the relabel survives `/update`. |
| `/preview <slug>` | Read `memory/tone.md`, `memory/agent.md`, and `memory/person/{slug}.md`. Show what the agent would load and what corrections / sensitivities apply, without invoking the runtime. |
| `/redact <slug> <pattern>` | Invoke `bun run src/cli/redact.ts <slug> "<pattern>" [--regex]`. Updates `config.json` `redaction.custom_patterns` so future `/parse` runs strip the pattern, re-normalizes the existing `messages.jsonl` in place (with backup), scrubs the pattern from `memory/person/{slug}.md`, and appends a Manual notes entry. Use slug `_global_` to apply to config and messages only (no per-person scrub). |

## File layout

```
SKILL.md                          ← this file
prompts/                          ← LLM instruction files; Claude follows these per command
  intake.md
  relationship_classifier.md
  persona_analyzer.md
  persona_builder.md
  memory_analyzer.md
  memory_builder.md
  merger.md
  correction_handler.md
src/                              ← TypeScript utilities invoked via `bun run`
  types/                          ← zod schemas (Message, ContactStats, GlobalStats, etc.)
  parsers/                        ← meta.ts (shared Meta JSON base), messenger.ts, instagram.ts
  analyzers/                      ← tokenize.ts, normalize.ts, filter_contacts.ts, stats.ts
  cli/                            ← parse.ts, stats.ts, filter.ts, sample.ts
docs/                             ← schemas for tone.md and person memory
exports/                          ← gitignored; raw exports, normalized JSONL, stats JSON, samples
memory/                           ← OUTPUT consumed by the runtime agent
  agent.md                        ← user-authored, NOT regenerated by this skill
  tone.md                         ← generated by /generate-tone
  person/
    _index.md                     ← regenerated by /generate-all-memories
    {slug}.md                     ← one per contact above threshold
tests/                            ← bun test
```

## Hard rules for any LLM step in this skill

- **Freshness gate**: every LLM-driven step (classify, generate-tone, generate-memory) must open by running `bun run src/cli/check_freshness.ts stats` (and `classified` when applicable). If non-zero exit, stop and tell the user which command to run. Do NOT proceed with stale or missing inputs; the entire design depends on stats being the ground truth.
- **Validate findings**: every LLM-produced JSON intermediate (persona_findings, memory_findings, contacts_classified) must be validated via `bun run src/cli/validate.ts <schema> <path>` before the next phase consumes it. If validation fails, stop and report.
- Every claim about the user's voice must be anchored to either a frequency (with N) or a quoted example (≤30 chars).
- Never invent labels (MBTI / astrology / attachment style / love language / personality typing).
- Never analyze the contact's personality. Person memory is about the *relationship*, not the person.
- Never overwrite the `## Corrections`, `## Manual notes`, or any user-authored section. If a generated file already exists, read it first and preserve those sections verbatim.
- If sample data is too sparse for a section, leave it empty rather than fabricate.
- Quote ≤30 characters per example to stay under fair-use intuition.
- Labels with `label_source: manual_override` or `correction_override` are never re-classified by `/update`. They survive across runs verbatim.

## Runtime contract (out of scope for this skill, in scope for the consumer)

The runtime agent process (separate from this skill) loads at start:

1. `memory/agent.md` (hard rules and escalation policy)
2. `memory/tone.md` (voice fingerprint)
3. `memory/person/{slug}.md` for each contact in the active conversation

The runtime is responsible for applying the escalation rules in `agent.md` (sentiment check, topic check, sensitivity check, confidence check) before sending any reply. This skill produces the inputs; it does not execute the runtime.
