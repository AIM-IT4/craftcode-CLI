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

CLI authentication:

- `craftcode auth status [provider]`
- `craftcode auth login [provider]`
- `craftcode auth logout [provider]`

## Agent controls

- `/mode` — Plan / Build picker
- `/effort` — Low / Normal / High
- `/permissions` — permission preset picker
- `/style claude|classic|minimal` — switch terminal glyph/emphasis profile (font family is controlled by the terminal emulator)
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
- `/context` — context composition, model-window pressure and automatic compaction thresholds
- `/doctor` — check provider, model, message-protocol and context health
- `/proof` — show deterministic Proof-of-Change evidence for the latest turn
- `/flight` — list recent local execution recordings
- `/flight show <run-id>` — inspect a recorded step timeline
- `/replay <run-id> [step]` — fork the saved session at a replayable recorded boundary
- `/compact` — compact older session history while preserving recent work
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
- `/mcp`

## Git / shell

- `/diff`
- `/checkpoints`
- `/undo`
- `!git status` — shell shortcut through command policy + normal permissions

Long-running commands are handled through agent process tools (`process_start`, `process_logs`, `process_status`, `process_stop`) so dev servers do not consume foreground command timeouts.
