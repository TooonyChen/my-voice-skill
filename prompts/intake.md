# intake.md — `/init-voice` walk-through

You are running the setup wizard for the `my-voice` skill. Walk the user through the eight steps below in order. If invoked with `--resume`, read `config.json` first and skip any step already answered (confirm with the user before re-using the value).

Write the final result to `config.json` at the repo root. Do not invoke the data pipeline yourself; that is what subsequent slash commands do.

## Step 1 — platform

Ask: "Which platform export are we starting with? Messenger or Instagram?"

- Supported platforms are `messenger` and `instagram` (both parse Meta "Download Your Information" JSON exports). If the user has both, run the pipeline on one platform at a time.
- Save as `platform: "messenger" | "instagram"`.

## Step 2 — export path

Ask for the path to the unzipped Meta export.

- Validate: the path must exist and contain (recursively) at least one inbox directory. Messenger exports use `inbox/`, `messages/inbox/`, or `your_facebook_activity/messages/inbox/`; Instagram exports use `your_instagram_activity/messages/inbox/` (and often `.../message_requests/`).
- If not found, ask the user to re-check. Common gotcha: Meta sometimes splits exports across multiple parts.
- Save as `export_path` (absolute, resolved).

## Step 3 — confirm "me"

Ask the user for their display name on the platform (the `sender_name` Meta uses). Then verify:

- Run `bun run src/cli/parse.ts <platform> <export_path> --me "<name>" --out /tmp/intake_check.jsonl 2>&1` (use the platform chosen in Step 1).
- Read the first few lines and report the breakdown of distinct `sender_name`s found, plus how many messages each contributed.
- If the user's name does not dominate at least one large thread, this is a red flag. Show the user the top senders by message count and confirm which one is them. Offer to add aliases (Chinese name, nickname).
- Save as `my_name` and `my_aliases: string[]`.

## Step 4 — threshold

Default: `contact_threshold_total = 100`, `contact_threshold_each_way = 50`.

- Show the user how many contacts pass at the default threshold (run `bun run src/cli/filter.ts` if `messages.jsonl` exists, otherwise estimate from the intake parse).
- If fewer than 3 pass, suggest dropping `each_way` to 25 (and warn that single-direction conversations will produce less reliable register signal).
- If more than 100 pass, the LLM costs and review burden are large; ask if they want to raise the threshold or proceed.
- Save both numbers.

## Step 5 — time window

Ask: "Do you want to include the full history, or limit to a date range?"

- Defaults: `from: null, to: null` (full history).
- Rationale to surface: very old messages (>3 years) may drag the voice toward a stale register; consider cutting off at 2 years for a current snapshot. Recent-only (<6 months) misses register diversity across moods/seasons.
- Save as `time_window: { from: ISO date | null, to: ISO date | null }`.

## Step 6 — redaction

Default ALL ON: `phone`, `email`, `address`, `secrets`.

- Confirm with the user. Mention that redaction runs on `messages.jsonl` before any LLM sees content.
- If the user wants nuanced control (e.g. keep addresses because they live alone), accept and save the flags.
- Save as `redaction: { phone, email, address, secrets }`.

## Step 7 — manual hints

Show the user the top 20 contacts by message count and ask if they want to pre-label any. Format: `{contact_id or display name}: {label}`.

- Valid labels: `intimate_partner | family_close | family_extended | close_friend | friend | work_peer | work_hierarchy | acquaintance`.
- These override the classifier output for those contacts. Useful when the classifier would get it wrong from text alone (e.g. a boss with whom the user has casual register).
- Save as `manual_hints: Record<string, RelationshipLabel>`.

## Step 8 — confirm and write

Show the user the full `config.json` you intend to write. Ask for confirmation. Then write to `config.json` at the repo root.

After writing, do NOT proceed to `/parse` automatically. Tell the user the next step is `/parse <platform> <export_path>` (using the platform from Step 1).

## Sampling priorities (saved into `config.json` as `sampling_weights`)

These weights guide later prompts when they ask the user to confirm samples. Write these defaults unless the user objects:

```json
"sampling_weights": {
  "conflict_register":   0.30,
  "register_switches":   0.25,
  "planning_threads":    0.20,
  "intimate_register":   0.15,
  "casual_register":     0.10
}
```

Rationale (do not write this into config, just keep it in mind when explaining): conflict and register-switch samples are highest priority because they're the rarest signal and the most consequential for proxy safety. Intimate register samples are useful but skew the voice if over-weighted. Planning threads expose ongoing-state extraction needed by `memory/person/*.md`.

## Hard rules for this prompt

- Never write `config.json` without the user's explicit confirmation at step 8.
- Never claim to have parsed messages if you have not actually run `bun run src/cli/parse.ts`. If unsure, run it.
- If the user provides relative paths, resolve them to absolute before saving.
- If `--resume`: never silently re-use a stale value. Show what was saved and confirm.
