# Craft Code v0.11 Agent Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic code intelligence, command policy/sandboxing, task-graph orchestration, persistent cache, process handles, project command discovery and deterministic runtime evals.

**Architecture:** Keep AgentSession as the coordinator and move new responsibilities into focused modules. ToolRegistry remains the permission boundary; semantic/cache/process/policy services are injected or constructed once per CLI session. AgentManager owns orchestration because it already owns subagent lifecycle.

**Tech Stack:** Node.js 20+, node:test, child_process, fs/path/crypto, TypeScript compiler API as the only new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-05-agent-architecture-v0.11-design.md`

## Global Constraints

- Preserve current provider-neutral runtime and public CLI behavior.
- No automatic npm publish/version bump.
- Dangerous shell commands remain denied even in Auto mode.
- Orchestration workers are read-only by default.
- New processes are owned by the current Craft Code process and cleaned up on exit.
- CI must remain credential-free.

## Review Focus

- Shell quoting/compound commands that could bypass policy classification.
- Cache staleness after workspace mutation.
- Windows process termination and shell invocation.
- Invalid/cyclic planner dependency graphs.
- Semantic parser failures on TSX/JSX and unsupported file types.

---

### Task 1: Semantic index

**Files:** create `src/semantic.mjs`; modify `src/tools.mjs`, `package.json`; test `test/runtime-v011.test.mjs`.

**Interfaces:** `SemanticIndex.query({action,path,symbol,query}) -> object`.

- [ ] Write failing AST symbol/definition/reference tests.
- [ ] Run CI and confirm failure because `src/semantic.mjs` does not exist.
- [ ] Implement minimal TypeScript-compiler-backed index and ToolRegistry bridge.
- [ ] Run full tests.

### Task 2: Shell policy and optional Docker sandbox

**Files:** create `src/policy.mjs`; modify `src/tools.mjs`, `src/config.mjs`; test `test/runtime-v011.test.mjs`.

**Interfaces:** `CommandPolicy.evaluate(command) -> {decision,reason,kind}`; `CommandPolicy.wrap(command,cwd) -> {exe,args,cwd}`.

- [ ] Write failing allow/ask/deny and Docker wrapper tests.
- [ ] Confirm RED in CI.
- [ ] Implement policy evaluation and run_command integration.
- [ ] Run full tests.

### Task 3: Process handles and project command discovery

**Files:** create `src/processes.mjs`, `src/project_commands.mjs`; modify `src/tools.mjs`, `src/index.mjs`; test `test/runtime-v011.test.mjs`.

**Interfaces:** `ProcessManager.start/status/logs/stop/stopAll`; `discoverProjectCommands(cwd) -> array`.

- [ ] Write failing lifecycle/discovery tests.
- [ ] Confirm RED in CI.
- [ ] Implement bounded process registry and manifest discovery.
- [ ] Wire process cleanup into CLI exit.
- [ ] Run full tests.

### Task 4: Dependency-aware orchestration

**Files:** modify `src/agents.mjs`, `src/tools.mjs`, `src/index.mjs`, `src/tui.mjs`; test `test/runtime-v011.test.mjs`.

**Interfaces:** `AgentManager.orchestrate({task,maxWorkers,budgetPerAgent}) -> {plan,workers,review}`.

- [ ] Write failing DAG ordering, invalid-cycle and reviewer-evidence tests.
- [ ] Confirm RED in CI.
- [ ] Add planner role, validated graph scheduler and reviewer pass.
- [ ] Expose `orchestrate_task` and `/orchestrate`.
- [ ] Run full tests.

### Task 5: Persistent safe-tool cache and deterministic evals

**Files:** create `src/cache.mjs`, `src/evals.mjs`, `evals/runtime.json`; modify `src/tools.mjs`, `src/index.mjs`, `src/config.mjs`; test `test/runtime-v011.test.mjs`.

**Interfaces:** `ToolCache.get/set/invalidateWorkspace`; `runRuntimeEvals() -> summary`.

- [ ] Write failing cache-hit/invalidation and eval-summary tests.
- [ ] Confirm RED in CI.
- [ ] Implement bounded persistent cache for safe tools only.
- [ ] Add `craftcode eval` deterministic runtime suite.
- [ ] Run full tests and CLI smoke test.

### Task 6: Whole-branch review

- [ ] Run the full 9-job CI matrix.
- [ ] Request fresh code review against this spec.
- [ ] Fix Critical/Important findings with regression tests.
- [ ] Merge only after final CI is green.
