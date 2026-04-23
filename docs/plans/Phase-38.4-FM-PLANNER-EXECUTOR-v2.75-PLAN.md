---
crucibleId: bc753a48-cd91-4460-8bae-9fe527bbb717
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.4 — Forge-Master Planner-Executor Split

> **Target release**: v2.75.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-38.3 shipped (v2.74.0) — planner uses `forge_graph_query` to decompose multi-step queries.

---

## Specification Source

- **Problem**: `runTurn` in `pforge-master/src/reasoning.mjs` is one-shot reactive: classify → call up to N tools → reply. No "plan first, execute second" stage. Complex queries ("show cost for runs that failed last week, broken down by model") require 5+ trial-and-error tool calls.
- **Root cause**: No planner decomposition layer exists between classification and tool dispatch.
- **Contract**: After this phase, `runTurn` optionally runs a planner stage that decomposes the query into up to 5 ordered read-only tool calls, executes them, and synthesizes the reply over the joined result. Falls back to existing reactive loop when planner produces zero steps or detects a simple query.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-master/src/planner.mjs` — `plan({userMessage, classification, lane, allowedTools, deps}) → {steps, skipReason?}`. Step shape: `{tool, args, rationale, dependsOn?: string[]}`. Max 5 steps.
- New `pforge-master/src/__tests__/planner.test.mjs` — unit tests for planner.
- New `pforge-master/src/plan-executor.mjs` — `executePlan(plan, deps) → {results, totalDurationMs}`. Sequential by default; parallelizes steps with no `dependsOn`. Hard 30s timeout.
- New `pforge-master/src/__tests__/plan-executor.test.mjs` — unit tests for executor.
- `pforge-master/src/reasoning.mjs` — wire planner + executor after classification; emit `plan` SSE event before execution.
- `pforge-master/src/http-routes.mjs` — forward `plan` SSE event from `runTurn`.
- Probe harness `.forge/validation/probes.json` — 3 new multi-step probes.
- `pforge-master/scripts/probe-forge-master.mjs` — assert `plan` SSE event for new probes.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.75.0 release metadata.

### Out of Scope

- ❌ Write tools or auto-PR creation — planner only schedules read-only tools on the lane's allowlist.
- ❌ Adding tools to operational/troubleshoot/build lanes (Phase-32 guardrail).
- ❌ Multi-turn planning — each turn plans independently.
- ❌ Replacing the existing reactive tool loop — planner is additive when query is complex.
- ❌ Changes to build/operational/troubleshoot lane tool lists.

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Planner must not schedule write tools or tools not on the lane's current allowlist.
- ❌ Planner must not be invoked for `offtopic` or `build` lanes.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Planner model | Resolved | Use cheapest available provider tier (Haiku/mini) via `resolveModel("low")`; big synthesis still uses lane's tier |
| 2 | Max steps | Resolved | 5 steps hard cap |
| 3 | Timeout | Resolved | 30s hard timeout for full `executePlan` |
| 4 | Skip heuristic | Resolved | Skip if: lane=offtopic, single-tool-obvious, zero allowed tools, `skipReason` set by planner |
| 5 | SSE event | Resolved | `plan` event emitted before tool-call events; shape `{type:"plan", steps:[...]}` |
| 6 | Parallelism | Resolved | Steps without `dependsOn` execute in parallel; steps with `dependsOn` wait for dep result |

---

## Acceptance Criteria

### Slice 1 — Planner module + plan schema

- **MUST**: `pforge-master/src/planner.mjs` exists and exports `plan({userMessage, classification, lane, allowedTools, deps})`.
- **MUST**: Return shape is `{steps: Array<{tool, args, rationale, dependsOn?}>, skipReason?: string}`.
- **MUST**: Max steps enforced: `steps.length` never exceeds 5.
- **MUST**: `plan()` returns `{steps: [], skipReason: "lane=offtopic"}` when `lane === "offtopic"`.
- **MUST**: `plan()` returns `{steps: [], skipReason: "single-tool-obvious"}` when query clearly maps to one tool.
- **MUST**: `plan()` returns `{steps: [], skipReason: "no-allowed-tools"}` when `allowedTools` is empty.
- **MUST**: All tools in returned `steps` are members of `allowedTools` — planner never invents tool names.
- **MUST**: `pforge-master/src/__tests__/planner.test.mjs` passes covering: multi-step plan, skip cases (offtopic, single-tool, no-tools), tool validation.

### Slice 2 — Plan executor

- **MUST**: `pforge-master/src/plan-executor.mjs` exports `executePlan(plan, deps) → {results, totalDurationMs}`.
- **MUST**: `results` is an array of `{step, output, error?: string}` — one entry per planned step.
- **MUST**: Steps with `dependsOn` wait for all named dependencies to complete before executing.
- **MUST**: Steps without `dependsOn` execute in parallel (using `Promise.all`).
- **MUST**: Hard 30s timeout: if total execution exceeds 30 000ms, remaining steps are cancelled and marked `{error: "timeout"}`.
- **MUST**: A single step failure does NOT abort remaining independent steps (error short-circuit only applies to dependent steps).
- **MUST**: `pforge-master/src/__tests__/plan-executor.test.mjs` passes covering: sequential execution, parallel branches, error isolation, timeout enforcement.

### Slice 3 — Wire into `runTurn` + SSE `plan` event

- **MUST**: `pforge-master/src/reasoning.mjs` calls `plan()` after classification.
- **MUST**: If `steps` is non-empty, calls `executePlan`; synthesizes reply over `results`; joins back into standard reply.
- **MUST**: If planner returns `skipReason`, falls through to existing reactive tool loop unchanged.
- **MUST**: `plan` SSE event is emitted (via the existing SSE mechanism) BEFORE any `tool-call` events, shape `{type: "plan", steps: [...]}`.
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` continues to pass.
- **MUST**: New SSE test asserts: `plan` event arrives before `tool-call` event when planner returned steps; no `plan` event emitted when planner returned `skipReason`.

### Slice 4 — Probe harness + release v2.75.0

- **MUST**: `.forge/validation/probes.json` gains at least 3 new probes labeled `planner-` that exercise multi-step queries (e.g. `planner-cost-breakdown`, `planner-recent-failures`, `planner-phase-status`).
- **MUST**: Probe harness run with `node scripts/probe-forge-master.mjs --keyword-only` shows ≥ 1 probe where the SSE stream includes a `plan` event.
- **MUST**: `VERSION` contains exactly `2.75.0`.
- **MUST**: `CHANGELOG.md` has a `[2.75.0]` section mentioning `planner-executor`, `plan SSE event`, and `multi-step queries`.
- **MUST**: `ROADMAP.md` reflects Phase-38.4 / v2.75.0 as shipped.
- **MUST**: Git tag `v2.75.0` applied.

### Quality bar

- **SHOULD**: Planner adds `rationale` string to each step explaining why this tool is useful.
- **SHOULD**: If planner uses the cheap model but the model call fails, log warning and fall back to reactive loop (do not fail the turn).
- **SHOULD**: Probe harness output reports `plannedTurns` count in the results summary.

---


### Slice 38.4 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.4/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.4/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Planner module + plan schema [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-master/src/planner.mjs`
- `pforge-master/src/__tests__/planner.test.mjs`

**Depends On**: Phase-38.3 shipped (v2.74.0) — `forge_graph_query` available on advisory lane.

**Context Files**:
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs) — LANE_TOOLS, LANES
- [pforge-master/src/reasoning-tier.mjs](../../pforge-master/src/reasoning-tier.mjs) — `resolveModel`
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Define plan schema types (JSDoc). Implement skip heuristics.
2. Implement planning logic: call cheap model with "decompose this query into tool calls" system prompt using allowed tools list.
3. Validate returned steps: cap at 5, filter to allowed tools only.
4. Write unit tests for all skip cases and a multi-step plan case with mocked model call.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/planner.test.mjs
```

**Commit**: `feat(planner): planner module + plan schema with skip heuristics`

---

### Slice 2 — Plan executor [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-master/src/plan-executor.mjs`
- `pforge-master/src/__tests__/plan-executor.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/planner.mjs](../../pforge-master/src/planner.mjs) (Slice 1)
- [pforge-master/src/tool-bridge.mjs](../../pforge-master/src/tool-bridge.mjs)

**Steps**:
1. Implement dependency resolution: topological sort of `dependsOn` references.
2. Execute parallel batches using `Promise.all`; inject prior step results into dependent step args.
3. Enforce 30s hard timeout with `Promise.race` against a timeout sentinel.
4. Unit tests: sequential, parallel, error isolation, timeout.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/plan-executor.test.mjs
```

**Commit**: `feat(planner): plan executor with parallel dispatch and timeout`

---

### Slice 3 — Wire into `runTurn` + SSE `plan` event [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 60–90 min

**Files to modify**:
- `pforge-master/src/reasoning.mjs`
- `pforge-master/src/http-routes.mjs`

**Files to create**:
- `pforge-master/tests/planner-sse.test.mjs`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs)
- [pforge-master/src/http-routes.mjs](../../pforge-master/src/http-routes.mjs)
- [pforge-master/tests/http-routes-sse.test.mjs](../../pforge-master/tests/http-routes-sse.test.mjs)

**Steps**:
1. In `runTurn`, after classification, call `plan()`. If `steps` non-empty, call `executePlan`, build synthesis prompt from results, continue.
2. Emit `plan` SSE event immediately after `plan()` returns steps (before executor fires).
3. If `skipReason`, proceed to existing reactive tool loop unchanged.
4. Wrap planner + executor in try/catch — any failure falls through to reactive loop.
5. Write `planner-sse.test.mjs` asserting event ordering.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/planner-sse.test.mjs pforge-master/tests/http-routes-sse.test.mjs
```

**Commit**: `feat(planner): wire planner-executor into runTurn + plan SSE event`

---

### Slice 4 — Probe harness + release v2.75.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to modify**:
- `.forge/validation/probes.json`
- `scripts/probe-forge-master.mjs`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [.forge/validation/probes.json](../../.forge/validation/probes.json)
- [scripts/probe-forge-master.mjs](../../scripts/probe-forge-master.mjs)

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='2.75.0')throw new Error('VERSION mismatch: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.75.0]'))throw new Error('missing [2.75.0]');if(!c.includes('planner'))throw new Error('missing narrative');console.log('ok');"
```

**Commit**: `chore(release): v2.75.0 — Forge-Master planner-executor split`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.75.0 released).

**Context Files**:
- [pforge-master/src/planner.mjs](pforge-master/src/planner.mjs)
- [pforge-master/src/plan-executor.mjs](pforge-master/src/plan-executor.mjs)
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs)

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.4.mjs`. 100 `plan()` + `executePlan()` cycles. Edge cases: empty allowedTools, single-word query, max-5-step plan, all-parallel-no-dependencies, all-sequential-chain. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.4/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- One model in a 3-step plan hangs forever — assert 30s timeout fires, partial results returned.
- Planner model returns malformed JSON — assert fallback to reactive loop, no crash.
- `executePlan` with circular dependency (0→1, 1→0) — assert detection and skip to reactive loop.
- Tool not in allowlist returned by planner — assert it's silently dropped before execution.
- Plan returns 6 steps (> cap) — assert only first 5 executed.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.4/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.4-FM-PLANNER-EXECUTOR-v2.75-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.4/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.4.mjs --validate-converged ; npx vitest run pforge-master/src/__tests__/plan-executor.test.mjs ; pforge analyze docs/plans/Phase-38.4-FM-PLANNER-EXECUTOR-v2.75-PLAN.md
```

**Commit**: `test(38.4): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Verify planner never returns tools not in `allowedTools`. Confirm `plan()` is a pure function with no side effects — it must not call tools directly.

**After Slice 2**: Confirm `executePlan` timeout test passes under 35s. Review that step results are correctly threaded into dependent steps.

**After Slice 3**: Run full pforge-master suite. Confirm existing SSE test (`http-routes-sse.test.mjs`) still passes — the `plan` event addition must not break existing SSE consumers.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] Planner never schedules write tools or non-allowlisted tools — verified by unit test.
- [ ] Zero regressions in full pforge-master suite.
- [ ] `VERSION` = `2.75.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] At least 3 new probes in `probes.json` exercising multi-step queries.
- [ ] Git tag `v2.75.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Planner schedules a write tool or a tool not on lane allowlist (Phase-32 violation) → halt immediately.
- ❌ `plan` SSE event breaks existing SSE consumers (http-routes-sse test fails) → fix before proceeding.
- ❌ `executePlan` timeout does not enforce the 30s cap → do not proceed to Slice 3.
- ❌ `runTurn` exits with error when planner or executor fails (must fall through gracefully) → fix.
- ❌ Any modification to files outside the listed scope → halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Cheap-model planner returns invalid tool names (hallucinated) | Post-process: filter step tools against `allowedTools`; drop invalid steps; if zero remain, fall back to reactive loop |
| 2 | Executor timeout too short for sequential 5-step plans on slow models | Timeout is per `executePlan` invocation, not per step; 30s is a wall clock cap for the whole batch |
| 3 | `plan` SSE event confuses existing dashboard which only handles `classification`/`tool-call`/`error` | Dashboard must gracefully ignore unknown event types; add `plan` event rendering as an enhancement in Slice 3 |
| 4 | Multi-step result synthesis produces longer/costlier reply due to joined context | Monitor cost delta in Slice 4 probe run; consider truncating step outputs before synthesis if > 2K tokens each |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~12K | ~$0.03 |
| Slice 2 | ~12K | ~$0.03 |
| Slice 3 | ~14K | ~$0.03 |
| Slice 4 | ~6K | ~$0.01 |
| **Total** | **~44K** | **~$0.10** |

---

## Session Break Points

After Slice 2 — Slice 3 requires reading both `reasoning.mjs` and `http-routes.mjs` simultaneously while holding the planner/executor API in mind; a fresh session prevents context bleed.
