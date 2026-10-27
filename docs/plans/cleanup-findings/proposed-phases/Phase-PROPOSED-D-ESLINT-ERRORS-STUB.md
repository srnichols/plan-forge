# Phase PROPOSED-D: Fix ESLint Errors (Blocking)

> **Status**: STUB — not yet hardened  
> **Severity**: error (blocking — fix before next release gate)  
> **Source findings**: D1, D2, D3 (from `../CATALOG.md`)  
> **Next step**: Run `step2-harden-plan.prompt.md` to produce a full execution plan

---

## Problem Statement

The Phase 42 audit identified **130 ESLint rule violations at error severity** across three
finding codes. These are blocking findings — they must be resolved before the next release gate.

| Finding | Rule | Scope | Violations |
|---------|------|-------|------------|
| D1 | `clean-code/complexity-error` | 52 files | 119 violations — cyclomatic complexity > 20 |
| D2 | `clean-code/max-lines-per-function-error` | 6 files | 9 violations — function length > 300 lines |
| D3 | `clean-code/max-params-error` | 2 files | 2 violations — parameter count > 6 |

**Highest-impact files**: `pforge-mcp/orchestrator.mjs` (D1, D2), `pforge-mcp/server.mjs` (D1).

---

## Proposed Scope

### In-scope
- Fix all D1 complexity violations by extracting sub-functions or simplifying control flow
- Fix all D2 function-length violations by splitting long functions into smaller, named helpers
- Fix all D3 max-params violations by wrapping positional args in options objects
- Run `npm run lint` (or equivalent) after each fix batch to confirm zero error-severity violations
- Add or update unit tests for any refactored functions

### Out-of-scope
- ESLint warnings (E-series) — separate phase
- Module size extraction (A-series) — separate phase
- Long-param refactors already tracked under C-series — consolidate if overlap is found

---

## Acceptance Criteria

- [ ] `eslint --max-warnings 0` exits 0 for all D-series rules across the codebase
- [ ] No new complexity violations introduced during refactor
- [ ] All existing tests pass after refactor
- [ ] Commit message: `fix(lint): resolve all ESLint error-severity violations (D1–D3)`

---

## Effort Estimate (rough)

| Task | Estimated effort |
|------|-----------------|
| D1 — 119 complexity violations across 52 files | Large (3–5 slices) |
| D2 — 9 function-length violations across 6 files | Small (1 slice) |
| D3 — 2 max-params violations across 2 files | Trivial (part of C-series slice) |

---

## Hardening Checklist (complete before executing)

- [ ] Assign permanent phase number from `DEPLOYMENT-ROADMAP.md`
- [ ] Run `step1-preflight-check.prompt.md`
- [ ] Run `step2-harden-plan.prompt.md` to produce full slice breakdown
- [ ] Confirm Forbidden Actions list (no accidental module extractions in this phase)
- [ ] Confirm validation gates are runnable on both Windows and Linux
