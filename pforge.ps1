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
    Write-Host "  commit <plan> <N> Commit with conventional message from slice N's goal"
    Write-Host "  phase-status <plan> <status>  Update phase status in roadmap (planned|in-progress|complete|paused)"
    Write-Host "  sweep             Scan for TODO/FIXME/stub/placeholder markers in code files"
    Write-Host "  diff <plan>       Compare changed files against plan's Scope Contract"
    Write-Host "  ext install <p>   Install extension from path"
    Write-Host "  ext list          List installed extensions"
    Write-Host "  ext remove <name> Remove an installed extension"
    Write-Host "  update [source]   Update framework files from Plan Forge source (preserves customizations)"
    Write-Host "  analyze <plan>    Cross-artifact analysis — requirement traceability, test coverage, scope compliance"
    Write-Host "  run-plan <plan>   Execute a hardened plan — spawn CLI workers, validate at every boundary, track tokens"
    Write-Host "  smith             Inspect your forge — environment, VS Code config, setup health, and common problems"
    Write-Host "  help              Show this help message"
    Write-Host ""
    Write-Host "OPTIONS:" -ForegroundColor Yellow
    Write-Host "  --dry-run         Show what would be done without making changes"
    Write-Host "  --force           Skip confirmation prompts"
    Write-Host "  --help            Show help for a specific command"
    Write-Host ""
    Write-Host "EXAMPLES:" -ForegroundColor Yellow
    Write-Host "  .\pforge.ps1 init -Preset dotnet"
    Write-Host "  .\pforge.ps1 init -Preset azure-iac"
    Write-Host "  .\pforge.ps1 init -Preset dotnet,azure-iac"
    Write-Host "  .\pforge.ps1 status"
    Write-Host "  .\pforge.ps1 new-phase user-auth"
    Write-Host "  .\pforge.ps1 new-phase user-auth --dry-run"
    Write-Host "  .\pforge.ps1 branch docs/plans/Phase-1-USER-AUTH-PLAN.md"
    Write-Host "  .\pforge.ps1 run-plan docs/plans/Phase-1-AUTH-PLAN.md"
    Write-Host "  .\pforge.ps1 run-plan docs/plans/Phase-1-AUTH-PLAN.md --estimate"
    Write-Host "  .\pforge.ps1 run-plan docs/plans/Phase-1-AUTH-PLAN.md --assisted"
    Write-Host "  .\pforge.ps1 ext list"
    Write-Host "  .\pforge.ps1 update ../plan-forge"
    Write-Host "  .\pforge.ps1 update --dry-run"
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

# ─── Command: commit ───────────────────────────────────────────────────
function Invoke-Commit {
    if (-not $Arguments -or $Arguments.Count -lt 2) {
        Write-Host "ERROR: Plan file and slice number required." -ForegroundColor Red
        Write-Host "  Usage: pforge commit <plan-file> <slice-number>" -ForegroundColor Yellow
        exit 1
    }

    $planFile = $Arguments[0]
    $sliceNum = $Arguments[1]
    $dryRun = $Arguments -contains '--dry-run'

    if (-not (Test-Path $planFile)) {
        $planFile = Join-Path $RepoRoot $planFile
    }
    if (-not (Test-Path $planFile)) {
        Write-Host "ERROR: Plan file not found: $($Arguments[0])" -ForegroundColor Red
        exit 1
    }

    $content = Get-Content $planFile -Raw
    $planName = [System.IO.Path]::GetFileNameWithoutExtension($planFile)

    # Extract phase number from filename (Phase-N-...)
    $phaseNum = ""
    if ($planName -match 'Phase-(\d+)') { $phaseNum = $Matches[1] }

    # Extract slice goal from "### Slice N..." or "### Slice N.X — Title"
    $sliceGoal = "slice $sliceNum"
    if ($content -match "###\s+Slice\s+[\d.]*${sliceNum}\s*[:\—–-]\s*(.+)") {
        $sliceGoal = $Matches[1].Trim()
    }
    elseif ($content -match "###\s+Slice\s+[\d.]*${sliceNum}\s*\n\*\*Goal\*\*:\s*(.+)") {
        $sliceGoal = $Matches[1].Trim()
    }

    # Build conventional commit message
    $scope = if ($phaseNum) { "phase-$phaseNum/slice-$sliceNum" } else { "slice-$sliceNum" }
    $commitMsg = "feat($scope): $sliceGoal"

    Write-ManualSteps "commit" @(
        "Read slice $sliceNum goal from the plan"
        "Run: git add -A"
        "Run: git commit -m `"$commitMsg`""
    )

    if ($dryRun) {
        Write-Host "[DRY RUN] Would commit with message:" -ForegroundColor Yellow
        Write-Host "  $commitMsg" -ForegroundColor White
        return
    }

    git add -A
    git commit -m $commitMsg
    Write-Host "COMMITTED  $commitMsg" -ForegroundColor Green
}

# ─── Command: phase-status ─────────────────────────────────────────────
function Invoke-PhaseStatus {
    if (-not $Arguments -or $Arguments.Count -lt 2) {
        Write-Host "ERROR: Plan file and status required." -ForegroundColor Red
        Write-Host "  Usage: pforge phase-status <plan-file> <status>" -ForegroundColor Yellow
        Write-Host "  Status: planned | in-progress | complete | paused" -ForegroundColor Yellow
        exit 1
    }

    $planFile = $Arguments[0]
    $newStatus = $Arguments[1].ToLower()

    $statusMap = @{
        'planned'     = '📋 Planned'
        'in-progress' = '🚧 In Progress'
        'complete'    = '✅ Complete'
        'paused'      = '⏸️ Paused'
    }

    if (-not $statusMap.ContainsKey($newStatus)) {
        Write-Host "ERROR: Invalid status '$newStatus'. Use: planned, in-progress, complete, paused" -ForegroundColor Red
        exit 1
    }

    $statusText = $statusMap[$newStatus]

    # Find the plan's filename to match in roadmap
    $planBaseName = [System.IO.Path]::GetFileName($planFile)

    $roadmap = Join-Path $RepoRoot "docs/plans/DEPLOYMENT-ROADMAP.md"
    if (-not (Test-Path $roadmap)) {
        Write-Host "ERROR: DEPLOYMENT-ROADMAP.md not found." -ForegroundColor Red
        exit 1
    }

    Write-ManualSteps "phase-status" @(
        "Open docs/plans/DEPLOYMENT-ROADMAP.md"
        "Find the phase entry for $planBaseName"
        "Change **Status**: to $statusText"
    )

    $content = Get-Content $roadmap -Raw
    # Match the status line following the plan link
    $pattern = "(\*\*Plan\*\*:\s*\[$planBaseName\][^\n]*\n\*\*Status\*\*:\s*).+"
    if ($content -match $pattern) {
        $content = $content -replace $pattern, "`${1}$statusText"
        Set-Content -Path $roadmap -Value $content -NoNewline
        Write-Host "UPDATED  $planBaseName → $statusText" -ForegroundColor Green
    }
    else {
        Write-Host "WARN: Could not find status line for $planBaseName in roadmap. Update manually." -ForegroundColor Yellow
    }
}

# ─── Command: ext ──────────────────────────────────────────────────────
function Invoke-Ext {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "Extension commands:" -ForegroundColor Cyan
        Write-Host "  ext search [query]  Search the community catalog"
        Write-Host "  ext add <name>      Download and install from catalog"
        Write-Host "  ext info <name>     Show extension details"
        Write-Host "  ext install <path>  Install extension from local path"
        Write-Host "  ext list            List installed extensions"
        Write-Host "  ext remove <name>   Remove an installed extension"
        return
    }

    $subCmd = $Arguments[0]
    $extArgs = if ($Arguments.Count -gt 1) { $Arguments[1..($Arguments.Count - 1)] } else { @() }

    switch ($subCmd) {
        'search'  { Invoke-ExtSearch $extArgs }
        'add'     { Invoke-ExtAdd $extArgs }
        'info'    { Invoke-ExtInfo $extArgs }
        'install' { Invoke-ExtInstall $extArgs }
        'list'    { Invoke-ExtList }
        'remove'  { Invoke-ExtRemove $extArgs }
        default   {
            Write-Host "ERROR: Unknown ext command: $subCmd" -ForegroundColor Red
            Write-Host "  Available: search, add, info, install, list, remove" -ForegroundColor Yellow
        }
    }
}

# ─── Catalog Helpers ───────────────────────────────────────────────────
$script:CatalogUrl = "https://raw.githubusercontent.com/srnichols/plan-forge/master/extensions/catalog.json"

function Get-ExtCatalog {
    # Try local catalog first, then remote
    $localCatalog = Join-Path $RepoRoot "extensions/catalog.json"
    if (Test-Path $localCatalog) {
        return Get-Content $localCatalog -Raw | ConvertFrom-Json
    }
    try {
        $response = Invoke-RestMethod -Uri $script:CatalogUrl -TimeoutSec 10
        return $response
    }
    catch {
        Write-Host "ERROR: Could not fetch extension catalog." -ForegroundColor Red
        Write-Host "  Check your internet connection or try again later." -ForegroundColor Yellow
        return $null
    }
}

function Invoke-ExtSearch([string[]]$args_) {
    Write-ManualSteps "ext search" @(
        "Fetch the community catalog from GitHub"
        "Filter by query (or show all)"
        "Display matching extensions"
    )

    $query = if ($args_ -and $args_.Count -gt 0) { $args_ -join ' ' } else { '' }
    $catalog = Get-ExtCatalog
    if (-not $catalog) { return }

    $extensions = $catalog.extensions.PSObject.Properties | ForEach-Object { $_.Value }

    if ($query) {
        $q = $query.ToLower()
        $extensions = $extensions | Where-Object {
            $_.name.ToLower().Contains($q) -or
            $_.description.ToLower().Contains($q) -or
            ($_.tags -and ($_.tags -join ',').ToLower().Contains($q)) -or
            ($_.category -and $_.category.ToLower().Contains($q))
        }
    }

    if ($extensions.Count -eq 0) {
        Write-Host "No extensions found$(if ($query) { " matching '$query'" })." -ForegroundColor Yellow
        return
    }

    Write-Host ""
    Write-Host "Plan Forge Extension Catalog$(if ($query) { " — matching '$query'" }):" -ForegroundColor Cyan
    Write-Host "───────────────────────────────────────────────────────" -ForegroundColor DarkGray

    foreach ($ext in $extensions) {
        $compat = if ($ext.speckit_compatible -eq $true) { " [Spec Kit Compatible]" } else { "" }
        $verified = if ($ext.verified -eq $true) { "✅" } else { "  " }
        Write-Host "  $verified $($ext.id)" -ForegroundColor White -NoNewline
        Write-Host "  v$($ext.version)" -ForegroundColor DarkGray -NoNewline
        Write-Host "  [$($ext.category)]" -ForegroundColor DarkCyan -NoNewline
        Write-Host "$compat" -ForegroundColor Green
        Write-Host "     $($ext.description)" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "Use 'pforge ext info <name>' for details, 'pforge ext add <name>' to install." -ForegroundColor DarkGray
}

function Invoke-ExtAdd([string[]]$args_) {
    if (-not $args_ -or $args_.Count -eq 0) {
        Write-Host "ERROR: Extension name required." -ForegroundColor Red
        Write-Host "  Usage: pforge ext add <name>" -ForegroundColor Yellow
        Write-Host "  Browse: pforge ext search" -ForegroundColor Yellow
        exit 1
    }

    $extName = $args_[0]
    $catalog = Get-ExtCatalog
    if (-not $catalog) { return }

    $ext = $catalog.extensions.PSObject.Properties[$extName]
    if (-not $ext) {
        Write-Host "ERROR: Extension '$extName' not found in catalog." -ForegroundColor Red
        Write-Host "  Run 'pforge ext search' to see available extensions." -ForegroundColor Yellow
        exit 1
    }
    $ext = $ext.Value

    Write-Host ""
    Write-Host "Installing: $($ext.name) v$($ext.version)" -ForegroundColor Cyan
    Write-Host "  $($ext.description)" -ForegroundColor Gray
    Write-Host ""

    # Download
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "planforge-ext-$extName-$(Get-Date -Format 'yyyyMMddHHmmss')"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        if ($ext.path_in_repo) {
            # Clone just the needed path via sparse checkout or download ZIP + extract subfolder
            $zipUrl = $ext.download_url
            $zipFile = Join-Path $tempDir "repo.zip"
            Write-Host "  Downloading from $($ext.repository)..." -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
            Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force

            # Find the extracted path (ZIP contains repo-name-branch/ prefix)
            $extractedDirs = Get-ChildItem -Path $tempDir -Directory | Where-Object { $_.Name -ne '__MACOSX' }
            $repoRoot = $extractedDirs | Select-Object -First 1
            $extSourcePath = Join-Path $repoRoot.FullName $ext.path_in_repo

            if (-not (Test-Path $extSourcePath)) {
                Write-Host "ERROR: Path '$($ext.path_in_repo)' not found in downloaded archive." -ForegroundColor Red
                return
            }
        }
        elseif ($ext.download_url -match '\.zip$') {
            $zipFile = Join-Path $tempDir "ext.zip"
            Write-Host "  Downloading $($ext.download_url)..." -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $ext.download_url -OutFile $zipFile -UseBasicParsing
            Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force
            $extSourcePath = $tempDir
        }
        else {
            # Git clone
            Write-Host "  Cloning $($ext.repository)..." -ForegroundColor DarkGray
            git clone --depth 1 $ext.repository $tempDir 2>$null
            $extSourcePath = $tempDir
        }

        # Delegate to existing install logic
        Invoke-ExtInstall @($extSourcePath)
        Write-Host ""
        Write-Host "Extension '$extName' installed from catalog." -ForegroundColor Green
    }
    finally {
        # Cleanup temp
        if (Test-Path $tempDir) {
            Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-ExtInfo([string[]]$args_) {
    if (-not $args_ -or $args_.Count -eq 0) {
        Write-Host "ERROR: Extension name required." -ForegroundColor Red
        Write-Host "  Usage: pforge ext info <name>" -ForegroundColor Yellow
        exit 1
    }

    $extName = $args_[0]
    $catalog = Get-ExtCatalog
    if (-not $catalog) { return }

    $ext = $catalog.extensions.PSObject.Properties[$extName]
    if (-not $ext) {
        Write-Host "ERROR: Extension '$extName' not found in catalog." -ForegroundColor Red
        exit 1
    }
    $ext = $ext.Value

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $($ext.name)" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ID:          $($ext.id)" -ForegroundColor White
    Write-Host "  Version:     $($ext.version)" -ForegroundColor White
    Write-Host "  Author:      $($ext.author)" -ForegroundColor White
    Write-Host "  Category:    $($ext.category)" -ForegroundColor DarkCyan
    Write-Host "  Effect:      $($ext.effect)" -ForegroundColor White
    Write-Host "  License:     $($ext.license)" -ForegroundColor White
    Write-Host "  Verified:    $(if ($ext.verified) { '✅ Yes' } else { 'No' })" -ForegroundColor White
    if ($ext.speckit_compatible -eq $true) {
        Write-Host "  Spec Kit:    ✅ Compatible" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  $($ext.description)" -ForegroundColor Gray
    Write-Host ""

    if ($ext.provides) {
        Write-Host "  Provides:" -ForegroundColor Yellow
        if ($ext.provides.instructions) { Write-Host "    $($ext.provides.instructions) instruction files" }
        if ($ext.provides.agents) { Write-Host "    $($ext.provides.agents) agent definitions" }
        if ($ext.provides.prompts) { Write-Host "    $($ext.provides.prompts) prompt templates" }
        if ($ext.provides.skills) { Write-Host "    $($ext.provides.skills) skills" }
    }

    if ($ext.tags) {
        Write-Host ""
        Write-Host "  Tags: $($ext.tags -join ', ')" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  Repository:  $($ext.repository)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Install: pforge ext add $($ext.id)" -ForegroundColor Green
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
        "Copy extension folder to .forge/extensions/$extName/"
        "Copy files from instructions/ → .github/instructions/"
        "Copy files from agents/ → .github/agents/"
        "Copy files from prompts/ → .github/prompts/"
    )

    # Copy extension to .forge/extensions/
    $destDir = Join-Path $RepoRoot ".forge/extensions/$extName"
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

    # Merge MCP server config if extension declares one
    if ($manifest.files.mcp) {
        $mcpSrc = Join-Path $destDir $manifest.files.mcp
        if (Test-Path $mcpSrc) {
            $mcpDst = Join-Path $RepoRoot ".vscode/mcp.json"
            $mcpSrcJson = Get-Content $mcpSrc -Raw | ConvertFrom-Json

            if (Test-Path $mcpDst) {
                # Merge: add new servers without overwriting existing ones
                $mcpDstJson = Get-Content $mcpDst -Raw | ConvertFrom-Json
                if (-not $mcpDstJson.servers) {
                    $mcpDstJson | Add-Member -NotePropertyName 'servers' -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                foreach ($serverName in $mcpSrcJson.servers.PSObject.Properties.Name) {
                    if (-not $mcpDstJson.servers.PSObject.Properties[$serverName]) {
                        $mcpDstJson.servers | Add-Member -NotePropertyName $serverName -NotePropertyValue $mcpSrcJson.servers.$serverName -Force
                        Write-Host "  MERGE  .vscode/mcp.json → added '$serverName' server" -ForegroundColor Green
                    }
                    else {
                        Write-Host "  SKIP   .vscode/mcp.json → '$serverName' server already exists" -ForegroundColor Yellow
                    }
                }
                $mcpDstJson | ConvertTo-Json -Depth 10 | Set-Content $mcpDst
            }
            else {
                # No existing mcp.json — just copy it
                $vscodeDir = Join-Path $RepoRoot ".vscode"
                if (-not (Test-Path $vscodeDir)) {
                    New-Item -ItemType Directory -Path $vscodeDir -Force | Out-Null
                }
                Copy-Item $mcpSrc $mcpDst
                Write-Host "  CREATE .vscode/mcp.json" -ForegroundColor Green
            }
        }
    }

    # Update extensions.json
    $extJsonPath = Join-Path $RepoRoot ".forge/extensions/extensions.json"
    if (Test-Path $extJsonPath) {
        $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
    }
    else {
        $extJson = [PSCustomObject]@{
            description = "Installed Plan Forge extensions"
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
        "Open .forge/extensions/extensions.json"
        "Review the extensions array"
    )

    $extJsonPath = Join-Path $RepoRoot ".forge/extensions/extensions.json"
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
        "Delete .forge/extensions/$extName/"
        "Update .forge/extensions/extensions.json"
    )

    # Read manifest to know which files to remove
    $extDir = Join-Path $RepoRoot ".forge/extensions/$extName"
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
    Write-Host "  REMOVE  .forge/extensions/$extName/" -ForegroundColor Red

    # Update extensions.json
    $extJsonPath = Join-Path $RepoRoot ".forge/extensions/extensions.json"
    if (Test-Path $extJsonPath) {
        $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
        $extJson.extensions = @($extJson.extensions | Where-Object { $_.name -ne $extName })
        $extJson | ConvertTo-Json -Depth 5 | Set-Content $extJsonPath
    }

    Write-Host ""
    Write-Host "Extension '$extName' removed." -ForegroundColor Green
}

# ─── Command: sweep ────────────────────────────────────────────────────
function Invoke-Sweep {
    Write-ManualSteps "sweep" @(
        "Search code files for: TODO, FIXME, HACK, stub, placeholder, mock data, will be replaced"
        "Review each finding and resolve or document"
    )

    Write-Host ""
    Write-Host "Completeness Sweep — scanning for deferred-work markers:" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor DarkGray

    $patterns = @('TODO', 'FIXME', 'HACK', 'will be replaced', 'placeholder', 'stub', 'mock data', 'Simulate', 'Seed with sample')
    $patternRegex = ($patterns | ForEach-Object { [regex]::Escape($_) }) -join '|'

    $codeExtensions = @('*.cs', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.java', '*.kt', '*.rb', '*.rs', '*.sql', '*.sh', '*.ps1')
    $total = 0

    foreach ($ext in $codeExtensions) {
        Get-ChildItem -Path $RepoRoot -Filter $ext -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '(node_modules|bin|obj|dist|\.git|vendor|__pycache__)' } |
            ForEach-Object {
                $findings = Select-String -Path $_.FullName -Pattern $patternRegex -CaseSensitive:$false
                foreach ($m in $findings) {
                    $relPath = $m.Path.Substring($RepoRoot.Length + 1)
                    Write-Host "  $relPath`:$($m.LineNumber): $($m.Line.Trim())" -ForegroundColor Yellow
                    $total++
                }
            }
    }

    Write-Host ""
    if ($total -eq 0) {
        Write-Host "SWEEP CLEAN — zero deferred-work markers found." -ForegroundColor Green
    }
    else {
        Write-Host "FOUND $total deferred-work marker(s). Resolve before Step 5 (Review Gate)." -ForegroundColor Red
    }
}

# ─── Command: diff ─────────────────────────────────────────────────────
function Invoke-Diff {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "ERROR: Plan file required." -ForegroundColor Red
        Write-Host "  Usage: pforge diff <plan-file>" -ForegroundColor Yellow
        exit 1
    }

    $planFile = $Arguments[0]
    if (-not (Test-Path $planFile)) {
        $planFile = Join-Path $RepoRoot $planFile
    }
    if (-not (Test-Path $planFile)) {
        Write-Host "ERROR: Plan file not found: $($Arguments[0])" -ForegroundColor Red
        exit 1
    }

    Write-ManualSteps "diff" @(
        "Run: git diff --name-only"
        "Compare changed files against plan's In Scope and Forbidden Actions sections"
    )

    # Get changed files
    $changedFiles = @()
    $changedFiles += git diff --name-only 2>$null
    $changedFiles += git diff --cached --name-only 2>$null
    $changedFiles = $changedFiles | Sort-Object -Unique | Where-Object { $_ }

    if ($changedFiles.Count -eq 0) {
        Write-Host "No changed files detected." -ForegroundColor Yellow
        return
    }

    $planContent = Get-Content $planFile -Raw

    # Extract In Scope paths
    $inScopeSection = ""
    if ($planContent -match '### In Scope(.*?)(?=^###?\s|\z)') {
        $inScopeSection = $Matches[1]
    }
    $inScopePaths = [regex]::Matches($inScopeSection, '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }

    # Extract Forbidden Actions paths
    $forbiddenSection = ""
    if ($planContent -match '### Forbidden Actions(.*?)(?=^###?\s|\z)') {
        $forbiddenSection = $Matches[1]
    }
    $forbiddenPaths = [regex]::Matches($forbiddenSection, '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }

    Write-Host ""
    Write-Host "Scope Drift Check — $($changedFiles.Count) changed file(s) vs plan:" -ForegroundColor Cyan
    Write-Host "───────────────────────────────────────────────────────────" -ForegroundColor DarkGray

    $violations = 0
    $outOfScope = 0

    foreach ($file in $changedFiles) {
        # Check forbidden
        $isForbidden = $false
        foreach ($fp in $forbiddenPaths) {
            if ($file -like "*$fp*") {
                Write-Host "  🔴 FORBIDDEN  $file  (matches: $fp)" -ForegroundColor Red
                $violations++
                $isForbidden = $true
                break
            }
        }
        if ($isForbidden) { continue }

        # Check in-scope
        $isInScope = $false
        if ($inScopePaths.Count -eq 0) {
            $isInScope = $true  # No scope defined — everything allowed
        }
        else {
            foreach ($sp in $inScopePaths) {
                if ($file -like "*$sp*") {
                    $isInScope = $true
                    break
                }
            }
        }

        if ($isInScope) {
            Write-Host "  ✅ IN SCOPE   $file" -ForegroundColor Green
        }
        else {
            Write-Host "  🟡 UNPLANNED  $file  (not in Scope Contract)" -ForegroundColor Yellow
            $outOfScope++
        }
    }

    Write-Host ""
    if ($violations -gt 0) {
        Write-Host "DRIFT DETECTED — $violations forbidden file(s) touched." -ForegroundColor Red
    }
    elseif ($outOfScope -gt 0) {
        Write-Host "POTENTIAL DRIFT — $outOfScope file(s) not in Scope Contract. May need amendment." -ForegroundColor Yellow
    }
    else {
        Write-Host "ALL CHANGES IN SCOPE — no drift detected." -ForegroundColor Green
    }
}

# ─── Command: update ───────────────────────────────────────────────────
function Invoke-Update {
    Write-ManualSteps "update" @(
        "Clone/pull the latest Plan Forge template repo"
        "Compare .forge.json templateVersion with the source VERSION"
        "Copy updated framework files (prompts, agents, skills, hooks, runbook)"
        "Skip files that don't exist in the target (user hasn't adopted that feature)"
        "Never overwrite copilot-instructions.md, project-profile, project-principles, or plan files"
    )

    $dryRun = $Arguments -contains '--dry-run'
    $forceUpdate = $Arguments -contains '--force'

    # ─── Locate source ───────────────────────────────────────────
    # Source can be: a local path (argument), or auto-detect from .forge.json
    $sourcePath = $null
    foreach ($arg in $Arguments) {
        if ($arg -notlike '--*' -and (Test-Path $arg)) {
            $sourcePath = (Resolve-Path $arg).Path
            break
        }
    }

    if (-not $sourcePath) {
        # Try to find plan-forge source as a sibling directory or parent
        $candidates = @(
            (Join-Path (Split-Path $RepoRoot -Parent) "plan-forge"),
            (Join-Path (Split-Path $RepoRoot -Parent) "Plan-Forge")
        )
        foreach ($c in $candidates) {
            if (Test-Path (Join-Path $c "VERSION")) {
                $sourcePath = $c
                break
            }
        }
    }

    if (-not $sourcePath) {
        Write-Host "ERROR: Plan Forge source not found." -ForegroundColor Red
        Write-Host "  Provide the path to your Plan Forge clone:" -ForegroundColor Yellow
        Write-Host "    .\pforge.ps1 update C:\path\to\plan-forge" -ForegroundColor Yellow
        Write-Host "  Or clone it next to your project:" -ForegroundColor Yellow
        Write-Host "    git clone https://github.com/srnichols/plan-forge.git ../plan-forge" -ForegroundColor Yellow
        exit 1
    }

    # ─── Read versions ───────────────────────────────────────────
    $sourceVersion = (Get-Content (Join-Path $sourcePath "VERSION") -Raw).Trim()
    $configPath = Join-Path $RepoRoot ".forge.json"
    $currentVersion = "unknown"
    $currentPreset = "custom"

    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $currentVersion = $config.templateVersion
        $currentPreset = $config.preset
    }

    Write-Host ""
    Write-Host "Plan Forge Update" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  Source:   $sourcePath" -ForegroundColor White
    Write-Host "  Current:  v$currentVersion" -ForegroundColor White
    Write-Host "  Latest:   v$sourceVersion" -ForegroundColor White
    Write-Host "  Preset:   $currentPreset" -ForegroundColor White
    Write-Host ""

    if ($currentVersion -eq $sourceVersion -and -not $forceUpdate) {
        Write-Host "Already up to date (v$currentVersion). Use --force to re-apply." -ForegroundColor Green
        return
    }

    # ─── Define update categories ─────────────────────────────────
    # NEVER UPDATE: User-customized files
    $neverUpdate = @(
        ".github/copilot-instructions.md",
        ".github/instructions/project-profile.instructions.md",
        ".github/instructions/project-principles.instructions.md",
        "docs/plans/DEPLOYMENT-ROADMAP.md",
        "docs/plans/PROJECT-PRINCIPLES.md",
        "AGENTS.md",
        ".forge.json"
    )

    # ─── Calculate changes ────────────────────────────────────────
    $updates = @()
    $newFiles = @()

    # Update step prompts from .github/prompts/ in the source
    $srcPrompts = Join-Path $sourcePath ".github/prompts"
    $dstPrompts = Join-Path $RepoRoot ".github/prompts"
    if (Test-Path $srcPrompts) {
        Get-ChildItem -Path $srcPrompts -Filter "step*.prompt.md" -File | ForEach-Object {
            $dstFile = Join-Path $dstPrompts $_.Name
            if (Test-Path $dstFile) {
                $srcHash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $_.FullName; Dst = $dstFile; Name = ".github/prompts/$($_.Name)" }
                }
            } else {
                $newFiles += @{ Src = $_.FullName; Dst = $dstFile; Name = ".github/prompts/$($_.Name)" }
            }
        }
    }

    # Update pipeline agents from templates/
    $srcAgents = Join-Path $sourcePath "templates/.github/agents"
    $dstAgents = Join-Path $RepoRoot ".github/agents"
    $pipelineAgents = @("specifier.agent.md", "plan-hardener.agent.md", "executor.agent.md", "reviewer-gate.agent.md", "shipper.agent.md")
    if (Test-Path $srcAgents) {
        foreach ($agentName in $pipelineAgents) {
            $srcFile = Join-Path $srcAgents $agentName
            $dstFile = Join-Path $dstAgents $agentName
            if ((Test-Path $srcFile) -and (Test-Path $dstFile)) {
                $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $srcFile; Dst = $dstFile; Name = ".github/agents/$agentName" }
                }
            }
        }
    }

    # Update shared instruction files
    $srcSharedInstr = Join-Path $sourcePath ".github/instructions"
    $dstInstr = Join-Path $RepoRoot ".github/instructions"
    $sharedInstructions = @("architecture-principles.instructions.md", "git-workflow.instructions.md", "ai-plan-hardening-runbook.instructions.md")
    if (Test-Path $srcSharedInstr) {
        foreach ($instrName in $sharedInstructions) {
            $srcFile = Join-Path $srcSharedInstr $instrName
            $dstFile = Join-Path $dstInstr $instrName
            if ((Test-Path $srcFile) -and (Test-Path $dstFile)) {
                $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $srcFile; Dst = $dstFile; Name = ".github/instructions/$instrName" }
                }
            }
        }
    }

    # Update runbook docs
    $srcDocs = Join-Path $sourcePath "docs/plans"
    $dstDocs = Join-Path $RepoRoot "docs/plans"
    $runbookFiles = @("AI-Plan-Hardening-Runbook.md", "AI-Plan-Hardening-Runbook-Instructions.md", "DEPLOYMENT-ROADMAP-TEMPLATE.md", "PROJECT-PRINCIPLES-TEMPLATE.md")
    if (Test-Path $srcDocs) {
        foreach ($docName in $runbookFiles) {
            $srcFile = Join-Path $srcDocs $docName
            $dstFile = Join-Path $dstDocs $docName
            if ((Test-Path $srcFile) -and (Test-Path $dstFile)) {
                $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $srcFile; Dst = $dstFile; Name = "docs/plans/$docName" }
                }
            }
        }
    }

    # ─── Preset-specific files (instructions, agents, prompts, skills) ───
    # Normalise preset: .forge.json may store a single string or a comma-separated list
    $presets = @()
    if ($currentPreset -is [System.Array]) {
        $presets = $currentPreset
    } elseif ($currentPreset -match ',') {
        $presets = $currentPreset -split ',' | ForEach-Object { $_.Trim() }
    } else {
        $presets = @($currentPreset)
    }

    foreach ($p in ($presets | Where-Object { $_ -ne 'custom' })) {
        $srcPresetDir = Join-Path $sourcePath "presets/$p/.github"
        if (-not (Test-Path $srcPresetDir)) { continue }

        Write-Host "  Checking preset: $p" -ForegroundColor DarkGray

        # Instructions, agents, prompts: add NEW files only — existing files may have been customized
        foreach ($subDir in @('instructions', 'agents', 'prompts')) {
            $srcSub = Join-Path $srcPresetDir $subDir
            $dstSub = Join-Path $RepoRoot ".github/$subDir"

            if (-not (Test-Path $srcSub)) { continue }

            Get-ChildItem -Path $srcSub -File | ForEach-Object {
                $srcFile = $_.FullName
                $dstFile = Join-Path $dstSub $_.Name

                # Never overwrite protected customization files
                $relFile = ".github/$subDir/$($_.Name)"
                if ($neverUpdate -contains $relFile) { return }

                # Only add files that don't exist yet — existing files may be customized
                if (-not (Test-Path $dstFile)) {
                    $newFiles += @{ Src = $srcFile; Dst = $dstFile; Name = $relFile }
                }
            }
        }

        # Skills: add new skill directories only — existing SKILL.md files may be customized
        $srcSkills = Join-Path $srcPresetDir "skills"
        $dstSkills = Join-Path $RepoRoot ".github/skills"
        if (Test-Path $srcSkills) {
            Get-ChildItem -Path $srcSkills -Directory | ForEach-Object {
                $skillName = $_.Name
                $srcSkillFile = Join-Path $_.FullName "SKILL.md"
                $dstSkillFile = Join-Path $dstSkills "$skillName/SKILL.md"

                if (-not (Test-Path $srcSkillFile)) { return }

                # Only add if skill doesn't exist yet
                if (-not (Test-Path $dstSkillFile)) {
                    $newFiles += @{ Src = $srcSkillFile; Dst = $dstSkillFile; Name = ".github/skills/$skillName/SKILL.md" }
                }
            }
        }
    }

    # ─── MCP server files ────────────────────────────────────────
    $srcMcp = Join-Path $sourcePath "pforge-mcp"
    $dstMcp = Join-Path $RepoRoot "pforge-mcp"
    if (Test-Path $srcMcp) {
        foreach ($mcpFile in @("server.mjs", "package.json")) {
            $srcFile = Join-Path $srcMcp $mcpFile
            $dstFile = Join-Path $dstMcp $mcpFile
            if (Test-Path $srcFile) {
                if (Test-Path $dstFile) {
                    $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
                    $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                    if ($srcHash -ne $dstHash) {
                        $updates += @{ Src = $srcFile; Dst = $dstFile; Name = "pforge-mcp/$mcpFile" }
                    }
                } else {
                    $newFiles += @{ Src = $srcFile; Dst = $dstFile; Name = "pforge-mcp/$mcpFile" }
                }
            }
        }
    }

    # ─── Report ───────────────────────────────────────────────────
    if ($updates.Count -eq 0 -and $newFiles.Count -eq 0) {
        Write-Host "All framework files are up to date." -ForegroundColor Green
        return
    }

    Write-Host "Changes found:" -ForegroundColor Yellow
    foreach ($u in $updates) {
        Write-Host "  UPDATE  $($u.Name)" -ForegroundColor Cyan
    }
    foreach ($n in $newFiles) {
        Write-Host "  NEW     $($n.Name)" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Protected (never updated):" -ForegroundColor DarkGray
    Write-Host "  .github/copilot-instructions.md, project-profile, project-principles," -ForegroundColor DarkGray
    Write-Host "  DEPLOYMENT-ROADMAP.md, AGENTS.md, plan files, .forge.json" -ForegroundColor DarkGray
    Write-Host ""

    if ($dryRun) {
        Write-Host "DRY RUN — no files were changed." -ForegroundColor Yellow
        return
    }

    # ─── Confirm ──────────────────────────────────────────────────
    if (-not $forceUpdate) {
        $confirm = Read-Host "Apply $($updates.Count) updates and $($newFiles.Count) new files? [y/N]"
        if ($confirm -notin @('y', 'Y', 'yes', 'Yes')) {
            Write-Host "Cancelled." -ForegroundColor Yellow
            return
        }
    }

    # ─── Apply ────────────────────────────────────────────────────
    foreach ($u in $updates) {
        Copy-Item -Path $u.Src -Destination $u.Dst -Force
        Write-Host "  ✅ Updated $($u.Name)" -ForegroundColor Green
    }
    foreach ($n in $newFiles) {
        $parentDir = Split-Path $n.Dst -Parent
        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
        Copy-Item -Path $n.Src -Destination $n.Dst
        Write-Host "  ✅ Added $($n.Name)" -ForegroundColor Green
    }

    # ─── Update .forge.json version ───────────────────────────────
    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $config.templateVersion = $sourceVersion
        $config | ConvertTo-Json -Depth 3 | Set-Content -Path $configPath
        Write-Host "  ✅ Updated .forge.json templateVersion to $sourceVersion" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Update complete: v$currentVersion → v$sourceVersion" -ForegroundColor Green
    Write-Host "Run 'pforge check' to validate the updated setup." -ForegroundColor DarkGray

    # Check if MCP files were updated — remind to reinstall deps
    $mcpUpdated = ($updates + $newFiles) | Where-Object { $_.Name -like "pforge-mcp/*" }
    if ($mcpUpdated) {
        Write-Host ""
        Write-Host "MCP server files were updated. Run: cd pforge-mcp && npm install" -ForegroundColor Yellow
    }
}

# ─── Command: analyze ──────────────────────────────────────────────────
function Invoke-Analyze {
    if (-not $Arguments -or $Arguments.Count -eq 0) {
        Write-Host "ERROR: Plan file required." -ForegroundColor Red
        Write-Host "  Usage: pforge analyze <plan-file>" -ForegroundColor Yellow
        Write-Host "  Example: pforge analyze docs/plans/Phase-1-AUTH-PLAN.md" -ForegroundColor Yellow
        exit 1
    }

    $planFile = $Arguments[0]
    if (-not (Test-Path $planFile)) {
        $planFile = Join-Path $RepoRoot $planFile
    }
    if (-not (Test-Path $planFile)) {
        Write-Host "ERROR: Plan file not found: $($Arguments[0])" -ForegroundColor Red
        exit 1
    }

    Write-ManualSteps "analyze" @(
        "Parse plan file for requirements, slices, validation gates, scope contract"
        "Cross-reference git changes against scope contract"
        "Match acceptance criteria against test files"
        "Score traceability, coverage, completeness, and gates"
    )

    $planContent = Get-Content $planFile -Raw
    $planName = [System.IO.Path]::GetFileNameWithoutExtension($planFile)

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       Plan Forge — Analyze                                   ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Plan: $planName" -ForegroundColor Cyan
    Write-Host ""

    $scoreTrace = 0; $scoreMax_Trace = 25
    $scoreCoverage = 0; $scoreMax_Coverage = 25
    $scoreComplete = 0; $scoreMax_Complete = 25
    $scoreGates = 0; $scoreMax_Gates = 25

    # ═══════════════════════════════════════════════════════════════
    # 1. REQUIREMENT → SLICE TRACEABILITY
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Traceability:" -ForegroundColor Cyan

    # Extract MUST and SHOULD criteria
    $mustCriteria = [regex]::Matches($planContent, '(?m)^\s*[-*]\s*\*\*MUST\*\*[:\s]+(.+)') | ForEach-Object { $_.Groups[1].Value.Trim() }
    $shouldCriteria = [regex]::Matches($planContent, '(?m)^\s*[-*]\s*\*\*SHOULD\*\*[:\s]+(.+)') | ForEach-Object { $_.Groups[1].Value.Trim() }
    $allCriteria = @()
    if ($mustCriteria) { $allCriteria += $mustCriteria }
    if ($shouldCriteria) { $allCriteria += $shouldCriteria }

    # Extract slice references
    $sliceCount = ([regex]::Matches($planContent, '(?m)^###\s+Slice\s+\d')).Count

    if ($allCriteria.Count -gt 0) {
        # Check if slices reference criteria via Traces to:
        $tracedCount = 0
        foreach ($c in $allCriteria) {
            $shortCriterion = $c.Substring(0, [Math]::Min(40, $c.Length))
            if ($planContent -match [regex]::Escape($shortCriterion) -or $planContent -match 'Traces to:') {
                $tracedCount++
            }
        }
        Write-Host "  ✅ $($allCriteria.Count) acceptance criteria found ($($mustCriteria.Count) MUST, $($shouldCriteria.Count) SHOULD)" -ForegroundColor Green
        $scoreTrace = [Math]::Floor(25 * ($tracedCount / [Math]::Max($allCriteria.Count, 1)))
    }
    else {
        Write-Host "  ⚠️  No MUST/SHOULD criteria found in plan" -ForegroundColor Yellow
        # Try alternate format — look for acceptance criteria section
        if ($planContent -match '(?i)acceptance criteria|definition of done') {
            Write-Host "  ✅ Acceptance criteria section detected (non-standard format)" -ForegroundColor Green
            $scoreTrace = 15
        }
    }

    if ($sliceCount -gt 0) {
        Write-Host "  ✅ $sliceCount execution slices found" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠️  No execution slices found (### Slice N pattern)" -ForegroundColor Yellow
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 2. SCOPE COMPLIANCE
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Coverage:" -ForegroundColor Cyan

    # Get changed files
    $changedFiles = @()
    $changedFiles += git diff --name-only 2>$null
    $changedFiles += git diff --cached --name-only 2>$null
    $changedFiles = $changedFiles | Sort-Object -Unique | Where-Object { $_ }

    # Extract scope
    $inScopePaths = @()
    if ($planContent -match '(?s)### In Scope(.*?)(?=^###?\s|\z)') {
        $inScopePaths = [regex]::Matches($Matches[1], '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }
    }
    $forbiddenPaths = @()
    if ($planContent -match '(?s)### Forbidden Actions(.*?)(?=^###?\s|\z)') {
        $forbiddenPaths = [regex]::Matches($Matches[1], '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }
    }

    $violations = 0; $outOfScope = 0; $inScope = 0
    foreach ($file in $changedFiles) {
        $isForbidden = $false
        foreach ($fp in $forbiddenPaths) {
            if ($file -like "*$fp*") { $violations++; $isForbidden = $true; break }
        }
        if ($isForbidden) { continue }

        $isInScope = $false
        if ($inScopePaths.Count -eq 0) { $isInScope = $true }
        else {
            foreach ($sp in $inScopePaths) {
                if ($file -like "*$sp*") { $isInScope = $true; break }
            }
        }
        if ($isInScope) { $inScope++ } else { $outOfScope++ }
    }

    $totalChanged = $changedFiles.Count
    if ($totalChanged -gt 0) {
        Write-Host "  ✅ $totalChanged changed files analyzed" -ForegroundColor Green
        if ($violations -gt 0) {
            Write-Host "  ❌ $violations forbidden file(s) touched" -ForegroundColor Red
        }
        if ($outOfScope -gt 0) {
            Write-Host "  ⚠️  $outOfScope file(s) outside Scope Contract" -ForegroundColor Yellow
        }
        if ($violations -eq 0 -and $outOfScope -eq 0) {
            Write-Host "  ✅ All changes within Scope Contract" -ForegroundColor Green
        }
        $scoreCoverage = [Math]::Floor(25 * ($inScope / [Math]::Max($totalChanged, 1)))
        if ($violations -gt 0) { $scoreCoverage = [Math]::Max(0, $scoreCoverage - 10) }
    }
    else {
        Write-Host "  ✅ No uncommitted changes (analyzing plan structure only)" -ForegroundColor Green
        $scoreCoverage = 25
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 3. CRITERION → TEST TRACEABILITY
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Test Coverage:" -ForegroundColor Cyan

    $testDirs = @('tests', 'test', '__tests__', 'spec', 'Tests', 'Test', 'src/test', 'src/tests')
    $testExtensions = @('*.test.*', '*.spec.*', '*Tests.cs', '*Test.java', '*_test.go', 'test_*.py', '*_test.py')

    $testFiles = @()
    foreach ($td in $testDirs) {
        $testDir = Join-Path $RepoRoot $td
        if (Test-Path $testDir) {
            $testFiles += Get-ChildItem -Path $testDir -Recurse -File -ErrorAction SilentlyContinue
        }
    }
    # Also search project root with test patterns
    foreach ($pattern in $testExtensions) {
        $testFiles += Get-ChildItem -Path $RepoRoot -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '(node_modules|bin|obj|dist|\.git|vendor)' }
    }
    $testFiles = $testFiles | Select-Object -Unique

    $testedMust = 0; $untestedMust = @()
    if ($mustCriteria -and $mustCriteria.Count -gt 0) {
        foreach ($criterion in $mustCriteria) {
            # Extract key terms from the criterion for fuzzy matching
            $keywords = $criterion -replace '[^\w\s]', '' -split '\s+' | Where-Object { $_.Length -gt 4 } | Select-Object -First 3
            $found = $false
            foreach ($tf in $testFiles) {
                $testContent = Get-Content $tf.FullName -Raw -ErrorAction SilentlyContinue
                if ($testContent) {
                    $matchCount = ($keywords | Where-Object { $testContent -match $_ }).Count
                    if ($matchCount -ge 2) { $found = $true; break }
                }
            }
            if ($found) { $testedMust++ }
            else { $untestedMust += $criterion }
        }
        Write-Host "  ✅ $testedMust/$($mustCriteria.Count) MUST criteria have matching tests" -ForegroundColor $(if ($testedMust -eq $mustCriteria.Count) { 'Green' } else { 'Yellow' })
        foreach ($u in $untestedMust) {
            $short = if ($u.Length -gt 70) { $u.Substring(0,70) + "..." } else { $u }
            Write-Host "  ⚠️  No test found for: $short" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  ⚠️  No MUST criteria to trace (plan may use alternate format)" -ForegroundColor Yellow
    }

    if ($testFiles.Count -gt 0) {
        Write-Host "  ✅ $($testFiles.Count) test file(s) found in project" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠️  No test files found" -ForegroundColor Yellow
    }

    $scoreComplete_tests = if ($mustCriteria -and $mustCriteria.Count -gt 0) {
        [Math]::Floor(25 * ($testedMust / $mustCriteria.Count))
    } else { 15 }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4. SLICE → GATE COMPLETENESS
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Validation Gates:" -ForegroundColor Cyan

    $gatePatterns = @('Validation Gates', 'validation gate', 'build.*pass', 'test.*pass', '\- \[ \].*build', '\- \[ \].*test')
    $gatesFound = 0
    foreach ($p in $gatePatterns) {
        $gatesFound += ([regex]::Matches($planContent, $p, 'IgnoreCase')).Count
    }

    if ($gatesFound -gt 0) {
        Write-Host "  ✅ $gatesFound validation gate reference(s) found" -ForegroundColor Green
        $scoreGates = 25
    }
    elseif ($sliceCount -gt 0) {
        Write-Host "  ⚠️  Slices found but no explicit validation gates" -ForegroundColor Yellow
        $scoreGates = 10
    }
    else {
        Write-Host "  ⚠️  No validation gates found" -ForegroundColor Yellow
        $scoreGates = 0
    }

    # Check for completeness markers (deferred work)
    $sweepPatterns = @('TODO', 'FIXME', 'HACK', 'stub', 'placeholder', 'mock data')
    $sweepRegex = ($sweepPatterns | ForEach-Object { [regex]::Escape($_) }) -join '|'
    $markerCount = 0
    foreach ($file in $changedFiles) {
        $fullPath = Join-Path $RepoRoot $file
        if (Test-Path $fullPath) {
            $markerCount += (Select-String -Path $fullPath -Pattern $sweepRegex -CaseSensitive:$false -ErrorAction SilentlyContinue).Count
        }
    }

    if ($markerCount -eq 0) {
        Write-Host "  ✅ 0 deferred-work markers in changed files" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠️  $markerCount deferred-work marker(s) in changed files" -ForegroundColor Yellow
        $scoreGates = [Math]::Max(0, $scoreGates - 5)
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # CONSISTENCY SCORE
    # ═══════════════════════════════════════════════════════════════
    $totalScore = $scoreTrace + $scoreCoverage + $scoreComplete_tests + $scoreGates
    $maxScore = 100

    Write-Host "Consistency Score: $totalScore/$maxScore" -ForegroundColor $(if ($totalScore -ge 80) { 'Green' } elseif ($totalScore -ge 60) { 'Yellow' } else { 'Red' })
    Write-Host "  - Traceability: $scoreTrace/$scoreMax_Trace" -ForegroundColor $(if ($scoreTrace -ge 20) { 'Green' } else { 'Yellow' })
    Write-Host "  - Coverage: $scoreCoverage/$scoreMax_Coverage" -ForegroundColor $(if ($scoreCoverage -ge 20) { 'Green' } else { 'Yellow' })
    Write-Host "  - Test Coverage: $scoreComplete_tests/$scoreMax_Complete" -ForegroundColor $(if ($scoreComplete_tests -ge 20) { 'Green' } else { 'Yellow' })
    Write-Host "  - Gates: $scoreGates/$scoreMax_Gates" -ForegroundColor $(if ($scoreGates -ge 20) { 'Green' } else { 'Yellow' })

    Write-Host ""
    Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray
    $summaryItems = @()
    if ($allCriteria) { $summaryItems += "$($allCriteria.Count) requirements" }
    if ($sliceCount -gt 0) { $summaryItems += "$sliceCount slices" }
    if ($totalChanged -gt 0) { $summaryItems += "$totalChanged files" }
    $summaryItems += "$totalScore% consistent"
    Write-Host "  $($summaryItems -join '  |  ')" -ForegroundColor $(if ($totalScore -ge 80) { 'Green' } elseif ($totalScore -ge 60) { 'Yellow' } else { 'Red' })
    Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray

    if ($totalScore -lt 60) {
        Write-Host ""
        Write-Host "ANALYSIS FAILED — score below 60%. Review gaps above." -ForegroundColor Red
        exit 1
    }
    elseif ($totalScore -lt 80) {
        Write-Host ""
        Write-Host "ANALYSIS WARNING — score below 80%. Consider addressing gaps." -ForegroundColor Yellow
        exit 0
    }
    else {
        Write-Host ""
        Write-Host "ANALYSIS PASSED — strong consistency." -ForegroundColor Green
        exit 0
    }
}

# ─── Command: smith ────────────────────────────────────────────────────
function Invoke-Smith {
    Write-ManualSteps "smith" @(
        "Check that required tools are installed (git, VS Code, PowerShell)"
        "Verify VS Code settings for Copilot agent mode"
        "Validate .forge.json and file counts per preset"
        "Check version currency against Plan Forge source"
        "Scan for common problems (duplicates, orphans, broken references)"
    )

    $doc = @{ Pass = 0; Fail = 0; Warn = 0 }

    function Doctor-Pass([string]$Msg) {
        Write-Host "  ✅ $Msg" -ForegroundColor Green
        $doc.Pass++
    }
    function Doctor-Fail([string]$Msg, [string]$Fix = '') {
        Write-Host "  ❌ $Msg" -ForegroundColor Red
        if ($Fix) { Write-Host "     FIX: $Fix" -ForegroundColor Yellow }
        $doc.Fail++
    }
    function Doctor-Warn([string]$Msg, [string]$Fix = '') {
        Write-Host "  ⚠️  $Msg" -ForegroundColor Yellow
        if ($Fix) { Write-Host "     FIX: $Fix" -ForegroundColor DarkYellow }
        $doc.Warn++
    }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       Plan Forge — The Smith                                  ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 1. ENVIRONMENT
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Environment:" -ForegroundColor Cyan

    # Git
    $gitVersion = git --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitVersion) {
        $ver = ($gitVersion -replace 'git version ', '').Trim()
        Doctor-Pass "git $ver"
    }
    else {
        Doctor-Fail "git not found" "Install from https://git-scm.com/downloads"
    }

    # VS Code CLI
    $codeCmd = Get-Command code -ErrorAction SilentlyContinue
    if ($codeCmd) {
        $codeVer = (code --version 2>$null | Select-Object -First 1)
        if ($codeVer) {
            Doctor-Pass "code (VS Code CLI) $codeVer"
        }
        else {
            Doctor-Pass "code (VS Code CLI) found"
        }
    }
    else {
        $codeInsiders = Get-Command code-insiders -ErrorAction SilentlyContinue
        if ($codeInsiders) {
            Doctor-Pass "code-insiders (VS Code CLI) found"
        }
        else {
            Doctor-Warn "VS Code CLI not in PATH (optional)" "Open VS Code → Ctrl+Shift+P → 'Shell Command: Install code in PATH'"
        }
    }

    # PowerShell version
    $psVer = $PSVersionTable.PSVersion.ToString()
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        Doctor-Pass "PowerShell $psVer"
    }
    elseif ($PSVersionTable.PSVersion.Major -ge 5) {
        Doctor-Warn "PowerShell $psVer (7.x recommended)" "Install from https://aka.ms/powershell"
    }
    else {
        Doctor-Fail "PowerShell $psVer (5.1+ required)" "Install from https://aka.ms/powershell"
    }

    # Optional: GitHub CLI
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($ghCmd) {
        $ghVer = (gh --version 2>$null | Select-Object -First 1) -replace 'gh version ', '' -replace ' .*', ''
        Doctor-Pass "gh (GitHub CLI) $ghVer"
    }
    else {
        Doctor-Warn "gh (GitHub CLI) not found (optional — useful for PRs and branch protection)" "Install from https://cli.github.com/"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 2. VS CODE CONFIGURATION
    # ═══════════════════════════════════════════════════════════════
    Write-Host "VS Code Configuration:" -ForegroundColor Cyan

    $settingsPath = Join-Path $RepoRoot ".vscode/settings.json"
    if (Test-Path $settingsPath) {
        try {
            $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

            # chat.agent.enabled (may not exist in newer VS Code where it's default)
            if ($null -ne $settings.'chat.agent.enabled') {
                if ($settings.'chat.agent.enabled' -eq $true) {
                    Doctor-Pass "chat.agent.enabled = true"
                }
                else {
                    Doctor-Fail "chat.agent.enabled = false" 'Set to true in .vscode/settings.json'
                }
            }
            else {
                Doctor-Pass "chat.agent.enabled (default — OK)"
            }

            # chat.useCustomizationsInParentRepositories
            if ($null -ne $settings.'chat.useCustomizationsInParentRepositories') {
                if ($settings.'chat.useCustomizationsInParentRepositories' -eq $true) {
                    Doctor-Pass "chat.useCustomizationsInParentRepositories = true"
                }
                else {
                    Doctor-Warn "chat.useCustomizationsInParentRepositories = false" 'Set to true for monorepo support'
                }
            }
            else {
                Doctor-Warn "chat.useCustomizationsInParentRepositories not set" 'Add "chat.useCustomizationsInParentRepositories": true to .vscode/settings.json'
            }

            # chat.promptFiles
            if ($null -ne $settings.'chat.promptFiles') {
                if ($settings.'chat.promptFiles' -eq $true) {
                    Doctor-Pass "chat.promptFiles = true"
                }
                else {
                    Doctor-Warn "chat.promptFiles is not true" 'Set to true to enable prompt template discovery'
                }
            }
            else {
                Doctor-Warn "chat.promptFiles not set" 'Add "chat.promptFiles": true to .vscode/settings.json'
            }
        }
        catch {
            Doctor-Fail ".vscode/settings.json has invalid JSON" "Fix the JSON syntax in .vscode/settings.json"
        }
    }
    else {
        Doctor-Warn ".vscode/settings.json not found" "Run 'pforge init' or create it manually"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 3. SETUP HEALTH
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Setup Health:" -ForegroundColor Cyan

    $configPath = Join-Path $RepoRoot ".forge.json"
    $preset = 'unknown'
    $templateVersion = 'unknown'

    if (Test-Path $configPath) {
        try {
            $config = Get-Content $configPath -Raw | ConvertFrom-Json
            $preset = $config.preset
            $templateVersion = $config.templateVersion
            Doctor-Pass ".forge.json valid (preset: $preset, v$templateVersion)"

            # Check configured agents
            $configuredAgents = @('copilot')
            if ($config.agents) {
                if ($config.agents -is [System.Array]) {
                    $configuredAgents = $config.agents
                } elseif ($config.agents -is [string]) {
                    $configuredAgents = @($config.agents)
                }
            }

            foreach ($ag in $configuredAgents) {
                switch ($ag) {
                    'copilot' {
                        if (Test-Path (Join-Path $RepoRoot ".github/copilot-instructions.md")) {
                            Doctor-Pass "Agent: copilot (configured)"
                        } else {
                            Doctor-Warn "Agent: copilot configured but .github/copilot-instructions.md missing"
                        }
                    }
                    'claude' {
                        if (Test-Path (Join-Path $RepoRoot "CLAUDE.md")) {
                            Doctor-Pass "Agent: claude (CLAUDE.md + .claude/skills/)"
                        } else {
                            Doctor-Warn "Agent: claude configured but CLAUDE.md missing" "Re-run setup with -Agent claude"
                        }
                    }
                    'cursor' {
                        if (Test-Path (Join-Path $RepoRoot ".cursor/rules")) {
                            Doctor-Pass "Agent: cursor (.cursor/rules + commands/)"
                        } else {
                            Doctor-Warn "Agent: cursor configured but .cursor/rules missing" "Re-run setup with -Agent cursor"
                        }
                    }
                    'codex' {
                        if (Test-Path (Join-Path $RepoRoot ".agents/skills")) {
                            Doctor-Pass "Agent: codex (.agents/skills/)"
                        } else {
                            Doctor-Warn "Agent: codex configured but .agents/skills/ missing" "Re-run setup with -Agent codex"
                        }
                    }
                }
            }
        }
        catch {
            Doctor-Fail ".forge.json has invalid JSON" "Delete and re-run 'pforge init'"
            $preset = 'unknown'
        }
    }
    else {
        Doctor-Fail ".forge.json not found" "Run 'pforge init' to bootstrap your project"
    }

    # copilot-instructions.md
    $copilotInstr = Join-Path $RepoRoot ".github/copilot-instructions.md"
    if (Test-Path $copilotInstr) {
        Doctor-Pass ".github/copilot-instructions.md exists"
    }
    else {
        Doctor-Fail ".github/copilot-instructions.md missing" "Run 'pforge init' to create it"
    }

    # File count expectations per preset
    $expectedCounts = @{
        'dotnet'     = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'typescript' = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'python'     = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'java'       = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'go'         = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'azure-iac'  = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'custom'     = @{ instructions = 3;  agents = 5;  prompts = 7; skills = 0 }
    }

    # Handle multi-preset (e.g., "dotnet,azure-iac")
    $presetKey = $preset
    if ($preset -match ',') {
        $presetKey = ($preset -split ',')[0].Trim()
    }

    if ($expectedCounts.ContainsKey($presetKey)) {
        $expected = $expectedCounts[$presetKey]

        $instrDir = Join-Path $RepoRoot ".github/instructions"
        $agentsDir = Join-Path $RepoRoot ".github/agents"
        $promptsDir = Join-Path $RepoRoot ".github/prompts"
        $skillsDir = Join-Path $RepoRoot ".github/skills"

        # Instructions
        $instrCount = 0
        if (Test-Path $instrDir) {
            $instrCount = (Get-ChildItem -Path $instrDir -Filter "*.instructions.md" -File).Count
        }
        if ($instrCount -ge $expected.instructions) {
            Doctor-Pass "$instrCount instruction files (expected: >=$($expected.instructions) for $presetKey)"
        }
        else {
            Doctor-Warn "$instrCount instruction files (expected: >=$($expected.instructions) for $presetKey)" "Run 'pforge update' to get missing files"
        }

        # Agents
        $agentCount = 0
        if (Test-Path $agentsDir) {
            $agentCount = (Get-ChildItem -Path $agentsDir -Filter "*.agent.md" -File).Count
        }
        if ($agentCount -ge $expected.agents) {
            Doctor-Pass "$agentCount agent definitions (expected: >=$($expected.agents) for $presetKey)"
        }
        else {
            Doctor-Warn "$agentCount agent definitions (expected: >=$($expected.agents) for $presetKey)" "Run 'pforge update' to get missing agents"
        }

        # Prompts
        $promptCount = 0
        if (Test-Path $promptsDir) {
            $promptCount = (Get-ChildItem -Path $promptsDir -Filter "*.prompt.md" -File).Count
        }
        if ($promptCount -ge $expected.prompts) {
            Doctor-Pass "$promptCount prompt templates (expected: >=$($expected.prompts) for $presetKey)"
        }
        else {
            Doctor-Warn "$promptCount prompt templates (expected: >=$($expected.prompts) for $presetKey)" "Run 'pforge update' to get missing prompts"
        }

        # Skills
        $skillCount = 0
        if (Test-Path $skillsDir) {
            $skillCount = (Get-ChildItem -Path $skillsDir -Recurse -Filter "SKILL.md" -File).Count
        }
        if ($skillCount -ge $expected.skills) {
            Doctor-Pass "$skillCount skills (expected: >=$($expected.skills) for $presetKey)"
        }
        else {
            Doctor-Warn "$skillCount skills (expected: >=$($expected.skills) for $presetKey)" "Run 'pforge update' to get missing skills"
        }
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4. VERSION CURRENCY
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Version Currency:" -ForegroundColor Cyan

    $sourceVersion = $null
    # Try to find Plan Forge source nearby
    $candidates = @(
        (Join-Path (Split-Path $RepoRoot -Parent) "plan-forge"),
        (Join-Path (Split-Path $RepoRoot -Parent) "Plan-Forge")
    )
    foreach ($c in $candidates) {
        $vFile = Join-Path $c "VERSION"
        if (Test-Path $vFile) {
            $sourceVersion = (Get-Content $vFile -Raw).Trim()
            break
        }
    }

    if ($sourceVersion) {
        if ($templateVersion -eq $sourceVersion) {
            Doctor-Pass "Up to date (v$templateVersion)"
        }
        elseif ($templateVersion -eq 'unknown') {
            Doctor-Warn "Cannot determine installed version (.forge.json missing)"
        }
        else {
            Doctor-Warn "Installed v$templateVersion — latest is v$sourceVersion" "Run 'pforge update' to upgrade"
        }
    }
    else {
        Doctor-Pass "Installed v$templateVersion (source repo not found nearby — skipping currency check)"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4b. MCP SERVER
    # ═══════════════════════════════════════════════════════════════
    Write-Host "MCP Server:" -ForegroundColor Cyan

    $mcpServer = Join-Path $RepoRoot "pforge-mcp/server.mjs"
    $mcpPkg = Join-Path $RepoRoot "pforge-mcp/package.json"
    $vscodeMcp = Join-Path $RepoRoot ".vscode/mcp.json"

    if (Test-Path $mcpServer) {
        Doctor-Pass "pforge-mcp/server.mjs exists"

        if (-not (Test-Path $mcpPkg)) {
            Doctor-Warn "pforge-mcp/package.json missing" "Copy from Plan Forge template or run setup again"
        }

        $mcpNodeModules = Join-Path $RepoRoot "pforge-mcp/node_modules"
        if (Test-Path $mcpNodeModules) {
            Doctor-Pass "MCP dependencies installed"
        } else {
            Doctor-Warn "MCP dependencies not installed" "Run: cd pforge-mcp && npm install"
        }

        if (Test-Path $vscodeMcp) {
            $mcpContent = Get-Content $vscodeMcp -Raw
            if ($mcpContent -match '"plan-forge"') {
                Doctor-Pass ".vscode/mcp.json has 'plan-forge' server entry"
            } else {
                Doctor-Warn ".vscode/mcp.json missing 'plan-forge' entry" "Re-run setup or add manually"
            }
        } else {
            Doctor-Warn ".vscode/mcp.json not found" "Run setup to generate MCP config"
        }
    } else {
        Doctor-Pass "MCP server not installed (optional — run setup to add)"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4b-ii. IMAGE GENERATION STACK
    # ═══════════════════════════════════════════════════════════════
    if (Test-Path $mcpServer) {
        Write-Host "Image Generation:" -ForegroundColor Cyan

        # Check for sharp (format conversion)
        $sharpPath = Join-Path $RepoRoot "pforge-mcp/node_modules/sharp"
        if (Test-Path $sharpPath) {
            Doctor-Pass "sharp installed (WebP, PNG, AVIF conversion)"
        } else {
            Doctor-Warn "sharp not installed — image format conversion disabled" "Run: cd pforge-mcp && npm install sharp"
        }

        # Check for API keys (xAI / OpenAI)
        $hasXai = -not [string]::IsNullOrEmpty($env:XAI_API_KEY)
        $hasOpenAi = -not [string]::IsNullOrEmpty($env:OPENAI_API_KEY)

        if ($hasXai -and $hasOpenAi) {
            Doctor-Pass "XAI_API_KEY set (Grok Aurora)"
            Doctor-Pass "OPENAI_API_KEY set (DALL-E)"
        } elseif ($hasXai) {
            Doctor-Pass "XAI_API_KEY set (Grok Aurora)"
            Doctor-Pass "OPENAI_API_KEY not set (DALL-E unavailable — optional)"
        } elseif ($hasOpenAi) {
            Doctor-Pass "OPENAI_API_KEY set (DALL-E)"
            Doctor-Pass "XAI_API_KEY not set (Grok Aurora unavailable — optional)"
        } else {
            Doctor-Warn "No image API keys configured" "Set XAI_API_KEY or OPENAI_API_KEY environment variable for forge_generate_image"
        }

        # Check Node.js version (sharp requires >= 18.17.0)
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCmd) {
            $nodeVer = (node --version 2>$null) -replace '^v', ''
            $nodeMajor = [int]($nodeVer -split '\.')[0]
            if ($nodeMajor -ge 18) {
                Doctor-Pass "Node.js v$nodeVer (sharp requires >= 18.17)"
            } else {
                Doctor-Fail "Node.js v$nodeVer — sharp requires >= 18.17" "Upgrade Node.js from https://nodejs.org/"
            }
        } else {
            Doctor-Fail "Node.js not found — required for image generation" "Install from https://nodejs.org/"
        }

        Write-Host ""
    }

    # ═══════════════════════════════════════════════════════════════
    # 4d. MCP RUNTIME DEPENDENCIES
    # ═══════════════════════════════════════════════════════════════
    if (Test-Path $mcpServer) {
        Write-Host "MCP Runtime:" -ForegroundColor Cyan

        # Granular dependency checks
        $mcpDepsDir = Join-Path $RepoRoot "pforge-mcp/node_modules"
        if (Test-Path $mcpDepsDir) {
            $criticalDeps = @(
                @{ Name = "@modelcontextprotocol/sdk"; Label = "MCP SDK (protocol layer)" },
                @{ Name = "express"; Label = "Express (dashboard + REST API)" },
                @{ Name = "ws"; Label = "ws (WebSocket hub for real-time events)" }
            )
            foreach ($dep in $criticalDeps) {
                $depPath = Join-Path $mcpDepsDir $dep.Name
                if (Test-Path $depPath) {
                    # Try to read version
                    $depPkgPath = Join-Path $depPath "package.json"
                    if (Test-Path $depPkgPath) {
                        try {
                            $depPkg = Get-Content $depPkgPath -Raw | ConvertFrom-Json
                            Doctor-Pass "$($dep.Label) v$($depPkg.version)"
                        } catch { Doctor-Pass "$($dep.Label) installed" }
                    } else { Doctor-Pass "$($dep.Label) installed" }
                } else {
                    Doctor-Fail "$($dep.Label) missing" "Run: cd pforge-mcp && npm install"
                }
            }

            # Optional deps
            $optionalDeps = @(
                @{ Name = "playwright"; Label = "Playwright (screenshot capture)" }
            )
            foreach ($dep in $optionalDeps) {
                $depPath = Join-Path $mcpDepsDir $dep.Name
                if (Test-Path $depPath) {
                    Doctor-Pass "$($dep.Label)"
                } else {
                    Doctor-Warn "$($dep.Label) not installed (optional)" "Run: cd pforge-mcp && npm install playwright"
                }
            }
        }

        # MCP version sync
        $mcpPkgPath = Join-Path $RepoRoot "pforge-mcp/package.json"
        $versionPath = Join-Path $RepoRoot "VERSION"
        if ((Test-Path $mcpPkgPath) -and (Test-Path $versionPath)) {
            try {
                $mcpPkg = Get-Content $mcpPkgPath -Raw | ConvertFrom-Json
                $mcpVer = $mcpPkg.version
                $repoVer = (Get-Content $versionPath -Raw).Trim()
                if ($mcpVer -eq $repoVer) {
                    Doctor-Pass "MCP server version v$mcpVer matches VERSION file"
                } else {
                    Doctor-Warn "MCP server v$mcpVer but VERSION file says v$repoVer" "Update version in pforge-mcp/package.json"
                }
            } catch { }
        }

        Write-Host ""
    }

    # ═══════════════════════════════════════════════════════════════
    # 4e. DASHBOARD & SITE ASSETS
    # ═══════════════════════════════════════════════════════════════
    $dashboardHtml = Join-Path $RepoRoot "pforge-mcp/dashboard/index.html"
    $dashboardJs = Join-Path $RepoRoot "pforge-mcp/dashboard/app.js"
    if ((Test-Path $dashboardHtml) -or (Test-Path $dashboardJs)) {
        Write-Host "Dashboard:" -ForegroundColor Cyan

        if (Test-Path $dashboardHtml) { Doctor-Pass "dashboard/index.html" }
        else { Doctor-Warn "dashboard/index.html missing" "MCP dashboard will not render" }

        if (Test-Path $dashboardJs) { Doctor-Pass "dashboard/app.js" }
        else { Doctor-Warn "dashboard/app.js missing" "MCP dashboard has no frontend logic" }

        # Dashboard screenshots for docs
        $screenshotDir = Join-Path $RepoRoot "docs/assets/dashboard"
        if (Test-Path $screenshotDir) {
            $expectedScreenshots = @("progress.png", "runs.png", "cost.png", "actions.png", "config.png", "traces.png", "skills.png", "replay.png", "extensions.png")
            $found = (Get-ChildItem -Path $screenshotDir -Filter "*.png" -File).Name
            $missing = $expectedScreenshots | Where-Object { $_ -notin $found }
            if ($missing.Count -eq 0) {
                Doctor-Pass "$($expectedScreenshots.Count) dashboard screenshots in docs/assets/dashboard/"
            } else {
                Doctor-Warn "Missing $($missing.Count) screenshot(s): $($missing -join ', ')" "Run: node pforge-mcp/capture-screenshots.mjs"
            }
        } else {
            Doctor-Warn "docs/assets/dashboard/ not found" "Run: node pforge-mcp/capture-screenshots.mjs to generate"
        }

        # Site images
        $siteAssetsDir = Join-Path $RepoRoot "docs/assets"
        if (Test-Path $siteAssetsDir) {
            $siteImages = @("og-card.webp", "hero-illustration.webp", "problem-80-20-wall.webp")
            $siteMissing = $siteImages | Where-Object { -not (Test-Path (Join-Path $siteAssetsDir $_)) }
            if ($siteMissing.Count -eq 0) {
                Doctor-Pass "$($siteImages.Count) site images (WebP)"
            } else {
                Doctor-Warn "Missing site image(s): $($siteMissing -join ', ')" "Generate with forge_generate_image MCP tool"
            }
        }

        Write-Host ""
    }

    # ═══════════════════════════════════════════════════════════════
    # 4f. LIFECYCLE HOOKS
    # ═══════════════════════════════════════════════════════════════
    $hooksDir = Join-Path $RepoRoot ".github/hooks"
    if (Test-Path $hooksDir) {
        Write-Host "Lifecycle Hooks:" -ForegroundColor Cyan
        $expectedHooks = @("SessionStart", "PreToolUse", "PostToolUse", "Stop")
        $hookFiles = Get-ChildItem -Path $hooksDir -File | ForEach-Object { $_.BaseName }
        $hookCount = 0
        foreach ($hook in $expectedHooks) {
            $hookFound = $hookFiles | Where-Object { $_ -match $hook }
            if ($hookFound) { $hookCount++ }
        }
        if ($hookCount -eq $expectedHooks.Count) {
            Doctor-Pass "$hookCount/$($expectedHooks.Count) lifecycle hooks present"
        } elseif ($hookCount -gt 0) {
            $hookMissing = $expectedHooks | Where-Object { $h = $_; -not ($hookFiles | Where-Object { $_ -match $h }) }
            Doctor-Warn "$hookCount/$($expectedHooks.Count) hooks — missing: $($hookMissing -join ', ')" "Run 'pforge update' to install missing hooks"
        } else {
            Doctor-Warn "No lifecycle hooks found" "Run 'pforge update' to install hooks"
        }
        Write-Host ""
    }

    # ═══════════════════════════════════════════════════════════════
    # 4g. EXTENSIONS & SPEC KIT
    # ═══════════════════════════════════════════════════════════════
    $catalogPath = Join-Path $RepoRoot "extensions/catalog.json"
    if (Test-Path $catalogPath) {
        Write-Host "Extensions:" -ForegroundColor Cyan
        try {
            $catalog = Get-Content $catalogPath -Raw | ConvertFrom-Json
            $extCount = 0
            if ($catalog.extensions) { $extCount = $catalog.extensions.Count }
            Doctor-Pass "Extension catalog valid ($extCount extension(s))"

            if ($catalog.speckit_compatible -eq $true) {
                Doctor-Pass "Spec Kit compatible"
            }
        } catch {
            Doctor-Fail "extensions/catalog.json has invalid JSON" "Fix the JSON syntax"
        }
        Write-Host ""
    }

    # ═══════════════════════════════════════════════════════════════
    # 4h. VERSION & CHANGELOG SYNC
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Version & Changelog:" -ForegroundColor Cyan

    $versionPath = Join-Path $RepoRoot "VERSION"
    $changelogPath = Join-Path $RepoRoot "CHANGELOG.md"

    if (Test-Path $versionPath) {
        $currentVer = (Get-Content $versionPath -Raw).Trim()
        Doctor-Pass "VERSION: $currentVer"
    } else {
        Doctor-Warn "VERSION file not found"
    }

    if (Test-Path $changelogPath) {
        $clContent = Get-Content $changelogPath -Raw
        if ($clContent -match "\[v?$([regex]::Escape($currentVer))\]|## v?$([regex]::Escape($currentVer))") {
            Doctor-Pass "CHANGELOG.md has entry for v$currentVer"
        } else {
            Doctor-Warn "CHANGELOG.md missing entry for v$currentVer" "Add release notes for the current version"
        }
    } else {
        Doctor-Warn "CHANGELOG.md not found"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4c. QUORUM MODE
    # ═══════════════════════════════════════════════════════════════
    if (Test-Path $configPath) {
        try {
            $config = Get-Content $configPath -Raw | ConvertFrom-Json
            if ($config.quorum) {
                Write-Host "Quorum Mode:" -ForegroundColor Cyan
                $q = $config.quorum
                $enabled = if ($q.enabled) { "enabled" } else { "disabled" }
                $auto = if ($q.auto) { "auto (threshold: $($q.threshold))" } else { "forced (all slices)" }
                Doctor-Pass "Quorum $enabled — mode: $auto"

                # Check models
                if ($q.models -and $q.models.Count -gt 0) {
                    $modelList = $q.models -join ", "
                    Doctor-Pass "Quorum models: $modelList"

                    # Verify each model is available in gh copilot
                    $ghAvailable = Get-Command "gh" -ErrorAction SilentlyContinue
                    if ($ghAvailable) {
                        foreach ($m in $q.models) {
                            $testResult = & gh copilot -- -p "ping" --model $m --no-ask-user 2>&1 | Out-String
                            if ($testResult -match "not available") {
                                Doctor-Warn "Quorum model '$m' not available in gh copilot" "Run 'gh copilot -- --help' to see available models, or update .forge.json"
                            }
                        }
                    }
                } else {
                    Doctor-Warn "Quorum models not configured" "Add models array to .forge.json quorum block"
                }

                # Threshold sanity check
                if ($q.threshold -and ($q.threshold -lt 3 -or $q.threshold -gt 9)) {
                    Doctor-Warn "Quorum threshold $($q.threshold) is unusual (recommended: 5-8)" "Most projects use threshold 6-8 for balanced cost/quality"
                }

                # Reviewer model
                if ($q.reviewerModel) {
                    Doctor-Pass "Reviewer model: $($q.reviewerModel)"
                } else {
                    Doctor-Pass "Reviewer model: default (claude-opus-4.6)"
                }

                Write-Host ""
            }
        } catch { }
    }

    # ═══════════════════════════════════════════════════════════════
    # 5. COMMON PROBLEMS
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Common Problems:" -ForegroundColor Cyan

    $problemsFound = $false

    # 5a. Duplicate instruction files (same base name, different case)
    $instrDir = Join-Path $RepoRoot ".github/instructions"
    if (Test-Path $instrDir) {
        $instrFiles = Get-ChildItem -Path $instrDir -Filter "*.instructions.md" -File
        $lowerNames = @{}
        foreach ($f in $instrFiles) {
            $lower = $f.Name.ToLower()
            if ($lowerNames.ContainsKey($lower)) {
                Doctor-Fail "Duplicate instruction: $($f.Name) and $($lowerNames[$lower])" "Remove one of the duplicates from .github/instructions/"
                $problemsFound = $true
            }
            else {
                $lowerNames[$lower] = $f.Name
            }
        }
    }

    # 5b. Orphaned agents — referenced in AGENTS.md but file missing
    $agentsMdPath = Join-Path $RepoRoot "AGENTS.md"
    $agentsDir = Join-Path $RepoRoot ".github/agents"
    if ((Test-Path $agentsMdPath) -and (Test-Path $agentsDir)) {
        $agentsMdContent = Get-Content $agentsMdPath -Raw
        $referencedAgents = [regex]::Matches($agentsMdContent, '`([^`]+\.agent\.md)`') | ForEach-Object { $_.Groups[1].Value }
        $actualAgents = Get-ChildItem -Path $agentsDir -Filter "*.agent.md" -File | ForEach-Object { $_.Name }

        foreach ($ref in $referencedAgents) {
            if ($ref -notin $actualAgents) {
                Doctor-Warn "AGENTS.md references '$ref' but file not found in .github/agents/" "Remove from AGENTS.md or run 'pforge update'"
                $problemsFound = $true
            }
        }
    }

    # 5c. Instruction files with missing or broken applyTo frontmatter
    if (Test-Path $instrDir) {
        foreach ($f in (Get-ChildItem -Path $instrDir -Filter "*.instructions.md" -File)) {
            $content = Get-Content $f.FullName -Raw
            if ($content -match '^---\s*\n') {
                if ($content -notmatch 'applyTo\s*:') {
                    Doctor-Warn "$($f.Name) has frontmatter but no applyTo pattern" "Add 'applyTo: **' or a specific glob pattern"
                    $problemsFound = $true
                }
            }
        }
    }

    # 5d. copilot-instructions.md still has placeholders
    if (Test-Path $copilotInstr) {
        $ciContent = Get-Content $copilotInstr -Raw
        $placeholders = @('<YOUR PROJECT NAME>', '<YOUR TECH STACK>', '<YOUR BUILD COMMAND>', '<YOUR TEST COMMAND>', '<YOUR LINT COMMAND>', '<YOUR DEV COMMAND>', '<DATE>')
        $foundPlaceholders = @()
        foreach ($ph in $placeholders) {
            if ($ciContent -match [regex]::Escape($ph)) {
                $foundPlaceholders += $ph
            }
        }
        if ($foundPlaceholders.Count -gt 0) {
            Doctor-Warn "copilot-instructions.md has $($foundPlaceholders.Count) unresolved placeholder(s): $($foundPlaceholders -join ', ')" "Edit .github/copilot-instructions.md and fill in your project details"
            $problemsFound = $true
        }
    }

    # 5e. Roadmap file missing
    $roadmapPath = Join-Path $RepoRoot "docs/plans/DEPLOYMENT-ROADMAP.md"
    if (-not (Test-Path $roadmapPath)) {
        Doctor-Warn "DEPLOYMENT-ROADMAP.md not found" "Run 'pforge init' or create docs/plans/DEPLOYMENT-ROADMAP.md"
        $problemsFound = $true
    }

    if (-not $problemsFound) {
        Doctor-Pass "No common problems detected"
    }

    # ═══════════════════════════════════════════════════════════════
    # 6. ORCHESTRATOR STATUS
    # ═══════════════════════════════════════════════════════════════
    Write-Host ""
    Write-Host "Orchestrator:" -ForegroundColor White

    $runsDir = Join-Path $RepoRoot ".forge/runs"
    if (Test-Path $runsDir) {
        $runDirs = Get-ChildItem -Path $runsDir -Directory | Sort-Object Name -Descending
        if ($runDirs.Count -gt 0) {
            $latestRun = $runDirs[0]
            $summaryPath = Join-Path $latestRun.FullName "summary.json"
            if (Test-Path $summaryPath) {
                $summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
                $runStatus = $summary.status
                $passed = $summary.results.passed
                $failed = $summary.results.failed
                $report = $summary.report
                if ($runStatus -eq 'completed') {
                    Doctor-Pass "Last run: $report"
                } else {
                    Doctor-Warn "Last run: $runStatus ($passed passed, $failed failed)"
                }
            } else {
                Doctor-Warn "Last run has no summary (may be in-progress)" "Check .forge/runs/ for details"
            }
            Doctor-Pass "$($runDirs.Count) run(s) in .forge/runs/"
        } else {
            Doctor-Pass "No runs yet — use 'pforge run-plan <plan>' to execute a plan"
        }
    } else {
        Doctor-Pass "Orchestrator ready — use 'pforge run-plan <plan>' to execute a plan"
    }

    # Check orchestrator.mjs exists
    $orchestratorPath = Join-Path $RepoRoot "pforge-mcp/orchestrator.mjs"
    if (Test-Path $orchestratorPath) {
        Doctor-Pass "pforge-mcp/orchestrator.mjs present"
    } else {
        Doctor-Warn "pforge-mcp/orchestrator.mjs not found" "Run setup again or update from Plan Forge source"
    }

    # ═══════════════════════════════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════════════════════════════
    Write-Host ""
    Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray
    $summaryColor = if ($doc.Fail -gt 0) { 'Red' } elseif ($doc.Warn -gt 0) { 'Yellow' } else { 'Green' }
    Write-Host "  Results:  $($doc.Pass) passed  |  $($doc.Fail) failed  |  $($doc.Warn) warnings" -ForegroundColor $summaryColor
    Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray

    if ($doc.Fail -gt 0) {
        Write-Host ""
        Write-Host "Fix the $($doc.Fail) issue(s) above for the best Plan Forge experience." -ForegroundColor Red
        exit 1
    }
    elseif ($doc.Warn -gt 0) {
        Write-Host ""
        Write-Host "$($doc.Warn) warning(s) — review the suggestions above." -ForegroundColor Yellow
        exit 0
    }
    else {
        Write-Host ""
        Write-Host "Your forge is ready. Happy smithing!" -ForegroundColor Green
        exit 0
    }
}

# ─── Command: run-plan ─────────────────────────────────────────────────
function Invoke-RunPlan {
    if ($Arguments.Count -lt 1) {
        Write-Host "ERROR: Missing plan path" -ForegroundColor Red
        Write-Host "Usage: pforge run-plan <plan-file> [--estimate] [--assisted] [--model <name>] [--resume-from <N>] [--dry-run]" -ForegroundColor Yellow
        exit 1
    }

    $planPath = $Arguments[0]
    $fullPlanPath = Join-Path $RepoRoot $planPath
    if (-not (Test-Path $fullPlanPath)) {
        Write-Host "ERROR: Plan file not found: $planPath" -ForegroundColor Red
        exit 1
    }

    # Parse flags
    $estimate   = $Arguments -contains '--estimate'
    $assisted   = $Arguments -contains '--assisted'
    $dryRun     = $Arguments -contains '--dry-run'
    $model      = $null
    $resumeFrom = $null

    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -eq '--model' -and ($i + 1) -lt $Arguments.Count) {
            $model = $Arguments[$i + 1]
        }
        if ($Arguments[$i] -eq '--resume-from' -and ($i + 1) -lt $Arguments.Count) {
            $resumeFrom = $Arguments[$i + 1]
        }
    }

    $mode = if ($assisted) { 'assisted' } else { 'auto' }

    Write-ManualSteps "run-plan" @(
        "Parse plan to extract slices and validation gates"
        "Execute each slice via CLI worker (gh copilot) or human (assisted mode)"
        "Validate build/test gates at each slice boundary"
        "Write results to .forge/runs/<timestamp>/"
    )

    # Build node args
    $nodeArgs = @(
        (Join-Path $RepoRoot 'pforge-mcp/orchestrator.mjs'),
        '--run', $fullPlanPath,
        '--mode', $mode
    )
    if ($estimate)   { $nodeArgs += '--estimate' }
    if ($dryRun)     { $nodeArgs += '--dry-run' }
    if ($model)      { $nodeArgs += '--model'; $nodeArgs += $model }
    if ($resumeFrom) { $nodeArgs += '--resume-from'; $nodeArgs += $resumeFrom }

    # Delegate to orchestrator
    Write-Host ""
    if ($estimate) {
        Write-Host "Estimating cost for: $planPath" -ForegroundColor Cyan
    } elseif ($dryRun) {
        Write-Host "Dry run for: $planPath" -ForegroundColor Cyan
    } elseif ($assisted) {
        Write-Host "Starting assisted execution: $planPath" -ForegroundColor Cyan
        Write-Host "You code in VS Code, orchestrator validates gates." -ForegroundColor DarkGray
    } else {
        Write-Host "Starting full auto execution: $planPath" -ForegroundColor Cyan
    }
    Write-Host ""

    & node @nodeArgs
}

# ─── Command Router ────────────────────────────────────────────────────
switch ($Command) {
    'init'         { Invoke-Init }
    'check'        { Invoke-Check }
    'status'       { Invoke-Status }
    'new-phase'    { Invoke-NewPhase }
    'branch'       { Invoke-Branch }
    'commit'       { Invoke-Commit }
    'phase-status' { Invoke-PhaseStatus }
    'sweep'        { Invoke-Sweep }
    'diff'         { Invoke-Diff }
    'ext'          { Invoke-Ext }
    'update'       { Invoke-Update }
    'analyze'      { Invoke-Analyze }
    'run-plan'     { Invoke-RunPlan }
    'smith'        { Invoke-Smith }
    'help'         { Show-Help }
    ''             { Show-Help }
    '--help'       { Show-Help }
    default {
        Write-Host "ERROR: Unknown command '$Command'" -ForegroundColor Red
        Show-Help
        exit 1
    }
}
