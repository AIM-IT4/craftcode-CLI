# Provider-Agnostic Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Craft Code provider-agnostic while preserving CodeCraft behavior and adding OpenRouter plus custom OpenAI-compatible providers.

**Architecture:** Extract the current OpenAI-compatible streaming/model transport, wrap CodeCraft-specific pacing/plan logic as an adapter, add a provider registry and provider-scoped credentials, then wire the CLI/session runtime through the registry. Keep AgentSession and ToolRegistry protocol-stable.

**Tech Stack:** Node.js 20+, ESM, built-in fetch/Web Streams, node:test, existing GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-10-04-provider-agnostic-architecture-design.md`

## Global Constraints

- Keep npm package name `craftcode-codecraft` in v0.10.
- Keep existing CodeCraft auth/config/session behavior backward compatible.
- Do not add provider SDK dependencies.
- Credentials never belong in project config.
- v0.10 supports CodeCraft, OpenRouter, and generic OpenAI-compatible endpoints only.
- No automatic cross-provider fallback or model routing in v0.10.
- Full Node 20/22/24 × Ubuntu/Windows/macOS CI must pass before release.

## Review Focus

- Legacy `codecraftApiKey` still resolves after credential migration.
- Provider switching cannot reuse another provider's key.
- Generic endpoints with no auth remain usable when configured as such.
- OpenRouter/tool capability metadata can be absent without falsely claiming support.
- Legacy sessions without a provider field resume as CodeCraft.

---

### Task 1: Shared OpenAI-Compatible Transport

**Files:**
- Create: `src/providers/openai-compatible.mjs`
- Create: `src/providers/codecraft.mjs`
- Modify: `src/codecraft.mjs`
- Modify: `test/basic.test.mjs`

**Interfaces:**
- Produces: `OpenAICompatibleProvider`, `CodeCraftProvider` with `models()`, `stream()`, `rateProfile()`, `capabilities()`.
- Consumes: existing CodeCraft streaming/rate-limit behavior.

- [ ] Write regression tests that the CodeCraft adapter preserves current normalized streaming, AbortSignal, tool-call accumulation and plan hints.
- [ ] Run tests and confirm RED because provider modules do not exist.
- [ ] Extract shared transport and CodeCraft-specific adapter with no agent-loop changes.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit.

### Task 2: Provider-Scoped Credentials and Registry

**Files:**
- Create: `src/providers/index.mjs`
- Modify: `src/auth.mjs`
- Modify: `src/config.mjs`
- Modify: `test/basic.test.mjs`

**Interfaces:**
- Produces: `ProviderRegistry`, `resolveProviderApiKey(providerId, config)`, provider-scoped save/clear helpers.
- Consumes: provider adapters from Task 1.

- [ ] Add failing tests for legacy CodeCraft key compatibility, OpenRouter env precedence, key isolation, provider normalization, and custom endpoint validation.
- [ ] Run tests and confirm RED.
- [ ] Implement minimal registry/config/auth migration.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit.

### Task 3: OpenRouter and Generic Provider Support

**Files:**
- Create: `src/providers/openrouter.mjs`
- Modify: `src/providers/index.mjs`
- Modify: `test/basic.test.mjs`

**Interfaces:**
- Produces: OpenRouter adapter using the shared transport; generic `openai-compatible` provider instantiation.
- Consumes: Task 1 transport and Task 2 credential/config resolution.

- [ ] Add failing tests for OpenRouter base URL/headers/models and generic endpoint auth/no-auth behavior.
- [ ] Run tests and confirm RED.
- [ ] Implement adapters and capability normalization.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit.

### Task 4: Wire Runtime, Auth CLI, Provider Commands, and Sessions

**Files:**
- Modify: `src/index.mjs`
- Modify: `src/sessions.mjs`
- Modify: `src/tui.mjs`
- Modify: `src/agents.mjs`
- Modify: `test/basic.test.mjs`

**Interfaces:**
- Produces: `craftcode auth login <provider>`, `/provider`, `/providers`, provider-aware `/model`, `/status`, and provider persistence in sessions.
- Consumes: ProviderRegistry and credential helpers.

- [ ] Add failing tests for auth target parsing, provider-aware session persistence/legacy resume, provider switching, and provider status text.
- [ ] Run tests and confirm RED.
- [ ] Replace startup CodeCraftClient construction with ProviderRegistry resolution.
- [ ] Make subagents inherit active provider/client.
- [ ] Persist provider with sessions; legacy missing provider means CodeCraft.
- [ ] Run focused tests and full `npm test`.
- [ ] Commit.

### Task 5: Documentation, Version, and Release Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/COMMANDS.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `src/index.mjs`

**Interfaces:**
- Produces: v0.10.0 documentation and release metadata.

- [ ] Update positioning to provider-agnostic and document CodeCraft/OpenRouter/custom setup.
- [ ] Set version to `0.10.0`.
- [ ] Run `npm test` and CLI version smoke test in CI.
- [ ] Review branch diff against the spec acceptance checklist.
- [ ] Merge with `release: publish npm 0.10.0` only after full matrix green.
