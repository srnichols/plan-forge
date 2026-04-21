---
crucibleId: grandfathered-750cef8e-c4f9-4121-a151-103d1f462bac
lane: full
source: human
---

# Phase-27 — Cost Service Consolidation + forge_estimate_quorum Tool

> **Target release**: v2.60.0
> **Status**: Draft
> **Depends on**: v2.59.2 shipped; VERSION already at `2.60.0-dev`
> **Branch strategy**: Direct to `master` (refactor only, no new public behavior except one MCP tool)
> **Source**: Field observation 2026-04-20 — agent presented a quorum picker claiming `$146.57` / `$45` / `$35` / `$22` for 6 trivial slices. Grep across entire repo for picker text strings returns zero hits: the picker UI does not exist in pforge. The numbers were fabricated by the chat agent.
> **Session budget**: 7 slices in **1 session**
> **Design posture**: Refactor-neutral at observable boundaries — all existing imports of `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate` keep working via re-export shims. One new MCP tool (`forge_estimate_quorum`) is added. Pricing table values are moved verbatim — no rate changes.

---

## Specification Source

- **Field report**: Screenshot on 2026-04-20 showed quorum picker with costs one order of magnitude above reality for 6 heuristic slices.
- **Diagnostic finding**: `grep` for every literal string in the picker ("auto pipeline is confirmed", "flagship quorum on all", "Cheapest. Skip quorum entirely") returns **zero hits** across pforge source. The agent hallucinated the UI.
- **Root cause**: No forcing function exists today that requires an agent to call a tool for a dollar amount. Agents hand-compute costs in chat and drift into fabrication.
- **Secondary finding**: Pricing math is duplicated in two places (`pforge-mcp/orchestrator.mjs` MODEL_PRICING + functions, and `pforge-mcp/tempering/scanners/visual-diff.mjs` local `estimateCost`). A single source of truth is a DRY prerequisite for the tool-call forcing function to be trustworthy.
- **Karpathy tie-in**: `docs/research/karpathy-autoresearcher-comparison.md` §2 primitive 2 (verifiable actions) — the fix is to make cost a tool-call, not a chat number.

---

## Feature Specification

### Problem Statement
Plan Forge cost estimation is implemented in `pforge-mcp/orchestrator.mjs` (MODEL_PRICING table + `calculateSliceCost` + `buildCostBreakdown` + `buildEstimate`) and duplicated partially in `pforge-mcp/tempering/scanners/visual-diff.mjs` (local `estimateCost` with its own miniature rate table). No MCP tool surfaces the multi-mode quorum estimate in a single structured payload. When an agent is asked "what will this cost under each quorum mode?", there is no tool call that returns all four options at once. Agents improvise — and improvise incorrectly. A single authoritative module plus a single tool call that returns all quorum modes in one structured payload is the minimum viable fix.

### User Scenarios
1. **Agent presents quorum picker** — Chat agent is asked "how much will this plan cost in each mode?". Agent calls `forge_estimate_quorum` with `{planPath, resumeFrom?}`. Tool returns `{auto, power, speed, false, recommended}` with per-mode `estimatedCostUSD`, `quorumSliceCount`, `overheadUSD`, and `confidence`. Agent presents numbers straight from the payload. No hand math.
2. **Refactor-neutrality for CLI** — `pforge run-plan --estimate <plan>` output is byte-identical before and after this phase (same keys, same numbers, same ordering). Downstream dashboards and tests unaffected.
3. **DRY for scanners** — Visual-diff scanner imports `priceSlice` from the new cost-service module instead of carrying a local rate table. Removing the local table means a pricing update lands in exactly one file.
4. **Agent guidance** — `.github/copilot-instructions.md` gains a short rule: "Cost estimates come from `forge_estimate_quorum` / `forge_cost_report`, never from chat math." Template inherits the same rule so new installs enforce it from day one.

### Acceptance Criteria
- **MUST**: New module `pforge-mcp/cost-service.mjs` exists and exports `getPricing(model)`, `priceSlice({tokens, worker, model})`, `priceRun({sliceResults})`, `estimatePlan({plan, model, cwd, quorumConfig, resumeFrom})`, `estimateQuorum({plan, cwd, resumeFrom})`.
- **MUST**: `MODEL_PRICING` is defined exactly once in `cost-service.mjs`. No other file defines a pricing table.
- **MUST**: `orchestrator.mjs` no longer contains the `MODEL_PRICING` constant or the function bodies of `calculateSliceCost` / `buildCostBreakdown` / `buildEstimate`. It re-exports them from `cost-service.mjs` as thin shims so external imports keep working.
- **MUST**: `tempering/scanners/visual-diff.mjs` no longer defines a local `estimateCost` function. It imports `priceSlice` from `cost-service.mjs`. Behavior is preserved for visual-diff scanner tests.
- **MUST**: New MCP tool `forge_estimate_quorum` registered in `capabilities.mjs`, `tools.json`, and dispatched in `server.mjs`. Input schema: `{planPath: string, resumeFrom?: string|number}`. Output schema: `{auto: {...}, power: {...}, speed: {...}, false: {...}, recommended: "auto"|"power"|"speed"|"false", generatedAt: ISO8601}` where each mode object contains `{estimatedCostUSD, quorumSliceCount, overheadUSD, sliceCount, confidence}`.
- **MUST**: For a 6-slice heuristic plan (no historical data), `estimateQuorum` returns `power.estimatedCostUSD < $25`. This is the regression catcher for the $146.57 fabrication.
- **MUST**: Full vitest suite (2893/2893 baseline) continues to pass. New tests added to `pforge-mcp/tests/cost-service.test.mjs` cover: priceSlice parity with pre-refactor `calculateSliceCost`, priceRun parity with `buildCostBreakdown`, estimatePlan parity with `buildEstimate` on a fixture plan, estimateQuorum returns all four modes with `power` under the $25 ceiling for 6 heuristic slices.
- **MUST**: `forge_estimate_quorum` agentGuidance includes "Call this tool before presenting any dollar amount; do not hand-compute quorum costs in chat."
- **MUST**: `.github/copilot-instructions.md` gains a section "Cost estimates" directing agents to the two tools.
- **MUST**: `templates/copilot-instructions.md.template` receives the same section so new projects inherit the rule.
- **MUST**: CHANGELOG v2.60.0 section explains the DRY refactor, the new tool, and explicitly calls out the $146.57 fabrication as the motivating incident.
- **MUST**: `VERSION` bumps to `2.60.0`, `pforge-mcp/package.json` version bumps to `2.60.0`, tag `v2.60.0` pushed, GitHub release marked `--latest`, post-release bump to `2.60.1-dev`.
- **SHOULD**: `forge_capabilities` output surfaces `costService` subsystem with `tools: ["forge_cost_report", "forge_estimate_quorum"]`.
- **MAY**: `docs/CLI-GUIDE.md` mentions the new tool in the existing cost section.

---

## Scope Contract

### In-Scope
- New `pforge-mcp/cost-service.mjs` module holding all pricing, slice costing, run costing, plan estimation, and quorum estimation.
- Re-export shims in `pforge-mcp/orchestrator.mjs` keeping `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate` importable from their historical path.
- Refactor of `pforge-mcp/tempering/scanners/visual-diff.mjs` to import `priceSlice` from cost-service.
- New MCP tool `forge_estimate_quorum` registered across `capabilities.mjs`, `tools.json`, `server.mjs`.
- New test file `pforge-mcp/tests/cost-service.test.mjs` with parity + regression tests.
- Agent guidance update in `.github/copilot-instructions.md` and `templates/copilot-instructions.md.template`.
- CHANGELOG + VERSION + release artifacts for v2.60.0.

### Out-of-Scope
- Changing any pricing rate in `MODEL_PRICING` — values are moved verbatim.
- Changing the historical calibration formula (`0.5×–3×` clamp), the quorum overhead formula, or the `avgTokensPerSlice` heuristic (`{input: 2000, output: 5000}`). Behavior must be bit-identical on the fixture plan.
- Changing the dashboard cost widget (`mcp/dashboard/*`, `docs/dashboard/*`). Dashboard reads through existing `forge_cost_report` — untouched.
- Adding new pricing sources (per-run caching, per-project overrides).
- Adding a UI for the quorum picker — the tool returns structured data; presentation stays in the agent.
- Rewriting `parseStderrStats` or any token-counting path.
- Changes to crucible, scheduler, or worker modules.

### Forbidden Actions
- `git push --force`, `git reset --hard origin/master`, deletion of `refs/heads/master`.
- Editing `pforge-mcp/crucible*.mjs` — provenance frozen.
- Editing any file under `mcp/dashboard/` or `docs/dashboard/` — dashboard cost widget is out of scope.
- Modifying `MODEL_PRICING` rate values. Structural move only.
- Removing the re-export shims from `orchestrator.mjs` — downstream test files and sdk consumers import from there.
- Changing function signatures of `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate` — shims must be drop-in.
- Running release slices (Slice 7) before all earlier slices pass gates and tests stay 2893/2893 or greater.
- Skipping the parity tests — the $25 regression catcher is non-negotiable.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| D1 | Single module vs split (pricing / estimator / tool adapter) | ✅ Resolved | **Single module** `cost-service.mjs`. Splitting three ~40-line functions into three files is premature abstraction. |
| D2 | Re-export shims vs delete + migrate all call sites | ✅ Resolved | **Re-export shims.** Tests and sdk import from `orchestrator.mjs` today. Shims make this refactor non-breaking; migration can happen lazily. |
| D3 | Tool schema — one call per mode vs all modes in one payload | ✅ Resolved | **All modes in one payload.** The forcing function is "one tool call → all the numbers the agent needs." Four round-trips invites the same hand-math drift this phase is designed to prevent. |
| D4 | `recommended` field: static rule vs based on history | ✅ Resolved | **Static rule for v2.60.0.** Cheapest mode whose `estimatedCostUSD` is under `runtime.cost.budget` if set, else `auto`. Historical recommendation is a future enhancement. |
| D5 | Visual-diff refactor scope | ✅ Resolved | **Import `priceSlice` only.** The scanner's call `estimateCost(tokens, model)` maps to `priceSlice({tokens: {tokens_in: tokens, tokens_out: 0, model}, worker: "api-visual-diff", model})`. Keep it mechanical. |
| D6 | Test fixture plan source | ✅ Resolved | **Inline fixture** in `cost-service.test.mjs` — 6 synthetic slices, empty scope, no historical data. Heuristic-mode pricing. Keeps the test hermetic. |
| D7 | Agent guidance wording | ✅ Resolved | "Cost estimates come from `forge_cost_report` (actuals) and `forge_estimate_quorum` (projections). Do not hand-compute costs or invent quorum-mode numbers in chat." |
| D8 | Release strategy | ✅ Resolved | Single tag `v2.60.0`. Bump-back commit to `2.60.1-dev` after release. Follows `/memories/repo/release-procedure.md`. |

---

## Execution Slices

### Session 1 — Cost service consolidation + tool registration

#### Slice 1: Create cost-service module skeleton + MODEL_PRICING move [sequential] {#slice-1}

**Goal**: Create `pforge-mcp/cost-service.mjs` exporting `MODEL_PRICING` and `getPricing(model)`. Values moved verbatim from `orchestrator.mjs`. Leave `orchestrator.mjs` unchanged in this slice — the old table stays temporarily. Pure additive.

**Files**:
- `pforge-mcp/cost-service.mjs` — new module.
- `pforge-mcp/tests/cost-service.test.mjs` — new test file with `getPricing` unit tests only.

**Depends on**: none.

**Branch**: `master`.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`
- `pforge-mcp/orchestrator.mjs` (lines 8935–9020 for MODEL_PRICING reference)

**Traces to**: MUST (`cost-service.mjs` exists; `MODEL_PRICING` defined once).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && node -e \"import('./cost-service.mjs').then(m => { const keys = Object.keys(m); if (!keys.includes('MODEL_PRICING') || !keys.includes('getPricing')) { console.error('missing exports:', keys); process.exit(1); } console.log('exports ok:', keys.join(',')); })\""
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

#### Slice 2: priceSlice + priceRun in cost-service [sequential] {#slice-2}

**Goal**: Port `calculateSliceCost` logic to `priceSlice({tokens, worker, model})` and `buildCostBreakdown` logic to `priceRun({sliceResults})`. Signatures thin: `priceSlice` accepts a single options object; existing callers pass positional args, so the new functions use positional destructuring for drop-in compatibility. Original functions in `orchestrator.mjs` untouched this slice.

**Files**:
- `pforge-mcp/cost-service.mjs` — add `priceSlice`, `priceRun`.
- `pforge-mcp/tests/cost-service.test.mjs` — add parity tests that feed identical fixtures through `cost-service.priceSlice` and `orchestrator.calculateSliceCost`, assert `.cost_usd` byte-equal.

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs` (lines 8987–9040 for reference implementations)
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (parity with calculateSliceCost / buildCostBreakdown).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

#### Slice 3: estimatePlan + estimateQuorum in cost-service [sequential] {#slice-3}

**Goal**: Port `buildEstimate` body to `estimatePlan({plan, model, cwd, quorumConfig, resumeFrom})`. Add new `estimateQuorum({plan, cwd, resumeFrom})` that runs `estimatePlan` four times (auto, power, speed, false) and returns the composite payload described in the acceptance criteria. `recommended` = cheapest mode satisfying optional `runtime.cost.budget`, else `"auto"`. Dynamic import of QUORUM_PRESETS from `orchestrator.mjs` is acceptable (circular avoided because `cost-service.mjs` is loaded eagerly and orchestrator imports it back via shim). If a circular import emerges, inline the four mode configs locally — the preset names are stable.

**Files**:
- `pforge-mcp/cost-service.mjs` — add `estimatePlan`, `estimateQuorum`.
- `pforge-mcp/tests/cost-service.test.mjs` — add (a) `estimatePlan` parity with `buildEstimate` on a 3-slice fixture plan, (b) `estimateQuorum` regression: 6 heuristic slices, no history, asserts `result.power.estimatedCostUSD < 25`.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/orchestrator.mjs` (lines 9040–9260 for `buildEstimate` + QUORUM_PRESETS)
- `.github/instructions/testing.instructions.md`

**Traces to**: MUST (`estimatePlan` parity, `estimateQuorum` power < $25 ceiling).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

#### Slice 4: Orchestrator shim refactor [sequential] {#slice-4}

**Goal**: Delete `MODEL_PRICING`, `calculateSliceCost` body, `buildCostBreakdown` body, `buildEstimate` body from `orchestrator.mjs`. Replace with single-line re-exports from `cost-service.mjs`. Imports inside `orchestrator.mjs` that referenced the local table (if any) route through `cost-service.getPricing`. Full test suite must stay green.

**Files**:
- `pforge-mcp/orchestrator.mjs` — delete MODEL_PRICING + three function bodies; add `export { calculateSliceCost, buildCostBreakdown, buildEstimate } from "./cost-service.mjs";` plus aliased internal usage.

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `.github/instructions/architecture-principles.instructions.md` (shim pattern = adapter at module boundary)

**Traces to**: MUST (`MODEL_PRICING` defined once; shims preserved).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && grep -c '^const MODEL_PRICING' orchestrator.mjs | tr -d '\\n' | { read n; [ \"$n\" = '0' ] || (echo \"MODEL_PRICING still present: $n\" && exit 1); }"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 5: Visual-diff scanner refactor [sequential] {#slice-5}

**Goal**: Delete local `estimateCost` from `pforge-mcp/tempering/scanners/visual-diff.mjs`. Import `priceSlice` from `cost-service.mjs`. The call site `cumulativeCostUsd += estimateCost(tokens, model)` becomes `cumulativeCostUsd += priceSlice({tokens: {tokens_in: tokens, tokens_out: 0, model}, worker: "api-visual-diff", model}).cost_usd`. `runLegWithBudget` still accepts an injected function — thread the new adapter through. Visual-diff scanner tests must stay green.

**Files**:
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — delete local `estimateCost`; add import; adapt call sites.
- `pforge-mcp/tests/tempering*.test.mjs` — verify existing tests still pass (no new tests required).

**Depends on**: Slice 4.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/cost-service.mjs` (the new priceSlice signature)

**Traces to**: MUST (visual-diff no longer defines local `estimateCost`).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && grep -c '^function estimateCost' tempering/scanners/visual-diff.mjs | tr -d '\\n' | { read n; [ \"$n\" = '0' ] || (echo \"local estimateCost still present\" && exit 1); }"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 6: Register forge_estimate_quorum MCP tool + agent guidance [sequential] {#slice-6}

**Goal**: Register new MCP tool. Update agent instructions so the forcing function is active from day one.

**Files**:
- `pforge-mcp/capabilities.mjs` — add `forge_estimate_quorum` registration including `agentGuidance` text.
- `pforge-mcp/tools.json` — add input/output schema entry.
- `pforge-mcp/server.mjs` — add dispatcher branch that calls `estimateQuorum` from cost-service.
- `.github/copilot-instructions.md` — add "## Cost estimates" section directing agents to the two tools.
- `templates/copilot-instructions.md.template` — same section so new projects inherit.

**Depends on**: Slice 3 (estimateQuorum exists); can proceed after Slice 3 even if Slice 4–5 incomplete, but sequenced after Slice 5 to keep test runs clean.

**Branch**: `master`.

**Context files**:
- Existing `forge_cost_report` registration in `capabilities.mjs` (reference pattern)
- `pforge-mcp/tools.json` (existing schema style)

**Traces to**: MUST (tool registered across three files; agent guidance updated in both copilot-instructions files).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && node -e \"import('./capabilities.mjs').then(m => { const caps = m.buildCapabilities ? m.buildCapabilities() : null; const tools = JSON.stringify(caps || {}); if (!tools.includes('forge_estimate_quorum')) { console.error('tool not registered'); process.exit(1); } console.log('ok'); })\""
bash -c "grep -c 'forge_estimate_quorum' .github/copilot-instructions.md templates/copilot-instructions.md.template | grep -v ':0'"
bash -c "cd pforge-mcp && npx vitest run"
```

---

#### Slice 7: Ship v2.60.0 [sequential] {#slice-7}

**Goal**: CHANGELOG entry, VERSION bump, package.json bump, tag, GitHub release, post-release bump to 2.60.1-dev. Follow `/memories/repo/release-procedure.md`.

**Files**:
- `CHANGELOG.md` — new `[2.60.0]` section.
- `VERSION` — `2.60.0`.
- `pforge-mcp/package.json` — version `2.60.0`.
- `.git/COMMIT_MSG_v2.60.0.txt` — prepared commit message.

**Depends on**: Slice 6 + tests 2893+/2893+ passing.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` existing entries

**Traces to**: MUST (VERSION=2.60.0 after tag; bump-back to 2.60.1-dev).

**Validation Gate**:
```bash
bash -c "git show v2.60.0:VERSION | grep -q '^2.60.0$'"
bash -c "cd pforge-mcp && npx vitest run"
```

---

## Teardown Safety Guard

Baseline branch `pre-phase-27` created before Slice 1; verify at end of Slice 7 via `git rev-parse pre-phase-27` returns a valid SHA and `git log master ^pre-phase-27 --oneline | wc -l` > 0 (phase produced commits). No branch deletions permitted in any slice.

## Cost Estimate

Self-referential: once this phase ships, `forge_estimate_quorum docs/plans/Phase-27-COST-SERVICE-v2.60-PLAN.md` answers this field authoritatively. Pre-ship heuristic (7 slices × 2000 in + 5000 out tokens, auto mode with claude-sonnet-4.5 default): **~$3–5 base, ~$6–10 with auto-quorum overhead.** Max-mode (power quorum on all slices) would run ~$20–35. `auto` recommended.

## Rollback

`git reset --hard pre-phase-27` on master (with force-push explicitly authorized) undoes the entire phase. Individual slice rollback via `git revert <slice-commit>` is preferred.
