# Changelog

## 0.9.6

- Added adaptive CodeCraft TPM pacing before requests so concurrent agents avoid preventable 429 bursts.
- Removed the crude 60-second fallback wait; retries now honor Retry-After / rate-reset headers and use short exponential fallback only when the server omits both.
- Added TPM-aware context compaction and older tool-output trimming to stop large coding sessions from resending oversized context every tool loop.
- Parallel subagents now adapt concurrency to the live CodeCraft TPM tier (1 at 200k, 2 at 500k, 3 at 1M, configured maximum above that) while still completing the full requested team.
- Reduced default subagent token budget to 120k and default subagent steps to 8.
- `/status` now shows the live TPM/RPM limits and remaining token window reported by CodeCraft.

## 0.9.5

- Replaced unsupported direct Vercel MCP OAuth with Vercel's supported CLI device-login flow for `/connect vercel`.
- Craft Code now verifies Vercel authentication with `vercel whoami` and uses the CLI session instead of generating an unapproved MCP OAuth client/redirect URI.
- Added a first-class `vercel_api` agent tool that calls Vercel REST endpoints through the authenticated Vercel CLI; write requests remain behind Craft Code permissions.
- Vercel execution uses `npx -y vercel@latest`, so a global Vercel installation is not required.

## 0.9.4

- Native terminal drag-selection and Ctrl+C copying are enabled by default; mouse capture is opt-in with `/mouse on`.
- Fixed composer/response overlap by avoiding exact-column terminal autowrap and reserving footer height before transcript allocation.
- Reworked the bottom status/control area into compact borderless grouped segments with clearer hierarchy and a copy/command hint.
- Retained optional clickable controls for users who explicitly enable mouse UI.
- Updated the website and repository presentation for the final UX polish release.

## 0.9.3

- Fixed MCP OAuth provider compatibility with the current SDK: callable state, callback-state validation, discovery-state persistence, and fresh post-OAuth HTTP transport.
- Replaced Docker-first GitHub connector defaults with GitHub's hosted MCP endpoint using an existing GitHub CLI token or GITHUB_TOKEN.
- Added zero-install public URL and GitHub repository inspection tools; repository links can be understood directly without cloning.
- Added the official Microsoft Playwright MCP connector and /browser command for Chromium automation.
- Parallel read-only subagents inherit URL/repository inspection tools for concurrent research.
- Added the Craft Code GitHub Pages website and deployment workflow.

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
