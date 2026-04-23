---
crucibleId: ff4e9ac7-0bb8-4381-a30b-ba5ce77e51c5
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.6 — Forge-Master Pattern Surfacing

> **Target release**: v2.77.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-38.3 shipped (v2.74.0) — uses knowledge graph + run index.

---

## Specification Source

- **Problem**: Recurring failures (e.g., `tee /tmp/...` Windows gate failures in Phase-35, 36, 37) go unnoticed across plans because nothing compares cross-run data automatically. Forge-Master has the data but never surfaces it unless explicitly asked.
- **Root cause**: No pattern detector exists over `.forge/runs/`, `.forge/cost-history.json`, and `.forge/bugs/`.
- **Contract**: After this phase, a read-only pattern detector scans run history and surfaces recurring patterns as advisory observations via the troubleshoot lane and `pforge patterns list`. Patterns are NEVER injected into the hardener prompt or executor (Phase-32 guardrail).

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-mcp/patterns/registry.mjs` — loads and runs all detectors in `pforge-mcp/patterns/detectors/`.
- New `pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs` — first detector.
- New `pforge-mcp/patterns/detectors/model-failure-rate-by-complexity.mjs`.
- New `pforge-mcp/patterns/detectors/slice-flap-pattern.mjs`.
- New `pforge-mcp/patterns/detectors/cost-anomaly.mjs`.
- New `pforge-mcp/tests/patterns-registry.test.mjs` — registry + gate-failure-recurrence test.
- New `pforge-mcp/tests/patterns-detectors.test.mjs` — tests for the 3 additional detectors.
- `pforge-master/src/intent-router.mjs` — when troubleshoot lane fires AND pattern detector returns ≥ 1 match, append to reply context as "Recurring pattern observed".
- Dashboard panel `pforge-mcp/dashboard/forge-master.js` — "Recurring patterns" panel listing detected patterns by severity.
- New `pforge-mcp/tests/patterns-dashboard.test.mjs`.
- `pforge.ps1` + `pforge.sh` — `pforge patterns list [--since <iso>]` command.
- Resolved TBD: `forge_patterns_list` as a new advisory-lane-only MCP tool (see Required Decisions).
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.77.0 release metadata.

### Out of Scope

- ❌ Injecting patterns into `step2-harden-plan.prompt.md` (Phase-32 guardrail — explicitly forbidden).
- ❌ Injecting patterns into the slice executor.
- ❌ Principles-violation detection (separate phase, not 38.x).
- ❌ Auto-fix proposals based on patterns — advisory only.
- ❌ Adding tools to operational/troubleshoot/build lanes that mutate state.
- ❌ Changing build/operational/troubleshoot lane tool lists (Phase-32 guardrail).

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Pattern surfacing must never inject findings into the hardener prompt or plan executor — advisory-lane Forge-Master reply context only.
- ❌ Pattern detector must not modify `.forge/runs/**`, `.forge/bugs/**`, or any plan file.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | New tool vs extending `forge_graph_query` | Resolved | New advisory-lane-only tool `forge_patterns_list` — cleaner API surface, no overloading of graph query |
| 2 | Threshold for surfacing | Resolved | ≥ 3 occurrences AND across ≥ 2 distinct plans |
| 3 | Pattern types (initial set) | Resolved | gate-failure-recurrence, model-failure-rate-by-complexity, slice-flap-pattern, cost-anomaly |
| 4 | Detector extensibility | Resolved | File-based registry: any `pforge-mcp/patterns/detectors/<name>.mjs` is auto-loaded |
| 5 | `forge_patterns_list` lane placement | Resolved | Advisory lane ONLY — same Phase-32 guardrail as `forge_graph_query` |

---

## Acceptance Criteria

### Slice 1 — Pattern detector framework + gate-failure-recurrence detector

- **MUST**: `pforge-mcp/patterns/registry.mjs` exports `runAllDetectors({graph, runs, costs})` — loads all `.mjs` files from `detectors/` directory and calls each with `{graph, runs, costs}`.
- **MUST**: Detector contract: each module exports default `async function({graph, runs, costs}) → [{patternId, severity, occurrences: [...], summary}]`.
- **MUST**: `gate-failure-recurrence.mjs` detects repeated gate failures with the same pattern across ≥ 3 occurrences AND ≥ 2 distinct plans.
- **MUST**: `gate-failure-recurrence.mjs` surfaces the `tee /tmp/` anti-pattern as a specific case when present in run fixture data.
- **MUST**: `pforge-mcp/tests/patterns-registry.test.mjs` passes covering: registry loads detectors, gate-failure detector finds synthesized regression in fixture data.

### Slice 2 — Three additional detectors

- **MUST**: `model-failure-rate-by-complexity.mjs` detects models with failure rate > 25% on slices with complexity ≥ 4.
- **MUST**: `slice-flap-pattern.mjs` detects slices that have flapped (pass→fail→pass) ≥ 3 times across runs.
- **MUST**: `cost-anomaly.mjs` detects slices where cost spikes > 2× the rolling average for that slice type.
- **MUST**: `pforge-mcp/tests/patterns-detectors.test.mjs` passes with at least 2 tests per detector.
- **MUST**: All detectors return `[]` (not throw) on empty/fresh data.

### Slice 3 — Surface in advisory lane + `forge_patterns_list` tool + CLI

- **MUST**: `pforge-master/src/intent-router.mjs` adds `forge_patterns_list` to `LANE_TOOLS.advisory` ONLY (NOT in operational/troubleshoot/build).
- **MUST**: `pforge-mcp/server.mjs` registers `forge_patterns_list` MCP tool.
- **MUST**: When the troubleshoot lane fires in `runTurn`, if `runAllDetectors` returns ≥ 1 pattern match, the match is appended to reply context as `> **Recurring pattern observed:** <summary>` (advisory, not classification).
- **MUST**: `pforge patterns list [--since <iso>]` CLI command exits 0 and prints detected patterns (or "No patterns detected" on a clean repo).
- **MUST**: New test verifies: a troubleshoot probe with seeded recurring-failure fixture data produces pattern context in the reply; `forge_patterns_list` absent from operational/troubleshoot/build allowlists.
- **MUST**: Full pforge-master test suite passes.

### Slice 4 — Dashboard panel + release v2.77.0

- **MUST**: Dashboard in `pforge-mcp/dashboard/forge-master.js` has a "Recurring patterns" panel listing detected patterns grouped by severity.
- **MUST**: `pforge-mcp/tests/patterns-dashboard.test.mjs` passes verifying panel renders from fixture pattern data.
- **MUST**: `VERSION` contains exactly `2.77.0`.
- **MUST**: `CHANGELOG.md` has a `[2.77.0]` section mentioning `pattern surfacing`, `gate-failure-recurrence`, and `advisory lane`.
- **MUST**: `ROADMAP.md` reflects Phase-38.6 / v2.77.0 as shipped.
- **MUST**: Git tag `v2.77.0` applied.

### Quality bar

- **SHOULD**: Each detected pattern includes a `remediation` hint (e.g., "Replace `tee /tmp/` with node -e write").
- **SHOULD**: `pforge patterns list` output groups by severity (`alert` first).
- **SHOULD**: Registry skips files that fail to import (log warning, continue) — malformed detector never crashes the system.

---


### Slice 38.6 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.6/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.6/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Pattern detector framework + gate-failure-recurrence [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-mcp/patterns/registry.mjs`
- `pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs`
- `pforge-mcp/tests/patterns-registry.test.mjs`

**Depends On**: Phase-38.3 shipped (v2.74.0) — graph passed to detectors.

**Context Files**:
- [pforge-mcp/graph/query.mjs](../../pforge-mcp/graph/query.mjs) — graph query API
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Create `pforge-mcp/patterns/` directory with `registry.mjs`.
2. Registry: `glob('pforge-mcp/patterns/detectors/*.mjs')`, import each, call with `{graph, runs, costs}`, collect results.
3. `gate-failure-recurrence.mjs`: scan run events for gate failure messages, group by gate pattern, filter ≥ 3 occurrences × ≥ 2 plans.
4. Unit test: seed fixture runs with 4 `tee /tmp/` gate failures across 2 plans; assert detector surfaces the pattern.

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/patterns-registry.test.mjs
```

**Commit**: `feat(patterns): pattern detector registry + gate-failure-recurrence detector`

---

### Slice 2 — Three additional detectors [parallel-safe, Group A]

**Complexity**: 3
**Parallelism**: [parallel-safe] — Parallel Group A
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-mcp/patterns/detectors/model-failure-rate-by-complexity.mjs`
- `pforge-mcp/patterns/detectors/slice-flap-pattern.mjs`
- `pforge-mcp/patterns/detectors/cost-anomaly.mjs`
- `pforge-mcp/tests/patterns-detectors.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-mcp/patterns/registry.mjs](../../pforge-mcp/patterns/registry.mjs) (Slice 1)

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/patterns-detectors.test.mjs
```

**Commit**: `feat(patterns): model-failure-rate, slice-flap, cost-anomaly detectors`

---

### Parallel Merge Checkpoint (after Group A)

Confirm both Slice 1 and Slice 2 gates pass. Run full pforge-mcp test suite to confirm no baseline regressions before proceeding to Slice 3.

---

### Slice 3 — Surface in advisory lane + tool + CLI [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to modify**:
- `pforge-master/src/intent-router.mjs`
- `pforge-master/src/reasoning.mjs`
- `pforge-mcp/server.mjs`
- `pforge.ps1`
- `pforge.sh`

**Files to create**:
- `pforge-master/tests/patterns-lane.test.mjs`

**Depends On**: Slice 2 complete (all detectors available).

**Context Files**:
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs)
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs)
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs)

**Validation Gate**:
```r
npx vitest run pforge-master/tests/patterns-lane.test.mjs ; npx vitest run pforge-master/tests/http-routes-sse.test.mjs
```

feat(patterns): forge_patterns_list advisory tool + troubleshoot-lane context injection`

---

### Slice 4 — Dashboard panel + release v2.77.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to modify**:
- `pforge-mcp/dashboard/forge-master.js`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Files to create**:
- `pforge-mcp/tests/patterns-dashboard.test.mjs`

**Depends On**: Slice 3 complete.

**Context Files**:
- [pforge-mcp/dashboard/forge-master.js](../../pforge-mcp/dashboard/forge-master.js)

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/patterns-dashboard.test.mjs ; node -e "const fs=require('fs');if(fs.readFileSync('VERSION','utf8').trim()!=='2.77.0')throw new Error('VERSION');console.log('ok')"
```

chore(release): v2.77.0 — Forge-Master pattern surfacing`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.77.0 released).

**Context Files**:
- [pforge-mcp/patterns/registry.mjs](pforge-mcp/patterns/registry.mjs)
- [pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs](pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.6-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.6/hammer-<iter>.md`.

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.6.mjs`. 100 `detectPatterns` calls over seeded run fixtures. Edge cases: zero runs, single run, identical failure across 10 plans, all patterns below threshold. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.6/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Pattern detector modifies run artifact (should never happen) — assert read-only invariant.
- Detector throws on malformed run fixture — registry catches, skips that detector, logs warning.
- Pattern injected into step2 hardener prompt (Phase-32 violation) — assert this path does NOT exist.
- All occurrences below N=3 threshold — pattern surfacing returns empty list.
- 500 run fixtures — `detectPatterns` completes in < 5s.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.6-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.6/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.6/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.6/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.6.mjs --validate-converged ; npx vitest run pforge-mcp/tests/patterns-registry.test.mjs ; pforge analyze docs/plans/Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md
```

**Commit**: `test(38.6): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Confirm `runAllDetectors` receives graph from Phase-38.3 and gracefully returns `[]` when graph is empty. Confirm no artifact files are modified.

**After Slice 2 (Group A merge)**: Confirm all 4 detectors return `[]` (not throw) on fresh data. Run pforge-mcp baseline suite.

**After Slice 3**: Verify `forge_patterns_list` is in advisory LANE_TOOLS and NOT in operational/troubleshoot/build. Confirm pattern context injection does not modify `classification` SSE event.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] `forge_patterns_list` is in advisory LANE_TOOLS and absent from all other allowlists.
- [ ] Pattern detector never modifies run or plan files.
- [ ] Pattern context is NOT injected into `step2-harden-plan.prompt.md` or slice executor.
- [ ] Zero regressions in full pforge-master and pforge-mcp test suites.
- [ ] `VERSION` = `2.77.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.77.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ `forge_patterns_list` added to operational/troubleshoot/build lane allowlist (Phase-32 violation) → halt.
- ❌ Pattern detector injects context into hardener prompt or executor → halt immediately.
- ❌ Pattern detector modifies any run or plan artifact → halt immediately.
- ❌ Registry crashes when a malformed detector is present (must be skip+warn, not throw) → fix before continuing.
- ❌ Any modification outside listed scope → halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Gate-failure detector produces false positives on expected test failures | Filter to events where `gateResult === "fail"` AND `retryCount > 0` AND slice was ultimately retried; single-attempt gate failures on new slices are not "recurring" |
| 2 | Pattern injection into troubleshoot replies inflates token cost | Inject at most 3 pattern summaries; each summary is 1-2 sentences; negligible cost impact |
| 3 | Detector file auto-loading picks up non-detector files in the `detectors/` dir | Registry only loads files matching `*.mjs` that export a default function — log warning and skip others |
| 4 | `slice-flap-pattern` produces false positives during active development (all slices flap) | Require ≥ 3 flaps AND ≥ 14 days between first and last occurrence to filter out hot-development noise |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~10K | ~$0.02 |
| Slice 2 | ~12K | ~$0.03 |
| Slice 3 | ~10K | ~$0.02 |
| Slice 4 | ~6K | ~$0.01 |
| **Total** | **~38K** | **~$0.08** |

---

## Session Break Points

After Slice 2 — Slice 3 requires context-switching between pforge-master (intent router, reasoning) and pforge-mcp (server MCP registration) simultaneously; a fresh session prevents the dual-codebase mental model from going stale.
