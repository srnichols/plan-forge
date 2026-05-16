# Add verification comments to closed bugs #177-#183 and file two new findings
# from the v2.96.1 testbed rerun verification on 2026-05-16.
# One-shot script — delete after use.

$ErrorActionPreference = 'Stop'
Set-Location 'E:\GitHub\Plan-Forge'

# ============================================================
# 1) Post verification comment on each of the 7 fixed bugs
# ============================================================

$verifyComment = @"
## Verification — v2.96.1 Phase-4 testbed rerun (2026-05-16)

Fixed in commit ``9211c93``, released as v2.96.1, and re-verified via aggressive testbed rerun on ``plan-forge-testbed`` (``--quorum=power``, plan ``Phase-4-TIME-ENTRY-REPORTS-PLAN.md``).

**Run**: ``.forge/runs/2026-05-16T16-20-37-420Z_Phase-4-TIME-ENTRY-REPORTS-PLAN``
**Result**: 4/4 slices passed, all auto-committed (SHAs ``6704a6c``, ``f0ee8dd``, ``0df8b71``, ``20b2f3c``), gates green (.NET build + 64 tests), $0.04 actual cost.

### Per-bug verification

| Bug | Verification |
|-----|--------------|
| #177 (wrappers don't update) | Verified by ``setup-update-invariants.md`` memory + new test ``wrapper-bom-issue-179.test.mjs`` |
| #178 (snapshot leak) | All 4 slices report ``"snapshotRestored": true`` in slice-N.json. Reflog shows no new ``pforge-slice-*-snapshot`` entries after run start (16:20 UTC). New test ``slice-snapshot.test.mjs`` (10 tests) covers helpers |
| #179 (BOM/mojibake) | ``pforge.ps1`` first 3 bytes are now ``EF BB BF``. Test ``wrapper-bom-issue-179.test.mjs`` enforces |
| #180 (cost rollup zero) | ``summary.json.cost.total_cost_usd = 0.04``, per-slice ``reviewerCost`` 0.147/0.1605/0.1371/0.138, per-model tokens 127300/10800. Test ``cost-rollup-issue-180.test.mjs`` (18 tests) |
| #181 (flag order) | ``--quorum=power`` before plan path accepted in both estimate and run-plan invocations |
| #182 (quorumMode missing) | ``summary.json`` has distinct ``mode: "auto"``, ``quorumMode: "power"``, ``quorumPreset: "power"`` |
| #183 (.slnx detection) | ``tempering-foundation.test.mjs`` +6 tests covering .slnx, .vbproj, recursive 2-level scan |

See ``CHANGELOG.md`` v2.96.1 entry and ``/memories/repo/v2.96.1-bug-sweep.md`` for full lessons.
"@

$bugIds = 177, 178, 179, 180, 181, 182, 183

# NOTE: comments already posted in the first run on 2026-05-16. Skip on rerun.
$skipComments = $true
if (-not $skipComments) {
    foreach ($id in $bugIds) {
        Write-Host "→ Commenting on #$id ..."
        $verifyComment | gh issue comment $id --body-file -
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to comment on #$id (exit=$LASTEXITCODE)"
        }
    }
} else {
    Write-Host "(Skipping comment posting — already done on initial run)"
}

# ============================================================
# 2) File two new bugs discovered during the rerun verification
# ============================================================

$newCtx = @"
**Discovered by**: v2.96.1 testbed rerun verification on ``plan-forge-testbed`` (2026-05-16T16:20-16:34 UTC, ``--quorum=power``, plan ``Phase-4-TIME-ENTRY-REPORTS-PLAN.md``)
**Run dir**: ``.forge/runs/2026-05-16T16-20-37-420Z_Phase-4-TIME-ENTRY-REPORTS-PLAN``
**Framework version**: v2.96.1
"@

$newBugs = @(
  @{
    title = '[testbed-found] Worker token telemetry: vendor=unknown, apiDurationMs=0, codeChanges=null on every slice'
    body  = @"
$newCtx

## Summary
Every slice in the v2.96.1 testbed rerun records the following per-slice ``tokens`` block in ``slice-N.json`` and the rolled-up ``sliceResults`` of ``summary.json``:

``````json
"tokens": {
  "tokens_out": 1600,
  "tokens_in": 38500,
  "model": "claude-sonnet-4.6",
  "premiumRequests": 1,
  "apiDurationMs": 0,
  "sessionDurationMs": 0,
  "codeChanges": null,
  "vendor": "unknown"
}
``````

Token counts ARE populated (great — #180 fix held), but four secondary fields never get values:

| Field | Observed | Expected |
|---|---|---|
| ``vendor`` | ``"unknown"`` | ``"anthropic"`` / ``"github-copilot"`` / ``"openai"`` |
| ``apiDurationMs`` | ``0`` | Wall-clock of LLM API call(s) |
| ``sessionDurationMs`` | ``0`` | Duration of the worker subprocess |
| ``codeChanges`` | ``null`` | ``{ filesChanged, linesAdded, linesRemoved }`` summary |

## Reproduction
1. ``cd plan-forge-testbed``
2. ``pforge run-plan --quorum=power --manual-import --manual-import-source human --manual-import-reason "telemetry probe" docs/plans/Phase-4-TIME-ENTRY-REPORTS-PLAN.md``
3. After completion: ``Get-Content .forge/runs/<latest>/slice-1.json | ConvertFrom-Json | Select-Object -ExpandProperty tokens``
4. Observe ``vendor=unknown``, ``apiDurationMs=0``, ``sessionDurationMs=0``, ``codeChanges=null`` on every slice.

## Evidence
All four slice JSONs in ``2026-05-16T16-20-37-420Z_Phase-4-TIME-ENTRY-REPORTS-PLAN/`` show identical zero/null values across these fields, regardless of slice complexity (3 vs 2 score) or runtime (153-240 seconds).

## Suggested fix
- ``vendor``: derive from ``model`` prefix (``claude-`` → anthropic, ``gpt-`` → openai, ``grok-`` → xai) at the same point where ``model`` resolves.
- ``apiDurationMs`` / ``sessionDurationMs``: capture worker spawn time vs first/last token timestamps in ``workerExecutor`` (we already buffer stderr/stdout — wrap with timestamps).
- ``codeChanges``: after slice commit, run ``git show --stat HEAD`` and parse ``N files changed, X insertions(+), Y deletions(-)``.

## Why this matters
- ``vendor`` is the discriminator for cost-anomaly detection and per-vendor SLA tracking.
- ``apiDurationMs`` distinguishes a slow LLM from a slow build gate when investigating latency regressions.
- ``codeChanges`` powers the ``forge_drift_report`` and ``forge_health_trend`` rollups that surface "this slice mutated 47 files" alarms.

Without these, observability dashboards plot flat zeros while the cost-rollup numbers tell a different story.
"@
    severity = 'medium'
  },
  @{
    title = "[testbed-found] 'pforge plan-status' referenced in run-plan output banner but command does not exist"
    body  = @"
$newCtx

## Summary
When ``pforge run-plan`` starts in background mode, it prints a status banner that tells the user how to monitor the run:

``````
Starting full auto execution (background)
...
Monitor : pforge plan-status
``````

But ``pforge plan-status`` is not a registered CLI command. Running it returns:

``````
ERROR: Unknown command 'plan-status'
``````

The actual command for monitoring is ``pforge status`` (and/or ``forge_plan_status`` MCP tool).

## Reproduction
1. ``pforge run-plan some-plan.md``  (starts a run, prints the banner)
2. Follow the banner's instruction: ``pforge plan-status``
3. Get ``ERROR: Unknown command 'plan-status'``

## Suggested fix
Either:
- **(A)** Update the banner text in ``pforge.ps1`` / ``pforge.sh`` to print ``Monitor : pforge status`` (matches the real command).
- **(B)** Add ``plan-status`` as an alias to ``status`` in the CLI wrappers.

Option (A) is less surface area; option (B) honors any existing muscle memory if the command was ever real.

## Why this matters
Low-impact but high-friction onboarding bug: the very first thing a new user does after kicking off a background run is paste the printed monitor command. Getting an "unknown command" error two seconds later erodes trust and forces a docs detour.
"@
    severity = 'low'
  }
)

foreach ($bug in $newBugs) {
    Write-Host ""
    Write-Host "→ Filing: $($bug.title)"
    $issueUrl = $bug.body | gh issue create `
        --title $bug.title `
        --label "bug,testbed-found" `
        --body-file -
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Failed to file '$($bug.title)' (exit=$LASTEXITCODE)"
    } else {
        Write-Host "  Created: $issueUrl"
    }
}

Write-Host ""
Write-Host "Done."
