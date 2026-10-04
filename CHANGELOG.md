# Changelog

All notable changes to Craft Code are documented here.

## 0.9.0

- Added searchable/resumable sessions, CLI `continue` / `-c`, session naming, fork/export/delete and per-workspace auto-resume.
- Added automatic project instructions from `AGENTS.md`, `CLAUDE.md` and Copilot instructions.
- Added `/status`, `/context`, `/init` and instruction reload commands.
- Added shell shortcut syntax through the existing permission model.
- Added automatic CodeCraft 429/TPM retry behavior.

## 0.8.0

- Published Craft Code as `craftcode-codecraft` on npm.
- Added persistent CodeCraft authentication and `craftcode auth login/status/logout`.
- Added `craftcode update`.

## 0.7.0

- Added parallel subagents and isolated writer worktrees.
- Added Claude-style plugin marketplace compatibility.
- Added OAuth-capable MCP connector management.

## 0.6.0

- Added plan auto-detection, visible permission presets and terminal Markdown rendering.

## 0.5.0

- Reworked the conversation UI with interactive controls, command palette and smoother rendering.
