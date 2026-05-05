# Hotfix v2.90.5 — Sequencer Hardening Sweep

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (sequencer rewrite + unit coverage)
> **Estimated cost**: $0.15–$0.30 (3 slices)
> **VERSION target**: 2.90.4 → 2.90.5 (patch)
> **Depends on**: None directly

---

## Feature Specification

### Problem Statement

`scripts/sequence-plans.ps1` was authored mid-shift on May 5 to chain Phase B → Phase D autonomously. It needed to be hardened twice during the night:

1. **Round 1 (a4bfb7f)**: original treated `run-completed` event as success even when slices failed. Fixed to inspect the JSON payload's `failed` count.
2. **Round 2 (a4bfb7f → improved)**: original treated `in-progress` (no run-completed event yet) as success when the orchestrator was killed externally. Fixed to require an explicit `status: completed` AND `failed: 0`.

These were caught at runtime via three failed cascades. The sequencer is now correct but has zero test coverage. This hotfix folds the live-fixed behaviour into a tested, documented script.

### User Scenarios

**Scenario 1: Normal happy-path chaining**
1. Plan A finishes cleanly with `status: completed, failed: 0`.
2. Sequencer commits any pending changes, pushes, dispatches Plan B.
3. No human intervention needed.

**Scenario 2: Plan A has a failed slice (orchestrator emits `run-completed` with failed > 0)**
1. Sequencer detects `failed > 0` in the run-completed payload.
2. Refuses to chain. Logs `Run failed (N slices failed) — NOT proceeding to <next-plan>. Inspect: <run-dir>`.
3. Exits 1.

**Scenario 3: Plan A's orchestrator killed externally (no run-completed event)**
1. Sequencer's poll loop notices PID gone.
2. `Get-RunStatus` returns `in-progress` (no terminal event).
3. Sequencer treats this as failure (current correct behaviour). Refuses to chain.

**Scenario 4: Plan A's terminal event is `run-failed` or `run-aborted`**
1. Sequencer detects the explicit failure event.
2. Refuses to chain.

**Scenario 5: Sequencer detects no PID file at all**
1. Logs "no orchestrator in flight" and proceeds directly to Plan B (existing behaviour for cold-start).

### Acceptance Criteria

- [ ] **MUST**: `scripts/sequence-plans.ps1` is feature-equivalent to the current production version (preserving the May 5 fixes) but with each helper extracted as a named function with a JSDoc-style comment block.
- [ ] **MUST**: New `scripts/sequence-plans.psm1` module exports `Get-RunStatus`, `Test-OrchestratorAlive`, `Get-CurrentOrchestratorPid` for testability.
- [ ] **MUST**: New Pester (PowerShell test framework) test file `scripts/tests/sequence-plans.tests.ps1` covers:
  - `Get-RunStatus` returns `completed` for a clean run-completed event with `failed: 0`
  - `Get-RunStatus` returns `failed` when run-completed has `failed > 0`
  - `Get-RunStatus` returns `failed` when terminal event is `run-failed` or `run-aborted`
  - `Get-RunStatus` returns `in-progress` when no terminal event present
  - `Get-RunStatus` returns `unknown` when events.log missing
- [ ] **MUST**: Tests run against fixture events.log files (created in tmpdir at `BeforeAll`, deleted at `AfterAll`).
- [ ] **MUST**: A new `-WhatIf` switch on the sequencer prints what it would do (commit, push, dispatch) without executing. Used for CI / dry-run testing.
- [ ] **MUST**: A new `-MaxWaitMinutes <N>` parameter (default 240, i.e. 4h) bounds the watch loop. After the cap, sequencer exits 1 with "watched for N min, orchestrator never finished".
- [ ] **MUST**: Documentation: `scripts/README.md` (create if missing) describes the sequencer with usage examples, exit codes, and the four scenarios above.
- [ ] **MUST**: A bash equivalent `scripts/sequence-plans.sh` ships alongside (mirrors the PowerShell behaviour, basic feature-parity).
- [ ] **SHOULD**: A SHOULD test asserts that `-WhatIf` makes zero git commits.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Pid file contains non-numeric content | Treated as "no PID known"; sequencer logs warning and proceeds to next plan after a short delay. |
| Run dir contains corrupted JSON in events.log | `Get-RunStatus` returns `unknown`; sequencer treats as failure (safer default). |
| `MaxWaitMinutes` reached | Exit 1; do not chain. |
| `-WhatIf` + `-SkipCommitPush` combined | Both honoured; no side effects at all. |
| Orchestrator killed during the commit-pending-work step | Sequencer logs the partial commit attempt; if commit succeeded, push attempts; if push fails, exits 1 without dispatching next plan. |

### Out of Scope

- Multi-plan queue (just two plans for now — A → B).
- Parallel chaining.
- Cross-machine sequencing.
- Notification on completion (Slack/email — out of scope; hooks already exist for this).

---

## Scope Contract

### Inputs
- [scripts/sequence-plans.ps1](../../scripts/sequence-plans.ps1) — the existing live-fixed version (commits a4bfb7f, e6f1c75)

### Outputs
- **Modified**: `scripts/sequence-plans.ps1` (refactored to consume the module)
- **New**: `scripts/sequence-plans.psm1` (extracted helpers)
- **New**: `scripts/tests/sequence-plans.tests.ps1` (Pester tests)
- **New**: `scripts/sequence-plans.sh` (bash equivalent)
- **New**: `scripts/README.md` (sequencer docs)
- **Modified**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Changing the sequencer's chain-conditions (must stay: `status === "completed" && failed === 0`)
- ❌ Adding implicit retry / loop-around-failure
- ❌ Auto-merging PRs created by chained plans
- ❌ Skipping the commit step before dispatching the next plan

---

## Slice Plan

### Slice 1 — Module extraction + sequencer refactor
**Files in scope**: `scripts/sequence-plans.ps1`, `scripts/sequence-plans.psm1`
**Validation gate**:
```bash
node -e "const fs=require('fs'); const psm=fs.readFileSync('scripts/sequence-plans.psm1','utf8'); const ps1=fs.readFileSync('scripts/sequence-plans.ps1','utf8'); const checks={moduleHasGetRunStatus:/function\s+Get-RunStatus/.test(psm), moduleHasTestAlive:/function\s+Test-OrchestratorAlive/.test(psm), moduleHasGetPid:/function\s+Get-CurrentOrchestratorPid/.test(psm), ps1ImportsModule:/Import-Module|\.\s+\$PSScriptRoot/.test(ps1)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

### Slice 2 — Pester tests + bash equivalent
**Files in scope**: `scripts/tests/sequence-plans.tests.ps1`, `scripts/sequence-plans.sh`
**Validation gate**:
```bash
node -e "const fs=require('fs'); if(!fs.existsSync('scripts/tests/sequence-plans.tests.ps1')){console.error('Pester tests missing');process.exit(1)} if(!fs.existsSync('scripts/sequence-plans.sh')){console.error('bash equivalent missing');process.exit(1)} const sh=fs.readFileSync('scripts/sequence-plans.sh','utf8'); if(!/get_run_status/.test(sh)){console.error('bash sequencer missing get_run_status function');process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.15

### Slice 3 — README + version + CHANGELOG
**Files in scope**: `scripts/README.md`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Validation gate**:
```bash
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const readme=fs.readFileSync('scripts/README.md','utf8'); const checks={version:v==='2.90.5', changelog:/2\.90\.5/.test(cl) && /sequencer/i.test(cl), readme:/sequence-plans/i.test(readme) && /WhatIf/.test(readme)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.05

---

## Branch Strategy
- Branch: `hotfix/v2.90.5-sequencer-sweep`
- Base: `master` (after v2.90.4)

## Rollback Plan
- The refactored sequencer is feature-equivalent. No behavior change for users.
- Module + tests can be deleted; the refactored ps1 is self-contained otherwise.
- Full rollback: `git revert <merge-commit>`.

## Notes for the Hardener
- Pester may not be installed on every dev machine. The validation gate uses node-based file existence checks rather than running Pester directly. If Pester is available, optionally extend Slice 2 to actually run `Invoke-Pester` and assert pass.
- The bash equivalent (`scripts/sequence-plans.sh`) doesn't need 100% feature parity — Get-CimInstance has no exact bash equivalent. Acceptable to use `pgrep -F` against the pid file plus `tail` of events.log.
