---
crucibleId: grandfathered-phase-28.2-worker-guardrails
lane: full
source: human
---

# Phase-28.2 — Worker Role Guardrails + Gate Portability (v2.62.1)

> **Target release**: v2.62.1
> **Status**: Draft
> **Depends on**: Phase-28.1 v2.62.0 already tagged and shipped.
> **Branch strategy**: Direct to `master`. All fixes are small, scoped, and independently testable.
> **Session budget**: 7 slices in **1 session**.
> **Design posture**: Pure defect correction + one release. The core thesis: restore the architectural rule that **API-routed models (Grok, o1, etc.) are NOT code-writing workers** — they are reviewers, analyzers, and (for image models only) image generators. This rule was eroded by auto-routing in `spawnWorker` and by the estimator's blind use of historical "success" data.

---

## Specification Source

### BUG-api-xai-worker-text-only.md — Grok routes to code-writing path but can't execute tool calls

- **Symptom**: `pforge run-plan ... --model grok-4.20` "succeeds" in ~17s emitting a PFORGE_TRAJECTORY narrative while writing zero files. Gate then fails because the code that was described never landed.
- **Root cause**: `spawnWorker` in `pforge-mcp/orchestrator.mjs:1288` auto-routes any model name matching an API provider pattern (grok-*, gpt-*, etc.) through `callApiWorker`. `callApiWorker` is a plain chat completion — no tool calls, no filesystem access. This was correct for *reviewer* and *analysis* roles (where text output is the deliverable), but wrong for the default code-writing role where the slice needs actual file edits.
- **User quote**: *"I thought we fixed that once before so that Grok cannot be a worker for code, only a quorum reviewer that passes back ideas to a worker. Grok can only work using the image models when we need Images."*
- **Fix**: `spawnWorker` refuses to use an API provider when `role` is `null`, `"code"`, or `"execute"`. Allow API routing only when role ∈ { `reviewer`, `quorum-dry-run`, `analysis`, `image` }. Image-generation models still go through the image path at `orchestrator.mjs:794` which is unchanged.

### BUG-api-xai-worker-text-only.md (second half) — Estimator recommends Grok based on poisoned history

- **Symptom**: `pforge run-plan <plan> --estimate` recommended `grok-4.20-0309-reasoning` with `success_rate: 1.0` on 8 historical matches. Those 8 entries were from Phase-27.2 where the slices happened to require only trivial single-file edits that Grok text-completions could imitate well enough for the gate to pass.
- **Fix A**: `recommendModelForPlan` (both copies — `orchestrator.mjs:5680` and `cost-service.mjs:290`) filters out any model whose name matches an API provider pattern **unless** it also has a CLI worker. Currently that means only `claude-*` (via claude CLI) and `gpt-*` (via codex CLI) qualify. Grok models never have a CLI worker, so they are permanently ineligible for code-writing recommendations.
- **Fix B**: Scrub `.forge/model-performance.json` — delete entries where `model` matches an API-only pattern AND `worker` is `api-*` (or worker is missing and model matches). One-time migration; idempotent.

### BUG-step2-gate-portability.md — Windows shell shim breaks bash-only gate patterns

- **Symptom**: Plans authored by `step2-harden-plan.prompt.md` contain POSIX bash gates that work on Linux/macOS but mangle through the Windows `cmd.exe → Git Bash` shim. Phase-28 slices 4 and 7 both failed on this despite correct code.
- **Known-bad patterns** (observed):
  1. `<cmd> | { read var; [ "$var" -ge 1 ]; }` — pipe-to-brace-group: `$var` is invisible outside the subshell in the Windows shim
  2. `bash -c "node -e \"...\""` — nested double-quotes mangled by cmd.exe
  3. `$(command | tr -d '\r')` command substitution with pipes through shim
- **Fix**: Add `validateGatePortability(gateCommand)` to `pforge-mcp/orchestrator.mjs`. Called from `lintGateCommands` pre-flight. Emits a `warning` (not an error) — existing plans continue to run. Catches the three known patterns above with suggestions.
- **Not in scope here**: Prompt changes to `step2-harden-plan.prompt.md`. The linter runs at execution time and catches the bugs *before* wasted worker spend. Prompt hardening is a separate Session-1 concern.

### BUG-gate-timeout-too-short.md — 120s gate timeout kills long test suites

- **Symptom**: Phase-28.1 Slice 6 gate `bash -c "cd pforge-mcp && npx vitest run"` was marked failed despite 3124/3124 tests passing. Root cause: `runGate` passes `timeout: 120_000` to `execSync`; our suite takes ~200s.
- **Fix**: Bump default to `600_000` (10 min). Honor `PFORGE_GATE_TIMEOUT_MS` env override.

---

## Feature Specification

### Problem Statement

Four independent defects all trace to weak boundaries between *what a model can do* and *how the orchestrator invokes it*:

1. Any model name that looks like an API-routed model is blindly pushed into the code-writing path, regardless of whether the underlying worker can actually execute tool calls.
2. The recommender learns from "successful" runs without checking whether the success was structural (actual code changes) or cosmetic (gate happened to pass because the slice was trivial).
3. Plan gates are authored assuming a POSIX bash environment but the orchestrator runs them through `execSync`, which on Windows goes through cmd.exe first.
4. The gate runner has a 120s hard ceiling that pre-dates the project's current test-suite size.

All four are small in code footprint, independently testable, and sit under the same architectural umbrella: **respect the boundary between worker capability and call-site role**.

### User Scenarios

1. **User runs `pforge run-plan foo.md --model grok-4.20`**. Orchestrator detects the model is API-routed and the default role is code-writing. It refuses with a clear error: *"Grok is a reviewer/analyzer model in Plan Forge — use it for quorum or forge_master_ask, not as a primary code-writing worker. For code, use claude-sonnet-4.6 (via gh-copilot) or claude-opus-4.6 (via claude CLI)."* No wasted spend, no empty TRAJECTORY narrative.
2. **User runs `pforge run-plan foo.md --estimate`**. Recommendation engine filters out Grok and other CLI-less models from its top-pick pool. Recommendation comes back pointing at claude-sonnet-4.6 or claude-opus-4.6. If no qualifying history exists, it falls back to the current preset default.
3. **User's `.forge/model-performance.json` contains 8 polluted Grok entries** from Phase-27.2. One-time migration removes them on next orchestrator load, logs a one-line notice. Idempotent — running twice does not re-remove, does not error.
4. **Step-2 author writes a slice with a Windows-hostile bash gate.** `lintGateCommands` pre-flight emits a warning: *"Gate pattern `| { read x; ... }` will fail through the Windows cmd→bash shim. Consider: `output=$(cmd); [ "$output" -ge 1 ]`."* Author fixes the gate before wasting a worker attempt.
5. **User's test gate takes 3 minutes.** `runGate` completes successfully — no false-positive timeout. If the user wants a stricter local limit, they set `PFORGE_GATE_TIMEOUT_MS=60000` in their env.
6. **Quorum reviewer uses Grok.** Unchanged behavior — Grok is valid for `role: "reviewer"` and `role: "quorum-dry-run"`. Only code-writing role is blocked.

### Acceptance Criteria

- **MUST**: `spawnWorker` throws a descriptive error when `role` is `null`/`"code"`/`"execute"` AND the model resolves to an API provider. Covered by new unit tests for each API-routed model pattern.
- **MUST**: `spawnWorker` continues to accept API providers when `role` ∈ { `reviewer`, `quorum-dry-run`, `analysis`, `image` }. Existing tests in `spawn-worker-role.test.mjs` continue to pass.
- **MUST**: `recommendModelForPlan` (both `orchestrator.mjs` and `cost-service.mjs` copies) excludes models where the name matches an API provider pattern AND no CLI worker wraps it. Covered by new unit tests using a mocked perf log.
- **MUST**: `.forge/model-performance.json` has an idempotent migration that drops API-worker code-role entries. Runs on `loadModelPerformance`. Covered by a new test.
- **MUST**: `validateGatePortability(gate)` catches the three documented Windows-hostile patterns and returns structured warnings. Integrated into `lintGateCommands`. Covered by new tests.
- **MUST**: `runGate` default timeout raised to `600_000` ms. `PFORGE_GATE_TIMEOUT_MS` env var overrides. Covered by a new test.
- **MUST**: v2.62.1 CHANGELOG entry covers all four bug fixes in a single `### Fixed` subsection under `## [2.62.1]`.
- **MUST**: `git show v2.62.1:VERSION` returns `2.62.1` at the end.
- **SHOULD**: All four bug files in `docs/bugs/BUG-*.md` get "Fixed in v2.62.1" stamps (api-xai-worker-text-only, step2-gate-portability, gate-timeout-too-short). Self-update-stale-cache already stamped v2.62.0 — leave alone.

### Out of Scope

- **Self-update Fix B** (auto-restart MCP server after self-update) — still deferred. Requires PID detection + IPC handshake. Track as a separate phase.
- **Step-2 prompt changes** — the linter catches the bugs at execution time; hardening the prompt is a Session-1 design concern for a future phase.
- **Forge-Master behavior changes** — none. Phase-28 code ships as-is.

---

## Executable Slices (7 Slices · 1 Session · ~45 min · Budget ≤ $5)

> All slices `[sequential]`. They touch `orchestrator.mjs` in overlapping regions where order matters for reviewability.

---

#### Slice 1: Block API providers from code-writing role [sequential] {#slice-1}

**Goal**: `spawnWorker` refuses to route to an API provider when the call-site role is code-writing. Roles `reviewer`, `quorum-dry-run`, `analysis`, and `image` are still allowed to use API providers.

**Files**:
- `pforge-mcp/orchestrator.mjs` — at line ~1288 (the `const apiProvider = !worker && model ? detectApiProvider(model) : null;` block), add a role allowlist check. If API provider resolved AND role is not in `API_ALLOWED_ROLES`, throw a descriptive error pointing the user at quorum / forge_master_ask.
- Define `const API_ALLOWED_ROLES = new Set(["reviewer", "quorum-dry-run", "analysis", "image"]);` near the other role constants.
- `pforge-mcp/tests/spawn-worker-role.test.mjs` — extend with new tests:
  1. `spawnWorker("...", { model: "grok-4.20", role: null })` throws with a message containing `"grok"` and `"reviewer"`.
  2. `spawnWorker("...", { model: "grok-4.20", role: "reviewer" })` does **not** throw (routes to API worker as before).
  3. `spawnWorker("...", { model: "grok-4.20", role: "quorum-dry-run" })` does not throw.
  4. `spawnWorker("...", { model: "claude-sonnet-4.6", role: null })` does not throw (CLI worker path unchanged).

**Depends on**: None.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:1260-1300` — spawnWorker entry and API routing branch.
- `pforge-mcp/orchestrator.mjs:533-550` — `detectApiProvider`.

**Traces to**: MUST (API providers blocked from code role; existing role-aware behavior preserved).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/spawn-worker-role.test.mjs"
bash -c "grep -q 'API_ALLOWED_ROLES' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 2: Recommender excludes API-only models [sequential] {#slice-2}

**Goal**: `recommendModelForPlan` in both files refuses to recommend a model that matches an API provider pattern and lacks a CLI worker wrapper.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `recommendModelForPlan` (line ~5680). Add a filter step: a model is eligible only when `detectApiProvider(model) === null` OR a CLI worker exists that accepts `--model <modelname>` (for the current matrix, that means `claude-*` via claude CLI and `gpt-*` via codex CLI). For simplicity, exclude any model matching an API provider pattern — if a user later adds CLI wrappers for Grok, they can widen the allowlist.
- `pforge-mcp/cost-service.mjs` — mirror the same filter in `recommendModelForPlan` (line ~290).
- `pforge-mcp/tests/cost-service-real-plans.test.mjs` OR a new `tests/recommender-api-exclusion.test.mjs` — mock `.forge/model-performance.json` with mixed entries and assert the recommender picks a CLI-backed model, not Grok.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:5680-5780` — existing recommender.
- `pforge-mcp/cost-service.mjs:280-310` — mirror copy.

**Traces to**: MUST (recommender excludes API-only models; test proves it).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/recommender-api-exclusion.test.mjs"
bash -c "grep -Eq 'isApiOnlyModel|detectApiProvider|API_PROVIDER' pforge-mcp/cost-service.mjs"
```

---

#### Slice 3: One-time migration scrubs poisoned perf entries [sequential] {#slice-3}

**Goal**: `loadModelPerformance` drops historical entries where `model` matches an API provider pattern. Logs a one-line notice on first run; subsequent runs are silent and idempotent.

**Files**:
- `pforge-mcp/orchestrator.mjs` — extend `loadModelPerformance` (line ~3787). On load, filter out entries where the model matches an API provider pattern. If any were filtered, write the cleaned array back to disk and log `[perf] scrubbed N API-worker entries from model-performance.json (see BUG-api-xai-worker-text-only.md)`.
- `pforge-mcp/tests/orchestrator.test.mjs` — append a `describe` block for `loadModelPerformance migration`:
  1. With a perf file containing mixed Grok + Claude entries, after `loadModelPerformance`, the Grok entries are gone from both the return value and the on-disk file.
  2. Running `loadModelPerformance` twice only writes once (idempotent).
  3. A perf file containing only Claude entries is untouched (no disk write).

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:3787-3820` — loader and appender.

**Traces to**: MUST (migration scrubs poisoned entries; idempotent; test covers).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs -t 'loadModelPerformance'"
bash -c "grep -q 'scrubbed' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 4: Gate portability linter [sequential] {#slice-4}

**Goal**: `validateGatePortability(command)` returns structured warnings for Windows-hostile patterns. Integrated into `lintGateCommands` as a warning (non-blocking).

**Files**:
- `pforge-mcp/orchestrator.mjs` — add `validateGatePortability(command)` near `lintGateCommands` (line ~4256). Returns `{ warnings: Array<{ pattern, message, suggestion }> }`. Detects:
  1. `|\s*\{\s*read\s+\w+` → pipe to brace-group with `read` (Windows shim loses the variable)
  2. `bash\s+-c\s+"[^"]*\\"` → nested double-quotes in `bash -c`
  3. `\$\([^)]*\|` → command substitution containing a pipe (heuristic; may false-positive on legitimate uses, so warning-only)
- `pforge-mcp/orchestrator.mjs` — `lintGateCommands` calls `validateGatePortability` and surfaces warnings under a `portabilityWarnings` field on the result.
- `pforge-mcp/tests/lint-gate-portability.test.mjs` — new file:
  1. Each of the three patterns above produces a warning.
  2. A clean portable gate (`npm test`, `grep -q foo bar`, `node --version`) produces zero warnings.
  3. `lintGateCommands` result includes `portabilityWarnings` array.

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:4256-4290` — `lintGateCommands`.
- `docs/bugs/BUG-step2-gate-portability.md` — reference patterns.

**Traces to**: MUST (three patterns detected; integrated; test covers).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/lint-gate-portability.test.mjs"
bash -c "grep -q 'validateGatePortability' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 5: Gate timeout raised + configurable [sequential] {#slice-5}

**Goal**: `runGate` default timeout is `600_000` ms (10 min). `PFORGE_GATE_TIMEOUT_MS` env var overrides.

**Files**:
- `pforge-mcp/orchestrator.mjs` — `runGate` (line ~1766). Replace hard-coded `timeout: 120_000` with `timeout: parseInt(process.env.PFORGE_GATE_TIMEOUT_MS, 10) || 600_000`.
- `pforge-mcp/tests/orchestrator.test.mjs` — append:
  1. Default timeout is 600000 (assert by inspecting a stubbed `execSync` call's options arg).
  2. `PFORGE_GATE_TIMEOUT_MS=30000` yields `timeout: 30000`.
  3. Non-numeric env value falls back to default.

**Depends on**: Slice 4.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs:1766-1800` — `runGate`.

**Traces to**: MUST (timeout bumped + configurable; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs -t 'runGate.*timeout'"
bash -c "grep -q 'PFORGE_GATE_TIMEOUT_MS' pforge-mcp/orchestrator.mjs"
```

---

#### Slice 6: Full-suite regression check [sequential] {#slice-6}

**Goal**: Confirm the whole project still passes end-to-end. A single "green bar" gate before the release slice.

**Files**:
- None. Validation-only slice.

**Depends on**: Slice 5.

**Branch**: `master`.

**Context files**:
- None.

**Traces to**: MUST (full suite green).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && PFORGE_GATE_TIMEOUT_MS=600000 npx vitest run"
```

---

#### Slice 7: Ship v2.62.1 [sequential] {#slice-7}

**Goal**: CHANGELOG, VERSION bump, tag, post-release bump.

**Files**:
- `CHANGELOG.md` — new `## [2.62.1]` section with one `### Fixed` subsection listing all four bug fixes (api-xai code-worker block, recommender exclusion + perf scrub, gate portability linter, gate timeout).
- `VERSION` — `2.62.1` for the tag, then `2.62.2-dev` post-tag.
- `pforge-mcp/package.json` — version `2.62.1`.
- `docs/bugs/BUG-api-xai-worker-text-only.md` — stamp "**Fixed in v2.62.1**".
- `docs/bugs/BUG-step2-gate-portability.md` — stamp "**Fixed in v2.62.1**" (linter addresses it at execution time).
- `docs/bugs/BUG-gate-timeout-too-short.md` — stamp "**Fixed in v2.62.1**".

**Depends on**: Slice 6.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` — existing `[2.62.0]` entry for format reference.

**Traces to**: MUST (tag exists with VERSION=2.62.1; bump-back to 2.62.2-dev; CHANGELOG entry complete; bug stamps applied).

**Validation Gate**:
```bash
bash -c "git show v2.62.1:VERSION | grep -q '^2.62.1$'"
bash -c "grep -q '## \\[2.62.1\\]' CHANGELOG.md"
bash -c "grep -q 'Fixed in v2.62.1' docs/bugs/BUG-api-xai-worker-text-only.md"
```

---

## Forbidden Actions

- No changes to Forge-Master behavior. Phase-28 code ships as-is.
- No refactors of unrelated modules. Each slice touches only the files listed.
- No changes to `step2-harden-plan.prompt.md` — prompt hardening is a separate concern.
- No auto-restart MCP server logic (Fix B is explicitly deferred).

## Rollback Plan

Before Slice 1, create a `pre-phase-28.2` tag at the current HEAD. On unrecoverable slice failure, `git reset --hard pre-phase-28.2` and file a narrower hotfix.

## Agent Notes

- Slices 1, 3, 4, 5 all touch `orchestrator.mjs`. Each change is localized — do not reformat surrounding code.
- Slice 2's `cost-service.mjs` copy is a near-mirror of the orchestrator copy. Keep the predicate identical so future maintenance can collapse them.
- Slice 3's migration must log the scrub count exactly once per load. Don't log when the array is already clean. Don't re-write the file when nothing changed.
- Slice 4's third heuristic (`$(...|...)`) may produce false positives on legitimate portable uses — that's why it's a warning, not an error. Keep the warning message friendly.
- Slice 5's env override parses with `parseInt(..., 10)`. Fall back to the default on `NaN` or negative values. Don't accept 0 (would set no-timeout — risky).
