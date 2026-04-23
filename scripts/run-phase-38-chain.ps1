#!/usr/bin/env pwsh
# Chain-runner for Phase-38 plans. Launches pforge.ps1 run-plan (which forks
# the orchestrator into the background), captures the orchestrator PID from
# stdout, then Wait-Process on that PID before advancing. Aborts on any
# slice failure.
#
# Usage:
#   .\scripts\run-phase-38-chain.ps1                        # start from 38.5
#   .\scripts\run-phase-38-chain.ps1 -StartIndex 1          # start from 38.6
#   .\scripts\run-phase-38-chain.ps1 -SkipLaunch -WaitPid 31112  # attach to already-running 38.5

param(
    [int]$StartIndex = 0,
    [switch]$SkipLaunch,
    [int]$WaitPid = 0
)

$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot\.."

$plans = @(
    'docs/plans/Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md',
    'docs/plans/Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md',
    'docs/plans/Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md',
    'docs/plans/Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md'
)

$chainLog = ".forge/chain-phase-38.log"
if (-not (Test-Path $chainLog)) {
    "=== Phase-38 chain started $(Get-Date -Format o) ===" | Out-File $chainLog
}

function Check-Summary([string]$planName, [string]$logName) {
    $runRoot = Get-ChildItem .forge\runs -Directory |
        Where-Object { $_.Name -match [regex]::Escape($logName) } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $runRoot) {
        return @{ ok = $false; reason = "no run dir for $planName" }
    }
    $summaryPath = Join-Path $runRoot.FullName "summary.json"
    if (-not (Test-Path $summaryPath)) {
        return @{ ok = $false; reason = "no summary.json in $($runRoot.Name)" }
    }
    $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
    return @{
        ok     = ($summary.status -eq 'completed' -and $summary.results.failed -eq 0)
        status = $summary.status
        passed = $summary.results.passed
        failed = $summary.results.failed
        cost   = $summary.cost.total_cost_usd
        runDir = $runRoot.Name
    }
}

for ($i = $StartIndex; $i -lt $plans.Count; $i++) {
    $plan     = $plans[$i]
    $planName = Split-Path $plan -Leaf
    $logName  = $planName -replace '\.md$', ''
    $runLog   = ".forge/run-$logName.log"

    "`n==== START $planName $(Get-Date -Format o) ====" | Tee-Object -FilePath $chainLog -Append
    Write-Host "`n==== $planName ====" -ForegroundColor Cyan

    $orchPid = 0
    if ($SkipLaunch -and $WaitPid -gt 0 -and $i -eq $StartIndex) {
        $orchPid = $WaitPid
        Write-Host "Attaching to already-running orchestrator PID $orchPid" -ForegroundColor Yellow
    } else {
        # Launch orchestrator. `pforge.ps1 run-plan` forks the node orchestrator
        # and returns immediately with a line like "Orchestrator running in background  PID: 12345".
        $launchOut = & .\pforge.ps1 run-plan $plan --quorum=auto --model claude-opus-4.6 --manual-import 2>&1 |
            Tee-Object -FilePath $runLog
        $pidLine  = $launchOut | Select-String -Pattern 'PID:\s*(\d+)' | Select-Object -First 1
        if (-not $pidLine) {
            "!! could not capture orchestrator PID for $planName — abort" | Tee-Object -FilePath $chainLog -Append
            exit 1
        }
        $orchPid = [int]$pidLine.Matches[0].Groups[1].Value
        Write-Host "Orchestrator PID: $orchPid (waiting...)" -ForegroundColor DarkGray
    }

    # Wait for orchestrator to terminate. Phase-38.4 took ~33 min, so give
    # each plan a generous ceiling of 2h.
    try {
        Wait-Process -Id $orchPid -Timeout 7200 -ErrorAction Stop
    } catch {
        if ($_.Exception.Message -match 'Cannot find a process') {
            # Already gone — fine, continue to summary check.
        } elseif ($_.Exception.Message -match 'has not exited') {
            "!! $planName PID $orchPid still running after 2h — abort chain" | Tee-Object -FilePath $chainLog -Append
            exit 1
        } else {
            throw
        }
    }

    $result = Check-Summary $planName $logName
    if (-not $result.ok) {
        "!! $planName failed: $($result.reason) status=$($result.status) passed=$($result.passed) failed=$($result.failed)" |
            Tee-Object -FilePath $chainLog -Append
        Write-Host "ABORT: $planName — status=$($result.status), $($result.failed) failed slice(s)" -ForegroundColor Red
        exit 1
    }

    $msg = "$planName → status=$($result.status) passed=$($result.passed)/$($result.passed + $result.failed) cost=`$$($result.cost) runDir=$($result.runDir)"
    $msg | Tee-Object -FilePath $chainLog -Append
    Write-Host "PASSED $msg" -ForegroundColor Green

    $SkipLaunch = $false
}

"`n=== Phase-38 chain complete $(Get-Date -Format o) ===" | Tee-Object -FilePath $chainLog -Append
Write-Host "`n=== CHAIN COMPLETE ===" -ForegroundColor Green
#!/usr/bin/env pwsh
# Chain-runner for Phase-38.5 → 38.8. Runs each plan autonomously with
# --quorum=auto and the opus-4.6 worker. Waits for each orchestrator to
# terminate before advancing. Aborts the chain on any slice failure so the
# operator can triage before burning spend on the next plan.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$plans = @(
    'docs/plans/Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md',
    'docs/plans/Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md',
    'docs/plans/Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md',
    'docs/plans/Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md'
)

$chainLog = ".forge/chain-phase-38.log"
"=== Phase-38 chain started $(Get-Date -Format o) ===" | Out-File $chainLog

foreach ($plan in $plans) {
    $planName = Split-Path $plan -Leaf
    $logName  = $planName -replace '\.md$', ''
    $runLog   = ".forge/run-$logName.log"

    "`n==== START $planName $(Get-Date -Format o) ====" | Tee-Object -FilePath $chainLog -Append
    Write-Host "`n==== Launching $planName ====" -ForegroundColor Cyan

    # Foreground run (blocks until orchestrator terminates). --quorum=auto
    # routes per-slice complexity to the best quorum mode automatically.
    & .\pforge.ps1 run-plan $plan --quorum=auto --model claude-opus-4.6 --manual-import 2>&1 |
        Tee-Object -FilePath $runLog

    # Find the matching run dir (newest) and parse summary.json for status.
    $runRoot = Get-ChildItem .forge\runs -Directory |
        Where-Object { $_.Name -match [regex]::Escape($logName) } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $runRoot) {
        "!! no run dir for $planName — chain aborted" | Tee-Object -FilePath $chainLog -Append
        Write-Host "ABORT: no run dir produced for $planName" -ForegroundColor Red
        exit 1
    }

    $summaryPath = Join-Path $runRoot.FullName "summary.json"
    if (-not (Test-Path $summaryPath)) {
        "!! no summary.json in $($runRoot.Name) — chain aborted" | Tee-Object -FilePath $chainLog -Append
        Write-Host "ABORT: orchestrator did not write summary.json" -ForegroundColor Red
        exit 1
    }

    $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
    $status  = $summary.status
    $passed  = $summary.results.passed
    $failed  = $summary.results.failed
    $cost    = $summary.cost.total_cost_usd

    "$planName → status=$status passed=$passed failed=$failed cost=`$$cost" |
        Tee-Object -FilePath $chainLog -Append

    if ($status -ne 'completed' -or $failed -gt 0) {
        Write-Host "ABORT: $planName finished with failures ($failed failed)" -ForegroundColor Red
        exit 1
    }

    Write-Host "PASSED $planName ($passed slices, `$$cost)" -ForegroundColor Green
}

"`n=== Phase-38 chain complete $(Get-Date -Format o) ===" | Tee-Object -FilePath $chainLog -Append
Write-Host "`n=== CHAIN COMPLETE — all 4 phases shipped ===" -ForegroundColor Green
