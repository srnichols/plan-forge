---
description: AI Plan Hardening Runbook quick reference — auto-loads when editing plan files
applyTo: 'docs/plans/**'
priority: HIGH
---

# Plan Forge — Quick Reference

> **Full Runbook**: [AI-Plan-Hardening-Runbook.md](../../docs/plans/AI-Plan-Hardening-Runbook.md)  
> **Step-by-Step**: [AI-Plan-Hardening-Runbook-Instructions.md](../../docs/plans/AI-Plan-Hardening-Runbook-Instructions.md)

## Pipeline Summary

```
SESSION 1 → Harden (scope contract, execution slices, validation gates)
SESSION 2 → Execute (slice-by-slice, commit after each) + Completeness Sweep
SESSION 3 → Review & Audit (fresh agent, read-only, drift detection)
```

## Key Concepts

- **3 separate sessions**: Harden, Execute, Review (prevents context bleed)
- **6 Mandatory Blocks**: Scope Contract, Required Decisions, Execution Slices, Re-anchor, Definition of Done, Post-Mortem
- **Validation after every slice**: Build + test must pass before moving on
- **Re-anchor after every slice**: Re-read Scope Contract to prevent drift
- **Stop on ambiguity**: Never guess — ask

## When Editing Plan Files

- Every `*-PLAN.md` must contain all 6 Mandatory Template Blocks
- Execution slices should be 30-120 minutes each
- Each slice needs at least one concrete validation gate
- Tag slices `[parallel-safe]` or `[sequential]`
- Include `Context Files` per slice (especially `.github/instructions/*.instructions.md`)
- **Never nest escaped double-quotes inside `bash -c "..."`** (meta-bug [#93](https://github.com/srnichols/plan-forge/issues/93)).
  On Windows `cmd → bash`, three-level escapes like `bash -c "grep -q onclick=\\\"foo\\\" file"` collapse with
  `/bin/bash: -c: line 1: unexpected EOF while looking for matching quote`. Use single quotes inside (`'foo'`),
  switch to a `node -e` one-liner using `.includes()`, or rely on a vitest test that already proves the
  presence/absence. The full Gate Portability Rules live in `step2-harden-plan.prompt.md`.
