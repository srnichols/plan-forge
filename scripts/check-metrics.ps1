#!/usr/bin/env pwsh
# ============================================================================
# check-metrics.ps1 — Metrics drift detector
# ----------------------------------------------------------------------------
# Scans documentation surfaces for stale aliases defined in docs/_metrics.json.
# Does NOT modify files. Prints a report of any drift found.
#
# Usage:
#   pwsh scripts/check-metrics.ps1
#   pwsh scripts/check-metrics.ps1 -Strict   # exit 1 on any drift (for CI)
# ============================================================================

param(
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$metricsPath = Join-Path $repoRoot 'docs/_metrics.json'
if (-not (Test-Path $metricsPath)) {
    Write-Error "docs/_metrics.json not found at $metricsPath"
    exit 2
}

$metrics = Get-Content $metricsPath -Raw | ConvertFrom-Json
$stale = $metrics._knownStaleAliases

# Files to scan — user-facing documentation only.
# Excludes CHANGELOG (historical record), /memories/ (session notes), and
# anything under docs/plans/ (archived plans reference old numbers legitimately).
$scanPatterns = @(
    'README.md',
    'docs/*.html',
    'docs/*.md',
    'docs/manual/*.html',
    'docs/blog/*.html'
)

$targets = @()
foreach ($pattern in $scanPatterns) {
    $full = Join-Path $repoRoot $pattern
    $targets += Get-ChildItem -Path $full -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '_metrics.json' -and $_.Name -ne 'CHANGELOG.md' }
}

Write-Host "Scanning $($targets.Count) files for stale metric aliases..." -ForegroundColor Cyan
Write-Host ""

$findings = @()

# Numeric aliases — match as whole-word in common metric contexts.
$numericChecks = @(
    @{ Name = 'MCP tools'; Aliases = $stale.mcpTools;
       Patterns = @('{0} MCP tool', '{0} tools \(', '\({0} tools\)', 'all {0} tools') },
    @{ Name = 'Dashboard tabs'; Aliases = $stale.dashboardTabs;
       Patterns = @('{0} tabs', '{0} real-time tabs', 'with {0} tabs') },
    @{ Name = 'Tests passing'; Aliases = $stale.testsPassing;
       Patterns = @('{0}/{0}', '{0} self-test', '{0} tests passing', '{0}/{0} self-tests') },
    @{ Name = 'Agents'; Aliases = $stale.agents;
       Patterns = @('{0} agent', '{0} reviewer agent', '{0} Agents \b') },
    @{ Name = 'Skills'; Aliases = $stale.skills;
       Patterns = @('{0} skill', '{0} Skills \b') },
    @{ Name = 'Manual chapters'; Aliases = $stale.manualChapters;
       Patterns = @('{0} chapter') }
)

foreach ($check in $numericChecks) {
    foreach ($alias in $check.Aliases) {
        foreach ($patternTemplate in $check.Patterns) {
            $pattern = $patternTemplate -f $alias
            foreach ($file in $targets) {
                $matches = Select-String -Path $file.FullName -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
                foreach ($m in $matches) {
                    $findings += [PSCustomObject]@{
                        Category = $check.Name
                        StaleValue = $alias
                        File = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
                        Line = $m.LineNumber
                        Text = $m.Line.Trim()
                    }
                }
            }
        }
    }
}

# String aliases — old version badges.
foreach ($alias in $stale.versionBadges) {
    foreach ($file in $targets) {
        $matches = Select-String -Path $file.FullName -Pattern ([regex]::Escape($alias)) -AllMatches -ErrorAction SilentlyContinue
        foreach ($m in $matches) {
            $findings += [PSCustomObject]@{
                Category = 'Version badge'
                StaleValue = $alias
                File = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
                Line = $m.LineNumber
                Text = $m.Line.Trim()
            }
        }
    }
}

# Report.
if ($findings.Count -eq 0) {
    Write-Host "[OK] No stale metric aliases found." -ForegroundColor Green
    Write-Host ""
    Write-Host "Current canonical values (docs/_metrics.json):" -ForegroundColor Gray
    Write-Host ("  version           : {0}" -f $metrics.version)
    Write-Host ("  tests             : {0}/{1}" -f $metrics.testsPassing, $metrics.testsTotal)
    Write-Host ("  MCP tools         : {0}" -f $metrics.mcpTools.total)
    Write-Host ("  dashboard tabs    : {0}" -f $metrics.dashboardTabs)
    Write-Host ("  agents            : {0}" -f $metrics.agents)
    Write-Host ("  skills            : {0}" -f $metrics.skills)
    Write-Host ("  manual chapters   : {0}" -f $metrics.manualChapters)
    exit 0
}

Write-Host "[DRIFT] $($findings.Count) stale reference(s) found:" -ForegroundColor Yellow
Write-Host ""

$findings | Group-Object Category | ForEach-Object {
    Write-Host ("--- {0} ---" -f $_.Name) -ForegroundColor Magenta
    $_.Group | ForEach-Object {
        Write-Host ("  {0}:{1}" -f $_.File, $_.Line) -ForegroundColor Cyan
        Write-Host ("    stale value: {0}" -f $_.StaleValue) -ForegroundColor Yellow
        Write-Host ("    text       : {0}" -f $_.Text) -ForegroundColor Gray
        Write-Host ""
    }
}

Write-Host ("Total drift findings: {0}" -f $findings.Count) -ForegroundColor Yellow
Write-Host "Update docs/_metrics.json first if a stale value is now correct." -ForegroundColor Gray
Write-Host "Then fix the surfaces above to match the canonical values." -ForegroundColor Gray

if ($Strict) {
    exit 1
}
exit 0
