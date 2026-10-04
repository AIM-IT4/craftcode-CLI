# Changelog

## 0.9.2

- Added mouse-wheel scrolling for conversation history inside the full-screen TUI.
- Added a Select mode (toolbar pill and `/select`) that temporarily releases terminal mouse capture for normal drag-selection and Ctrl+C copying; Esc returns to Craft Code.
- Added automatic inline red/green edit previews for `replace_in_file` and bounded new-content previews for `write_file`.
- Added regression coverage for scrolling, copy/select mode exposure, and inline edit rendering.

## 0.9.1

- Prevented stdio connector stderr (including Windows `docker` shell errors) from corrupting the full-screen TUI.
- Added prerequisite checks and actionable MCP connector failures instead of raw `Connection closed` messages.
- Suppressed duplicate transient notices and improved connector picker setup hints.
- Made the test command portable across Windows, macOS, and Linux.

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
