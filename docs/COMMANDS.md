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
- `/agents`
- `/agent spawn <role> <task>`
- `/team [count] <task>`
- `/orchestrate <task>` — planner → dependency-aware read-only workers → reviewer

## Runtime evaluation

- `craftcode eval runtime` — credential-free checks for semantic lookup, shell policy, process lifecycle, command discovery and persistent cache

## Context and project

- `/status`
- `/context`
- `/compact`
- `/init`
- `/instructions`
- `/instructions reload`
- `@path/to/file` — attach selected workspace file

## Extensions

- `/skills`
- `/plugins`
- `/plugin marketplace add <owner/repo>`
- `/plugin install <name@marketplace>`
- `/connect`
- `/mcp`

## Git / shell

- `/diff`
- `/checkpoints`
- `/undo`
- `!git status` — shell shortcut through command policy + normal permissions

Long-running commands are handled through agent process tools (`process_start`, `process_logs`, `process_status`, `process_stop`) so dev servers do not consume foreground command timeouts.
