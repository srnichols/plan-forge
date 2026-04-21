# BUG: `api-xai` worker produces text but does not execute tool calls

**Filed**: 2026-04-21  
**Severity**: High — quietly poisons cost estimator recommendations and loses wall-clock time on retry loops  
**Status**: Open  
**Repro'd on**: v2.61.0-dev (master @ `2118453`)

---

## Symptom

`pforge run-plan <plan> --model grok-4.20` on any slice that requires file writes:

1. Worker `api-xai` with model `grok-4.20-0309-reasoning` "completes" in ~17s
2. Worker emits a `PFORGE_TRAJECTORY:BEGIN/END` narrative describing the files it *would have* created
3. **No files are actually written to disk**
4. Validation gate (e.g. `test -d .../forge-master && test -f .../system-prompt.md`) fails
5. Orchestrator marks slice escalated (`fromModel: grok-4.20 → toModel: auto`) and retries
6. Retry uses same worker, produces same narrative, fails same gate → infinite loop until aborted
7. No `gate-failed` event is emitted after the first retry; the orchestrator falls silent (last event is the initial `slice-escalated`)

## Repro

```powershell
.\pforge.ps1 run-plan docs/plans/Phase-28-FORGE-MASTER-MVP-v2.61-PLAN.md --model grok-4.20 --quorum=false
```

Run dir: `.forge/runs/2026-04-21T06-29-37-647Z_Phase-28-FORGE-MASTER-MVP-v2.61-PLAN/`  
Worker log: `slice-1-log.txt`

Worker output shows the grok-4.20 narrative:

> I started by searching OpenBrain for prior conventions... That led me to create the `pforge-mcp/forge-master` folder with a concise `system-prompt.md`... and an `allowlist.mjs` that exports a minimal capability list...

Verification:

```powershell
Get-ChildItem pforge-mcp\forge-master
# Only `config.mjs` exists (pre-existing). No system-prompt.md, no allowlist.mjs.
```

## Root Cause (suspected)

The `api-xai` worker appears to wrap xAI's chat completion endpoint without a tool-call execution loop. It captures the model's natural-language description of intended actions as if they were completed, but never resolves file-write / bash tool calls against the workspace. Only the `gh copilot` CLI worker (Claude models) actually materializes filesystem changes.

This is not an API key / provider-availability issue — `XAI_API_KEY` is correctly stored in `.forge/secrets.json` and the worker authenticated and returned content.

## Impact

Two compounding failure modes:

1. **Silent data corruption in estimator recommendations.** `cost-service.mjs` / `forge_estimate_quorum` learn from `model-performance.json`. If grok-4.20 "succeeds" on verification-only slices (ones where the gate happens to pass without any file changes being required) but "fails" on write slices, the success rate recorded in history mixes the two and yields a dangerously wrong recommendation like the one that drove Phase-28's estimate:
   > *slices 2–9 recommend `grok-4.20-0309-reasoning` (1.0 success, 8 slices, $0.0054/slice)*

   Dogfooding this recommendation on a plan where every slice writes files wastes a session and, worse, produces no cost record because the slice never completes.

2. **Retry loop burns wall-clock time, not tokens.** Because the narrative is cheap and fast, the orchestrator can churn for tens of minutes without hitting a retry budget ceiling. Observed: 38 minutes on slice 1 before manual abort.

## Proposed Fixes (not implemented)

1. **Short term — estimator guard**: in `cost-service.mjs`, tag slices by whether their validation gates include `test -f`, `test -d`, or similar file-existence checks. Only count a grok-4.20 run toward success history if the slice completed **and** materialized the expected files. Alternatively: require `toolsCalled > 0` on the worker's telemetry before counting the run as a win.

2. **Medium term — worker contract check**: `orchestrator.mjs` should verify the worker type can execute tool calls before dispatching a slice whose gates require filesystem state. A static capability declaration per worker (e.g. `{ writes: true }` for `gh-copilot`, `{ writes: false }` for `api-xai`) consumed by the router.

3. **Proper fix — `api-xai` worker tool loop**: implement function-calling against xAI's tools API so grok-4.20 actually executes file operations. Requires defining the tool schema and a local executor (similar to how the `gh copilot` worker plumbs through).

4. **Retry-budget ceiling**: emit a `slice-failed` event and halt the run after N consecutive gate failures with identical diagnostics. Do not allow silent escalation loops.

## Workaround

Drop `--model` on any plan execution; let default routing use `gh copilot` + Claude. Cost goes up (Opus/Sonnet vs grok) but slices actually complete.

```powershell
.\pforge.ps1 run-plan docs/plans/Phase-28-FORGE-MASTER-MVP-v2.61-PLAN.md --quorum=false
```

## Related

- `docs/research/scorecomplexity-distribution-2026-04.md` — separate finding that complexity scoring under-counts real slices; both bugs mean estimator outputs should be treated as lower-bound hints, not contracts.
- Phase-27.2 landed projected-cost badges; same estimator pipeline feeds those. Badges for plans with grok-recommended slices are currently misleading.
