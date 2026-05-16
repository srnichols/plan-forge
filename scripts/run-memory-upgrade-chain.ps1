#!/usr/bin/env pwsh
# Memory upgrade chain — runs Phases 1, 3, 4, 5, 6 sequentially with halt-on-failure.
# Phase 2 (PROVENANCE) lives in the OpenBrain repo and must be handled separately.
#
# Usage:
#   ./scripts/run-memory-upgrade-chain.ps1                     # full chain
#   ./scripts/run-memory-upgrade-chain.ps1 -StartAt 3          # resume from Phase-ANVIL
#   ./scripts/run-memory-upgrade-chain.ps1 -DryRun             # estimate only, no execution
#
# Exit codes:
#   0 — all phases passed
#   N — phase N failed (1..5 maps to chain position, not original phase number)

[CmdletBinding()]
param(
    [int]$StartAt = 1,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location -Path (Split-Path -Parent $PSScriptRoot)

$plans = @(
    @{ Pos = 1; Name = "Phase-HALLMARK-CONTRACT"; Path = "docs/plans/Phase-HALLMARK-CONTRACT-PLAN.md" },
    @{ Pos = 2; Name = "Phase-ANVIL";             Path = "docs/plans/Phase-ANVIL-PLAN.md" },
    @{ Pos = 3; Name = "Phase-LATTICE";           Path = "docs/plans/Phase-LATTICE-PLAN.md" },
    @{ Pos = 4; Name = "Phase-MEMORY-DOCS-SWEEP"; Path = "docs/plans/Phase-MEMORY-DOCS-SWEEP-PLAN.md" },
    @{ Pos = 5; Name = "Phase-MEMORY-QA";         Path = "docs/plans/Phase-MEMORY-QA-PLAN.md" }
)

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = ".forge/chain-logs/memory-upgrade-$stamp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$summaryFile = Join-Path $logDir "SUMMARY.md"

"# Memory Upgrade Chain — $stamp`n" | Out-File $summaryFile -Encoding utf8
"Started: $(Get-Date -Format o)`n"   | Out-File $summaryFile -Encoding utf8 -Append
"Mode: $(if ($DryRun) { 'DryRun (--estimate)' } else { 'Live (--foreground)' })`n" | Out-File $summaryFile -Encoding utf8 -Append
"NOTE: Phase 2 (PROVENANCE) lives in OpenBrain repo and is NOT in this chain.`n" | Out-File $summaryFile -Encoding utf8 -Append
"" | Out-File $summaryFile -Encoding utf8 -Append

Write-Host ""
Write-Host "================================================================"
Write-Host " Memory Upgrade Chain"
Write-Host " Log dir: $logDir"
Write-Host " Mode:    $(if ($DryRun) { 'DryRun' } else { 'Live (--foreground)' })"
Write-Host " StartAt: $StartAt"
Write-Host "================================================================"
Write-Host ""

foreach ($plan in $plans) {
    if ($plan.Pos -lt $StartAt) {
        Write-Host "[CHAIN] SKIP  $($plan.Name) (StartAt=$StartAt)" -ForegroundColor DarkGray
        "- SKIP  $($plan.Name)" | Out-File $summaryFile -Encoding utf8 -Append
        continue
    }

    $log = Join-Path $logDir "$($plan.Name).log"
    $sw  = [System.Diagnostics.Stopwatch]::StartNew()

    Write-Host ""
    Write-Host "----------------------------------------------------------------"
    Write-Host "[CHAIN] START $($plan.Name)" -ForegroundColor Cyan
    Write-Host "        plan: $($plan.Path)"
    Write-Host "        log:  $log"
    Write-Host "----------------------------------------------------------------"

    if ($DryRun) {
        & .\pforge.ps1 run-plan --estimate $plan.Path 2>&1 | Tee-Object -FilePath $log
    } else {
        & .\pforge.ps1 run-plan --foreground $plan.Path 2>&1 | Tee-Object -FilePath $log
    }
    $exit = $LASTEXITCODE
    $sw.Stop()
    $mins = [Math]::Round($sw.Elapsed.TotalMinutes, 1)

    if ($exit -ne 0) {
        Write-Host ""
        Write-Host "[CHAIN] FAIL  $($plan.Name) (exit=$exit, ${mins}m)" -ForegroundColor Red
        "- FAIL  $($plan.Name) (exit=$exit, ${mins}m)" | Out-File $summaryFile -Encoding utf8 -Append
        "" | Out-File $summaryFile -Encoding utf8 -Append
        "HALTED. Resume with: ./scripts/run-memory-upgrade-chain.ps1 -StartAt $($plan.Pos)" | Out-File $summaryFile -Encoding utf8 -Append
        Write-Host ""
        Write-Host "[CHAIN] HALTED. Resume with: ./scripts/run-memory-upgrade-chain.ps1 -StartAt $($plan.Pos)" -ForegroundColor Yellow
        exit $plan.Pos
    }

    Write-Host "[CHAIN] PASS  $($plan.Name) (${mins}m)" -ForegroundColor Green
    "- PASS  $($plan.Name) (${mins}m)" | Out-File $summaryFile -Encoding utf8 -Append
}

Write-Host ""
Write-Host "================================================================"
Write-Host " [CHAIN] ALL PHASES PASSED" -ForegroundColor Green
Write-Host "================================================================"
Write-Host ""
Write-Host " Reminder: Phase 2 (PROVENANCE) is in OpenBrain and was NOT run."
Write-Host " Schedule manually in e:\GitHub\OpenBrain before deploying v2.95.0."
Write-Host ""

"" | Out-File $summaryFile -Encoding utf8 -Append
"Finished: $(Get-Date -Format o)" | Out-File $summaryFile -Encoding utf8 -Append
"All in-scope phases passed." | Out-File $summaryFile -Encoding utf8 -Append

exit 0
