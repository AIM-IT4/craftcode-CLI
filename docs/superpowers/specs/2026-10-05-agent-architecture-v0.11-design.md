# Craft Code v0.11 Agent Architecture Design

## Goal

Turn the existing agent loop into a more capable engineering runtime without weakening permissions or making the CLI dependency-heavy.

## Scope

1. Semantic code intelligence
   - Add a semantic index for JavaScript/TypeScript using the TypeScript compiler API.
   - Expose symbols, definitions and references through one agent tool.
   - Fall back to bounded text search for unsupported languages rather than pretending the result is semantic.

2. Shell policy and sandboxing
   - Classify commands as safe, approval-required or denied before execution.
   - Deny catastrophic filesystem/system commands even in Auto mode.
   - Keep external/network/publish/deploy commands approval-gated.
   - Support an opt-in Docker sandbox runner with network disabled; host execution remains the compatibility default.

3. Task-graph orchestration
   - Add planner -> dependency-aware worker graph -> reviewer execution.
   - Planner output is strict JSON and validated before scheduling.
   - Workers remain read-only by default. The orchestration tool must not silently create writer agents.

4. Persistent cache and deduplication
   - Cache only explicitly cache-safe tools.
   - Store cache under ~/.craftcli/cache.
   - Local semantic results are keyed by file metadata; remote/repository reads use bounded TTLs.
   - Mutating tools invalidate workspace-local cache entries.

5. Long-running process handles
   - Start, inspect, tail and stop background processes by handle.
   - Keep bounded output buffers.
   - Stop owned processes when Craft Code exits.

6. Project command discovery
   - Detect existing test, lint, typecheck, build and dev commands from package.json and common project manifests.
   - Do not invent commands that are not declared or strongly implied by a standard toolchain.

7. Evaluation harness
   - Add an offline deterministic runtime evaluation command for policy, semantic lookup, process lifecycle, cache and command discovery.
   - Keep model-dependent solve-rate evaluation as a separate opt-in layer; deterministic CI must not require API credentials.

## Non-goals

- No automatic npm publish or version bump in this change.
- No mandatory language-server installation.
- No arbitrary project-local executable loading for semantic analysis.
- No automatic writer-agent patch application from orchestration.
- No claim that Docker sandboxing is active unless the configured Docker runner was actually used.

## Success criteria

- Existing tests stay green on Node 20/22/24 across Linux, macOS and Windows.
- Semantic lookup returns AST-backed symbols for JS/TS fixtures.
- Dangerous commands are denied before shell execution.
- External-impact commands remain approval-gated even when ordinary shell permission is allow.
- Background process handles can start, report logs/status and terminate.
- A planner graph executes dependencies in order and reviewer receives worker evidence.
- Cache returns a hit for identical safe requests and is invalidated after a write.
- Command discovery finds scripts already present in package.json.
- Offline evals run without model credentials.
