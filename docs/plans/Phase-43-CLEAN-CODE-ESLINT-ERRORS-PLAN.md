---
phase: 43
name: CLEAN-CODE-ESLINT-ERRORS
status: IN_PROGRESS
lockHash: TBD
---

# Phase 43 — CLEAN-CODE-ESLINT-ERRORS — resolve all ESLint error-severity clean-code violations

> **Status**: **IN PROGRESS — S0 shipped 2026-05-19**
> **Source**: Promoted from the Phase 42 Clean Code audit D-series findings. This phase is limited to behavior-preserving refactors that clear all ESLint error-severity violations: `clean-code/complexity-error`, `clean-code/max-lines-per-function-error`, and any residual `clean-code/max-params-error` drift.
> **Tracks**: `pforge-mcp/**`, `pforge-master/src/reasoning.mjs`, `docs/plans/DEPLOYMENT-ROADMAP.md`.
> **Primary proof**: zero ESLint error-severity findings from `node scripts/audit/run-eslint-clean-code.mjs` plus full green `vitest` suites in both `pforge-mcp` and `pforge-master`.
>
> **S0 complete (2026-05-19)**: Created `scripts/audit/run-eslint-clean-code.mjs` (CJS-safe ESLint runner for Node.js 24+) and integrated `eslint-d-series` category into `scripts/audit/clean-code-review.mjs`. Current baseline: 127 errors (119 D1, 8 D2, 0 D3).

---

## Scope Contract

### In Scope

- Pure structural refactors in existing production files to clear all D1–D3 error-severity violations.
- Local helper extraction inside the same file only.
- Early-return rewrites and branch/case extraction that preserve runtime behavior.
- Route-group extraction in `server/rest-api.mjs` and handler-group extraction in `server/tool-handlers.mjs`.
- Supporting documentation updates limited to this plan file and `docs/plans/DEPLOYMENT-ROADMAP.md`.

### Out of Scope

- Any user-visible behavior change, feature work, dependency changes, or new modules.
- Test-file edits.
- Auto-fix tooling (`eslint --fix`) or lint-rule threshold changes.
- Broad architecture splits beyond what is required to get each function under the configured lint thresholds.

### Forbidden Actions

- Do **not** change exported APIs, request/response shapes, or CLI flags.
- Do **not** move helpers into new files.
- Do **not** weaken lint thresholds.
- Do **not** touch unrelated failing/warn-only findings.
- Do **not** modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`.

---

## Execution Strategy

### Slice 0 — ESLint tooling integration ✅ Done (2026-05-19)
- Created `scripts/audit/run-eslint-clean-code.mjs` — CJS-safe runner using `spawnSync` to invoke `node_modules/eslint/bin/eslint.js`. Avoids ESM/ajv incompatibility under Node.js 24+. Saves structured JSON to `docs/plans/cleanup-findings/raw/eslint-report.json`.
- Updated `scripts/audit/clean-code-review.mjs` — added `run-eslint-clean-code` to the scripts array, added `eslint-d-series` category parsing D1/D2/D3 violations. Running `npm run audit:full` now reports all D-series errors.
- Updated baseline: 127 errors (119 D1, 8 D2, 0 D3) — D3 resolved by Phase 51/52 splits.

### Slice 1 — D2 small-file wins
- `pforge-mcp/capture-screenshots.mjs`
- `pforge-mcp/tempering/scanners/visual-diff.mjs`
- Validate with ESLint audit and focused/full tests.

### Slice 2 — `pforge-master/src/reasoning.mjs`
- Decompose `runTurn()` into helper-led phases: tool-call processing, response building, and loop/turn orchestration.
- Re-run ESLint audit and `pforge-master` tests.

### Slice 3 — `pforge-mcp/orchestrator.mjs`
- Decompose `runPlan()`, `executeSlice()`, and `selfTest()` into local helpers.
- Prefer seam-based extraction: setup, validation, gate execution, retries, artifact capture, and self-test groups.

### Slice 4 — remaining D2 large functions
- `pforge-mcp/tempering/runner.mjs`
- `pforge-mcp/server/rest-api.mjs`
- `pforge-mcp/server/tool-handlers.mjs`

### Slice 5 — D1 complexity sweep
- Resolve all remaining `clean-code/complexity-error` findings, prioritizing:
  1. `pforge-mcp/orchestrator.mjs`
  2. `pforge-mcp/server/rest-api.mjs`
  3. `pforge-mcp/cost-service.mjs`
  4. `pforge-mcp/tempering/runner.mjs`
  5. `pforge-mcp/bridge.mjs`
  6. `pforge-mcp/server/tool-handlers.mjs`
  7. all remaining one-off files

### Slice 6 — finalize
- Run `node scripts/run-eslint-audit.mjs` from repo root until it reports zero errors.
- Run full `vitest` suites in `pforge-mcp` and `pforge-master`.
- Update `docs/plans/DEPLOYMENT-ROADMAP.md` to move Phase 43 to Completed.
- Commit with: `fix(lint): resolve all ESLint error-severity violations (D1–D3) — Phase 43`

---

## Validation Commands

```powershell
Set-Location "E:\GitHub\Plan-Forge"
node scripts/audit/run-eslint-clean-code.mjs 2>&1

Set-Location "E:\GitHub\Plan-Forge\pforge-mcp"
npx vitest run 2>&1 | Select-Object -Last 20

Set-Location "E:\GitHub\Plan-Forge\pforge-master"
npx vitest run 2>&1 | Select-Object -Last 10
```

Success = ESLint error count `0` and both test suites green.
