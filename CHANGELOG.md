# Changelog

## 0.11.1

Released: 2026-10-05.

- Fixed long-running sessions that could start returning provider HTTP 400 errors even though a fresh session worked.
- Auto-compaction now uses the selected model's reported context window and reserves headroom for tool schemas and model output.
- OpenAI-compatible requests dynamically reduce output-token allowance near the context limit instead of requesting an impossible fixed output size.
- Recognized context-length failures compact and retry once automatically without forcing the user to start a new session.
- Interrupted or partially saved tool-call history is repaired on resume/cancellation so malformed message sequences do not poison later requests.
- Added a live context used/window percentage in the terminal footer and Usage view, with warning pressure states.
- Added `/doctor` for provider, model, message-protocol and context health, and expanded `/context` and `/compact` feedback.
- Added regression coverage for context overflow recovery, provider 400 classification, dynamic output headroom, interrupted tool calls and context-pressure UI.

## 0.11.0

- Added TypeScript/JavaScript AST-backed semantic code intelligence for symbols, definitions, and references.
- Added a hardened shell policy that denies catastrophic commands and approval-gates project-code, destructive, network, publish, deploy, and opaque interpreter execution.
- Added optional Docker sandbox execution with no network, dropped capabilities, resource limits, a read-only workspace mount, and temporary writable scratch space.
- Added dependency-aware planner → read-only workers → reviewer orchestration with cycle, role, and task-count validation.
- Added persistent safe-tool caching, volatile raw local-file caching, workspace invalidation, privacy protections, and cache metrics.
- Added owned long-running process handles with bounded logs, stop/status/list operations, exit cleanup, and a configurable concurrency cap.
- Added automatic project command discovery for test, lint, typecheck, build, and dev workflows.
- Added deterministic credential-free runtime evaluations and expanded cross-platform regression/security coverage.
- Retained provider-neutral CodeCraft/OpenRouter/OpenAI-compatible operation and existing permission/checkpoint controls.

## 0.10.0

- Refactored Craft Code into a provider-agnostic coding-agent runtime.
- Added OpenRouter support through its OpenAI-compatible API, including tool-capability metadata from the model catalog.
- Added generic configurable OpenAI-compatible providers for local/self-hosted or third-party gateways.
- Added provider-scoped API-key storage and environment-variable precedence; legacy CodeCraft credentials remain compatible.
- Added `/provider` and `/providers`, provider-aware `/model` and `/status`, and `craftcode auth login|status|logout [provider]`.
- Provider switching updates both the main agent and subagent runtime without restarting Craft Code.
- Sessions now persist provider identity; legacy sessions default to CodeCraft.
- Providers without reliable plan metadata show observed local usage instead of a fabricated Unlimited plan.
- CodeCraft remains the default for legacy installations and preserves its existing TPM pacing and plan-hint behavior.

## 0.9.9

- Fixed long turns silently stopping mid-edit or mid-reasoning when the adaptive TPM step cap was reached.
- Tool-heavy turns now continue automatically in bounded segments instead of treating the per-segment rate-protection cap as task completion.
- Responses ending with provider `finish_reason: length` now continue automatically instead of truncating the turn.
- Added a bounded `maxTurnSegments` safety ceiling (default 3); if it is exhausted, Craft Code visibly reports that the task may be incomplete instead of silently ending.
- Added cross-platform regression tests for both silent-stop paths.

## 0.9.8

- Fixed mouse-wheel transcript scrolling in Windows Terminal native-selection mode.
- When mouse capture is off, Craft Code now enables DEC Alternate Scroll Mode so wheel events are translated into Up/Down sequences; those sequences already map to transcript scrolling rather than prompt history.
- When `/mouse on` is enabled, Craft Code disables Alternate Scroll Mode and uses SGR mouse-wheel events directly.
- Switching back with `/mouse off` restores native text selection plus working wheel scrolling.

## 0.9.7

- Fixed mouse-wheel scrolling on Windows Terminal and other alternate-screen terminals where wheel motion was being translated into Up/Down keystrokes and changing the prompt/history.
- Craft Code now explicitly disables DEC Alternate Scroll Mode (`?1007l`) while the TUI is active.
- Plain Up/Down now scroll the conversation when no file/command picker is active, providing a fallback even in terminals that still translate wheel events into arrow keys.
- Prompt-history navigation moved to `Ctrl+P` / `Ctrl+N`; PageUp/PageDown remain larger transcript jumps.

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
