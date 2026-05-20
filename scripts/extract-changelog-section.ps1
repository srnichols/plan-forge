#!/usr/bin/env pwsh
# Extract a single version's CHANGELOG section as raw markdown
# Usage: pwsh scripts/extract-changelog-section.ps1 3.9.2
param(
    [Parameter(Mandatory)] [string] $Version,
    [string] $ChangelogPath = "CHANGELOG.md"
)
$lines = Get-Content $ChangelogPath
$startPat = "^## \[$([regex]::Escape($Version))\]"
$startMatch = $lines | Select-String -Pattern $startPat | Select-Object -First 1
if (-not $startMatch) { Write-Error "No CHANGELOG section for $Version"; exit 1 }
$startIdx = $startMatch.LineNumber - 1
$remaining = $lines[($startIdx + 1)..($lines.Count - 1)]
$endMatch = $remaining | Select-String -Pattern '^## \[' | Select-Object -First 1
$endIdx = if ($endMatch) { $startIdx + $endMatch.LineNumber - 1 } else { $lines.Count }
($lines[($startIdx + 1)..($endIdx - 1)] -join "`n").TrimEnd()
