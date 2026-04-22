---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session harden of Phase-31 outline)
hardened_at: 2026-04-22
---

# Phase-31 — Advisory → Enforcement Calibration & Parser/Analyzer Lint

> **Target release**: v2.65.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: v2.64.1 shipped. Meta-bugs [#88](https://github.com/srnichols/plan-forge/issues/88) and [#89](https://github.com/srnichols/plan-forge/issues/89) fixed in `835a897` and `01afa29` on master.
> **Branch strategy**: Direct to `master`. Behaviour changes are advisory→enforcement flips and pure lint additions.
> **Session budget**: 1 session, 7 slices. **Session break recommended after Slice 4** (commit, new session, `--resume-from 5`).

---

## Specification Source

- **Field input**: Phase-30 telemetry — 7/7 slices logged `gateStatus: passed, gateOutput: "No validation gate defined"` (meta-bug #89 root cause). Phase-29 Forge-Master integration run — reflexion context captured in `lastFailureContext` but never referenced in retry prompt (grep of `previousAttempt` in worker prompt builders on master returns zero hits).
- **Architecture anchor**: All work contained to `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tempering.mjs`, `pforge-mcp/dashboard/live-session.js`, `pforge-mcp/dashboard/index.html` (minor), `pforge-mcp/tests/**`, `CHANGELOG.md`, `ROADMAP.md`, and a new `docs/research/complexity-threshold-v2.65.md`. No new MCP tools. No `.forge.json` schema additions beyond existing `runtime.*` blocks.
- **Explicit non-goal**: This plan does **not** redesign advisory systems — it flips thresholds and wires output into existing surfaces. A deeper rethink (e.g. ML-backed complexity scoring) is Phase-32 material.
- **Prior postmortems**: None for Phase-31 — first execution. Lessons from Phase-30 (#88, #89) already incorporated as fixes on master.

---

## Scope Contract

### In scope

- `pforge-mcp/orchestrator.mjs` — `runAnalyze`, retry prompt builder, `loadGateSynthesisConfig` default flip, `scoreSliceComplexity` default threshold
- `pforge-mcp/tempering.mjs` — new `promoteSuppressions()` function
- `pforge-mcp/dashboard/live-session.js` — subscribe to `slice-timeout-but-committed` event
- `pforge-mcp/dashboard/index.html` — badge markup only (no new tabs, no restructure)
- `pforge-mcp/tests/**` — new and updated regression tests
- `CHANGELOG.md` — promote `[Unreleased]` → `[2.65.0]`
- `ROADMAP.md` — Phase-31 completion entry
- `docs/research/complexity-threshold-v2.65.md` — new research note

### Out of scope

- Any new MCP tool registration in `tools.json`
- Any new `.forge.json` top-level key (only `runtime.*` sub-keys permitted)
- Any UI redesign beyond the single live-session badge
- Forge-Master Studio changes (Phase-29 territory — owned by that plan's scope)
- Settings panel changes (Phase-30 territory)
- Capabilities schema changes (`capabilities.mjs` output format is consumed by the dashboard — do not touch)

### Forbidden actions

- Rename existing `runtime.gateSynthesis.*` keys (breaks consumers on v2.64.x)
- Modify `capabilities.mjs` output shape
- Edit any Phase-30 plan artifact under `docs/plans/Phase-30-*`
- Edit any `.forge/runs/**` historical log file
- Add a new `gate*` or `parser*` CLI command to `pforge.ps1`/`pforge.sh` (use existing `analyze`)
- Introduce a new dependency in `pforge-mcp/package.json`

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Slice 4 breaking-default flip — `runtime.gateSynthesis.mode` from `"suggest"` to `"enforce"` | Resolved | **Defer default flip to Phase-32.** Slice 4 scope narrows to: (a) audit historical runs for flip-safety, (b) document findings, (c) add `--strict-gates` CLI flag that forces enforce mode without changing default. Rationale: consumer repos on v2.64.x would silently start failing runs. |
| 2 | Slice 5 `scoreSliceComplexity` new threshold | Resolved | **Threshold = 3** (down from 5). Based on v2.61.0 research note stating threshold=5 selects zero slices. Final value confirmed by computing distribution across Phase-25–30 plans in Slice 5's research step. If distribution's 60th percentile differs by ≤1, lock at 3; otherwise update to match and document. |
| 3 | Slice 6 promoter BUG file format | Resolved | **Project-bug template** (not meta-bug). Tempering catches regressions in user project code, not Plan Forge itself. Files land in `.forge/bugs/BUG-<hash>.md` with suppression history appended. |
| 4 | Slice 6 promoter threshold `N` | Resolved | **N = 3** per original Phase-28 spec. Configurable via `runtime.tempering.promoteThreshold`. |
| 5 | Reflexion prompt injection location (Slice 3) | Resolved | **Inject into system prompt preamble**, not user prompt body, so it survives prompt truncation on retries. Marker block: `<prior_attempt>...</prior_attempt>` mirroring existing reflexion tag conventions. |

No open TBDs.

---

## Acceptance Criteria

### Timeout-but-committed surface (Slice 1)

- **MUST**: When the orchestrator emits `slice-timeout-but-committed`, the live-session view renders a green `committed-before-timeout` badge with the HEAD delta visible (`<pre>` → `<post>` short SHAs).
- **MUST**: No regression in the existing `timed-out` red badge rendering — it still fires when `workerResult.timedOut && exitCode !== 0`.
- **SHOULD**: Badge tooltip shows the slice number and a link to the commit diff.

### Plan-parser lint (Slice 2)

- **MUST**: `pforge analyze <plan>` emits an advisory line for every slice where `_bashBlockCount > 0 && !validationGate`.
- **MUST**: Advisory format: `ADVISORY plan-parser-gate-missing: Slice <N> (<title>) has <count> bash block(s) but no **Validation Gate**: marker.` followed by a remediation hint.
- **MUST**: Exit code of `pforge analyze` is unchanged by the new advisory (stays informational — does not fail the command).
- **SHOULD**: Advisory is suppressed when `runtime.planParser.implicitGates = true` (since the block becomes the gate in that mode).

### Reflexion prompt wiring (Slice 3)

- **MUST**: When `lastFailureContext` is non-null for a retry attempt, the worker prompt contains a `<prior_attempt>` block with `previousAttempt`, `gateName`, `model`, and `stderrTail` fields.
- **MUST**: No prior-attempt block is injected on the first attempt (context is null).
- **MUST**: The injection happens in the system prompt preamble, not appended to the user-facing task body.

### Strict-gates opt-in (Slice 4)

- **MUST**: New `--strict-gates` CLI flag on `pforge run-plan` forces `runtime.gateSynthesis.mode` to `"enforce"` for the run, regardless of `.forge.json` setting.
- **MUST**: Flag is documented in `pforge.ps1` and `pforge.sh` help text.
- **MUST**: When `--strict-gates` is active, slices flagged by `suggestGatesForPlan()` fail pre-flight with a structured error instead of executing.
- **MUST**: Default `runtime.gateSynthesis.mode` remains `"suggest"` (no breaking change for v2.64.x consumers).
- **SHOULD**: Audit findings across Phase-25–30 runs land in `docs/research/gate-synthesis-flip-safety-v2.65.md`.

### Complexity threshold recalibration (Slice 5)

- **MUST**: Research note `docs/research/complexity-threshold-v2.65.md` contains a distribution table of `scoreSliceComplexity` results across all plans in `docs/plans/Phase-2[5-9]-*.md` and `Phase-30-*.md`.
- **MUST**: Default threshold in `scoreSliceComplexity` (or its consuming callers) drops from 5 to the 60th-percentile value determined by the research (target: 3).
- **MUST**: Existing tests that reference the old threshold are updated with a comment pointing to the research note.

### Tempering promoter (Slice 6)

- **MUST**: `tempering.mjs` exports `promoteSuppressions({ cwd, threshold })` that scans suppression events and, for each suppression seen ≥ `threshold` times, writes `.forge/bugs/BUG-<hash>.md`.
- **MUST**: BUG file includes: suppression hash, first/last seen timestamps, occurrence count, aggregated stderr tails, and a reproduction hint derived from the most recent occurrence.
- **MUST**: Promotion is idempotent — re-running with the same suppressions and an existing BUG file appends a "re-observed" note but does not duplicate the file.
- **MUST**: Threshold is configurable via `runtime.tempering.promoteThreshold` (default 3).
- **SHOULD**: A new advisory surfaces in `pforge analyze` indicating how many suppressions are above threshold and ready for promotion.

### Full sweep and ship (Slice 7)

- **MUST**: All vitest suites in `pforge-mcp/` and `pforge-master/` pass.
- **MUST**: `CHANGELOG.md` `[Unreleased]` section is promoted to `[2.65.0] — 2026-04-22` (or actual ship date) with entries for every slice.
- **MUST**: `ROADMAP.md` reflects Phase-31 as shipped.
- **MUST**: `node capabilities.mjs` runs cleanly (no schema drift).

---

## Execution Slices

### Slice 1 — Timeout-but-committed dashboard surface [sequential]

**Depends On**: — (entry slice)
**Context Files**: `pforge-mcp/orchestrator.mjs` (reference only — don't edit), `pforge-mcp/dashboard/live-session.js`, `pforge-mcp/dashboard/index.html`, `.github/instructions/architecture-principles.instructions.md`
**Scope**: `pforge-mcp/dashboard/live-session.js`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/tests/dashboard-live-session.test.mjs`

1. Subscribe to the new `slice-timeout-but-committed` event in `live-session.js`.
2. Render a green badge with inline text `committed-before-timeout (<pre>→<post>)` using 7-char SHAs.
3. Add DOM element `<span data-testid="committed-before-timeout-badge">` inside the slice status row so tests can anchor.
4. Write `tests/dashboard-live-session.test.mjs` covering: badge renders on event, badge absent when event not received, badge markup matches `data-testid`.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/dashboard-live-session.test.mjs"
```

**Stop Condition**: Vitest for `dashboard-live-session.test.mjs` fails.

---

### Slice 2 — Plan-parser lint in `pforge analyze` [sequential]

**Depends On**: Slice 1
**Context Files**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/tests/orchestrator-plan-parser-gates.test.mjs` (reference only), `.github/instructions/architecture-principles.instructions.md`
**Scope**: `pforge-mcp/orchestrator.mjs` (`runAnalyze`/`analyzePlan` only), `pforge-mcp/tests/orchestrator-analyze.test.mjs`

1. Locate the analyzer function (search `runAnalyze` or `analyzePlan` — the export that powers `pforge analyze`).
2. After the existing slice checks, walk `plan.slices` for entries where `_bashBlockCount > 0 && !validationGate`.
3. Emit an advisory line per match using the format declared in Acceptance Criteria.
4. Suppress advisory when `.forge.json` → `runtime.planParser.implicitGates === true`.
5. Cover in `tests/orchestrator-analyze.test.mjs`: advisory fires for a slice with bash block and no gate, suppressed when implicitGates=true, absent when gate is declared.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-analyze.test.mjs"
```

**Stop Condition**: Vitest fails or analyzer exit code changes from its current value.

---

### Slice 3 — Reflexion prompt wiring [sequential]

**Depends On**: Slice 2
**Context Files**: `pforge-mcp/orchestrator.mjs`, `.github/instructions/architecture-principles.instructions.md`
**Scope**: `pforge-mcp/orchestrator.mjs` (retry prompt builder only), `pforge-mcp/tests/orchestrator-reflexion-prompt.test.mjs`

1. Locate the retry prompt builder. Search terms: `attempt + 1`, `buildRetryPrompt`, `lastFailureContext`.
2. When `lastFailureContext` is non-null, inject a system-prompt preamble block:
   ```
   <prior_attempt>
   attempt: <previousAttempt>
   gate: <gateName>
   model: <model>
   stderr_tail:
   <stderrTail truncated to 40 lines>
   </prior_attempt>
   ```
3. First attempt (lastFailureContext === null) must produce prompts identical to current output — do not add empty block.
4. Cover in `tests/orchestrator-reflexion-prompt.test.mjs`: block present on retry, absent on first attempt, `stderrTail` truncation applied.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-reflexion-prompt.test.mjs"
```

**Stop Condition**: Vitest fails, OR first-attempt prompt output differs from pre-slice baseline (check with a snapshot test).

---

### Slice 4 — Strict-gates CLI flag [sequential]

**Depends On**: Slice 3
**Context Files**: `pforge-mcp/orchestrator.mjs`, `pforge.ps1`, `pforge.sh`, `.github/instructions/architecture-principles.instructions.md`
**Scope**: `pforge-mcp/orchestrator.mjs` (`runPlan` argv parsing + `loadGateSynthesisConfig` override), `pforge.ps1`, `pforge.sh`, `pforge-mcp/tests/orchestrator-gate-synthesis.test.mjs`, `docs/research/gate-synthesis-flip-safety-v2.65.md` (new)

1. Add `--strict-gates` to `pforge.ps1` and `pforge.sh` argv passthrough for `run-plan`.
2. In `orchestrator.mjs` `runPlan`, detect the flag and pass an override to `loadGateSynthesisConfig` (or equivalent site) that forces `mode = "enforce"` for this run only — do not write to `.forge.json`.
3. When enforce mode is active and `suggestGatesForPlan()` returns suggestions, fail pre-flight with a structured error listing each offending slice.
4. Write `docs/research/gate-synthesis-flip-safety-v2.65.md`: sample 3 recent runs under `.forge/runs/`, count slices that would have been blocked, summarize risk.
5. Cover in `tests/orchestrator-gate-synthesis.test.mjs`: flag forces enforce, default remains suggest, pre-flight error structure correct.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-gate-synthesis.test.mjs"
```

**Stop Condition**: Vitest fails, OR default `runtime.gateSynthesis.mode` is accidentally changed from `"suggest"`.

---

### Re-anchor Checkpoint (after Slice 4)

**Recommended session break.** Before continuing:

1. Commit and push Slices 1–4.
2. `pforge smith` — verify environment still clean.
3. `pforge analyze docs/plans/Phase-31-CALIBRATION-v2.65-PLAN.md` — confirm new lint advisory fires against its own slice 2 if any test slice lacks a gate (self-check).
4. Start a new session with `--resume-from 5` to preserve context budget.

---

### Slice 5 — Complexity threshold recalibration [sequential]

**Depends On**: Slice 4
**Context Files**: `pforge-mcp/orchestrator.mjs`, `docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md`, `docs/plans/Phase-30-SETTINGS-SPLIT-v2.64-PLAN.md`, `.github/instructions/architecture-principles.instructions.md`
**Scope**: `pforge-mcp/orchestrator.mjs` (`scoreSliceComplexity` default threshold and its callers), `pforge-mcp/tests/orchestrator-complexity.test.mjs`, `docs/research/complexity-threshold-v2.65.md` (new)

1. Locate `scoreSliceComplexity` and its callers. Identify where the threshold `5` is compared.
2. Write a one-off script (inline in the research note, not a committed tool) that parses every plan in `docs/plans/Phase-25-*.md` through `docs/plans/Phase-30-*.md`, calls `scoreSliceComplexity` on each slice, and prints the distribution.
3. Write `docs/research/complexity-threshold-v2.65.md` with: distribution table, 60th-percentile value, recommendation.
4. Update the default threshold in code to match research (target: 3).
5. Update `tests/orchestrator-complexity.test.mjs` to reflect the new default, with a comment pointing to the research note.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-complexity.test.mjs"
```

**Stop Condition**: Vitest fails, OR research distribution shows threshold=3 still selects zero slices (escalate — may need a different heuristic entirely; mark Slice 5 as partial and file meta-bug).

---

### Slice 6 — Tempering promoter [sequential]

**Depends On**: Slice 5
**Context Files**: `pforge-mcp/tempering.mjs`, `pforge-mcp/orchestrator.mjs` (reference only), `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`
**Scope**: `pforge-mcp/tempering.mjs`, `pforge-mcp/tests/tempering-promoter.test.mjs`

1. Add `promoteSuppressions({ cwd, threshold = 3 })` in `tempering.mjs`:
   - Reads suppression events (existing storage format).
   - Groups by suppression hash.
   - For each group with count ≥ threshold, writes `.forge/bugs/BUG-<hash>.md` if not present, or appends a "re-observed" line if present.
2. Export `promoteSuppressions` and wire it into the existing tempering flow (called at end of `runPlan` like the existing summary writer).
3. Threshold read from `.forge.json` → `runtime.tempering.promoteThreshold` with default 3.
4. Cover in `tests/tempering-promoter.test.mjs`: below threshold → no file, at threshold → new BUG file with required sections, re-run with same input → append-only (idempotent), custom threshold respected.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/tempering-promoter.test.mjs"
```

**Stop Condition**: Vitest fails, OR promoter writes files outside `.forge/bugs/` (guard via path assertion in test).

---

### Slice 7 — Full sweep and release [sequential]

**Depends On**: Slice 6
**Context Files**: `CHANGELOG.md`, `ROADMAP.md`, `pforge-mcp/capabilities.mjs` (reference only), `.github/instructions/git-workflow.instructions.md`
**Scope**: `CHANGELOG.md`, `ROADMAP.md`

1. Run full test sweep: `pforge-mcp` + `pforge-master`.
2. Promote `[Unreleased]` → `[2.65.0] — <date>` in CHANGELOG with one entry per slice.
3. Update ROADMAP with Phase-31 completion row.
4. Regenerate capabilities snapshot if `capabilities.mjs` has a write-snapshot mode; otherwise just verify it runs.
5. Leave VERSION/package.json at `2.65.0-dev` — actual release tag is cut post-plan by the owner following the release procedure in `/memories/repo/release-procedure.md`.

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npm test"
bash -c "cd pforge-master && npm test"
node -e "const c=require('fs').readFileSync('CHANGELOG.md','utf8'); if(!/##\s*\[2\.65\.0\]/.test(c)) throw new Error('CHANGELOG missing [2.65.0] section'); console.log('ok');"
```

**Stop Condition**: Any test suite red, OR CHANGELOG promotion check fails.

---

## Definition of Done

- [ ] All 7 slices committed to `master` with conventional-commit messages.
- [ ] All validation gates passed in their slice.
- [ ] Full `npm test` green in both `pforge-mcp/` and `pforge-master/`.
- [ ] CHANGELOG promoted to `[2.65.0]` with one entry per slice.
- [ ] ROADMAP reflects Phase-31 as shipped.
- [ ] `docs/research/complexity-threshold-v2.65.md` and `docs/research/gate-synthesis-flip-safety-v2.65.md` exist.
- [ ] `pforge analyze` on this plan shows no `plan-parser-gate-missing` advisories against its own slices (self-consistency check).
- [ ] **Reviewer Gate passed (zero 🔴 Critical)** — owner runs `step5-review-gate.prompt.md` in a fresh session before cutting v2.65.0.

---

## Stop Conditions

Halt execution and escalate to owner if any of the following occur:

1. **Build failure**: Any `npm test` or gate command returns non-zero for reasons unrelated to the current slice's intended changes.
2. **Test regression**: A test unrelated to Phase-31 scope starts failing — indicates scope leak.
3. **Scope violation**: A worker edit touches a file outside the slice's declared scope. Roll back the commit; do not retry until plan is amended.
4. **Security breach**: A worker proposal introduces a new dependency, a network call, or a secret read path not already present.
5. **Stop Condition from a specific slice** triggered (see each slice above).
6. **Self-repair signal**: If a meta-bug is observed during execution (e.g. the retry loop burns tokens, a gate flaps 3+ times), file via `forge_meta_bug_file` and continue — do not block the plan, but flag it in the CHANGELOG.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Slice 3 reflexion wiring changes first-attempt prompt output and breaks existing snapshots | Medium | Slice 3 Stop Condition explicitly checks first-attempt parity. |
| Slice 5 distribution shows threshold=3 also selects zero slices | Low | Stop Condition — escalate as meta-bug, mark slice partial, do not force a bad threshold. |
| Slice 6 promoter writes outside `.forge/bugs/` due to hash collision with `/` characters | Low | Hash is SHA-256 hex (no `/`), plus test asserts path starts with `.forge/bugs/`. |
| Session context degrades mid-plan | Medium | Re-anchor Checkpoint after Slice 4 explicitly recommends session break with `--resume-from 5`. |
| Breaking change in Slice 4 lands accidentally (default flip) | Low | Required Decision #1 resolved to **defer** — flag is opt-in only. Slice 4 Stop Condition guards default value. |

---

## Budget

- **Target per slice**: 30–90 minutes of worker time.
- **Total session budget**: ~5 hours (7 slices × ~45 min + overhead).
- **Cost estimate**: Call `forge_estimate_quorum` before execution for authoritative numbers. Prior Phase-30 (7 slices, similar scope) cost ~$9 at Sonnet + grok-4.20 mixed quorum.

---

## Session Budget Check

- **Total slices**: 7
- **Recommended session break**: After Slice 4 (see Re-anchor Checkpoint above). Run `--resume-from 5` in a fresh session.
- **Max Context Files per slice**: 4 (Slice 1, 4, 5). Within budget.
