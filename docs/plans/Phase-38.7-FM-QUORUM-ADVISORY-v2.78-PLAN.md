---
crucibleId: 8f92ee55-ff4e-4d50-859c-05d19ed3a81e
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.7 — Forge-Master Quorum Advisory Mode

> **Target release**: v2.78.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0). Independent of other 38.x phases.

---

## Specification Source

- **Problem**: For high-stakes advisory questions ("should I add this 4th abstraction layer?", "which auth library?"), a single model reply is a single opinion. The orchestrator already supports multi-model quorum; Forge-Master should mirror this for high-tier advisory escalations.
- **Root cause**: `runTurn` dispatches to exactly one model. No multi-model fan-out or dissent-surface mechanism exists.
- **Contract**: After this phase, when `pref.quorumAdvisory` is `"always"` OR (`"auto"` AND lane=advisory AND escalated tier=high AND confidence≥medium), `runTurn` fans out to 2–3 models in parallel, streams a `quorum-estimate` SSE event before dispatch, and returns all N replies with a dissent summary. Human picks.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-master/src/quorum-dispatcher.mjs` — `dispatchQuorum({prompt, models, deps}) → {replies: [{model, text, durationMs, costUSD}], dissent: {topic, axis}}`. Parallel dispatch with 60s hard timeout. Partial results on model failure (1 model fails → return remaining).
- New `pforge-master/src/__tests__/quorum-dispatcher.test.mjs`.
- `pforge-master/src/http-routes.mjs` — extend `loadPrefs/savePrefs` with `quorumAdvisory: "off"|"auto"|"always"`. New `quorum-estimate` SSE event emitted before dispatch.
- `pforge-master/src/reasoning.mjs` — engage quorum path when conditions met; otherwise existing single-model path unchanged.
- Dashboard `pforge-mcp/dashboard/forge-master.js` — "Quorum: off / auto / always" segmented control wired to prefs; multi-model reply cards; dissent summary at top.
- New `pforge-master/tests/quorum-sse.test.mjs` — SSE ordering test.
- New `pforge-master/tests/quorum-dashboard.test.mjs` — dashboard UI test.
- `.forge/validation/probes.json` — new probe `adv-quorum-trigger`.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.78.0 release metadata.

### Out of Scope

- ❌ Auto-picking a winner / majority vote output.
- ❌ Quorum on operational/troubleshoot/build lanes (Phase-32 guardrail — those lanes are frozen).
- ❌ New model adapters or providers.
- ❌ Quorum for plan slice execution (orchestrator has its own mechanism).
- ❌ Changing build/operational/troubleshoot lane tool lists.

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Quorum mode must never engage on operational/troubleshoot/build lanes — hard gate in code.
- ❌ Do not auto-pick a winner from quorum replies — present all N to the human.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Models in quorum | Resolved | Reuse `forge_estimate_quorum`'s "power" preset: sonnet, gpt-5.x, grok-4.20 (via existing adapters) |
| 2 | Max models | Resolved | Hard cap: 3 models per quorum invocation |
| 3 | Default pref | Resolved | `"off"` — must explicitly enable |
| 4 | Cost warning | Resolved | `quorum-estimate` SSE event before dispatch with per-model cost estimate; client can cancel |
| 5 | Timeout | Resolved | 60s hard timeout for quorum fan-out (longer than planner's 30s due to multiple model calls) |
| 6 | Partial failure | Resolved | If ≥ 1 model returns successfully, return partial results; do not fail the turn |

---

## Acceptance Criteria

### Slice 1 — Quorum dispatcher

- **MUST**: `pforge-master/src/quorum-dispatcher.mjs` exports `dispatchQuorum({prompt, models, deps})`.
- **MUST**: Return shape: `{replies: Array<{model, text, durationMs, costUSD}>, dissent: {topic, axis}}`.
- **MUST**: Dispatches to all models in `models` in parallel.
- **MUST**: Hard 60s timeout: models that haven't responded are cancelled and omitted from `replies`.
- **MUST**: If 1 of 3 models fails, returns 2 replies in `replies` (not an error).
- **MUST**: If ALL models fail, returns `{replies: [], dissent: {topic: "all-failed", axis: ""}}`.
- **MUST**: `dissent.topic` and `dissent.axis` summarize the primary divergence point (or are empty strings when replies are homogeneous).
- **MUST**: `pforge-master/src/__tests__/quorum-dispatcher.test.mjs` passes covering: parallel dispatch, partial-failure, all-fail, timeout, dissent extraction.

### Slice 2 — Pref endpoint + auto-engage logic

- **MUST**: `pforge-master/src/http-routes.mjs` `loadPrefs`/`savePrefs` handles `quorumAdvisory: "off"|"auto"|"always"` field.
- **MUST**: `GET /api/forge-master/prefs` includes `quorumAdvisory` in the response.
- **MUST**: `PUT /api/forge-master/prefs` accepts `quorumAdvisory` and persists it.
- **MUST**: `pforge-master/src/reasoning.mjs` engages quorum when: `pref.quorumAdvisory === "always"` OR (`pref.quorumAdvisory === "auto"` AND `lane === "advisory"` AND `autoEscalated === true` AND `fromTier === "high"` AND `confidence === "medium"|"high"`).
- **MUST**: Quorum must NEVER engage on operational, troubleshoot, or build lanes — enforced by explicit lane check in `reasoning.mjs`.
- **MUST**: `quorum-estimate` SSE event is emitted (shape `{type: "quorum-estimate", models: [...], estimatedCostUSD: number}`) BEFORE the first model dispatch begins.
- **MUST**: New SSE test `pforge-master/tests/quorum-sse.test.mjs` asserts `quorum-estimate` event arrives before any reply chunk in an auto-engage scenario.
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` continues to pass.

### Slice 3 — Dashboard quorum picker + reply UI

- **MUST**: Dashboard has a "Quorum advisory" segmented control (`off / auto / always`) in the Forge-Master preferences section.
- **MUST**: Control state is read from and written to `GET/PUT /api/forge-master/prefs`.
- **MUST**: When quorum reply is received, UI renders N model reply cards side-by-side (or stacked on narrow screens).
- **MUST**: Dissent summary is rendered at the top of the reply section with `> **Dissent:** <topic> — <axis>`.
- **MUST**: `pforge-master/tests/quorum-dashboard.test.mjs` passes verifying 3-card layout renders from a fixture quorum reply payload.

### Slice 4 — Probe harness + release v2.78.0

- **MUST**: `.forge/validation/probes.json` gains probe `adv-quorum-trigger` with a high-stakes advisory prompt.
- **MUST**: Probe harness run with `pref.quorumAdvisory = "auto"` shows `quorum-estimate` SSE event for the `adv-quorum-trigger` probe.
- **MUST**: `VERSION` contains exactly `2.78.0`.
- **MUST**: `CHANGELOG.md` has a `[2.78.0]` section mentioning `quorum advisory`, `quorum-estimate`, and `dissent summary`.
- **MUST**: `ROADMAP.md` reflects Phase-38.7 / v2.78.0 as shipped.
- **MUST**: Git tag `v2.78.0` applied.

### Quality bar

- **SHOULD**: `quorum-estimate` event includes `canCancel: true` flag so clients can display a cancel button.
- **SHOULD**: Quorum reply includes total wall-clock duration and per-model token counts.
- **SHOULD**: When `pref.quorumAdvisory === "off"`, quorum code path is completely skipped (no performance overhead).

---


### Slice 38.7 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.7/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.7/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Quorum dispatcher [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 60–90 min

**Files to create**:
- `pforge-master/src/quorum-dispatcher.mjs`
- `pforge-master/src/__tests__/quorum-dispatcher.test.mjs`

**Depends On**: Phase-37 shipped (v2.71.0). Independent of other 38.x phases.

**Context Files**:
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs) — provider selection pattern
- [pforge-master/src/reasoning-tier.mjs](../../pforge-master/src/reasoning-tier.mjs) — `resolveModel`
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Implement `dispatchQuorum`: map `models` array to parallel provider calls using existing `selectProvider`.
2. `Promise.allSettled` to collect results; filter fulfilled; cap at 3 models.
3. 60s timeout via `Promise.race`.
4. Dissent extraction: compare first 50 words of each reply for semantic divergence (simple keyword diff is acceptable for v1).
5. Unit tests covering all failure modes.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/quorum-dispatcher.test.mjs
```

**Commit**: `feat(quorum): quorum dispatcher with parallel dispatch and dissent extraction`

---

### Slice 2 — Pref endpoint + auto-engage logic [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to modify**:
- `pforge-master/src/http-routes.mjs`
- `pforge-master/src/reasoning.mjs`

**Files to create**:
- `pforge-master/tests/quorum-sse.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/http-routes.mjs](../../pforge-master/src/http-routes.mjs)
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs)
- [pforge-master/tests/http-routes-sse.test.mjs](../../pforge-master/tests/http-routes-sse.test.mjs)

**Steps**:
1. Extend `loadPrefs`/`savePrefs` with `quorumAdvisory` field (default `"off"`).
2. In `runTurn`: read `deps.quorumAdvisory`; evaluate auto-engage conditions; call `dispatchQuorum` when engaged.
3. Emit `quorum-estimate` SSE event immediately before dispatching.
4. Hard lane guard: `if (lane !== "advisory") skip quorum path`.
5. Write SSE ordering test.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/quorum-sse.test.mjs pforge-master/tests/http-routes-sse.test.mjs
```

**Commit**: `feat(quorum): quorumAdvisory pref + auto-engage logic + quorum-estimate SSE event`

---

### Slice 3 — Dashboard quorum picker + reply UI [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge-mcp/dashboard/forge-master.js`

**Files to create**:
- `pforge-master/tests/quorum-dashboard.test.mjs`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-mcp/dashboard/forge-master.js](../../pforge-mcp/dashboard/forge-master.js)

**Steps**:
1. Add segmented control UI for `quorumAdvisory` pref; wire to `PUT /api/forge-master/prefs`.
2. SSE consumer: on `quorum-estimate` event, show cost estimate + "running…" badge on each model card.
3. On reply, render N model cards with dissent summary at top.
4. Write dashboard test.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/quorum-dashboard.test.mjs
```

**Commit**: `feat(quorum): dashboard quorum picker and multi-model reply cards`

---

### Slice 4 — Probe harness + release v2.78.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to modify**:
- `.forge/validation/probes.json`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [.forge/validation/probes.json](../../.forge/validation/probes.json)

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='2.78.0')throw new Error('VERSION mismatch: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.78.0]'))throw new Error('missing [2.78.0]');if(!c.includes('quorum'))throw new Error('missing narrative');console.log('ok');"
```

**Commit**: `chore(release): v2.78.0 — Forge-Master quorum advisory mode`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.78.0 released).

**Context Files**:
- [pforge-master/src/quorum-dispatcher.mjs](pforge-master/src/quorum-dispatcher.mjs)
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.7-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.7/hammer-<iter>.md`.

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.7.mjs`. 100 quorum dispatch cycles with 3-model fixtures. Edge cases: 1 of 3 models hangs forever (must timeout), all models return identical replies (dissent = empty), 0 models available, pref=off (quorum must not fire). Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.7/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- 1 of 3 models hangs forever — assert hard timeout returns 2/3 results, not blocking.
- All 3 models fail — assert graceful fallback to single-shot reactive, no empty reply.
- Quorum fires on operational lane (should be blocked by Phase-32 guardrail) — assert quorum-estimate NOT emitted.
- `quorum-estimate` SSE event not received by client (client closes early) — assert server side cleans up dispatched model calls.
- Cost estimate calculation overflows (extreme token counts) — assert capped at safe value, no NaN.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.7-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.7/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.7/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.7/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.7.mjs --validate-converged ; npx vitest run pforge-master/src/__tests__/quorum-dispatcher.test.mjs ; pforge analyze docs/plans/Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md
```

**Commit**: `test(38.7): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Confirm partial-failure test passes (1 of 3 models fails → 2 results returned). Confirm 60s timeout test passes (slow model → cancelled, not error).

**After Slice 2**: Re-read the lane guard code path. Run full pforge-master suite. Confirm `quorum-estimate` SSE event does NOT appear on troubleshoot/operational/build probes.

**After Slice 3**: Smoke-test the dashboard control in a local server run. Confirm `pref.quorumAdvisory = "off"` produces zero performance overhead in `runTurn`.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] Quorum never engages on operational/troubleshoot/build lanes — verified by test.
- [ ] `quorum-estimate` SSE event always precedes model dispatch — verified by test.
- [ ] No auto-pick / majority vote logic present.
- [ ] Zero regressions in full pforge-master suite.
- [ ] `VERSION` = `2.78.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.78.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Quorum engages on a non-advisory lane → halt immediately, fix lane guard.
- ❌ Any auto-pick / majority-vote logic detected in `dispatchQuorum` → halt.
- ❌ `quorum-estimate` SSE event arrives AFTER a model reply (ordering violation) → fix before proceeding.
- ❌ `runTurn` throws when all models fail in quorum mode (must return partial/empty gracefully) → fix.
- ❌ `http-routes-sse.test.mjs` regressions → fix immediately.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | 3× model cost surprises users | `quorum-estimate` event displays total estimated cost before dispatch; default is `"off"` |
| 2 | Dissent extraction trivial/wrong for edge cases (all models agree) | Acceptable for v1 — dissent is `""` when replies are homogeneous; improve in future phase |
| 3 | 60s quorum timeout too long for dashboard UX | Show per-model progress cards with streaming; slow models are visually distinguishable |
| 4 | `selectProvider` doesn't support the "power" preset model set | `dispatchQuorum` receives an explicit `models` array from caller; `reasoning.mjs` resolves which models to pass from `forge_estimate_quorum`'s power preset config |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~12K | ~$0.03 |
| Slice 2 | ~14K | ~$0.03 |
| Slice 3 | ~10K | ~$0.02 |
| Slice 4 | ~5K | ~$0.01 |
| **Total** | **~41K** | **~$0.09** |

Note: This plan's EXECUTION cost (when run) will be higher than other plans because Slice 4 probe run triggers real quorum model calls.

---

## Session Break Points

After Slice 2 — Slice 3 is a pure dashboard/UI task; a fresh session avoids carrying the reasoning.mjs mental model into the UI code.
