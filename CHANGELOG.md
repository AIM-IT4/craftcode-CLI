# Changelog

## 0.14.15

Released: 2026-10-06.

- Fixed Windows browser OAuth URLs being truncated at `&` when Craft Code launched them through `cmd /c start`.
- Supabase authorization URLs now reach the browser with `client_id`, `redirect_uri`, PKCE challenge, state, scope, and resource parameters intact.
- Windows now opens OAuth URLs through the registered URL handler directly with `rundll32.exe url.dll,FileProtocolHandler`, avoiding `cmd.exe` metacharacter parsing.
- Added a Windows regression test using a Supabase-style authorization URL to ensure query parameters survive unchanged.
- This specifically fixes browser errors such as `client_id: ... received undefined, redirect_uri: ... received undefined`.

## 0.14.14

Released: 2026-10-06.

- Fixed `/connect supabase` browser OAuth failures that could surface as missing `client_id` / `redirect_uri` validation errors.
- Persisted MCP OAuth client registrations and tokens are now validated before reuse; malformed partial records are discarded automatically.
- OAuth client credentials and token sets are no longer reused across authorization-server issuers, matching the current MCP SDK credential-isolation contract.
- Loopback browser callbacks are explicitly registered as a native OAuth application.
- Added scoped OAuth credential invalidation so stale client registrations or tokens can recover without manual file deletion.
- Supabase connector copy now documents that hosted Supabase MCP uses browser OAuth with dynamic client registration; a PAT or manually entered client ID is not required for the normal interactive flow.
- Added regression coverage for malformed OAuth state, issuer isolation, and callback metadata.

## 0.14.13

Released: 2026-10-06.

- Fixed unnecessary pre-response Git checkpoint work in Build mode. Craft Code no longer runs `git stash create` and an untracked-file scan before every model request.
- Checkpoints are now created lazily immediately before the first mutating file tool or shell/process action in a turn.
- Read-only questions in Build mode therefore reach the provider without repository-wide checkpoint overhead, improving time-to-first-token on medium and large repositories.
- Mutation safety and `/undo` behavior remain intact because the checkpoint still exists before the first workspace-changing tool executes.
- Added regression coverage proving read-only Build turns create no checkpoint and mutating turns create exactly one before execution.

## 0.14.12

Released: 2026-10-06.

- Fixed premature automatic context compaction on large-context models. The old generated `autoCompactChars: 300000` default capped sessions at roughly 75k estimated tokens even when the active model exposed a 1M-token window.
- Automatic compaction now derives its trigger from the active model's advertised context window, reserving headroom for tool schemas, output, and safety margin.
- Removed TPM/rate-limit metadata from context-capacity calculations; tokens-per-minute is throughput, not a context-window size.
- Existing v20 configs carrying the generated 300k-character default migrate in memory to `auto`, so upgrades receive the fix without manual config edits.
- Numeric `autoCompactChars` remains supported as an explicit advanced override.
- Added regression coverage ensuring a 1M-context model does not compact near 75k tokens, even when the provider reports a much smaller TPM limit.

## 0.14.11

Released: 2026-10-06.

- Fixed `A = always allow` and `D = always deny` so normal write, shell, and MCP decisions persist to the workspace `.craftcli/config.json` instead of only mutating the current process.
- Durable permission decisions are saved before the pending operation resumes, preventing repeated prompts caused by persistence races.
- Security-policy approvals for repository-controlled code, opaque interpreters, destructive commands, pushes, publishes, installs, and deploys are explicitly one-shot; those prompts no longer advertise an ineffective permanent bypass.
- One-off action confirmations such as applying subagent patches, deleting sessions, undoing checkpoints, enabling hooks, or authorizing isolated agent shells also no longer expose misleading `always` controls.
- Added regression coverage for permission reloads, async persistence, and policy-gated prompt UX.
## 0.14.10

Released: 2026-10-06.

- Keeps Spark anchored on the lower-right immediately above the composer while slash-command or file suggestions are visible, provided the terminal has enough vertical room.
- Preserves the existing responsive fallback: Spark still yields to modal/approval overlays and hides when the terminal cannot fit the mascot without crowding the conversation.
- Fixed slash-command Enter behavior so the first Enter accepts a partial command and a second Enter executes it, making argument-taking commands easier to complete safely.
- Fixed stale slash-command selection after bracketed paste, preventing out-of-range completion crashes.
- Slash search now ranks exact matches before prefixes/fuzzy matches and exposes implemented /models, /disconnect, /checkpoints, /clear, and /config commands in the palette.
- Composer left/right/backspace now operate on grapheme clusters, so emoji and combined Unicode characters are not split; Home/End and Ctrl+A/Ctrl+E navigation are supported.
- Added regression coverage for persistent Spark placement, slash completion, paste safety, discoverability, exact-match ranking, and Unicode cursor editing.
## 0.14.9

Released: 2026-10-06.

- Added Spark, an original CraftCode terminal plushie rendered on the lower-right immediately above the composer.
- Spark animates while the agent is working and changes expression for success and tool-error states.
- Plushie rendering is terminal-cell-width safe and does not use image assets or depend on a specific terminal font.
- `auto` mode hides Spark on constrained terminals and whenever a modal, picker, command palette, or file-suggestion panel needs the space.
- Added `/plushie auto|on|off`; the preference persists in the workspace UI configuration.
- Added regression coverage for right alignment, narrow-terminal auto-hide, working animation, success/error expressions and explicit disable behavior.

## 0.14.8

Released: 2026-10-06.

- Active thinking rows now animate with the same live spinner frames used by running tools instead of showing a static activity glyph.
- Assistant text blocks now have an explicit streaming state: the leading marker animates while model text is arriving, then freezes to the normal completed marker when a tool begins or the turn ends.
- Direct image-creation requests are now classified before normal repository exploration.
- When image generation is supported, Craft Code exposes only `generate_image` for that direct image turn, preventing accidental fallback to file writes, shell commands, repository searches, or helper scripts.
- When the active provider/model does not advertise image-generation capability, Craft Code returns immediately with a capability message and leaves the workspace unchanged.
- Craft Code will not create Python/JavaScript image-generation helpers, install graphics libraries, or modify project code as a fallback unless the user explicitly asks to build image-generation code.
- Generated images no longer trigger code-test verification gates simply because the image file is a workspace mutation.
- Added regression coverage for animated thinking/assistant markers, media-intent classification, unsupported-image fast paths, and generate-image-only tool routing.

## 0.14.7

Released: 2026-10-06.

- Fixed `/connect vercel` handing terminal ownership to the Vercel CLI, which prevented Craft Code from receiving Escape while browser approval was pending.
- Vercel device authentication now stays inside the active Craft Code TUI in a dedicated live authentication panel.
- The panel streams Vercel CLI output, surfaces the approval URL as soon as it is emitted, and still best-effort opens that URL in the default browser.
- Escape or Q now cancels the actual Vercel login process and closes the auth panel cleanly.
- Enter does not accidentally dismiss an in-progress authentication flow.
- Windows cancellation terminates the spawned Vercel process tree rather than only hiding UI.
- Added regression coverage for live auth-panel updates and Escape/Q cancellation.

## 0.14.6

Released: 2026-10-06.

- Fixed Windows TUI row corruption where long Unicode/emoji output could physically wrap and overwrite the composer border.
- Terminal layout now measures display cells instead of JavaScript string length, including emoji, CJK, combining marks and ANSI-colored text.
- Retained the existing one-cell terminal-edge guard while making width calculation display-cell aware, preventing logical rows from wrapping into the next physical line.
- Fixed `/connect vercel` failing with `spawn EINVAL` on Windows by launching `npx.cmd` through the Windows command shell.
- Vercel authentication now uses the official OAuth device flow, mirrors the verification URL prominently, and best-effort opens that URL in the default browser.
- Vercel connection failures now open a dismissible panel with an actionable retry message instead of only showing “not connected”.
- Added regression coverage for terminal cell width, composer/tool-row bounds, Windows Vercel spawn semantics and device-URL extraction.

## 0.14.5

Released: 2026-10-06.

- Replaced the static Thinking/Analyzing word carousel with semantic activity labels derived from the actual task and execution state.
- Initial activity now reflects task intent, such as Tracing the issue, Assessing the interface, Mapping dependencies, Planning verification, Checking release state, or Scoping the search.
- Between tools, activity now reflects evidence and state: Connecting search findings, Connecting code findings, Checking the edit, Verifying the change, Checking in browser, Reviewing evidence, or Reassessing after failures.
- Tool completion labels are also dynamic, such as Edit applied, Diff ready, Command failed, or Browser evidence captured.
- Completed turns preserve the final meaningful activity label instead of collapsing back to generic Thought.
- Added regression coverage for task classification, state-aware labels, tool-result labels, and completed-turn label preservation.

## 0.14.4

Released: 2026-10-06.

- Fixed PageUp/PageDown not navigating the slash-command palette.
- Added page-sized navigation to slash commands, @file suggestions, provider/model/session/permission pickers, and other picker lists.
- Corrected info-panel scrolling to open at the top instead of the bottom.
- Info panels now use conventional navigation: Down/PageDown moves forward; Up/PageUp moves backward.
- Transcript PageUp/PageDown behavior remains available whenever no palette/picker is consuming the key.
- Updated palette hints to advertise PageUp/PageDown navigation.
- Added regression coverage for slash palette, normal pickers, and scrollable info panels.

## 0.14.3

Released: 2026-10-06.

- Fixed list/info commands such as `/providers` leaving permanent transcript output that Escape could not dismiss.
- Added scrollable info panels that close with Escape, Enter, or Q.
- `/providers`, `/skills`, `/plugins`, `/mcp`, `/mcp tools <server>`, and `/agents` now use dismissible panels instead of permanent assistant messages.
- Info panels support Up/Down and Page Up/Page Down scrolling for long lists.
- Added regression coverage for Escape close and keyboard scrolling.

## 0.14.2

Released: 2026-10-06.

- Fixed the slash-command palette showing only the first few commands even though the full registry was available.
- Typing `/` now searches the complete built-in and plugin command registry instead of truncating matches before rendering.
- The composer keeps a compact seven-row viewport but scrolls it around the selected command with Up/Down.
- The palette header now shows the visible range and total count, e.g. `Commands · 1–7 of 40 · ↑/↓ scroll`, so hidden commands are discoverable.
- Added regression coverage ensuring lower commands such as `/arena`, `/doctor` and `/exit` remain reachable and render when selected.

## 0.14.1

Released: 2026-10-06.

- Fixed inconsistent Escape behavior in the full-screen TUI.
- Escape now dismisses the topmost transient layer first: modal/picker, permission dialog, plan approval, selection mode, slash-command/file suggestions, or tool-card focus.
- When a model turn is running, Escape cancels the turn only after transient UI has been dismissed.
- Slash-command and @file suggestion panels can now be hidden with Escape without deleting the user's typed input; editing the input reopens suggestions.
- Selection mode now tracks its state correctly and Escape returns to Craft Code, restoring mouse capture when it had been enabled before selection mode.
- Added regression coverage for command suggestions, file suggestions, pickers, approval dialogs, plan dialogs, and busy-turn cancellation precedence.

## 0.14.0

Released: 2026-10-06.

- Added a Context Efficiency Engine that keeps the richer local session while sending a lean evidence view to the provider.
- Large tool results are evidence-compressed before entering future model context; command failures, assertions, summaries and tail output are preferentially retained.
- Identical tool evidence is content-hashed and replaced with a compact unchanged-evidence reference instead of paying for the same payload repeatedly.
- Older tool results are compressed again at request time while the most recent tool evidence remains intact.
- Long-session compaction now pins recent user requirements, changed-file paths, failed/passed verification commands and browser-verification evidence.
- Auto-selected skills now strip YAML metadata, HTML comments and redundant whitespace before entering the prompt, while preserving the instruction body.
- Added adaptive per-request output ceilings for tiny, normal and deep tasks. Build tasks keep a conservative floor so tool-call arguments are not starved.
- Default final responses are instructed to stay compact unless the user explicitly asks for detail.
- Added `apply_patch`, a permission-gated unified-diff edit tool that reduces output tokens by avoiding whole-file rewrites and duplicated old/new blocks.
- Subagent narrative results are bounded before they are injected into supervisor context.
- `/context` now reports effective lean-request size, avoided context tokens, duplicate/compressed tool evidence and the current output budget.
- Fixed verification accounting so a failed test/lint/typecheck/build command does not mark the turn as successfully verified.

## 0.13.0

Released: 2026-10-06.

- Added capability-aware image generation. Craft Code discovers image-output models from provider metadata, can automatically use a separate image model from the same API catalog, and exposes `generate_image` only when the capability is real or explicitly configured.
- Image bytes are written directly to workspace files; base64 payloads are never injected into the model conversation.
- Added automatic skill routing. Relevant skills are selected from name/description metadata before each turn, loaded without slash commands, and constrained by a configurable skill count/token budget.
- Reduced recurring skill prompt overhead by replacing the large description catalog with a compact skill-name catalog plus only the auto-selected full skill content.
- Added automatic browser-verification gates for UI/web changes. Craft Code starts the Playwright connector lazily, can navigate localhost and capture snapshots/screenshots/console/network evidence without a manual `/browser` command, and blocks `git push` until required browser evidence exists.
- Potentially state-changing browser actions remain permission-sensitive.
- Proof of Change now records whether browser verification was required/completed and penalizes UI changes that lack browser evidence.
- Diff inspection no longer counts as executable verification by itself; edited code still needs focused test/lint/typecheck/build evidence when applicable.
- Added regression coverage for image-model discovery, image-file writes, auto-skill relevance/token limits, and browser verification safety.

## 0.12.0

Released: 2026-10-06.

- Added a local Flight Recorder for agent execution timelines. Runs capture provider/model identity, step sequencing, context epochs, tool/result hashes, durations and proof metadata without duplicating full tool output.
- Added safe time-travel replay with `/flight` and `/replay`. Replay forks the saved session at an exact recorded message boundary; it refuses pre-compaction steps when the original context can no longer be reconstructed exactly.
- Added deterministic Proof of Change with `/proof`. Scores are based on observed workspace mutations, diff inspection, project-command discovery, successful test/lint/typecheck/build evidence, clean tool execution and completion state rather than model self-confidence.
- Added isolated Patch Arena with `/arena`. By default it works with the currently active provider only, so a CodeCraft API key is sufficient. `/arena all` optionally includes any additional providers that are already authenticated.
- Arena candidates run in isolated Git worktrees and are ranked deterministically by valid patch, proof score and smaller patch size; applying a candidate remains an explicit permission-gated action.
- Sessions now persist the latest proof report and Flight run ID, and can fork exact message prefixes for replay.
- Fixed mutation accounting so denied writes do not count as successful changes or trigger false verification evidence.
- Added regression coverage for proof scoring, Flight Recorder redaction/private storage, replay forks and CodeCraft-only Arena behavior.

## 0.11.3

Released: 2026-10-05.

- Refined the terminal UX with a Claude-inspired activity treatment: `✻ Thinking…`, task-aware verbs such as Searching, Reading, Tracing symbols, Running tests, Reviewing the diff, and compact “Thought for …” completion copy.
- Added `/style claude|classic|minimal` for terminal glyph/emphasis profiles. The actual font family remains controlled by the terminal emulator.
- Reworked connector discovery to show authentication UX explicitly: Browser approval, Token / existing login, Local service, or Direct.
- `/connect vercel` now presents browser/device approval instead of a “needs Vercel CLI” dead end. Craft Code invokes `npx -y vercel@latest` transiently, so no global Vercel CLI installation is required.
- Kept browser OAuth automatic for MCP connectors that support it and kept truthful token/local labels for connectors that do not.
- Added regression coverage for activity rendering, style switching, Vercel auth metadata, and connector picker copy.

## 0.11.2

Released: 2026-10-05.

- Ships the long-session HTTP 400 recovery fix on a new immutable npm version because 0.11.1 had already been published.
- Adds model-window-aware context budgeting, proactive compaction, provider context-error retry, interrupted tool-call repair, context-pressure UX, and `/doctor` session health checks.

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
