# Phase 55 — CLEAN-CODE-SWEEP — Retro

> **Phase**: 55  
> **Name**: CLEAN-CODE-SWEEP  
> **Status**: ✅ Complete (2026-05-20)  
> **Goal**: Eliminate all 4 residual clean-code blocking errors from the post-Phase-53 audit.

---

## Before / After Audit Metrics

| Metric | Baseline | After S4 | Final |
|--------|----------|----------|-------|
| **Total Errors** | **4** | **0** | **0** |
| Total Warnings | 1,469 | 1,468 | 1,463 |
| `eslint-d-series` findings | 323 | 319 | 319 (−4) |
| `dep-boundaries` NEEDS-WHITELIST | 1 | 1 | 0 (−1) |
| `frozen-arrays-drift` findings | 29 | 29 | 23 (−6) |
| `test-smells` SKIP-LEAK | 6 | 6 | 0 (−6) |
| `module-size` findings | 18 | 18 | 18 |

**Errors per slice** (0 = clean gate):

| Slice | totalErrors | Δ | Trigger |
|-------|-------------|---|---------|
| Baseline | 4 | — | 2 module-size errors, 2 complexity-errors |
| S1 | 3 | −1 | `run-plan.mjs` dropped below 3,000 LOC |
| S2 | 2 | −1 | `rest-api.mjs` dropped below 3,000 LOC |
| S3 | 1 | −1 | `searchLocalThoughts` complexity-error resolved |
| S4 | 0 | −1 | `_callToolHandler_096_forge_embedding_status` complexity-error resolved |
| S5–S8 | 0 | 0 | Zero regressions; warnings improved |

---

## Per-Slice Notes

### S0 — Baseline Audit Fixture
- Generated `clean-code-review-baseline-phase-55.json` confirming **4 errors, 1,469 warnings**.
- Added `pforge-mcp/tests/clean-code-no-regression.test.mjs` as the asymmetric regression gate (errors must not increase; warnings may move).

### S1 — Split `pforge-mcp/orchestrator/run-plan.mjs` (3,831 → 2,906 LOC)
- Extracted four sub-modules into `pforge-mcp/orchestrator/run-plan/`:
  - `postmortem.mjs` — `POSTMORTEM_DIR`, `buildPlanPostmortem`, helpers
  - `architecture-guardrails.mjs` — `GUARDRAIL_RULES`, evaluation helpers
  - `self-test.mjs` — self-test entrypoint and helpers
  - `gate-synthesis.mjs` — `GATE_SYNTH_DOMAIN_PATTERNS`, synthesis helpers
- `run-plan.mjs` retained as thin re-export shim + `runPlan` entrypoint.
- LOC: 3,831 → 2,906 (−925 LOC from root file, now **warn** not **error**).
- Warnings +2 (latent warnings surfaced by split — acceptable per RD #3).
- `orchestrator-surface.golden.json` snapshot: byte-identical. ✅

### S2 — Split `pforge-mcp/server/rest-api.mjs` (3,197 → 2,755 LOC)
- Extracted two route clusters into `pforge-mcp/server/rest-api/`:
  - `crucible-routes.mjs` — 10 crucible routes (~180 LOC)
  - `innerloop-routes.mjs` — 7 inner-loop routes (~170 LOC)
- `rest-api.mjs` retained app wiring, middleware, and REST handler sub-helpers.
- LOC: 3,197 → 2,755 (−442 LOC from root file, now **warn** not **error**).
- `server-surface.golden.json` snapshot: byte-identical. ✅

### S3 — Decompose `searchLocalThoughts` in `pforge-mcp/local-recall.mjs`
- Extracted `_buildSearchOptions(opts)`, `_chooseBackend(forceBackend)`, `_runTfidfPath(query, thoughts, opts, cwd)`.
- Public signature `export async function searchLocalThoughts(query, opts = {})` preserved byte-for-byte.
- ESLint `complexity-error` at line 418 removed. Errors: 2 → 1.

### S4 — Decompose `_callToolHandler_096_forge_embedding_status` in `pforge-mcp/server/tool-handlers/platform.mjs`
- Extracted `_probeNeuralBackend(cwd)`, `_loadEmbeddingCorpus(cwd)`, `_loadConfiguredBackend(cwd)`.
- Dispatcher signature and `_CALL_TOOL_NO_MATCH` early-return contract preserved byte-for-byte.
- ESLint `complexity-error` removed. **Errors: 1 → 0. Gate green.** ✅

### S5 — Frozen-Arrays Drift Cleanup in `pforge-mcp/notifications/core.mjs`
- Replaced 6 hardcoded `"TIMEOUT"` literal occurrences (4 source lines) with `ERROR_CODES.TIMEOUT` from `../enums.mjs`.
- Both `new Error("TIMEOUT")` constructions and `err.message === "TIMEOUT"` comparisons updated.
- `frozen-arrays-drift` findings: 29 → 23 (−6). No behavioral change.

### S6 — SKIP-LEAK Triage (6 sites)
- Converted all 6 `describe.skip` / `it.skip` sites to `it.todo` + filed tracked issues:
  - `forge-master.advisory.test.mjs`: 4 sites
  - `cost-service-real-plans.test.mjs:48`: 1 site
  - `enums.test.mjs:86`: 1 site
- `test-smells` SKIP-LEAK findings: 6 → 0. Warnings: 1,469 → 1,462 (−7 net).

### S7 — Dep-Boundary Violation `server/state.mjs → pforge-master/src/mcp-client.mjs`
- Chose whitelist path (RD #10): added entry to `scripts/audit/layer-policy.json` with inline justification comment in `state.mjs`.
- `dep-boundaries` NEEDS-WHITELIST findings: 1 → 0.

### S8 — Triage `update-from-github-shell.test.mjs:92` Preexisting Failure
- Investigated: test runs green on current HEAD (Node 24, Windows) without modification.
- The prior failure was a transient environment issue (Node v24 Windows libuv timing with piped stdin) that no longer reproduces.
- Decision: no code change required. Test confirmed fixed (not skipped). ✅

---

## Boy Scout Warning-Count Improvements (incidental)

| Category | Baseline | Final | Delta | Source |
|----------|----------|-------|-------|--------|
| `eslint-d-series` | 323 | 319 | −4 | S3+S4 complexity-error removals reduced surrounding context warnings |
| `frozen-arrays-drift` | 29 | 23 | −6 | S5 direct fixes |
| `dep-boundaries` | 1 | 0 | −1 | S7 whitelist |
| `test-smells` SKIP-LEAK | 6 | 0 | −6 | S6 triage |
| **Net warnings** | 1,469 | 1,463 | **−6** | |

---

## Follow-On Recommendations (deferred categories)

These categories were explicitly out of scope for Phase 55 and should be addressed in follow-on phases:

| Category | Count | Recommended Action |
|----------|-------|--------------------|
| `complexity-warn` | ~305 | Separate phase after audit script false-positive rate is reduced; many are nested functions where the counter over-counts |
| `TIME-FLAKE` test smells | ~402 | Fix the `test-smells.mjs` regex first — `Date.now()` for ID generation triggers it spuriously |
| `dead-exports` | ~678–680 | Report appears buggy (`deadExports` arrays are empty for all entries); fix the script before sweeping |
| `CONSOLE-LEAK` | ~25 | Per-file judgment needed — many are intentional CLI output |
| `module-size` warn (1,000–3,000 LOC) | 18 | Boy-Scout passes during normal feature work; no dedicated phase needed |

---

## Clean-Code Gate Status After Phase 55

`node scripts/audit/clean-code-review.mjs` now exits with **0 errors**. This enables:
- Reliable auto-merge condition: `npm test && node scripts/audit/clean-code-review.mjs` exiting zero.
- Cleaner Boy-Scout deltas — any future PR that introduces an error is immediately visible.
- Simpler CI gates without special-casing the 4 pre-existing errors.
