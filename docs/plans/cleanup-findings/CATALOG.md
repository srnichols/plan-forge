# Findings Catalog — Phase 42 Clean-Code Audit

> Generated: 2026-05-19
> Source commit: `d30c5f19`
> Branch: `planning/main`

---

## Findings

| ID | Category | File(s) | Metric / Rule | Detail | Severity |
|----|----------|---------|---------------|--------|----------|
| A1 | Module Size — high | pforge-mcp/orchestrator.mjs | G14 LOC: 13,933 | Exceeds 3,000-LOC high threshold by 4.6× | high |
| A2 | Module Size — high | pforge-mcp/server.mjs | G14 LOC: 9,812 | Exceeds 3,000-LOC high threshold by 3.3× | high |
| A3 | Module Size — high | pforge-mcp/capabilities.mjs | G14 LOC: 3,294 | Exceeds 3,000-LOC high threshold (marginally) | high |
| B1 | Module Size — medium | pforge-mcp/memory.mjs | G14 LOC: 2,180 | Exceeds 1,000-LOC medium threshold | medium |
| B2 | Module Size — medium | pforge-mcp/cost-service.mjs | G14 LOC: 1,421 | Exceeds 1,000-LOC medium threshold | medium |
| B3 | Module Size — medium | pforge-mcp/tempering/runner.mjs | G14 LOC: 1,418 | Exceeds 1,000-LOC medium threshold | medium |
| B4 | Module Size — medium | pforge-mcp/tempering.mjs | G14 LOC: 1,258 | Exceeds 1,000-LOC medium threshold | medium |
| B5 | Module Size — medium | pforge-mcp/brain.mjs | G14 LOC: 1,244 | Exceeds 1,000-LOC medium threshold | medium |
| B6 | Module Size — medium | pforge-mcp/bridge.mjs | G14 LOC: 1,201 | Exceeds 1,000-LOC medium threshold | medium |
| B7 | Module Size — medium | pforge-master/src/reasoning.mjs | G14 LOC: 1,102 | Exceeds 1,000-LOC medium threshold | medium |
| B8 | Module Size — medium | pforge-mcp/crucible-import.mjs | G14 LOC: 1,049 | Exceeds 1,000-LOC medium threshold | medium |
| C1 | Long Param List | pforge-mcp/server.mjs | max-params: 6 args | `emitToolTelemetry` called with 6 positional args at 54 call sites; function signature should accept an options object | warn |
| C2 | Long Param List | pforge-mcp/hub.mjs | max-params: 6 args | `_deliverResponse` called with 6 args at 2 call sites (lines 394, 397) | warn |
| C3 | Long Param List | pforge-mcp/orchestrator.mjs | max-params: 6 args | `buildEstimate` called with 6 args (line 4495) | warn |
| C4 | Long Param List | pforge-mcp/orchestrator.mjs | max-params: 6 args | `_estimatePlan` called with 6 args (line 12956) | warn |
| C5 | Long Param List | pforge-mcp/tempering/bug-adapters/github.mjs | max-params: 6 args | `createIssueViaGh` called with 6 args at 2 call sites | warn |
| C6 | Long Param List | pforge-mcp/tempering/bug-adapters/github.mjs + classifier-issue.mjs | max-params: 7 args | `createIssueViaRest` / `createViaRest` called with 7 args at 3 call sites | warn |
| C7 | Long Param List | pforge-mcp/tempering/bug-adapters/github.mjs + classifier-issue.mjs | max-params: 6 args | `addComment` called with 6 args at 4 call sites | warn |
| D1 | ESLint Error | 52 files | clean-code/complexity-error | Cyclomatic complexity exceeds error threshold (>20); 119 violations | error |
| D2 | ESLint Error | 6 files | clean-code/max-lines-per-function-error | Function length exceeds error threshold (>300 lines); 9 violations | error |
| D3 | ESLint Error | 2 files | clean-code/max-params-error | Parameter count exceeds error threshold (>6); 2 violations | error |
| E1 | ESLint Warning | 116 files | no-magic-numbers | Inline numeric literals not assigned to named constants; 1,557 occurrences | warn |
| E2 | ESLint Warning | 89 files | clean-code/complexity-warn | Cyclomatic complexity exceeds warn threshold (>12); 298 occurrences | warn |
| E3 | ESLint Warning | 23 files | max-depth | Nesting depth exceeds threshold; 90 occurrences | warn |
| E4 | ESLint Warning | 36 files | clean-code/max-lines-per-function-warn | Function length exceeds warn threshold (>100 lines); 62 occurrences | warn |
| E5 | ESLint Warning | 10 files | clean-code/max-params-warn | Parameter count exceeds warn threshold (>4); 17 occurrences | warn |
| E6 | ESLint Warning | 6 files | (parse error / no rule) | Files that could not be fully parsed by ESLint; 9 messages | warn |
| F1 | Console.log Advisory | codebase-wide | grep-matrix | 136 `console.log` occurrences bulk-triaged; acceptable for CLI tool output but should be audited for debug leakage | info |

---

## Excluded findings

The following source categories were audited and produced **no actionable findings**:

| Source | Reason Excluded |
|--------|----------------|
| Code duplication (jscpd) | jscpd returned 0 duplicate blocks (min-tokens 75); no clone clusters detected |
| TODO / FIXME / HACK / XXX markers | grep-matrix found 0 occurrences across all scanned files |
| Commented-out code blocks | grep-matrix found 0 occurrences |
| Architecture — import cycles | madge scan returned `spawnSync npx.cmd EINVAL` on both scan roots (pforge-mcp, pforge-master); no cycle data produced. Re-run after resolving tool path on Windows. |
| Architecture — cross-layer imports | Same spawnSync error; excluded pending tool fix |
| Architecture — high fan-in / fan-out | Same spawnSync error; excluded pending tool fix |
