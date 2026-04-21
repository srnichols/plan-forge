# BUG: Step-2 plan hardening doesn't validate bash gates against Windows shell shim

**Filed**: 2026-04-21
**Severity**: High — costs real money and wall-clock per occurrence
**Status**: Open
**Observed on**: Phase-28 (v2.61.0-dev), slices 4 and 7 both failed on gate quoting / piping issues despite correct code

---

## Symptom

Plans hardened by `step2-harden-plan.prompt.md` contain validation gates written as POSIX bash one-liners. On Windows, `pforge run-plan` invokes these via a `bash -c "..."` wrapper that routes through the cmd.exe → Git Bash shim. Several shell features that work in plain bash break or misbehave in that shim:

1. **Pipe-to-subshell variable capture** (bug repro'd in Phase-28 slice 4)
   ```bash
   grep -c 'pattern' file | tr -d '\n' | { read n; [ "$n" -ge 1 ] || exit 1; }
   ```
   The piped subshell runs in its own scope; `$n` isn't visible where the test evaluates, so it sees empty string and emits `/bin/bash: [: : integer expression expected`.

2. **Nested double-quoting through `bash -c "node -e \"...\""`** (bug repro'd in Phase-28 slice 7)
   ```bash
   bash -c "cd pforge-mcp && node -e \"import('./capabilities.mjs').then(m => { ... })\""
   ```
   The cmd.exe wrapper mangles the escaped inner quotes before handing to bash; bash sees an unbalanced string and emits `unexpected EOF while looking for matching "`. Then the residue of the command (`'{})'`) leaks back to cmd.exe which emits `is not recognized as an internal or external command`.

In both cases:
- The slice's **code work was correct** (commits landed, tests passed, tool was registered).
- Only the gate misreported failure.
- The orchestrator consumed 3 retry attempts with escalation before marking the slice failed.
- Real cost: ~$0.08 per false-failure slice.
- Real wall-clock: 15–25 minutes per retry loop.

## Why Step-2 should catch this

`step2-harden-plan.prompt.md` already covers "validation gates must be deterministic and fast." The gap is **portability**. The step doesn't enforce a rule like:

> Validation gates run on whatever host the operator launches `pforge run-plan` from. Plan Forge supports Windows, macOS, and Linux. Every gate MUST be valid on all three shells (`bash` on Linux/macOS, Git-Bash-via-cmd on Windows).

Specifically the step should either:
- **A. Prohibit patterns known to fail on the Windows shim**, namely:
  - Piping command output into a `{ read var; ... }` subshell to set variables
  - `bash -c "...\"...\""` (nested double quotes crossing shim boundaries)
  - `node -e "..."` or `python -c "..."` inline with double quotes in the expression
  - Heredocs (`<<EOF`) in gates
- **B. Require portable alternatives**:
  - `grep -q 'pattern' file || (echo 'missing' && exit 1)` instead of count-then-pipe-then-read
  - A tiny helper script (`.forge/gates/check-xxx.sh`) called from the gate instead of inline node/python
  - `python -m script` or `node script.mjs` with a standalone file
- **C. Dry-run gates on authoring host before landing the plan**:
  - Step-2 output must include a `## Gate Dry-Run` section showing each gate command prefixed with `# [DRY-RUN OK]` after a syntactic / no-effect execution.
  - Reject the plan if any gate cannot be dry-run cleanly.

## Proposed prompt changes

Add a new section to `step2-harden-plan.prompt.md`:

```markdown
## Gate Portability Checklist

Every Validation Gate MUST be portable across the three supported shells:
- bash (Linux, macOS)
- Git Bash via cmd.exe shim (Windows)
- MSYS2 / WSL bash (Windows alternative)

### Forbidden patterns (auto-reject plan if present)

| ❌ Don't | ✅ Do instead |
|---------|---------------|
| `grep -c X file \| tr -d '\n' \| { read n; [ "$n" -ge 1 ] \|\| exit 1; }` | `grep -q X file \|\| (echo 'missing' && exit 1)` |
| `bash -c "node -e \"...\""`  (nested double quotes) | Extract the node snippet to `.forge/gates/<name>.mjs` and call `node .forge/gates/<name>.mjs` |
| `python -c "import x; x.y(\"z\")"` | Same: move to `.forge/gates/<name>.py` |
| Heredocs inside `bash -c "..."` | Same: move to a standalone script |
| `$(...)` capture where output contains special characters | Use a script file |

### Required dry-run

Before emitting the hardened plan, run each gate command in a throwaway shell and verify:
- Exit code is deterministic (pass or known-fail, not syntax error)
- stderr does not contain `unexpected EOF`, `integer expression expected`, or `is not recognized as an internal or external command`
```

## Proposed retry-budget change (orthogonal but related)

Even with portable gates, if a gate fails for an external reason (network, missing dependency, etc.), the orchestrator currently burns 3 retries × 5 min = 15 min on identical failures. Propose:

> If `gate-failed` event fires twice in a row with identical `failedCommand` + identical `gateError`, emit `slice-failed` immediately and skip the third retry. Save the tokens.

## Related bugs

- `docs/bugs/BUG-api-xai-worker-text-only.md` — worker doesn't execute tool calls, produces narrative-only output.
- Together these two bugs mean Phase-28 burned 3 orchestrator sessions before slices 1–7 were actually done once. Both would have been caught by a proper Step-2 dry-run discipline.

## Repro artifacts

- Run 1 (grok-4.20, silent retry loop): `.forge/runs/2026-04-21T06-29-37-647Z_Phase-28-FORGE-MASTER-MVP-v2.61-PLAN/` — 38 min on slice 1, 0 slices completed.
- Run 2 (default, slice-4 gate bug): `.forge/runs/2026-04-21T07-14-03-232Z_Phase-28-FORGE-MASTER-MVP-v2.61-PLAN/` — 3 slices complete, slice 4 gate false-failure.
- Run 3 (default, slice-7 gate bug): `.forge/runs/2026-04-21T08-42-15-862Z_Phase-28-FORGE-MASTER-MVP-v2.61-PLAN/` — 2 slices complete, slice 7 gate false-failure.
- Fixes: `1e98512` (slice 4 gate), `078c9c3` (slice 7 gate).
