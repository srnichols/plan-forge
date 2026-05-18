#!/usr/bin/env pwsh
# Watches an in-flight pforge orchestrator (read PID from .forge/last-orch.pid),
# waits for it to finish, then kicks off the next plan in the queue.
#
# Usage:
#   pwsh -NoProfile -File scripts/sequence-plans.ps1 `
#     -NextPlan docs/plans/archive/Phase-GITHUB-D-METRICS-LEADERBOARD-PLAN.md `
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

Import-Module (Join-Path $PSScriptRoot "sequence-plans.psm1") -Force

function Write-Stamp {
  param([string]$msg, [ConsoleColor]$color = "White")
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor $color
}

# ─── Phase 1: wait for current run ───
$initialPid = Get-CurrentOrchestratorPid -RepoRoot $RepoRoot
if (-not $initialPid) {
  Write-Stamp "No orchestrator PID found in .forge/last-orch.pid — assuming nothing in flight." Yellow
} else {
  Write-Stamp "Watching orchestrator PID $initialPid (poll every ${PollSeconds}s)..." Cyan
  $runDir = Get-LatestRunDir -RepoRoot $RepoRoot
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
  if ($finalStatus -ne "completed") {
    Write-Stamp "Run did not reach 'completed' (status=$finalStatus) - NOT proceeding to next plan. Inspect: $runDir" Red
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
