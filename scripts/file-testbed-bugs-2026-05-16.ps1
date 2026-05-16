# File 7 bugs discovered during 2026-05-16 aggressive testbed exercise.
# One-shot script — safe to delete after use.

$ErrorActionPreference = 'Stop'
Set-Location 'E:\GitHub\Plan-Forge'

$ctxHeader = @"
**Discovered by**: Aggressive testbed exercise on `plan-forge-testbed` (Phase 4, ``--quorum=power``, 2026-05-16T14:56-15:08 UTC)
**Testbed commit**: ef11c36 (re-synced wrappers)
**Framework version**: v2.95.0
"@

$bugs = @(
  @{
    title    = '[testbed-found] pforge update does not sync CLI wrappers (pforge.ps1, pforge.sh, pforge)'
    severity = 'high'
    body     = @"
$ctxHeader

## Summary
The ``pforge update <source>`` command updates ``.github/*`` templates, ``pforge-mcp/server.mjs``, ``package.json``, and a few docs, but does NOT copy ``pforge.ps1``, ``pforge.sh``, or ``pforge`` from the source. Downstream projects stay frozen on whatever wrapper version they originally installed with, even after updating the framework. In the testbed this left v2.32.3 wrappers (~100KB) running against the v2.95.0 ``server.mjs``.

## Reproduction
1. In a project last updated months ago, run ``pforge update E:\GitHub\Plan-Forge``.
2. After: ``(Get-Item pforge.ps1).Length`` → still 100487 bytes.
3. Compare: ``(Get-Item E:\GitHub\Plan-Forge\pforge.ps1).Length`` → 329106 bytes.
4. Try a new flag: ``pforge run-plan plan.md --quorum=power`` → ``Plan file not found: --quorum=power`` because the old wrapper has no ``--quorum`` support.

## Evidence
- ``plan-forge-testbed`` commit ``e177b09`` updated 17 framework files but none were ``pforge.ps1`` / ``pforge.sh``.
- Subsequent manual diff: ``+8736 / -234`` lines after copying the v2.95.0 wrappers (commit ``ef11c36`` in testbed).

## Suggested fix
- Add ``pforge.ps1``, ``pforge.sh``, ``pforge`` to the file-copy list in ``Invoke-PforgeUpdate`` (``pforge.ps1``) and ``pforge_update()`` (``pforge.sh``).
- Verify checksum / line count after copy.
- Update ``/memories/repo/setup-update-invariants.md`` with a new invariant: "CLI wrappers ship with update".

## Why this matters
Users believe they are on v2.95.0 but are actually running v2.32.3-era CLI surface. They cannot access new flags (``--quorum``, ``--foreground``, ``--estimate``), new commands (``crucible*``, ``ext*``, ``self-update``), or any wrapper-level bug fixes. All silently fail with confusing "Plan file not found" / "unknown command" errors.
"@
  },
  @{
    title    = '[testbed-found] Orchestrator silently reverts uncommitted modifications to wrapper files during plan execution'
    severity = 'critical'
    body     = @"
$ctxHeader

## Summary
During a Phase 4 run with ``--quorum=power``, the testbed had uncommitted modifications to ``pforge.ps1`` and ``pforge.sh`` (~228KB delta each). After the run completed, those files were reset back to their HEAD content with no warning. The ``.forge/`` artifacts (``model-performance.json``, ``logs/``, ``telemetry/``) and source-tree files (``*.cs``) were left alone — only the wrapper files were reverted. This is silent data loss.

## Reproduction
1. ``Copy-Item NEW_pforge.ps1 testbed/pforge.ps1``  (file changes from 100KB to 329KB)
2. ``cd testbed; git status``  → shows ``M pforge.ps1``
3. ``pforge run-plan <plan> --quorum=power --foreground``
4. After: ``git status`` → ``pforge.ps1`` modification is GONE; file is back to 100KB.

## Evidence
- Orchestrator's first slice emitted ``warning: in the working copy of 'pforge.ps1', LF will be replaced by CRLF the next time Git touches it`` (so it knew about the modification).
- After 4 slices completed: ``(Get-Item pforge.ps1).Length`` → 100487 again.
- The same revert happened to ``pforge.sh`` (256KB → 78KB).
- Files NOT reverted in the same run: ``.forge/model-performance.json`` (still dirty), ``.forge/logs/`` (untracked, preserved), ``.forge/telemetry/tool-calls.jsonl`` (still dirty).

## Suggested fix
- Identify which orchestrator hook or git op resets the working tree (likely a ``git checkout HEAD --`` or ``git stash drop`` for sanitation).
- If sanitation is intentional, scope it strictly: only touch paths the orchestrator wrote (``.forge/`` write log).
- Never run ``git checkout`` / ``git reset`` against tracked files the user modified outside the run.
- Add a pre-run "dirty tree" snapshot and a post-run diff against it; warn if the orchestrator ate user changes.

## Why this matters
This is silent data loss. Users staging local fixes, hotpatches, or wrapper updates before running a plan will lose their work with no audit trail and no recovery path (since no commit ever happened). Combined with bug #1 (wrappers don't update), this means manual wrapper syncs cannot survive a single run.
"@
  },
  @{
    title    = '[testbed-found] pforge.ps1 v2.95.0 fails to parse on Windows PowerShell 5.1 (UTF-8 no BOM, em-dash mojibake)'
    severity = 'high'
    body     = @"
$ctxHeader

## Summary
The v2.95.0 ``pforge.ps1`` is saved as UTF-8 without BOM. Windows PowerShell 5.1 defaults to Windows-1252 (system ANSI codepage) for files without BOM, so non-ASCII characters (em-dashes ``—``, Unicode arrows ``↑↓``) decode as mojibake. The corrupted bytes then break the parser: PS interprets text inside ``Write-Host`` strings as redirection (``<`` / ``>``) and ``*`` as multiplication, producing dozens of parser errors. The orchestrator's node-side execution works (it does not re-invoke ``pforge.ps1``), but ``forge_sweep``, post-run cleanup hooks, and any MCP tool that shells back into ``pforge.ps1`` fail.

## Reproduction
1. On Windows PowerShell 5.1 (NOT PowerShell Core 7+): ``Copy-Item E:\GitHub\Plan-Forge\pforge.ps1 .``
2. ``powershell.exe -Command '& .\pforge.ps1 sweep'``
3. See ~15 ``ParserError`` lines:
   - ``The '<' operator is reserved for future use``
   - ``Unexpected token '*' in expression``
   - Mojibake: ``(To be added during Plan Hardening ∩┐╜?" Step 2)``  ← that ``∩┐╜?"`` is em-dash ``—`` (U+2014) decoded as Windows-1252.

## Evidence
- ``forge_sweep`` MCP tool call output during 2026-05-16 testbed run: 15 ``ParserError`` lines.
- Same errors appeared as a tail of the plan-run logs after slice 4 completed.

## Suggested fix
- **Preferred**: Save ``pforge.ps1`` with UTF-8 BOM (``EF BB BF``). Same for ``pforge.sh``.
- Add a CI gate: ``(Get-Content pforge.ps1 -Encoding Byte -TotalCount 3) -join ',' -eq '239,187,191'``.
- **Fallback**: Replace all non-ASCII (em-dash ``—`` → ``--``, arrows ``↑↓`` → ``up/down``, checkmarks ``✓`` → ``[OK]``) inside ``.ps1`` source.

## Why this matters
Windows PowerShell 5.1 ships in-box on every Windows 10/11 machine. Many users (especially in enterprise) do NOT have PowerShell Core 7+ installed. The CLI is unusable for ``sweep``, ``new-phase``, and any other command that re-shells through ``pforge.ps1`` after the initial invocation.
"@
  },
  @{
    title    = '[testbed-found] Cost rollup in run summary.json reports `$`0 / 0 tokens despite real CLI worker token usage'
    severity = 'high'
    body     = @"
$ctxHeader

## Summary
A power-quorum Phase 4 run dispatched 3 models per slice for 4 slices (12 model calls), with per-call stderr telemetry like ``Tokens ↑ 22.1k ↓ 689 • 143.2k (cached) AI Units 22.7``. The final ``summary.json`` reports ``total_cost_usd=0``, ``total_tokens_in=0``, ``total_tokens_out=0``, and ``by_model['unknown']=4 slices`` with zero everything. The orchestrator is not parsing gh-copilot worker stderr telemetry into the cost service.

## Reproduction
1. ``cd plan-forge-testbed``
2. ``pforge run-plan docs\plans\Phase-4-TIME-ENTRY-REPORTS-PLAN.md --quorum=power --foreground``
3. ``Get-Content .forge/runs/<latest>/summary.json | ConvertFrom-Json | Select-Object -ExpandProperty cost``  → all zeros
4. ``Get-Content .forge/runs/<latest>/slice-4-log.txt | Select-String -Pattern 'Tokens'``  → real token counts present in stderr

## Evidence
- Run dir: ``.forge/runs/2026-05-16T14-56-47-135Z_Phase-4-TIME-ENTRY-REPORTS-PLAN``
- ``summary.json`` ``cost.total_cost_usd = 0``, ``by_model.unknown.tokens_in/out = 0``
- ``slice-4.json`` ``tokens.tokens_in = null``, ``tokens.model = null``
- ``slice-4-log.txt`` STDERR contains: ``↑ 22.1k • ↓ 689 • 143.2k (cached)``

## Suggested fix
- Add a stderr telemetry regex in ``workerExecutor`` for the gh-copilot pattern:
  ``(?<dir>↑|↓|Tokens up:|down:)\s*(?<count>\d+(?:\.\d+)?[kKmM]?)``
- Normalize ``22.1k`` → ``22100`` etc.
- Persist parsed tokens to ``slice.tokens.tokens_in`` / ``tokens_out`` / ``model`` (already known from quorum dispatch) BEFORE the cost rollup runs.
- Also capture from the ``AI Units`` line — it correlates to billable units in some copilot tiers.

## Why this matters
``forge_cost_report`` and ``--estimate`` historical confidence depend on actuals. Right now every run records zero, so historical confidence cannot improve and ``forge_estimate_quorum`` falls back to static baselines forever. Also: users cannot detect when a quorum run cost 3x what they expected.
"@
  },
  @{
    title    = '[testbed-found] pforge run-plan flag parsing requires plan path BEFORE --quorum / --foreground flags (order-sensitive)'
    severity = 'medium'
    body     = @"
$ctxHeader

## Summary
``pforge run-plan --quorum=power --foreground docs/plans/X.md`` fails with ``Plan file not found: --quorum=power``. The first non-``run-plan`` argument is taken as the plan path regardless of leading ``--``. Reordering to ``pforge run-plan docs/plans/X.md --quorum=power --foreground`` works. CLI flag parsing should be order-independent.

## Reproduction
1. ``pforge run-plan --quorum=power --foreground plan.md`` → ``ERROR: Plan file not found: --quorum=power``
2. ``pforge run-plan plan.md --quorum=power --foreground`` → works correctly

## Evidence
Tested with v2.95.0 ``pforge.ps1`` on ``plan-forge-testbed`` 2026-05-16. See terminal session at 14:56 UTC.

## Suggested fix
- In ``Invoke-RunPlan``'s argument loop, recognize ``--``-prefixed args as flags regardless of position.
- Or: switch to a proper PowerShell ``param()`` block with ``[Parameter(Position=0)]`` for the plan path.

## Why this matters
Standard CLI convention is flags-before-positionals (``git --no-pager log``, ``docker -it run``). Users naturally type ``pforge run-plan --quorum=power plan.md``. Silent rejection with a misleading error wastes time and erodes trust in the CLI.
"@
  },
  @{
    title    = "[testbed-found] run summary.json 'mode' field reports 'auto' when --quorum=power was requested"
    severity = 'medium'
    body     = @"
$ctxHeader

## Summary
Running with ``--quorum=power`` produces ``summary.json`` with ``mode: "auto"``, even though ``slice-X-quorum.json`` clearly records 3 models dispatched per slice with ``successfulLegs=3``, ``totalLegs=3``, ``reviewerFallback=false``. The ``mode`` field in ``summary.json`` is the only top-level field where the requested quorum mode would surface; auditors reading the summary cannot tell whether ``power`` was requested vs ``auto``.

## Reproduction
1. ``pforge run-plan plan.md --quorum=power --foreground``
2. ``Get-Content .forge/runs/<latest>/summary.json | ConvertFrom-Json | Select-Object mode``  → ``mode: auto`` (expected ``power``)
3. ``Get-Content .forge/runs/<latest>/slice-1-quorum.json``  → ``models: [claude-opus-4.6, gpt-5.3-codex, claude-sonnet-4.6]``, ``successfulLegs: 3``

## Evidence
- 2026-05-16 testbed run summary at ``.forge/runs/2026-05-16T14-56-47-135Z_Phase-4-TIME-ENTRY-REPORTS-PLAN/summary.json``: ``mode = "auto"``
- Same run's slice quorum records show full 3-leg quorum.

## Suggested fix
- In the orchestrator's run-writer, capture the resolved quorum mode from CLI args.
- Persist as a new ``quorumMode`` field in ``summary.json`` (``"auto" | "power" | "speed" | "false"``).
- Keep the existing ``mode`` field for ``auto`` vs ``assisted`` execution distinction.

## Why this matters
Audit and reproducibility: knowing whether a slice was vetted by 1 model or 3 is essential for any after-the-fact review of plan output. Currently the only evidence is in the per-slice quorum.json files, which auditors must inspect individually.
"@
  },
  @{
    title    = '[testbed-found] Tempering stack detection fails for .slnx-only .NET 10 solutions'
    severity = 'medium'
    body     = @"
$ctxHeader

## Summary
``forge_tempering_scan`` on a .NET 10 project rooted at ``TimeTracker.slnx`` (with all ``.csproj`` files under ``src/`` subdirectories) returns ``status: "no-data"`` with ``reason: "Could not detect project stack (no package.json / *.csproj / pyproject.toml / go.mod / Cargo.toml / pom.xml found)."``. The detector only looks at the repository root and does not recognize ``.slnx`` (the new .NET 10 solution format) as a .NET marker.

## Reproduction
1. ``cd plan-forge-testbed`` (root has ``TimeTracker.slnx``, no root-level ``.csproj``)
2. Invoke ``forge_tempering_scan`` with default scanners
3. Response: ``status: "no-data"``, ``stack: "unknown"``

## Evidence
- Scan record: ``.forge/tempering/scan-2026-05-16T15-20-18-542Z.json``
- ``ls`` of testbed root shows ``TimeTracker.slnx`` (the only solution-format file) plus subdirs ``src/``, ``tests/`` containing the actual ``.csproj``.

## Suggested fix
- In the stack detector, recursively check ``src/`` and ``tests/`` (one level deep) for ``*.csproj``.
- Add ``.slnx`` and ``.sln`` as primary dotnet markers alongside ``.csproj``.
- Probably also add ``*.fsproj`` and ``*.vbproj`` for completeness.

## Why this matters
.NET 10 adopted ``.slnx`` as the preferred solution format. Any project on modern .NET tooling without a flat-root layout cannot use tempering. As more teams adopt ``.slnx``, this silently disables one of the framework's headline value props.
"@
  }
)

$results = @()
foreach ($bug in $bugs) {
  $tempFile = [System.IO.Path]::GetTempFileName()
  Set-Content -LiteralPath $tempFile -Value $bug.body -Encoding utf8
  Write-Host "Filing: $($bug.title)" -ForegroundColor Cyan
  $url = gh issue create --title $bug.title --body-file $tempFile --label bug --label testbed-found
  Remove-Item $tempFile -Force
  $results += [pscustomobject]@{
    Severity = $bug.severity
    Url      = $url
    Title    = $bug.title
  }
}

Write-Host ''
Write-Host '=== All issues filed ==='
$results | Format-Table -AutoSize -Wrap
