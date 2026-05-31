# correction_handler.md — `/correct "<text>"`

Parse the user's free-text correction into a structured override and write it to the appropriate `## Corrections` section.

## Parse step

From the user's text, extract:

| Field | Type | How to detect |
|---|---|---|
| `scope` | `global` \| `per_contact` \| `register` \| `agent` | Mention of a specific contact name → per_contact. Mention of a register label → register. Mention of escalation/sentiment/agent behavior → agent. Otherwise global. |
| `target` | string | The contact slug, the register label, or null for global. |
| `wrong` | string | What the user is saying you got wrong. Often phrased as "you said X" or "tone says X". |
| `correct` | string | The user's preferred version. Often phrased as "actually I do Y" or "use Y instead". |
| `strength` | `hard` \| `soft` | Hard: "never", "always", "do not", "must". Soft: "usually", "mostly", "prefer", "lean toward". |
| `confidence` | 0..1 | How sure you are of the parse. If < 0.7, ask the user to confirm before writing. |

Output the parse as JSON to the user for confirmation, then write.

Example parse:

User says: `the tone file says I use 'lmao' a lot but I actually use 'lmaoo' with the extra o, with friends mostly`

Parse:
```json
{
  "scope": "register",
  "target": "close_friend",
  "wrong": "tone.md attributes 'lmao' as the dominant amusement marker",
  "correct": "the dominant amusement marker is 'lmaoo' with extra o, primarily in close_friend register",
  "strength": "soft",
  "confidence": 0.82
}
```

## Write target

| Scope | File | Section |
|---|---|---|
| `global` | `memory/tone.md` | `## Corrections` |
| `per_contact` | `memory/person/{target}.md` | `## Corrections` |
| `register` | `memory/tone.md` | `## Corrections` (under a `### Register: {target}` subheading) |
| `agent` | `memory/agent.md` | `## Corrections` |

## Write format

Each correction is appended as:

```markdown
### <ISO date> · <strength: hard|soft>

**Wrong**: <verbatim from parse>
**Correct**: <verbatim from parse>
**Source**: user via `/correct`
```

Do not reformat the user's wording. Verbatim matters because the runtime applies the rule literally.

If `scope: register`, prefix with the register subheading the first time it appears:

```markdown
### Register: close_friend

#### <ISO date> · soft
...
```

## Runtime priority stack

When the agent assembles its working prompt at runtime, it applies overrides in this order (highest priority first):

1. **`agent.md` Corrections (hard)** — escalation / hard nopes
2. **`agent.md` Corrections (soft)**
3. **`memory/person/{slug}.md` Corrections (hard)** — per-contact overrides
4. **`memory/person/{slug}.md` Corrections (soft)**
5. **`memory/tone.md` Corrections (hard, register-specific)**
6. **`memory/tone.md` Corrections (soft, register-specific)**
7. **`memory/tone.md` Corrections (hard, global)**
8. **`memory/tone.md` Corrections (soft, global)**
9. **Body of `agent.md`**
10. **Per-contact `memory/person/{slug}.md` body**
11. **`memory/tone.md` register table**
12. **`memory/tone.md` body**

A higher-priority rule that contradicts a lower-priority claim wins. The runtime does not negotiate; it applies the stack literally.

Document this stack in any correction confirmation message so the user understands the impact of their correction.

## Edge cases

### Self-contradiction

If the new correction contradicts an existing correction in the same file/section:

- Show the user both rules.
- Ask which one stands.
- Replace, do not append (keep the file's Corrections section coherent).

### Self-report contradicts data

If the user says "I never use X" but stats clearly show X is frequent in their messages:

- Apply the correction anyway. The user owns their voice.
- Add a `⚠️ note: stats showed X with frequency N; user explicitly overrode` next to the entry. The runtime ignores this note; it's an audit trail for the user.
- Do not argue with the user.

### Implicit reclassification

If the user says "Morgan is my work boss, not a friend" and Morgan is currently labeled `friend`:

- Recognize this as a label override, not just a correction.
- Confirm with the user first. Show: current label, proposed new label, and the rationale for treating this as a reclassification.
- On confirm, do **all four** of the following so the change survives `/update`:
  1. Update `config.json` `manual_hints` to `"morgan-morganp": "work_hierarchy"`.
  2. Update `exports/contacts_classified.json` for Morgan: set `label: "work_hierarchy"`, `confidence: 1.0`, `label_source: "correction_override"`, `label_source_note: "set via /correct on <ISO date>: <user's verbatim phrasing>"`, and prepend a signal `{type: "correction_override", evidence: "...", weight: "strong"}`.
  3. Re-run `bun run src/cli/validate.ts classified_contacts exports/contacts_classified.json` to make sure the file is still well-formed.
  4. Suggest the user run `/generate-memory morgan-morganp` to refresh the per-contact file with the new label.
- Do NOT silently relabel. Always confirm first.
- The `label_source: "correction_override"` value is what protects the relabel from being undone by the next `/update`. The classifier and merger both honor it.

### Cross-contact pattern

If the user says "I never apologize formally with anyone":

- Scope is `global`, write to `tone.md` Corrections.
- Strength `hard`.
- Add the absence to `## Hard don'ts` as well (next regeneration will preserve it via Corrections priority).

### Agent escalation override

If the user says "stop bark-notifying me when Riley messages me at 11pm, he's always drunk":

- Scope is `per_contact`, target `riley-rileytan`.
- Write a correction that adjusts the escalation behavior:

  ```
  **Wrong**: agent escalates late-night messages from Riley
  **Correct**: when Riley messages between 22:00-02:00, treat as relaxed-register casual; do not Bark-notify on sentiment alone (still escalate on hard nopes from agent.md).
  **Source**: user via `/correct`
  ```

  This is interpreted by the runtime as a per-contact override of the sentiment-based escalation.

## After write

Print to the user:

- Where the correction was written
- What the new runtime stack looks like for the affected scope
- Whether any other corrections were superseded (and ask if the user wants to remove them)

## Hard rules

- Never modify the body of `tone.md`, `agent.md`, or `person/{slug}.md` from this command. Only the `## Corrections` sections.
- Never delete a prior correction unless the user explicitly says so.
- Never argue with the user about whether the correction is right. They own their voice.
- Parse confidence below 0.7 → ask the user to confirm the parse before writing.
- Implicit reclassifications must be confirmed, not auto-applied.
