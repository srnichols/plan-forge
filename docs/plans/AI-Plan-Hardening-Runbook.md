# AI Plan Hardening Runbook

> **This document has been superseded.** The full runbook content now lives in executable form:
>
> - **Pipeline agents**: Select the Specifier agent → click through to Shipper
> - **Prompt templates**: .github/prompts/step0-*.prompt.md through step6-*.prompt.md
> - **Copy-paste version**: [AI-Plan-Hardening-Runbook-Instructions.md](AI-Plan-Hardening-Runbook-Instructions.md)
>
> The original 996-line runbook with full templates is preserved in git history (pre-v2.21).
> See [CHANGELOG.md](../../CHANGELOG.md) for the v2.21 Forge Anneal consolidation notes.

## Quick Reference

| Step | Prompt File | Pipeline Agent |
|------|------------|----------------|
| 0 — Specify | `step0-specify-feature.prompt.md` | Specifier |
| 1 — Pre-flight | `step1-preflight-check.prompt.md` | Plan Hardener |
| 2 — Harden | `step2-harden-plan.prompt.md` | Plan Hardener |
| 3 — Execute | `step3-execute-slice.prompt.md` | Executor |
| 4 — Sweep | `step4-completeness-sweep.prompt.md` | Executor |
| 5 — Review | `step5-review-gate.prompt.md` | Reviewer Gate |
| 6 — Ship | `step6-ship.prompt.md` | Shipper |
