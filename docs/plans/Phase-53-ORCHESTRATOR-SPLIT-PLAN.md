---
phase: 53
name: ORCHESTRATOR-SPLIT
status: HARDENED
lockHash: 9179a1da53297545cd6644b8d42ec9cb08c6b74aae24fca02cc1399bc99a412d
---

# Phase 53 — ORCHESTRATOR-SPLIT — Decompose `pforge-mcp/orchestrator.mjs` into focused sub-modules

> **Status**: **HARDENED — cleared for execution 2026-05-19**
> **Source**: Promoted from the A-series module-size findings in Phase 42's audit catalog (A1 — `orchestrator.mjs` at 13,933 LOC, ~4.6× the 3,000-LOC threshold). Phase 52 (SERVER-SPLIT) validated the exact hardening pattern at medium scale; this phase applies it to Plan Forge's largest execution-engine file.
> **Tracks**: `pforge-mcp/orchestrator.mjs` (eventual CLI-entrypoint + re-export shim), `pforge-mcp/orchestrator/*.mjs` (NEW directory of focused sub-modules), `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs` (NEW), `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` (NEW), `pforge-mcp/tests/no-circular-imports.test.mjs` (extended in S0; allowlist cleared in S8), `pforge-mcp/cost-service.mjs` (S8 only), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`.
> **Estimated cost**: medium. Zero intended behavioral change. Pure mechanical extraction with snapshot-as-contract validation, but higher blast radius than Phase 52 because `orchestrator.mjs` owns plan parsing, worker routing, lifecycle hooks, watcher/review plumbing, model scoring, and the CLI entrypoint.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute → S10 retro. **No separate QA/E2E slice** — the orchestrator-surface snapshot + circular-import gate + existing `pforge-mcp` test suite are the no-behavior-change proof.
> **Recommended starting slice**: **S0** (golden snapshot + circular gate extension must land first — every extraction slice depends on it).
> **Session budget**: 11 slices (S0–S10). Recommend multiple sessions. Highest-risk slices: S2 (worker-runtime), S4 (run-plan), S6 (hooks), S8 (model-scoring + circular-import resolution), S9 (full shim conversion).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [x] **Phase 52 (SERVER-SPLIT) has shipped** — snapshot-as-contract, circular-import gate, and entrypoint-shim pattern are inherited verbatim. ✅ Already satisfied (Phase 52 shipped 2026-05-19).
- [x] `master` is clean. ✅ Assumed satisfied for execution hold at harden time.
- [x] `planning/main` is clean (no in-flight phase touching `pforge-mcp/orchestrator.mjs`, `pforge-mcp/cost-service.mjs`, or `pforge-mcp/tests/no-circular-imports.test.mjs`). ✅ Assumed satisfied for execution hold at harden time.
- [x] `lockHash` (added in Step-2 harden) matches plan body at run time. ✅ To be computed after hardening.
- [x] No competing in-flight plan is restructuring `pforge-mcp/orchestrator/` directory layout. ✅ Already satisfied.
- [x] `madge` is installed (`npm ls madge --workspaces=false --prefix pforge-mcp`). ✅ Already satisfied (installed in Phase 51 S0, exercised in Phase 52).

**To resume**: keep Status as `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-53-ORCHESTRATOR-SPLIT-PLAN.md`.

---

## Why this phase exists

`pforge-mcp/orchestrator.mjs` is ~12.9k–13.9k LOC and is the highest-cost reasoning hotspot in the repository:

- It is imported directly or transitively by `server/tool-handlers.mjs`, `server/rest-api.mjs`, `cost-service.mjs`, `bridge.mjs`, notifications code, and a large fraction of the `pforge-mcp` tests.
- It contains a documented circular import (`cost-service.mjs -> orchestrator.mjs`) that currently survives only because the gate allowlists it and the module relies on hoisted declarations. Phase 53 must eliminate that workaround.
- It mixes orthogonal concerns in one file: plan parsing, worker/runtime probing, schedulers, run execution, Forge I/O, lifecycle hooks, watcher/review queue logic, quorum/model scoring, pricing, architecture guardrails, self-test, and CLI dispatch.
- Every routine edit to one subsystem currently drags ~13k LOC of unrelated context into review and agent reasoning. This is the single biggest remaining module-size and cost-per-edit problem in Plan Forge.
- Phase 52 proved the pattern at 9.2k LOC for `server.mjs`; Phase 53 proves it at maximum scale and clears the residual circular-import debt at the same time.

Splitting along the existing section-banner seams reduces edit-context cost, makes PR diffs reviewable again, and removes the last allowlisted `pforge-mcp` circular import.

---

## Scope Contract

### In Scope

- **S0 — Golden snapshot + extend circular-import gate**: add pure export `buildOrchestratorSurface()` to `pforge-mcp/orchestrator.mjs`; generate checked-in golden fixture `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`; add `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs`; extend `pforge-mcp/tests/no-circular-imports.test.mjs` with an `orchestrator.mjs` block that allowlists the single known cycle `cost-service.mjs -> orchestrator.mjs` until S8.
- **S1 — Extract `orchestrator/plan-parser.mjs`**: move plan parsing helpers and lock-hash logic from the Plan Parser section (~lines 448–1129): `parsePlan`, `computeLockHash`, `normalizeSliceId`, `compareSliceIds`, `parseOnlySlicesExpr`, and required local helpers.
- **S2 — Extract `orchestrator/worker-spawn.mjs`**: move worker spawning, execution runtime detection, client host detection, host-aware routing, quorum availability probing, `spawnWorker`, and `detectWorkers` from ~lines 1832–3080.
- **S3 — Extract `orchestrator/schedulers.mjs`**: move the post-slice advisory scanner, `SequentialScheduler`, `ParallelScheduler`, `CompetitiveScheduler`, and `selectWinner` from ~lines 3081–4288.
- **S4 — Extract `orchestrator/run-plan.mjs`**: move `runPlan`, competitive config, adaptive gate synthesis, incident fix-proposal auto-retry, cost anomaly detection, and plan postmortem helpers from ~lines 4289–5806.
- **S5 — Extract `orchestrator/forge-io.mjs`**: move cost history, model performance tracking, operational data infrastructure, run pruning, orphan audit, health trend analysis, and gate-check config/responder pieces from ~lines 6048–7356.
- **S6 — Extract `orchestrator/hooks.mjs`**: move PreDeploy hook, Gate Check responder, Correlation Thread responder, PostSlice hook, PostSlice Tempering hook, PreAgentHandoff hook, Quorum Mode definitions/exports, OpenClaw integration, Watcher, and PostRun Auditor hook from ~lines 7357–9969.
- **S7 — Extract `orchestrator/review-watcher.mjs`**: move watcher/review queue storage, review queue producer hooks, shop-floor home snapshot, and Quorum Analysis from ~lines 10160–12740.
- **S8 — Extract `orchestrator/model-scoring.mjs` + clear the circular import**: move `scoreSliceComplexity`, `loadModelPerformance`, `inferSliceType`, `recommendModel`, `assessQuorumViability`, `aggregateModelStats`, `isApiOnlyModel`, and `QUORUM_PRESETS`; update `pforge-mcp/cost-service.mjs` to import them from the new sub-module; clear the known-cycle allowlist entry.
- **S9 — Full shim conversion**: reduce `pforge-mcp/orchestrator.mjs` to a ≤120-line CLI-entrypoint + re-export shim that preserves public imports and direct `node pforge-mcp/orchestrator.mjs ...` execution semantics.
- **S10 — Retro + roadmap update + CHANGELOG**: write the Phase 53 retro, move Phase 53 to Completed in DEPLOYMENT-ROADMAP, and add CHANGELOG proof of zero behavior change.

### Out of Scope

- **Any behavioral change in any moved declaration.** The snapshot contract + existing tests together enforce this.
- **Any change to existing export signatures or return types.** The only net-new export allowed is `buildOrchestratorSurface()` in S0.
- **Any change to tool behavior, route behavior, or review/watch semantics unrelated to extraction.** This phase is structural.
- **Any consumer import-path edits outside the shim/re-export strategy.** Existing imports from `./orchestrator.mjs` remain valid until intentionally moved in S8 for `cost-service.mjs` only.
- **Any new dependency** (`dependencies` or `devDependencies`).
- **Any split of `cost-service.mjs` itself.** Only its import statements change in S8 to break the cycle.
- **Any cleanup of unrelated audit artifacts, lint debt, or pre-existing warnings.** Record drift; do not widen scope.
- **Any modification to `pforge-sdk/`, `extensions/`, `pforge-master/`, or other unrelated trees.** Universal carve-outs remain in force.

### Forbidden Actions

- **Do NOT modify any existing export name or export shape** in S0–S9. Consumers must keep working through the shim.
- **Do NOT change runtime behavior in S0.** `buildOrchestratorSurface()` is purely additive, side-effect-free, and must not mutate module state.
- **Do NOT regenerate the golden fixture after S0** unless the phase explicitly accepts a contract change (this phase does not). If snapshot drifts, the slice failed.
- **Do NOT introduce any new circular import.** The allowlist stays exactly `{ 'cost-service.mjs -> orchestrator.mjs' }` until S8, then becomes empty.
- **Do NOT modify consumer files outside explicit slice scope.** The only planned non-orchestrator production edit before S10 is `pforge-mcp/cost-service.mjs` in S8.
- **Do NOT bundle slices.** S0–S10 each = one commit.
- **Do NOT exceed 120 LOC in the final `pforge-mcp/orchestrator.mjs` shim.** It may contain only imports, re-exports, minimal executable guard/entrypoint wiring, and comments.
- **Do NOT remove direct CLI usability** of `node pforge-mcp/orchestrator.mjs --test|--parse|--run|--estimate|--watch|--analyze` during shim conversion.
- **Do NOT hand-edit the golden fixture.** Generate it from `buildOrchestratorSurface()` output only.
- **Do NOT add or remove section banners during S0.** The section-banner list is part of the surface contract.
- **Do NOT touch `pforge-mcp/server.mjs`** during this phase. Phase 52 already stabilized it.
- **Do NOT add new MCP tools, REST routes, or watcher/review outputs** during this structural split.
- **Do NOT modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire, still in force).

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen wording and line ranges but should not re-litigate them.

1. **Phase ordering is fixed** — Phase 52 shipped first; Phase 53 inherits its working pattern.
2. **Snapshot-as-contract is mandatory** — `buildOrchestratorSurface()` + checked-in golden fixture is the S0 safety net for every later extraction.
3. **The snapshot surface includes BOTH exports and section banners** — exported symbol names catch public API drift; banner titles catch structural drift against the planned extraction seams.
4. **The known circular import is documented, not normalized** — it is allowlisted only until S8, where it must be removed.
5. **`cost-service.mjs` is the only consumer allowed to move off `./orchestrator.mjs`** during this phase, and only in S8 to clear the cycle.
6. **Sub-modules live under `pforge-mcp/orchestrator/`** — not flat siblings — to keep the decomposition legible.
7. **Extraction order follows the section-banner seams** — parser → worker/runtime → schedulers → run-plan → Forge I/O → hooks → review/watcher → model scoring → shim → retro.
8. **`buildOrchestratorSurface()` is the only net-new export** — pure contract function, side-effect-free.
9. **No symbol renames** — moved declarations keep the exact original names.
10. **The final `orchestrator.mjs` remains executable** — unlike a pure library shim, it must preserve CLI entrypoint behavior within the ≤120-line cap.
11. **Per-slice validation uses Windows-safe `node -e "process.chdir(...); execSync(...)"` style** — no `bash -c "cd ... && ..."` constructions.
12. **Full `pforge-mcp` test suite is required at S9** — targeted snapshot/circular gates are sufficient for earlier slices, but the full suite is the promotion gate before retro.
13. **S8 owns the model-scoring seam** — the eight symbols currently coupling `cost-service.mjs` to `orchestrator.mjs` move together as one deliberate contract.
14. **The snapshot fixture is checked in** — CI reads it; CI does not regenerate it.
15. **Re-anchor checkpoints are mandatory** — if scope drifts or files outside the planned seam are touched, halt and roll back.
16. **Phase 53 retro must feed forward into future extractions** — especially whether the CLI-entrypoint shim pattern scales cleanly at 13k+ LOC.

---

## Required Decisions

All decisions for this phase are resolved in §"Resolved Decisions" above (16 items, locked at draft time). No open TBDs block execution.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Phase ordering | ✅ Resolved | Phase 52 first, then Phase 53 (RD #1) |
| 2 | No-behavior-change enforcement | ✅ Resolved | Snapshot + circular gate + tests (RD #2) |
| 3 | Snapshot content | ✅ Resolved | Export names + section banners (RD #3) |
| 4 | Circular-import treatment | ✅ Resolved | Allowlist until S8 only (RD #4) |
| 5 | Cost-service coupling strategy | ✅ Resolved | Move the 8 model-scoring symbols in S8 (RD #5, #13) |
| 6 | Sub-module directory layout | ✅ Resolved | `pforge-mcp/orchestrator/` (RD #6) |
| 7 | Extraction ordering | ✅ Resolved | Parser → worker/runtime → schedulers → run-plan → Forge I/O → hooks → review/watcher → model-scoring → shim (RD #7) |
| 8 | Net-new export policy | ✅ Resolved | Only `buildOrchestratorSurface()` (RD #8) |
| 9 | Rename policy | ✅ Resolved | No renames (RD #9) |
| 10 | Final shim semantics | ✅ Resolved | ≤120-line executable shim (RD #10) |
| 11 | Validation command style | ✅ Resolved | Windows-safe `node -e` pattern only (RD #11) |
| 12 | Full-suite promotion gate | ✅ Resolved | Required at S9 (RD #12) |
| 13 | Snapshot fixture lifecycle | ✅ Resolved | Checked in; deliberate update only (RD #14) |
| 14 | Re-anchor enforcement | ✅ Resolved | Mandatory after each slice (RD #15) |
| 15 | Retro carryover obligation | ✅ Resolved | Phase 53 retro feeds future work (RD #16) |
| 16 | Section-banner seam preservation | ✅ Resolved | Banner list is contractually frozen until intentional extraction moves it (RD #3) |

---

## Slice Decomposition

> All slices are tagged **[sequential]** — the snapshot fixture and circular-import gate from S0 are prerequisites for every later extraction. No parallel execution group exists.

### Slice 0 — Golden snapshot + extend circular-import gate

- **Depends On**: nothing (Execution Hold enforced outside the slice graph).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (near end, before CLI entry point), `pforge-mcp/server/surface.mjs` (pattern reference), `pforge-mcp/tests/server-surface-snapshot.test.mjs` (pattern reference), `pforge-mcp/tests/no-circular-imports.test.mjs` (extend pattern), `pforge-mcp/tests/fixtures/server-surface.golden.json` (fixture pattern).
- **Traces to**: Resolved Decisions #2, #3, #4, #8, #11, #14.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`
  - `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs`
  - `pforge-mcp/tests/no-circular-imports.test.mjs`
- Add `export function buildOrchestratorSurface()` near the end of `pforge-mcp/orchestrator.mjs`, immediately before the `// ─── CLI Entry Point` section.
- Function contract: return `{ exports: string[], sectionBanners: string[] }` with both arrays sorted and defined from a static list compiled from the file. Pure function, no I/O, no side effects.
- Generate `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` from actual `buildOrchestratorSurface()` output, 2-space indent, canonical newline-terminated JSON.
- Add `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs` mirroring the Phase 52 server snapshot pattern byte-for-byte.
- Extend `pforge-mcp/tests/no-circular-imports.test.mjs` with a new `orchestrator.mjs` block that inherits `KNOWN_CYCLES = new Set(["cost-service.mjs -> orchestrator.mjs"])` for S0–S7.
- **Validation Gate**:
```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs', {stdio:\'inherit\', shell:true});"
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('pforge-mcp/tests/fixtures/orchestrator-surface.golden.json','utf8'));if(!Array.isArray(j.exports)||j.exports.length<150)throw new Error('exports array missing or too small');if(!Array.isArray(j.sectionBanners)||j.sectionBanners.length<30)throw new Error('sectionBanners array missing or too small');console.log('ok S0 — exports:'+j.exports.length+' sectionBanners:'+j.sectionBanners.length);"
```

### Slice 1 — Extract `orchestrator/plan-parser.mjs`

- **Depends On**: S0.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (Plan Parser section, ~lines 448–1129), `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/plan-parser.mjs`
- Move `parsePlan`, `computeLockHash`, `normalizeSliceId`, `compareSliceIds`, `parseOnlySlicesExpr`, and required local helpers verbatim into `pforge-mcp/orchestrator/plan-parser.mjs`.
- Preserve all existing exports from `orchestrator.mjs` via import/re-export wiring.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/plan-parser.mjs';if(!fs.existsSync(p))throw new Error('plan-parser.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['parsePlan','computeLockHash','normalizeSliceId','compareSliceIds','parseOnlySlicesExpr'])if(!new RegExp('export\\s+(?:async\\s+)?function\\s+'+name+'\\b').test(src)&&!new RegExp('export\\s*\\{[^}]*\\b'+name+'\\b').test(src))throw new Error(name+' not exported');console.log('ok S1 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-plan-parser-gates.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 2 — Extract `orchestrator/worker-spawn.mjs`

- **Depends On**: S1.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (Worker Spawning through Quorum Model Availability Probing, ~lines 1832–3080), `pforge-mcp/tests/orchestrator-spawn-shell.test.mjs`, `pforge-mcp/tests/orchestrator-launch-controls.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/worker-spawn.mjs`
- Move worker spawning, runtime detection, client-host detection, routing preference, quorum model availability probing, `spawnWorker`, and `detectWorkers` verbatim.
- Preserve the documented known circular import; do NOT touch `cost-service.mjs` yet.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/worker-spawn.mjs';if(!fs.existsSync(p))throw new Error('worker-spawn.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['detectWorkers','spawnWorker','detectExecutionRuntime','detectClientHost','getRoutingPreference','assessQuorumViability'])if(!src.includes(name))throw new Error(name+' missing from worker-spawn.mjs');console.log('ok S2 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-spawn-shell.test.mjs tests/orchestrator-launch-controls.test.mjs tests/orchestrator-timeout-committed.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 3 — Extract `orchestrator/schedulers.mjs`

- **Depends On**: S2.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (~lines 3081–4288), `pforge-mcp/tests/orchestrator-gate-dispatch.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/schedulers.mjs`
- Move the post-slice advisory scanner, `SequentialScheduler`, `ParallelScheduler`, `CompetitiveScheduler`, and `selectWinner` verbatim.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/schedulers.mjs';if(!fs.existsSync(p))throw new Error('schedulers.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['SequentialScheduler','ParallelScheduler','CompetitiveScheduler','selectWinner'])if(!src.includes(name))throw new Error(name+' missing from schedulers.mjs');console.log('ok S3 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-gate-dispatch.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 4 — Extract `orchestrator/run-plan.mjs`

- **Depends On**: S3.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (~lines 4289–5806), `pforge-mcp/tests/orchestrator-gate-synthesis.test.mjs`, `pforge-mcp/tests/orchestrator-complexity.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/run-plan.mjs`
- Move `runPlan`, competitive config, adaptive gate synthesis, incident auto-retry, cost-anomaly helpers, and plan-postmortem helpers verbatim.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/run-plan.mjs';if(!fs.existsSync(p))throw new Error('run-plan.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['runPlan','loadCompetitiveConfig','synthesizeGateSuggestions','detectCostAnomaly','buildPlanPostmortem'])if(!src.includes(name))throw new Error(name+' missing from run-plan.mjs');console.log('ok S4 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-gate-synthesis.test.mjs tests/orchestrator-complexity.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 5 — Extract `orchestrator/forge-io.mjs`

- **Depends On**: S4.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (Cost History through Health Trend Analysis + Gate Check config/responder, ~lines 6048–7356), `pforge-mcp/tests/orchestrator-version-collision.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/forge-io.mjs`
- Move cost history/model performance, operational data infra, run pruning, orphan audit, health trend, and gate-check config/responder helpers verbatim.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/forge-io.mjs';if(!fs.existsSync(p))throw new Error('forge-io.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['getCostReport','loadModelPerformance','aggregateModelStats','ensureForgeDir','pruneForgeRuns','getHealthTrend','loadGateCheckConfig','registerGateCheckResponder'])if(!src.includes(name))throw new Error(name+' missing from forge-io.mjs');console.log('ok S5 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-version-collision.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 6 — Extract `orchestrator/hooks.mjs`

- **Depends On**: S5.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (~lines 7357–9969), `pforge-mcp/tests/orchestrator-reflexion-prompt.test.mjs`, `pforge-mcp/tests/drain-orchestrator.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #10, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/hooks.mjs`
- Move PreDeploy hook, gate/correlation responders, PostSlice hook, PostSlice Tempering hook, PreAgentHandoff hook, Quorum Mode definitions/exports, OpenClaw, Watcher, and PostRun Auditor hook verbatim.
- Preserve CLI behavior and public re-exports.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/hooks.mjs';if(!fs.existsSync(p))throw new Error('hooks.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['runPreDeployHook','registerCorrelationThreadResponder','runPostSliceHook','runPostSliceTemperingHook','runPreAgentHandoffHook','QUORUM_PRESETS','loadOpenClawConfig'])if(!src.includes(name))throw new Error(name+' missing from hooks.mjs');console.log('ok S6 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-reflexion-prompt.test.mjs tests/drain-orchestrator.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 7 — Extract `orchestrator/review-watcher.mjs`

- **Depends On**: S6.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (~lines 10160–12740), existing watcher/review tests, `pforge-mcp/tests/orchestrator.test.mjs`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #11.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/review-watcher.mjs`
- Move Watcher, PostRun Auditor, Review Queue Storage, Review Queue Producer hooks, shop-floor home snapshot, and Quorum Analysis helpers verbatim.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/review-watcher.mjs';if(!fs.existsSync(p))throw new Error('review-watcher.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['findLatestRun','readReviewQueueState','buildWatchSnapshot','readHomeSnapshot','scoreSliceComplexity'])if(!src.includes(name))throw new Error(name+' missing from review-watcher.mjs');console.log('ok S7 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator.test.mjs tests/orchestrator-analyze.test.mjs', {stdio:\'inherit\', shell:true});"
```

### Slice 8 — Extract `orchestrator/model-scoring.mjs` + resolve circular import

- **Depends On**: S7.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs` (Model Performance Tracking, Quorum Model Availability Probing tail, pre-Quorum-Mode helpers, Quorum Mode export seam, Quorum Analysis), `pforge-mcp/cost-service.mjs`, `pforge-mcp/tests/no-circular-imports.test.mjs`, `pforge-mcp/tests/orchestrator-complexity.test.mjs`.
- **Traces to**: Resolved Decisions #2, #4, #5, #6, #7, #11, #12, #13.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/model-scoring.mjs`
  - `pforge-mcp/cost-service.mjs`
  - `pforge-mcp/tests/no-circular-imports.test.mjs`
- Move these eight symbols into `pforge-mcp/orchestrator/model-scoring.mjs`: `scoreSliceComplexity`, `loadModelPerformance`, `inferSliceType`, `recommendModel`, `assessQuorumViability`, `aggregateModelStats`, `isApiOnlyModel`, `QUORUM_PRESETS`.
- Update `pforge-mcp/cost-service.mjs` to import those eight symbols from `./orchestrator/model-scoring.mjs` instead of `./orchestrator.mjs`.
- Clear `KNOWN_CYCLES` allowlist entry for `cost-service.mjs -> orchestrator.mjs` once `madge` proves the cycle is gone.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='pforge-mcp/orchestrator/model-scoring.mjs';if(!fs.existsSync(p))throw new Error('model-scoring.mjs missing');const src=fs.readFileSync(p,'utf8');for(const name of ['scoreSliceComplexity','loadModelPerformance','inferSliceType','recommendModel','assessQuorumViability','aggregateModelStats','isApiOnlyModel','QUORUM_PRESETS'])if(!src.includes(name))throw new Error(name+' missing from model-scoring.mjs');const cost=fs.readFileSync('pforge-mcp/cost-service.mjs','utf8');if(!cost.includes('./orchestrator/model-scoring.mjs'))throw new Error('cost-service import not updated');console.log('ok S8 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/orchestrator-complexity.test.mjs', {stdio:\'inherit\', shell:true});"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx madge --circular --extensions mjs .', {stdio:\'inherit\', shell:true});"
```

### Slice 9 — Full shim conversion (`orchestrator.mjs` ≤120 LOC)

- **Depends On**: S8.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator.mjs`, all `pforge-mcp/orchestrator/*.mjs` sub-modules created in S1–S8, `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`.
- **Traces to**: Resolved Decisions #2, #6, #7, #9, #10, #11, #12.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator.mjs`
  - `pforge-mcp/orchestrator/*.mjs`
- Convert `pforge-mcp/orchestrator.mjs` into a ≤120-line CLI-entrypoint + re-export shim.
- Shim may contain only imports, re-exports, minimal direct-execution detection, and CLI dispatch into extracted `runOrchestratorCli()` (or equivalent) defined in a sub-module.
- The snapshot fixture MUST remain byte-identical after shim conversion.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const shim=fs.readFileSync('pforge-mcp/orchestrator.mjs','utf8');const lines=shim.split(/\r?\n/).length;if(lines>120)throw new Error('shim too large: '+lines+' lines');if(!/from\s+['\"]\.\/orchestrator\//.test(shim))throw new Error('shim missing orchestrator sub-module imports');console.log('ok S9 shim is '+lines+' lines');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run', {stdio:\'inherit\', shell:true});"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('node orchestrator.mjs --test', {stdio:\'inherit\', shell:true});"
```

### Slice 10 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0–S9 all green.
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md`.
- **Traces to**: Resolved Decisions #1, #12, #16.
- **Scope** (files in scope):
  - `docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md`
  - `docs/plans/DEPLOYMENT-ROADMAP.md`
  - `CHANGELOG.md`
- Write the Phase 53 retro with before/after LOC table, shim-friction log, circular-import resolution proof, and follow-on recommendations.
- Move Phase 53 from Active to Completed in DEPLOYMENT-ROADMAP.
- Append `[Unreleased] → Changed` CHANGELOG entry naming the orchestrator decomposition and zero-behavior-change proof.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md','docs/plans/DEPLOYMENT-ROADMAP.md','CHANGELOG.md'])if(!fs.existsSync(f))throw new Error('missing: '+f);const retro=fs.readFileSync('docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md','utf8');if(!/circular import|model-scoring|shim/i.test(retro))throw new Error('retro missing key carryover sections');const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!rm.includes('53 — ORCHESTRATOR-SPLIT'))throw new Error('Phase 53 not in roadmap');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!/orchestrator\.mjs.*sub-modules|Decomposed pforge-mcp\/orchestrator\.mjs/i.test(cl))throw new Error('CHANGELOG entry missing');console.log('ok S10');"
```

---

## Acceptance Criteria

- **MUST**: A golden snapshot of `buildOrchestratorSurface()` output exists at `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` and is checked into git (owned by S0).
- **MUST**: `buildOrchestratorSurface()` is exported from `pforge-mcp/orchestrator.mjs` in S0, remains pure, and survives the shim conversion intact in S9.
- **MUST**: `buildOrchestratorSurface()` returns both `exports` and `sectionBanners` arrays, sorted deterministically, and the snapshot test matches the golden fixture byte-for-byte.
- **MUST**: `pforge-mcp/tests/no-circular-imports.test.mjs` gains an `orchestrator.mjs` block in S0 and the allowlist remains exactly `{ 'cost-service.mjs -> orchestrator.mjs' }` until S8.
- **MUST**: S1 creates `pforge-mcp/orchestrator/plan-parser.mjs` and preserves `parsePlan`, `computeLockHash`, `normalizeSliceId`, `compareSliceIds`, `parseOnlySlicesExpr` exports.
- **MUST**: S2 creates `pforge-mcp/orchestrator/worker-spawn.mjs` and preserves worker/runtime exports including `detectWorkers`, `spawnWorker`, `assessQuorumViability`, `detectExecutionRuntime`, `detectClientHost`, and routing helpers.
- **MUST**: S3 creates `pforge-mcp/orchestrator/schedulers.mjs` and preserves `SequentialScheduler`, `ParallelScheduler`, `CompetitiveScheduler`, and `selectWinner` exports.
- **MUST**: S4 creates `pforge-mcp/orchestrator/run-plan.mjs` and preserves `runPlan`, competitive config, gate-synthesis, fix-proposal, cost-anomaly, and postmortem exports.
- **MUST**: S5 creates `pforge-mcp/orchestrator/forge-io.mjs` and preserves Forge I/O / health / gate-check exports.
- **MUST**: S6 creates `pforge-mcp/orchestrator/hooks.mjs` and preserves lifecycle hook / quorum / OpenClaw exports.
- **MUST**: S7 creates `pforge-mcp/orchestrator/review-watcher.mjs` and preserves watcher/review/quorum-analysis exports.
- **MUST**: S8 creates `pforge-mcp/orchestrator/model-scoring.mjs`, moves the 8 cost-service-coupled symbols there, updates `pforge-mcp/cost-service.mjs`, and removes the known circular import from the allowlist.
- **MUST**: Post-S8, `madge --circular --extensions mjs pforge-mcp/` reports no `cost-service.mjs -> orchestrator.mjs` cycle.
- **MUST**: Post-S9, `pforge-mcp/orchestrator.mjs` is ≤120 LOC and contains only the CLI entrypoint/re-export shim wiring.
- **MUST**: The snapshot gate passes at the end of every slice S1–S9.
- **MUST**: The full `pforge-mcp` vitest suite passes at S9 before promotion to S10.
- **MUST**: No consumer file outside explicit slice scope is modified.
- **MUST**: `docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md` exists by S10 and documents shim lessons plus circular-import resolution.
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` moves Phase 53 to Completed in S10.
- **MUST**: `CHANGELOG.md` contains an `[Unreleased] → Changed` entry naming the decomposition and byte-identical surface in S10.
- **SHOULD**: Each extracted sub-module be ≤3,000 LOC, except any deliberate aggregator retained for entrypoint compatibility.
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before Phase 53 is promoted to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + snapshot/circular state at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` exists, parses, and contains `exports` (≥150 entries) and `sectionBanners` (≥30 entries). Confirm `tests/no-circular-imports.test.mjs` passes with the single documented known cycle. |
| **S1** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/plan-parser.mjs` changed in the slice commit. Snapshot remains byte-identical. |
| **S2** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/worker-spawn.mjs` changed in the slice commit. |
| **S3** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/schedulers.mjs` changed in the slice commit. |
| **S4** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/run-plan.mjs` changed in the slice commit. |
| **S5** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/forge-io.mjs` changed in the slice commit. |
| **S6** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/hooks.mjs` changed in the slice commit. |
| **S7** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/orchestrator.mjs` and `pforge-mcp/orchestrator/review-watcher.mjs` changed in the slice commit. |
| **S8** | **CRITICAL**. Re-read §"Forbidden Actions" + RD #13. Confirm the only non-orchestrator production file touched is `pforge-mcp/cost-service.mjs`. Confirm `madge` no longer reports `cost-service.mjs -> orchestrator.mjs`. |
| **S9** | Re-read §"Forbidden Actions". Confirm `pforge-mcp/orchestrator.mjs` ≤120 LOC, still executes as a CLI, and the full `pforge-mcp` suite is green. |
| **S10** | Confirm roadmap promotion, retro, and CHANGELOG proof are complete. |

---

## Definition of Done

- [ ] All 11 execution slices (S0–S10) committed individually with conventional-commit messages.
- [ ] All slice validation gates green.
- [ ] All Re-anchor Checkpoints passed.
- [ ] Snapshot fixture (`pforge-mcp/tests/fixtures/orchestrator-surface.golden.json`) is byte-identical from S0 through S9.
- [ ] `pforge-mcp/tests/no-circular-imports.test.mjs` added the orchestrator block in S0 and removed the allowlist entry in S8.
- [ ] Final `pforge-mcp/orchestrator.mjs` is ≤120 LOC, remains executable, and contains only shim wiring.
- [ ] All planned sub-modules exist under `pforge-mcp/orchestrator/`: `plan-parser.mjs`, `worker-spawn.mjs`, `schedulers.mjs`, `run-plan.mjs`, `forge-io.mjs`, `hooks.mjs`, `review-watcher.mjs`, `model-scoring.mjs`.
- [ ] Full `pforge-mcp` test suite passes.
- [ ] `madge --circular --extensions mjs pforge-mcp/` reports no Phase-53-introduced cycles and no remaining `cost-service.mjs -> orchestrator.mjs` cycle.
- [ ] `node pforge-mcp/orchestrator.mjs --test` runs without error post-shim conversion.
- [ ] No consumer file outside the plan scope is modified.
- [ ] `docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md` written and committed.
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` updated: Phase 53 in Completed table.
- [ ] `CHANGELOG.md` `[Unreleased] → Changed` entry added.
- [ ] Reviewer Gate passed (zero 🔴 Critical findings).
- [ ] `lockHash` in plan frontmatter matches at run time.

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Snapshot gate fails twice on the same slice** | Indicates public surface drift or missed re-export wiring. | Roll back the slice, diff the snapshot output against the golden fixture, and identify the missing/changed field before retrying. |
| **`madge --circular` reports any NEW cycle** | Sub-module seam is wrong or a forbidden dependency loop was introduced. | Roll back immediately; route the dependency through a leaf/helper module instead of adding to the allowlist. |
| **`cost-service.mjs -> orchestrator.mjs` still exists after S8** | Core phase objective failed; cycle debt remains unresolved. | Roll back S8, re-check the 8-symbol extraction, and verify every cost-service import moved to `orchestrator/model-scoring.mjs`. |
| **Any non-snapshot test starts failing post-slice** | Consumer surface leaked or execution semantics changed. | Roll back; verify re-export shape and call signatures exactly match pre-slice behavior. |
| **Final shim exceeds 120 LOC** | Source code or business logic was left stranded in `orchestrator.mjs`. | Trim to imports/re-exports/guard only; if not possible, re-scope the preceding extraction. |
| **`node pforge-mcp/orchestrator.mjs --test` fails post-S9** | CLI entrypoint semantics broke. | Roll back S9 and re-extract the CLI runner into a dedicated sub-module while preserving the direct-execution guard. |
| **A file outside slice scope is modified** | Scope-contract violation. | Revert the stray change; the shim/re-export strategy is specifically designed to avoid consumer edits. |
| **Fixture is hand-edited** | Contract violation. | Discard the manual edit and regenerate from `buildOrchestratorSurface()` only. |
| **Security scan reveals a new secret in moved code** | Genuine breach risk. | Halt, redact, and re-do the extraction with secrets flowing through env/config. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| Snapshot gate fails once | Retry once after re-reading the slice instructions and verifying the re-export wiring. |
| Snapshot gate fails twice | Halt per Stop Conditions. |
| Circular-import gate fails | Halt immediately — diagnose before retrying. |
| A targeted test fails | Halt and verify the moved symbol's export signature / import path. |
| Full suite has a likely unrelated flake | Re-run once. If the same test fails twice, treat as real. |
| Shim LOC cap exceeded on first try | Re-read S9 template; remove inlined logic; re-run gate. |

---

## Notes for the Hardener

- The Step-2 hardener should sharpen the line-number estimates for the section-banner seams immediately before execution.
- The hardener should compute `lockHash` and replace `TBD` in the frontmatter.
- The hardener should validate that every slice includes both `**Scope** (files in scope):` and `**Validation Gate**:` markers so `computeLockHash()` captures the intended contract.
- The hardener should preserve the locked S0–S10 slice ordering; only wording and line ranges may sharpen.
- If the banner survey changes (for example, the Watcher/PostRun boundary moves slightly), update the slice context ranges — not the structural decomposition order.
- S8 is the only slice allowed to touch `pforge-mcp/cost-service.mjs`; the hardener should reject any earlier slice scope that includes it.
