#!/usr/bin/env pwsh
# Cut 5 GH releases: v3.8.0, v3.8.1, v3.9.0, v3.9.1 (backfilled, not Latest)
# and v3.9.2 (marked Latest).
$titles = @{
    '3.8.0' = 'v3.8.0 - Auditor Automation & Observer (Phase-39)'
    '3.8.1' = 'v3.8.1 - forge-home orphan whitelist + cleanup CLI (Issue #203)'
    '3.9.0' = 'v3.9.0 - Embedding Status & Persistent TF-IDF Cache (Phase 56)'
    '3.9.1' = 'v3.9.1 - Local Recall Index Status (Phase 58)'
    '3.9.2' = 'v3.9.2 - Distribution Enumeration Fix'
}

function New-Release {
    param([string] $Version, [bool] $Latest)
    $notes = & pwsh -NoProfile -File scripts/extract-changelog-section.ps1 -Version $Version
    $tmp = [IO.Path]::GetTempFileName() + '.md'
    Set-Content -Path $tmp -Value $notes -Encoding utf8
    $latestFlag = if ($Latest) { '--latest' } else { '--latest=false' }
    Write-Host "=== creating v$Version (Latest=$Latest) ==="
    gh release create "v$Version" --title $titles[$Version] --notes-file $tmp --verify-tag $latestFlag 2>&1
    Remove-Item $tmp
    Write-Host ""
}

foreach ($v in @('3.8.0', '3.8.1', '3.9.0', '3.9.1')) {
    New-Release -Version $v -Latest $false
}
New-Release -Version '3.9.2' -Latest $true
