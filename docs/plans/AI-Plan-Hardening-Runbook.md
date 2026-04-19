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

## Teardown / Cleanup Slices

> ⚠️ **Branch-Safety Warning (v2.49.1+)**
>
> Slices whose titles begin with `teardown`, `cleanup`, `rollback`, `postmortem`,
> or `finalize` automatically trigger the Teardown Safety Guard. The guard:
>
> 1. **Captures a git baseline** (current branch, HEAD SHA, upstream) before
>    the slice worker spawns.
> 2. **Injects a pre-flight constraint** into the worker prompt forbidding
>    `git branch -d/-D`, `git push --delete`, `git reset --hard` against
>    protected refs, `git update-ref -d`, and status mutations to `abandoned`
>    in `.github/` or `docs/plans/` without explicit plan directives.
> 3. **Runs a post-slice branch-safety check** that verifies: (a) the local
>    branch ref still exists, (b) the baseline HEAD is still reachable, and
>    (c) the remote branch ref still exists (when an upstream was configured).
> 4. **Records a critical incident** (`teardown-branch-loss`) to
>    `.forge/incidents.jsonl` with reflog recovery data, and captures a
>    LiveGuard memory entry with tags `teardown`, `branch-loss`, `critical`
>    on any verification failure.
> 5. **Fails the slice** when `blockOnBranchLoss: true` (default), forcing
>    the executor to stop before subsequent slices run.
>
> **When writing teardown slices**, scope cleanup to cloud resources and
> scratch files the plan explicitly names. Never include branch deletion
> in a teardown slice unless the plan sets `allowBranchDelete: true` and
> operates on an ephemeral worktree.
>
> **Recovery** from a `teardown-branch-loss` incident: inspect the reflog
> tail in the incident record, then `git update-ref refs/heads/<branch> <sha>`
> to restore the baseline.
>
> **Disable per-project** (discouraged): set
> `orchestrator.teardownGuard.enabled: false` in `.forge.json`. Scope it
> narrower with `checkRemote: false` for detached/no-upstream contexts.
