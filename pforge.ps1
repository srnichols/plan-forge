<#
.SYNOPSIS
    pforge — CLI wrapper for the Plan Forge Pipeline

.DESCRIPTION
    Convenience commands for common pipeline operations. Every command
    shows the equivalent manual steps so non-CLI users can learn.

.EXAMPLE
    .\pforge.ps1 help
    .\pforge.ps1 init -Preset dotnet -ProjectPath .
    .\pforge.ps1 check
    .\pforge.ps1 status
    .\pforge.ps1 new-phase user-auth
    .\pforge.ps1 branch docs/plans/Phase-1-USER-AUTH-PLAN.md
#>

param(
    [Parameter(Position = 0)]
    [string]$Command,

    [Parameter(Position = 1, ValueFromRemainingArguments)]
    [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'

# ─── Find repo root ───────────────────────────────────────────────────
function Find-RepoRoot {
    $dir = Get-Location
    while ($dir) {
        if (Test-Path (Join-Path $dir ".git")) { return $dir.ToString() }
        $parent = Split-Path $dir -Parent
        if ($parent -eq $dir) { break }
        $dir = $parent
    }
    Write-Host "ERROR: Not inside a git repository." -ForegroundColor Red
    exit 2
}

$RepoRoot = Find-RepoRoot

# ─── Helpers ───────────────────────────────────────────────────────────
function Write-ManualSteps([string]$Title, [string[]]$Steps) {
    Write-Host ""
    Write-Host "Equivalent manual steps ($Title):" -ForegroundColor DarkGray
    $i = 1
    foreach ($s in $Steps) {
        Write-Host "  $i. $s" -ForegroundColor DarkGray
        $i++
    }
    Write-Host ""
}

function Show-Help {
    Write-Host ""
    Write-Host "pforge — Plan Forge Pipeline CLI" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "COMMANDS:" -ForegroundColor Yellow
    Write-Host "  init              Bootstrap project with setup wizard (delegates to setup.ps1)"
    Write-Host "  check             Validate setup (delegates to validate-setup.ps1)"
    Write-Host "  status            Show all phases from DEPLOYMENT-ROADMAP.md with status"
    Write-Host "  new-phase <name>  Create a new phase plan file and add to roadmap"
    Write-Host "  branch <plan>     Create branch matching plan's declared Branch Strategy"
    Write-Host "  ext install <p>   Install extension from path"
    Write-Host "  ext list          List installed extensions"
    Write-Host "  ext remove <name> Remove an installed extension"
    Write-Host "  help              Show this help message"
    Write-Host ""
    Write-Host "OPTIONS:" -ForegroundColor Yellow
    Write-Host "  --dry-run         Show what would be done without making changes"
    Write-Host "  --force           Skip confirmation prompts"
    Write-Host "  --help            Show help for a specific command"
    Write-Host ""
    Write-Host "EXAMPLES:" -ForegroundColor Yellow
    Write-Host "  .\pforge.ps1 init -Preset dotnet"
    Write-Host "  .\pforge.ps1 status"
    Write-Host "  .\pforge.ps1 new-phase user-auth"
    Write-Host "  .\pforge.ps1 new-phase user-auth --dry-run"
    Write-Host "  .\pforge.ps1 branch docs/plans/Phase-1-USER-AUTH-PLAN.md"
    Write-Host "  .\pforge.ps1 ext list"
    Write-Host ""
}

# ─── Command: init ─────────────────────────────────────────────────────
function Invoke-Init {
    Write-ManualSteps "init" @(
        "Run: .\setup.ps1 (with your preferred parameters)"
        "Follow the interactive wizard"
    )
    $setupScript = Join-Path $RepoRoot "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        Write-Host "ERROR: setup.ps1 not found at $setupScript" -ForegroundColor Red
        exit 1
    }
    & $setupScript @Arguments
}

# ─── Command: check ────────────────────────────────────────────────────
function Invoke-Check {
    Write-ManualSteps "check" @(
        "Run: .\validate-setup.ps1"
        "Review the output for any missing files"
    )
    $validateScript = Join-Path $RepoRoot "validate-setup.ps1"
    if (-not (Test-Path $validateScript)) {
        Write-Host "ERROR: validate-setup.ps1 not found at $validateScript" -ForegroundColor Red
        exit 1
    }
    & $validateScript @Arguments
}

# ─── Command: status ───────────────────────────────────────────────────
function Invoke-Status {
    Write-ManualSteps "status" @(
        "Open docs/plans/DEPLOYMENT-ROADMAP.md"
        "Review the Phases section for status icons"
    )
    $roadmap = Join-Path $RepoRoot "docs/plans/DEPLOYMENT-ROADMAP.md"
    if (-not (Test-Path $roadmap)) {
        Write-Host "ERROR: DEPLOYMENT-ROADMAP.md not found." -ForegroundColor Red
        Write-Host "  Expected at: $roadmap" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "Phase Status (from DEPLOYMENT-ROADMAP.md):" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray

    $content = Get-Content $roadmap -Raw
    $phasePattern = '###\s+Phase\s+\d+.*'
    $statusPattern = '\*\*Status\*\*:\s*(.*)'
    $goalPattern = '\*\*Goal\*\*:\s*(.*)'

    $lines = Get-Content $roadmap
    $currentPhase = $null
    $currentGoal = $null

    foreach ($line in $lines) {
        if ($line -match '###\s+(Phase\s+\d+.*)') {
            $currentPhase = $Matches[1].Trim()
        }
        elseif ($line -match '\*\*Goal\*\*:\s*(.+)') {
            $currentGoal = $Matches[1].Trim()
        }
        elseif ($line -match '\*\*Status\*\*:\s*(.+)') {
            $status = $Matches[1].Trim()
            if ($currentPhase) {
                Write-Host "  $currentPhase" -ForegroundColor White -NoNewline
                Write-Host "  $status" -ForegroundColor Yellow
                if ($currentGoal) {
                    Write-Host "    $currentGoal" -ForegroundColor DarkGray
                }
                $currentPhase = $null
                $currentGoal = $null
            }
        }
    }
    Write-Host ""
}

# ─── Command: new-phase ────────────────────────────────────────────────
function Invoke-NewPhase {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "ERROR: Phase name required." -ForegroundColor Red
        Write-Host "  Usage: pforge new-phase <name>" -ForegroundColor Yellow
        exit 1
    }

    $phaseName = $Arguments[0]
    $dryRun = $Arguments -contains '--dry-run'
    $upperName = $phaseName.ToUpper() -replace '\s+', '-'

    # Find next phase number
    $plansDir = Join-Path $RepoRoot "docs/plans"
    $existing = Get-ChildItem -Path $plansDir -Filter "Phase-*-PLAN.md" -ErrorAction SilentlyContinue
    $nextNum = 1
    foreach ($f in $existing) {
        if ($f.Name -match 'Phase-(\d+)') {
            $num = [int]$Matches[1]
            if ($num -ge $nextNum) { $nextNum = $num + 1 }
        }
    }

    $fileName = "Phase-$nextNum-$upperName-PLAN.md"
    $filePath = Join-Path $plansDir $fileName

    Write-ManualSteps "new-phase" @(
        "Create file: docs/plans/$fileName"
        "Add phase entry to docs/plans/DEPLOYMENT-ROADMAP.md"
        "Fill in the plan using Step 1 (Draft) from the runbook"
    )

    if ($dryRun) {
        Write-Host "[DRY RUN] Would create: $filePath" -ForegroundColor Yellow
        Write-Host "[DRY RUN] Would add Phase $nextNum entry to DEPLOYMENT-ROADMAP.md" -ForegroundColor Yellow
        return
    }

    # Create plan file
    $template = @"
# Phase $nextNum`: $phaseName

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase $nextNum
> **Status**: 📋 Planned

---

## Overview

(Describe what this phase delivers)

---

## Prerequisites

- [ ] (list prerequisites)

## Acceptance Criteria

- [ ] (list measurable criteria)

---

## Execution Slices

(To be added during Plan Hardening — Step 2)
"@

    Set-Content -Path $filePath -Value $template
    Write-Host "CREATED  $filePath" -ForegroundColor Green

    # Add entry to roadmap
    $roadmap = Join-Path $RepoRoot "docs/plans/DEPLOYMENT-ROADMAP.md"
    if (Test-Path $roadmap) {
        $roadmapContent = Get-Content $roadmap -Raw
        $entry = @"

---

### Phase ${nextNum}: $phaseName
**Goal**: (one-line description)
**Plan**: [$fileName](./$fileName)
**Status**: 📋 Planned
"@
        # Insert before "## Completed Phases" if it exists, otherwise append
        if ($roadmapContent -match '## Completed Phases') {
            $roadmapContent = $roadmapContent -replace '## Completed Phases', "$entry`n`n## Completed Phases"
        }
        else {
            $roadmapContent += $entry
        }
        Set-Content -Path $roadmap -Value $roadmapContent -NoNewline
        Write-Host "UPDATED  DEPLOYMENT-ROADMAP.md (added Phase $nextNum)" -ForegroundColor Green
    }
}

# ─── Command: branch ───────────────────────────────────────────────────
function Invoke-Branch {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "ERROR: Plan file path required." -ForegroundColor Red
        Write-Host "  Usage: pforge branch <plan-file>" -ForegroundColor Yellow
        exit 1
    }

    $planFile = $Arguments[0]
    $dryRun = $Arguments -contains '--dry-run'

    if (-not (Test-Path $planFile)) {
        $planFile = Join-Path $RepoRoot $planFile
    }
    if (-not (Test-Path $planFile)) {
        Write-Host "ERROR: Plan file not found: $($Arguments[0])" -ForegroundColor Red
        exit 1
    }

    $content = Get-Content $planFile -Raw

    # Extract branch name from Branch Strategy section
    $branchName = $null
    if ($content -match '\*\*Branch\*\*:\s*`([^`]+)`') {
        $branchName = $Matches[1]
    }
    elseif ($content -match '\*\*Branch\*\*:\s*"([^"]+)"') {
        $branchName = $Matches[1]
    }

    if (-not $branchName -or $branchName -eq 'trunk') {
        Write-Host "No branch strategy declared (or trunk). No branch to create." -ForegroundColor Yellow
        return
    }

    Write-ManualSteps "branch" @(
        "Read the Branch Strategy section in your plan"
        "Run: git checkout -b $branchName"
    )

    if ($dryRun) {
        Write-Host "[DRY RUN] Would create branch: $branchName" -ForegroundColor Yellow
        return
    }

    git checkout -b $branchName
    Write-Host "CREATED  branch: $branchName" -ForegroundColor Green
}

# ─── Command: ext ──────────────────────────────────────────────────────
function Invoke-Ext {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "Extension commands:" -ForegroundColor Cyan
        Write-Host "  ext install <path>  Install extension from path"
        Write-Host "  ext list            List installed extensions"
        Write-Host "  ext remove <name>   Remove an installed extension"
        return
    }

    $subCmd = $Arguments[0]
    $extArgs = if ($Arguments.Count -gt 1) { $Arguments[1..($Arguments.Count - 1)] } else { @() }

    switch ($subCmd) {
        'install' { Invoke-ExtInstall $extArgs }
        'list'    { Invoke-ExtList }
        'remove'  { Invoke-ExtRemove $extArgs }
        default   {
            Write-Host "ERROR: Unknown ext command: $subCmd" -ForegroundColor Red
            Write-Host "  Available: install, list, remove" -ForegroundColor Yellow
        }
    }
}

function Invoke-ExtInstall([string[]]$args_) {
    if (-not $args_ -or $args_.Count -eq 0) {
        Write-Host "ERROR: Extension path required." -ForegroundColor Red
        Write-Host "  Usage: pforge ext install <path-to-extension>" -ForegroundColor Yellow
        exit 1
    }

    $extPath = $args_[0]
    if (-not (Test-Path $extPath)) {
        $extPath = Join-Path $RepoRoot $extPath
    }

    $manifestPath = Join-Path $extPath "extension.json"
    if (-not (Test-Path $manifestPath)) {
        Write-Host "ERROR: extension.json not found in $extPath" -ForegroundColor Red
        exit 1
    }

    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $extName = $manifest.name

    Write-ManualSteps "ext install" @(
        "Copy extension folder to .plan-hardening/extensions/$extName/"
        "Copy files from instructions/ → .github/instructions/"
        "Copy files from agents/ → .github/agents/"
        "Copy files from prompts/ → .github/prompts/"
    )

    # Copy extension to .plan-hardening/extensions/
    $destDir = Join-Path $RepoRoot ".plan-hardening/extensions/$extName"
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path "$extPath/*" -Destination $destDir -Recurse -Force
    Write-Host "COPIED   extension to $destDir" -ForegroundColor Green

    # Install files
    $fileTypes = @(
        @{ Key = 'instructions'; Dest = '.github/instructions' }
        @{ Key = 'agents';       Dest = '.github/agents' }
        @{ Key = 'prompts';      Dest = '.github/prompts' }
    )

    foreach ($ft in $fileTypes) {
        $srcDir = Join-Path $destDir $ft.Key
        if (Test-Path $srcDir) {
            $destBase = Join-Path $RepoRoot $ft.Dest
            if (-not (Test-Path $destBase)) {
                New-Item -ItemType Directory -Path $destBase -Force | Out-Null
            }
            Get-ChildItem -Path $srcDir -File | ForEach-Object {
                $dst = Join-Path $destBase $_.Name
                if (-not (Test-Path $dst)) {
                    Copy-Item $_.FullName $dst
                    Write-Host "  INSTALL  $($ft.Dest)/$($_.Name)" -ForegroundColor Green
                }
                else {
                    Write-Host "  SKIP     $($ft.Dest)/$($_.Name) (exists)" -ForegroundColor Yellow
                }
            }
        }
    }

    # Update extensions.json
    $extJsonPath = Join-Path $RepoRoot ".plan-hardening/extensions/extensions.json"
    if (Test-Path $extJsonPath) {
        $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
    }
    else {
        $extJson = [PSCustomObject]@{
            description = "Installed Plan Hardening extensions"
            version     = "1.0.0"
            extensions  = @()
        }
    }

    $existing = $extJson.extensions | Where-Object { $_.name -eq $extName }
    if (-not $existing) {
        $entry = [PSCustomObject]@{
            name          = $extName
            version       = $manifest.version
            installedDate = (Get-Date -Format 'yyyy-MM-dd')
        }
        $extJson.extensions = @($extJson.extensions) + $entry
        $extJson | ConvertTo-Json -Depth 5 | Set-Content $extJsonPath
    }

    Write-Host ""
    Write-Host "Extension '$extName' installed." -ForegroundColor Green
}

function Invoke-ExtList {
    Write-ManualSteps "ext list" @(
        "Open .plan-hardening/extensions/extensions.json"
        "Review the extensions array"
    )

    $extJsonPath = Join-Path $RepoRoot ".plan-hardening/extensions/extensions.json"
    if (-not (Test-Path $extJsonPath)) {
        Write-Host "No extensions installed." -ForegroundColor Yellow
        return
    }

    $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
    if (-not $extJson.extensions -or $extJson.extensions.Count -eq 0) {
        Write-Host "No extensions installed." -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "Installed Extensions:" -ForegroundColor Cyan
    Write-Host "─────────────────────" -ForegroundColor DarkGray
    foreach ($ext in $extJson.extensions) {
        Write-Host "  $($ext.name) v$($ext.version)  (installed $($ext.installedDate))" -ForegroundColor White
    }
    Write-Host ""
}

function Invoke-ExtRemove([string[]]$args_) {
    if (-not $args_ -or $args_.Count -eq 0) {
        Write-Host "ERROR: Extension name required." -ForegroundColor Red
        Write-Host "  Usage: pforge ext remove <name>" -ForegroundColor Yellow
        exit 1
    }

    $extName = $args_[0]
    $forceFlag = $args_ -contains '--force'

    Write-ManualSteps "ext remove" @(
        "Remove extension files from .github/instructions/, .github/agents/, .github/prompts/"
        "Delete .plan-hardening/extensions/$extName/"
        "Update .plan-hardening/extensions/extensions.json"
    )

    # Read manifest to know which files to remove
    $extDir = Join-Path $RepoRoot ".plan-hardening/extensions/$extName"
    $manifestPath = Join-Path $extDir "extension.json"
    if (-not (Test-Path $manifestPath)) {
        Write-Host "ERROR: Extension '$extName' not found." -ForegroundColor Red
        exit 1
    }

    if (-not $forceFlag) {
        $confirm = Read-Host "Remove extension '$extName'? (y/N)"
        if ($confirm -notin @('y', 'Y', 'yes')) {
            Write-Host "Cancelled." -ForegroundColor Yellow
            return
        }
    }

    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

    # Remove installed files
    $fileTypes = @(
        @{ Key = 'instructions'; Dest = '.github/instructions' }
        @{ Key = 'agents';       Dest = '.github/agents' }
        @{ Key = 'prompts';      Dest = '.github/prompts' }
    )

    foreach ($ft in $fileTypes) {
        if ($manifest.files.PSObject.Properties[$ft.Key]) {
            foreach ($fileName in $manifest.files.($ft.Key)) {
                $filePath = Join-Path $RepoRoot "$($ft.Dest)/$fileName"
                if (Test-Path $filePath) {
                    Remove-Item $filePath
                    Write-Host "  REMOVE  $($ft.Dest)/$fileName" -ForegroundColor Red
                }
            }
        }
    }

    # Remove extension directory
    Remove-Item $extDir -Recurse -Force
    Write-Host "  REMOVE  .plan-hardening/extensions/$extName/" -ForegroundColor Red

    # Update extensions.json
    $extJsonPath = Join-Path $RepoRoot ".plan-hardening/extensions/extensions.json"
    if (Test-Path $extJsonPath) {
        $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
        $extJson.extensions = @($extJson.extensions | Where-Object { $_.name -ne $extName })
        $extJson | ConvertTo-Json -Depth 5 | Set-Content $extJsonPath
    }

    Write-Host ""
    Write-Host "Extension '$extName' removed." -ForegroundColor Green
}

# ─── Command Router ────────────────────────────────────────────────────
switch ($Command) {
    'init'      { Invoke-Init }
    'check'     { Invoke-Check }
    'status'    { Invoke-Status }
    'new-phase' { Invoke-NewPhase }
    'branch'    { Invoke-Branch }
    'ext'       { Invoke-Ext }
    'help'      { Show-Help }
    ''          { Show-Help }
    '--help'    { Show-Help }
    default {
        Write-Host "ERROR: Unknown command '$Command'" -ForegroundColor Red
        Show-Help
        exit 1
    }
}
