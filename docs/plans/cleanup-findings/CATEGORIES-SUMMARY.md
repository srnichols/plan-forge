# Categories Summary — Phase 42 Clean-Code Audit

> Pivot view for planning remediation priority.
> Source: CATALOG.md (27 actionable findings across 6 categories)

---

| Category | Code | Findings | Total Occurrences | Severity | Recommended Action |
|----------|------|----------|-------------------|----------|--------------------|
| Module Size — high | A1–A3 | 3 | 3 files >3,000 LOC | high | Extract sub-modules; split by responsibility |
| Module Size — medium | B1–B8 | 8 | 8 files 1,000–3,000 LOC | medium | Monitor; extract when adding new features |
| Long Parameter Lists | C1–C7 | 7 | ~65 call sites | warn | Wrap positional args in options objects |
| ESLint Errors | D1–D3 | 3 | 130 rule violations | error | Fix before next release gate |
| ESLint Warnings | E1–E6 | 6 | 2,033 rule occurrences | warn | Batch-fix by rule; prioritise complexity & depth |
| Console.log Advisory | F1 | 1 | 136 occurrences | info | Audit for debug leakage; retain intentional CLI output |

---

## Finding counts by file (top 10)

| File | A/B | C | D | E | Total |
|------|-----|---|---|---|-------|
| pforge-mcp/server.mjs | A2 | C1 | — | multiple | high |
| pforge-mcp/orchestrator.mjs | A1 | C3, C4 | D1, D2 | multiple | high |
| pforge-mcp/hub.mjs | — | C2 | — | — | medium |
| pforge-mcp/capabilities.mjs | A3 | — | — | — | medium |
| pforge-mcp/memory.mjs | B1 | — | — | — | medium |
| pforge-mcp/tempering/bug-adapters/github.mjs | — | C5, C6, C7 | — | — | medium |
| pforge-mcp/tempering/classifier-issue.mjs | — | C6, C7 | — | — | low |
| pforge-mcp/cost-service.mjs | B2 | — | — | — | low |
| pforge-mcp/brain.mjs | B5 | — | — | — | low |
| pforge-mcp/bridge.mjs | B6 | — | — | — | low |

---

## Remediation priority order

1. **D-series (ESLint errors)** — blocking; fix first. Focus: `complexity-error` in orchestrator.mjs and server.mjs. → [`Phase-PROPOSED-D-ESLINT-ERRORS-STUB.md`](proposed-phases/Phase-PROPOSED-D-ESLINT-ERRORS-STUB.md)
2. **A-series (high module size)** — architectural debt; plan extraction as dedicated work items. → [`Phase-PROPOSED-A-MODULE-SIZE-STUB.md`](proposed-phases/Phase-PROPOSED-A-MODULE-SIZE-STUB.md)
3. **C-series (long params)** — medium effort; options-object refactor per function.
4. **E-series (ESLint warnings)** — high volume; batch-fix rule by rule starting with complexity-warn.
5. **B-series (medium module size)** — monitor; no immediate action required.
6. **F-series (console.log)** — audit for debug leakage in a single pass.

> **Active guardrails**: see `.github/instructions/clean-code.instructions.md` for actionable per-function, naming, and commenting rules derived from this catalog.
