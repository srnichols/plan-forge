# sequence-plans.psm1
# Shared helper functions for the sequence-plans sequencer.
# Imported by sequence-plans.ps1 via Import-Module.

function Get-CurrentOrchestratorPid {
  param([string]$RepoRoot = (Get-Location).Path)
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
  param([string]$RepoRoot = (Get-Location).Path)
  $runs = Get-ChildItem (Join-Path $RepoRoot ".forge/runs") -Directory -ErrorAction SilentlyContinue
  if (-not $runs) { return $null }
  return ($runs | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Get-RunStatus {
  param([string]$RunDir)
  if (-not $RunDir -or -not (Test-Path "$RunDir/events.log")) { return "unknown" }
  $tail = Get-Content "$RunDir/events.log" -Tail 50
  if ($tail | Where-Object { $_ -match 'run-failed|run-aborted' }) { return "failed" }

  # 'run-completed' is emitted on both success and partial-success runs. Inspect
  # the JSON payload for actual slice failures before declaring success.
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

Export-ModuleMember -Function Get-CurrentOrchestratorPid, Test-OrchestratorAlive, Get-LatestRunDir, Get-RunStatus
