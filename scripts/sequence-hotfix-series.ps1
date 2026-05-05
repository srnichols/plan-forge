#!/usr/bin/env pwsh
# Multi-stage sequencer for the May 5 hotfix series.
# Watches each pforge run-plan in turn; only chains to the next when the
# previous returns status: completed AND failed: 0. Commits + pushes between.
#
# Usage:
#   pwsh -NoProfile -File scripts/sequence-hotfix-series.ps1
#
# This is a one-shot script for the v2.90.1..v2.90.6 hotfix series. After the
# series ships, scripts/sequence-plans.ps1 (the canonical version) gets the
# multi-stage feature folded in via Hotfix v2.90.5.

param(
  [string]$RepoRoot = (Get-Location).Path,
  [int]$PollSeconds = 60,
  [string]$Model = "claude-sonnet-4.6"
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot

$Plans = @(
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.1-WATCHDOG-PLAN.md";       Tag = "v2.90.1 watchdog" },
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.2-WORKER-TIMEOUT-PLAN.md"; Tag = "v2.90.2 worker timeout" },
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.3-GATE-LINTER-PLAN.md";    Tag = "v2.90.3 gate linter" },
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.4-COPILOT-AGENT-PROBE-PLAN.md"; Tag = "v2.90.4 copilot agent probe" },
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.5-SEQUENCER-SWEEP-PLAN.md"; Tag = "v2.90.5 sequencer sweep" },
  @{ Path = "docs/plans/Phase-Hotfix-v2.90.6-CHANGELOG-CLEANUP-PLAN.md"; Tag = "v2.90.6 changelog cleanup" }
)

function Write-Stamp {
  param([string]$msg, [ConsoleColor]$color = "White")
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor $color
}

function Get-CurrentOrchestratorPid {
  $pidFile = Join-Path $RepoRoot ".forge/last-orch.pid"
  if (-not (Test-Path $pidFile)) { return $null }
  $content = (Get-Content $pidFile -Raw).Trim()
  if ($content -match '^\d+$') { return [int]$content }
  return $null
}

function Test-OrchestratorAlive {
  param([int]$ProcId)
  if (-not $ProcId) { return $false }
  # Use Get-CimInstance for reliability — Get-Process can miss running PIDs
  return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" 2>$null) -ne $null
}

function Get-LatestRunDir {
  param([string]$PlanBasename)
  $runs = Get-ChildItem (Join-Path $RepoRoot ".forge/runs") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$PlanBasename*" }
  if (-not $runs) { return $null }
  return ($runs | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Get-RunStatus {
  param([string]$RunDir)
  if (-not $RunDir -or -not (Test-Path "$RunDir/events.log")) { return "unknown" }
  $tail = Get-Content "$RunDir/events.log" -Tail 50
  if ($tail | Where-Object { $_ -match 'run-failed|run-aborted' }) { return "failed" }
  $completed = $tail | Where-Object { $_ -match 'run-completed' } | Select-Object -Last 1
  if ($completed) {
    if ($completed -match '"failed":(\d+)') {
      $failedCount = [int]$Matches[1]
      if ($failedCount -gt 0) { return "failed" }
    }
    if ($completed -match '"status":"failed"') { return "failed" }
    return "completed"
  }
  return "in-progress"
}

function Invoke-PlanRun {
  param([string]$PlanPath, [string]$Tag)
  Write-Stamp "Dispatching: $Tag" Cyan
  $cmd = @(
    "run-plan", $PlanPath,
    "--model", $Model,
    "--manual-import",
    "--manual-import-source", "human",
    "--manual-import-reason", "Hotfix series sequenced run: $Tag"
  )
  & (Join-Path $RepoRoot "pforge.ps1") @cmd
  Start-Sleep -Seconds 5  # let pid file flush
}

function Watch-Orchestrator {
  param([string]$Tag)
  $orchPid = Get-CurrentOrchestratorPid
  if (-not $orchPid) {
    Write-Stamp "No orchestrator pid found for $Tag — assume cold start ok" Yellow
    return $true
  }
  Write-Stamp "Watching PID $orchPid for $Tag (poll every ${PollSeconds}s)..." Cyan
  $iters = 0
  while (Test-OrchestratorAlive -ProcId $orchPid) {
    Start-Sleep -Seconds $PollSeconds
    $iters++
    if (($iters % 5) -eq 0) {
      $planBase = $Plans | Where-Object { $_.Tag -eq $Tag } | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Path) }
      $runDir = Get-LatestRunDir -PlanBasename $planBase
      $tail = if ($runDir -and (Test-Path "$runDir/events.log")) { Get-Content "$runDir/events.log" -Tail 1 } else { "(no log)" }
      $tailSnip = if ($tail.Length -gt 100) { $tail.Substring(0, 100) } else { $tail }
      Write-Stamp "  ~$($iters * $PollSeconds / 60) min elapsed | last event: $tailSnip" DarkGray
    }
  }
  $planBase = $Plans | Where-Object { $_.Tag -eq $Tag } | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Path) }
  $runDir = Get-LatestRunDir -PlanBasename $planBase
  $finalStatus = Get-RunStatus -RunDir $runDir
  Write-Stamp "PID $orchPid exited. Status: $finalStatus" Green
  if ($finalStatus -ne "completed") {
    Write-Stamp "Hotfix $Tag did not reach completed status — STOPPING SERIES." Red
    Write-Stamp "  Inspect: $runDir" Red
    return $false
  }
  return $true
}

function Invoke-CommitAndPush {
  param([string]$Tag)
  $changes = git status --short
  if ($changes) {
    Write-Stamp "Committing in-flight changes from $Tag" Cyan
    git add -A 2>&1 | Out-Null
    $msg = "feat(autoplan): commit in-flight changes from $Tag (sequenced)"
    git commit -m $msg 2>&1 | ForEach-Object { Write-Stamp "  $_" DarkGray }
    git push origin master 2>&1 | ForEach-Object { Write-Stamp "  $_" DarkGray }
  } else {
    Write-Stamp "No pending changes after $Tag" DarkGray
  }
}

# ─── Main loop ───
Write-Stamp "Starting hotfix series — $($Plans.Count) plans queued" Green
$completed = 0
foreach ($p in $Plans) {
  Write-Stamp "" White
  Write-Stamp "════════════════════════════════════════════════════════" Magenta
  Write-Stamp "STAGE $($completed + 1)/$($Plans.Count): $($p.Tag)" Magenta
  Write-Stamp "════════════════════════════════════════════════════════" Magenta

  if (-not (Test-Path (Join-Path $RepoRoot $p.Path))) {
    Write-Stamp "Plan not found: $($p.Path) — STOPPING SERIES." Red
    exit 1
  }

  Invoke-PlanRun -PlanPath $p.Path -Tag $p.Tag
  $ok = Watch-Orchestrator -Tag $p.Tag
  if (-not $ok) {
    Write-Stamp "" White
    Write-Stamp "SERIES HALTED at $($p.Tag). $completed/$($Plans.Count) shipped." Red
    exit 1
  }
  Invoke-CommitAndPush -Tag $p.Tag
  $completed++
}

Write-Stamp "" White
Write-Stamp "════════════════════════════════════════════════════════" Green
Write-Stamp "HOTFIX SERIES COMPLETE: $completed/$($Plans.Count) shipped" Green
Write-Stamp "════════════════════════════════════════════════════════" Green
