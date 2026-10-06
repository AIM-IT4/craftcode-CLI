# Command reference

## Sessions

- `/sessions` — searchable session picker
- `/resume` — resume latest session
- `/session name <title>`
- `/session fork`
- `/session export`
- `/session delete`
- `/new`

## Providers and models

- `/providers` — show configured providers and authentication status
- `/provider` — provider picker
- `/provider <id>` — switch provider and refresh its model catalog
- `/model` — model picker for the active provider
- `/models` — alias that opens the active provider's model picker

CLI authentication:

- `craftcode auth status [provider]`
- `craftcode auth login [provider]`
- `craftcode auth logout [provider]`

## Agent controls

- `/mode` — Plan / Build picker
- `/effort` — Low / Normal / High
- `/permissions` — permission preset picker. `A`/`D` on normal permission prompts persist that category for the workspace; policy-gated shell commands remain one-shot approvals.
- `/style claude|classic|minimal` — switch terminal glyph/emphasis profile (font family is controlled by the terminal emulator)
- `/plushie auto|on|off` — control the animated Spark terminal mascot above the composer (idle blink, sleep, typing, cheer and error reactions)
- `/summary on|off` — toggle the one-line token/time summary after each turn
- `/notify auto|always|off` — bell and tab-title alert when a long turn finishes (`CRAFTCODE_NOTIFY=0` disables)
- `/tools group|ungroup` — collapse repeated tool calls into one row
- `/usage` — open the token usage dashboard; `/usage detail` prints this session's input/output/cached tokens, cache-hit rate and average first-token/response times
- `/agents`
- `/agent spawn <role> <task>`
- `/team [count] <task>`
- `/orchestrate <task>` — planner → dependency-aware read-only workers → reviewer
- `/arena [2-6] <task>` — run independent isolated candidates using the active provider; CodeCraft alone is sufficient
- `/arena all [2-6] <task>` — optionally include any other already-authenticated providers
- `/arena apply <arena-id> [candidate]` — permission-gated application of the winner or selected candidate

## Automatic capabilities

- Relevant skills are auto-selected per task within the workspace skill token budget; manual skill commands are optional fallback controls.
- `generate_image` is an agent tool rather than a slash command and appears only when the active API exposes image-generation capability.
- UI/web edits automatically trigger Playwright verification before completion/push when browser verification is enabled.
- `/proof` reports whether browser verification was required and completed.

## Runtime evaluation

- `craftcode eval runtime` — credential-free checks for semantic lookup, shell policy, process lifecycle, command discovery and persistent cache

## Context and project

- `/status`
- `/context` — stored vs lean request size, token savings, output budget, model-window pressure and compaction thresholds
- `/doctor` — check provider, model, message-protocol and context health
- `/proof` — show deterministic Proof-of-Change evidence for the latest turn
- `/flight` — list recent local execution recordings
- `/flight show <run-id>` — inspect a recorded step timeline
- `/replay <run-id> [step]` — fork the saved session at a replayable recorded boundary
- `/compact` — compact older session history while preserving recent work
- `/clear` — clear the current conversation
- `/config` — show the global CraftCode config path
- `/init`
- `/instructions`
- `/instructions reload`
- `@path/to/file` — attach selected workspace file

## Extensions

- `/skills`
- `/plugins`
- `/plugin marketplace add <owner/repo>`
- `/plugin install <name@marketplace>`
- `/connect` — connector picker with Browser approval / Token / Local auth labels
- `/disconnect <connector>` — disconnect an MCP connector
- `/mcp`

## Git / shell

- `/diff`
- `/checkpoints`
- `/undo`
- `!git status` — shell shortcut through command policy + normal permissions

Long-running commands are handled through agent process tools (`process_start`, `process_logs`, `process_status`, `process_stop`) so dev servers do not consume foreground command timeouts.

## Environment

- `CRAFTCODE_REDUCED_MOTION=1` — disable animations (Spark, spinners).
- `CRAFTCODE_NOTIFY=0` — never ring the bell.

## Supabase from local `.env`

The agent's `supabase_query` tool (read-only) uses `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or an anon key) from `.env`/`.env.local`. Service-role reads bypass RLS and ask first; keys are never shown to the model.
