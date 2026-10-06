# Architecture

Craft Code separates model inference from agent execution and extensions.

```text
Terminal TUI
    │
    ▼
AgentSession ─── ToolRegistry ─── filesystem / shell / Git
    │
    ├── ProofTracker (observed verification evidence)
    └── FlightRecorder (local step metadata + replay boundaries)
    │                  │
    │                  ├── Skills (lazy SKILL.md)
    │                  ├── Plugins (local + Claude-style)
    │                  ├── MCP connectors (lazy tool discovery)
    │                  └── Subagents / worktrees
    ▼
ProviderRegistry
    │
    ├── CodeCraftClient
    ├── OpenRouterClient
    └── OpenAICompatibleClient
            │
            ▼
      configured provider API
```

## Design priorities

1. **Visible permissions** — edits, shell execution and external actions are never silently promoted.
2. **Token efficiency** — skills and MCP schemas are lazy-loaded; file reads and command output are bounded.
3. **Recoverability** — sessions persist and build-mode changes create checkpoints for undo.
4. **Extensibility** — skills, plugins and MCP stay outside the core inference client.
5. **General-purpose use** — no project-specific behavior is hard-coded into the agent.
6. **Auditable execution** — proof scores come from observed tool evidence, while Flight logs preserve decision boundaries without duplicating full tool output.
7. **Single-provider first** — advanced orchestration and Patch Arena work with CodeCraft alone; extra providers are optional accelerators, never prerequisites.


## Provider boundary

`AgentSession` depends on a normalized provider client contract: model discovery, streaming assistant/tool-call messages, optional capability metadata, and optional rate metadata. Provider-specific authentication, headers, plan hints, and API quirks stay under `src/providers/`.

Credentials are provider-scoped in `~/.craftcli/auth.json`; legacy `codecraftApiKey` credentials remain readable. OpenRouter uses its OpenAI-compatible `/api/v1` interface, while custom providers can supply any compatible base URL.


## Trust and replay

`AgentSession` emits structured trace events for turn boundaries, model requests/responses, tool calls, repair/compaction events and completion state. `FlightRecorder` persists a bounded local JSONL timeline under the user-level Craft Code directory with private file permissions where supported. Tool outputs are represented by hashes and sizes rather than copied verbatim.

Saved sessions remain the source of truth for conversation content. Replay forks a saved message prefix at a recorded boundary. Context compaction increments an epoch; replay refuses boundaries from an older epoch when a later compaction means the exact prior context is no longer reconstructable.

`ProofTracker` observes successful mutations and verification activity during the same turn. It does not ask the model to rate itself. Patch Arena reuses isolated writer worktrees and the same proof reports for deterministic candidate ranking. The default Arena candidate set contains only the active provider, so CodeCraft-only installations receive the full feature set.


## Automatic capability routing

The runtime keeps capability decisions deterministic where possible. Skill routing scores only local skill metadata and loads the highest-relevance skills that fit the configured count/token budget. Provider image generation is exposed only when model metadata or explicit provider configuration confirms support; image bytes bypass conversation context and are written directly to the workspace.

UI/web mutations are tracked by ProofTracker. Before finalization, AgentSession injects a browser-verification gate when a changed path is classified as a UI surface. Playwright tool discovery is lazy. Read-only snapshots, screenshots, console/network inspection and localhost navigation can run automatically; state-changing interactions still use the ordinary permission layer. A git push attempted before required browser evidence is blocked inside the agent loop.
