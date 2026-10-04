# Craft Code v0.10 Provider-Agnostic Architecture

Date: 2026-10-04  
Status: Proposed / approved direction, implementation pending  
Target: v0.10.0

## 1. Purpose

Craft Code becomes a provider-agnostic terminal coding agent. CodeCraft remains fully supported, but it is one provider adapter rather than the identity or runtime assumption of the product.

The first v0.10 provider set is deliberately small:

1. CodeCraft — backward-compatible adapter preserving current rate-limit and plan behavior.
2. OpenRouter — first new hosted provider.
3. Generic OpenAI-compatible endpoint — covers self-hosted and third-party endpoints that implement the Chat Completions/tool-calling contract.

Native Anthropic, OpenAI Responses, Gemini, automatic model routing, provider fallback, and OpenCode configuration import are explicitly deferred to later releases.

## 2. Success criteria

v0.10 is successful when:

- Existing CodeCraft users can upgrade without losing saved credentials, model selection, usage tracking, TPM pacing, sessions, tools, MCP, plugins, or subagents.
- A new user can select OpenRouter, authenticate once, choose a tool-capable model, and run the same Craft Code agent/tool loop.
- A user can configure a custom OpenAI-compatible base URL and model without changing Craft Code source.
- AgentSession, ToolRegistry, TUI, MCP, plugins, sessions, checkpoints, browser tools, and Git behavior contain no CodeCraft-specific request logic.
- Provider-specific rate metadata and capabilities are exposed through one normalized client contract.
- Unsupported model capabilities fail clearly before or at the relevant operation rather than silently degrading.
- Credentials remain outside project repositories.

## 3. Non-goals for v0.10

- Do not rename the npm package. Keep `craftcode-codecraft` for compatibility; package renaming is a separate migration.
- Do not embed or depend on OpenCode.
- Do not implement native Anthropic, Gemini, or OpenAI Responses APIs yet.
- Do not implement automatic cross-provider failover yet.
- Do not implement cost-optimized automatic model routing yet.
- Do not add a new provider SDK dependency unless the current fetch-based transport cannot support a required contract.
- Do not change the agent/tool protocol merely to match a provider-specific feature.

## 4. Current coupling to remove

Today provider-specific behavior is concentrated in:

- `src/codecraft.mjs` — model listing, streaming, rate-limit parsing, TPM pacing, plan hints.
- `src/auth.mjs` — single CodeCraft credential.
- `src/config.mjs` — CodeCraft base URL/model defaults and plan assumptions.
- `src/index.mjs` — CodeCraft-specific startup/auth/model/status text.
- README/site copy — describes Craft Code as CodeCraft-native.

The rest of the runtime is already close to provider-neutral because `AgentSession` only needs a client that can stream messages and tool calls, expose models, and expose a rate profile.

## 5. Provider contract

Create a small internal provider contract; do not introduce an abstract class hierarchy.

A provider client must expose:

```js
{
  id,
  label,
  models({ signal }),
  stream({ model, messages, tools, signal, onText }),
  capabilities(model),
  rateProfile(),
  planHint?.(),
  setRateLimitHandler?.(handler)
}
```

### 5.1 Normalized stream result

```js
{
  message: {
    role: "assistant",
    content: string | null,
    tool_calls?: [...]
  },
  usage: {
    prompt_tokens?: number,
    completion_tokens?: number,
    total_tokens?: number
  } | null,
  finishReason: string | null
}
```

This is intentionally compatible with the current AgentSession loop so the agent runtime does not need a rewrite.

### 5.2 Capabilities

Normalize at least:

```js
{
  tools: boolean | "unknown",
  reasoning: boolean | "unknown",
  vision: boolean | "unknown",
  structuredOutput: boolean | "unknown",
  contextWindow: number | null
}
```

For OpenRouter, model metadata should be used when available. Tool support is model-specific; do not assume every OpenRouter model can call tools.

For generic OpenAI-compatible endpoints, capabilities may be `unknown` unless supplied by config or model metadata.

Craft Code may proceed when a capability is unknown, but must surface a precise provider/model error if a requested feature is rejected.

## 6. Module layout

Target layout:

```text
src/providers/
  index.mjs
  openai-compatible.mjs
  codecraft.mjs
  openrouter.mjs
```

Responsibilities:

### `providers/index.mjs`
- Provider registry.
- Resolve configured/current provider.
- Instantiate the correct adapter.
- Return provider summaries for UI.
- No HTTP parsing logic.

### `providers/openai-compatible.mjs`
- Shared fetch-based Chat Completions transport.
- SSE streaming parser.
- Tool-call accumulation.
- Model listing from `/models`.
- Generic bearer authentication.
- Generic retry hooks for 429/5xx where safe.
- No CodeCraft plan assumptions.

### `providers/codecraft.mjs`
- Extends/composes the OpenAI-compatible transport.
- CodeCraft base URL default.
- Existing CodeCraft rate headers.
- Existing TPM proactive pacing.
- Existing RPM-to-plan hint mapping.
- CodeCraft-specific auth/error wording.

### `providers/openrouter.mjs`
- Extends/composes the OpenAI-compatible transport.
- Default base URL `https://openrouter.ai/api/v1`.
- OpenRouter API key.
- OpenRouter model metadata normalization.
- Optional identifying headers configured by Craft Code.
- Tool capability extraction where model metadata exposes supported parameters.
- No Craft-specific automatic routing in v0.10.

The old `src/codecraft.mjs` becomes a temporary compatibility re-export or is removed only after all imports and tests migrate.

## 7. Configuration model

Move from a single provider-shaped root config to a provider registry while retaining legacy fields during migration.

Target:

```json
{
  "provider": "codecraft",
  "model": "",
  "providers": {
    "codecraft": {
      "type": "codecraft",
      "baseUrl": "https://codecraftapi.com/v1"
    },
    "openrouter": {
      "type": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1"
    },
    "local": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "apiKeyEnv": "LOCAL_LLM_API_KEY",
      "models": []
    }
  }
}
```

### 7.1 Migration

Increment config version.

Legacy:

```json
{
  "baseUrl": "https://codecraftapi.com/v1",
  "model": "..."
}
```

is interpreted as CodeCraft unless `provider` is explicitly set.

Do not rewrite user config just to migrate it. Load legacy values into the normalized in-memory configuration. Only future explicit settings writes use the new structure.

`CODECRAFT_MODEL` remains supported. Add `CRAFTCODE_PROVIDER` and provider-specific model/env overrides later only where necessary; avoid an explosion of environment variables in v0.10.

## 8. Credential store

Replace the single-key shape with provider-scoped credentials while reading the old key.

Target conceptual shape:

```json
{
  "providers": {
    "codecraft": { "apiKey": "..." },
    "openrouter": { "apiKey": "..." },
    "custom-id": { "apiKey": "..." }
  },
  "updatedAt": "..."
}
```

Migration rule:

- If `codecraftApiKey` exists and `providers.codecraft.apiKey` does not, resolve it as the CodeCraft credential.
- Do not delete the legacy field during read-only migration.
- The first explicit CodeCraft credential write may migrate it to the provider-scoped form.
- Continue using restrictive file permissions where supported.

Environment precedence:

1. Explicit provider environment variable, e.g. `OPENROUTER_API_KEY`, `CODECRAFT_API_KEY`.
2. Stored provider credential.
3. No credential.

Generic OpenAI-compatible providers may use a configured `apiKeyEnv`; endpoints that do not require authentication can explicitly opt out.

## 9. CLI and TUI UX

### 9.1 Authentication

Support:

```text
craftcode auth status
craftcode auth login
craftcode auth login openrouter
craftcode auth login codecraft
craftcode auth logout openrouter
```

With no provider argument, operate on the active provider.

The prompt must name the provider being authenticated.

### 9.2 Provider selection

Add:

```text
/providers
/provider
/provider codecraft
/provider openrouter
/provider local
```

`/provider` opens a picker. Switching provider refreshes the available model catalog and selects a valid model without restarting the TUI.

Do not overload `/connect`; that command remains for external integrations/MCP services. Model providers are runtime infrastructure, not connectors.

### 9.3 Model picker

The picker displays provider-qualified context where useful:

```text
OpenRouter
  anthropic/...
  openai/...
  google/...
```

Only models returned/configured for the active provider are selectable.

If model metadata states that tools are unsupported, mark that visibly and prevent starting an agentic Build turn with tools enabled unless the user deliberately chooses a text-only workflow in a future feature.

### 9.4 Status/footer

`/status` includes:

- Provider.
- Model.
- Provider rate data if known.
- Local Craft Code usage counters.
- Provider plan hint only if the adapter can actually infer it.

The footer should show provider compactly without crowding the existing model/mode/effort controls.

## 10. Usage and rate-limit semantics

Current CodeCraft monthly plan inference is provider-specific and must not become a fake universal metric.

Normalize two concepts:

### Local usage
Craft Code's observed token usage during its own requests. Always available when provider usage is returned.

### Provider limits
Adapter-specific rate/plan metadata. May be unavailable.

For CodeCraft:
- preserve current RPM/TPM parsing;
- preserve proactive pacing;
- preserve CodeCraft plan hint behavior.

For OpenRouter:
- expose whatever reliable current rate metadata the response provides;
- do not invent monthly allowance from unrelated rate headers.

For generic endpoints:
- rate profile may be empty.

AgentSession's adaptive step/parallel logic uses normalized TPM only when supplied. If the provider does not expose TPM, retain the existing conservative fallback behavior rather than guessing a provider limit.

## 11. Agent and subagent behavior

AgentSession must depend only on the normalized provider contract.

Subagents initially inherit the active provider and the existing subagent model-selection heuristic from that provider's model list.

No cross-provider subagent routing in v0.10.

Sessions must persist provider identity alongside model so a resumed session can restore the correct runtime. Legacy sessions without a provider are treated as CodeCraft sessions.

Suggested session fields:

```json
{
  "provider": "openrouter",
  "model": "provider/model",
  "messages": []
}
```

If the saved provider is unavailable or unauthenticated, resume must stop with an actionable provider-auth message rather than silently substituting another provider.

## 12. Error handling

Provider errors must be normalized enough to be understandable without hiding the original status/message.

Examples:

- Authentication: `OpenRouter authentication failed (401). Run craftcode auth login openrouter.`
- Unsupported tool model: `Model X does not expose tool calling on OpenRouter; choose a tool-capable model.`
- Missing custom endpoint: `Provider local has no baseUrl.`
- Model missing after provider switch: prompt/select another model rather than sending a doomed request.
- 429: use provider retry metadata when available; otherwise bounded exponential retry as today.
- Streaming protocol failure: include provider ID and preserve partial streamed text in the transcript where possible.

Do not silently fall back to another provider in v0.10.

## 13. Security

- Never store API keys in repository config.
- Never print full credentials.
- Keep auth file restrictive where the OS supports chmod semantics.
- Custom endpoints must be explicit user configuration.
- Do not send OpenRouter-identifying headers to unrelated generic endpoints.
- Do not send one provider's key to another provider's base URL.
- Provider switching must re-resolve credentials from the selected provider rather than reuse an in-memory key.

## 14. Backward compatibility

Required:

- `craftcode auth login` continues to authenticate CodeCraft for existing installations where CodeCraft remains active/default.
- `CODECRAFT_API_KEY` continues to work.
- Existing global/project configs load.
- Existing CodeCraft model selection loads.
- Existing sessions without a provider field resume as CodeCraft.
- Existing CodeCraft rate pacing remains intact.
- The npm binary names remain `craftcode` and `craftcli`.
- The package name remains `craftcode-codecraft` for v0.10.

A fresh installation may still default to CodeCraft in v0.10 to minimize migration risk. Changing the default onboarding/provider is a later product decision.

## 15. Documentation/product copy

After implementation is verified:

- Change primary positioning from "CodeCraft-native" to "provider-agnostic".
- Document CodeCraft, OpenRouter, and custom OpenAI-compatible setup.
- Keep CodeCraft-specific usage/rate-limit documentation in a provider section.
- Update architecture docs to show ProviderRegistry below AgentSession.
- Update the website provider section, but do not redesign the site as part of this release.

## 16. Test strategy

Follow red-green development for each migration boundary.

Minimum tests:

### Provider contract
- CodeCraft adapter returns the same normalized tool-call stream as current code.
- OpenRouter-compatible stream accumulates content, multiple tool calls, usage, and finish reason.
- Generic OpenAI-compatible adapter uses configured base URL and auth behavior.
- AbortSignal still cancels active streams.
- 429 retry behavior remains bounded.

### Capability handling
- Tool-supported model accepted.
- Explicitly tool-unsupported model produces actionable rejection.
- Unknown capability does not get falsely reported as supported.

### Credentials
- Legacy `codecraftApiKey` resolves.
- New provider-scoped CodeCraft credential resolves.
- `OPENROUTER_API_KEY` overrides stored OpenRouter credential.
- Switching providers never reuses another provider's credential.
- Masked status never exposes the full key.

### Configuration
- Legacy config normalizes to CodeCraft.
- New provider config resolves selected provider.
- Custom endpoint validation rejects missing/invalid base URL.

### Sessions
- New sessions persist provider.
- Legacy session resumes as CodeCraft.
- Provider-specific resume restores provider before model.
- Missing auth on resume produces actionable error.

### CLI/TUI
- `/provider` picker and direct selection.
- `/providers` status.
- Provider switch refreshes model list.
- `/model` acts only within active provider.
- `/status` reports provider and does not fabricate unavailable plan data.

### Regression
- Current 0.9.9 long-turn continuation tests remain green.
- Mouse/scroll behavior remains green.
- Full Node 20/22/24 × Linux/Windows/macOS CI remains green.

## 17. Rollout

Implementation order:

1. Extract generic OpenAI-compatible transport from `CodeCraftClient` with no behavior change.
2. Wrap CodeCraft-specific rate behavior around the generic transport; prove old tests still pass.
3. Add ProviderRegistry.
4. Generalize credentials with legacy read compatibility.
5. Generalize configuration with legacy normalization.
6. Wire startup/session/subagent runtime through ProviderRegistry.
7. Add OpenRouter adapter and tests.
8. Add generic user-configured OpenAI-compatible provider.
9. Add provider CLI/TUI commands and provider-aware status/model selection.
10. Persist provider in sessions and test legacy resume.
11. Update docs/product copy.
12. Run the complete CI matrix and release only after CodeCraft backward compatibility plus OpenRouter smoke behavior is verified.

## 18. Risks and mitigations

### Provider APIs look compatible but differ in edge cases
Mitigation: normalize only the contract AgentSession actually needs; keep adapter-specific parsing isolated.

### Some OpenRouter models do not support tools
Mitigation: use model capability metadata when available and fail clearly; never assume universal tool support.

### Generic endpoints may omit usage/rate metadata
Mitigation: make those fields optional. Local usage/rate UI must tolerate unknown values.

### Credential migration could lock out existing users
Mitigation: legacy credential remains readable and CodeCraft remains the compatibility default for v0.10.

### Session provider mismatch
Mitigation: persist provider explicitly for new sessions; legacy means CodeCraft.

### Scope creep into native-provider SDKs
Mitigation: v0.10 stops at CodeCraft, OpenRouter, and generic OpenAI-compatible transport.

## 19. Acceptance checklist

The release is not complete unless all are true:

- Existing CodeCraft login works unchanged.
- Existing CodeCraft request/tool loop behavior is preserved.
- OpenRouter login + model selection + tool call works.
- Custom OpenAI-compatible endpoint can be configured.
- `/provider`, `/providers`, `/model`, and `/status` are provider-aware.
- Sessions persist provider and legacy sessions still resume.
- No provider credential crosses provider boundaries.
- No fake plan/rate data is shown for providers that do not expose it.
- All existing tests plus new provider tests pass on Node 20/22/24 on Linux, Windows, and macOS.
