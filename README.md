<div align="center">

<img src="./assets/craftcode-banner.svg" alt="Craft Code — CodeCraft-native terminal coding agent" width="100%" />

<br />

[![npm version](https://img.shields.io/npm/v/craftcode-codecraft?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/craftcode-codecraft)
[![CI](https://img.shields.io/github/actions/workflow/status/AIM-IT4/craftcode-CLI/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/AIM-IT4/craftcode-CLI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-f0c36a?style=flat-square)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm downloads](https://img.shields.io/npm/dm/craftcode-codecraft?style=flat-square&color=6f7bf7)](https://www.npmjs.com/package/craftcode-codecraft)

**A CodeCraft-native coding & research agent for your terminal.**

Full-screen TUI · persistent sessions · parallel subagents · skills · Claude-style plugins · MCP/OAuth connectors · explicit permissions · token-aware execution

[Website](https://aim-it4.github.io/craftcode-CLI/) · [Quick start](#quick-start) · [Features](#what-you-get) · [Commands](docs/COMMANDS.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## Quick start

```bash
npm install -g craftcode-codecraft
craftcode auth login
craftcode .
```

Authenticate once, then use Craft Code from any terminal. Your CodeCraft key is stored under your user profile, never inside the repository.

```bash
# Windows
craftcode C:\Users\you\project

# macOS / Linux
craftcode /path/to/project

# Continue the latest session
craftcode -c /path/to/project
```

<div align="center">
  <img src="./assets/tui-preview.svg" alt="Craft Code terminal interface preview" width="100%" />
  <sub>Illustrative TUI preview — actual content, models and usage depend on your workspace and CodeCraft account.</sub>
</div>

## Why Craft Code?

Most coding agents hide at least one important thing: context growth, permission boundaries, connector actions, or how much model usage a task is consuming. Craft Code keeps those controls visible while still giving you a fast agentic workflow.

| Capability | Craft Code |
|---|---|
| Terminal UX | Full-screen interactive TUI with streaming, command palette, inline tool activity and clickable controls |
| Sessions | Search, resume, rename, fork, export and optional per-workspace auto-resume |
| Agents | Parallel bounded subagents; writer agents use isolated Git worktrees |
| Context | `@file` references, compaction, project instructions and bounded reads |
| Skills | Lazy `SKILL.md` loading with `.claude/skills` and `.agents/skills` compatibility |
| Plugins | Claude-style marketplaces, commands, skills and opt-in lifecycle hooks |
| Connectors | MCP over stdio/HTTP with OAuth support where available |
| Safety | Ask/Edit/Auto/Read-only permission presets, checkpoints and undo |
| Tokens | Per-request/session/day/plan accounting, lazy schemas and CodeCraft 429 retry handling |

## What you get

### Professional terminal workflow

- Streaming responses with inline `Thinking…`, search, read, edit, test and review activity.
- Native terminal drag-selection + `Ctrl+C` copying works by default. Clickable mouse controls are optional via `/mouse on`; `/mouse off` restores native selection.
- Inline red/green code edit previews directly under edit tool cards.
- Interactive `/model`, `/mode`, `/effort`, `/permissions` and `/usage` controls, with a compact keyboard-first footer that never overlaps transcript output.
- File attachment/autocomplete with `@path/to/file`.
- Git checkpoints and `/undo`.
- Shell shortcut syntax such as `!git status` through the normal permission layer.

### Persistent sessions

```text
/sessions                    searchable session picker
/resume                      resume latest
/session name Checkout fix   rename current session
/session fork                branch the conversation
/session export              export transcript to Markdown
/session delete              remove current session
/settings autoresume on      reopen latest workspace session automatically
```

From the shell:

```bash
craftcode continue /path/to/project
craftcode -c /path/to/project
```

### Parallel subagents

```text
/agents
/agent spawn explorer "Find the auth flow"
/agent spawn reviewer "Review the checkout diff"
/team 3 "Investigate this regression from different angles"
```

Read-only workers can run concurrently with individual token ceilings. Writer agents are isolated in Git worktrees so concurrent edits do not collide with your main working tree.

### Skills and Claude-style plugins

Skills are indexed by name/description and loaded only when relevant, instead of injecting every instruction into every model request.

```text
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Lifecycle hooks remain opt-in because installed plugins may execute local commands.

### Web, repositories and connectors

Use:

```text
/connect
/mcp
```

Craft Code supports stdio and HTTP MCP transports, lazy tool discovery and browser OAuth where the server supports it. GitHub, Vercel, Supabase and other MCP services can sit behind the same permission model as local shell/file actions.

### Project-native instructions

Craft Code automatically picks up bounded instructions from:

```text
AGENTS.md
CLAUDE.md
.github/copilot-instructions.md
```

Useful commands:

```text
/init
/instructions
/instructions reload
/context
/status
/compact
```

## Permissions

| Preset | File edits | Shell commands |
|---|---|---|
| **Ask** | Ask | Ask |
| **Edit** | Allow | Ask |
| **Auto** | Allow | Allow |
| **Read only** | Deny | Deny |

External MCP actions are permission-gated as well. Plugin lifecycle hooks are disabled until explicitly enabled.

## Token-aware by design

Craft Code was built to avoid common agent-token waste:

- search before broad reads;
- bounded file/search/terminal output;
- lazy skill loading;
- lazy MCP tool-schema discovery;
- context compaction;
- per-agent budgets and TPM-aware parallelism;
- visible request/session/day/month usage;
- adaptive CodeCraft TPM pacing using live rate-limit headers, `Retry-After`/reset-aware retries, and TPM-aware subagent concurrency.

> [!IMPORTANT]
> The plan allowance shown in Craft Code is inferred from CodeCraft rate-limit metadata when possible. Historical usage outside Craft Code cannot be reconstructed from the public API, so use `/usage set <tokens>` if you need to reconcile the local counter with your CodeCraft dashboard.

## Update

```bash
craftcode update
```

or:

```bash
npm install -g craftcode-codecraft@latest
```

## Development

```bash
git clone https://github.com/AIM-IT4/craftcode-CLI.git
cd craftcode-CLI
npm install
npm test
node src/index.mjs --version
```

Requires Node.js 20+.

Repository docs:

- [Command reference](docs/COMMANDS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Security

Treat repositories, skills, plugins and MCP output as untrusted input. Do not commit API keys or OAuth credentials. Security-sensitive reports should use GitHub private vulnerability reporting rather than public issues.

See [SECURITY.md](SECURITY.md).

## Project status

Craft Code is an independent open-source project and is evolving quickly. It is not affiliated with Anthropic, OpenAI, GitHub, Vercel, Supabase or CodeCraft unless explicitly stated by those projects.

Issues and pull requests are welcome.

## License

MIT © Craft Code contributors. See [LICENSE](LICENSE).
