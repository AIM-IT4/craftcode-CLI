<div align="center">

# Craft Code

**A CodeCraft-native coding & research agent for your terminal.**

Full-screen TUI · resumable sessions · parallel subagents · skills · Claude-style plugins · MCP connectors · OAuth · permissions · token guards

[![npm version](https://img.shields.io/npm/v/craftcode-codecraft?color=cb3837&logo=npm)](https://www.npmjs.com/package/craftcode-codecraft)
[![CI](https://github.com/AIM-IT4/craftcode-CLI/actions/workflows/ci.yml/badge.svg)](https://github.com/AIM-IT4/craftcode-CLI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[Install](#install) · [Features](#features) · [Sessions](#sessions) · [Agents](#parallel-agents) · [Plugins & Skills](#plugins--skills) · [Connectors](#connectors) · [Contributing](CONTRIBUTING.md)

</div>

> [!NOTE]
> Craft Code is an independent open-source client for the CodeCraft API. It is not affiliated with Anthropic, OpenAI, GitHub, Vercel, Supabase, or CodeCraft unless explicitly stated by those projects.

## Why Craft Code?

Craft Code is built for people who want a serious terminal coding agent without hiding model usage, permissions, context, or external actions. It keeps token economics visible, supports reusable skills and plugins, and can delegate bounded tasks to parallel subagents.

## Install

```bash
npm install -g craftcode-codecraft
craftcode auth login
craftcode .
```

Authenticate once. The CodeCraft key is validated and stored in your user profile (`~/.craftcli/auth.json`), never in the repository. `CODECRAFT_API_KEY` can still override the stored credential.

```bash
craftcode C:\\Users\\you\\project
# or
craftcode /path/to/project
```

Update later with:

```bash
craftcode update
```

## Features

- **Full-screen terminal UI** with streaming responses, inline activity, command palette, interactive model/mode/permission controls and usage indicators.
- **Plan / Build modes** with explicit write and shell permissions.
- **Persistent sessions** with search, resume, rename, fork, export and per-workspace auto-resume.
- **Parallel subagents** with per-agent token ceilings and isolated Git worktrees for writer agents.
- **Skills** loaded lazily from `SKILL.md`, including `.claude/skills` and `.agents/skills` compatibility.
- **Claude-style plugin marketplaces** with commands, skills, optional lifecycle hooks and plugin-provided MCP servers.
- **MCP connectors** over stdio or HTTP with OAuth support where the server supports it.
- **Project instructions** from `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md`.
- **Git checkpoints and undo** for agent file changes.
- **Token guards** with request/session/day/plan accounting and lazy context loading.
- **CodeCraft rate-limit handling** that respects `Retry-After` and retries 429 responses instead of killing the turn.

## Sessions

Resume the latest workspace session from the shell:

```bash
craftcode continue C:\\Users\\you\\project
craftcode -c C:\\Users\\you\\project
craftcode --resume C:\\Users\\you\\project
```

Inside Craft Code:

```text
/sessions                    searchable session picker
/sessions search checkout    filter old sessions
/resume                      resume latest
/resume <id-or-title>        resume a matching session
/session name Checkout fix   name current session
/session fork                branch the conversation
/session export              export transcript to Markdown
/session delete              delete current session
/settings autoresume on      reopen latest workspace session automatically
```

## Project instructions & context

Craft Code automatically loads bounded top-level instructions from `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`.

```text
/init                  create a starter AGENTS.md
/instructions          inspect loaded instructions
/instructions reload   reload after editing
/context               inspect estimated context composition
/status                workspace/model/Git/extensions/usage summary
/compact               compact older conversation context
```

## Parallel agents

```text
/agents
/agent spawn explorer <task>
/agent spawn writer <task>
/team 3 <task>
```

Read-only workers can run concurrently with individual token budgets. Writer agents use isolated Git worktrees so concurrent changes do not collide with your main tree.

## Plugins & skills

Craft Code discovers `SKILL.md` lazily and supports Claude-style plugin marketplaces.

```text
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Lifecycle hooks are intentionally opt-in because installed plugins may execute local commands.

## Connectors

Use `/connect` to manage MCP connectors. Craft Code supports stdio and HTTP MCP servers, plus browser OAuth where supported. External MCP actions obey the same permission model as file and shell actions.

Typical integrations include GitHub, Vercel, Supabase and research/developer MCP servers.

## Permissions

Craft Code keeps permissions visible and configurable:

| Mode | File edits | Shell commands |
|---|---|---|
| Ask | Ask | Ask |
| Edit | Allow | Ask |
| Auto | Allow | Allow |
| Read only | Deny | Deny |

Use `/permissions` or the interactive permission control in the TUI.

## Shell shortcuts

Prefix a prompt with `!` to execute through Craft Code's normal permission layer:

```text
!git status
!npm test
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

## Security

Please read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Do not open public issues containing API keys, credentials, private source code or exploit details.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT © contributors. See [LICENSE](LICENSE).
