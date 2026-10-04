# Architecture

Craft Code separates model inference from agent execution and extensions.

```text
Terminal TUI
    │
    ▼
AgentSession ─── ToolRegistry ─── filesystem / shell / Git
    │                  │
    │                  ├── Skills (lazy SKILL.md)
    │                  ├── Plugins (local + Claude-style)
    │                  ├── MCP connectors (lazy tool discovery)
    │                  └── Subagents / worktrees
    ▼
CodeCraftClient
    │
    ▼
CodeCraft /v1/chat/completions
```

## Design priorities

1. **Visible permissions** — edits, shell execution and external actions are never silently promoted.
2. **Token efficiency** — skills and MCP schemas are lazy-loaded; file reads and command output are bounded.
3. **Recoverability** — sessions persist and build-mode changes create checkpoints for undo.
4. **Extensibility** — skills, plugins and MCP stay outside the core inference client.
5. **General-purpose use** — no project-specific behavior is hard-coded into the agent.
