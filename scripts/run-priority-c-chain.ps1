<#
.SYNOPSIS
  Chain runner for the Priority-C enterprise-readiness phases.

.DESCRIPTION
  Drafted from docs/research/enterprise-fleet-readiness.md §14 Priority C.
  Code-dependency analysis (search subagent, 2026-05-07) confirmed the order:
    1. Phase-TRAJECTORY-SCHEMA-HARDENING  (event schema first — touched by all downstream)
    2. Phase-OTEL-AUDIT-EXPORT           (OTel + audit-export CLI; depends on Phase 1 fields)
    3. Phase-FOUNDRY-PROVIDER            (independent, sequenced to avoid git contention)
    4. Phase-AUTH-RBAC-SCAFFOLD          (isolated; last so RBAC scopes know audit/OTel surfaces)

  Default flow:
    1. Estimate all 4 plans, sum total, ask for confirmation.
    2. For each plan, run `pforge run-plan <plan>`. Halt-on-failure.
    3. Report success/failure summary.

.PARAMETER EstimateOnly
  Run estimates and exit. No execution. Use this first to see total cost.

.PARAMETER Quorum
  Quorum mode passed to pforge run-plan: auto|power|speed|false. Default: auto.

.PARAMETER StartFrom
  Resume from plan N (1-4). Useful when an earlier phase already shipped.
  Default: 1 (run all).

.PARAMETER DryRun
  Print the planned order and exit. No estimates, no execution.

.PARAMETER Force
  Skip the post-estimate confirmation prompt. Required for unattended runs.

.EXAMPLE
  ./scripts/run-priority-c-chain.ps1 -EstimateOnly
  Show the cost estimate for all 4 phases without running anything.

.EXAMPLE
  ./scripts/run-priority-c-chain.ps1 -Quorum auto
  Estimate, prompt for confirmation, then run all 4 phases sequentially under quorum=auto.

.EXAMPLE
  ./scripts/run-priority-c-chain.ps1 -StartFrom 3 -Quorum auto -Force
  Resume from Phase 3 (Foundry provider) onward, no prompt.
#>
[CmdletBinding()]
param(
    [switch]$EstimateOnly,
    [ValidateSet('auto','power','speed','false')]
    [string]$Quorum = 'auto',
    [ValidateRange(1,4)]
    [int]$StartFrom = 1,
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Plan order is load-bearing — see code-dependency analysis above. Do not reorder.
$plans = @(
    [PSCustomObject]@{
        Number = 1
        Name   = 'Phase-TRAJECTORY-SCHEMA-HARDENING'
        Path   = 'docs/plans/Phase-TRAJECTORY-SCHEMA-HARDENING-PLAN.md'
        Slices = 6
        Why    = 'Event schema first — every downstream phase consumes orchestrator.mjs:292 record shape'
    },
    [PSCustomObject]@{
        Number = 2
        Name   = 'Phase-OTEL-AUDIT-EXPORT'
        Path   = 'docs/plans/Phase-OTEL-AUDIT-EXPORT-PLAN.md'
        Slices = 12
        Why    = 'OTel gen_ai.* spans + pforge audit export CLI; depends on Phase 1 fields'
    },
    [PSCustomObject]@{
        Number = 3
        Name   = 'Phase-FOUNDRY-PROVIDER'
        Path   = 'docs/plans/Phase-FOUNDRY-PROVIDER-PLAN.md'
        Slices = 8
        Why    = 'BYO Azure OpenAI / Foundry provider; isolated footprint, sequenced to avoid git contention'
    },
    [PSCustomObject]@{
        Number = 4
        Name   = 'Phase-AUTH-RBAC-SCAFFOLD'
        Path   = 'docs/plans/Phase-AUTH-RBAC-SCAFFOLD-PLAN.md'
        Slices = 8
        Why    = 'Auth model + SSO extension + RBAC scaffold; isolated, last so RBAC knows audit/OTel surfaces'
    }
)

# ---- Validate plan files exist ----
$missing = $plans | Where-Object { -not (Test-Path $_.Path) }
if ($missing) {
    Write-Error "Missing plan files:`n$($missing.Path -join "`n")"
    exit 2
}

# ---- DryRun: print order and exit ----
if ($DryRun) {
    Write-Host ''
    Write-Host '=== Priority-C Chain — Dry Run ===' -ForegroundColor Cyan
    Write-Host ''
    foreach ($p in $plans) {
        $marker = if ($p.Number -lt $StartFrom) { '[skip] ' } else { '       ' }
        Write-Host ("{0}{1}. {2} ({3} slices)" -f $marker, $p.Number, $p.Name, $p.Slices)
        Write-Host ("           {0}" -f $p.Why) -ForegroundColor DarkGray
        Write-Host ("           {0}" -f $p.Path) -ForegroundColor DarkGray
        Write-Host ''
    }
    Write-Host ("Quorum: {0}    StartFrom: {1}" -f $Quorum, $StartFrom) -ForegroundColor Yellow
    exit 0
}

# ---- Phase 1: Estimate ----
Write-Host ''
Write-Host '=== Priority-C Chain — Cost Estimate ===' -ForegroundColor Cyan
Write-Host ''

$estimates = @()
$totalLow = 0.0
$totalHigh = 0.0

foreach ($p in $plans) {
    if ($p.Number -lt $StartFrom) {
        Write-Host ("[skip] {0}. {1}" -f $p.Number, $p.Name) -ForegroundColor DarkGray
        continue
    }

    Write-Host ("[estimate] {0}. {1} ({2} slices)..." -f $p.Number, $p.Name, $p.Slices) -ForegroundColor White

    # Manual-import bypass — these plans were authored from research dispatch in
    # docs/research/enterprise-fleet-readiness.md §14 Priority C, not via Crucible.
    # Bypass is audited in .forge/crucible/manual-imports.jsonl per Crucible policy.
    $reason = "enterprise-fleet-readiness.md §14 Priority C — research-derived plan ($($p.Name))"
    $estOutput = & ./pforge.ps1 run-plan $p.Path --estimate --quorum=$Quorum `
        --manual-import --manual-import-source human --manual-import-reason $reason 2>&1 | Out-String
    $exit = $LASTEXITCODE

    if ($exit -ne 0) {
        Write-Host ('  ERROR (exit {0}):' -f $exit) -ForegroundColor Red
        Write-Host ($estOutput -split "`n" | Select-Object -Last 8 | Out-String) -ForegroundColor Red
        Write-Error ("Estimate failed for {0}. Halting chain." -f $p.Name)
        exit 3
    }

    # Parse a numeric range out of the estimate. pforge prints lines like "Total estimate: $1.50 - $3.50"
    $matchRange = [regex]::Match($estOutput, '\$(\d+(?:\.\d+)?)\s*[-–to]+\s*\$(\d+(?:\.\d+)?)')
    $matchSingle = [regex]::Match($estOutput, 'Total[^\$]*\$(\d+(?:\.\d+)?)')

    if ($matchRange.Success) {
        $low = [double]$matchRange.Groups[1].Value
        $high = [double]$matchRange.Groups[2].Value
    } elseif ($matchSingle.Success) {
        $low = $high = [double]$matchSingle.Groups[1].Value
    } else {
        # Fall back to the plan's authored estimate (in plan front-matter)
        $authored = Select-String -Path $p.Path -Pattern 'Estimated cost.*\$(\d+(?:\.\d+)?).*\$(\d+(?:\.\d+)?)' | Select-Object -First 1
        if ($authored) {
            $low  = [double]$authored.Matches[0].Groups[1].Value
            $high = [double]$authored.Matches[0].Groups[2].Value
            Write-Host ('  (using authored plan estimate — pforge estimate did not surface a numeric total)') -ForegroundColor DarkYellow
        } else {
            $low = 0; $high = 0
            Write-Host ('  (no numeric estimate parsed; assuming $0)') -ForegroundColor DarkYellow
        }
    }

    $totalLow  += $low
    $totalHigh += $high

    $estimates += [PSCustomObject]@{
        Plan = $p.Name
        Low  = $low
        High = $high
    }

    Write-Host ('  estimate: ${0:N2} - ${1:N2}' -f $low, $high) -ForegroundColor Green
}

Write-Host ''
Write-Host '--- Cost Summary ---' -ForegroundColor Cyan
$estimates | Format-Table -AutoSize
Write-Host ('Total estimated cost across {0} phases: ${1:N2} - ${2:N2}' -f $estimates.Count, $totalLow, $totalHigh) -ForegroundColor Yellow
Write-Host ('Quorum mode: {0}' -f $Quorum) -ForegroundColor Yellow
Write-Host ''

if ($EstimateOnly) {
    Write-Host '(EstimateOnly — exiting without execution.)' -ForegroundColor DarkGray
    exit 0
}

# ---- Confirmation gate ----
if (-not $Force) {
    $reply = Read-Host ('Proceed with execution of {0} phase(s)? [y/N]' -f $estimates.Count)
    if ($reply -notin @('y','Y','yes','YES')) {
        Write-Host 'Aborted by user.' -ForegroundColor Yellow
        exit 0
    }
}

# ---- Phase 2: Sequential execution with halt-on-failure ----
Write-Host ''
Write-Host '=== Priority-C Chain — Execution ===' -ForegroundColor Cyan
$results = @()
$chainStart = Get-Date

foreach ($p in $plans) {
    if ($p.Number -lt $StartFrom) {
        $results += [PSCustomObject]@{ Plan = $p.Name; Status = 'skipped'; DurationMin = 0 }
        continue
    }

    Write-Host ''
    Write-Host ('--- [{0}/4] {1} ---' -f $p.Number, $p.Name) -ForegroundColor White
    Write-Host ('Plan: {0}' -f $p.Path) -ForegroundColor DarkGray
    $sliceStart = Get-Date

    # Same manual-import bypass as the estimate phase.
    $reason = "enterprise-fleet-readiness.md §14 Priority C — research-derived plan ($($p.Name))"
    & ./pforge.ps1 run-plan $p.Path --quorum=$Quorum `
        --manual-import --manual-import-source human --manual-import-reason $reason
    $exit = $LASTEXITCODE
    $duration = (New-TimeSpan -Start $sliceStart -End (Get-Date)).TotalMinutes

    if ($exit -ne 0) {
        $results += [PSCustomObject]@{ Plan = $p.Name; Status = ('FAILED (exit ' + $exit + ')'); DurationMin = [math]::Round($duration, 1) }
        Write-Host ''
        Write-Host '=== CHAIN HALTED ===' -ForegroundColor Red
        Write-Host ('Phase {0} ({1}) failed with exit {2} after {3:N1} min.' -f $p.Number, $p.Name, $exit, $duration) -ForegroundColor Red
        Write-Host 'Remaining phases NOT executed.' -ForegroundColor Red
        $results | Format-Table -AutoSize
        exit 4
    }

    $results += [PSCustomObject]@{ Plan = $p.Name; Status = 'passed'; DurationMin = [math]::Round($duration, 1) }
    Write-Host ('  -> {0} passed in {1:N1} min' -f $p.Name, $duration) -ForegroundColor Green
}

# ---- Summary ----
$chainDuration = (New-TimeSpan -Start $chainStart -End (Get-Date)).TotalMinutes
Write-Host ''
Write-Host '=== CHAIN COMPLETE ===' -ForegroundColor Green
$results | Format-Table -AutoSize
Write-Host ('Total chain duration: {0:N1} min' -f $chainDuration) -ForegroundColor Yellow
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Review CHANGELOG [Unreleased] for the four new phase entries'
Write-Host '  2. Run: pforge analyze docs/plans/Phase-<NAME>-PLAN.md   (per-phase audit)'
Write-Host '  3. When ready to release, follow docs/RELEASE-CHECKLIST.md'
Write-Host ''
exit 0
