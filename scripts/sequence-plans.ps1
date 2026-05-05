#!/usr/bin/env pwsh
# Watches an in-flight pforge orchestrator (read PID from .forge/last-orch.pid),
# waits for it to finish, then kicks off the next plan in the queue.
#
# Usage:
#   pwsh -NoProfile -File scripts/sequence-plans.ps1 `
#     -NextPlan docs/plans/Phase-GITHUB-D-METRICS-LEADERBOARD-PLAN.md `
#     -Model claude-sonnet-4.6 `
#     -Reason "Phase D follows Phase B"
#
# Designed to run unattended overnight. Polls every 60s; on completion of the
# current orchestrator, validates exit (non-empty events.log + a 'run-completed'
# or 'run-failed' record), commits any pending changes, pushes, then dispatches
# the next plan.

param(
  [Parameter(Mandatory)] [string]$NextPlan,
  [string]$Model = "claude-sonnet-4.6",
  [string]$Reason = "Sequenced plan run",
  [string]$RepoRoot = (Get-Location).Path,
  [int]$PollSeconds = 60,
  [switch]$SkipCommitPush  # keep the door open for review-before-push
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot

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
  return (Get-Process -Id $ProcId -ErrorAction SilentlyContinue) -ne $null
}

function Get-LatestRunDir {
  $runs = Get-ChildItem (Join-Path $RepoRoot ".forge/runs") -Directory -ErrorAction SilentlyContinue
  if (-not $runs) { return $null }
  return ($runs | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Get-RunStatus {
  param([string]$RunDir)
  if (-not $RunDir -or -not (Test-Path "$RunDir/events.log")) { return "unknown" }
  $tail = Get-Content "$RunDir/events.log" -Tail 50
  if ($tail | Where-Object { $_ -match 'run-completed' }) { return "completed" }
  if ($tail | Where-Object { $_ -match 'run-failed|run-aborted' }) { return "failed" }
  return "in-progress"
}

# ─── Phase 1: wait for current run ───
$initialPid = Get-CurrentOrchestratorPid
if (-not $initialPid) {
  Write-Stamp "No orchestrator PID found in .forge/last-orch.pid — assuming nothing in flight." Yellow
} else {
  Write-Stamp "Watching orchestrator PID $initialPid (poll every ${PollSeconds}s)..." Cyan
  $runDir = Get-LatestRunDir
  Write-Stamp "Run dir: $runDir" DarkGray

  $iters = 0
  while (Test-OrchestratorAlive -ProcId $initialPid) {
    Start-Sleep -Seconds $PollSeconds
    $iters++
    if (($iters % 5) -eq 0) {
      $tail = if (Test-Path "$runDir/events.log") { Get-Content "$runDir/events.log" -Tail 1 } else { "(no log)" }
      Write-Stamp "Still running (~$($iters * $PollSeconds / 60) min). Last event: $($tail.Substring(0, [Math]::Min(120, $tail.Length)))" DarkGray
    }
  }
  $finalStatus = Get-RunStatus -RunDir $runDir
  Write-Stamp "Orchestrator PID $initialPid exited. Final status: $finalStatus" Green
  if ($finalStatus -eq "failed") {
    Write-Stamp "Run failed — NOT proceeding to next plan. Inspect: $runDir" Red
    exit 1
  }
}

# ─── Phase 2: commit + push pending work ───
if (-not $SkipCommitPush) {
  $changes = git status --short
  if ($changes) {
    Write-Stamp "Committing in-flight Plan-Forge work before starting next plan..." Cyan
    git add -A 2>&1 | Out-Null
    $msg = "feat(autoplan): commit in-flight changes before sequenced next-plan ($(Split-Path $NextPlan -Leaf))"
    git commit -m $msg 2>&1 | ForEach-Object { Write-Stamp $_ DarkGray }
    git push origin master 2>&1 | ForEach-Object { Write-Stamp $_ DarkGray }
  } else {
    Write-Stamp "No pending changes to commit." DarkGray
  }
}

# ─── Phase 3: kick off next plan ───
if (-not (Test-Path $NextPlan)) {
  Write-Stamp "Next plan not found: $NextPlan" Red
  exit 1
}
Write-Stamp "Kicking off next plan: $NextPlan" Green
$cmd = @(
  "run-plan", $NextPlan,
  "--model", $Model,
  "--manual-import",
  "--manual-import-source", "human",
  "--manual-import-reason", $Reason
)
& (Join-Path $RepoRoot "pforge.ps1") @cmd
Write-Stamp "Sequencer done. Monitor next run via .forge/runs/" Green
