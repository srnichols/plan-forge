# Phase PROPOSED-A: Extract High-Oversized Modules

> **Status**: STUB — not yet hardened  
> **Severity**: high (architectural debt)  
> **Source findings**: A1, A2, A3 (from `../CATALOG.md`)  
> **Next step**: Run `step2-harden-plan.prompt.md` to produce a full execution plan

---

## Problem Statement

Three files exceed the 3,000-LOC high threshold by a significant margin. Each represents a
single file that has accumulated multiple responsibilities and will grow harder to maintain,
test, and safely modify over time.

| Finding | File | LOC | Threshold | Factor |
|---------|------|-----|-----------|--------|
| A1 | `pforge-mcp/orchestrator.mjs` | 13,933 | 3,000 | 4.6× over |
| A2 | `pforge-mcp/server.mjs` | 9,812 | 3,000 | 3.3× over |
| A3 | `pforge-mcp/capabilities.mjs` | 3,294 | 3,000 | marginally over |

---

## Proposed Scope

### In-scope
- Identify responsibility clusters in each file (groups of related exports/functions)
- Extract each cluster into a focused sub-module under the same directory
- Update all import paths that reference the original file
- Ensure the original file re-exports extracted symbols for backward compatibility during transition
- Add/update unit tests for extracted modules

### Out-of-scope
- Medium-size files (B-series) — monitor only, no extraction required
- Business logic changes — extraction must be pure moves with no behavioral change
- API surface changes — `forge_*` tool signatures must not change

---

## Acceptance Criteria

- [ ] Each extracted file is ≤ 3,000 LOC
- [ ] No `forge_*` tool breaks (all MCP integration tests pass)
- [ ] `pforge smith` and `pforge check` pass after extraction
- [ ] All existing tests pass after extraction
- [ ] Commit message pattern: `refactor(modules): extract <cluster> from <original-file>`

---

## Recommended Extraction Order

1. **`orchestrator.mjs`** (A1 — highest priority, most over-threshold)  
   Likely clusters: plan parsing, slice execution, gate runner, cost/estimate logic, retry/recovery, audit trail writing.

2. **`server.mjs`** (A2 — second priority)  
   Likely clusters: tool handler registration, telemetry, WebSocket/SSE transport, dashboard routes.

3. **`capabilities.mjs`** (A3 — marginal, lowest priority)  
   Single-pass extraction may not be needed; re-evaluate after A1 and A2 are done.

---

## Effort Estimate (rough)

| Task | Estimated effort |
|------|-----------------|
| A1 — orchestrator.mjs extraction | Very large (4–6 slices, requires careful dependency mapping) |
| A2 — server.mjs extraction | Large (3–4 slices) |
| A3 — capabilities.mjs extraction | Small (1 slice, optional) |

---

## Hardening Checklist (complete before executing)

- [ ] Assign permanent phase number from `DEPLOYMENT-ROADMAP.md`
- [ ] Run `step1-preflight-check.prompt.md`
- [ ] Run dependency/import analysis on each target file before writing slices
- [ ] Run `step2-harden-plan.prompt.md` to produce full slice breakdown
- [ ] Confirm Forbidden Actions list (no behavioral changes, no API surface changes)
- [ ] Confirm D-series ESLint errors are resolved first (avoids compounding complexity violations)
- [ ] Confirm validation gates are runnable on both Windows and Linux
