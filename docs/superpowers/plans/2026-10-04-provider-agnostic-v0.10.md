# Provider-Agnostic v0.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Craft Code run on CodeCraft, OpenRouter, and user-configured OpenAI-compatible providers without changing the agent/tool runtime.

**Architecture:** Extract the current fetch/SSE/tool-call transport into a generic OpenAI-compatible client, compose provider-specific behavior around it, and resolve providers/credentials through small registries. Keep AgentSession and ToolRegistry provider-neutral; runtime provider switching only swaps the client/model references owned by the top-level CLI.

**Tech Stack:** Node.js 20+, native fetch/ReadableStream, existing node:test suite, no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-04-provider-agnostic-architecture-design.md`

## Global Constraints

- Preserve existing CodeCraft auth, rate pacing, plan hints, sessions, long-turn continuation, tools, MCP, plugins, and subagents.
- v0.10 adds CodeCraft, OpenRouter, and generic OpenAI-compatible providers only.
- Keep npm package name `craftcode-codecraft`.
- Never store API keys in project configuration or print full credentials.
- A provider key must never be reused for another provider/base URL.
- Do not fabricate plan/rate metadata for providers that do not expose it.
- No new provider SDK dependency.

## Review Focus

- A custom provider with no API key requirement must not receive another provider's Authorization header.
- Switching provider during a session must refresh models and update both main and subagent clients.
- A legacy session/config/auth file must still behave as CodeCraft.
- An OpenRouter model explicitly lacking `tools` must be visibly marked/rejected for agentic use rather than silently misbehaving.
- A provider without TPM metadata must not inherit CodeCraft's adaptive rate assumptions.

---

### Task 1: Provider transport, registry, and credentials

**Files:**
- Create: `src/providers/openai-compatible.mjs`
- Create: `src/providers/codecraft.mjs`
- Create: `src/providers/openrouter.mjs`
- Create: `src/providers/index.mjs`
- Modify: `src/codecraft.mjs`
- Modify: `src/auth.mjs`
- Modify: `src/config.mjs`
- Test: `test/basic.test.mjs`

**Interfaces:**
- Produces: `OpenAICompatibleClient`, `CodeCraftClient`, `OpenRouterClient`, `ProviderRegistry`, `normalizeProviderConfig(config)`, `resolveProviderApiKey(providerId, providerConfig)`, `saveProviderApiKey(providerId,key)`, `clearProviderApiKey(providerId)`.
- Consumes: existing CodeCraft stream/result contract.

- [ ] Write failing tests for generic SSE/tool parsing, OpenRouter headers/capabilities, provider config normalization, legacy CodeCraft auth resolution, provider-scoped env credentials, and credential isolation.
- [ ] Run PR CI and confirm the new tests fail because provider modules/functions do not yet exist.
- [ ] Implement the generic transport and provider adapters with CodeCraft compatibility re-export.
- [ ] Implement provider config normalization and scoped credential storage with legacy read compatibility.
- [ ] Run full tests and confirm green.
- [ ] Commit Task 1.

### Task 2: Runtime provider switching and provider-aware TUI

**Files:**
- Modify: `src/index.mjs`
- Modify: `src/tui.mjs`
- Modify: `src/agents.mjs`
- Test: `test/basic.test.mjs`

**Interfaces:**
- Consumes: Task 1 ProviderRegistry and credential API.
- Produces: active-provider startup, `/provider`, `/providers`, provider-aware `/model` and `/status`, provider-aware auth CLI, safe client swapping.

- [ ] Write failing tests for provider command discoverability/picker metadata and provider-qualified runtime state helpers.
- [ ] Run PR CI and confirm red.
- [ ] Replace CodeCraft-specific startup construction with ProviderRegistry resolution.
- [ ] Add `craftcode auth login|logout|status [provider]`.
- [ ] Add `/provider [id]` and `/providers`; switching refreshes model list and updates AgentSession/AgentManager client references.
- [ ] Update TUI metadata/help/model wording to provider-neutral terminology.
- [ ] Run full tests and confirm green.
- [ ] Commit Task 2.

### Task 3: Provider-aware sessions, docs, and release surface

**Files:**
- Modify: `src/sessions.mjs`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/COMMANDS.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Test: `test/basic.test.mjs`

**Interfaces:**
- Consumes: active provider id from Task 2.
- Produces: session `provider` field, legacy session fallback to CodeCraft, v0.10.0 documentation/package metadata.

- [ ] Write failing tests for provider persistence and legacy session fallback.
- [ ] Run PR CI and confirm red.
- [ ] Save/list/export provider identity and restore provider before model on resume.
- [ ] Update user-facing docs for OpenRouter API-key login, provider switching, custom OpenAI-compatible config, and CodeCraft compatibility.
- [ ] Bump package/runtime version to `0.10.0`.
- [ ] Run full 9-job CI matrix and package smoke test.
- [ ] Commit Task 3.

## Final verification

- Existing CodeCraft tests stay green.
- OpenRouter stream/tool-call unit test is green.
- Credential isolation tests are green.
- Provider switch/model refresh tests are green.
- Session migration tests are green.
- Full CI: Node 20/22/24 × Ubuntu/Windows/macOS.
- npm publish only after the verified feature branch is merged with a `release: publish npm 0.10.0` commit title.
