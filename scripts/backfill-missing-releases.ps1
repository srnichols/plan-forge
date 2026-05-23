# Backfill missing GitHub tags + Releases for versions shipped to master
# without following the release checklist (issue: pforge self-update stranding).
#
# Idempotent: skips any version where the tag OR release already exists.
# Run from repo root.
#
# Usage:
#   .\scripts\backfill-missing-releases.ps1                 # process all
#   .\scripts\backfill-missing-releases.ps1 -Only v2.95.0   # one version
#   .\scripts\backfill-missing-releases.ps1 -DryRun         # show actions, do nothing
[CmdletBinding()]
param(
    [string]$Only,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# (version, sha) pairs in chronological order
$plan = @(
    @{ Version = 'v2.95.0'; Sha = 'e6eb6685d2' }
    @{ Version = 'v2.96.0'; Sha = 'fe7a2e7092' }
    @{ Version = 'v2.96.1'; Sha = '9211c9370d' }
    @{ Version = 'v2.96.2'; Sha = 'd6405c10d9' }
    @{ Version = 'v2.96.3'; Sha = 'b284b6dabd' }
    @{ Version = 'v2.96.4'; Sha = 'c22386a5b1' }
    @{ Version = 'v2.98.0'; Sha = '657f56495e' }
    @{ Version = 'v2.99.0'; Sha = '277d8ed109' }
    @{ Version = 'v2.99.1'; Sha = '67a54dbe42' }
    @{ Version = 'v3.0.0';  Sha = '97aa9871bc' }
    @{ Version = 'v3.0.1';  Sha = '53cc1cfbf6' }
    @{ Version = 'v3.1.0';  Sha = '4a469e31c5' }
    @{ Version = 'v3.1.1';  Sha = 'c68230b717' }
    @{ Version = 'v3.1.2';  Sha = 'a7a5ef05c6' }
    @{ Version = 'v3.2.0';  Sha = '6c15162f54' }
    @{ Version = 'v3.2.1';  Sha = '3cbcc4c6c5' }
    @{ Version = 'v3.3.0';  Sha = '54b77d8' }
    @{ Version = 'v3.3.1';  Sha = '5e58b3a' }
    @{ Version = 'v3.4.0';  Sha = '5c8c8bd' }
)

function Extract-ChangelogSection {
    param([string]$VersionNumeric)
    $pattern = "^## \[$([regex]::Escape($VersionNumeric))\]"
    $lines = Get-Content CHANGELOG.md
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) { $start = $i; break }
    }
    if ($start -lt 0) { return $null }
    # Find next "## [" header
    $end = $lines.Count
    for ($j = $start + 1; $j -lt $lines.Count; $j++) {
        if ($lines[$j] -match '^## \[') { $end = $j; break }
    }
    # Section is from $start (header) up to (but not including) $end
    return ($lines[$start..($end - 1)] -join "`n").TrimEnd()
}

function Get-Title {
    param([string]$Section)
    $first = ($Section -split "`n")[0]
    # "## [3.2.0] — 2026-05-17" -> "3.2.0 — 2026-05-17"
    if ($first -match '^## \[([^\]]+)\](\s*(.+))?$') {
        $v = $matches[1]
        $rest = $matches[3]
        if ($rest) { return "v$v $rest".Trim() }
        return "v$v"
    }
    return $first
}

$results = @()
foreach ($entry in $plan) {
    $tag = $entry.Version
    $sha = $entry.Sha
    $numeric = $tag.TrimStart('v')

    if ($Only -and $Only -ne $tag) { continue }

    Write-Host ""
    Write-Host "=== $tag @ $sha ===" -ForegroundColor Cyan

    # Verify SHA points at a commit with matching clean VERSION
    $versionAtSha = (git show "${sha}:VERSION" 2>$null).Trim()
    if ($versionAtSha -ne $numeric) {
        Write-Host "  SKIP: SHA $sha has VERSION='$versionAtSha', expected '$numeric'" -ForegroundColor Red
        $results += [pscustomobject]@{ Tag = $tag; Status = 'sha-mismatch'; Detail = "VERSION=$versionAtSha" }
        continue
    }
    Write-Host "  VERSION at SHA: OK ($versionAtSha)"

    # Tag existence
    $tagExists = (git tag -l $tag)
    if ($tagExists) {
        Write-Host "  Tag $tag already exists locally" -ForegroundColor Yellow
    } else {
        Write-Host "  Tag ${tag}: WILL CREATE"
    }

    # Release existence
    $releaseExists = $false
    try {
        $null = gh release view $tag --repo srnichols/plan-forge 2>$null
        if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
    } catch {
        Write-Verbose "Could not query gh release view ${tag}: $($_.Exception.Message)"
    }
    if ($releaseExists) {
        Write-Host "  Release $tag already exists on GitHub" -ForegroundColor Yellow
    } else {
        Write-Host "  Release ${tag}: WILL CREATE"
    }

    if ($tagExists -and $releaseExists) {
        $results += [pscustomobject]@{ Tag = $tag; Status = 'already-done' }
        continue
    }

    # Extract notes
    $section = Extract-ChangelogSection -VersionNumeric $numeric
    if (-not $section) {
        Write-Host "  SKIP: no CHANGELOG section for [$numeric]" -ForegroundColor Red
        $results += [pscustomobject]@{ Tag = $tag; Status = 'no-changelog' }
        continue
    }
    $title = Get-Title -Section $section

    if ($DryRun) {
        Write-Host "  DRY-RUN: title='$title'"
        Write-Host "  DRY-RUN: notes-bytes=$($section.Length)"
        $results += [pscustomobject]@{ Tag = $tag; Status = 'dry-run' }
        continue
    }

    # Write notes to temp file
    $notesFile = New-TemporaryFile
    $section | Set-Content -Path $notesFile.FullName -Encoding utf8 -NoNewline

    try {
        if (-not $tagExists) {
            Write-Host "  Creating tag..."
            git tag -a $tag $sha -m "$title (backfilled $(Get-Date -Format yyyy-MM-dd))"
            if ($LASTEXITCODE -ne 0) { throw "git tag failed" }
            git push origin $tag
            if ($LASTEXITCODE -ne 0) { throw "git push tag failed" }
        }

        if (-not $releaseExists) {
            Write-Host "  Creating GitHub Release..."
            gh release create $tag --repo srnichols/plan-forge --title $title --notes-file $notesFile.FullName --verify-tag
            if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
        }

        $results += [pscustomobject]@{ Tag = $tag; Status = 'ok' }
        Write-Host "  DONE" -ForegroundColor Green
    } catch {
        $results += [pscustomobject]@{ Tag = $tag; Status = 'error'; Detail = $_.Exception.Message }
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        Remove-Item $notesFile.FullName -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "=== SUMMARY ==="
$results | Format-Table -AutoSize
