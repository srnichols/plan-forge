# scripts/

Helper scripts for Plan Forge orchestration, sequencing, and diagnostics.

---

## Sequencer Scripts

The sequencer family chains `pforge run-plan` invocations so that Plan B
automatically kicks off when Plan A finishes cleanly — with no human
intervention between runs.

### Files

| File | Purpose |
|------|---------|
| `sequence-plans.ps1` | PowerShell sequencer — watches an in-flight orchestrator, then dispatches the next plan |
| `sequence-plans.psm1` | Shared PowerShell module with `Get-CurrentOrchestratorPid`, `Test-OrchestratorAlive`, `Get-LatestRunDir`, `Get-RunStatus` |
| `sequence-plans.sh` | Bash equivalent of `sequence-plans.ps1` (Linux/macOS) |
| `sequence-hotfix-series.ps1` | One-shot multi-stage sequencer used for the v2.90.x hotfix series |
| `tests/sequence-plans.tests.ps1` | Pester unit tests for the sequencer module |

---

### Usage — PowerShell

```powershell
pwsh -NoProfile -File scripts/sequence-plans.ps1 `
  -NextPlan docs/plans/Phase-GITHUB-D-METRICS-LEADERBOARD-PLAN.md `
  -Model claude-sonnet-4.6 `
  -Reason "Phase D follows Phase B"
```

**Parameters**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-NextPlan` | ✅ | — | Path to the plan file to dispatch next |
| `-Model` | | `claude-sonnet-4.6` | Model to use for the next run |
| `-Reason` | | `Sequenced plan run` | Import reason recorded on the run |
| `-RepoRoot` | | `(Get-Location)` | Path to the repository root |
| `-PollSeconds` | | `60` | How often to poll the orchestrator PID |
| `-MaxWaitMinutes` | | `240` | Maximum time (minutes) to wait before giving up |
| `-SkipCommitPush` | | off | Skip the `git add -A / commit / push` step |
| `-WhatIf` | | off | Dry-run — print what would happen without executing |

---

### Usage — Bash

```bash
bash scripts/sequence-plans.sh \
  --next-plan docs/plans/Phase-GITHUB-D-METRICS-LEADERBOARD-PLAN.md \
  --model claude-sonnet-4.6 \
  --reason "Phase D follows Phase B"
```

---

### WhatIf (Dry-Run)

Pass `-WhatIf` to preview what the sequencer would do without actually
committing, pushing, or dispatching the next plan:

```powershell
pwsh -NoProfile -File scripts/sequence-plans.ps1 `
  -NextPlan docs/plans/Phase-XYZ-PLAN.md `
  -WhatIf
```

Output example:
```
[09:15:00] [WhatIf] Would commit pending changes with message: feat(autoplan): ...
[09:15:00] [WhatIf] Would push to origin master
[09:15:00] [WhatIf] Would dispatch: docs/plans/Phase-XYZ-PLAN.md (model=claude-sonnet-4.6)
```

No git operations or `pforge` invocations are performed in `WhatIf` mode.

---

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — next plan dispatched |
| `1` | Failure — previous plan did not finish cleanly, or sequencer timed out |

---

### Chaining Conditions

The sequencer will **only** chain to the next plan when **all** of:

1. The orchestrator PID is gone (process has exited).
2. The run's `events.log` contains a `run-completed` terminal event.
3. The `run-completed` payload has `"failed": 0`.

If any condition is not met, the sequencer exits 1 and does NOT dispatch
the next plan.

---

### Four Scenarios

**Scenario 1 — Happy path**
Plan A finishes with `status: completed, failed: 0`. Sequencer commits any
pending changes, pushes, then dispatches Plan B.

**Scenario 2 — Slice failures**
Plan A's orchestrator emits `run-completed` but with `"failed": N` (N > 0).
Sequencer detects the failure count and refuses to chain. Exit 1.

**Scenario 3 — Orchestrator killed externally**
The orchestrator PID disappears but no `run-completed` event appears in
`events.log`. `Get-RunStatus` returns `in-progress`. Sequencer treats this
as failure and exits 1.

**Scenario 4 — Explicit failure event**
`events.log` contains `run-failed` or `run-aborted`. Sequencer detects the
terminal event and refuses to chain. Exit 1.

**Scenario 5 — No PID file**
No `.forge/last-orch.pid` found. Sequencer assumes nothing is in flight and
proceeds directly to dispatching the next plan (cold-start behaviour).

---

### Module API (`sequence-plans.psm1`)

```powershell
Import-Module ./scripts/sequence-plans.psm1

# Returns the PID of the running orchestrator, or $null
Get-CurrentOrchestratorPid -RepoRoot "."

# Returns $true if the process with the given PID is still running
Test-OrchestratorAlive -ProcId 12345

# Returns the path to the most recent .forge/runs/<dir>
Get-LatestRunDir -RepoRoot "."

# Returns "completed", "failed", "in-progress", or "unknown"
Get-RunStatus -RunDir ".forge/runs/2026-05-05T09-00-00"
```

---

## Other Scripts

| Script | Purpose |
|--------|---------|
| `digest.mjs` | Generate daily Forge-Master digest |
| `fm-recall.mjs` | Query BM25 recall index for prior Forge-Master turns |
| `timeline.mjs` | Build a timeline of plan runs and events |
| `graph.mjs` | Dependency graph for plan files |
| `patterns.mjs` | Pattern scanner for convention drift |
| `smoke-forge-master.mjs` | Smoke test the Forge-Master HTTP API |
| `audit-cli-parity.mjs` | Verify CLI ↔ MCP tool parity |
| `check-manual-links.mjs` | Validate links in the manual HTML pages |
| `check-metrics.ps1` | Validate metrics thresholds |
