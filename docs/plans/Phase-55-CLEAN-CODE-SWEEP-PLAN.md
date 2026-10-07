---
phase: 55
name: CLEAN-CODE-SWEEP
status: HARDENED
lockHash: 79cdf89ad1ab3f8fb4340b1cedeb15d65026ce2cb849705bb3dfb7ea6faa3ac5
---

# Phase 55 — CLEAN-CODE-SWEEP — Eliminate residual blocking findings from the post-Phase-53 audit

> **Status**: **HARDENED — cleared for execution 2026-05-19**. Hardened against `planning/main@ee944ad` with verified baseline `summary.totalErrors == 4` from a fresh `node scripts/audit/clean-code-review.mjs` run on 2026-05-19. Line ranges, rest-api route-group seams, and the S4 target function name have been sharpened from the draft.
> **Source**: Combined `/clean-code-review` + `/code-review` skill run on 2026-05-19 returned **4 blocking errors** and **1,469 warnings**. The 4 errors plus a small set of high-signal warnings are the entire scope of this phase. Bulk advisory warnings (TIME-FLAKE × 402, complexity-warn × 305, dead-exports × 678) are explicitly OUT of scope and deferred to a follow-on plan after the audit-script false-positive rate is reduced.
> **Tracks**: `pforge-mcp/orchestrator/run-plan.mjs` (split), `pforge-mcp/orchestrator/run-plan/*.mjs` (NEW directory of focused sub-modules), `pforge-mcp/server/rest-api.mjs` (split), `pforge-mcp/server/rest-api/*.mjs` (NEW), `pforge-mcp/local-recall.mjs` (decompose one function), `pforge-mcp/server/tool-handlers/platform.mjs` (decompose one function), `pforge-mcp/notifications/core.mjs` (drop one literal), `pforge-mcp/server/state.mjs` (resolve dep-boundary), `scripts/audit/layer-policy.json` (whitelist OR refactor target), `pforge-mcp/tests/forge-master.advisory.test.mjs`, `pforge-mcp/tests/cost-service-real-plans.test.mjs`, `pforge-mcp/tests/enums.test.mjs` (skip-leak triage), `pforge-mcp/tests/update-from-github-shell.test.mjs` (preexisting failure triage), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md` (NEW).
> **Estimated cost**: medium. Each slice is mechanical or bounded; no LLM-cost surfaces. The audit-report-as-fixture (S0) catches regressions, the splits (S1, S2) borrow Phase 52/53's snapshot pattern, and the function decompositions (S3, S4) are guard-clause extractions in single files.
> **Pipeline**: Specify ✅ → Harden ⏳ → Execute → S9 retro. **No separate QA/E2E slice** — the `/clean-code-review` audit report (run before and after each slice) is the contract. A slice fails its gate if any *new* error appears or if the targeted error count does not drop.
> **Recommended starting slice**: **S0** (baseline audit fixture must land first — every later slice gate compares against it).
> **Session budget**: 10 slices (S0–S9). Recommend 2–3 sessions. Highest-risk slices: S1 (run-plan split, biggest blast radius), S2 (rest-api split, public-surface impact).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [x] **Phase 53 (ORCHESTRATOR-SPLIT) and Phase 52 (SERVER-SPLIT) have shipped** — Phase 55 inherits their snapshot-as-contract pattern and depends on the resulting subfolder layout. ✅ Both shipped 2026-05-19.
- [x] `master` is clean. ✅ Verified at harden time (HEAD `e8b0608`).
- [x] `planning/main` is clean — no in-flight plan touching the same files. ✅ Verified at harden time (HEAD `ee944ad`).
- [x] `lockHash` (added in Step-2 harden) matches plan body at run time. ✅ Computed at final hardening step.
- [x] No competing in-flight plan is restructuring `pforge-mcp/orchestrator/`, `pforge-mcp/server/`, or `scripts/audit/`. ✅ Verified at harden time.
- [x] `madge` is installed in `pforge-mcp`. ✅ Already satisfied (installed in Phase 51 S0, exercised in Phase 52/53).
- [x] The `node scripts/audit/clean-code-review.mjs --out <fixture>` command runs successfully against `planning/main` HEAD and produces the baseline fixture S0 consumes. ✅ Verified at harden time: `summary.totalErrors == 4`, `summary.totalWarnings == 1469`.

**To resume**: keep Status as `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-55-CLEAN-CODE-SWEEP-PLAN.md`.

---

## Why this phase exists

The Phase 42 audit catalog established a six-category clean-code rubric and Phase 43 cleared the bulk of the ESLint error-severity violations. Phases 51–53 split the three largest source files. After all of that work, the consolidated `/clean-code-review` skill run on 2026-05-19 still reports **4 blocking errors** — two leaves of the Phase 52/53 splits that didn't drop below 3,000 LOC, and two residual `complexity-error` functions that were not on the Phase 43 worklist.

These four findings are the only remaining errors in the clean-code gate. Closing them would make the gate green-on-clean, which lets every future PR rely on `npm test` + `node scripts/audit/clean-code-review.mjs` exiting zero as the merge condition. That single property unlocks safer auto-merge, simpler CI, and clearer Boy-Scout deltas for every later phase.

The smaller findings included (one literal drift, one dep-boundary, six skipped tests, one preexisting test failure) are bundled because each is single-file, mechanical, and would otherwise accumulate as untracked tech debt. They are explicitly bounded so the phase stays mechanical and reviewable.

---

## Scope Contract

### In Scope

- **S0 — Baseline audit fixture**: run `node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json` and check the result into git as the per-slice comparison contract. Add `pforge-mcp/tests/clean-code-no-regression.test.mjs` that loads the baseline and the current report, asserting no NEW error appears (warnings may move in either direction).
- **S1 — Split `pforge-mcp/orchestrator/run-plan.mjs` (3,831 LOC → <3,000 LOC)**: extract along the existing section-banner seams into `pforge-mcp/orchestrator/run-plan/` sub-modules. Candidate seams from the current file: `postmortem.mjs` (~lines 544–698), `architecture-guardrails.mjs` (~lines 2684–2922), `self-test.mjs` (~lines 2923+ minus surface declarations), `gate-synthesis.mjs` (~lines 82–252). Final `run-plan.mjs` is a thin re-export + entrypoint shim (≤300 LOC if needed for `runPlan` itself; OK if larger than 120 because `runPlan` is the orchestrator's single biggest function).
- **S2 — Split `pforge-mcp/server/rest-api.mjs` (3,197 LOC → <3,000 LOC)**: extract Express route groups into `pforge-mcp/server/rest-api/` sub-modules. Hardener-identified seams (clean clusters in the existing file):
  - `crucible-routes.mjs` — 10 routes at lines 1745–1922 (`/api/crucible/submit|ask|list|preview|finalize|abandon|config|manual-imports|governance`), ~180 LOC. **Primary extraction target.**
  - `innerloop-routes.mjs` — 7 routes at lines 1010–1179 (`/api/innerloop/status|reviewer-calibration|gate-suggestions|cost-anomalies|proposed-fixes|federation|federation/toggle`), ~170 LOC.
  - `skills-routes.mjs` — 4 routes at lines 946–998 (`/api/skills/pending|accept|reject|defer`), ~50 LOC.
  Top-level `rest-api.mjs` retains app wiring + middleware + REST handler sub-helpers (lines 1–619) + import-and-mount of extracted route groups. Each sub-module exports `register<Group>Routes(app, deps)`. Extracting any TWO of the three primary clusters drops LOC under 3,000.
- **S3 — Decompose `searchLocalThoughts` in `pforge-mcp/local-recall.mjs:420` (body lines 420–454, complexity 22)**: extract `_buildSearchOptions(opts)`, `_chooseBackend(forceBackend)` (async), and `_runTfidfPath(query, thoughts, opts, cwd)` helpers; keep the public signature byte-identical. Target: ESLint `complexity-error` removed (≤20 paths).
- **S4 — Decompose `_callToolHandler_096_forge_embedding_status` in `pforge-mcp/server/tool-handlers/platform.mjs:1090` (body lines 1090–1111)**: this is a tool-specific handler (NOT the parent dispatcher), declared as `async function _callToolHandler_096_forge_embedding_status(request, args)`. Decompose by extracting per-concern helpers:
  - `_probeNeuralBackend(cwd)` — neural availability + version detection (lines ~1099–1110)
  - `_loadEmbeddingCorpus(cwd)` — reads `.forge/` JSONL, returns size + metadata (~lines 1112–1115)
  - `_loadConfiguredBackend(cwd)` — `.forge.json` config read with default fallback (~lines 1116–onwards in remainder)
  Keep the dispatcher signature `_callToolHandler_096_forge_embedding_status(request, args)` and the `_CALL_TOOL_NO_MATCH` early-return contract byte-identical. Target: ESLint `complexity-error` removed (≤20 paths).
- **S5 — Frozen-arrays drift cleanup in `pforge-mcp/notifications/core.mjs`**: replace the 6 hardcoded `"TIMEOUT"` literal occurrences (4 source lines: 415 ×2, 463, 508, 515 ×2 — confirmed by audit) with references to `ERROR_CODES.TIMEOUT`. Import path is `../enums.mjs` (notifications is a subdirectory). Replace BOTH the `new Error("TIMEOUT")` constructions AND the `err.message === "TIMEOUT"` comparisons (use `ERROR_CODES.TIMEOUT` on both sides). No behavioral change.
- **S6 — SKIP-LEAK triage (6 sites)**: for each `describe.skip(` / `it.skip(` in `pforge-mcp/tests/forge-master.advisory.test.mjs` (4 sites), `pforge-mcp/tests/cost-service-real-plans.test.mjs:48` (1 site), `pforge-mcp/tests/enums.test.mjs:86` (1 site), decide one of: (a) re-enable, (b) delete if obsolete, (c) convert to `it.todo(` AND file a tracked issue via `forge_bug_file`. Default decision: convert to `it.todo` + file issue.
- **S7 — Resolve dep-boundary violation `pforge-mcp/server/state.mjs:121 → pforge-master/src/mcp-client.mjs`**: either (a) add a whitelist entry to `scripts/audit/layer-policy.json` if the cross-package import is intentional and justified in a comment, OR (b) refactor to a shared module that both packages import. Hardener picks the path based on the actual usage.
- **S8 — Triage preexisting `update-from-github-shell.test.mjs:92` failure**: investigate the `audit appends log entry from stdin` failure. Fix if a real bug; mark `it.skip` + file an issue if environment-dependent; do NOT silently leave failing. Default decision: fix if `<2h` of work, else file meta-bug and skip with tracked issue.
- **S9 — Retro + roadmap update + CHANGELOG**: write the Phase 55 retro with before/after audit-report metrics (errors/warnings deltas), move Phase 55 to Completed in DEPLOYMENT-ROADMAP, add CHANGELOG entry naming the residual-cleanup proof.

### Out of Scope

- **All `clean-code/complexity-warn` violations (305 total)** unless incidentally improved by S1/S2/S3/S4. These belong to a separate phase after the audit signal/noise ratio improves.
- **All `TIME-FLAKE` test-smell findings (402 total)**. The `test-smells.mjs` regex is over-broad — `Date.now()` for ID generation triggers it. A separate phase should tighten the regex before any sweep.
- **All `CONSOLE-LEAK` findings (25 total)**. These may be intentional debug output in CLI scripts; needs per-file judgment, not a sweep.
- **All `dead-exports` findings (678 total)**. The report appears to have a bug — `deadExports` arrays are empty for all entries. Fix the script before sweeping.
- **Any module-size warn (1,000–3,000 LOC)** files beyond the two errors. Boy-Scout passes on those happen during normal feature work.
- **Any change to public exports, MCP tool surfaces, or CLI commands.** The surface diff must remain zero across the phase.
- **Any change to `pforge-mcp/orchestrator.mjs` or `pforge-mcp/server.mjs` shims** (≤120 LOC each from Phases 52/53).
- **Any change to `pforge-sdk/`, `extensions/`, `templates/`, or `presets/`.**
- **Any new dependency** (`dependencies` or `devDependencies`).
- **Any modification to `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire).
- **Reformatting unrelated files** even if `prettier` would change them.

### Forbidden Actions

- **Do NOT change any public export name, signature, or behavior.** This phase is internal cleanup; the surface diff against pre-phase HEAD must report 0 breaking, 0 additive (besides snapshot fixtures).
- **Do NOT regenerate the baseline audit fixture mid-phase.** S0 produces it; later slices read it. If the baseline is wrong, halt and re-run S0 as a deliberate amendment.
- **Do NOT bundle slices.** S0–S9 each = one commit.
- **Do NOT introduce any new ESLint `complexity-error` or `max-lines-per-function-error` violation.** The S0 no-regression gate enforces this mechanically.
- **Do NOT introduce a new cross-package import** beyond the single one being resolved in S7.
- **Do NOT modify any file outside the slice's declared Scope.**
- **Do NOT use `--no-verify` to bypass commit hooks.**
- **Do NOT lower the audit-script severity thresholds** to make findings disappear. The 4 errors must drop because the code changed, not because the rule changed.
- **Do NOT regenerate `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` or `pforge-mcp/tests/fixtures/server-surface.golden.json`**. Both are frozen contracts from Phases 52/53. If a split exposes a new export, that's a contract change and the phase must halt.
- **Do NOT touch `master` directly.** All work lands on `planning/main`. The shipper slice (out of scope) handles the master sync.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen wording and line ranges but should not re-litigate them.

1. **Phase scope is "4 errors + 5 high-signal warnings"** — not a general cleanup sweep. Bulk advisory categories are explicitly deferred.
2. **Baseline audit JSON is the regression contract** — checked into git, read by the no-regression gate, treated as immutable for the phase duration.
3. **No-regression gate is asymmetric** — error count must NEVER increase from baseline; warning count may move in either direction (splits often surface latent warnings).
4. **Snapshot fixtures from Phases 52/53 are frozen** — if S1 or S2 changes the surface, the phase halts and re-scopes.
5. **`runPlan` may exceed the 120-LOC shim cap** — S1's `run-plan.mjs` may stay larger than 120 lines because `runPlan` itself is the orchestrator's irreducible entrypoint. Target is <3,000 LOC for the file, NOT a shim conversion.
6. **`rest-api.mjs` retains app wiring + middleware** — S2 splits route groups, not middleware. Target is <3,000 LOC for the file.
7. **Function decompositions (S3, S4) preserve signatures byte-for-byte** — only the body changes. Callers must not need updates.
8. **Frozen-arrays drift (S5) imports `ERROR_CODES.TIMEOUT`** — never re-types the literal `"TIMEOUT"` even in tests or comments.
9. **SKIP-LEAK default is `it.todo` + tracked issue** — only re-enable or delete if the hardener confirms the test's intent during slice prep.
10. **Dep-boundary (S7) default is whitelist with a justification comment** — refactor only if the hardener identifies a cleaner shared module that already exists.
11. **Preexisting test failure (S8) gets a 2-hour timebox** — beyond that, skip with tracked issue. Do not let one test blow up the phase.
12. **Per-slice validation uses Windows-safe `node -e "...process.chdir(...);execSync(...)"`** — no `bash -c "cd ... && ..."` constructions.
13. **The clean-code-review aggregator is the per-slice gate** — every slice S1–S8 ends with `node scripts/audit/clean-code-review.mjs --out <slice-report.json>` followed by a no-regression comparison against the baseline.
14. **`/clean-code-review` baseline error count is 4** — the no-regression test fails if any post-slice run reports >4 errors.
15. **Boy-Scout improvements are encouraged but not required** — if a slice incidentally reduces warning count in its scope, document in the retro.
16. **Sub-module directories follow the Phase 53 pattern** — `pforge-mcp/orchestrator/run-plan/` and `pforge-mcp/server/rest-api/` are NEW directories of focused sub-modules.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Phase scope boundary | ✅ Resolved | 4 errors + 5 high-signal warnings only (RD #1) |
| 2 | Regression-detection mechanism | ✅ Resolved | Baseline JSON fixture + asymmetric gate (RD #2, #3) |
| 3 | Snapshot contract status | ✅ Resolved | Phases 52/53 snapshots frozen (RD #4) |
| 4 | run-plan shim semantics | ✅ Resolved | Target <3,000 LOC, NOT shim conversion (RD #5) |
| 5 | rest-api shim semantics | ✅ Resolved | Target <3,000 LOC, retains app wiring (RD #6) |
| 6 | Function-decomposition policy | ✅ Resolved | Signatures byte-for-byte preserved (RD #7) |
| 7 | Frozen-arrays import strategy | ✅ Resolved | `import { ERROR_CODES } from './enums.mjs'` (RD #8) |
| 8 | SKIP-LEAK default decision | ✅ Resolved | `it.todo` + tracked issue (RD #9) |
| 9 | Dep-boundary default decision | ✅ Resolved | Whitelist with justification (RD #10) |
| 10 | Test-failure triage timebox | ✅ Resolved | 2 hours, then skip + issue (RD #11) |
| 11 | Validation command style | ✅ Resolved | Windows-safe `node -e` pattern (RD #12) |
| 12 | Per-slice gate mechanism | ✅ Resolved | clean-code-review.mjs no-regression check (RD #13, #14) |
| 13 | Boy-Scout improvement policy | ✅ Resolved | Encouraged, documented in retro (RD #15) |
| 14 | Sub-module directory layout | ✅ Resolved | `run-plan/` and `rest-api/` subfolders (RD #16) |

All decisions for this phase are resolved above. Hardener may sharpen line ranges; no open TBDs block execution after hardening.

---

## Slice Decomposition

> All slices are tagged **[sequential]** — the baseline fixture and no-regression test from S0 are prerequisites for every later slice. No parallel execution group exists.

### Slice 0 — Baseline audit fixture + no-regression test

- **Depends On**: nothing (Execution Hold enforced outside the slice graph).
- **Parallelism**: [sequential]
- **Context Files**: `scripts/audit/clean-code-review.mjs`, `pforge-mcp/tests/no-circular-imports.test.mjs` (pattern reference for a script-driven gate test).
- **Traces to**: Resolved Decisions #2, #3, #13, #14.
- **Scope** (files in scope):
  - `docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json` (NEW)
  - `pforge-mcp/tests/clean-code-no-regression.test.mjs` (NEW)
- Run `node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json` from repo root.
- Verify the baseline file's `summary.totalErrors` equals 4 (the count surfaced by the pre-phase audit run). If it does not, halt and update RD #14 explicitly before proceeding.
- Add `pforge-mcp/tests/clean-code-no-regression.test.mjs` that:
  1. Reads `docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json` as the baseline.
  2. Runs `scripts/audit/clean-code-review.mjs --out <tmp>` (or uses the latest existing report file).
  3. Asserts `currentReport.summary.totalErrors <= baseline.summary.totalErrors`.
  4. Asserts that **no new error appears** in any category that wasn't in the baseline (compare by `{file, line, ruleId}` tuples).
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json';if(!fs.existsSync(p))throw new Error('baseline missing');const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.summary.totalErrors!==4)throw new Error('baseline error count != 4: '+j.summary.totalErrors);console.log('ok S0 baseline errors:'+j.summary.totalErrors+' warnings:'+j.summary.totalWarnings);"
bash -c "cd pforge-mcp && npx vitest run tests/clean-code-no-regression.test.mjs"
```

### Slice 1 — Split `pforge-mcp/orchestrator/run-plan.mjs` (3,831 → <3,000 LOC)

- **Depends On**: S0.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/orchestrator/run-plan.mjs`, `pforge-mcp/tests/fixtures/orchestrator-surface.golden.json` (frozen contract reference), `pforge-mcp/tests/orchestrator-surface-snapshot.test.mjs`.
- **Traces to**: Resolved Decisions #4, #5, #16.
- **Scope** (files in scope):
  - `pforge-mcp/orchestrator/run-plan.mjs`
  - `pforge-mcp/orchestrator/run-plan/postmortem.mjs` (NEW)
  - `pforge-mcp/orchestrator/run-plan/architecture-guardrails.mjs` (NEW)
  - `pforge-mcp/orchestrator/run-plan/self-test.mjs` (NEW)
  - `pforge-mcp/orchestrator/run-plan/gate-synthesis.mjs` (NEW)
- Extract these sections from `pforge-mcp/orchestrator/run-plan.mjs` into the listed sub-modules (preserving the exact original symbol names):
  - **postmortem.mjs**: `POSTMORTEM_DIR`, `buildPlanPostmortem`, related helpers (~lines 544–698)
  - **architecture-guardrails.mjs**: `GUARDRAIL_RULES`, `SOURCE_EXTENSIONS`, `EXCLUDE_DIRS`, `FRAMEWORK_PATHS`, evaluation helpers (~lines 2684–2922)
  - **self-test.mjs**: self-test entrypoint and helpers (~lines 2923 through pre-surface section)
  - **gate-synthesis.mjs**: `GATE_SYNTH_DOMAIN_PATTERNS`, `GATE_SYNTH_TEMPLATES`, synthesis helpers (~lines 82–252)
- Top-level `run-plan.mjs` re-exports the moved symbols so the snapshot fixture remains byte-identical.
- The orchestrator-surface snapshot from Phase 53 MUST remain byte-identical. If a new export needs to surface, halt and re-scope.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/orchestrator/run-plan/postmortem.mjs','pforge-mcp/orchestrator/run-plan/architecture-guardrails.mjs','pforge-mcp/orchestrator/run-plan/self-test.mjs','pforge-mcp/orchestrator/run-plan/gate-synthesis.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);console.log('ok S1 sub-modules exist');"
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s1.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s1.json','utf8'));if(r.summary.totalErrors>4)throw new Error('regressed: '+r.summary.totalErrors+' errors');const ms=(r.categories['module-size'].findings||[]).find(f=>f.file==='pforge-mcp/orchestrator/run-plan.mjs');if(ms&&ms.severity==='error')throw new Error('run-plan.mjs still over 3000 LOC (audit-loc='+ms.loc+')');console.log('ok S1 audit gate; run-plan.mjs audit-loc='+(ms?ms.loc:'<warn>'));"
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/clean-code-no-regression.test.mjs"
```

### Slice 2 — Split `pforge-mcp/server/rest-api.mjs` (3,197 → <3,000 LOC)

- **Depends On**: S1.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server/rest-api.mjs`, `pforge-mcp/tests/fixtures/server-surface.golden.json` (frozen contract reference), `pforge-mcp/tests/server-surface-snapshot.test.mjs`.
- **Traces to**: Resolved Decisions #4, #5, #16.
- **Scope** (files in scope):
  - `pforge-mcp/server/rest-api.mjs`
  - `pforge-mcp/server/rest-api/crucible-routes.mjs` (NEW — 10 routes at L1745–1922) — **primary extraction**
  - `pforge-mcp/server/rest-api/innerloop-routes.mjs` (NEW — 7 routes at L1010–1179)
- Top-level `rest-api.mjs` retains app initialization (L620–629), shared middleware, REST handler sub-helpers (L1–619), and import-and-mount of extracted route groups. Each sub-module exports `register<Group>Routes(app, deps)` where `deps` is the dependency bag of imports the route handlers need.
- Extracting BOTH the crucible cluster (~180 LOC) and the innerloop cluster (~170 LOC) drops audit-LOC by ~350, well under the 3,000 threshold.
- Frozen server-surface snapshot from Phase 52 MUST remain byte-identical (the snapshot tracks `forge_*` MCP tools, not REST routes — so route extraction should not affect it; verify anyway).
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/server/rest-api/crucible-routes.mjs','pforge-mcp/server/rest-api/innerloop-routes.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);console.log('ok S2 sub-modules exist');"
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s2.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s2.json','utf8'));const ms=(r.categories['module-size'].findings||[]).find(f=>f.file==='pforge-mcp/server/rest-api.mjs');if(ms&&ms.severity==='error')throw new Error('rest-api.mjs still over 3000 LOC (audit-loc='+ms.loc+')');if(r.summary.totalErrors>3)throw new Error('expected error count to drop to 3 after S2; got '+r.summary.totalErrors);console.log('ok S2 audit gate; rest-api.mjs audit-loc='+(ms?ms.loc:'<warn>')+'; errors:'+r.summary.totalErrors);"
bash -c "cd pforge-mcp && npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/clean-code-no-regression.test.mjs"
```

### Slice 3 — Decompose `searchLocalThoughts` in `pforge-mcp/local-recall.mjs`

- **Depends On**: S2.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/local-recall.mjs` (function starts at line 420), surrounding helpers `_tfidfSearch`, `_neuralSearch`, `_emptyResult`, `loadCachedIndex`.
- **Traces to**: Resolved Decisions #7, #13.
- **Scope** (files in scope):
  - `pforge-mcp/local-recall.mjs`
- Extract from the body of `searchLocalThoughts`:
  - `_buildSearchOptions(opts)` — destructures and normalizes the options object
  - `_chooseBackend(forceBackend)` — async; resolves to `"neural" | "tfidf"`
  - `_runTfidfPath(query, thoughts, opts, cwd)` — encapsulates the cache-load + index-search + cache-write flow
- Keep `export async function searchLocalThoughts(query, opts = {})` signature byte-identical.
- Target: ESLint `complexity-error` violation at line 418 disappears from the audit report.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');const src=fs.readFileSync('pforge-mcp/local-recall.mjs','utf8');for(const name of ['_buildSearchOptions','_chooseBackend','_runTfidfPath'])if(!src.includes('function '+name))throw new Error(name+' helper missing');if(!/export async function searchLocalThoughts\(query, opts = \{\}\)/.test(src))throw new Error('searchLocalThoughts signature changed');console.log('ok S3 structure');"
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s3.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s3.json','utf8'));const hits=(r.categories['eslint-d-series'].findings||[]).filter(f=>f.file==='pforge-mcp/local-recall.mjs'&&f.ruleId==='clean-code/complexity-error');if(hits.length>0)throw new Error('searchLocalThoughts complexity-error not resolved: '+hits.length+' hit(s)');if(r.summary.totalErrors>2)throw new Error('expected error count to drop to 2 after S3; got '+r.summary.totalErrors);console.log('ok S3 audit gate; errors:'+r.summary.totalErrors);"
bash -c "cd pforge-mcp && npx vitest run tests/local-recall tests/clean-code-no-regression.test.mjs"
```

### Slice 4 — Decompose `_callToolHandler_096_forge_embedding_status` in `pforge-mcp/server/tool-handlers/platform.mjs`

- **Depends On**: S3.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server/tool-handlers/platform.mjs` (target function declared at line 1090, body extends to ~line 1170; the audit reports complexity-error at line 1053 because ESLint anchors at the surrounding decorator/comment block).
- **Traces to**: Resolved Decisions #7, #13.
- **Scope** (files in scope):
  - `pforge-mcp/server/tool-handlers/platform.mjs`
- Decompose by extracting three module-level helpers from the body of `_callToolHandler_096_forge_embedding_status`:
  - `_probeNeuralBackend(cwd)` → `{ available, version }`
  - `_loadEmbeddingCorpus(cwd)` → `{ corpusSize, sources }`
  - `_loadConfiguredBackend(cwd)` → string backend name with default fallback
- Keep the dispatcher signature `async function _callToolHandler_096_forge_embedding_status(request, args)` and the `_CALL_TOOL_NO_MATCH` early-return contract byte-identical.
- Target: zero ESLint `clean-code/complexity-error` findings for `pforge-mcp/server/tool-handlers/platform.mjs` in the audit report.
- **Validation Gate**:
```bash
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s4.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s4.json','utf8'));const hits=(r.categories['eslint-d-series'].findings||[]).filter(f=>f.file==='pforge-mcp/server/tool-handlers/platform.mjs'&&f.ruleId==='clean-code/complexity-error');if(hits.length>0)throw new Error('platform.mjs complexity-error not resolved: '+hits.length+' hit(s) at lines '+hits.map(h=>h.line).join(','));if(r.summary.totalErrors>1)throw new Error('expected error count to drop to 1 after S4; got '+r.summary.totalErrors);console.log('ok S4 audit gate; errors:'+r.summary.totalErrors);"
bash -c "cd pforge-mcp && npx vitest run tests/server-surface-snapshot.test.mjs tests/clean-code-no-regression.test.mjs"
```

### Slice 5 — Frozen-arrays drift cleanup in `pforge-mcp/notifications/core.mjs`

- **Depends On**: S4.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/notifications/core.mjs` (6 hits across 4 source lines: 415 ×2, 463, 508, 515 ×2 — all four lines confirmed by audit at `kind: SOFT-DRIFT, severity: info`), `pforge-mcp/enums.mjs` (frozen `ERROR_CODES` array).
- **Traces to**: Resolved Decisions #8, #13.
- **Scope** (files in scope):
  - `pforge-mcp/notifications/core.mjs`
- Add `import { ERROR_CODES } from "../enums.mjs";` at top of file (path verified during hardening).
- Replace at each site:
  - **L415**: `err.message === "TIMEOUT" ? "TIMEOUT" : ...` → `err.message === ERROR_CODES.TIMEOUT ? ERROR_CODES.TIMEOUT : ...`
  - **L463**: `new Error("TIMEOUT")` → `new Error(ERROR_CODES.TIMEOUT)`
  - **L508**: `new Error("TIMEOUT")` → `new Error(ERROR_CODES.TIMEOUT)`
  - **L515**: `err.message === "TIMEOUT" ? "TIMEOUT" : ...` → `err.message === ERROR_CODES.TIMEOUT ? ERROR_CODES.TIMEOUT : ...`
- Leave any unrelated `"TIMEOUT"` string literals (log messages, dashboard labels) alone — only error-code positions get replaced.
- **Validation Gate**:
```bash
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s5.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s5.json','utf8'));const hits=(r.categories['frozen-arrays-drift'].findings||[]).filter(f=>f.file==='pforge-mcp/notifications/core.mjs'&&f.literal==='TIMEOUT');if(hits.length>0)throw new Error('TIMEOUT literal still present: '+hits.length+' hits');console.log('ok S5 frozen-arrays drift cleared in notifications/core.mjs');"
bash -c "cd pforge-mcp && npx vitest run tests/notifications tests/clean-code-no-regression.test.mjs"
```

### Slice 6 — SKIP-LEAK triage (6 sites)

- **Depends On**: S5.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/tests/forge-master.advisory.test.mjs` (lines 31, 54, 120, 150), `pforge-mcp/tests/cost-service-real-plans.test.mjs:48`, `pforge-mcp/tests/enums.test.mjs:86`.
- **Traces to**: Resolved Decisions #9, #13.
- **Scope** (files in scope):
  - `pforge-mcp/tests/forge-master.advisory.test.mjs`
  - `pforge-mcp/tests/cost-service-real-plans.test.mjs`
  - `pforge-mcp/tests/enums.test.mjs`
- For each `.skip(` site, decide and apply:
  - **Re-enable** if the test is sound and the reason for skipping is gone.
  - **Delete** if the test is obsolete or the surface it tests is gone.
  - **Convert to `it.todo("description")`** AND file a tracked issue via `forge_bug_file` with title `Test re-enable: <file>:<line>`.
- Default: `it.todo` + issue.
- **Validation Gate**:
```bash
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s6.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s6.json','utf8'));const skipLeaks=(r.categories['test-smells'].findings||[]).filter(f=>f.smell==='SKIP-LEAK');if(skipLeaks.length>0)throw new Error('SKIP-LEAK findings remain: '+skipLeaks.length);console.log('ok S6 SKIP-LEAK cleared');"
bash -c "cd pforge-mcp && npx vitest run tests/forge-master.advisory.test.mjs tests/cost-service-real-plans.test.mjs tests/enums.test.mjs tests/clean-code-no-regression.test.mjs"
```

### Slice 7 — Resolve dep-boundary violation `server/state.mjs → pforge-master/src/mcp-client.mjs`

- **Depends On**: S6.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server/state.mjs:121`, `pforge-master/src/mcp-client.mjs`, `scripts/audit/layer-policy.json`, `scripts/audit/dep-boundaries.mjs`.
- **Traces to**: Resolved Decisions #10, #13.
- **Scope** (files in scope):
  - `pforge-mcp/server/state.mjs`
  - `scripts/audit/layer-policy.json`
  - (optionally) `pforge-mcp/<shared>.mjs` if refactor path is chosen
- Hardener inspects the import context and picks one path:
  - **Whitelist path**: add an entry to `scripts/audit/layer-policy.json` allowing `pforge-mcp/server/state.mjs → pforge-master/src/mcp-client.mjs`, AND add an inline comment in `state.mjs` justifying the cross-package dependency.
  - **Refactor path**: move the shared logic from `pforge-master/src/mcp-client.mjs` into a new shared module both packages import (e.g. `pforge-mcp/<shared-mcp-client.mjs>`), or refactor `state.mjs` to not need the cross-package import.
- Default: whitelist with justification (RD #10).
- **Validation Gate**:
```bash
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-s7.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-s7.json','utf8'));const hits=(r.categories['dep-boundaries'].findings||[]).filter(f=>f.kind==='NEEDS-WHITELIST');if(hits.length>0)throw new Error('dep-boundary still NEEDS-WHITELIST: '+hits.length);console.log('ok S7 dep-boundary resolved');"
bash -c "cd pforge-mcp && npx vitest run tests/clean-code-no-regression.test.mjs"
```

### Slice 8 — Triage `update-from-github-shell.test.mjs:92` preexisting failure

- **Depends On**: S7.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/tests/update-from-github-shell.test.mjs:90-95`, `pforge-mcp/update-from-github.mjs`, `pforge-mcp/tests/fixtures/update-from-github/`.
- **Traces to**: Resolved Decisions #11, #13.
- **Scope** (files in scope):
  - `pforge-mcp/tests/update-from-github-shell.test.mjs`
  - (if fix path) `pforge-mcp/update-from-github.mjs`
- Investigate the `audit appends log entry from stdin` failure. The assertion at line 92 (`expect(existsSync(logPath)).toBe(true)`) implies the audit log file at `<TMP_DIR>/.forge/update-audit.log` is not being created.
- Timebox: 2 hours. If a fix is identified within timebox, ship it. Otherwise:
  1. Convert the failing `it(` to `it.skip(` with a comment pointing at the issue.
  2. File a `forge_meta_bug_file` with class `orchestrator-defect` describing the failure and the timebox decision.
- Either path must leave the full vitest suite green.
- **Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/update-from-github-shell.test.mjs"
bash -c "cd pforge-mcp && npx vitest run"
node -e "const fs=require('fs');const src=fs.readFileSync('pforge-mcp/tests/update-from-github-shell.test.mjs','utf8');const fixedOrSkipped=/it\.skip\([^)]*audit appends log entry|it\([^)]*audit appends log entry/.test(src);if(!fixedOrSkipped)throw new Error('test neither fixed nor skipped — neither it() nor it.skip() found for audit-log assertion');console.log('ok S8');"
```

### Slice 9 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0–S8 all green.
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-53-ORCHESTRATOR-SPLIT-retro.md` (retro pattern reference), `docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json`, the eight per-slice audit reports `clean-code-review-s{1..8}.json`.
- **Traces to**: Resolved Decisions #15.
- **Scope** (files in scope):
  - `docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md` (NEW)
  - `docs/plans/DEPLOYMENT-ROADMAP.md`
  - `CHANGELOG.md`
- Retro must include:
  - Before/after audit-report metrics (errors: 4 → 0 target; warnings delta per category).
  - Per-slice notes (LOC dropped for S1/S2; complexity dropped for S3/S4; literal counts for S5; skip dispositions for S6; whitelist-vs-refactor choice for S7; fix-vs-skip choice for S8).
  - Boy-Scout warning-count improvements observed but not in scope.
  - Follow-on recommendations for the bulk-advisory categories explicitly deferred from this phase (TIME-FLAKE regex fix, dead-exports report bug, complexity-warn sweep).
- Move Phase 55 from Active to Completed in DEPLOYMENT-ROADMAP.
- Append `[Unreleased] → Changed` CHANGELOG entry: "Phase 55 — eliminated all 4 clean-code blocking errors; details in retro."
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md','docs/plans/DEPLOYMENT-ROADMAP.md','CHANGELOG.md'])if(!fs.existsSync(f))throw new Error('missing: '+f);const retro=fs.readFileSync('docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md','utf8');if(!/baseline|errors.*4|complexity-error/i.test(retro))throw new Error('retro missing key sections');const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!rm.includes('55 — CLEAN-CODE-SWEEP'))throw new Error('Phase 55 not in roadmap');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!/Phase 55|CLEAN-CODE-SWEEP/i.test(cl))throw new Error('CHANGELOG entry missing');console.log('ok S9');"
node scripts/audit/clean-code-review.mjs --out docs/plans/cleanup-findings/raw/clean-code-review-final-phase-55.json
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('docs/plans/cleanup-findings/raw/clean-code-review-final-phase-55.json','utf8'));if(r.summary.totalErrors>0)throw new Error('final audit reports '+r.summary.totalErrors+' errors; expected 0');console.log('ok S9 final audit GREEN; errors:0 warnings:'+r.summary.totalWarnings);"
```

---

## Acceptance Criteria

- **MUST**: Baseline audit fixture `docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json` exists, is checked in, and contains `summary.totalErrors == 4` (S0).
- **MUST**: `pforge-mcp/tests/clean-code-no-regression.test.mjs` exists and asserts no new errors appear vs baseline (S0).
- **MUST**: `pforge-mcp/orchestrator/run-plan.mjs` is <3,000 LOC after S1.
- **MUST**: `pforge-mcp/orchestrator/run-plan/` subfolder exists with at least the four planned sub-modules (S1).
- **MUST**: `pforge-mcp/server/rest-api.mjs` is <3,000 LOC after S2.
- **MUST**: `pforge-mcp/server/rest-api/` subfolder exists with at least two route-group sub-modules (S2).
- **MUST**: Frozen surface snapshots from Phases 52/53 remain byte-identical throughout S1 and S2.
- **MUST**: `searchLocalThoughts` no longer reports `clean-code/complexity-error` after S3.
- **MUST**: `_callToolHandler` (or its decomposed dispatch) no longer reports `clean-code/complexity-error` after S4.
- **MUST**: Zero `frozen-arrays-drift` findings for `pforge-mcp/notifications/core.mjs` after S5.
- **MUST**: Zero `SKIP-LEAK` test-smell findings after S6.
- **MUST**: Zero `dep-boundaries / NEEDS-WHITELIST` findings after S7.
- **MUST**: `update-from-github-shell.test.mjs` is either passing or `it.skip` with a tracked issue after S8.
- **MUST**: Final `node scripts/audit/clean-code-review.mjs` reports `summary.totalErrors == 0` after S9.
- **MUST**: No public export, MCP tool surface, or CLI command added or removed.
- **MUST**: `docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md` written and committed in S9.
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` lists Phase 55 in Completed by end of S9.
- **MUST**: `CHANGELOG.md` `[Unreleased] → Changed` entry added in S9.
- **MUST**: `lockHash` in plan frontmatter matches at run time.
- **SHOULD**: Warning-count reductions in the same files as the targeted errors be documented in the retro as Boy-Scout improvements.
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before Phase 55 is promoted to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + baseline-vs-current audit state at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm baseline fixture exists, parses, and `summary.totalErrors == 4`. Confirm `tests/clean-code-no-regression.test.mjs` passes (current report equals baseline). |
| **S1** | Re-read §"Forbidden Actions". Confirm only files inside `pforge-mcp/orchestrator/run-plan/` and the parent `run-plan.mjs` changed. Snapshot fixture from Phase 53 is byte-identical. Audit error count is still ≤4. |
| **S2** | Re-read §"Forbidden Actions". Confirm only files inside `pforge-mcp/server/rest-api/` and the parent `rest-api.mjs` changed. Snapshot fixture from Phase 52 is byte-identical. Audit error count dropped to 3. |
| **S3** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/local-recall.mjs` changed. `searchLocalThoughts` signature byte-identical. Audit error count dropped to 2. |
| **S4** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/server/tool-handlers/platform.mjs` changed. `_callToolHandler` signature byte-identical. Audit error count dropped to 1. |
| **S5** | Re-read §"Forbidden Actions". Confirm only `pforge-mcp/notifications/core.mjs` changed. All `"TIMEOUT"` literals at error-code sites now reference `ERROR_CODES.TIMEOUT`. |
| **S6** | Re-read §"Forbidden Actions". Confirm only the three test files changed. Every `.skip(` site now either runs, is deleted, or is `it.todo(` with a tracked issue. |
| **S7** | Re-read §"Forbidden Actions". Confirm whitelist path: only `scripts/audit/layer-policy.json` and `pforge-mcp/server/state.mjs` changed (justification comment added). OR confirm refactor path: shared module added and both consumers updated. |
| **S8** | Re-read §"Forbidden Actions". Confirm `update-from-github-shell.test.mjs` is either passing or skipped with a tracked issue. Full vitest suite green. |
| **S9** | Confirm roadmap promotion, retro, CHANGELOG entry, and final audit (`totalErrors == 0`) all complete. |

---

## Definition of Done

- [ ] All 10 execution slices (S0–S9) committed individually with conventional-commit messages.
- [ ] All slice validation gates green.
- [ ] All Re-anchor Checkpoints passed.
- [ ] Final `node scripts/audit/clean-code-review.mjs` reports `summary.totalErrors == 0`.
- [ ] Frozen surface snapshots from Phases 52/53 unchanged.
- [ ] `pforge-mcp/orchestrator/run-plan.mjs` and `pforge-mcp/server/rest-api.mjs` both <3,000 LOC.
- [ ] `searchLocalThoughts` and `_callToolHandler` no longer report `complexity-error`.
- [ ] Zero `frozen-arrays-drift` in `notifications/core.mjs`, zero `SKIP-LEAK`, zero `dep-boundaries/NEEDS-WHITELIST` findings.
- [ ] `update-from-github-shell` test green OR skipped-with-issue.
- [ ] Full `pforge-mcp` test suite passes.
- [ ] `docs/plans/testbed-findings/Phase-55-CLEAN-CODE-SWEEP-retro.md` written.
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` lists Phase 55 in Completed.
- [ ] `CHANGELOG.md` `[Unreleased] → Changed` entry added.
- [ ] Reviewer Gate passed (zero 🔴 Critical findings).
- [ ] `lockHash` in plan frontmatter matches at run time.

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Audit-report error count increases vs baseline at any slice** | A change introduced a new blocking violation. | Roll back the slice; diff the new report against baseline; identify and fix the regression before retrying. |
| **Frozen surface snapshot from Phase 52 or 53 changes** | Public surface drift — out of scope for a cleanup phase. | Roll back; the split should not have surfaced a new export. Re-scope the extraction. |
| **Snapshot or no-regression test fails twice on the same slice** | Re-export wiring is broken or contract drifted. | Roll back, diff the actual vs expected surface, fix and retry once more. |
| **A targeted `complexity-error` does not drop after its dedicated slice** | Decomposition did not reduce complexity below threshold. | Re-attempt the decomposition with finer-grained helper extraction; do not advance to the next slice. |
| **`<3000` LOC target missed for run-plan.mjs or rest-api.mjs** | Insufficient extraction. | Identify another extractable section seam and add a sub-slice; do not advance with the file over threshold. |
| **A file outside slice scope is modified** | Scope-contract violation. | Revert the stray change; the extraction pattern is specifically designed to avoid consumer edits. |
| **Public export, MCP tool, or CLI command added or removed** | Surface-diff violation — out of scope for cleanup. | Roll back the slice; this phase has zero consumer impact by contract. |
| **S8 timebox exceeded without a fix AND without a skip+issue commit** | Phase is blocked on one test. | Apply the skip+issue default per RD #11 and proceed; do not let one test halt the phase indefinitely. |
| **New circular import introduced** | Cycle debt regrows after Phase 53 cleared it. | Roll back the slice; route the dependency through a leaf/helper module. |
| **Audit script bug surfaces during the phase** | Audit signal becomes unreliable. | Halt the phase; file a meta-bug; resume only after the audit script is fixed and the baseline is regenerated under the corrected script. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| Audit gate fails once after a complexity decomposition | Retry once after additional helper extraction. |
| Audit gate fails twice on the same slice | Halt per Stop Conditions. |
| Snapshot gate fails once | Retry once after re-reading slice instructions and verifying re-export wiring. |
| Snapshot gate fails twice | Halt per Stop Conditions. |
| Targeted unit test fails | Halt and verify the moved symbol's export signature and import path. |
| Full suite has a likely unrelated flake | Re-run once. If the same test fails twice, treat as real. |
| LOC target missed by ≤50 LOC | Identify one additional extractable helper and retry the slice once. |
| LOC target missed by >50 LOC | Halt; the section-banner seams need re-planning before retry. |

---

## Notes for the Hardener

- **Sharpen line ranges** for S1 (`run-plan.mjs` section banners), S3 (`searchLocalThoughts` body extent), and S4 (`_callToolHandler` body extent) immediately before locking the hash.
- **Compute `lockHash`** and replace `TBD` in the frontmatter.
- **Survey `rest-api.mjs`** for natural route-group seams (look for `app.get` / `app.post` clusters or per-feature comments) and tighten S2's planned sub-module list. Default plan assumes ≥2 groups; bump to 3–4 if the file structure naturally divides further.
- **Verify the baseline audit count** by running `node scripts/audit/clean-code-review.mjs --out <tmp>.json` once before hardening and confirming `summary.totalErrors == 4`. If the count has drifted (someone else's commit fixed or introduced an error), update RD #14 to match reality and adjust the S2/S3/S4 expected-drop targets.
- **Confirm the audit baseline matches** what the `/clean-code-review` skill run produced on 2026-05-19 (4 errors: 2 module-size, 2 complexity-error). If categories shift, the slice-to-error mapping needs to follow.
- **Verify the dep-boundary** in S7 is still a single finding (`server/state.mjs:121 → pforge-master/src/mcp-client.mjs`). If a second one appeared, expand S7 scope or split into S7a/S7b.
- **Preserve the locked S0–S9 slice ordering**; only line ranges and the rest-api sub-module list may sharpen.
- **Do NOT bundle slices**. Each slice is a single commit, individually validated.
- **The bulk-advisory deferrals are intentional** — TIME-FLAKE (402), CONSOLE-LEAK (25), complexity-warn (305), dead-exports (678) are out of scope here. A follow-up plan (Phase 56?) should address the audit-script tuning that would make those signals reliable before sweeping.
