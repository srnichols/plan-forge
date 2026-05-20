#!/usr/bin/env pwsh
# Sync planning/main → master, filtering forbidden paths.
# Run from repo root. Assumes planning/main is at the desired release HEAD.
[CmdletBinding()]
param(
    [string] $ReleaseRange = 'v3.7.0..v3.9.2',
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# 1. Verify clean working tree, checkout master, pull
$status = git status --porcelain
if ($status) {
    Write-Error "Working tree not clean. Aborting.`n$status"
    exit 1
}

Write-Host '=== checkout master + pull ===' -ForegroundColor Cyan
git checkout master
git pull origin master
Write-Host ''

# 2. Preserve master-only files that should NOT be wiped
Write-Host '=== preserving master-only files ===' -ForegroundColor Cyan
$masterOnlyKeep = @(
    '.github/workflows/sync-master-to-planning.yml'
)
$saved = @{}
foreach ($f in $masterOnlyKeep) {
    if (Test-Path $f) {
        $saved[$f] = Get-Content $f -Raw
        Write-Host "  saved $f ($((Get-Item $f).Length) bytes)"
    }
}
Write-Host ''

# 3. Reset working tree + index to planning/main's tree (preserves HEAD ref)
Write-Host '=== read-tree planning/main onto master ===' -ForegroundColor Cyan
git read-tree --reset -u planning/main
Write-Host ''

# 4. Restore the master-only files
Write-Host '=== restoring master-only files ===' -ForegroundColor Cyan
foreach ($f in $masterOnlyKeep) {
    if ($saved.ContainsKey($f)) {
        $dir = Split-Path $f -Parent
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -Path $f -Value $saved[$f] -NoNewline
        git add $f
        Write-Host "  restored $f"
    }
}
Write-Host ''

# 5. Remove forbidden paths
Write-Host '=== removing forbidden paths ===' -ForegroundColor Cyan
$forbiddenFiles = @(
    'AGENTS.md',
    '.github/instructions/project-principles.instructions.md',
    'docs/plans/DEPLOYMENT-ROADMAP.md',
    'docs/plans/PROJECT-PRINCIPLES.md'
)
foreach ($f in $forbiddenFiles) {
    if (Test-Path $f) {
        git rm -f $f | Out-Null
        Write-Host "  rm $f"
    }
}

$forbiddenDirs = @(
    'docs/plans/archive',
    'docs/plans/cleanup-findings'
)
foreach ($d in $forbiddenDirs) {
    if (Test-Path $d) {
        git rm -rf $d | Out-Null
        Write-Host "  rm -rf $d/"
    }
}

# Phase-*-PLAN.md files at docs/plans/ root (NOT under examples/)
$phasePlans = Get-ChildItem -Path 'docs/plans' -Filter 'Phase-*-PLAN.md' -File -ErrorAction SilentlyContinue
foreach ($p in $phasePlans) {
    git rm -f $p.FullName | Out-Null
    Write-Host "  rm $($p.Name)"
}
Write-Host ''

# 6. Verify
Write-Host '=== verification ===' -ForegroundColor Cyan
$staleCheck = @(
    @{Path = 'AGENTS.md'; Should = 'absent'},
    @{Path = 'docs/plans/PROJECT-PRINCIPLES.md'; Should = 'absent'},
    @{Path = 'docs/plans/DEPLOYMENT-ROADMAP.md'; Should = 'absent'},
    @{Path = 'docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md'; Should = 'present'},
    @{Path = '.github/workflows/sync-master-to-planning.yml'; Should = 'present'},
    @{Path = 'VERSION'; Should = 'present'}
)
foreach ($c in $staleCheck) {
    $exists = Test-Path $c.Path
    $expected = if ($c.Should -eq 'present') { $true } else { $false }
    $marker = if ($exists -eq $expected) { 'OK ' } else { 'FAIL' }
    Write-Host "  [$marker] $($c.Path) ($($c.Should), actual=$(if ($exists) {'present'} else {'absent'}))"
}

$ver = (Get-Content VERSION -Raw).Trim()
Write-Host "  VERSION reads: $ver"
$staleCount = (Get-ChildItem -Path 'docs/plans' -Filter 'Phase-*-PLAN.md' -File -ErrorAction SilentlyContinue).Count
Write-Host "  docs/plans/Phase-*-PLAN.md (root): $staleCount"
Write-Host ''

if ($DryRun) {
    Write-Host '=== DRY RUN — not committing ===' -ForegroundColor Yellow
    Write-Host 'Staged stats:'
    git diff --cached --stat | Select-Object -Last 5
    Write-Host ''
    Write-Host 'To commit: re-run without -DryRun'
    exit 0
}

Write-Host '=== creating release sync commit ===' -ForegroundColor Cyan
$commitMsg = @"
chore(release): sync $ReleaseRange from planning/main

Brings master to v3.9.2 (Latest), backfilling v3.8.0, v3.8.1, v3.9.0, v3.9.1
along the way. All five GitHub Releases were cut at their respective release
commits on planning/main. This commit collapses the planning/main tree into
master with forbidden dev-only paths filtered out.

Filtered:
- AGENTS.md (planning/main-only per its preamble)
- docs/plans/Phase-*-PLAN.md (phase plans are dev artifacts)
- docs/plans/{archive,cleanup-findings}/ (dev artifacts)
- docs/plans/{PROJECT-PRINCIPLES,DEPLOYMENT-ROADMAP}.md (planning/main-only)
- .github/instructions/project-principles.instructions.md (ships from templates/)

Preserved master-only:
- .github/workflows/sync-master-to-planning.yml (master->planning sync workflow)
"@
git commit -m $commitMsg
Write-Host ''
git log --oneline -3
