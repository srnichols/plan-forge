# Phase 42 — CLEAN-CODE-AUDIT — Retrospective

> **Status**: Complete  
> **Completed**: 2026-05-19  
> **Plan**: [Phase-42-CLEAN-CODE-AUDIT-PLAN.md](../Phase-42-CLEAN-CODE-AUDIT-PLAN.md)

---

## What Was Found

The Phase 42 audit produced **27 actionable findings** across six categories by running five
dedicated tooling scripts against the Plan Forge codebase (excluding test files and
generated output):

| Category | Code | Findings | Occurrences | Severity |
|----------|------|----------|-------------|----------|
| Module Size — high | A1–A3 | 3 | 3 files > 3,000 LOC | high |
| Module Size — medium | B1–B8 | 8 | 8 files 1,000–3,000 LOC | medium |
| Long Parameter Lists | C1–C7 | 7 | ~65 call sites | warn |
| ESLint Errors | D1–D3 | 3 | 130 rule violations | **error** |
| ESLint Warnings | E1–E6 | 6 | 2,033 rule occurrences | warn |
| Console.log Advisory | F1 | 1 | 136 occurrences | info |

The highest-impact files were `pforge-mcp/orchestrator.mjs` (13,933 LOC — A1, D1, D2) and
`pforge-mcp/server.mjs` (9,812 LOC — A2, D1). These two files account for the majority of
complexity violations, function-length violations, and module-size debt in the codebase.

The D-series ESLint errors (130 violations — primarily `complexity-error` across 52 files) are
the most urgent finding: they are blocking and must be resolved before the next release gate.

The F-series `console.log` advisory (136 occurrences) was deliberately bulk-triaged as a
single finding rather than 136 individual items. The rationale: Plan Forge is a CLI tool and
intentional CLI output via `console.log` is a legitimate pattern. The audit recommended a
single-pass audit for debug leakage rather than treating every occurrence as a defect.

---

## What Got Promoted

Two phase stubs were generated from the catalog and added to the DEPLOYMENT-ROADMAP:

| Phase | Stub | Priority |
|-------|------|----------|
| **Phase 43 — CLEAN-CODE-ESLINT-ERRORS** | `Phase-PROPOSED-D-ESLINT-ERRORS-STUB.md` | blocking (D-series first) |
| **Phase 44 — CLEAN-CODE-MODULE-EXTRACTION** | `Phase-PROPOSED-A-MODULE-SIZE-STUB.md` | architectural (after D-series) |

The remaining categories (B-series, C-series, E-series, F-series) were documented in the
catalog but not promoted to immediate phase stubs:
- **B-series**: monitor-only — no extraction required until a new feature touches the file.
- **C-series**: medium effort; will be addressed opportunistically within Phase 43 or 44 slices
  where overlap with D3 (max-params) exists.
- **E-series**: high volume (2,033 occurrences); batch-fix after D-series is clear.
- **F-series**: single-pass audit recommended; no dedicated phase needed.

---

## Friction in Triage

**AST walker dependency** — `long-param-walker.mjs` required `@babel/parser` to walk
function ASTs. This added an audit-time devDependency that must not leak into production
dependencies. Future audit refreshes should confirm the devDependency scope is preserved.

**Workspace separation** — The audit covered both the `pforge-mcp` and `pforge-master`
workspaces. Because ESLint configs can differ per workspace, audit reports were separated by
workspace (`eslint-report-mcp.json` / `eslint-report-master.json`) to avoid masking
workspace-specific violations. This distinction should be maintained in future audits.

**CLI script coverage gap** — `pforge.ps1` (6,746 LOC) and `pforge.sh` (5,985 LOC) are the
two largest files in the repository and ESLint cannot touch them. No tooling exists today to
measure complexity or function length in PowerShell or Bash scripts. These files are
explicitly acknowledged as a coverage gap; a future audit phase should evaluate
`PSScriptAnalyzer` (PowerShell) and `shellcheck` + `bash-metrics` (Bash) as candidate tools.

**Phase 41 ENUMS baseline comparison** — Phase 41 shipped enum centralization that should
have reduced jscpd duplication. The audit compared the post-ENUMS duplication report but did
not have a pre-ENUMS baseline from Phase 41 to quantify the reduction. Future audits should
emit a duplication baseline snapshot at the *start* of any large refactor so the impact can
be measured at retro time.

---

## Audit-Frequency Recommendation

Given the rate of feature development in Plan Forge (3–4 phases per sprint), the following
cadence is recommended:

| Check | Frequency | Tool |
|-------|-----------|------|
| ESLint errors (D-series) | Every release gate — already gated by CI | `eslint-audit.mjs` |
| Module size (A/B-series) | Quarterly or after any phase that adds > 500 LOC to an existing file | `module-metrics.mjs` |
| Duplication (jscpd) | After any large refactor phase | `duplication-audit.mjs` |
| Long params (C-series) | Semi-annually, or when adding new public functions with ≥4 args | `long-param-walker.mjs` |
| Console.log (F-series) | On demand, before a major release | `grep-matrix.mjs` |

A full audit of all six categories (as done in Phase 42) is recommended **annually** or
whenever a new major architectural change lands (e.g., new workspace, new tool surface tier).

---

## Key Artifacts

| Artifact | Path |
|----------|------|
| Raw ESLint report | `docs/plans/cleanup-findings/raw/eslint-report.json` |
| Raw duplication report | `docs/plans/cleanup-findings/raw/duplication-report.json` |
| Raw module metrics | `docs/plans/cleanup-findings/raw/module-metrics.json` |
| Raw grep matrix | `docs/plans/cleanup-findings/raw/grep-matrix-report.json` |
| Raw long-param report | `docs/plans/cleanup-findings/raw/long-param-report.json` |
| Run context | `docs/plans/cleanup-findings/raw/RUN-CONTEXT.md` |
| Full catalog (27 findings) | `docs/plans/cleanup-findings/CATALOG.md` |
| Category pivot | `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` |
| Phase-43 stub | `docs/plans/cleanup-findings/proposed-phases/Phase-PROPOSED-D-ESLINT-ERRORS-STUB.md` |
| Phase-44 stub | `docs/plans/cleanup-findings/proposed-phases/Phase-PROPOSED-A-MODULE-SIZE-STUB.md` |
