---
crucibleId: d7fa64b8-583a-4f92-9e2c-6309fdb16de7
lane: full
source: human
---

# Phase-27.2 — Cost Service Refinement: Dashboard Cost Projection + Per-Slice Estimator Tool

> **Target release**: v2.61.0
> **Status**: Draft
> **Depends on**: v2.60.1 shipped (Phase-27.1 hotfix merged); VERSION at `2.60.2-dev` or later.
> **Branch strategy**: Direct to `master`. Two additive surfaces (dashboard badge + new MCP tool) and one scoring investigation.
> **Source**: User request following Phase-27.1 dogfood session — "In the dashboard screenshot we should have a cost badge next to the complexity badge, maybe we can tie this into that here too." Plus the deferred scoring-calibration work from Phase-27.1's Bug C.
> **Session budget**: 8 slices in **1 session** (or 2 if investigation yields a scoring rewrite).
> **Design posture**: Additive only. Existing `forge_estimate_quorum` signature and return shape unchanged. Dashboard gains a projected-cost badge that slots next to the existing complexity badge using the row container already in place. A new per-slice MCP tool gives the dashboard (and agents) a cheap way to fetch one slice's projection without estimating the whole plan.

---

## Specification Source

- **User request (verbatim)**: *"in the dashboard screenshot we should have a cost badge next to the complexity badge maybe we can tie this into that here too"*
- **Dashboard reference** (from user screenshot): each slice card currently shows a complexity badge `⚙ 1/10` and — only after execution — a spend badge `💰 $0.xxxx`. There is no **projected** cost badge shown *before* a slice runs. `pforge-mcp/dashboard/app.js:653` already has a `<div>` that holds `complexityBadge` + `spendBadge`; it is the natural insertion point.
- **Deferred Phase-27.1 finding**: even with `autoConfig.threshold: 5`, the `scoreSliceComplexity` distribution is heavily skewed low on real plans (no Phase-25/26/27 slice scored ≥7; threshold 5 landed a handful into quorum but the distribution's shape is still unexamined). Worth calibrating before the auto-mode tuning becomes load-bearing for agent decisions.
- **Karpathy tie-in**: §2 primitive 3 (streaming evaluation). A projected cost visible on each in-flight slice card turns cost from an end-of-run report into a continuous signal the operator can watch — same shift as the existing `💰` actual-spend badge, moved one step earlier in the loop.

---

## Feature Specification

### Problem Statement
Phase-27 gave agents `forge_estimate_quorum` and Phase-27.1 made its numbers reflect the rate table honestly. Two refinement gaps remain:

1. **The dashboard does not display projected cost.** An operator watching slices execute sees complexity and actual spend, but has no view of *what this slice was projected to cost* until the run completes and `forge_cost_report` aggregates. For a plan with mixed trivial/expensive slices, the operator cannot spot "this slice is about to spend 30% of the budget" before it spends.
2. **Agents cannot cheaply project a single slice.** `forge_estimate_quorum` parses the whole plan and estimates every slice. An agent asked "what will *just slice 4* cost if we escalate to power?" currently has to estimate the whole plan. No per-slice entry point.
3. **Auto-mode's `scoreSliceComplexity` is uncalibrated against real plans.** Phase-27.1 picked `threshold: 5` because `7` produced zero hits; `5` was selected by matching the `power` preset's threshold, not by looking at the actual score distribution. Worth a one-slice investigation + calibration pass before publishing the number as a recommended default.

### User Scenarios
1. **Operator watches the dashboard during `pforge run-plan`**. Each pending slice card shows `⚙ 6/10` (existing) and `💵 ~$0.45` (new — projected cost for this slice under the active mode). As the slice executes, the projection stays; once complete, the existing `💰 $0.4127` actual-spend badge appears alongside. Delta visible at a glance.
2. **Agent asks "re-estimate just slice 4 if we flip quorum on for it"**. Agent calls `forge_estimate_slice` with `{planPath, sliceNumber: 4, mode: "power"}`. Tool returns `{estimatedCostUSD, baseCostUSD, overheadUSD, complexityScore, model, quorumEligible, rationale}`. Agent presents the diff without re-running the whole plan estimator.
3. **Dashboard header shows plan-level projection**. A new "Plan projection" strip at the top of the dashboard (collapsible, small) shows `auto: $21.96  power: $141.31  speed: $72.05  false: $21.96  recommended: auto`. Same payload `forge_estimate_quorum` returns — rendered once at plan load.
4. **Scoring calibration documented**. A short report in `docs/research/` captures the `scoreSliceComplexity` distribution across every `docs/plans/*-PLAN.md` slice in the repo: mean, median, p95, and what threshold values land which proportions into quorum. Picks an evidence-backed threshold. If the existing scoring needs adjustment, that adjustment is proposed but **not** shipped in this phase — it becomes Phase-27.3 or a later phase.

### Acceptance Criteria
- **MUST**: New MCP tool `forge_estimate_slice` registered in `capabilities.mjs`, `tools.json`, dispatched in `server.mjs`. Input: `{planPath, sliceNumber, mode?: "auto"|"power"|"speed"|"false", model?: string}`. Output: `{estimatedCostUSD, baseCostUSD, overheadUSD, complexityScore, model, quorumEligible, rationale, generatedAt}`. Agent guidance: "Use this when you need cost for a single slice — cheaper than `forge_estimate_quorum` (which estimates the whole plan)."
- **MUST**: `cost-service.mjs` exposes `estimateSlice({plan, sliceNumber, mode, model, cwd})` backing the new tool. Reuses the same quorum-config construction as `estimateQuorum` (no new configs).
- **MUST**: Dashboard renders a projected-cost badge alongside the existing complexity + spend badges. Format: `💵 ~$0.xxxx` (prefix `~` distinguishes projection from actual). Styled with the same Tailwind class palette as complexity/spend. Only renders when a projected cost is present in the slice state. Behind an internal state field `projectedCost`.
- **MUST**: Dashboard ingests projected costs from a new `forge_estimate_quorum` call at plan-open time (one call, cached for the session). For each slice in `plan.slices`, it computes per-slice projected cost from the per-slice data returned by `forge_estimate_slice` (hydrated lazily via a batched request, or via a single `forge_estimate_quorum` + per-slice breakdown surfaced in that tool's output — see Slice 2 schema decision below).
- **MUST**: `forge_estimate_quorum` output is extended (additive) with a `slices: [{sliceNumber, projectedCostUSD, complexityScore, quorumEligible}]` array under each mode. Existing top-level keys (`estimatedCostUSD`, `recommended`, `generatedAt`, etc.) unchanged. Backward-compatible — consumers ignoring the new field keep working.
- **MUST**: New dashboard "Plan projection" strip appears once per loaded plan. Collapsed by default. Renders the four-mode spread. Click-to-expand shows per-mode `quorumSliceCount` and `overheadUSD`.
- **MUST**: Scoring calibration report `docs/research/scorecomplexity-distribution-2026-04.md` (one page) documents the observed score distribution on all repo plans, identifies the threshold sweet spot, and — if the current `5` threshold is wrong by the evidence — proposes a replacement for a follow-up phase. Does not ship a scoring change this phase.
- **MUST**: Full vitest suite green. New tests: `forge_estimate_slice` unit + MCP handler, `forge_estimate_quorum` per-slice breakdown schema, dashboard projected-cost state ingestion.
- **MUST**: `VERSION` → `2.61.0`, `pforge-mcp/package.json` → `2.61.0`, release tagged, `--latest`, post-release bump to `2.61.1-dev`.
- **SHOULD**: Budget-cap visual: when any mode's `estimatedCostUSD` exceeds `runtime.cost.budget` from `.forge.json`, that mode's value in the plan-projection strip renders red with a "over budget" tooltip.
- **SHOULD**: Once a slice completes, dashboard shows `💵 ~$0.45 → 💰 $0.41` (projected → actual) for a moment and then collapses to actual only. Optional visual flourish, behind no feature flag.
- **MAY**: `docs/COPILOT-VSCODE-GUIDE.md` mentions `forge_estimate_slice` alongside `forge_estimate_quorum` in the cost section.

---

## Scope Contract

### In-Scope
- `pforge-mcp/cost-service.mjs` — new `estimateSlice` function; `estimatePlan` / `estimateQuorum` extended with a per-slice breakdown under each mode (additive — existing keys unchanged).
- New MCP tool `forge_estimate_slice` across `capabilities.mjs`, `tools.json`, `server.mjs`.
- `pforge-mcp/dashboard/app.js` — projected-cost badge in the existing complexity/spend row; plan-projection strip at plan-open; optional projected→actual flourish.
- `pforge-mcp/dashboard/index.html` — markup for the plan-projection strip (a single collapsible `<div>`; no new panel framework).
- `pforge-mcp/dashboard/app.css` (or inline Tailwind) — styling for the new badge and strip.
- New tests: `tests/estimate-slice.test.mjs`, `tests/dashboard-cost-projection.test.mjs`.
- `docs/research/scorecomplexity-distribution-2026-04.md` — calibration report, no code changes.
- `CHANGELOG.md [2.61.0]`, `VERSION`, `pforge-mcp/package.json` — release mechanics.

### Out-of-Scope
- Rewriting `scoreSliceComplexity`. Report proposes a direction; actual scoring changes land in a follow-up phase.
- Changing `MODEL_PRICING` rates.
- Changing `QUORUM_PRESETS` model lists or thresholds.
- Real-time cost streaming during slice execution (would require orchestrator instrumentation — separate phase).
- Historical cost charts (already served by `forge_cost_report` + `docs/dashboard/`).
- New quorum modes beyond the four existing.
- Removing or collapsing the existing `💰` actual-spend badge.
- Server-side projected-cost tracking in `.forge/runs/*.json` — dashboard reads via MCP, doesn't persist.

### Forbidden Actions
- `git push --force`, deletion of v2.60.x tags.
- Editing `pforge-mcp/crucible*.mjs`.
- Breaking changes to `forge_estimate_quorum` output — **additive only** (new `slices[]` under each mode is OK; existing keys keep same types).
- Any edit to `mcp/dashboard/*` or `docs/dashboard/*` — that's a different dashboard (public/demo). This phase targets only `pforge-mcp/dashboard/*` (the operator dashboard).
- Changing any `orchestrator.mjs` pricing shim signature.

### Resolved Decisions
1. **Per-slice projection data path**: extend `forge_estimate_quorum` output with a per-mode `slices: [{sliceNumber, projectedCostUSD, complexityScore, quorumEligible}]`. Dashboard issues one call at plan-open time and indexes slice IDs from that payload. `forge_estimate_slice` exists for agent-driven single-slice queries; dashboard does not call it per-slice.
2. **Badge placement**: reuse the existing `<div class="flex items-center gap-1.5 mt-1.5">` row at `pforge-mcp/dashboard/app.js:653` that already holds `complexityBadge` + `spendBadge`. Add `projectedBadge` as a third child. Order: complexity → projected → spend.
3. **Projected vs actual icon**: `💵` for projected (ASCII fallback `~$`), `💰` for actual (existing). Operator reads left-to-right: complexity → what we expected → what we spent.
4. **Mode selection for dashboard projection**: dashboard calls `forge_estimate_quorum` once and uses the `recommended` mode's per-slice breakdown by default. A mode selector dropdown (auto/power/speed/false) above the slice grid lets the operator switch the projection view. No backend change — pure client re-index.
5. **Plan-projection strip**: one row at the top of the dashboard, collapsed by default, four columns for the four modes + one for `recommended`. Over-budget values (if `runtime.cost.budget` set) render red.
6. **Budget cap source**: `.forge.json` `runtime.cost.budget` (already consumed by `estimateQuorum` for its `recommended` logic). Dashboard reads it from the same payload field — no new config.
7. **Scoring investigation scope**: report only. Any scoring change is a new phase. Rationale — changing `scoreSliceComplexity` affects `auto` mode selection on every plan forever and deserves its own scope contract.
8. **Version**: 2.61.0 (minor — one new MCP tool + additive field on an existing tool + dashboard UI).

---

## Dependency DAG

```
Slice 1 (estimateSlice in cost-service)
   │
   ├── Slice 2 (extend estimateQuorum output schema with per-slice breakdown)
   │     │
   │     └── Slice 4 (dashboard ingest + projected-cost badge on slice cards)
   │              │
   │              └── Slice 5 (plan-projection strip + budget-cap highlighting)
   │                       │
   │                       └── Slice 6 (projected→actual flourish on slice completion)
   │
   └── Slice 3 (forge_estimate_slice MCP tool)

Slice 7 (scoreSliceComplexity distribution report) [parallel, no code deps]
   │
   └── Slice 8 (CHANGELOG + release v2.61.0)
```

---

## Slices

### Slice 1: `estimateSlice()` in cost-service
**Scope**: `pforge-mcp/cost-service.mjs`.

**New export**:
```js
export function estimateSlice({ plan, sliceNumber, mode = "auto", model = "claude-sonnet-4.5", cwd } = {}) {
  // Resolve slice from plan. Build the same quorumConfig that estimateQuorum builds
  // for the requested mode. Compute: baseCostUSD from avgTokensPerSlice + getPricing(model).
  // If mode's config marks this slice as quorum-eligible (auto: threshold check; forced: always),
  // compute overhead using the per-leg loop from Slice 1 of Phase-27.1.
  // Return structured payload with rationale ("threshold 5 met: complexity 6", etc.).
}
```

**Tests** (new file `tests/estimate-slice.test.mjs`, ~10 tests):
- Returns a finite cost for every valid `sliceNumber`.
- `mode: "false"` returns `overheadUSD: 0` and `quorumEligible: false`.
- `mode: "power"` on a trivially-scored slice returns `quorumEligible: true` (power forces all).
- `mode: "auto"` on a trivially-scored slice returns `quorumEligible: false` and a rationale naming the threshold.
- Throws with a clear error if `sliceNumber` is not in `plan.slices`.
- Parity (un-calibrated): summing `estimateSlice` over every slice in a plan equals `estimatePlan(...).totalCostWithQuorumUSD` **when `estimatePlan` is called with a `cwd` that has no `.forge/cost-history.json`** (historical calibration factor == 1.0). With history present, `estimatePlan` applies a single run-level `correctionFactor` (0.5×–3× clamp) that distorts the sum; the per-slice projection intentionally does not re-derive that factor from a single slice's context. Document this in `estimateSlice`'s JSDoc: "Per-slice projections are un-calibrated base × rate numbers. Run-level historical calibration is applied in `estimatePlan` / `estimateQuorum` only."

**Gates**:
- Full vitest suite + 10 new tests green.
- Parity test holds for all three real repo plans (25, 26, 27).

**Commit**: `feat(cost-service): Phase-27.2 Slice 1 — estimateSlice() per-slice projection primitive`

---

### Slice 2: Extend `estimateQuorum` output with per-slice breakdown
**Scope**: `pforge-mcp/cost-service.mjs` `estimateQuorum` return construction.

**Additive change**: each mode summary gains:
```js
slices: plan.slices.map((s) => ({
  sliceNumber: s.number,
  projectedCostUSD: /* from estimateSlice or computed inline */,
  complexityScore: /* from scoreSliceComplexity */,
  quorumEligible: /* true if this mode's config would quorum-gate this slice */,
})),
```

Existing keys (`mode`, `estimatedCostUSD`, `baseCostUSD`, `overheadUSD`, `quorumSliceCount`, `totalSliceCount`, `confidence`) remain in place.

**Tests**: extend existing `estimateQuorum regression` test to assert the new field shape; ensure `JSON.parse(JSON.stringify(result))` round-trips cleanly (MCP serialization sanity).

**Gates**:
- Existing `estimateQuorum regression` + `REGRESSION GUARD` tests stay green.
- New assertion: `result.power.slices.length === plan.slices.length`.
- Full vitest suite green.

**Commit**: `feat(cost-service): Phase-27.2 Slice 2 — per-slice breakdown under each quorum mode`

---

### Slice 3: `forge_estimate_slice` MCP tool
**Scope**: `pforge-mcp/capabilities.mjs`, `tools.json`, `server.mjs`.

**Registration pattern**: mirror `forge_estimate_quorum` (established in Phase-27 Slice 6, corrected in Phase-27.1 Slice 2b).

**Critical**: the tool name MUST also be added to the `MCP_ONLY_TOOLS` Set in `server.mjs` (same fix Phase-27.1 Slice 2b applies for `forge_estimate_quorum`) — otherwise the `/api/tool/forge_estimate_slice` HTTP bridge falls through to `runPforge` and the dashboard cannot invoke it. The HTTP-bridge coverage test added in Phase-27.1 Slice 2b will catch this automatically if we forget; the slice calls it out explicitly so we don't.

**Tool metadata**:
- `intent: ["estimate", "cost", "slice", "planning"]`
- `aliases: ["slice-cost", "per-slice-estimate"]`
- `agentGuidance`: *"Use this when you need cost for a single slice — cheaper than forge_estimate_quorum (which estimates the whole plan). Returns projected cost, complexity score, and a rationale for why the slice is or isn't quorum-eligible under the chosen mode."*

**Handler body** (`server.mjs`):
```js
if (name === "forge_estimate_slice") {
  const t0 = Date.now();
  try {
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const planFullPath = resolve(cwd, args.planPath);
    if (!existsSync(planFullPath)) return { content: [{ type: "text", text: `PLAN_NOT_FOUND: ${args.planPath}` }], isError: true };
    const { parsePlan } = await import("./orchestrator.mjs");
    const { estimateSlice } = await import("./cost-service.mjs");
    const plan = parsePlan(planFullPath, cwd);
    const result = estimateSlice({ plan, sliceNumber: args.sliceNumber, mode: args.mode, model: args.model, cwd });
    await broadcastLiveGuard("forge_estimate_slice", "OK", Date.now() - t0, { sliceNumber: args.sliceNumber, mode: args.mode });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Estimate error: ${err.message}` }], isError: true };
  }
}
```

**Gates**:
- `TOOL_METADATA.forge_estimate_slice` present; `tools.json` has entry; `server.mjs` tool list, switch case, and handler all registered.
- New MCP handler test covers happy path + PLAN_NOT_FOUND + invalid sliceNumber.

**Commit**: `feat(mcp): Phase-27.2 Slice 3 — register forge_estimate_slice tool`

---

### Slice 4: Dashboard — projected-cost badge on slice cards
**Scope**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html` (minimal).

**Changes to `app.js`**:
- On plan open (when `state.planPath` becomes known): call `forge_estimate_quorum` once, store the response in `state.planProjection`.
- Pick the `recommended` mode's `slices[]` (or whichever mode a new `state.projectionMode` selector currently points at; default to `recommended`).
- For each slice in `state.slices`, hydrate `slice.projectedCost` from `state.planProjection[state.projectionMode].slices.find(s => s.sliceNumber === slice.id)?.projectedCostUSD`.
- Add `projectedBadge` beside `complexityBadge` / `spendBadge` at line ~653:
  ```js
  const projectedBadge = (typeof s.projectedCost === "number" && s.projectedCost > 0)
    ? `<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-sky-300 border border-gray-700" title="Projected cost (mode: ${state.projectionMode})">💵 ~$${s.projectedCost.toFixed(4)}</span>`
    : "";
  ```
- Update the container line: `${(complexityBadge || projectedBadge || spendBadge) ? \`<div class="flex items-center gap-1.5 mt-1.5">${complexityBadge}${projectedBadge}${spendBadge}</div>\` : ""}`.
- Add a small mode selector `<select>` above the slice grid: options `recommended`, `auto`, `power`, `speed`, `false`. On change, re-hydrate `slice.projectedCost` from the cached `state.planProjection`. No server round-trip.

**Tests** (`tests/dashboard-cost-projection.test.mjs`, DOM-level or state-level, ~6 tests):
- State ingestion: given a mock `forge_estimate_quorum` payload, `state.slices[i].projectedCost` matches the payload's `slices[i].projectedCostUSD`.
- Badge rendering: when `s.projectedCost` is set, badge appears; when unset, it's omitted.
- Mode switch re-hydrates without re-calling the tool.
- Plan with zero quorum slices under a mode: projected badge still renders (base cost).

**Gates**:
- Manual: dashboard open on the Phase-27 plan shows `💵 ~$...` on each slice card next to `⚙ N/10`.
- Full vitest suite green.

**Commit**: `feat(dashboard): Phase-27.2 Slice 4 — projected-cost badge on slice cards`

---

### Slice 5: Dashboard — plan-projection strip + budget-cap highlight
**Scope**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`.

**Markup** (collapsed by default, ~12 lines in `index.html`): one row at the top of the dashboard body with four spans (auto/power/speed/false) + a `Recommended: X` label + a caret to expand.

**Expanded**: each mode's row shows `$X.XX · N/M quorum slices · $Y overhead`.

**Budget cap**: if `state.planProjection.budgetCapUSD` is set and a mode's `estimatedCostUSD > budgetCapUSD`, that mode's number renders `text-red-400` with tooltip `Over budget ($X.XX > $Y.YY)`.

**Tests** (~4 tests in same file as Slice 4):
- Strip renders with four modes when projection state is hydrated.
- Recommended mode highlighted.
- Budget-cap red rendering triggers only when mode cost > cap.

**Gates**:
- Manual smoke: open dashboard on any `docs/plans/*-PLAN.md`, strip shows four costs; set a budget cap in `.forge.json`, strip respects it.
- Full vitest suite green.

**Commit**: `feat(dashboard): Phase-27.2 Slice 5 — plan-projection strip with budget-cap highlight`

---

### Slice 6: Projected → actual flourish on slice completion (optional polish)
**Scope**: `pforge-mcp/dashboard/app.js`.

**Behavior**: when a slice transitions `pending → running → passed` (or failed with a non-zero cost recorded), show `💵 ~$0.45 → 💰 $0.41` for 5 seconds, then fade the projected badge to opacity 0 and leave only the actual-spend badge. CSS transition only; no state machine.

**Tests**: one rendering test that simulates the transition and asserts the DOM reflects both badges during the 5-second window.

**Gates**:
- Full vitest suite green.
- Manual smoke: run a short plan, watch the transition on one slice.

**Commit**: `feat(dashboard): Phase-27.2 Slice 6 — projected→actual flourish on slice completion`

---

### Slice 7: `scoreSliceComplexity` distribution report
**Scope**: new file `docs/research/scorecomplexity-distribution-2026-04.md`. No source code changes.

**Content**:
- Method: iterate every `docs/plans/*-PLAN.md`, call `scoreSliceComplexity(slice, cwd).score` for each slice, record.
- Data: histogram of scores (integer bins 1–10), mean, median, p50, p75, p95, max.
- Threshold sweep table: for thresholds 3, 4, 5, 6, 7, how many slices (and what %) land in quorum.
- Finding: current threshold choice (5, matching power preset) is or isn't evidence-aligned — state it.
- Recommendation (for a future phase, not this one): either "threshold 5 is correct and this is not a scoring bug, it's a distribution feature" OR "scoreSliceComplexity over-weights X and under-weights Y; here's a proposed reweighting for Phase-27.3 or equivalent."

**Gates**: document present, data table populated, conclusion stated.

**Commit**: `docs(research): Phase-27.2 Slice 7 — scoreSliceComplexity distribution calibration report`

---

### Slice 8: CHANGELOG + release v2.61.0
**Scope**: `CHANGELOG.md`, `VERSION`, `pforge-mcp/package.json`, GitHub release.

**CHANGELOG `[2.61.0]` shape**:
- `### Added` — `forge_estimate_slice` MCP tool; per-slice breakdown under each mode in `forge_estimate_quorum`; projected-cost badge on dashboard; plan-projection strip.
- `### Changed` — dashboard cost UX: complexity → projected → actual left-to-right on every slice card.
- `### Docs` — `scoreSliceComplexity` distribution report in `docs/research/`.

**Release**: VERSION/package.json → `2.61.0`; tag `v2.61.0`; `gh release create --latest`; bump back to `2.61.1-dev`.

**Gates**:
- `git show v2.61.0:VERSION` returns `2.61.0`.
- `gh release view v2.61.0 --json isLatest --jq .isLatest` returns `true`.
- Full vitest suite green at release commit.

**Commit**: `chore(release): v2.61.0 — cost projection UI + per-slice estimator`

---

## Teardown Safety

- Create baseline branch **before Slice 1**: `git branch pre-phase-27-2`.
- Any slice failure: `git reset --hard pre-phase-27-2`.
- Dashboard slices (4–6) should be verified with a manual smoke before commit; each one reverts cleanly to the previous slice without state carryover (projections are client-side only).
- If the scoring-report finding (Slice 7) changes the appetite for shipping the dashboard work, Slices 4–6 can still ship on their own — they use whatever `scoreSliceComplexity` currently returns, they don't depend on it being correct.
