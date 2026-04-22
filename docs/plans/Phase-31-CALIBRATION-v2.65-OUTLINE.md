---
lane: full
source: human
hardened: false
status: outline
---

# Phase-31 — Advisory → Enforcement Calibration & Parser/Analyzer Lint

> **Target release**: v2.65.0
> **Status**: **Outline — not yet hardened.** Run `step0-specify-feature.prompt.md` + `step2-harden-plan.prompt.md` before `pforge run-plan`.
> **Depends on**: v2.64.1 shipped (Forge-Master Studio hotfix + Smith Phase-29/30 awareness). Meta-bugs [#88](https://github.com/srnichols/plan-forge/issues/88) and [#89](https://github.com/srnichols/plan-forge/issues/89) fixed in post-release commits on master (orchestrator timeout-but-committed guard + opt-in implicit-gate parser capture).
> **Branch strategy**: Direct to `master`. Behaviour changes are all advisory→enforcement flips or pure lint additions — no schema changes, no config key renames.
> **Session budget**: 1 session, ~6–7 slices.

---

## Problem Statement

Between Phase-25 and Phase-28 we built four advisory subsystems that emit warnings but never block. Field data from Phase-29 and Phase-30 runs shows they are now accurate enough to become gates, but the calibration thresholds were never revisited after the initial "ship it as advisory" rollout:

1. **Reflexion context** (Phase-25) — captures `lastFailureContext` on gate failure but the worker prompt rarely references it. Promoter never promotes.
2. **Gate synthesis advisory** (Phase-26) — suggests vitest gates for slices that lack them; message fires but is log-only.
3. **Teardown safety guard** (Phase-26) — only arms on destructive slice titles and only logs baseline; no rollback path.
4. **Tempering promoter** (Phase-28) — suppression events filed but auto-promotion to BUG files never wired.

Separately, two analyzer gaps were discovered during Phase-30:

5. **`scoreSliceComplexity` dead zone** — the default threshold (5) selected zero slices in the v2.61.0 research dataset. The heuristic needs recalibration against a real plan corpus, or the threshold needs to drop.
6. **Plan-parser lint** — `_bashBlockCount` per slice is now tracked (meta-bug #89 fix) but `pforge analyze` doesn't surface it. A slice with a bash block but no explicit `**Validation Gate**:` marker should emit an advisory.

## Specification Source

- **Field input**: Phase-30 telemetry — 7/7 slices logged `gateStatus: passed, gateOutput: No validation gate defined` (meta-bug #89 root cause). Phase-29 Forge-Master integration run — reflexion context captured but never surfaced in retry prompt body (grep of `previousAttempt` in worker prompts returns zero hits on master).
- **Architecture anchor**: All work contained to `pforge-mcp/orchestrator.mjs` (threshold tables + prompt wiring), `pforge-mcp/tempering.mjs` (promoter), `pforge-mcp/dashboard/app.js` + `/dashboard/index.html` (advisory surfaces), and `pforge-mcp/tests/` (regression guards). No new MCP tools. No `.forge.json` schema additions beyond existing `runtime.*` blocks.
- **Explicit non-goal**: This plan does **not** redesign the advisory systems — it only flips their thresholds / wires their output into existing surfaces. A deeper rethink (e.g. ML-backed complexity scoring) is Phase-32 material.

---

## Candidate Slices (pre-hardening)

> Numbers are provisional. Final DAG will emerge from `step2-harden-plan.prompt.md`.

### Slice 1 — Timeout-but-committed surface

**Goal**: Make the meta-bug #88 success path visible. The orchestrator now emits `slice-timeout-but-committed` on the event bus, but the dashboard live session view still renders a generic "timed out" badge.

- Subscribe to the new event in `dashboard/live-session.js`
- Render a green badge "committed before timeout" with the HEAD delta
- Add a regression test in `tests/dashboard-live-session.test.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/dashboard-live-session.test.mjs"`

### Slice 2 — Plan-parser lint in `pforge analyze`

**Goal**: Surface the `_bashBlockCount` data that meta-bug #89 started tracking. For every slice where `_bashBlockCount > 0 && !validationGate`, emit an advisory.

- Extend `runAnalyze()` in `orchestrator.mjs` to walk `plan.slices` for this pattern
- Output a structured advisory block with slice id, title, and suggested remediation (add `**Validation Gate**:` or enable `runtime.planParser.implicitGates`)
- Cover in `tests/orchestrator-analyze.test.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-analyze.test.mjs"`

### Slice 3 — Reflexion prompt wiring

**Goal**: Plumb `lastFailureContext` into the retry prompt body so the worker actually sees its prior failure.

- Locate the retry-prompt builder (search `attempt + 1` in `orchestrator.mjs`)
- Inject a `## Prior Attempt` block when `lastFailureContext` is non-null
- Gate: assert that a reflexion-tagged retry prompt contains `previousAttempt`, `gateName`, and `stderrTail` excerpts
- Cover in `tests/orchestrator-reflexion-prompt.test.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-reflexion-prompt.test.mjs"`

### Slice 4 — Gate-synthesis advisory → inject by default

**Goal**: The synthesis advisory currently logs a suggested vitest command when a slice lacks a gate. Phase-26 Slice 7 wired an enforce-mode path behind `runtime.gateSynthesis.mode = "enforce"`. Flip the default from `"advisory"` to `"enforce"` after confirming no breakage on Phase-28/29/30 historical runs.

- Audit `runtime.gateSynthesis` usage across last 5 plan runs (sample from `.forge/runs/`)
- Flip default in `loadGateSynthesisConfig()`
- Document in CHANGELOG as a breaking-default change (users can opt back to advisory)
- Regression guard in `tests/orchestrator-gate-synthesis.test.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-gate-synthesis.test.mjs"`

### Slice 5 — `scoreSliceComplexity` recalibration

**Goal**: The v2.61.0 research found threshold=5 selects zero slices in practice. Either drop to 3 or rewrite the heuristic. Since this is research-heavy, scope is: gather data, propose threshold, land.

- Run `scoreSliceComplexity` against all plans in `docs/plans/Phase-2[5-9]-*.md` and `Phase-30-*.md`
- Compute distribution; pick threshold at 60th percentile
- Document findings in `docs/research/complexity-threshold-v2.65.md`
- Update default in `orchestrator.mjs` + test

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-complexity.test.mjs"`

### Slice 6 — Tempering promoter wiring

**Goal**: Tempering suppressions should auto-promote to BUG files after N occurrences. N was specified as 3 in Phase-28 but the promoter was never wired.

- Implement promoter in `pforge-mcp/tempering.mjs`
- Threshold configurable via `runtime.tempering.promoteThreshold` (default 3)
- Emits a BUG-`<hash>`.md file in `.forge/bugs/` with aggregated context
- Cover in `tests/tempering-promoter.test.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/tempering-promoter.test.mjs"`

### Slice 7 — Full test sweep + changelog

**Goal**: Ensure the whole calibration pass is green end-to-end.

- `npm test` in `pforge-mcp/` and `pforge-master/`
- Promote `[Unreleased]` → `[2.65.0]` in CHANGELOG.md
- Add Phase-31 entry to ROADMAP.md
- Regenerate capabilities snapshot via `node capabilities.mjs`

**Validation Gate**: `bash -c "cd pforge-mcp && npm test && cd ../pforge-master && npm test"`

---

## Scope Contract (pre-hardening)

**In scope**:
- `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tempering.mjs`
- `pforge-mcp/dashboard/live-session.js`, `pforge-mcp/dashboard/index.html` (minor)
- `pforge-mcp/tests/**`
- `CHANGELOG.md`, `ROADMAP.md`, `docs/research/complexity-threshold-v2.65.md` (new)

**Out of scope**:
- Any new MCP tool
- Any new `.forge.json` top-level key (existing `runtime.*` only)
- Any UI redesign beyond the single live-session badge
- Forge-Master Studio changes (Phase-29 territory)

**Forbidden actions**:
- Rename existing `runtime.gateSynthesis.*` keys
- Touch `capabilities.mjs` output format (dashboard consumer depends on current schema)
- Edit Phase-30 plan artifacts

---

## Open Questions (resolve during harden)

1. **Slice 4 breaking-change**: is flipping gate-synthesis default to `enforce` safe for downstream consumers who run Plan Forge against plans authored before Phase-26? Needs an upgrade note and possibly a v2.65.0 major-bump discussion.
2. **Slice 5 threshold**: 60th percentile is a guess. Harden step should compute the actual distribution and let owner pick.
3. **Slice 6 promoter output format**: should BUG files follow the `forge_meta_bug_file` template or a project-bug template? Default: project-bug, since tempering catches user-code issues.

---

## Next Steps

1. Owner reviews this outline.
2. Run `step0-specify-feature.prompt.md` if any slice needs sharper specification.
3. Run `step2-harden-plan.prompt.md` to convert this outline into an execution-grade plan with explicit gates, dependency DAG, and per-slice Scope Contracts.
4. `pforge run-plan --estimate docs/plans/Phase-31-CALIBRATION-v2.65-PLAN.md` to get cost projection.
5. `pforge run-plan docs/plans/Phase-31-CALIBRATION-v2.65-PLAN.md` to execute.
