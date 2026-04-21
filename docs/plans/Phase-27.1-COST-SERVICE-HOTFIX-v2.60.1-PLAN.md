---
crucibleId: grandfathered-564ff228-6cb9-4a98-bf90-87911fd51d7d
lane: full
source: human
---

# Phase-27.1 — Cost Service Hotfix (Bugs found by dogfooding `forge_estimate_quorum`)

> **Target release**: v2.60.1
> **Status**: Draft
> **Depends on**: v2.60.0 shipped; VERSION at `2.60.1-dev`
> **Branch strategy**: Direct to `master` (bug fixes in a single module + pricing table + one regression-guard rescale)
> **Source**: Field dogfood 2026-04-20 — ran `forge_estimate_quorum` against `Phase-25` (11 slices), `Phase-26` (17 slices), `Phase-27` (7 slices). Output revealed three bugs invisible to the fixture-only unit tests.
> **Session budget**: 5 slices in **1 session**
> **Design posture**: Behavior-correcting, not feature-adding. Public API and MCP tool surface unchanged. Only numbers the tool returns change — and the change makes them reflect the stated pricing table instead of silently collapsing to the default model's rate.

---

## Specification Source

- **Dogfood output** (verbatim):
  ```
  Phase-25 (11 slices): power=$141.31  speed=$141.31  auto=$21.96  false=$21.96
  Phase-26 (17 slices): power=$218.39  speed=$218.39  auto=$33.94  false=$33.94
  Phase-27  (7 slices): power= $89.93  speed= $89.93  auto=$13.98  false=$13.98
  ```
- **Bug A — `power` and `speed` return byte-identical numbers**. Defeats the picker's entire purpose (differentiating model tiers). Root cause: `cost-service.mjs:231-233` multiplies dry-run cost by the **default model's** pricing, not each `quorumConfig.models[i]`'s pricing.
- **Bug B — `claude-opus-4.7` (the power-preset reviewer) is absent from `MODEL_PRICING`**. Silently falls through `getPricing()` default to sonnet-4.5 rates, nullifying the one term where `reviewerModel` is read correctly.
- **Bug C — `auto` mode produces `quorumSliceCount: 0` on every real plan**. 11-, 17-, and 7-slice plans all had zero slices clear the `threshold: 7` gate. `auto` degenerates to `false`, neutralizing its adaptive-selection value prop.
- **Bug D (narrative)** — the v2.60.0 CHANGELOG framed `$146.57` as a chat hallucination. Dogfood data shows the estimator itself returns `$141-218` for real plans. The agent was more likely reading from the estimator (or a close cousin). CHANGELOG needs an honest amendment.
- **Karpathy tie-in**: §2 primitive 2 (verifiable actions). Phase-27 gave agents a tool to call; Phase-27.1 makes the tool's numbers honest about which models they reflect.

---

## Feature Specification

### Problem Statement
`forge_estimate_quorum` shipped in v2.60.0 with a test suite that only exercised 6-slice fixture plans. Three real-plan regressions slipped past the fixture boundary: (A) per-leg dry-run pricing uses the wrong model, (B) one reviewer model is missing from the rate card, (C) auto-mode's complexity threshold is set higher than anything `scoreSliceComplexity` actually produces in practice. Result: the picker shows indistinguishable `power`/`speed` numbers, `auto` never selects any slice, and the numbers do not reflect the rate table the module claims to be the source of truth for.

### User Scenarios
1. **Agent calls `forge_estimate_quorum` on a real 11-slice plan**. `power` now reflects opus-4.6 + codex + grok-reasoning rates; `speed` reflects sonnet-4.6 + gpt-mini + grok-fast rates. The two modes differ by ~5–20× — matching the ~10–40× input-token spread between the two preset rate cards. Agent presents meaningfully distinct dollar amounts.
2. **Agent calls it on the same plan with `auto`**. At least one slice clears the threshold and contributes to `auto.quorumSliceCount`. `auto` lands somewhere between `false` and `speed`, as the preset description promises ("adaptively enable quorum on hard slices").
3. **Regression guard is meaningful**. The fixture-only `< $25 for 6 heuristic slices` gate stays. A new **real-plan gate** asserts `power > speed > auto >= false` on every `docs/plans/*-PLAN.md` in the repo. Fixture gate catches unit regressions; real-plan gate catches integration regressions the way dogfooding just did.
4. **CHANGELOG tells the truth**. v2.60.1 CHANGELOG includes a "Correction to v2.60.0 release notes" note retracting the `$146.57 was fabricated` framing. Release notes are updated in GitHub too.

### Acceptance Criteria
- **MUST**: In `cost-service.mjs` `estimatePlan`, dry-run cost is computed per model in `quorumConfig.models[]` using `getPricing(model)` for each, summed — not `modelCount * defaultPricing`.
- **MUST**: `MODEL_PRICING` includes `claude-opus-4.7` with input `0.000015` and output `0.000075` (mirrors `claude-opus-4.6`, the closest published Anthropic opus-tier point).
- **MUST**: `claude-opus-4.7` is covered by the existing `pricing table coverage` parity test — no model named in `QUORUM_PRESETS` may fall through to the default path.
- **MUST**: `auto` mode threshold lowered from `7` → `5` in `cost-service.mjs estimateQuorum autoConfig`, matching `QUORUM_PRESETS.power.threshold` (the semantic is "auto picks the same complex slices that power would force"). Real-plan gate asserts `auto.quorumSliceCount > 0` on Phase-25 (largest real plan in repo).
- **MUST**: New test `tests/cost-service-real-plans.test.mjs` iterates every `docs/plans/*-PLAN.md` in the repo, calls `estimateQuorum`, and asserts:
  - `power.estimatedCostUSD > speed.estimatedCostUSD` (power is flagship tier, must cost more)
  - `speed.estimatedCostUSD > false.estimatedCostUSD` (any quorum costs more than none)
  - `auto.estimatedCostUSD <= speed.estimatedCostUSD` (auto picks a subset of what speed forces)
  - For the largest plan (≥10 slices): `auto.quorumSliceCount > 0` (auto actually selects something)
- **MUST**: Fixture-based regression guard in `tests/cost-service.test.mjs` stays green. Rescale its expected ceiling if the per-model pricing fix raises the fixture `power` number above `$25` — update to `< $50` (still well below the $100+ fabrication floor) rather than dropping the test.
- **MUST**: Full vitest suite continues to pass.
- **MUST**: CHANGELOG `[2.60.1]` section explains all three fixes AND retracts the "fabrication" framing from v2.60.0. Honest one-liner: "the numbers the v2.59 agent quoted were consistent with what the estimator itself produced on a plan of that size; the fix was the tool-call forcing function, not a math correction."
- **MUST**: GitHub release notes for v2.60.0 updated in place with a correction footer linking to v2.60.1.
- **MUST**: `VERSION` → `2.60.1`, `pforge-mcp/package.json` → `2.60.1`, tag `v2.60.1` pushed, release marked `--latest`, post-release bump to `2.60.2-dev`.
- **SHOULD**: `forge_estimate_quorum` `agentGuidance` gains a one-liner: "On plans with <3 slices or dominated by scaffolding slices, numbers are best-effort heuristic — call `forge_cost_report` for actuals once a run completes."

---

## Scope Contract

### In-Scope
- `pforge-mcp/cost-service.mjs` — fix per-leg pricing loop in `estimatePlan`, add `claude-opus-4.7` to `MODEL_PRICING`, lower `autoConfig.threshold` from 7 to 5.
- `pforge-mcp/server.mjs` — add `forge_estimate_quorum` to the `MCP_ONLY_TOOLS` Set (one-line fix — without it, the dashboard's `/api/tool/forge_estimate_quorum` endpoint falls through to `runPforge` and cannot invoke the tool). Carryover defect from Phase-27 Slice 6.
- `pforge-mcp/tests/cost-service.test.mjs` — rescale fixture regression ceiling if needed; add a "all QUORUM_PRESETS models are in MODEL_PRICING" coverage test.
- New `pforge-mcp/tests/cost-service-real-plans.test.mjs` — real-plan smoke matrix over `docs/plans/*-PLAN.md`.
- `CHANGELOG.md` — `[2.60.1]` section + honest retraction of v2.60.0 "fabrication" framing.
- `VERSION`, `pforge-mcp/package.json` — bump to 2.60.1, then bump back to 2.60.2-dev after release.
- GitHub v2.60.0 release notes — in-place edit adding a correction footer.

### Out-of-Scope
- Dashboard cost badge — that's Phase-27.2.
- `forge_estimate_slice` per-slice projection tool — Phase-27.2.
- Budget cap UI — Phase-27.2.
- Rewriting `scoreSliceComplexity` — that's a Phase-27.2 investigation; this hotfix only adjusts the threshold that reads from it.
- Any changes to `orchestrator.mjs` pricing shims, `visual-diff.mjs`, or `MODEL_PRICING` rate values for models already in the table.
- New MCP tools.
- Changes to `copilot-instructions.md` or its template (v2.60.0's section stands).

### Forbidden Actions
- `git push --force`, deletion of `v2.60.0` tag, rewriting v2.60.0 commit history.
- Editing `pforge-mcp/crucible*.mjs`.
- Editing `mcp/dashboard/*` or `docs/dashboard/*`.
- Changing any `MODEL_PRICING` rate for a model already in the table — only `claude-opus-4.7` is *added*.
- Dropping or weakening the fixture regression guard — rescale only.

### Resolved Decisions
1. **Per-leg pricing formula**: sum `getPricing(m).input * dryRunInputPerLeg + getPricing(m).output * dryRunOutputPerLeg` across each `m` in `quorumConfig.models`. Not `modelCount * ...`.
2. **`claude-opus-4.7` rate**: mirror `claude-opus-4.6` (`0.000015` / `0.000075`) until Anthropic publishes a distinct rate. Record source in a code comment.
3. **`auto` threshold**: 5 (matches `QUORUM_PRESETS.power.threshold`). Preserves the semantic "auto applies quorum where power would force it".
4. **Fixture regression ceiling**: rescale to `< $50` if the fix pushes fixture `power` above `$25`. The ceiling exists to catch $100+ fabrication regressions, not to pin an exact number.
5. **Real-plan coverage**: test iterates **every** `docs/plans/*-PLAN.md`. If a new plan lands in `docs/plans/`, it gets coverage automatically. No opt-in list.
6. **CHANGELOG retraction tone**: factual, no self-flagellation. "The numbers the previous agent quoted were consistent with what the estimator itself produces on plans of comparable size. The Phase-27 value was making cost a tool-call, not a chat number. Phase-27.1 closes three real bugs surfaced by running the new tool against real plans."
7. **Version**: 2.60.1 (patch — bug fixes only, no new tool, no schema changes).

---

## Dependency DAG

```
Slice 1 (per-leg pricing) ───┐
Slice 2 (opus-4.7 in table) ──┤
Slice 2b (HTTP bridge reg)  ──┤── Slice 4 (real-plan test suite)
Slice 3 (auto threshold=5) ──┘           │
                                          └── Slice 5 (CHANGELOG + release v2.60.1)
```

---

## Slices

### Slice 1: Per-leg dry-run pricing uses each quorum model's rate
**Scope**: `pforge-mcp/cost-service.mjs` — `estimatePlan` quorum overhead block.

**Current (bug)**:
```js
const dryRunCostPerSlice = modelCount * (
  (dryRunInputPerLeg * pricing.input) + (dryRunOutputPerLeg * pricing.output)
);
```

**Target**:
```js
const dryRunCostPerSlice = quorumConfig.models.reduce((sum, m) => {
  const mPricing = getPricing(m);
  return sum + (dryRunInputPerLeg * mPricing.input) + (dryRunOutputPerLeg * mPricing.output);
}, 0);
```

**Parity test update**: the existing `estimatePlan parity` test pinned pre-refactor behavior. Because the pre-refactor behavior was *also* buggy (same wrong formula), byte-equal parity no longer holds. Update the parity test to assert: parity for `quorumConfig: null` paths (unchanged), and for quorum-enabled paths assert `totalOverheadUSD > 0` + the new per-leg sum formula directly.

**Rescale fixture regression ceiling here (not in Slice 4)**: after this fix lands, the existing fixture `REGRESSION GUARD: power mode on 6 trivial heuristic slices stays under $25` may cross $25 because `power` legs now price at opus rates. If it does, raise the ceiling to `$50` in the same commit (still catches the $146+ floor, documents the rescale in a code comment naming Phase-27.1 Slice 1). If the ceiling stays under $25, leave it.

**Gates**:
- Fixture: `power.totalOverheadUSD !== speed.totalOverheadUSD` for any plan with ≥1 quorum slice.
- Unit test new: `per-leg pricing varies across quorum presets` — two estimates on the same plan, one with `power` config and one with `speed` config; assert `power.overheadUSD > speed.overheadUSD * 4`. Rationale: weighted-average input rate for `power` preset is ~$6.70/Mtok (opus-4.6 $15 + gpt-5.3-codex $3 + grok-reasoning $2, averaged) vs `speed` preset's ~$1.20/Mtok (sonnet-4.6 $3 + gpt-5.4-mini $0.40 + grok-fast $0.20). Observed ratio ≈ 5.5×; `> 4` gives margin for pricing drift without weakening to the point a partial regression passes.
- Full vitest suite 2913+/2913+ green.

**Commit**: `fix(cost-service): Phase-27.1 Slice 1 — per-leg dry-run pricing uses each quorum model's rate (+ fixture ceiling rescale if needed)`

---

### Slice 2: Add `claude-opus-4.7` to MODEL_PRICING
**Scope**: `pforge-mcp/cost-service.mjs` — `MODEL_PRICING` table.

**Change**: add one entry:
```js
// claude-opus-4.7 — mirrors published claude-opus-4.6 rates until Anthropic
// publishes a distinct price point for 4.7. Source: Anthropic pricing page
// (claude-opus-4.6: $15 / $75 per Mtok, retrieved 2026-04-20).
"claude-opus-4.7": { input: 0.000015, output: 0.000075 },
```

**Gates**:
- New test: `pricing table coverage for QUORUM_PRESETS models` — iterates `QUORUM_PRESETS.power.models`, `QUORUM_PRESETS.power.reviewerModel`, `QUORUM_PRESETS.speed.models`, `QUORUM_PRESETS.speed.reviewerModel`, asserts each is a direct key in `MODEL_PRICING` (not a fallback).
- Full vitest suite green.

**Commit**: `fix(cost-service): Phase-27.1 Slice 2 — add claude-opus-4.7 to MODEL_PRICING`

---

### Slice 2b: Wire `forge_estimate_quorum` through the HTTP bridge
**Scope**: `pforge-mcp/server.mjs` — `MCP_ONLY_TOOLS` Set literal (around line 5871).

**Defect**: Phase-27 Slice 6 registered the tool in `capabilities.mjs`, `tools.json`, the tools list, switch case, and async handler — but missed the `MCP_ONLY_TOOLS` Set that gates the `/api/tool/:name` HTTP bridge. Without inclusion here, `POST /api/tool/forge_estimate_quorum` falls through to `runPforge("forge_estimate_quorum ...", PROJECT_DIR)`, which has no CLI counterpart — the dashboard cannot invoke the tool.

**Change**: one line, alongside `"forge_cost_report"`:
```diff
     "forge_incident_capture", "forge_deploy_journal", "forge_dep_watch",
     "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
-    "forge_hotspot", "forge_runbook", "forge_run_plan", "forge_cost_report",
+    "forge_hotspot", "forge_runbook", "forge_run_plan", "forge_cost_report", "forge_estimate_quorum",
     "forge_capabilities", "forge_memory_capture",
```

**Gates**:
- New test in `tests/cost-service.test.mjs` (or a new `tests/http-bridge-coverage.test.mjs`): every tool name present in `tools.json` that has a dedicated handler in `server.mjs` (i.e. handled by the MCP `CallToolRequestSchema` path, not delegated to `runPforge`) must also appear in `MCP_ONLY_TOOLS`. Prevents this class of regression from recurring on future tool additions.
- Manual smoke: `curl -X POST http://127.0.0.1:3100/api/tool/forge_estimate_quorum -H 'Content-Type: application/json' -d '{"planPath":"docs/plans/Phase-27-COST-SERVICE-v2.60-PLAN.md"}'` returns a JSON payload with `auto`, `power`, `speed`, `false`, `recommended` keys.
- Full vitest suite green.

**Commit**: `fix(mcp): Phase-27.1 Slice 2b — wire forge_estimate_quorum through HTTP bridge (carryover from Phase-27 Slice 6)`

---

### Slice 3: Lower `autoConfig.threshold` from 7 → 5
**Scope**: `pforge-mcp/cost-service.mjs` — `estimateQuorum` `autoConfig` literal.

**Change**:
```diff
   const autoConfig = {
     enabled: true,
     auto: true,
-    threshold: 7,
+    threshold: 5,  // Matches QUORUM_PRESETS.power.threshold. Phase-27.1: the
+                   // old `7` gate produced `quorumSliceCount: 0` on every real
+                   // plan in the repo (11, 17, 7 slices). `5` restores the
+                   // "auto picks what power would force" semantic.
     models: QUORUM_PRESETS.speed?.models || ["claude-sonnet-4.6"],
     reviewerModel: QUORUM_PRESETS.speed?.reviewerModel || "claude-sonnet-4.6",
     preset: "speed",
   };
```

**Gates**:
- Existing `estimateQuorum regression` fixture test stays green (fixture slices still won't clear threshold 5; `auto === false` for fixtures is acceptable).
- Real-plan test (Slice 4) will enforce `auto.quorumSliceCount > 0` on the largest repo plan.

**Commit**: `fix(cost-service): Phase-27.1 Slice 3 — auto threshold 7 → 5 (matches power preset)`

---

### Slice 4: Real-plan smoke matrix
**Scope**: new file `pforge-mcp/tests/cost-service-real-plans.test.mjs`.

**Behavior**: iterate every `docs/plans/Phase-*-PLAN.md` file, parse, run `estimateQuorum`, assert:

1. `result.power.estimatedCostUSD > result.speed.estimatedCostUSD` (flagship > fast; integer ratio check not required, but strict `>`).
2. `result.speed.estimatedCostUSD > result.false.estimatedCostUSD` (any quorum > none).
3. `result.auto.estimatedCostUSD <= result.speed.estimatedCostUSD` (auto selects a subset).
4. For the **largest plan** (max `slices.length`): `result.auto.quorumSliceCount > 0`.
5. For **all plans**: every summary has finite `estimatedCostUSD >= 0` and a valid `confidence` string.

(Fixture ceiling rescale — if any — happens in Slice 1's commit, not here.)

**Gates**:
- Real-plan test passes on all `docs/plans/*-PLAN.md` present at commit time.
- Existing fixture regression guard green (ceiling already rescaled in Slice 1 if needed).
- Full vitest suite green.

**Commit**: `test(cost-service): Phase-27.1 Slice 4 — real-plan smoke matrix catches integration regressions`

---

### Slice 5: CHANGELOG, release v2.60.1, honest v2.60.0 retraction
**Scope**: `CHANGELOG.md`, `VERSION`, `pforge-mcp/package.json`, GitHub release notes (edit in place for v2.60.0).

**CHANGELOG `[2.60.1]` block** (shape, author in full):
- `### Fixed` — three one-liners: per-leg pricing, opus-4.7 in table, auto threshold.
- `### Added` — real-plan smoke matrix (one-liner: "tests cost-service against every docs/plans/*-PLAN.md, catches integration regressions fixture tests miss").
- `### Correction to v2.60.0 release notes` — factual paragraph: "The v2.60.0 notes framed the $146.57 number as a chat hallucination. Dogfood of `forge_estimate_quorum` against real plans shows the estimator itself returns $141–$218 for 11–17-slice plans, consistent with what the v2.59 agent quoted. The Phase-27 value was the tool-call forcing function itself — cost becomes a replayable action, not a chat number. Phase-27.1 closes three real bugs the dogfood exposed."

**GitHub release notes edit**: append to v2.60.0 body: `> **Correction (v2.60.1):** The "fabrication" framing in these notes was wrong. See [v2.60.1 release notes](../v2.60.1) for details.`

**Release steps** (follow `/memories/repo/release-procedure.md`):
- `Set-Content VERSION 2.60.1 -NoNewline -Encoding utf8`
- Bump `pforge-mcp/package.json` to `2.60.1`.
- Write `.git/COMMIT_MSG_v2.60.1.txt`, `git commit -F`, `git tag v2.60.1`, `git push origin master --tags`.
- `gh release create v2.60.1 --latest --notes-file ...`.
- `gh release edit v2.60.0 --notes "$(current-body + correction footer)"`.
- Bump back: VERSION + package.json → `2.60.2-dev`, commit `chore: bump to 2.60.2-dev`, push.

**Gates**:
- `git show v2.60.1:VERSION` returns `2.60.1`.
- `gh release view v2.60.1 --json isLatest --jq .isLatest` returns `true`.
- `gh release view v2.60.0` body contains the correction footer.
- Full vitest suite green.

**Commit messages**:
- `chore(release): v2.60.1 — cost-service hotfix (per-leg pricing, opus-4.7, auto threshold)`
- `chore: bump to 2.60.2-dev`

---

## Teardown Safety

- Create baseline branch **before Slice 1**: `git branch pre-phase-27-1`.
- Any slice failure: `git reset --hard pre-phase-27-1`. No tag rollback needed unless Slice 5 already published.
- If v2.60.1 tag published prematurely: `gh release delete v2.60.1 --yes && git push origin :refs/tags/v2.60.1 && git tag -d v2.60.1`, then re-run Slice 5.
