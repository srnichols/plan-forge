---
phase: 53
name: ORCHESTRATOR-SPLIT
status: HARDENED
lockHash: 8c4a1f92d03e7b56e1a904c8f2d5e3f7a0b19c4d6e82f5103a97b4c208d1e6f9
---

# Phase 53 — ORCHESTRATOR-SPLIT — Decompose `pforge-mcp/orchestrator.mjs` into focused sub-modules

> **Status**: **HARDENED — cleared for execution 2026-05-19**
> **Source**: A1 finding from Phase 42 audit (`orchestrator.mjs` at ~13,933 LOC, ~4.6× the 3,000-LOC threshold). Phase 52 (SERVER-SPLIT) validated the entrypoint-shim + snapshot-as-contract pattern at medium scale (9.2 k LOC); this phase applies the same pattern to the largest module.
> **Tracks**: `pforge-mcp/orchestrator.mjs` (becomes thin re-export shim), `pforge-mcp/orchestrator/*.mjs` (NEW directory of focused sub-modules), `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs` (NEW), `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` (NEW), `pforge-mcp/tests/no-circular-imports.test.mjs` (updated to clear `KNOWN_CYCLES`), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`.
> **Estimated cost**: low–medium. Zero LLM-cost surfaces. Pure mechanical extraction with snapshot-as-contract validation. Higher blast radius than Phase 52 — `orchestrator.mjs` exports ~180 symbols consumed by tests, `server/rest-api.mjs`, `server/tool-handlers.mjs`, `bridge.mjs`, `notifications/core.mjs`, and `cost-service.mjs`.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute → S10 retro. **No QA/E2E slice** — the orchestrator-surface snapshot + the existing pforge-mcp test suite is the QA contract.
> **Recommended starting slice**: **S0** (golden snapshot must land first — every subsequent slice depends on it).
> **Session budget**: 11 slices (S0–S10). S5 (plan-runner + schedulers) and S6 (worker-runtime) are the highest-risk single slices; recommend fresh context for each.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [x] **Phase 52 (SERVER-SPLIT) has shipped its retro** — entrypoint-shim, snapshot-as-contract, circular-import gate, and no-behavior-change patterns inherited verbatim. ✅ Shipped 2026-05-19.
- [x] `pforge-mcp/tests/no-circular-imports.test.mjs` exists and passes. ✅ From Phase 51/52.
- [x] `madge` is installed (`npm ls madge --prefix pforge-mcp`). ✅ Installed in Phase 51 S0.
- [ ] `master` is clean.
- [ ] `planning/main` is clean (no in-flight phase touching `pforge-mcp/orchestrator.mjs`).
- [ ] `lockHash` matches plan body at run time.
- [ ] No competing in-flight plan is restructuring `pforge-mcp/` directory layout.

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-53-ORCHESTRATOR-SPLIT-PLAN.md`.

---

## Why this phase exists

`pforge-mcp/orchestrator.mjs` is ~13,900 LOC and the single highest-impact file in the codebase:

- It is imported by `server/rest-api.mjs`, `server/tool-handlers.mjs`, `cost-service.mjs`, `bridge.mjs`, `notifications/core.mjs`, and **>60 test files** — virtually every test in the suite loads it.
- It contains a **circular import** (`orchestrator.mjs → cost-service.mjs → orchestrator.mjs`), which is tracked in the `KNOWN_CYCLES` allowlist and actively suppresses circular-import gate failures. Phase 53 MUST clear this cycle.
- Every feature addition or bug fix in Plan Forge's execution engine requires loading ~14 k LOC of unrelated code into agent context. Per-edit cost is the highest in the codebase.
- It is the A1 finding from the Phase 42 audit — the highest-severity module-size violation.

Phase 52 proved the pattern works at 9.2 k LOC with 12 sub-modules. Phase 53 applies it at 13.9 k LOC with ~13 sub-modules, plus the additional obligation of resolving the circular import.

---

## Scope Contract

### In Scope

**S0 — Golden snapshot + inherit circular-import gate**:
- Add `buildOrchestratorSurface()` as a **new pure export** in `pforge-mcp/orchestrator.mjs` — returns `{ exports: string[] }` (sorted list of all exported symbol names). This is the ONLY net-new export this phase introduces.
- Generate `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` — checked in, generated once, serves as the contract.
- Add `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs` — imports `buildOrchestratorSurface` and asserts byte-identical JSON match against the golden fixture.
- `pforge-mcp/tests/no-circular-imports.test.mjs` runs unchanged on every slice gate; `KNOWN_CYCLES` allowlist retains `{ 'orchestrator.mjs > cost-service.mjs' }` until S9.

**S1 — Extract `orchestrator/state.mjs` (mutable module-level state)**:
- New file: `pforge-mcp/orchestrator/state.mjs`
- Moves all mutable top-level `let` bindings:
  - `cachedBashPath` (~line 278)
  - `_ghCopilotProbe` (~line 1217)
  - `_ghCopilotCache` (~line 1227)
  - `_secretsLoader` (~line 1228)
  - `_cliWorkersCache` (~line 1233)
  - `_cliWorkersCacheExpiry` (~line 1234)
  - `_workerCapabilitiesCache` (~line 1838)
  - `_postSliceHookFired` (~line 7899)
  - `_postSliceTemperingFired` (~line 8778)
- Exports named getters and setters for each binding so sub-modules can access state without circular imports.
- `orchestrator.mjs` imports from `./orchestrator/state.mjs` and re-exports where public.
- Extracted first: every other sub-module will import from it.

**S2 — Extract `orchestrator/constants.mjs` (pure exported constants)**:
- New file: `pforge-mcp/orchestrator/constants.mjs`
- Moves all pure top-level constants (no functions, no state reads):
  - `SUPPORTED_AGENTS` (~line 78)
  - `EVENT_SOURCE` (~line 84)
  - `SECURITY_RISK` (~line 100)
  - `SECURITY_RISK_FOR_TYPE` (~line 113)
  - `DEFAULT_GATE_TIMEOUT_MS` (~line 125)
  - `DEFAULT_WORKER_OUTPUT_IDLE_MS` (~line 142)
  - `DEFAULT_WORKER_TIMEOUT_MS` (~line 160)
  - `GATE_ALLOWED_PREFIXES` (~line 212)
  - `UNIX_TOOLS` (~line 230)
  - `API_ALLOWED_ROLES` (~line 1134)
  - `GATE_SUGGESTION_AUTO_INJECT_THRESHOLD` (~line 5377)
  - `PROPOSED_FIX_DIR` (~line 5527)
  - `COST_ANOMALY_MULTIPLIER` (~line 5699)
  - `POSTMORTEM_RETENTION_COUNT` (~line 5813)
  - `CRUCIBLE_STALL_CUTOFF_DAYS` (~line 10286)
  - `REVIEW_SOURCES` (~line 10493)
  - `REVIEW_SEVERITIES` (~line 10497)
  - `REVIEW_STATUSES` (~line 10498)
  - `REVIEW_RESOLUTIONS` (~line 10499)
- `orchestrator.mjs` imports from `./orchestrator/constants.mjs` and re-exports all.
- Safe slice — no side-effects, no state, no function extraction.

**S3 — Extract `orchestrator/forge-io.mjs` (filesystem I/O helpers)**:
- New file: `pforge-mcp/orchestrator/forge-io.mjs`
- Moves: `appendEvent`, `writeSilentExitRecord`, `ensureForgeDir`, `readForgeJson`, `appendForgeJsonl`, `readForgeJsonl`, `pruneForgeRuns`, `auditOrphanForgeFiles` (~lines 394–6403, scattered).
- These are pure filesystem operations on `.forge/` paths with no circular dependencies.
- Many consumers (`server/openbrain-bridge.mjs`, `notifications/core.mjs`, external tests) import these — `orchestrator.mjs` shim must re-export them.
- Extract together because they form a cohesive I/O layer.

**S4 — Extract `orchestrator/parser.mjs` (plan parsing + gate parsing)**:
- New file: `pforge-mcp/orchestrator/parser.mjs`
- Moves: `parsePlan`, `computeLockHash`, `parseOnlySlicesExpr`, `normalizeSliceId`, `compareSliceIds`, `parseValidationGates`, `lintGateCommands`, `validateGatePortability`, `looksLikeProse`, `isGateCommandAllowed`, `parseGitPorcelain`, `parseShortstat`, `parseEventLine`, `parseEventsLog`, `coalesceGateLines`, `editDistance`, `isPlaceholderToken`, `suggestAllowedCommand` (~lines 243–7128, text-processing functions).
- No side-effects (pure transformations on strings/objects). Safe extraction.

**S5 — Extract `orchestrator/worker-runtime.mjs` (worker detection + spawn)**:
- New file: `pforge-mcp/orchestrator/worker-runtime.mjs`
- Moves: `resolveBashPath`, `__resetBashPathCache`, `detectWorkers`, `resetCliWorkersCache`, `setGhCopilotProbe`, `isDirectApiOnlyModel`, `isCopilotServableModel`, `isApiOnlyModel`, `getFoundryAuthScope`, `detectApiProvider`, `setSecretsLoader`, `buildApiMessages`, `generateImage`, `loadWorkerCapabilities`, `compareVersions`, `detectPackageManager`, `suggestInstall`, `classifyProbeFailure`, `detectRuntimes`, `detectExecutionRuntime`, `detectClientHost`, `describeBillingSurface`, `getRoutingPreference`, `loadRoutingPreference`, `resolveRequiredCli`, `probeQuorumModelAvailability`, `filterQuorumModels`, `formatQuorumSummary`, `assessQuorumViability`, `spawnWorker`, `detectHelpTextOutput`, `detectSilentWorkerFailure`, `detectKilledBySignal`, `detectSelfRepairMissed`, `buildRetryPrompt`, `deriveVendorFromModel`, `extractTokens`, `shouldDefaultPremiumRequestsToOne`, `parseStderrStats`, `resolveGateTimeoutMs`, `resolveWorkerOutputIdleMs`, `parseWorkerTimeoutValue`, `resolveWorkerTimeoutMs` (~lines 125–3492, all worker-related logic).
- Imports state from `./state.mjs`.
- Highest single-file extraction risk — 2,000–3,000 LOC. Recommend a fresh context session.

**S6 — Extract `orchestrator/gate-runner.mjs` (gate execution + regression guard)**:
- New file: `pforge-mcp/orchestrator/gate-runner.mjs`
- Moves: `runGate`, `regressionGuard`, `emitToolTelemetry`, `selectWinner`, `isDestructiveSliceTitle`, `isWorktreeExemptPath`, `loadTeardownGuardConfig`, `loadGateCheckConfig`, `registerGateCheckResponder`, `registerCorrelationThreadResponder`, `verifyBranchSafety`, `isDeployTrigger`, `runPreDeployHook` (~lines 3492–7793).
- Imports from `./state.mjs`, `./parser.mjs`, `./worker-runtime.mjs`.

**S7 — Extract `orchestrator/hooks.mjs` + `orchestrator/snapshot.mjs` (lifecycle hooks + git snapshots)**:
- New file: `pforge-mcp/orchestrator/hooks.mjs` — `resetPostSliceHookFired`, `runPostSliceHook`, `resetPostSliceTemperingFired`, `runPostSliceTemperingHook`, `runPreAgentHandoffHook` (~lines 7793–8943).
- New file: `pforge-mcp/orchestrator/snapshot.mjs` — `captureAbsorbedCommits`, `snapshotPreSliceState`, `pushSliceSnapshot`, `popSliceSnapshot`, `attachSliceSnapshotRestore`, `cleanupStaleSnapshots`, `extractFilesModifiedExhaustive`, `verifyFilesModified`, `autoCommitSliceIfDirty`, `stageOrphansOnSliceFailure` (~lines 7918–8601).
- Two files in one slice: cohesive lifecycle concerns; bundling avoids two thin slices.

**S8 — Extract `orchestrator/watch.mjs` + `orchestrator/review-queue.mjs` (watch + review)**:
- New file: `pforge-mcp/orchestrator/watch.mjs` — `buildWatchSnapshot`, `readHomeSnapshot`, `detectWatchAnomalies`, `recommendFromAnomalies`, `appendWatchHistory`, `runWatch`, `runWatchLive` (~lines 10899–12201).
- New file: `pforge-mcp/orchestrator/review-queue.mjs` — `ensureReviewQueueDirs`, `ensureNotificationsDirs`, `ensureNotificationsConfig`, `generateReviewItemId`, `readReviewItem`, `listReviewItems`, `readReviewQueueState`, `addReviewItem`, `resolveReviewItem`, `maybeAddStallReview`, `maybeAddTemperingReview`, `maybeAddBugReview`, `maybeAddVisualBaselineReview`, `maybeAddFixPlanReview` (~lines 10493–10866).

**S9 — Extract `orchestrator/quorum.mjs` + resolve circular import**:
- New file: `pforge-mcp/orchestrator/quorum.mjs` — `loadQuorumConfig`, `loadCompetitiveConfig`, `scoreSliceComplexity`, `classifyLegError`, `quorumDispatch`, `quorumReview`, `analyzeWithQuorum`, `QUORUM_PRESETS`, `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate`, `loadOpenClawConfig`, `postOpenClawSnapshot` (~lines 12320–13005).
- **Circular import resolution**: `cost-service.mjs` imports `isApiOnlyModel`, `QUORUM_PRESETS`, and `assessQuorumViability` from `orchestrator.mjs`. Resolution:
  1. `QUORUM_PRESETS` moves to `orchestrator/quorum.mjs` — `cost-service.mjs` updates its import to `./orchestrator/quorum.mjs`.
  2. `isApiOnlyModel` stays in `orchestrator/worker-runtime.mjs` — `cost-service.mjs` updates import to `./orchestrator/worker-runtime.mjs`.
  3. `assessQuorumViability` stays in `orchestrator/worker-runtime.mjs` — same update.
  4. `orchestrator/quorum.mjs` imports from `./cost-service.mjs` (no cycle: quorum.mjs is not imported by cost-service.mjs).
  5. `orchestrator.mjs` shim no longer imports from `cost-service.mjs` — cycle cleared.
- Update `pforge-mcp/tests/no-circular-imports.test.mjs`: remove `'orchestrator.mjs > cost-service.mjs'` from `KNOWN_CYCLES` (set to `[]`).
- Validation gate MUST confirm zero circular imports.

**S10 — Extract `orchestrator/plan-runner.mjs` + shim reduction (retro)**:
- New file: `pforge-mcp/orchestrator/plan-runner.mjs` — `runPlan`, `SequentialScheduler`, `ParallelScheduler`, `CompetitiveScheduler`, `loadCompetitiveConfig`, `loadGateSynthesisConfig`, `classifySliceDomain`, `synthesizeGateSuggestions`, `formatGateSuggestions`, `defaultRunGitApply`, `findMatchingFixProposal`, `shouldAutoRetryFix`, `markFixAttempted`, `writeProposedFixPatch`, `applyFixProposal`, `rollbackFixProposal`, `detectCostAnomaly`, `computeMedian`, `rerankEscalationChain`, `buildPlanPostmortem`, `listPlanPostmortems`, `writePlanPostmortem`, `getCostReport`, `loadModelPerformance`, `recordModelPerformance`, `aggregateModelStats`, `getHealthTrend`, `extractPlanReleaseVersion`, `detectVersionCollision`, `findLatestRun`, `readSliceArtifacts`, `normalizeRunState`, `readCrucibleState`, `runPostRunAuditorHook`, `inferSliceType`, `recommendModel`, `runAutoSweep`, `runAnalyze`, `parseAnalyzeScore` (~lines 3656–13143, all plan execution logic).
- Reduce `orchestrator.mjs` to a ≤50-line re-export shim. No executable guard needed (orchestrator is not a CLI entrypoint — `server.mjs` is).
- Update DEPLOYMENT-ROADMAP: move Phase 53 from Active to Completed.
- Update CHANGELOG: add Phase 53 entry.
- Append retro to `docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md`.

### Out of Scope

- No changes to any `forge_*` tool behavior.
- No changes to consumer import paths outside `pforge-mcp/` (no `pforge-master/` modifications unless a test import breaks).
- No changes to exported function signatures or return types.
- No additions to `enums.mjs` (constants stay in `orchestrator/constants.mjs`).
- ESLint error fixes (D-series, Phase 43) — separate phase.
- Splitting `orchestrator/plan-runner.mjs` further — out of scope for this phase; it will still be large (~4,000 LOC) but a valid future extraction target.

### Forbidden Actions

1. **Do NOT rename or change any exported symbol** — all re-exports must be byte-identical to current public API.
2. **Do NOT introduce new circular imports** — run `madge --circular` gate after every slice.
3. **Do NOT modify test files except** `no-circular-imports.test.mjs` (S9) and the new snapshot test (S0).
4. **Do NOT change `orchestrator.mjs` behavior** — the only behavioral change permitted is in S9 (circular import path update in `cost-service.mjs`).
5. **Do NOT use `exec(string)` or `eval`** — maintain existing spawn-with-args-array pattern.
6. **Do NOT add new dependencies** to `package.json`.
7. **Do NOT edit `pforge-mcp/server.mjs`** — Phase 52 made it a thin shim; no backslide.
8. **Do NOT land on `master` until `planning/main` passes the full test suite** (`npx vitest run`).

---

## Validation Gates

### Per-Slice Gate (every slice S1–S9)

```bash
# 1. Snapshot gate — must remain byte-identical
node -e "
import('./tests/orchestrator-surface-snapshot.test.mjs').catch(() => {});
" 2>&1 || npx vitest run tests/orchestrator-surface-snapshot.test.mjs --reporter=verbose

# 2. Circular-import gate — zero new cycles
npx madge --circular --extensions mjs pforge-mcp/ 2>&1 | grep -v "No circular"

# 3. No-circular-imports test
npx vitest run tests/no-circular-imports.test.mjs --reporter=verbose
```

### S0 Gate

```bash
# Golden fixture generated and matches
node pforge-mcp/tests/generate-orchestrator-surface.mjs
npx vitest run tests/orchestrator-surface-snapshot.test.mjs --reporter=verbose
echo "S0 gate: PASS"
```

### S9 Gate (circular import cleared)

```bash
# Confirm zero cycles (KNOWN_CYCLES is now empty)
npx vitest run tests/no-circular-imports.test.mjs --reporter=verbose
node -e "import('./cost-service.mjs').then(m => console.log('cost-service imports ok:', typeof m.priceSlice))" --input-type=module
echo "S9 gate: PASS"
```

### S10 Gate (shim reduced + full suite)

```bash
# orchestrator.mjs must be ≤50 lines
node -e "import { readFileSync } from 'node:fs'; const lines = readFileSync('pforge-mcp/orchestrator.mjs', 'utf8').split('\n').length; if (lines > 50) throw new Error('orchestrator.mjs is ' + lines + ' lines, expected <=50'); console.log('shim size ok:', lines, 'lines')"

# Full test suite
cd pforge-mcp && npx vitest run 2>&1 | tail -5
echo "S10 gate: PASS"
```

---

## Slice Execution Notes

### Key Lessons from Phase 52

1. **Python file I/O for large files** — `orchestrator.mjs` at 13.9 k LOC exceeds the practical reliability threshold for the edit tool. Use `python` or PowerShell `Set-Content` for all large file modifications.

2. **State module first** — every subsequent sub-module imports from `orchestrator/state.mjs`. Extract S1 before any other extraction.

3. **Re-export shim must be last** — reduce `orchestrator.mjs` to a shim only in S10, after all sub-modules are verified.

4. **No closures over module-level state** — if any extracted function closes over a `let` variable, that variable must be moved to `orchestrator/state.mjs` with a getter/setter, not captured directly.

5. **Test file `SERVER_COMBINED_SRC` pattern** — tests that do source-text inspection on orchestrator.mjs will need an `ORCHESTRATOR_COMBINED_SRC` helper (similar to `tests/helpers/server-combined-src.mjs`) to search across the shim + sub-modules simultaneously.

### Circular Import Resolution Detail

Before Phase 53:
```
orchestrator.mjs ──→ cost-service.mjs ──→ orchestrator.mjs  (cycle!)
```

After Phase 53 S9:
```
orchestrator/quorum.mjs ──→ cost-service.mjs ──→ orchestrator/worker-runtime.mjs
                                               └→ orchestrator/quorum.mjs (QUORUM_PRESETS only — no cycle)
```

`cost-service.mjs` will be updated to import from sub-modules directly:
```js
// Before
import { isApiOnlyModel, QUORUM_PRESETS, assessQuorumViability } from "./orchestrator.mjs";

// After
import { isApiOnlyModel, assessQuorumViability } from "./orchestrator/worker-runtime.mjs";
import { QUORUM_PRESETS } from "./orchestrator/quorum.mjs";
```

No cycle: `quorum.mjs` does not import `cost-service.mjs` for `QUORUM_PRESETS` (it defines them); it only imports the `price*` functions for the cost-bridge wrappers.

Wait — `quorum.mjs` DOES import `cost-service.mjs` for `priceSlice/priceRun/estimatePlan`. And `cost-service.mjs` imports `QUORUM_PRESETS` from `orchestrator/quorum.mjs`. That creates a new cycle: `orchestrator/quorum.mjs → cost-service.mjs → orchestrator/quorum.mjs`.

**Corrected resolution**: Move `QUORUM_PRESETS` to `orchestrator/constants.mjs` (extracted in S2). Then:
- `cost-service.mjs` imports `QUORUM_PRESETS` from `./orchestrator/constants.mjs` (no cycle — constants.mjs has no imports)
- `cost-service.mjs` imports `isApiOnlyModel`, `assessQuorumViability` from `./orchestrator/worker-runtime.mjs`
- `orchestrator/quorum.mjs` imports `priceSlice/priceRun/estimatePlan` from `./cost-service.mjs` (no cycle back)

This is the clean resolution: `QUORUM_PRESETS` is a pure data object with no imports, so it belongs in `constants.mjs`.

---

## Test Infrastructure (new files)

### `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs`

Tests that `buildOrchestratorSurface()` returns a byte-identical JSON to the golden fixture.

### `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`

Generated once in S0, checked in, never manually edited. Format:
```json
{
  "exports": ["addReviewItem", "aggregateModelStats", "analyzeWithQuorum", ...]
}
```

### `pforge-mcp/tests/helpers/orchestrator-combined-src.mjs`

Analogous to `server-combined-src.mjs` — concatenates `orchestrator.mjs` shim + all sub-modules for source-text inspection in existing tests. Created alongside the shim in S10.

---
