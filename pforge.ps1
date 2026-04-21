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
    Write-Host "  self-update       Check for and install the latest Plan Forge release from GitHub"
    Write-Host "  analyze <plan>    Cross-artifact analysis — requirement traceability, test coverage, scope compliance"
    Write-Host "  run-plan <plan>   Execute a hardened plan — spawn CLI workers, validate at every boundary, track tokens"
    Write-Host "  version-bump <v>  Update version across all files (VERSION, package.json, docs, README)"
    Write-Host "  smith             Inspect your forge — environment, VS Code config, setup health, and common problems"
    Write-Host "  org-rules export  Export org custom instructions from .github/instructions/ for GitHub org settings"
    Write-Host "  drift             Score codebase against architecture guardrail rules — track drift over time"
    Write-Host "  incident <desc>   Capture an incident — record description, severity, affected files, and optional resolvedAt for MTTR"
    Write-Host "  deploy-log <ver>  Record a deployment — log version, deployer, optional notes, and optional slice reference"
    Write-Host "  triage            Triage open alerts — rank incidents and drift violations by priority"
    Write-Host "  regression-guard  Run validation gates from plan files — guard against regressions when files change"
    Write-Host "  runbook <plan>    Generate an operational runbook from a hardened plan file"
    Write-Host "  hotspot           Identify git churn hotspots — most frequently changed files"
    Write-Host "  secret-scan       Scan recent commits for leaked secrets using Shannon entropy analysis"
    Write-Host "  env-diff          Compare environment variable keys across .env files — detect missing keys"
    Write-Host "  health-trend      Health trend analysis — drift, cost, incidents, model performance over time"
    Write-Host "  quorum-analyze    Assemble a quorum analysis prompt from LiveGuard data for multi-model dispatch"
    Write-Host "  testbed-happypath Run all happy-path testbed scenarios sequentially with aggregated pass/fail summary"
    Write-Host "  migrate-memory    Migrate legacy .forge/memory/ entries into the L2 brain store"
    Write-Host "  drain-memory      Drain pending OpenBrain queue records to the configured OpenBrain server"
    Write-Host "  mcp-call <tool>   Invoke any MCP tool by name (e.g. forge_crucible_list) via the local MCP server"
    Write-Host "  tour              Guided walkthrough of your installed Plan Forge files"
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
    Write-Host "  .\pforge.ps1 update --check"
    Write-Host "  .\pforge.ps1 org-rules export"
    Write-Host "  .\pforge.ps1 org-rules export --format markdown --output org-rules.md"
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
    # Bug A fix: $Arguments is null when no extra args are supplied. Splatting
    # `@$null` binds empty string to `[string]$ProjectPath`, clobbering its
    # `(Get-Location).Path` default. Only splat when Arguments actually exist.
    if ($Arguments -and $Arguments.Count -gt 0) {
        & $validateScript @Arguments
    } else {
        & $validateScript -ProjectPath $RepoRoot
    }
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
        'publish' { Invoke-ExtPublish $extArgs }
        default   {
            Write-Host "ERROR: Unknown ext command: $subCmd" -ForegroundColor Red
            Write-Host "  Available: search, add, info, install, list, remove, publish" -ForegroundColor Yellow
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

function Invoke-ExtPublish([string[]]$args_) {
    if (-not $args_ -or $args_.Count -eq 0) {
        Write-Host "ERROR: Extension path required." -ForegroundColor Red
        Write-Host "  Usage: pforge ext publish <path-to-extension>" -ForegroundColor Yellow
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

    # Validate required fields
    $required = @('name', 'version', 'description', 'author')
    foreach ($field in $required) {
        if (-not $manifest.$field) {
            Write-Host "ERROR: extension.json is missing required field: '$field'" -ForegroundColor Red
            exit 1
        }
    }

    $extId = $manifest.name
    $now   = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')

    # Count artifact files from the extension's subdirectories
    $countDir = {
        param($subDir)
        $dir = Join-Path $extPath $subDir
        if (Test-Path $dir) { @(Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue).Count } else { 0 }
    }

    $instructionCount = & $countDir 'instructions'
    $agentCount       = & $countDir 'agents'
    $promptCount      = & $countDir 'prompts'
    $skillCount       = & $countDir 'skills'

    # Fall back to manifest.files arrays when directories are absent
    if ($instructionCount -eq 0 -and $manifest.files.instructions) { $instructionCount = @($manifest.files.instructions).Count }
    if ($agentCount       -eq 0 -and $manifest.files.agents)       { $agentCount       = @($manifest.files.agents).Count }
    if ($promptCount      -eq 0 -and $manifest.files.prompts)      { $promptCount      = @($manifest.files.prompts).Count }

    $minVersion = if ($manifest.minTemplateVersion) { $manifest.minTemplateVersion } else { "1.2.0" }
    if ($minVersion -notmatch '>=') { $minVersion = ">=$minVersion" }

    $repoUrl = if ($manifest.repository) { $manifest.repository } else { "https://github.com/<you>/<your-extension>" }

    $catalogEntry = [ordered]@{
        name               = if ($manifest.displayName) { $manifest.displayName } else { $extId }
        id                 = $extId
        description        = $manifest.description
        author             = $manifest.author
        version            = $manifest.version
        download_url       = if ($manifest.download_url) { $manifest.download_url } else { "$repoUrl/archive/refs/tags/v$($manifest.version).zip" }
        repository         = $repoUrl
        license            = if ($manifest.license) { $manifest.license } else { "MIT" }
        category           = if ($manifest.category) { $manifest.category } else { "code" }
        effect             = if ($manifest.effect) { $manifest.effect } else { "Read+Write" }
        requires           = [ordered]@{ planforge_version = $minVersion }
        provides           = [ordered]@{
            instructions = $instructionCount
            agents       = $agentCount
            prompts      = $promptCount
            skills       = $skillCount
        }
        tags               = if ($manifest.tags) { $manifest.tags } else { @() }
        speckit_compatible = if ($null -ne $manifest.speckit_compatible) { $manifest.speckit_compatible } else { $false }
        verified           = $false
        created_at         = $now
        updated_at         = $now
    }

    $jsonEntry = $catalogEntry | ConvertTo-Json -Depth 5

    # Build Spec Kit-compatible entry
    $speckitRules  = if ($manifest.files.instructions) { @($manifest.files.instructions) } else { @() }
    $speckitAgents = if ($manifest.files.agents)       { @($manifest.files.agents) }       else { @() }
    $speckitEntry  = [ordered]@{
        name        = $extId
        version     = $manifest.version
        description = $manifest.description
        files       = [ordered]@{
            rules  = $speckitRules
            agents = $speckitAgents
        }
    }
    $speckitJson = $speckitEntry | ConvertTo-Json -Depth 5

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  Publishing: $extId" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Plan Forge Catalog Entry:" -ForegroundColor Yellow
    Write-Host "─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "Add to extensions/catalog.json in a fork of srnichols/plan-forge:" -ForegroundColor White
    Write-Host ""
    Write-Host """$extId"": $jsonEntry" -ForegroundColor White
    Write-Host ""
    Write-Host "Spec Kit Catalog Entry:" -ForegroundColor Yellow
    Write-Host "─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "Add to your Spec Kit extensions.json:" -ForegroundColor White
    Write-Host ""
    Write-Host $speckitJson -ForegroundColor White
    Write-Host ""
    Write-Host "─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "Next steps to publish:" -ForegroundColor Cyan
    Write-Host "  1. Fork   https://github.com/srnichols/plan-forge" -ForegroundColor White
    Write-Host "  2. Edit   extensions/catalog.json — add the Plan Forge entry above" -ForegroundColor White
    Write-Host "  3. Open PR with title: feat(catalog): add $extId" -ForegroundColor White
    Write-Host "  4. Link to your extension's repository in the PR description" -ForegroundColor White
    Write-Host "  5. If Spec Kit compatible, add the Spec Kit entry to your Spec Kit extensions.json" -ForegroundColor White
    Write-Host ""
    Write-Host "See extensions/PUBLISHING.md for full submission guidelines." -ForegroundColor DarkGray
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
    $frameworkTotal = 0
    $fwCategories = @{ TODO = 0; FIXME = 0; HACK = 0; placeholder = 0; stub = 0; other = 0 }

    foreach ($ext in $codeExtensions) {
        Get-ChildItem -Path $RepoRoot -Filter $ext -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '(node_modules|bin|obj|dist|\.git|vendor|__pycache__)' } |
            ForEach-Object {
                $findings = Select-String -Path $_.FullName -Pattern $patternRegex -CaseSensitive:$false
                $relPath = $_.FullName.Substring($RepoRoot.Length + 1)
                $isFramework = $relPath -match '^(pforge-mcp[/\\]|pforge\.(ps1|sh)$|setup\.(ps1|sh)$|validate-setup\.(ps1|sh)$)'
                foreach ($m in $findings) {
                    $relDisplay = $m.Path.Substring($RepoRoot.Length + 1)
                    if ($isFramework) {
                        $frameworkTotal++
                        $line = $m.Line
                        if ($line -match '\bTODO\b') { $fwCategories['TODO']++ }
                        elseif ($line -match '\bFIXME\b') { $fwCategories['FIXME']++ }
                        elseif ($line -match '\bHACK\b') { $fwCategories['HACK']++ }
                        elseif ($line -match 'placeholder') { $fwCategories['placeholder']++ }
                        elseif ($line -match 'stub') { $fwCategories['stub']++ }
                        else { $fwCategories['other']++ }
                    } else {
                        Write-Host "  $relDisplay`:$($m.LineNumber): $($m.Line.Trim())" -ForegroundColor Yellow
                        $total++
                    }
                }
            }
    }

    Write-Host ""
    if ($total -eq 0) {
        Write-Host "SWEEP CLEAN — zero deferred-work markers found in app code." -ForegroundColor Green
    }
    else {
        Write-Host "FOUND $total deferred-work marker(s) in app code. Resolve before Step 5 (Review Gate)." -ForegroundColor Red
    }
    if ($frameworkTotal -gt 0) {
        $breakdown = ($fwCategories.GetEnumerator() | Where-Object { $_.Value -gt 0 } | ForEach-Object { "$($_.Key): $($_.Value)" }) -join ', '
        Write-Host "  ($frameworkTotal marker(s) in framework code — $breakdown)" -ForegroundColor DarkGray
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

    # Get changed files (temporarily lower ErrorActionPreference so git CRLF warnings don't throw)
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $changedFiles = @()
    $changedFiles += (git diff --name-only 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    $changedFiles += (git diff --cached --name-only 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    $ErrorActionPreference = $savedEAP
    $changedFiles = $changedFiles | Sort-Object -Unique | Where-Object { $_ }

    if ($changedFiles.Count -eq 0) {
        Write-Host "No changed files detected." -ForegroundColor Yellow
        return
    }

    $planContent = Get-Content $planFile -Raw

    # Extract In Scope paths
    $inScopeSection = ""
    if ($planContent -match '(?s)### In Scope(.*?)(?=^###?\s|\z)') {
        $inScopeSection = $Matches[1]
    }
    $inScopePaths = [regex]::Matches($inScopeSection, '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }

    # Extract Forbidden Actions paths
    $forbiddenSection = ""
    if ($planContent -match '(?s)### Forbidden Actions(.*?)(?=^###?\s|\z)') {
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
        exit 1
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

    $dryRun = $Arguments -contains '--dry-run' -or $Arguments -contains '--check'
    $forceUpdate = $Arguments -contains '--force'
    $fromGitHub = $Arguments -contains '--from-github'
    $keepCache = $Arguments -contains '--keep-cache'

    # Parse --tag <value>
    $ghTag = $null
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -eq '--tag' -and ($i + 1) -lt $Arguments.Count) {
            $ghTag = $Arguments[$i + 1]
            break
        }
    }

    # ─── --from-github path ──────────────────────────────────────
    $sourcePath = $null
    $ghExtractDir = $null
    $ghTarball = $null

    # Helper: fetch + extract tarball for a resolved tag, returns source path.
    function Fetch-GitHubSource {
        param([string]$RequestedTag)
        $nodeHelper = Join-Path $RepoRoot "pforge-mcp/update-from-github.mjs"
        if (-not (Test-Path $nodeHelper)) {
            Write-Host "ERROR: Node helper not found at $nodeHelper" -ForegroundColor Red
            Write-Host "  Ensure pforge-mcp/update-from-github.mjs exists." -ForegroundColor Yellow
            exit 1
        }

        Write-Host "Resolving release tag from GitHub..." -ForegroundColor DarkCyan
        $tagArgs = @("resolve-tag")
        if ($RequestedTag) { $tagArgs += @("--tag", $RequestedTag) }
        $tagResult = & node $nodeHelper @tagArgs 2>&1 | Select-Object -Last 1
        try { $tagJson = $tagResult | ConvertFrom-Json } catch {
            Write-Host "ERROR: Failed to parse tag resolution output: $tagResult" -ForegroundColor Red
            exit 1
        }
        if (-not $tagJson.ok) {
            Write-Host "ERROR: $($tagJson.code) — $($tagJson.message)" -ForegroundColor Red
            exit 1
        }
        $resolvedTag = $tagJson.tag
        Write-Host "  Tag: $resolvedTag" -ForegroundColor White

        Write-Host "Downloading release tarball..." -ForegroundColor DarkCyan
        $dlArgs = @("download", "--tag", $resolvedTag, "--project-dir", $RepoRoot)
        $dlResult = & node $nodeHelper @dlArgs 2>&1 | Select-Object -Last 1
        try { $dlJson = $dlResult | ConvertFrom-Json } catch {
            Write-Host "ERROR: Failed to parse download output: $dlResult" -ForegroundColor Red
            exit 1
        }
        if (-not $dlJson.ok) {
            Write-Host "ERROR: $($dlJson.code) — $($dlJson.message)" -ForegroundColor Red
            exit 1
        }
        $script:ghTarball = $dlJson.path
        Write-Host "  Downloaded: $($dlJson.path) ($($dlJson.sizeBytes) bytes)" -ForegroundColor White
        Write-Host "  SHA-256: $($dlJson.sha256)" -ForegroundColor DarkGray

        $safeName = $resolvedTag -replace '[^a-zA-Z0-9._-]', '_'
        $script:ghExtractDir = Join-Path (Split-Path $script:ghTarball -Parent) "update-$safeName"
        if (Test-Path $script:ghExtractDir) { Remove-Item -Recurse -Force $script:ghExtractDir }
        New-Item -ItemType Directory -Path $script:ghExtractDir -Force | Out-Null

        Write-Host "Extracting tarball..." -ForegroundColor DarkCyan
        try {
            & tar xzf $script:ghTarball -C $script:ghExtractDir 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: tar extraction failed (exit code $LASTEXITCODE)." -ForegroundColor Red
                Write-Host "  Ensure 'tar' is available (Windows 10+ includes tar.exe)." -ForegroundColor Yellow
                exit 1
            }
        } catch {
            Write-Host "ERROR: ERR_NO_TAR — tar not found." -ForegroundColor Red
            Write-Host "  Windows 10+ ships tar.exe. Ensure it is on your PATH." -ForegroundColor Yellow
            exit 1
        }

        $topDirs = Get-ChildItem -Path $script:ghExtractDir -Directory
        if ($topDirs.Count -ge 1) {
            $result = $topDirs[0].FullName
        } else {
            $result = $script:ghExtractDir
        }
        Write-Host "  Extracted to: $result" -ForegroundColor White
        Write-Host ""
        return $result
    }

    if ($fromGitHub) {
        $sourcePath = Fetch-GitHubSource -RequestedTag $ghTag
    } else {
        # ─── Locate source (positional path → preference → sibling → github fallback) ──
        foreach ($arg in $Arguments) {
            if ($arg -notlike '--*' -and (Test-Path $arg)) {
                $sourcePath = (Resolve-Path $arg).Path
                break
            }
        }

        # v2.56.0 — read updateSource preference from .forge.json (auto | github-tags | local-sibling)
        $updateSourcePref = "auto"
        $prefConfigPath = Join-Path $RepoRoot ".forge.json"
        if (Test-Path $prefConfigPath) {
            try {
                $prefConfig = Get-Content $prefConfigPath -Raw | ConvertFrom-Json
                if ($prefConfig.updateSource) {
                    $prefVal = [string]$prefConfig.updateSource
                    if ($prefVal -in @("auto", "github-tags", "local-sibling")) {
                        $updateSourcePref = $prefVal
                    }
                }
            } catch { /* malformed config → default to auto */ }
        }

        # Find sibling clone (if any)
        $siblingPath = $null
        if (-not $sourcePath) {
            $candidates = @(
                (Join-Path (Split-Path $RepoRoot -Parent) "plan-forge"),
                (Join-Path (Split-Path $RepoRoot -Parent) "Plan-Forge")
            )
            foreach ($c in $candidates) {
                if (Test-Path (Join-Path $c "VERSION")) { $siblingPath = $c; break }
            }
        }

        if (-not $sourcePath) {
            switch ($updateSourcePref) {
                "github-tags" {
                    # Team-pinned: always use GitHub, ignore sibling
                    if ($siblingPath) {
                        Write-Host "  Note: updateSource='github-tags' — ignoring sibling clone at $siblingPath" -ForegroundColor DarkGray
                    }
                    Write-Host "  Using GitHub tagged release (updateSource='github-tags')" -ForegroundColor DarkCyan
                    $fromGitHub = $true
                }
                "local-sibling" {
                    # Contributor-pinned: sibling or bust
                    if ($siblingPath) {
                        $sourcePath = $siblingPath
                    } else {
                        Write-Host "ERROR: updateSource='local-sibling' but no sibling clone found." -ForegroundColor Red
                        Write-Host "  Change '.forge.json' updateSource to 'auto' or 'github-tags', or clone:" -ForegroundColor Yellow
                        Write-Host "    git clone https://github.com/srnichols/plan-forge.git ../plan-forge" -ForegroundColor Yellow
                        exit 1
                    }
                }
                default {
                    # Auto mode — prefer the source with the newer STABLE release
                    if ($siblingPath) {
                        $siblingVer = $null
                        try { $siblingVer = (Get-Content (Join-Path $siblingPath "VERSION") -Raw).Trim() } catch {}
                        $siblingIsDev = $siblingVer -match '-dev\b'

                        # Fetch latest tag via node helper (cached 24h in .forge/update-check.json)
                        $latestTagVer = $null
                        $nodeHelperProbe = Join-Path $RepoRoot "pforge-mcp/update-from-github.mjs"
                        if (Test-Path $nodeHelperProbe) {
                            try {
                                $tagProbe = & node $nodeHelperProbe resolve-tag 2>&1 | Select-Object -Last 1
                                $tagProbeJson = $tagProbe | ConvertFrom-Json
                                if ($tagProbeJson.ok -and $tagProbeJson.tag) {
                                    $latestTagVer = ($tagProbeJson.tag -replace '^v', '').Trim()
                                }
                            } catch { /* network down or helper missing → fall back to sibling */ }
                        }

                        if ($latestTagVer -and $siblingIsDev) {
                            # Sibling is on master (-dev). If the latest tag is a clean release, prefer it.
                            Write-Host "  Note: sibling clone is on -dev ($siblingVer); latest tagged release is v$latestTagVer" -ForegroundColor DarkGray
                            Write-Host "  Using GitHub tagged release (set updateSource='local-sibling' in .forge.json to always use sibling)" -ForegroundColor DarkCyan
                            $fromGitHub = $true
                        } elseif ($latestTagVer -and $siblingVer) {
                            # Both clean. Compare — use whichever is newer (ties go to sibling for speed).
                            $nodeCmp = Join-Path $RepoRoot "pforge-mcp/update-check.mjs"
                            $cmpResult = 0
                            if (Test-Path $nodeCmp) {
                                try {
                                    $cmpStr = & node -e "import('$($nodeCmp -replace '\\', '/')').then(m=>{console.log(m.compareVersions('$siblingVer','$latestTagVer'))})" 2>&1 | Select-Object -Last 1
                                    $cmpResult = [int]$cmpStr
                                } catch { $cmpResult = 0 }
                            }
                            if ($cmpResult -lt 0) {
                                Write-Host "  Note: sibling clone (v$siblingVer) is behind latest tag (v$latestTagVer)" -ForegroundColor DarkGray
                                Write-Host "  Using GitHub tagged release (run 'git pull' in $siblingPath to dogfood master)" -ForegroundColor DarkCyan
                                $fromGitHub = $true
                            } else {
                                $sourcePath = $siblingPath
                            }
                        } else {
                            # No network / helper missing → use sibling
                            $sourcePath = $siblingPath
                        }
                    } else {
                        # No sibling at all → auto-fallback to GitHub (v2.56.0: was an error before)
                        Write-Host "  No sibling clone found — using GitHub tagged release" -ForegroundColor DarkCyan
                        $fromGitHub = $true
                    }
                }
            }
        }

        # If auto mode flipped us to GitHub, fetch + extract the tarball now.
        if (-not $sourcePath -and $fromGitHub) {
            $sourcePath = Fetch-GitHubSource -RequestedTag $ghTag
        }

        if (-not $sourcePath) {
            Write-Host "ERROR: Plan Forge source not found." -ForegroundColor Red
            Write-Host "  Provide the path to your Plan Forge clone:" -ForegroundColor Yellow
            Write-Host "    .\pforge.ps1 update C:\path\to\plan-forge" -ForegroundColor Yellow
            Write-Host "  Or use --from-github to download from GitHub:" -ForegroundColor Yellow
            Write-Host "    .\pforge.ps1 update --from-github" -ForegroundColor Yellow
            Write-Host "  Or clone it next to your project:" -ForegroundColor Yellow
            Write-Host "    git clone https://github.com/srnichols/plan-forge.git ../plan-forge" -ForegroundColor Yellow
            exit 1
        }
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

    # v2.53.1 — refuse to install a '-dev' source over a clean install.
    # Catches the "local sibling clone on master" case where `pforge update`
    # would otherwise drag a consumer onto unreleased dev bytes.
    $allowDev = $Arguments -contains '--allow-dev'
    $sourceIsDev = $sourceVersion -match '-dev\b'
    $currentIsDev = ($currentVersion -match '-dev\b') -or ($currentVersion -eq 'unknown')
    if ($sourceIsDev -and -not $currentIsDev -and -not $allowDev) {
        Write-Host ""
        Write-Host "REFUSED: source VERSION '$sourceVersion' is a '-dev' build." -ForegroundColor Red
        Write-Host "  Your current install (v$currentVersion) is a clean release —" -ForegroundColor Yellow
        Write-Host "  installing this source would downgrade you into unreleased code." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Most likely cause: your source path points to a local clone" -ForegroundColor DarkGray
        Write-Host "    on master. Use 'pforge self-update' instead — it always" -ForegroundColor DarkGray
        Write-Host "    pulls the latest tagged release from GitHub." -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Override (not recommended): re-run with --allow-dev" -ForegroundColor DarkGray
        exit 1
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
        Get-ChildItem -Path $srcPrompts -Filter "*.prompt.md" -File | ForEach-Object {
            # project-principles.prompt.md is user-customized (lives in templates/ source) — never auto-update
            if ($_.Name -eq 'project-principles.prompt.md') { return }
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
    $sharedInstructions = @("architecture-principles.instructions.md", "git-workflow.instructions.md", "ai-plan-hardening-runbook.instructions.md", "status-reporting.instructions.md", "context-fuel.instructions.md")
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

    # ─── MCP server files (auto-discover all files) ──────────────
    $srcMcp = Join-Path $sourcePath "pforge-mcp"
    $dstMcp = Join-Path $RepoRoot "pforge-mcp"
    if (Test-Path $srcMcp) {
        Get-ChildItem -Path $srcMcp -File -Recurse | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object {
            $relPath = $_.FullName.Substring($srcMcp.Length + 1)
            $relName = "pforge-mcp/$($relPath.Replace('\', '/'))"
            $dstFile = Join-Path $dstMcp $relPath
            if ($neverUpdate -contains $relName) { return }
            if (Test-Path $dstFile) {
                $srcHash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
                }
            } else {
                $newFiles += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
            }
        }
    }

    # ─── CLI scripts (pforge.ps1, pforge.sh) ─────────────────────
    foreach ($cliFile in @("pforge.ps1", "pforge.sh")) {
        $srcFile = Join-Path $sourcePath $cliFile
        $dstFile = Join-Path $RepoRoot $cliFile
        if ((Test-Path $srcFile) -and (Test-Path $dstFile)) {
            $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
            if ($srcHash -ne $dstHash) {
                $updates += @{ Src = $srcFile; Dst = $dstFile; Name = $cliFile }
            }
        } elseif ((Test-Path $srcFile) -and -not (Test-Path $dstFile)) {
            $newFiles += @{ Src = $srcFile; Dst = $dstFile; Name = $cliFile }
        }
    }

    # ─── Validation scripts ──────────────────────────────────────
    foreach ($valFile in @("validate-setup.ps1", "validate-setup.sh")) {
        $srcFile = Join-Path $sourcePath $valFile
        $dstFile = Join-Path $RepoRoot $valFile
        if ((Test-Path $srcFile) -and (Test-Path $dstFile)) {
            $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
            if ($srcHash -ne $dstHash) {
                $updates += @{ Src = $srcFile; Dst = $dstFile; Name = $valFile }
            }
        } elseif ((Test-Path $srcFile) -and -not (Test-Path $dstFile)) {
            $newFiles += @{ Src = $srcFile; Dst = $dstFile; Name = $valFile }
        }
    }

    # ─── Core framework files (CLI + MCP server runtime) ─────────
    # ─── Core CLI files (root level) ────────────────────────────
    foreach ($cliFile in @("pforge.ps1", "pforge.sh", "VERSION")) {
        $srcFile = Join-Path $sourcePath $cliFile
        $dstFile = Join-Path $RepoRoot $cliFile
        if (Test-Path $srcFile) {
            if (Test-Path $dstFile) {
                $srcHash = (Get-FileHash $srcFile -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $srcFile; Dst = $dstFile; Name = $cliFile }
                }
            } else {
                $newFiles += @{ Src = $srcFile; Dst = $dstFile; Name = $cliFile }
            }
        }
    }

    # ─── MCP server files (all — single recursive scan) ──────────
    $srcMcp = Join-Path $sourcePath "pforge-mcp"
    $dstMcp = Join-Path $RepoRoot "pforge-mcp"
    if (Test-Path $srcMcp) {
        Get-ChildItem -Path $srcMcp -File -Recurse |
            Where-Object { $_.FullName -notmatch '(node_modules|\.forge|coverage)' } |
            ForEach-Object {
                $relPath = $_.FullName.Substring($srcMcp.Length + 1)
                $relName = "pforge-mcp/$($relPath.Replace('\', '/'))"
                $dstFile = Join-Path $dstMcp $relPath
                if (Test-Path $dstFile) {
                    $srcHash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
                    $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                    if ($srcHash -ne $dstHash) {
                        $updates += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
                    }
                } else {
                    $newFiles += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
                }
            }
    }

    # ─── Hook files (lifecycle + LiveGuard) ─────────────────────
    $srcHooks = Join-Path $sourcePath "templates/.github/hooks"
    $dstHooks = Join-Path $RepoRoot ".github/hooks"
    if (Test-Path $srcHooks) {
        Get-ChildItem -Path $srcHooks -File -Recurse | ForEach-Object {
            $relPath = $_.FullName.Substring($srcHooks.Length + 1)
            $relName = ".github/hooks/$($relPath.Replace('\', '/'))"
            $dstFile = Join-Path $dstHooks $relPath
            if (Test-Path $dstFile) {
                $srcHash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
                $dstHash = (Get-FileHash $dstFile -Algorithm SHA256).Hash
                if ($srcHash -ne $dstHash) {
                    $updates += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
                }
            } else {
                $newFiles += @{ Src = $_.FullName; Dst = $dstFile; Name = $relName }
            }
        }
    }

    # ─── Shared skills (add new, update existing shared-only) ────
    $srcSharedSkills = Join-Path $sourcePath "presets/shared/skills"
    if (Test-Path $srcSharedSkills) {
        Get-ChildItem -Path $srcSharedSkills -Directory | ForEach-Object {
            $skillName = $_.Name
            $srcSkillFile = Join-Path $_.FullName "SKILL.md"
            $dstSkillFile = Join-Path $RepoRoot ".github/skills/$skillName/SKILL.md"

            if (-not (Test-Path $srcSkillFile)) { return }

            # Check if the preset has a stack-specific version
            $hasPresetVersion = $false
            foreach ($p in ($presets | Where-Object { $_ -ne 'custom' })) {
                $presetSkill = Join-Path $sourcePath "presets/$p/.github/skills/$skillName/SKILL.md"
                if (Test-Path $presetSkill) { $hasPresetVersion = $true; break }
            }

            if (-not $hasPresetVersion) {
                # Pure shared skill — safe to update
                if (Test-Path $dstSkillFile) {
                    $srcHash = (Get-FileHash $srcSkillFile -Algorithm SHA256).Hash
                    $dstHash = (Get-FileHash $dstSkillFile -Algorithm SHA256).Hash
                    if ($srcHash -ne $dstHash) {
                        $updates += @{ Src = $srcSkillFile; Dst = $dstSkillFile; Name = ".github/skills/$skillName/SKILL.md (shared)" }
                    }
                } else {
                    $newFiles += @{ Src = $srcSkillFile; Dst = $dstSkillFile; Name = ".github/skills/$skillName/SKILL.md (shared)" }
                }
            }
            # If preset has a stack-specific version, the preset skill update handles it
        }
    }

    # ─── Deduplicate (overlapping scans may add same file twice) ─
    $updates = $updates | Group-Object -Property { $_.Name } | ForEach-Object { $_.Group[0] }
    $newFiles = $newFiles | Group-Object -Property { $_.Name } | ForEach-Object { $_.Group[0] }

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
        $confirm = Read-Host "Apply $($updates.Count) updates and $($newFiles.Count) new files? [y/N] (use --force to skip this prompt)"
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

    # ─── Update .forge.json version + migrate new fields ─────────
    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $config.templateVersion = $sourceVersion

        # Migrate: add modelRouting.default if missing (v2.27+)
        if (-not $config.modelRouting) {
            $config | Add-Member -NotePropertyName "modelRouting" -NotePropertyValue @{ default = "claude-opus-4.6" }
            Write-Host "  ✅ Added modelRouting.default = claude-opus-4.6" -ForegroundColor Green
        }

        # Migrate: add hooks config if missing (v2.29+)
        if (-not $config.hooks) {
            $config | Add-Member -NotePropertyName "hooks" -NotePropertyValue @{
                preDeploy       = @{ blockOnSecrets = $true; warnOnEnvGaps = $true; scanSince = "HEAD~1" }
                postSlice       = @{ silentDeltaThreshold = 5; warnDeltaThreshold = 10; scoreFloor = 70 }
                preAgentHandoff = @{ injectContext = $true; runRegressionGuard = $true; cacheMaxAgeMinutes = 30; minAlertSeverity = "medium" }
            }
            Write-Host "  ✅ Added hooks config (preDeploy, postSlice, preAgentHandoff)" -ForegroundColor Green
        }

        $config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath
        Write-Host "  ✅ Updated .forge.json templateVersion to $sourceVersion" -ForegroundColor Green
    }

    # ─── Create docs/plans/auto/ if missing (v2.29+) ─────────────
    $autoPlansDir = Join-Path $RepoRoot "docs/plans/auto"
    if (-not (Test-Path $autoPlansDir)) {
        New-Item -ItemType Directory -Path $autoPlansDir -Force | Out-Null
        $autoReadme = Join-Path $autoPlansDir "README.md"
        Set-Content -Path $autoReadme -Value @"
# Auto-Generated Plans

This directory contains plans auto-generated by LiveGuard tools (e.g. ``forge_fix_proposal``).

Files in this directory (except this README) are gitignored — they are runtime artifacts, not source-controlled plans.
"@
        Write-Host "  ✅ Created docs/plans/auto/" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Update complete: v$currentVersion → v$sourceVersion" -ForegroundColor Green
    Write-Host "Run 'pforge check' to validate the updated setup." -ForegroundColor DarkGray

    # v2.53.1 — invalidate version caches so smith/dashboard pick up fresh state.
    # Prevents stale "update available" banners after a successful heal.
    foreach ($cacheFile in @(".forge/version-check.json", ".forge/install-health.json")) {
        $cachePath = Join-Path $RepoRoot $cacheFile
        if (Test-Path $cachePath) {
            try { Remove-Item -Force $cachePath -ErrorAction SilentlyContinue } catch { }
        }
    }
    # Write a fresh update-check.json so the next check returns isNewer=false
    # without hitting the network (Fix A — self-update invalidates cache).
    try {
        $freshCacheScript = @"
import { writeFreshCache } from './pforge-mcp/update-check.mjs';
writeFreshCache(process.argv[1], process.argv[2]);
"@
        & node --input-type=module -e $freshCacheScript $RepoRoot $sourceVersion 2>&1 | Out-Null
    } catch { }

    # Auto-install MCP dependencies if MCP files were updated.
    # Bugs B & C fix: wrap both in @() so a single-hashtable $updates or
    # $newFiles doesn't unwrap into a bare hashtable (which triggers either
    # "hash table can only be added to another hash table" or, worse, a
    # hashtable-merge with a 'Name' key collision).
    $mcpUpdated = @(@($updates) + @($newFiles) | Where-Object { $_.Name -like "pforge-mcp/*" })
    if ($mcpUpdated) {
        $mcpDir = Join-Path $RepoRoot "pforge-mcp"
        if (Test-Path (Join-Path $mcpDir "package.json")) {
            Write-Host ""
            Write-Host "Installing MCP dependencies..." -ForegroundColor DarkCyan
            try {
                $npmOutput = & npm install --prefix $mcpDir 2>&1
                Write-Host "  ✅ npm install complete" -ForegroundColor Green
            } catch {
                Write-Host "  ⚠️  npm install failed — run manually: cd pforge-mcp && npm install" -ForegroundColor Yellow
            }
        }

        # Detect if MCP server is running and advise restart
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:3100/api/status" -Method GET -TimeoutSec 2 -ErrorAction Stop
            Write-Host ""
            Write-Host "⚠️  MCP server is running on port 3100 — restart it to pick up changes." -ForegroundColor Yellow
            Write-Host "  Stop the current server, then: node pforge-mcp/server.mjs" -ForegroundColor Yellow
        } catch {
            # Not running — no action needed
        }
    }

    # Check if CLI itself was updated — inform user
    $cliUpdated = @(@($updates) + @($newFiles) | Where-Object { $_.Name -eq 'pforge.ps1' -or $_.Name -eq 'pforge.sh' })
    if ($cliUpdated) {
        Write-Host ""
        Write-Host "ℹ️  CLI scripts (pforge.ps1/pforge.sh) were updated." -ForegroundColor Cyan
        Write-Host "  The new version is already on disk. No restart needed." -ForegroundColor DarkGray
    }

    # ─── --from-github: audit log + cleanup ──────────────────────
    if ($fromGitHub -and -not $dryRun) {
        $filesChanged = ($updates.Count + $newFiles.Count)
        $auditEntry = @{
            tag = $resolvedTag
            sha256 = $ghSha256
            sizeBytes = $ghSizeBytes
            source = "manual"
            filesChanged = $filesChanged
            outcome = "success"
        } | ConvertTo-Json -Compress
        $auditEntry | & node (Join-Path $RepoRoot "pforge-mcp/update-from-github.mjs") audit --project-dir $RepoRoot 2>&1 | Out-Null
    }
    if ($fromGitHub -and -not $keepCache) {
        if ($ghTarball -and (Test-Path $ghTarball)) { Remove-Item -Force $ghTarball }
        if ($ghExtractDir -and (Test-Path $ghExtractDir)) { Remove-Item -Recurse -Force $ghExtractDir }
        Write-Host "  Cleaned up cache files." -ForegroundColor DarkGray
    } elseif ($fromGitHub -and $keepCache) {
        Write-Host "  Cache preserved (--keep-cache): $ghTarball" -ForegroundColor DarkGray
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

    # Fix 9: Also parse checkbox format as fallback criteria
    if ($allCriteria.Count -eq 0) {
        $checkboxCriteria = [regex]::Matches($planContent, '(?m)(?<=## Acceptance Criteria\s*\n)(?:^\s*- \[[ x]\]\s*(.+)\n?)+') 
        if (-not $checkboxCriteria -or $checkboxCriteria.Count -eq 0) {
            # Try line-by-line within acceptance criteria section
            $inAC = $false
            foreach ($line in $planContent -split "`n") {
                if ($line -match '(?i)## Acceptance Criteria') { $inAC = $true; continue }
                if ($inAC -and $line -match '^\s*---\s*$|^##\s') { break }
                if ($inAC -and $line -match '^\s*-\s*\[[ x]\]\s*(.+)') { $allCriteria += $Matches[1].Trim() }
            }
            if ($allCriteria.Count -gt 0) {
                $mustCriteria = $allCriteria  # Treat all checkboxes as MUST for scoring
            }
        }
    }

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

    # Get changed files (temporarily lower ErrorActionPreference so git CRLF warnings don't throw)
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $changedFiles = @()
    $changedFiles += (git diff --name-only 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    $changedFiles += (git diff --cached --name-only 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    $ErrorActionPreference = $savedEAP
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

    # Gate command lint — catch errors that would fail at runtime
    try {
        $lintOutput = node -e "import('$($RepoRoot -replace '\\','/')/pforge-mcp/orchestrator.mjs').then(m => { const r = m.lintGateCommands('$($planFile -replace '\\','/').replace(\"'\",\"\\'\")'); console.log(JSON.stringify(r)); })" 2>&1
        $lintResult = $lintOutput | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($lintResult) {
            if ($lintResult.errors.Count -gt 0) {
                Write-Host "  ❌ Gate lint: $($lintResult.errors.Count) error(s) — plan will fail at runtime" -ForegroundColor Red
                foreach ($e in $lintResult.errors) {
                    Write-Host "     $($e.message)" -ForegroundColor Red
                }
                $scoreGates = [Math]::Max(0, $scoreGates - (5 * $lintResult.errors.Count))
            }
            if ($lintResult.warnings.Count -gt 0) {
                Write-Host "  ⚠️  Gate lint: $($lintResult.warnings.Count) warning(s)" -ForegroundColor Yellow
                foreach ($w in $lintResult.warnings) {
                    Write-Host "     $($w.message)" -ForegroundColor Yellow
                }
                $scoreGates = [Math]::Max(0, $scoreGates - (2 * $lintResult.warnings.Count))
            }
            if ($lintResult.errors.Count -eq 0 -and $lintResult.warnings.Count -eq 0) {
                Write-Host "  ✅ Gate lint: all commands pass pre-flight checks" -ForegroundColor Green
            }
        }
    } catch {
        # Gate lint is advisory — don't block analyze on lint failures
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

# ─── Command: drift ────────────────────────────────────────────────────
function Invoke-Drift {
    $threshold = 70
    foreach ($arg in $Arguments) {
        if ($arg -match '^--threshold[= ]?(\d+)$') { $threshold = [int]$Matches[1] }
        elseif ($arg -match '^\d+$') { $threshold = [int]$arg }
    }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       Plan Forge — Drift Report                              ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Scanning source files for architecture guardrail violations..." -ForegroundColor Cyan
    Write-Host "Threshold: $threshold/100" -ForegroundColor White
    Write-Host ""

    $extensions = @("*.js", "*.mjs", "*.ts", "*.tsx", "*.cs", "*.py")
    $excludeDirs = @("node_modules", ".git", "bin", "obj", "dist", ".forge", "vendor", "coverage")

    $rules = @(
        @{ id = "empty-catch";     pattern = 'catch\s*(?:\([^)]*\))?\s*\{\s*(?://[^\n]*)?\s*\}|catch\s*(?:\([^)]*\))?\s*\{\s*/\*[^*]*\*/\s*\}'; severity = "high";     label = "Empty catch block" },
        @{ id = "any-type";        pattern = ':\s*any\b|<any>|as\s+any\b';                                  severity = "medium";   label = "Avoid 'any' type" },
        @{ id = "sync-over-async"; pattern = '\.(Result|Wait\(\))\b';                                       severity = "high";     label = "Sync-over-async (.Result/.Wait())" },
        @{ id = "sql-injection";   pattern = '`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{';      severity = "critical"; label = "SQL string interpolation" },
        @{ id = "deferred-work";   pattern = '\b(TODO|FIXME|HACK)\b';                                       severity = "low";      label = "Deferred work marker" }
    )

    $violations = [System.Collections.Generic.List[object]]::new()
    $frameworkViolations = [System.Collections.Generic.List[object]]::new()
    $filesScanned = 0

    $excludeFilter = "($($excludeDirs -join '|'))"
    $frameworkFilter = '^(pforge-mcp[/\\]|pforge\.(ps1|sh)$|setup\.(ps1|sh)$|validate-setup\.(ps1|sh)$)'

    foreach ($ext in $extensions) {
        $files = Get-ChildItem -Path $RepoRoot -Filter $ext -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch $excludeFilter }
        foreach ($file in $files) {
            $filesScanned++
            try {
                $content = Get-Content -Path $file.FullName -Raw -ErrorAction Stop
                $relPath = $file.FullName.Substring($RepoRoot.Length).TrimStart('\', '/')
                $isFramework = $relPath -match $frameworkFilter
                foreach ($rule in $rules) {
                    # Skip SQL injection rule for framework/dashboard code
                    if ($isFramework -and $rule.id -eq 'sql-injection') { continue }
                    $matches = [regex]::Matches($content, $rule.pattern)
                    foreach ($m in $matches) {
                        $lineNum = ($content.Substring(0, $m.Index) -split "`n").Count
                        $entry = [PSCustomObject]@{
                            file        = $relPath
                            rule        = $rule.id
                            severity    = $rule.severity
                            line        = $lineNum
                            description = $rule.label
                        }
                        if ($isFramework) {
                            $frameworkViolations.Add($entry)
                        } else {
                            $violations.Add($entry)
                        }
                    }
                }
            } catch { }
        }
    }

    $penaltyPerViolation = 2
    $score = [Math]::Max(0, 100 - ($violations.Count * $penaltyPerViolation))

    Write-Host "Files scanned:  $filesScanned" -ForegroundColor White
    Write-Host "App violations: $($violations.Count)" -ForegroundColor $(if ($violations.Count -eq 0) { 'Green' } elseif ($violations.Count -le 5) { 'Yellow' } else { 'Red' })
    if ($frameworkViolations.Count -gt 0) {
        Write-Host "Framework:      $($frameworkViolations.Count) (informational, not scored)" -ForegroundColor DarkGray
    }
    Write-Host "Score:          $score/100" -ForegroundColor $(if ($score -ge 80) { 'Green' } elseif ($score -ge $threshold) { 'Yellow' } else { 'Red' })
    Write-Host ""

    if ($violations.Count -gt 0) {
        Write-Host "Violations:" -ForegroundColor Cyan
        foreach ($v in $violations | Select-Object -First 20) {
            $color = switch ($v.severity) { 'critical' { 'Red' } 'high' { 'Red' } 'medium' { 'Yellow' } default { 'DarkYellow' } }
            Write-Host "  [$($v.severity.ToUpper())] $($v.file):$($v.line) — $($v.description)" -ForegroundColor $color
        }
        if ($violations.Count -gt 20) {
            Write-Host "  ... and $($violations.Count - 20) more violations" -ForegroundColor DarkYellow
        }
        Write-Host ""
    }

    # Load history and compute trend
    $historyFile = Join-Path $RepoRoot ".forge\drift-history.json"
    $history = @()
    if (Test-Path $historyFile) {
        try { $history = Get-Content $historyFile -Raw | ConvertFrom-Json } catch { }
    }
    $prev = if ($history.Count -gt 0) { $history[-1] } else { $null }
    $delta = if ($prev) { $score - $prev.score } else { 0 }
    $trend = if (-not $prev) { "stable" } elseif ($delta -gt 0) { "improving" } elseif ($delta -lt 0) { "degrading" } else { "stable" }

    $record = @{
        timestamp    = (Get-Date -Format "o")
        score        = $score
        violations   = @($violations | ForEach-Object { @{ file = $_.file; rule = $_.rule; severity = $_.severity; line = $_.line } })
        filesScanned = $filesScanned
        delta        = $delta
        trend        = $trend
    }

    $forgeDir = Join-Path $RepoRoot ".forge"
    if (-not (Test-Path $forgeDir)) { New-Item -ItemType Directory -Path $forgeDir -Force | Out-Null }
    $record | ConvertTo-Json -Depth 5 -Compress | Add-Content -Path $historyFile

    Write-Host "Trend:          $trend" -ForegroundColor $(if ($trend -eq 'improving') { 'Green' } elseif ($trend -eq 'degrading') { 'Red' } else { 'White' })
    Write-Host "History:        $($history.Count + 1) record(s) in .forge/drift-history.json" -ForegroundColor White
    Write-Host ""

    if ($score -lt $threshold) {
        Write-Host "⚠  DRIFT ALERT — score $score is below threshold $threshold" -ForegroundColor Red
        exit 1
    } else {
        Write-Host "✅ Drift score within threshold ($score >= $threshold)" -ForegroundColor Green
        exit 0
    }
}

# ─── Command: smith ────────────────────────────────────────────────────
function Invoke-Smith {
    # Phase AUTO-UPDATE-01 Slice 2 — --refresh-version-cache flag
    if ($Arguments -contains '--refresh-version-cache') {
        $cleared = 0
        $vcFile = Join-Path $RepoRoot ".forge/version-check.json"
        $ucFile = Join-Path $RepoRoot ".forge/update-check.json"
        if (Test-Path $vcFile) { Remove-Item $vcFile -Force; $cleared++ }
        if (Test-Path $ucFile) { Remove-Item $ucFile -Force; $cleared++ }
        if ($cleared -gt 0) {
            Write-Host "  ✅ Version cache cleared ($cleared file(s) deleted) — next check will hit GitHub API." -ForegroundColor Green
        } else {
            Write-Host "  ℹ No cache to clear." -ForegroundColor DarkGray
        }
        return
    }

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

    # Detect whether this is the plan-forge dev repo itself (has presets/ and
    # pforge-mcp/server.mjs). Several checks below only make sense in the dev
    # repo — e.g. dashboard screenshots for the marketing site, CHANGELOG
    # entries for every framework version bump, and tempering coverage minima
    # seeded from plan-forge's own `.forge/tempering/` state. Downstream
    # consumer projects carry VERSION/.forge/ but shouldn't be graded on them.
    $isPlanForgeDevRepo = (Test-Path (Join-Path $RepoRoot "presets") -PathType Container) -and (Test-Path (Join-Path $RepoRoot "pforge-mcp/server.mjs") -PathType Leaf)

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

    # PowerShell version — prefer separately installed pwsh (7.x) over current shell.
    # If pforge.ps1 is invoked via Windows PowerShell 5.1 (powershell.exe) on a system
    # that also has pwsh installed, surface the pwsh version so the user sees the
    # modern runtime they should be using, not the legacy one this script happens to run in.
    $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
    $pwshVer = $null
    if ($pwshCmd) {
        try {
            $pwshVer = (& $pwshCmd.Source -NoProfile -NoLogo -Command '$PSVersionTable.PSVersion.ToString()' 2>$null).Trim()
        } catch { $pwshVer = $null }
    }

    $currentShellVer = $PSVersionTable.PSVersion.ToString()
    $currentShellMajor = $PSVersionTable.PSVersion.Major

    if ($pwshVer) {
        $pwshMajor = 0
        try { $pwshMajor = [int]($pwshVer -split '\.')[0] } catch { $pwshMajor = 0 }
        $shellNote = ""
        if ($currentShellMajor -lt 7) {
            $shellNote = " — running shell is $currentShellVer; pwsh is preferred"
        }
        if ($pwshMajor -ge 7) {
            Doctor-Pass "PowerShell $pwshVer (pwsh)$shellNote"
        } elseif ($pwshMajor -ge 5) {
            Doctor-Warn "PowerShell $pwshVer (pwsh, 7.x recommended)$shellNote" "Install latest from https://aka.ms/powershell"
        } else {
            Doctor-Fail "PowerShell $pwshVer (pwsh, 5.1+ required)" "Install from https://aka.ms/powershell"
        }
    } else {
        if ($currentShellMajor -ge 7) {
            Doctor-Pass "PowerShell $currentShellVer"
        } elseif ($currentShellMajor -ge 5) {
            Doctor-Warn "PowerShell $currentShellVer (7.x recommended — pwsh not detected on PATH)" "Install pwsh from https://aka.ms/powershell"
        } else {
            Doctor-Fail "PowerShell $currentShellVer (5.1+ required)" "Install from https://aka.ms/powershell"
        }
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
    # 1b. RUNTIME & WORKER READINESS (issue #28)
    # ═══════════════════════════════════════════════════════════════
    # Reads pforge-mcp/worker-capabilities.json (single source of truth) and
    # verifies each worker/runtime meets the minimum version AND exposes the
    # agentic capability flags. Without this, gh-copilot v1.2.x silently printed
    # help text and orchestrator recorded "passed" with zero code changes.
    Write-Host "Runtime & Worker Readiness:" -ForegroundColor Cyan

    $matrixPath = Join-Path $PSScriptRoot 'pforge-mcp/worker-capabilities.json'
    if (-not (Test-Path $matrixPath)) {
        Doctor-Warn "worker-capabilities.json not found — skipping capability probe" "Re-run setup to restore pforge-mcp/"
    }
    else {
        try {
            $matrix = Get-Content $matrixPath -Raw | ConvertFrom-Json
        }
        catch {
            Doctor-Fail "worker-capabilities.json is malformed: $($_.Exception.Message)" "git checkout pforge-mcp/worker-capabilities.json"
            $matrix = $null
        }

        if ($matrix) {
            $pforgeOs = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'windows' }
                        elseif ($IsMacOS) { 'macos' }
                        else { 'linux' }

            function Compare-SemVer([string]$a, [string]$b) {
                $pa = ($a -replace '^v', '').Split('.-+')[0..2] | ForEach-Object { [int]($_ -replace '\D','') }
                $pb = ($b -replace '^v', '').Split('.-+')[0..2] | ForEach-Object { [int]($_ -replace '\D','') }
                for ($i = 0; $i -lt 3; $i++) {
                    $av = if ($pa[$i]) { $pa[$i] } else { 0 }
                    $bv = if ($pb[$i]) { $pb[$i] } else { 0 }
                    if ($av -ne $bv) { return [Math]::Sign($av - $bv) }
                }
                return 0
            }

            function Probe-MatrixTool([string]$name, $spec, [bool]$isRuntime) {
                $cmdName = $spec.probe.command
                $cmd = Get-Command $cmdName -ErrorAction SilentlyContinue
                $installHint = if ($spec.install.$pforgeOs) { $spec.install.$pforgeOs } else { $spec.install.docs }

                if (-not $cmd) {
                    if ($isRuntime -and $spec.required) {
                        Doctor-Fail "$name not found on PATH (required runtime)" $installHint
                    } elseif ($isRuntime) {
                        Doctor-Warn "$name not found on PATH (optional)" $installHint
                    } else {
                        Doctor-Warn "$name not found on PATH (agent worker)" $installHint
                    }
                    return
                }

                # Version probe
                $versionArgs = @($spec.probe.versionArgs)
                $versionOut = try { & $cmdName @versionArgs 2>&1 | Out-String } catch { '' }
                $version = $null
                if ($spec.versionRegex -and $versionOut -match $spec.versionRegex) {
                    $version = $Matches[1]
                }

                # Min-version check
                if ($version -and $spec.minVersion -and (Compare-SemVer $version $spec.minVersion) -lt 0) {
                    Doctor-Fail "$name v$version is older than required v$($spec.minVersion)" $installHint
                    return
                }

                # Capability marker probe (workers only)
                if (-not $isRuntime -and $spec.probe.capabilityMarkers -and $spec.probe.capabilityMarkers.Count -gt 0) {
                    $helpArgs = @($spec.probe.helpArgs)
                    $helpOut = try { & $cmdName @helpArgs 2>&1 | Out-String } catch { '' }
                    $missing = @()
                    foreach ($marker in $spec.probe.capabilityMarkers) {
                        if ($helpOut -notmatch [regex]::Escape($marker)) { $missing += $marker }
                    }
                    if ($missing.Count -gt 0) {
                        Doctor-Fail "$name v$version lacks agentic flags: $($missing -join ', ') (issue #28)" $installHint
                        return
                    }
                }

                $verDisplay = if ($version) { "v$version" } else { "(version unknown)" }
                $suffix = if (-not $isRuntime) { " (agentic capable)" } else { "" }
                Doctor-Pass "$name $verDisplay$suffix"
            }

            foreach ($rt in $matrix.runtimes.PSObject.Properties) {
                Probe-MatrixTool -name $rt.Name -spec $rt.Value -isRuntime $true
            }
            foreach ($wk in $matrix.workers.PSObject.Properties) {
                Probe-MatrixTool -name $wk.Name -spec $wk.Value -isRuntime $false
            }
        }
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
        'swift'      = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'azure-iac'  = @{ instructions = 15; agents = 17; prompts = 9; skills = 8 }
        'custom'     = @{ instructions = 3;  agents = 5;  prompts = 7; skills = 0 }
    }

    # Handle multi-preset (e.g., "dotnet,azure-iac")
    $presetKey = $preset
    if ($preset -match ',') {
        $presetKey = ($preset -split ',')[0].Trim()
    }

    # Guard: ContainsKey($null) throws "Value cannot be null. (Parameter 'key')".
    # A .forge.json without a `preset` field (e.g., the plan-forge dev repo's
    # own minimal config) leaves $preset null.
    if ($presetKey -and $expectedCounts.ContainsKey($presetKey)) {
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

        # Pipeline prompts — presence check by name (the count alone can pass with
        # only scaffolding prompts present; pipeline prompts power the runbook).
        if (Test-Path $promptsDir) {
            $requiredPipeline = @(
                'step0-specify-feature.prompt.md',
                'step1-preflight-check.prompt.md',
                'step2-harden-plan.prompt.md',
                'step3-execute-slice.prompt.md',
                'step4-completeness-sweep.prompt.md',
                'step5-review-gate.prompt.md',
                'step6-ship.prompt.md',
                'project-profile.prompt.md'
            )
            $presentPipeline = Get-ChildItem -Path $promptsDir -Filter "*.prompt.md" -File | Select-Object -ExpandProperty Name
            $missingPipeline = $requiredPipeline | Where-Object { $_ -notin $presentPipeline }
            if ($missingPipeline.Count -eq 0) {
                Doctor-Pass "Pipeline prompts present (step0-step6 + project-profile)"
            } else {
                Doctor-Warn "Missing pipeline prompts: $($missingPipeline -join ', ')" "Run 'pforge update' to install missing pipeline prompts"
            }
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

    # v2.53.1 — corrupt-install detection. If local VERSION file ends in '-dev'
    # AND .forge.json templateVersion disagrees, flag as corrupt. This catches
    # clients stuck on broken v2.50.0/v2.51.0/v2.52.0 tarballs that shipped
    # VERSION='X.Y.Z-dev' inside the release.
    $localVersionFile = Join-Path $RepoRoot "VERSION"
    $localVersion = $null
    if (Test-Path $localVersionFile) {
        $localVersion = (Get-Content $localVersionFile -Raw).Trim()
    }
    if ($localVersion -and $localVersion -match '-dev\b') {
        $bareCore = ($localVersion -replace '^v', '') -split '-' | Select-Object -First 1
        Doctor-Warn "Local VERSION='$localVersion' ends in '-dev' — possible corrupt install from a broken release tarball (bare v$bareCore may have shipped with '-dev' baked in)" "Run 'pforge self-update --force' to heal"
    }

    $sourceVersion = $null
    $versionCheckCacheFile = Join-Path $RepoRoot ".forge/version-check.json"
    $cacheMaxAgeHours = 24

    # Try cache first (skip network call if < 24h old)
    $cacheValid = $false
    if (Test-Path $versionCheckCacheFile) {
        try {
            $cache = Get-Content $versionCheckCacheFile -Raw | ConvertFrom-Json
            $cacheAge = (Get-Date) - [datetime]$cache.checkedAt
            if ($cacheAge.TotalHours -lt $cacheMaxAgeHours -and $cache.latestVersion) {
                $sourceVersion = $cache.latestVersion
                $cacheValid = $true
            }
        }
        catch { }
    }

    # Fetch from GitHub API if cache is stale or missing
    if (-not $cacheValid) {
        try {
            $apiUrl = "https://api.github.com/repos/srnichols/plan-forge/releases/latest"
            $response = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'plan-forge-smith' } -TimeoutSec 5 -ErrorAction Stop
            $sourceVersion = $response.tag_name -replace '^v', ''
            # Persist cache
            $forgeDir = Join-Path $RepoRoot ".forge"
            if (-not (Test-Path $forgeDir)) { New-Item -ItemType Directory -Path $forgeDir | Out-Null }
            @{ checkedAt = (Get-Date -Format 'o'); latestVersion = $sourceVersion } |
                ConvertTo-Json | Set-Content $versionCheckCacheFile -Encoding UTF8
        }
        catch {
            # Fall back to local source repo if offline
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
        if ($cacheValid) {
            $cacheAge = (Get-Date) - [datetime](Get-Content $versionCheckCacheFile -Raw | ConvertFrom-Json).checkedAt
            Write-Host "     (cached $([math]::Round($cacheAge.TotalMinutes))m ago)" -ForegroundColor DarkGray
        }
    }
    else {
        Doctor-Pass "Installed v$templateVersion (GitHub unreachable and no local source — skipping currency check)"
    }

    Write-Host ""

    # ═══════════════════════════════════════════════════════════════
    # 4a. AUTO-UPDATE STATUS (Phase AUTO-UPDATE-01 Slice 2)
    # ═══════════════════════════════════════════════════════════════
    Write-Host "Auto-update:" -ForegroundColor Cyan

    $auEnabled = $false
    $forgeJsonPath = Join-Path $RepoRoot ".forge.json"
    if (Test-Path $forgeJsonPath) {
        try {
            $fj = Get-Content $forgeJsonPath -Raw | ConvertFrom-Json
            if ($fj.autoUpdate -and $fj.autoUpdate.enabled -eq $true) { $auEnabled = $true }
        } catch { }
    }

    $updateCacheFile = Join-Path $RepoRoot ".forge/update-check.json"
    $auCacheAge = $null
    $auLastTag = $null
    $auCheckedAt = $null
    if (Test-Path $updateCacheFile) {
        try {
            $auCache = Get-Content $updateCacheFile -Raw | ConvertFrom-Json
            $auCheckedAt = $auCache.checkedAt
            $auLastTag = $auCache.latestVersion
            if ($auCheckedAt) {
                $auCacheAge = [math]::Round(((Get-Date) - [datetime]$auCheckedAt).TotalMinutes)
            }
        } catch { }
    }

    $enabledLabel = if ($auEnabled) { "enabled" } else { "disabled (opt-in)" }
    $cacheLabel = if ($auCacheAge -ne $null) { "${auCacheAge}m" } else { "no cache" }
    $tagLabel = if ($auLastTag) { "v$auLastTag" } else { "unknown" }
    $tsLabel = if ($auCheckedAt) { $auCheckedAt } else { "never" }

    Doctor-Pass "Auto-update: $enabledLabel | Cache age: $cacheLabel | Last tag: $tagLabel | Last check: $tsLabel"
    Write-Host "     Tip: Run 'pforge self-update' to check + install, or 'pforge smith --refresh-version-cache' to clear cache" -ForegroundColor DarkGray

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

        # Check for API keys (env vars + .forge/secrets.json + .env file fallback)
        $hasXai = -not [string]::IsNullOrEmpty($env:XAI_API_KEY)
        $hasOpenAi = -not [string]::IsNullOrEmpty($env:OPENAI_API_KEY)

        # Fallback 1: .forge/secrets.json
        $secretsPath = Join-Path $RepoRoot ".forge/secrets.json"
        $secretsSrc = ""
        if (-not $hasXai -or -not $hasOpenAi) {
            if (Test-Path $secretsPath) {
                try {
                    $secrets = Get-Content $secretsPath -Raw | ConvertFrom-Json
                    if (-not $hasXai -and $secrets.XAI_API_KEY) { $hasXai = $true; $secretsSrc = " (from .forge/secrets.json)" }
                    if (-not $hasOpenAi -and $secrets.OPENAI_API_KEY) { $hasOpenAi = $true; $secretsSrc = " (from .forge/secrets.json)" }
                } catch { }
            }
        }

        # Fallback 2: .env file at repo root (KEY=value lines, # comments allowed)
        $envFilePath = Join-Path $RepoRoot ".env"
        if ((-not $hasXai -or -not $hasOpenAi) -and (Test-Path $envFilePath)) {
            try {
                Get-Content $envFilePath | ForEach-Object {
                    $line = $_.Trim()
                    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
                        $eq = $line.IndexOf('=')
                        $k = $line.Substring(0, $eq).Trim()
                        $v = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
                        if (-not $hasXai -and $k -eq 'XAI_API_KEY' -and $v) { $script:_xaiFromEnv = $v; $hasXai = $true; $secretsSrc = " (from .env)" }
                        if (-not $hasOpenAi -and $k -eq 'OPENAI_API_KEY' -and $v) { $script:_openAiFromEnv = $v; $hasOpenAi = $true; $secretsSrc = " (from .env)" }
                    }
                }
            } catch { }
        }

        if ($hasXai -and $hasOpenAi) {
            Doctor-Pass "XAI_API_KEY set (Grok Aurora)$secretsSrc"
            Doctor-Pass "OPENAI_API_KEY set (DALL-E)$secretsSrc"
        } elseif ($hasXai) {
            Doctor-Pass "XAI_API_KEY set (Grok Aurora)$secretsSrc"
            Doctor-Pass "OPENAI_API_KEY not set (DALL-E unavailable — optional)"
        } elseif ($hasOpenAi) {
            Doctor-Pass "OPENAI_API_KEY set (DALL-E)$secretsSrc"
            Doctor-Pass "XAI_API_KEY not set (Grok Aurora unavailable — optional)"
        } else {
            Doctor-Warn "No image API keys configured" "Set XAI_API_KEY or OPENAI_API_KEY env var, or add to .forge/secrets.json"
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

        # Dashboard screenshots for docs — only inside the plan-forge dev repo.
        # Downstream consumers don't need to populate docs/assets/dashboard/.
        if ($isPlanForgeDevRepo) {
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
        }

        # Site images — only relevant inside the plan-forge dev repo itself.
        # These are plan-forge's marketing assets (og-card, hero, etc.); downstream projects
        # never need them. Detect dev-repo by presence of presets/ + pforge-mcp/server.mjs.
        $siteAssetsDir = Join-Path $RepoRoot "docs/assets"
        if ($isPlanForgeDevRepo -and (Test-Path $siteAssetsDir)) {
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
    # Hooks can come from THREE sources:
    #   1. Filesystem: .github/hooks/<HookName>.{ps1,sh,mjs,js,md}
    #   2. Config: .forge.json -> hooks.{preDeploy,postSlice,preAgentHandoff,...} (camelCase)
    #   3. Config: .github/hooks/plan-forge.json -> hooks.{SessionStart,PreToolUse,...} (PascalCase)
    # Smith reconciles all three — a hook is "present" if ANY source defines it.
    $hooksDir = Join-Path $RepoRoot ".github/hooks"
    $hasHookFiles = Test-Path $hooksDir
    $hookConfig = $null
    if (Test-Path $configPath) {
        try {
            $cfgForHooks = Get-Content $configPath -Raw | ConvertFrom-Json
            if ($cfgForHooks.hooks) { $hookConfig = $cfgForHooks.hooks }
        } catch { }
    }

    # Source 3: .github/hooks/plan-forge.json (shipped by `pforge update` from templates/)
    $hooksJsonConfig = $null
    $hooksJsonPath = Join-Path $hooksDir "plan-forge.json"
    if (Test-Path $hooksJsonPath) {
        try {
            $hooksJsonRaw = Get-Content $hooksJsonPath -Raw | ConvertFrom-Json
            if ($hooksJsonRaw.hooks) { $hooksJsonConfig = $hooksJsonRaw.hooks }
        } catch { }
    }

    if ($hasHookFiles -or $hookConfig -or $hooksJsonConfig) {
        Write-Host "Lifecycle Hooks:" -ForegroundColor Cyan
        $coreHooks = @("SessionStart", "PreToolUse", "PostToolUse", "Stop")
        $liveGuardHooks = @("PostSlice", "PreAgentHandoff", "PreDeploy")
        $allExpectedHooks = $coreHooks + $liveGuardHooks

        # camelCase mapping for .forge.json config keys
        $configKeyMap = @{
            "SessionStart"     = "sessionStart"
            "PreToolUse"       = "preToolUse"
            "PostToolUse"      = "postToolUse"
            "Stop"             = "stop"
            "PostSlice"        = "postSlice"
            "PreAgentHandoff"  = "preAgentHandoff"
            "PreDeploy"        = "preDeploy"
        }

        $hookFiles = @()
        if ($hasHookFiles) {
            $hookFiles = Get-ChildItem -Path $hooksDir -File -Recurse | ForEach-Object { $_.BaseName }
        }

        $hookCount = 0
        $hookSources = @{}
        foreach ($hook in $allExpectedHooks) {
            $foundInFiles = ($hookFiles | Where-Object { $_ -match $hook }) -ne $null -and ($hookFiles | Where-Object { $_ -match $hook }).Count -gt 0
            $foundInConfig = $false
            if ($hookConfig) {
                $cfgKey = $configKeyMap[$hook]
                if ($cfgKey) {
                    $cfgVal = $hookConfig.$cfgKey
                    # Treat as "configured" if the property exists and is non-null/non-false
                    if ($null -ne $cfgVal -and $cfgVal -ne $false) { $foundInConfig = $true }
                }
            }
            $foundInHooksJson = $false
            if ($hooksJsonConfig) {
                # plan-forge.json uses PascalCase keys matching the hook name directly
                $hjVal = $hooksJsonConfig.$hook
                if ($null -ne $hjVal -and $hjVal -ne $false) { $foundInHooksJson = $true }
            }
            if ($foundInFiles -or $foundInConfig -or $foundInHooksJson) {
                $hookCount++
                $src = @()
                if ($foundInFiles)     { $src += "file" }
                if ($foundInConfig)    { $src += ".forge.json" }
                if ($foundInHooksJson) { $src += "hooks/plan-forge.json" }
                $hookSources[$hook] = ($src -join "+")
            }
        }

        if ($hookCount -eq $allExpectedHooks.Count) {
            Doctor-Pass "$hookCount/$($allExpectedHooks.Count) lifecycle hooks present (core + LiveGuard)"
        } elseif ($hookCount -gt 0) {
            $hookMissing = $allExpectedHooks | Where-Object { -not $hookSources.ContainsKey($_) }
            Doctor-Pass "$hookCount/$($allExpectedHooks.Count) hooks present"
            if ($hookMissing.Count -gt 0) {
                Doctor-Warn "Missing hooks: $($hookMissing -join ', ')" "Run 'pforge update' to install missing hook files, or add entries under 'hooks' in .forge.json"
            }
        } else {
            Doctor-Warn "No lifecycle hooks found" "Run 'pforge update' to install hooks, or define them under 'hooks' in .forge.json"
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
        } elseif ($isPlanForgeDevRepo) {
            # Framework repo: VERSION == release cadence, so every bump needs a CHANGELOG line.
            Doctor-Warn "CHANGELOG.md missing entry for v$currentVer" "Add a '## [$currentVer] — <date>' section with release notes"
        } else {
            # Downstream consumer: VERSION tracks the pforge framework, not the app's own version.
            # Don't grade consumer CHANGELOGs by framework version — just note the framework version.
            Doctor-Pass "CHANGELOG.md present (framework v$currentVer — downstream CHANGELOG tracks your app, not pforge)"
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
    # 7. FORGE + LIVEGUARD INTELLIGENCE
    # ═══════════════════════════════════════════════════════════════
    $forgeDir = Join-Path $RepoRoot ".forge"
    if (Test-Path $forgeDir) {
        Write-Host ""
        Write-Host "Intelligence:" -ForegroundColor Cyan

        # Forge Intelligence: model performance → escalation tuning
        $perfFile = Join-Path $forgeDir "model-performance.json"
        if (Test-Path $perfFile) {
            try {
                $perf = Get-Content $perfFile -Raw | ConvertFrom-Json
                $perfCount = if ($perf -is [System.Array]) { $perf.Count } else { 0 }
                if ($perfCount -ge 5) {
                    Doctor-Pass "Model performance: $perfCount records — escalation chain auto-tuning active"
                } elseif ($perfCount -gt 0) {
                    Doctor-Pass "Model performance: $perfCount record(s) — need 5+ for auto-tuning"
                }
            } catch { Doctor-Pass "Model performance file present" }
        }

        # Cost calibration
        $costFile = Join-Path $forgeDir "cost-history.json"
        if (Test-Path $costFile) {
            Doctor-Pass "Cost history present — estimate calibration active"
        }

        # Quorum history → adaptive threshold
        $quorumFile = Join-Path $forgeDir "quorum-history.jsonl"
        if (-not (Test-Path $quorumFile)) { $quorumFile = Join-Path $forgeDir "quorum-history.json" } # G2.1 legacy
        if (Test-Path $quorumFile) {
            Doctor-Pass "Quorum history present — adaptive threshold active"
        }

        # LiveGuard Intelligence
        $regHistory = Join-Path $forgeDir "regression-history.jsonl"
        if (-not (Test-Path $regHistory)) { $regHistory = Join-Path $forgeDir "regression-history.json" } # G2.1 legacy
        if (Test-Path $regHistory) {
            Doctor-Pass "Regression history present — test trend tracking active"
        }

        $healthDna = Join-Path $forgeDir "health-dna.jsonl"
        if (-not (Test-Path $healthDna)) { $healthDna = Join-Path $forgeDir "health-dna.json" } # G2.1 legacy
        if (Test-Path $healthDna) {
            Doctor-Pass "Health DNA present — decay detection active"
        }

        $lgMemories = Join-Path $forgeDir "liveguard-memories.jsonl"
        if (Test-Path $lgMemories) {
            $memCount = (Get-Content $lgMemories | Measure-Object).Count
            Doctor-Pass "LiveGuard memories: $memCount captured finding(s)"
        }

        $obQueue = Join-Path $forgeDir "openbrain-queue.jsonl"
        if (Test-Path $obQueue) {
            $queueCount = (Get-Content $obQueue | Measure-Object).Count
            Doctor-Pass "OpenBrain queue: $queueCount thought(s) pending ingestion"
        }

        # Tool count check
        $toolsJson = Join-Path $RepoRoot "pforge-mcp/tools.json"
        if (Test-Path $toolsJson) {
            try {
                $tools = Get-Content $toolsJson -Raw | ConvertFrom-Json
                $toolCount = if ($tools -is [System.Array]) { $tools.Count } else { 0 }
                $lgTools = $tools | Where-Object { $_.name -match 'drift|incident|dep_watch|regression|runbook|hotspot|health_trend|alert_triage|deploy_journal|secret_scan|env_diff|fix_proposal|quorum_analyze|liveguard_run' }
                $lgCount = if ($lgTools) { @($lgTools).Count } else { 0 }
                Doctor-Pass "$toolCount MCP tools ($lgCount LiveGuard) in tools.json"
            } catch { }
        }
    }

    # ═══════════════════════════════════════════════════════════════
    # 8. CRUCIBLE (v2.37 / Phase CRUCIBLE-02 Slice 02.2)
    # ═══════════════════════════════════════════════════════════════
    # The Crucible funnel (forge_crucible_submit → ask → preview → finalize)
    # persists every smelt under .forge/crucible/ and every manual-import
    # bypass into .forge/crucible/manual-imports.jsonl. Surfacing the counts
    # here gives the forge operator a one-glance answer to "is the Crucible
    # gate healthy?" without having to open the dashboard.
    $crucibleDir = Join-Path $RepoRoot ".forge/crucible"
    Write-Host ""
    Write-Host "Crucible:" -ForegroundColor Cyan

    if (Test-Path $crucibleDir) {
        $smeltFiles = @(Get-ChildItem -Path $crucibleDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notin @("config.json", "phase-claims.json") })

        if ($smeltFiles.Count -eq 0) {
            Doctor-Pass "No smelts yet — run 'forge_crucible_submit' to start the funnel"
        } else {
            $counts = @{ in_progress = 0; finalized = 0; abandoned = 0; other = 0 }
            foreach ($f in $smeltFiles) {
                try {
                    $smelt = Get-Content $f.FullName -Raw | ConvertFrom-Json
                    $st = if ($smelt.status) { "$($smelt.status)" } else { "other" }
                    if ($counts.ContainsKey($st)) { $counts[$st]++ } else { $counts.other++ }
                } catch { $counts.other++ }
            }
            Doctor-Pass "$($smeltFiles.Count) smelt(s): $($counts.finalized) finalized, $($counts.in_progress) in-progress, $($counts.abandoned) abandoned"

            # Stalled in-progress smelts ≥ 7 days old are worth surfacing — likely
            # abandoned but never explicitly closed, which clutters the dashboard.
            $staleCutoff = (Get-Date).AddDays(-7)
            $stale = @($smeltFiles | Where-Object { $_.LastWriteTime -lt $staleCutoff } |
                ForEach-Object {
                    try {
                        $s = Get-Content $_.FullName -Raw | ConvertFrom-Json
                        if ($s.status -eq "in_progress") { $_ }
                    } catch { }
                })
            if ($stale.Count -gt 0) {
                Doctor-Warn "$($stale.Count) in-progress smelt(s) idle for 7+ days" "Abandon them with 'forge_crucible_abandon' or resume via the dashboard"
            }
        }

        # Config file — Slice 01.5
        $cfgFile = Join-Path $crucibleDir "config.json"
        if (Test-Path $cfgFile) {
            Doctor-Pass "Crucible config present — governance overrides active"
        }

        # Manual-import audit trail — Slice 01.4
        $manualLog = Join-Path $crucibleDir "manual-imports.jsonl"
        if (Test-Path $manualLog) {
            $mImports = @(Get-Content $manualLog -ErrorAction SilentlyContinue)
            if ($mImports.Count -gt 0) {
                Doctor-Pass "$($mImports.Count) manual-import bypass(es) recorded"
            }
        }

        # Phase claims — atomic phase-number allocation
        $phaseClaims = Join-Path $crucibleDir "phase-claims.json"
        if (Test-Path $phaseClaims) {
            try {
                $claims = Get-Content $phaseClaims -Raw | ConvertFrom-Json
                $claimCount = if ($claims.claims) { @($claims.claims).Count } else { 0 }
                Doctor-Pass "$claimCount phase number(s) claimed atomically"
            } catch { }
        }
    } else {
        Doctor-Pass "Crucible inactive — no .forge/crucible/ directory yet"
    }

    # ═══════════════════════════════════════════════════════════════
    # 9. TEMPERING (Phase TEMPER-01 Slice 01.2)
    # ═══════════════════════════════════════════════════════════════
    # The Tempering subsystem (forge_tempering_scan → forge_tempering_status)
    # parses existing coverage reports and flags layers below configured
    # minima. Surfacing freshness + gap counts here gives the forge operator
    # a one-glance answer to "is my test coverage honest?" without having
    # to open the dashboard.
    $temperingDir = Join-Path $RepoRoot ".forge/tempering"
    Write-Host ""
    Write-Host "Tempering:" -ForegroundColor Cyan

    if (Test-Path $temperingDir) {
        $scanFiles = @(Get-ChildItem -Path $temperingDir -Filter "scan-*.json" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)

        if ($scanFiles.Count -eq 0) {
            Doctor-Pass "No Tempering scans yet — run 'forge_tempering_scan' to establish a baseline"
        } else {
            $latest = $scanFiles[0]
            try {
                $scan = Get-Content $latest.FullName -Raw | ConvertFrom-Json
                $status = if ($scan.status) { "$($scan.status)" } else { "unknown" }
                $ageDays = [Math]::Floor(((Get-Date) - $latest.LastWriteTime).TotalDays)
                $gapCount = if ($scan.coverageVsMinima) { @($scan.coverageVsMinima).Count } else { 0 }
                Doctor-Pass "$($scanFiles.Count) scan(s); latest: $status, $gapCount gap(s), $ageDays day(s) old"

                # Stale-scan warning mirrors the watcher anomaly rule
                # `tempering-scan-stale` (7-day cutoff).
                if ($ageDays -ge 7) {
                    Doctor-Warn "Latest scan is $ageDays days old" "Re-run 'forge_tempering_scan' — coverage drifts fast"
                }

                # Below-minimum warning mirrors the `tempering-coverage-below-minimum`
                # watcher rule (≥ 5-point gap). Only surface inside the plan-forge
                # dev repo — downstream projects may have `.forge/tempering/`
                # state seeded from pforge but unrelated to their own coverage.
                if ($scan.coverageVsMinima -and $isPlanForgeDevRepo) {
                    $belowMin = @($scan.coverageVsMinima | Where-Object { $_.gap -ge 5 })
                    if ($belowMin.Count -gt 0) {
                        Doctor-Warn "$($belowMin.Count) coverage layer(s) below minimum by ≥ 5 points" "Run 'forge_tempering_status' to inspect the gap report"
                    }
                }
            } catch {
                Doctor-Warn "Latest scan record could not be parsed" "File: $($latest.Name)"
            }
        }

        # Config file — seeded on first scan, never overwritten.
        $tempCfg = Join-Path $temperingDir "config.json"
        if (Test-Path $tempCfg) {
            Doctor-Pass "Tempering config present — enterprise minima active"
        }

        # TEMPER-02 Slice 02.2 — run record summary. Each
        # `run-*.json` is produced by forge_tempering_run (post-slice hook
        # or manual). We report the latest verdict so operators spot a
        # failing slice without digging into the dashboard.
        $runFiles = @(Get-ChildItem -Path $temperingDir -Filter "run-*.json" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)
        if ($runFiles.Count -gt 0) {
            $latestRun = $runFiles[0]
            try {
                $run = Get-Content $latestRun.FullName -Raw | ConvertFrom-Json
                $verdict = if ($run.verdict) { "$($run.verdict)" } else { "unknown" }
                $runAgeMin = [Math]::Floor(((Get-Date) - $latestRun.LastWriteTime).TotalMinutes)
                $scannerCount = if ($run.scanners) { @($run.scanners).Count } else { 0 }
                $totalPass = 0; $totalFail = 0
                if ($run.scanners) {
                    foreach ($sc in $run.scanners) {
                        if ($sc.pass) { $totalPass += $sc.pass }
                        if ($sc.fail) { $totalFail += $sc.fail }
                    }
                }
                Doctor-Pass "$($runFiles.Count) run(s); latest: $verdict, $totalPass pass / $totalFail fail across $scannerCount scanner(s), $runAgeMin min old"
                if (($verdict -eq "fail" -or $verdict -eq "error" -or $verdict -eq "budget-exceeded") -and $isPlanForgeDevRepo) {
                    Doctor-Warn "Latest Tempering run verdict=$verdict" "Open $($latestRun.Name) for per-scanner detail"
                }
            } catch {
                Doctor-Warn "Latest run record could not be parsed" "File: $($latestRun.Name)"
            }
        }
    } else {
        Doctor-Pass "Tempering inactive — no .forge/tempering/ directory yet"
    }

    # ═══════════════════════════════════════════════════════════════
    # BUG REGISTRY (Phase BUG-01+)
    # ═══════════════════════════════════════════════════════════════
    Write-Host ""
    Write-Host "Bug Registry:" -ForegroundColor Cyan

    $bugsDir = Join-Path $RepoRoot ".forge/bugs"
    if (Test-Path $bugsDir) {
        $bugFiles = @(Get-ChildItem -Path $bugsDir -Filter "*.json" -File -ErrorAction SilentlyContinue)
        if ($bugFiles.Count -eq 0) {
            Doctor-Pass "Bug registry empty — no open bugs tracked"
        } else {
            $open = 0; $resolved = 0; $critical = 0; $high = 0
            foreach ($bf in $bugFiles) {
                try {
                    $bug = Get-Content $bf.FullName -Raw | ConvertFrom-Json
                    $status = if ($bug.status) { "$($bug.status)".ToLower() } else { "open" }
                    if ($status -eq "resolved" -or $status -eq "closed" -or $status -eq "fixed") { $resolved++ } else { $open++ }
                    $sev = if ($bug.severity) { "$($bug.severity)".ToLower() } else { "" }
                    if ($sev -eq "critical") { $critical++ }
                    elseif ($sev -eq "high") { $high++ }
                } catch { }
            }
            Doctor-Pass "$($bugFiles.Count) total; $open open, $resolved resolved ($critical critical, $high high)"
            if ($critical -gt 0) {
                Doctor-Warn "$critical critical bug(s) open" "Run 'forge_bug_list --severity=critical' via MCP to triage"
            }
        }
    } else {
        Doctor-Pass "Bug registry inactive — no .forge/bugs/ directory yet"
    }

    # ═══════════════════════════════════════════════════════════════
    # NOTIFICATIONS (Phase NOTIFY-01+)
    # ═══════════════════════════════════════════════════════════════
    Write-Host ""
    Write-Host "Notifications:" -ForegroundColor Cyan

    $forgeCfg = Join-Path $RepoRoot ".forge.json"
    if (Test-Path $forgeCfg) {
        try {
            $cfg = Get-Content $forgeCfg -Raw | ConvertFrom-Json
            if ($cfg.notifications) {
                $adapterNames = @()
                foreach ($prop in $cfg.notifications.PSObject.Properties) {
                    if ($prop.Name -ne 'enabled' -and $prop.Value) {
                        $adapterNames += $prop.Name
                    }
                }
                if ($adapterNames.Count -gt 0) {
                    Doctor-Pass "Configured: $($adapterNames -join ', ')"
                } else {
                    Doctor-Pass "notifications block present — no adapters configured"
                }
            } else {
                Doctor-Pass "No notifications block — adapters inactive (optional)"
            }
        } catch {
            Doctor-Warn ".forge.json invalid JSON — notifications check skipped" "Validate the file with a JSON parser"
        }
    } else {
        Doctor-Pass "No .forge.json — notifications inactive (optional)"
    }

    # ═══════════════════════════════════════════════════════════════
    # L2 TIMELINE / SEARCH SOURCES (Phase SEARCH-01+)
    # ═══════════════════════════════════════════════════════════════
    # The unified timeline+search surface indexes events from these L2
    # stores. Missing directories don't fail the smith — they just mean
    # that source contributes no events yet.
    Write-Host ""
    Write-Host "Timeline / Search sources:" -ForegroundColor Cyan

    $l2Sources = @(
        @{ Path = ".forge/runs";         Label = "runs" },
        @{ Path = ".forge/memory";       Label = "memories" },
        @{ Path = ".forge/crucible";     Label = "crucible" },
        @{ Path = ".forge/tempering";    Label = "tempering" },
        @{ Path = ".forge/bugs";         Label = "bugs" },
        @{ Path = ".forge/incidents";    Label = "incidents" }
    )
    $activeCount = 0
    foreach ($src in $l2Sources) {
        $p = Join-Path $RepoRoot $src.Path
        if (Test-Path $p) {
            $n = @(Get-ChildItem -Path $p -File -Recurse -ErrorAction SilentlyContinue).Count
            if ($n -gt 0) { $activeCount++ }
        }
    }
    Doctor-Pass "$activeCount of $($l2Sources.Count) L2 source(s) with indexable events"

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
        Write-Host "Usage: pforge run-plan <plan-file> [--estimate] [--assisted] [--model <name>] [--resume-from <N>] [--dry-run] [--foreground] [--no-quorum] [--quorum] [--quorum=auto] [--quorum-threshold <N>] [--manual-import [--manual-import-source <human|speckit|grandfather>] [--manual-import-reason <text>]]" -ForegroundColor Yellow
        exit 1
    }

    $planPath = $Arguments[0]
    $fullPlanPath = Join-Path $RepoRoot $planPath
    if (-not (Test-Path $fullPlanPath)) {
        Write-Host "ERROR: Plan file not found: $planPath" -ForegroundColor Red
        exit 1
    }

    # Parse flags
    $estimate    = $Arguments -contains '--estimate'
    $assisted    = $Arguments -contains '--assisted'
    $dryRun      = $Arguments -contains '--dry-run'
    $foreground  = $Arguments -contains '--foreground'
    $noQuorum    = $Arguments -contains '--no-quorum'
    $manualImport = $Arguments -contains '--manual-import'
    $model       = $null
    $resumeFrom  = $null
    $quorumArg   = $null
    $quorumThreshold = $null
    $manualImportSource = $null
    $manualImportReason = $null

    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -eq '--model' -and ($i + 1) -lt $Arguments.Count) {
            $model = $Arguments[$i + 1]
        }
        if ($Arguments[$i] -eq '--resume-from' -and ($i + 1) -lt $Arguments.Count) {
            $resumeFrom = $Arguments[$i + 1]
        }
        if ($Arguments[$i] -like '--quorum*') {
            $quorumArg = $Arguments[$i]
        }
        if ($Arguments[$i] -eq '--quorum-threshold' -and ($i + 1) -lt $Arguments.Count) {
            $quorumThreshold = $Arguments[$i + 1]
        }
        if ($Arguments[$i] -eq '--manual-import-source' -and ($i + 1) -lt $Arguments.Count) {
            $manualImportSource = $Arguments[$i + 1]
        }
        if ($Arguments[$i] -eq '--manual-import-reason' -and ($i + 1) -lt $Arguments.Count) {
            $manualImportReason = $Arguments[$i + 1]
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
    if ($estimate)        { $nodeArgs += '--estimate' }
    if ($dryRun)          { $nodeArgs += '--dry-run' }
    if ($model)           { $nodeArgs += '--model'; $nodeArgs += $model }
    if ($resumeFrom)      { $nodeArgs += '--resume-from'; $nodeArgs += $resumeFrom }
    if ($noQuorum)        { $nodeArgs += '--no-quorum' }
    elseif ($quorumArg)   { $nodeArgs += $quorumArg }
    if ($quorumThreshold) { $nodeArgs += '--quorum-threshold'; $nodeArgs += $quorumThreshold }
    if ($manualImport)    { $nodeArgs += '--manual-import' }
    if ($manualImportSource) { $nodeArgs += '--manual-import-source'; $nodeArgs += $manualImportSource }
    if ($manualImportReason) { $nodeArgs += '--manual-import-reason'; $nodeArgs += $manualImportReason }

    # Delegate to orchestrator
    Write-Host ""
    if ($estimate) {
        Write-Host "Estimating cost for: $planPath" -ForegroundColor Cyan
        Write-Host ""
        & node @nodeArgs
    } elseif ($dryRun) {
        Write-Host "Dry run for: $planPath" -ForegroundColor Cyan
        Write-Host ""
        & node @nodeArgs
    } elseif ($foreground) {
        # Blocking mode — useful for debugging or CI pipelines
        if ($assisted) {
            Write-Host "Starting assisted execution (foreground): $planPath" -ForegroundColor Cyan
            Write-Host "You code in VS Code, orchestrator validates gates." -ForegroundColor DarkGray
        } else {
            Write-Host "Starting full auto execution (foreground): $planPath" -ForegroundColor Cyan
        }
        Write-Host ""
        & node @nodeArgs
    } else {
        # Background mode — default for interactive use
        if ($assisted) {
            Write-Host "Starting assisted execution (background): $planPath" -ForegroundColor Cyan
            Write-Host "You code in VS Code, orchestrator validates gates." -ForegroundColor DarkGray
        } else {
            Write-Host "Starting full auto execution (background): $planPath" -ForegroundColor Cyan
        }
        Write-Host ""
        $proc = Start-Process -FilePath 'node' -ArgumentList $nodeArgs -PassThru -NoNewWindow
        Write-Host "Orchestrator running in background  PID: $($proc.Id)" -ForegroundColor Green
        Write-Host "Monitor : pforge plan-status" -ForegroundColor DarkGray
        Write-Host "Logs    : .forge/runs/ (latest sub-directory)" -ForegroundColor DarkGray
        Write-Host "Stop    : Stop-Process -Id $($proc.Id)" -ForegroundColor DarkGray
    }
}

# ─── Command: version-bump (Fix 3 + Fix 10) ───────────────────────────
function Invoke-VersionBump {
    if ($Arguments.Count -lt 1) {
        Write-Host "ERROR: Version required." -ForegroundColor Red
        Write-Host "  Usage: pforge version-bump <version>" -ForegroundColor Yellow
        Write-Host "  Example: pforge version-bump 2.14.0" -ForegroundColor Yellow
        exit 1
    }

    $newVersion = $Arguments[0]
    Write-Host ""
    Write-Host "Version Bump: → v$newVersion" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────" -ForegroundColor DarkGray

    $targets = @(
        @{ File = "VERSION"; Pattern = '.*'; Replace = $newVersion; Desc = "VERSION file" },
        @{ File = "pforge-mcp/package.json"; Pattern = '"version":\s*"[^"]+"'; Replace = "`"version`": `"$newVersion`""; Desc = "MCP package.json" }
    )

    # HTML files with version badges
    $htmlVersionPatterns = @(
        @{ File = "docs/index.html"; Pattern = 'Dogfooded · v[\d.]+'; Replace = "Dogfooded · v$newVersion"; Desc = "index.html hero badge" },
        @{ File = "docs/index.html"; Pattern = '>v[\d.]+</div>'; Replace = ">v$($newVersion -replace '\.\d+$', '')</div>"; Desc = "index.html stats card" }
    )
    $targets += $htmlVersionPatterns

    # README track record
    $targets += @{ File = "README.md"; Pattern = 'v1\.0 → v[\d.]+'; Replace = "v1.0 → v$($newVersion -replace '\.\d+$', '')"; Desc = "README track record" }

    # ROADMAP current release
    $targets += @{ File = "ROADMAP.md"; Pattern = '\*\*v[\d.]+\*\* \(\d{4}-\d{2}-\d{2}\)'; Replace = "**v$newVersion** ($(Get-Date -Format 'yyyy-MM-dd'))"; Desc = "ROADMAP current release" }

    $updated = 0
    foreach ($t in $targets) {
        $filePath = Join-Path $RepoRoot $t.File
        if (Test-Path $filePath) {
            $content = Get-Content $filePath -Raw
            if ($content -match $t.Pattern) {
                $content = $content -replace $t.Pattern, $t.Replace
                Set-Content $filePath $content -NoNewline
                Write-Host "  ✅ $($t.Desc)" -ForegroundColor Green
                $updated++
            } else {
                Write-Host "  ⚠️  $($t.Desc) — pattern not found" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ⚠️  $($t.File) not found" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Updated $updated files to v$newVersion" -ForegroundColor Green
    Write-Host "Don't forget: Update CHANGELOG.md manually with release notes." -ForegroundColor DarkGray
}

# ─── Command: org-rules ────────────────────────────────────────────────
function Invoke-OrgRules {
    # Parse sub-command and flags
    $subCmd   = if ($Arguments.Count -gt 0) { $Arguments[0] } else { 'export' }
    $format   = 'github'
    $outFile  = $null

    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -eq '--format' -and ($i + 1) -lt $Arguments.Count) {
            $format = $Arguments[$i + 1]; $i++
        } elseif ($Arguments[$i] -like '--format=*') {
            $format = $Arguments[$i].Substring(9)
        } elseif ($Arguments[$i] -eq '--output' -and ($i + 1) -lt $Arguments.Count) {
            $outFile = $Arguments[$i + 1]; $i++
        } elseif ($Arguments[$i] -like '--output=*') {
            $outFile = $Arguments[$i].Substring(9)
        }
    }

    if ($subCmd -ne 'export') {
        Write-Host "ERROR: Unknown org-rules sub-command '$subCmd'. Use: export" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       Plan Forge — Org Rules Export                          ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # Try the MCP server REST API first (port 3100)
    $serverUrl = "http://localhost:3100/api/tool/org-rules"
    $body = @{ format = $format } | ConvertTo-Json
    if ($outFile) { $body = @{ format = $format; output = $outFile } | ConvertTo-Json }

    try {
        $response = Invoke-RestMethod -Uri $serverUrl -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 5
        if ($outFile) {
            Write-Host "  ✅ Org rules exported to: $outFile" -ForegroundColor Green
        } else {
            Write-Host $response
        }
        return
    } catch {
        # Server not running — fall back to inline Node.js
    }

    # Fallback: run inline node script
    $nodeScript = @'
const fs=require('fs'),path=require('path'),cwd=process.cwd();
const fmt=process.env.ORG_RULES_FORMAT||'github';
const outFile=process.env.ORG_RULES_OUTPUT||'';
const instrDir=path.join(cwd,'.github','instructions');
const instrFiles=fs.existsSync(instrDir)?fs.readdirSync(instrDir).filter(f=>f.endsWith('.instructions.md')).sort().map(f=>path.join(instrDir,f)):[];
const versionFile=path.join(cwd,'VERSION');
const version=fs.existsSync(versionFile)?fs.readFileSync(versionFile,'utf8').trim():'unknown';
function stripFrontmatter(raw){return raw.replace(/^---[\s\S]*?---\s*/m,'').trim();}
const parts=[];
instrFiles.forEach(f=>{const body=stripFrontmatter(fs.readFileSync(f,'utf8'));if(body)parts.push(body);});
const ci=path.join(cwd,'.github','copilot-instructions.md');
if(fs.existsSync(ci))parts.push(stripFrontmatter(fs.readFileSync(ci,'utf8')));
const pp=path.join(cwd,'PROJECT-PRINCIPLES.md');
if(fs.existsSync(pp))parts.push(fs.readFileSync(pp,'utf8').trim());
const out=parts.join('\n\n---\n\n');
if(outFile){fs.writeFileSync(outFile,out,'utf8');console.log('Exported to: '+outFile);}
else{process.stdout.write(out+'\n');}
'@

    $env:ORG_RULES_FORMAT = $format
    $env:ORG_RULES_OUTPUT  = if ($outFile) { $outFile } else { '' }

    node -e $nodeScript

    Remove-Item Env:ORG_RULES_FORMAT -ErrorAction SilentlyContinue
    Remove-Item Env:ORG_RULES_OUTPUT  -ErrorAction SilentlyContinue
}

# ─── Command: incident ─────────────────────────────────────────────────
function Invoke-Incident {
    $description = if ($Arguments.Count -gt 0) { $Arguments[0] } else { $null }
    if (-not $description) {
        Write-Host "ERROR: description is required. Usage: pforge incident `"<description>`" [--severity S] [--files f1,f2] [--resolved-at ISO]" -ForegroundColor Red
        exit 1
    }

    $severity   = "medium"
    $files      = @()
    $resolvedAt = $null

    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--severity' {
                if (($i + 1) -lt $Arguments.Count) { $severity = $Arguments[$i + 1]; $i++ }
            }
            '--files' {
                if (($i + 1) -lt $Arguments.Count) { $files = $Arguments[$i + 1] -split ','; $i++ }
            }
            '--resolved-at' {
                if (($i + 1) -lt $Arguments.Count) { $resolvedAt = $Arguments[$i + 1]; $i++ }
            }
        }
    }

    Write-ManualSteps "incident" @(
        "Build incident payload (description, severity, files, resolvedAt)"
        "POST to /api/incident on the MCP server"
        "Append record to .forge/incidents.jsonl"
        "Dispatch bridge notification if onCall configured in .forge.json"
    )

    $port = 3100
    $payload = @{ description = $description; severity = $severity; files = $files }
    if ($resolvedAt) { $payload.resolvedAt = $resolvedAt }
    $body = $payload | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/incident" -Method POST `
            -ContentType "application/json" -Body $body -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F6A8} Incident Captured" -ForegroundColor Red
        Write-Host "   ID:          $($response.id)" -ForegroundColor White
        Write-Host "   Description: $($response.description)" -ForegroundColor White
        $severityColor = switch ($response.severity) { 'critical' { 'Red' } 'high' { 'DarkYellow' } 'medium' { 'Yellow' } default { 'White' } }
        Write-Host "   Severity:    $($response.severity)" -ForegroundColor $severityColor
        Write-Host "   Captured at: $($response.capturedAt)" -ForegroundColor White
        if ($response.resolvedAt) {
            $mttrMin = [math]::Round($response.mttr / 60000, 1)
            Write-Host "   Resolved at: $($response.resolvedAt)" -ForegroundColor Green
            Write-Host "   MTTR:        $mttrMin minutes" -ForegroundColor Green
        } else {
            Write-Host "   MTTR:        pending (supply --resolved-at when resolved)" -ForegroundColor DarkGray
        }
        if ($response.files -and $response.files.Count -gt 0) {
            Write-Host "   Files:       $($response.files -join ', ')" -ForegroundColor White
        }
        Write-Host "   Saved to:    .forge/incidents.jsonl" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: deploy-log ──────────────────────────────────────────────
function Invoke-DeployLog {
    $version = if ($Arguments.Count -gt 0) { $Arguments[0] } else { $null }
    if (-not $version) {
        Write-Host "ERROR: version is required. Usage: pforge deploy-log `"<version>`" [--by CI] [--notes `"...`"] [--slice S]" -ForegroundColor Red
        exit 1
    }

    $by    = "unknown"
    $notes = $null
    $slice = $null

    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--by' {
                if (($i + 1) -lt $Arguments.Count) { $by = $Arguments[$i + 1]; $i++ }
            }
            '--notes' {
                if (($i + 1) -lt $Arguments.Count) { $notes = $Arguments[$i + 1]; $i++ }
            }
            '--slice' {
                if (($i + 1) -lt $Arguments.Count) { $slice = $Arguments[$i + 1]; $i++ }
            }
        }
    }

    Write-ManualSteps "deploy-log" @(
        "Build deploy payload (version, by, notes, slice)"
        "POST to /api/deploy-journal on the MCP server"
        "Append record to .forge/deploy-journal.jsonl"
    )

    $port = 3100
    $payload = @{ version = $version; by = $by }
    if ($notes) { $payload.notes = $notes }
    if ($slice) { $payload.slice = $slice }
    $body = $payload | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/deploy-journal" -Method POST `
            -ContentType "application/json" -Body $body -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F680} Deploy Recorded" -ForegroundColor Cyan
        Write-Host "   ID:          $($response.id)" -ForegroundColor White
        Write-Host "   Version:     $($response.version)" -ForegroundColor White
        Write-Host "   By:          $($response.by)" -ForegroundColor White
        Write-Host "   Deployed at: $($response.deployedAt)" -ForegroundColor White
        if ($response.notes) {
            Write-Host "   Notes:       $($response.notes)" -ForegroundColor White
        }
        if ($response.slice) {
            Write-Host "   Slice:       $($response.slice)" -ForegroundColor White
        }
        Write-Host "   Saved to:    .forge/deploy-journal.jsonl" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: triage ──────────────────────────────────────────────────
function Invoke-Triage {
    $minSeverity = "low"
    $maxResults  = 20
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--min-severity' { if (($i + 1) -lt $Arguments.Count) { $minSeverity = $Arguments[$i + 1]; $i++ } }
            '--max'          { if (($i + 1) -lt $Arguments.Count) { $maxResults  = [int]$Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "triage" @(
        "Read open incidents from .forge/incidents.jsonl"
        "Read latest drift violations from .forge/drift-history.json"
        "Score each alert: severity_weight * recency_factor"
        "Rank by priority (tiebreak: more recent first)"
    )

    $port = 3100
    try {
        $uri = "http://localhost:$port/api/triage?minSeverity=$minSeverity&max=$maxResults"
        $response = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F6A8} Alert Triage ($($response.showing)/$($response.total) alerts, min-severity: $($response.minSeverity))" -ForegroundColor Cyan
        Write-Host ""
        if ($response.alerts.Count -eq 0) {
            Write-Host "   No open alerts found." -ForegroundColor Green
        } else {
            foreach ($a in $response.alerts) {
                $sevColor = switch ($a.severity) { 'critical' { 'Red' } 'high' { 'DarkYellow' } 'medium' { 'Yellow' } default { 'White' } }
                $sourceIcon = if ($a.source -eq 'incident') { "`u{1F6A8}" } else { "`u{1F4CA}" }
                Write-Host "   $sourceIcon [$($a.severity)] $($a.description)" -ForegroundColor $sevColor
                Write-Host "      Priority: $($a.priority)  Source: $($a.source)  ID: $($a.id)" -ForegroundColor DarkGray
            }
        }
        Write-Host ""
        Write-Host "   Generated: $($response.generatedAt)" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: runbook ────────────────────────────────────────────────────
function Invoke-Runbook {
    $plan          = $null
    $noIncidents   = $false

    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--no-incidents' { $noIncidents = $true }
            default {
                if (-not $plan -and -not $Arguments[$i].StartsWith('--')) {
                    $plan = $Arguments[$i]
                }
            }
        }
    }

    if (-not $plan) {
        Write-Host "ERROR: plan file is required. Usage: .\pforge.ps1 runbook <plan-file> [--no-incidents]" -ForegroundColor Red
        exit 1
    }

    Write-ManualSteps "runbook" @(
        "Parse the plan file (slices, scope contract, gates)"
        "Collect recent incidents from .forge/incidents.jsonl (unless --no-incidents)"
        "Render a structured Markdown runbook"
        "Save to .forge/runbooks/<plan-name>-runbook.md"
    )

    $port = 3100
    $payload = @{ plan = $plan; includeIncidents = (-not $noIncidents) } | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/runbook" -Method POST `
            -ContentType "application/json" -Body $payload -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F4D6} Runbook Generated" -ForegroundColor Green
        Write-Host "   File:   $($response.runbook)" -ForegroundColor White
        Write-Host "   Slices: $($response.slices)" -ForegroundColor White
        Write-Host "   At:     $($response.generatedAt)" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: hotspot ──────────────────────────────────────────────────
function Invoke-Hotspot {
    $top   = 10
    $since = "6 months ago"
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--top'   { if (($i + 1) -lt $Arguments.Count) { $top = [int]$Arguments[$i + 1]; $i++ } }
            '--since' { if (($i + 1) -lt $Arguments.Count) { $since = $Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "hotspot" @(
        "Run git log to collect file change frequency"
        "Rank files by number of commits"
        "Cache results in .forge/hotspot-cache.json (24h TTL)"
        "Return top N hotspot files"
    )

    $port = 3100
    try {
        $encodedSince = [System.Uri]::EscapeDataString($since)
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/hotspots?top=$top&since=$encodedSince" -Method GET -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F525} Git Churn Hotspots" -ForegroundColor Cyan
        Write-Host "   Since:       $($response.since)" -ForegroundColor White
        Write-Host "   Total files: $($response.totalFiles)" -ForegroundColor White
        Write-Host "   Showing:     $($response.showing)" -ForegroundColor White
        Write-Host ""
        $rank = 1
        foreach ($h in $response.hotspots) {
            $bar = "`u{2588}" * [math]::Min($h.commits, 40)
            Write-Host "   $rank. $($h.file) ($($h.commits) commits)" -ForegroundColor Yellow
            Write-Host "      $bar" -ForegroundColor DarkYellow
            $rank++
        }
        Write-Host ""
        Write-Host "   Cached at: $($response.generatedAt)" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: dep-watch ────────────────────────────────────────────────
function Invoke-DepWatch {
    Write-ManualSteps "dep-watch" @(
        "Run npm audit / pip-audit to scan dependencies"
        "Diff against previous snapshot (.forge/dep-watch.json)"
        "Report new and resolved vulnerabilities"
    )

    $port = 3100
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/deps/watch/run" -Method POST -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F50D} Dependency Watch" -ForegroundColor Cyan
        Write-Host "   Total:    $($response.total)" -ForegroundColor White
        Write-Host "   New:      $($response.new_count)" -ForegroundColor $(if ($response.new_count -gt 0) { 'Red' } else { 'Green' })
        Write-Host "   Resolved: $($response.resolved_count)" -ForegroundColor Green
        Write-Host ""
        if ($response.new_vulnerabilities -and $response.new_vulnerabilities.Count -gt 0) {
            Write-Host "   New Vulnerabilities:" -ForegroundColor Red
            foreach ($v in $response.new_vulnerabilities) {
                Write-Host "   - $($v.package) ($($v.severity)): $($v.title)" -ForegroundColor Yellow
            }
            Write-Host ""
        }
        if ($response.resolved -and $response.resolved.Count -gt 0) {
            Write-Host "   Resolved:" -ForegroundColor Green
            foreach ($v in $response.resolved) {
                Write-Host "   - $($v.package): $($v.title)" -ForegroundColor DarkGreen
            }
            Write-Host ""
        }
        Write-Host "   Snapshot: .forge/dep-watch.json" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: secret-scan ──────────────────────────────────────────────
function Invoke-SecretScan {
    $since     = "HEAD~1"
    $threshold = 4.0
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--since'     { if (($i + 1) -lt $Arguments.Count) { $since = $Arguments[$i + 1]; $i++ } }
            '--threshold' { if (($i + 1) -lt $Arguments.Count) { $threshold = [double]$Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "secret-scan" @(
        "Run git diff to collect changed lines"
        "Compute Shannon entropy for token-like strings"
        "Flag findings above threshold ($threshold)"
        "Cache results in .forge/secret-scan-cache.json"
    )

    $port = 3100
    try {
        $encodedSince = [System.Uri]::EscapeDataString($since)
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/secret-scan" -Method GET -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F50D} Secret Scan Results" -ForegroundColor Cyan
        if ($null -eq $response.cache) {
            Write-Host "   No scan results yet. Run forge_secret_scan to populate." -ForegroundColor DarkGray
        } else {
            Write-Host "   Since:         $($response.since)" -ForegroundColor White
            Write-Host "   Threshold:     $($response.threshold)" -ForegroundColor White
            Write-Host "   Scanned files: $($response.scannedFiles)" -ForegroundColor White
            if ($response.clean) {
                Write-Host "   Status:        `u{2705} Clean — no secrets detected" -ForegroundColor Green
            } else {
                Write-Host "   Status:        `u{26A0} $($response.findings.Count) finding(s)" -ForegroundColor Yellow
                foreach ($f in $response.findings) {
                    Write-Host "      $($f.file):$($f.line) [$($f.confidence)] entropy=$($f.entropyScore) type=$($f.type)" -ForegroundColor Red
                }
            }
            Write-Host ""
            Write-Host "   Scanned at: $($response.scannedAt)" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: env-diff ─────────────────────────────────────────────────
function Invoke-EnvDiff {
    $baseline = ".env"
    $files = ""
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--baseline' { if (($i + 1) -lt $Arguments.Count) { $baseline = $Arguments[$i + 1]; $i++ } }
            '--files'    { if (($i + 1) -lt $Arguments.Count) { $files = $Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "env-diff" @(
        "Read baseline $baseline and compare key names"
        "Detect missing keys across target .env files"
        "Cache results in .forge/env-diff-cache.json (key names only, no values)"
    )

    $port = 3100
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/env/diff" -Method GET -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F50E} Environment Key Diff" -ForegroundColor Cyan
        if ($null -eq $response.cache) {
            Write-Host "   No diff data yet. Run forge_env_diff to populate." -ForegroundColor DarkGray
        } else {
            Write-Host "   Baseline:       $($response.baseline)" -ForegroundColor White
            Write-Host "   Files compared: $($response.filesCompared)" -ForegroundColor White
            if ($response.summary.clean) {
                Write-Host "   Status:         `u{2705} Clean — all keys aligned" -ForegroundColor Green
            } else {
                Write-Host "   Status:         `u{26A0} $($response.summary.totalGaps) gap(s) found" -ForegroundColor Yellow
                foreach ($pair in $response.pairs) {
                    if (($pair.missingInTarget -and $pair.missingInTarget.Count -gt 0) -or ($pair.missingInBaseline -and $pair.missingInBaseline.Count -gt 0)) {
                        Write-Host "   --- $($pair.file) ---" -ForegroundColor White
                        foreach ($k in $pair.missingInTarget) {
                            Write-Host "      Missing in target: $k" -ForegroundColor Red
                        }
                        foreach ($k in $pair.missingInBaseline) {
                            Write-Host "      Missing in baseline: $k" -ForegroundColor Yellow
                        }
                    }
                }
            }
            Write-Host ""
            Write-Host "   Scanned at: $($response.scannedAt)" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: fix-proposal ──────────────────────────────────────────────
function Invoke-FixProposal {
    $source = ""
    $incidentId = ""
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--source'      { if (($i + 1) -lt $Arguments.Count) { $source = $Arguments[$i + 1]; $i++ } }
            '--incident-id' { if (($i + 1) -lt $Arguments.Count) { $incidentId = $Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "fix-proposal" @(
        "Read LiveGuard data (drift, incidents, secrets, regression)"
        "Generate 1-2 slice fix plan"
        "Write to docs/plans/auto/LIVEGUARD-FIX-<id>.md"
        "Append record to .forge/fix-proposals.json"
    )

    $port = 3100
    try {
        $body = @{}
        if ($source)     { $body["source"]     = $source }
        if ($incidentId) { $body["incidentId"] = $incidentId }
        $json = $body | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/fix/propose" `
            -Method POST -Body $json -ContentType "application/json" -ErrorAction Stop

        Write-Host ""
        Write-Host "`u{1F527} Fix Proposal" -ForegroundColor Cyan
        if ($response.error) {
            Write-Host "   $($response.error)" -ForegroundColor Yellow
        } elseif ($response.alreadyExists) {
            Write-Host "   Already exists: $($response.plan)" -ForegroundColor DarkGray
        } else {
            Write-Host "   Fix ID:   $($response.fixId)" -ForegroundColor White
            Write-Host "   Source:   $($response.source)" -ForegroundColor White
            Write-Host "   Plan:     $($response.plan)" -ForegroundColor Green
            Write-Host "   Slices:   $($response.sliceCount)" -ForegroundColor White
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: quorum-analyze ───────────────────────────────────────────
function Invoke-QuorumAnalyze {
    $source = ""
    $goal = ""
    $customQuestion = ""
    $quorumSize = 3
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--source'          { if (($i + 1) -lt $Arguments.Count) { $source = $Arguments[$i + 1]; $i++ } }
            '--goal'            { if (($i + 1) -lt $Arguments.Count) { $goal = $Arguments[$i + 1]; $i++ } }
            '--custom-question' { if (($i + 1) -lt $Arguments.Count) { $customQuestion = $Arguments[$i + 1]; $i++ } }
            '--quorum-size'     { if (($i + 1) -lt $Arguments.Count) { $quorumSize = [int]$Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "quorum-analyze" @(
        "Read LiveGuard data from .forge/ (source: $( if ($source) { $source } else { 'all' } ))"
        "Assemble 3-section prompt (context, question, voting instruction)"
        "Return structured prompt object for multi-model dispatch"
    )

    $port = 3100
    try {
        $body = @{ quorumSize = $quorumSize }
        if ($source)         { $body["source"]         = $source }
        if ($customQuestion) { $body["customQuestion"]  = $customQuestion }
        elseif ($goal)       { $body["analysisGoal"]    = $goal }
        $json = $body | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/quorum/prompt" `
            -Method POST -Body $json -ContentType "application/json" -ErrorAction Stop

        Write-Host ""
        Write-Host "`u{1F50E} Quorum Analyze" -ForegroundColor Cyan
        if ($response.error) {
            Write-Host "   $($response.error)" -ForegroundColor Yellow
        } else {
            Write-Host "   Question:  $($response.questionUsed)" -ForegroundColor White
            Write-Host "   Tokens:    ~$($response.promptTokenEstimate)" -ForegroundColor White
            Write-Host "   Models:    $($response.suggestedModels -join ', ')" -ForegroundColor White
            Write-Host "   Data age:  $($response.dataSnapshotAge)" -ForegroundColor DarkGray
            Write-Host ""
            Write-Host "   Prompt assembled — pipe to quorum runner or copy from JSON output." -ForegroundColor Green
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: health-trend ─────────────────────────────────────────────
function Invoke-HealthTrend {
    $days = 30
    $metrics = ""
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--days'    { if (($i + 1) -lt $Arguments.Count) { $days = [int]$Arguments[$i + 1]; $i++ } }
            '--metrics' { if (($i + 1) -lt $Arguments.Count) { $metrics = $Arguments[$i + 1]; $i++ } }
        }
    }

    Write-ManualSteps "health-trend" @(
        "Read .forge/ operational data (drift, cost, incidents, model performance)"
        "Filter to requested time window ($days days)"
        "Compute per-metric summaries and overall health score"
        "Report trend direction"
    )

    $port = 3100
    try {
        $uri = "http://localhost:$port/api/health-trend?days=$days"
        if ($metrics) { $uri += "&metrics=$metrics" }
        $response = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        Write-Host ""
        Write-Host "`u{1F3E5} Health Trend ($($response.days)-day window)" -ForegroundColor Cyan
        Write-Host "   Health Score: $(if ($null -ne $response.healthScore) { $response.healthScore } else { 'N/A' })/100" -ForegroundColor $(if ($response.healthScore -ge 80) { 'Green' } elseif ($response.healthScore -ge 50) { 'Yellow' } else { 'Red' })
        Write-Host "   Trend:        $($response.trend)" -ForegroundColor White
        Write-Host "   Data Points:  $($response.dataPoints)" -ForegroundColor White
        Write-Host ""
        if ($response.drift) {
            Write-Host "   Drift:" -ForegroundColor Yellow
            Write-Host "     Snapshots: $($response.drift.snapshots)  Avg: $(if ($null -ne $response.drift.avg) { $response.drift.avg } else { 'N/A' })  Trend: $($response.drift.trend)"
        }
        if ($response.cost) {
            Write-Host "   Cost:" -ForegroundColor Yellow
            Write-Host "     Runs: $($response.cost.runs)  Total: `$$($response.cost.totalUsd)  Avg/run: `$$($response.cost.avgPerRun)"
        }
        if ($response.incidents) {
            Write-Host "   Incidents:" -ForegroundColor Yellow
            Write-Host "     Total: $($response.incidents.total)  Open: $($response.incidents.open)  Resolved: $($response.incidents.resolved)"
        }
        if ($response.models) {
            Write-Host "   Models:" -ForegroundColor Yellow
            Write-Host "     Total slices: $($response.models.totalSlices)"
        }
        Write-Host ""
        Write-Host "   Generated: $($response.generatedAt)" -ForegroundColor DarkGray
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: drift ────────────────────────────────────────────────────
function Invoke-Drift {
    $threshold = 70
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        if ($Arguments[$i] -eq '--threshold' -and ($i + 1) -lt $Arguments.Count) {
            $threshold = [int]$Arguments[$i + 1]; $i++
        }
    }

    Write-ManualSteps "drift" @(
        "Scan source files for architecture rule violations"
        "Score codebase (100 minus penalties)"
        "Compare against .forge/drift-history.json"
        "Report trend: improving / stable / degrading"
    )

    $port = 3100
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/drift?threshold=$threshold" -Method GET -ErrorAction Stop
        Write-Host "`n`u{1F4CA} Drift Score: $($response.score)/100" -ForegroundColor $(if ($response.score -ge $threshold) { 'Green' } else { 'Red' })
        Write-Host "   Trend: $($response.trend) ($([char]0x0394)$($response.delta))"
        Write-Host "   Files scanned: $($response.filesScanned)"
        Write-Host "   Violations: $($response.violations.Count)"
        Write-Host "   History entries: $($response.historyLength)"
        if ($response.violations.Count -gt 0) {
            foreach ($v in $response.violations) {
                $color = if ($v.severity -eq 'critical') { 'Red' } else { 'Yellow' }
                Write-Host "   `u{26A0} [$($v.severity)] $($v.file):$($v.line) $($v.rule)" -ForegroundColor $color
            }
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: regression-guard ──────────────────────────────────────────
function Invoke-RegressionGuard {
    $files    = @()
    $plan     = $null
    $failFast = $false

    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        switch ($Arguments[$i]) {
            '--files' {
                if (($i + 1) -lt $Arguments.Count) { $files = $Arguments[$i + 1] -split ','; $i++ }
            }
            '--plan' {
                if (($i + 1) -lt $Arguments.Count) { $plan = $Arguments[$i + 1]; $i++ }
            }
            '--fail-fast' { $failFast = $true }
        }
    }

    Write-ManualSteps "regression-guard" @(
        "Extract validation gate commands from plan files in docs/plans/"
        "Check each command against the gate allowlist"
        "Execute allowed commands and report passed/failed results"
        "Return structured result with per-gate status"
    )

    $port = 3100
    $payload = @{ files = $files; failFast = $failFast }
    if ($plan) { $payload.plan = $plan }
    $body = $payload | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/regression-guard" -Method POST `
            -ContentType "application/json" -Body $body -ErrorAction Stop
        Write-Host ""
        $icon = if ($response.success) { "`u{2705}" } else { "`u{274C}" }
        $color = if ($response.success) { 'Green' } else { 'Red' }
        Write-Host "$icon Regression Guard: $(if ($response.success) { 'PASSED' } else { 'FAILED' })" -ForegroundColor $color
        Write-Host "   Gates checked: $($response.gatesChecked)"
        Write-Host "   Passed:        $($response.passed)"  -ForegroundColor Green
        if ($response.failed -gt 0) {
            Write-Host "   Failed:        $($response.failed)"  -ForegroundColor Red
        }
        if ($response.blocked -gt 0) {
            Write-Host "   Blocked:       $($response.blocked)" -ForegroundColor Yellow
        }
        if ($response.skipped -gt 0) {
            Write-Host "   Skipped:       $($response.skipped)" -ForegroundColor DarkGray
        }
        foreach ($r in $response.results) {
            if ($r.status -eq 'failed') {
                Write-Host "   `u{274C} Slice $($r.sliceNumber) [$($r.planFile)]: $($r.sliceTitle)" -ForegroundColor Red
                if ($r.output) { Write-Host "      $($r.output)" -ForegroundColor DarkGray }
            } elseif ($r.status -eq 'blocked') {
                Write-Host "   `u{26A0} Slice $($r.sliceNumber) [$($r.planFile)]: BLOCKED — $($r.reason)" -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: drain-memory (Phase-28.4 v2.62.3) ───────────────────────
function Invoke-DrainMemory {
    Write-ManualSteps "drain-memory" @(
        "POST to http://localhost:3100/api/memory/drain with bridge secret"
        "Drain pending OpenBrain queue records via the running MCP server"
        "Print summary of delivered/deferred/dlq counts"
    )

    $port = 3100
    $repoRoot = $RepoRoot
    if (-not $repoRoot) { $repoRoot = (Get-Location).Path }

    # Read bridge secret
    $secret = $null
    $secretPath = Join-Path $repoRoot ".forge" "bridge-secret"
    if (Test-Path $secretPath) {
        $secret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
    }
    if (-not $secret) { $secret = $env:PFORGE_BRIDGE_SECRET }

    $headers = @{ 'Content-Type' = 'application/json' }
    if ($secret) { $headers['Authorization'] = "Bearer $secret" }

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/api/memory/drain" -Method POST -Headers $headers -ErrorAction Stop
        if ($response.ok) {
            Write-Host ""
            Write-Host "`u{1F4E4} Drain Memory" -ForegroundColor Cyan
            Write-Host "   Attempted: $($response.attempted)" -ForegroundColor White
            Write-Host "   Delivered: $($response.delivered)" -ForegroundColor Green
            Write-Host "   Deferred:  $($response.deferred)" -ForegroundColor $(if ($response.deferred -gt 0) { 'Yellow' } else { 'White' })
            Write-Host "   DLQ:       $($response.dlq)" -ForegroundColor $(if ($response.dlq -gt 0) { 'Red' } else { 'White' })
            Write-Host "   Duration:  $($response.durationMs)ms" -ForegroundColor DarkGray
            Write-Host ""
        } else {
            Write-Host "ERROR: Drain failed — $($response.error)" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "ERROR: MCP server not running on port $port. Start with: node pforge-mcp/server.mjs" -ForegroundColor Red
        exit 1
    }
}

# ─── Command: migrate-memory (GX.5 v2.36) ──────────────────────────────
function Invoke-MigrateMemory {
    # GX.5: one-shot merge of legacy `*-history.json` and other misnamed
    # `.json` ledgers into their canonical `.jsonl` siblings. Idempotent;
    # safe to re-run. Always backs up the legacy file as `<name>.json.bak-<date>`
    # before removing it. Pass `-DryRun` to preview without touching files.
    Write-Host ""
    Write-Host "─── pforge migrate-memory (GX.5 v2.36) ───" -ForegroundColor Cyan
    Write-Host ""

    $repoRoot = $RepoRoot
    if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
    $forgeDir = Join-Path $repoRoot ".forge"
    if (-not (Test-Path $forgeDir)) {
        Write-Host "  ℹ  No .forge/ directory found at $repoRoot — nothing to migrate." -ForegroundColor Yellow
        return
    }

    # Look at remaining args for -DryRun flag
    $dryRun = $false
    if ($Arguments) {
        foreach ($a in $Arguments) {
            if ($a -eq '-DryRun' -or $a -eq '--dry-run') { $dryRun = $true }
        }
    }

    # Pairs to migrate: legacy .json → canonical .jsonl
    $pairs = @(
        @{ Legacy = "drift-history.json";      Canonical = "drift-history.jsonl" },
        @{ Legacy = "regression-history.json"; Canonical = "regression-history.jsonl" },
        @{ Legacy = "fix-proposals.json";      Canonical = "fix-proposals.jsonl" }
    )

    $stamp = (Get-Date -Format "yyyy-MM-dd")
    $migrated = 0; $skipped = 0; $merged = 0

    foreach ($p in $pairs) {
        $legacyPath    = Join-Path $forgeDir $p.Legacy
        $canonicalPath = Join-Path $forgeDir $p.Canonical
        $hasLegacy     = Test-Path $legacyPath
        $hasCanonical  = Test-Path $canonicalPath

        if (-not $hasLegacy) {
            Write-Host "  · $($p.Legacy): not present, skipping." -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $legacyLines = @()
        try {
            $legacyLines = Get-Content -LiteralPath $legacyPath -ErrorAction Stop |
                Where-Object { $_ -and $_.Trim().Length -gt 0 }
        } catch {
            Write-Host "  ❌ Could not read $($p.Legacy): $_" -ForegroundColor Red
            continue
        }

        $canonicalLines = @()
        if ($hasCanonical) {
            try {
                $canonicalLines = Get-Content -LiteralPath $canonicalPath -ErrorAction Stop |
                    Where-Object { $_ -and $_.Trim().Length -gt 0 }
            } catch {}
        }

        # Dedupe by exact line text (records are JSON; equal text == equal record)
        $seen = New-Object 'System.Collections.Generic.HashSet[string]'
        $combined = New-Object 'System.Collections.Generic.List[string]'
        foreach ($line in $canonicalLines) { if ($seen.Add($line)) { $combined.Add($line) | Out-Null } }
        $newFromLegacy = 0
        foreach ($line in $legacyLines) {
            if ($seen.Add($line)) { $combined.Add($line) | Out-Null; $newFromLegacy++ }
        }

        if ($dryRun) {
            Write-Host "  [dry-run] $($p.Legacy) -> $($p.Canonical): would merge $newFromLegacy new of $($legacyLines.Count) legacy line(s); total after = $($combined.Count)" -ForegroundColor Yellow
            continue
        }

        # Write merged canonical
        try {
            Set-Content -LiteralPath $canonicalPath -Value ($combined -join "`n") -Encoding UTF8 -NoNewline:$false
            # Rename legacy to .bak-<date>
            $bakPath = "$legacyPath.bak-$stamp"
            if (Test-Path $bakPath) { $bakPath = "$legacyPath.bak-$stamp-$([guid]::NewGuid().ToString('N').Substring(0,6))" }
            Move-Item -LiteralPath $legacyPath -Destination $bakPath -Force
            Write-Host "  ✅ $($p.Legacy) -> $($p.Canonical): merged $newFromLegacy new line(s); legacy backed up as $(Split-Path $bakPath -Leaf)" -ForegroundColor Green
            $migrated++
            $merged += $newFromLegacy
        } catch {
            Write-Host "  ❌ Failed to migrate $($p.Legacy): $_" -ForegroundColor Red
        }
    }

    Write-Host ""
    if ($dryRun) {
        Write-Host "─── dry-run complete — no files modified ───" -ForegroundColor Yellow
    } else {
        Write-Host "─── migrate-memory complete: $migrated migrated, $skipped skipped, $merged new line(s) merged ───" -ForegroundColor Cyan
    }
}

# ─── Command: mcp-call ─────────────────────────────────────────────────
# Generic proxy for any MCP tool exposed by the running pforge-mcp server
# on :3100. Covers crucible-*, tempering-*, bug-*, generate-image,
# run-skill, skill-status, and every future tool without needing a
# bespoke CLI wrapper per tool.
#
# Usage:
#   pforge mcp-call <tool_name> [--arg=value ...] [--json '{"key":"val"}']
#
# Examples:
#   pforge mcp-call forge_crucible_list
#   pforge mcp-call forge_crucible_submit --title="Add pagination" --description="..."
#   pforge mcp-call forge_bug_register --json '{"severity":"high","title":"x"}'
function Invoke-McpCall {
    if ($Arguments.Count -lt 1) {
        Write-Host "ERROR: Tool name required." -ForegroundColor Red
        Write-Host "  Usage: pforge mcp-call <tool_name> [--arg=value ...] [--json '{...}']" -ForegroundColor Yellow
        Write-Host "  Example: pforge mcp-call forge_crucible_list" -ForegroundColor Yellow
        exit 1
    }

    $toolName = $Arguments[0]
    # Normalize: accept either "forge_crucible_list" or "crucible-list".
    if ($toolName -notmatch '^forge_') {
        $toolName = "forge_" + ($toolName -replace '-', '_')
    }

    # Build params from remaining args. Two forms supported:
    #   --key=value    → params.key = value
    #   --json '{...}' → params = parsed JSON (overrides key/value form)
    $params = @{}
    $jsonPayload = $null
    for ($i = 1; $i -lt $Arguments.Count; $i++) {
        $a = $Arguments[$i]
        if ($a -eq '--json' -and ($i + 1) -lt $Arguments.Count) {
            $jsonPayload = $Arguments[$i + 1]
            $i++
        } elseif ($a -match '^--([^=]+)=(.*)$') {
            $params[$Matches[1]] = $Matches[2]
        }
    }

    $body = if ($jsonPayload) { $jsonPayload } else { ($params | ConvertTo-Json -Depth 10 -Compress) }
    $url = "http://localhost:3100/api/tool/$toolName"

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
        if ($response -is [string]) { Write-Host $response }
        else { $response | ConvertTo-Json -Depth 10 }
    } catch {
        $status = $null
        try { $status = $_.Exception.Response.StatusCode.value__ } catch { }
        if ($status -eq 404) {
            Write-Host "ERROR: Unknown tool '$toolName'. The MCP server returned 404." -ForegroundColor Red
            Write-Host "  Tip: run 'pforge mcp-call forge_capabilities' to list available tools." -ForegroundColor Yellow
        } elseif ($_.Exception.Message -match 'connection|refused|No connection') {
            Write-Host "ERROR: Plan Forge MCP server not running on localhost:3100." -ForegroundColor Red
            Write-Host "  Start it via VS Code (.vscode/mcp.json) or 'cd pforge-mcp && npm start'." -ForegroundColor Yellow
        } else {
            Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        }
        exit 1
    }
}

# ─── Command: tour ─────────────────────────────────────────────────────
function Invoke-Tour {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           Welcome to Plan Forge — Guided Tour               ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    $instrDir  = Join-Path $RepoRoot ".github/instructions"
    $agentsDir = Join-Path $RepoRoot ".github/agents"
    $promptsDir = Join-Path $RepoRoot ".github/prompts"
    $skillsDir = Join-Path $RepoRoot ".github/skills"
    $hooksDir  = Join-Path $RepoRoot ".github/hooks"
    $forgeJson = Join-Path $RepoRoot ".forge.json"

    $sections = @(
        @{
            Num = 1; Total = 6; Title = "Instruction Files (.github/instructions/)"
            Desc = "These auto-load in Copilot based on the file type you're editing.`nThey contain coding standards, security rules, testing patterns, and Temper Guards.`nEach file has an 'applyTo' pattern — e.g., database.instructions.md loads for *.sql files."
            Dir = $instrDir; Filter = "*.instructions.md"
        },
        @{
            Num = 2; Total = 6; Title = "Agent Definitions (.github/agents/)"
            Desc = "Specialized AI reviewer personas — each focuses on one concern.`nAgents are read-only: they audit code but can't edit files.`nInvoke via the agent picker dropdown in Copilot Chat."
            Dir = $agentsDir; Filter = "*.agent.md"
        },
        @{
            Num = 3; Total = 6; Title = "Prompt Templates (.github/prompts/)"
            Desc = "Scaffolding recipes and pipeline step prompts.`nAttach in Copilot Chat to generate consistent code patterns.`nStep prompts (step0–step6) guide the full pipeline workflow."
            Dir = $promptsDir; Filter = "*.prompt.md"
        },
        @{
            Num = 4; Total = 6; Title = "Skills (.github/skills/)"
            Desc = "Multi-step executable procedures invoked with / slash commands.`nEach skill chains tool calls with validation between steps.`nExamples: /database-migration, /test-sweep, /security-audit"
            Dir = $skillsDir; Filter = $null
        },
        @{
            Num = 5; Total = 6; Title = "Lifecycle Hooks (.github/hooks/)"
            Desc = "Automatic actions during agent sessions — no manual activation needed.`nSessionStart: injects project context. PostToolUse: warns on TODOs.`nPreToolUse: blocks edits to forbidden files. Stop: warns if no tests ran."
            Dir = $hooksDir; Filter = $null
        },
        @{
            Num = 6; Total = 6; Title = "Configuration (.forge.json)"
            Desc = "Project config — preset, build/test commands, model routing, and extensions.`nThe orchestrator reads this to know how to execute your plans.`nEdit directly or use the dashboard Config tab at localhost:3100/dashboard."
            Dir = $null; Filter = $null; File = $forgeJson
        }
    )

    foreach ($section in $sections) {
        Write-Host "[$($section.Num)/$($section.Total)] $($section.Title)" -ForegroundColor Yellow
        Write-Host ""
        foreach ($line in ($section.Desc -split "`n")) {
            Write-Host "  $line" -ForegroundColor Gray
        }
        Write-Host ""

        # Count and list files
        if ($section.Dir -and (Test-Path $section.Dir)) {
            if ($section.Filter) {
                $files = Get-ChildItem -Path $section.Dir -Filter $section.Filter -File | Sort-Object Name
            } else {
                $files = Get-ChildItem -Path $section.Dir -Directory | Sort-Object Name
            }
            $count = $files.Count
            Write-Host "  Found: $count items" -ForegroundColor Green

            $showList = Read-Host "  Press Enter to list them, or 's' to skip"
            if ($showList -ne 's') {
                foreach ($f in $files) {
                    Write-Host "    • $($f.Name)" -ForegroundColor White
                }
            }
        } elseif ($section.File) {
            if (Test-Path $section.File) {
                Write-Host "  Found: $($section.File | Split-Path -Leaf)" -ForegroundColor Green
                $showContent = Read-Host "  Press Enter to show key fields, or 's' to skip"
                if ($showContent -ne 's') {
                    try {
                        $json = Get-Content $section.File -Raw | ConvertFrom-Json
                        if ($json.projectName) { Write-Host "    Project: $($json.projectName)" -ForegroundColor White }
                        if ($json.preset)      { Write-Host "    Preset:  $($json.preset)" -ForegroundColor White }
                        if ($json.stack)        { Write-Host "    Stack:   $($json.stack)" -ForegroundColor White }
                        if ($json.gateCommands) {
                            Write-Host "    Build:   $($json.gateCommands.build)" -ForegroundColor White
                            Write-Host "    Test:    $($json.gateCommands.test)" -ForegroundColor White
                        }
                    } catch {
                        Write-Host "    (could not parse .forge.json)" -ForegroundColor DarkYellow
                    }
                }
            } else {
                Write-Host "  Not found — run 'pforge init' first" -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "  Not found — run 'pforge init' first" -ForegroundColor DarkYellow
        }

        Write-Host ""
        if ($section.Num -lt $section.Total) {
            $null = Read-Host "  Press Enter to continue"
        }
        Write-Host ""
    }

    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Tour complete! Next steps:" -ForegroundColor Green
    Write-Host ""
    Write-Host "  • Run 'pforge smith' to verify your forge health" -ForegroundColor White
    Write-Host "  • Select the Specifier agent in Copilot Chat to plan your first feature" -ForegroundColor White
    Write-Host "  • Read the walkthrough: docs/QUICKSTART-WALKTHROUGH.md" -ForegroundColor White
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

# ─── Command: self-update ──────────────────────────────────────────────
function Invoke-SelfUpdate {
    Write-ManualSteps "self-update" @(
        "Force-refresh the update check (bypass 24h cache)"
        "If a newer version exists, prompt for confirmation"
        "Delegate to 'pforge update --from-github --tag <latest>'"
    )

    $autoYes = $Arguments -contains '--yes' -or $Arguments -contains '-y'
    $dryRun = $Arguments -contains '--dry-run'
    $forceUpdate = $Arguments -contains '--force'

    # Read autoUpdate.enabled from .forge.json (default false)
    $autoUpdateEnabled = $false
    $forgeJson = Join-Path $RepoRoot ".forge.json"
    if (Test-Path $forgeJson) {
        try {
            $cfg = Get-Content $forgeJson -Raw | ConvertFrom-Json
            if ($cfg.autoUpdate -and $cfg.autoUpdate.enabled -eq $true) {
                $autoUpdateEnabled = $true
            }
        } catch { }
    }
    if (-not $autoUpdateEnabled) {
        Write-Host "  ℹ Auto-update is opt-in; this is a manual invocation." -ForegroundColor DarkGray
        Write-Host "    Set autoUpdate.enabled = true in .forge.json to suppress this notice." -ForegroundColor DarkGray
    }

    # Force-refresh update check via node helper
    $nodeHelper = Join-Path $RepoRoot "pforge-mcp/update-check.mjs"
    if (-not (Test-Path $nodeHelper)) {
        Write-Host "ERROR: update-check.mjs not found at $nodeHelper" -ForegroundColor Red
        exit 1
    }

    Write-Host "Checking for updates (force refresh)..." -ForegroundColor DarkCyan
    $checkScript = @"
import { checkForUpdate } from './pforge-mcp/update-check.mjs';
const r = await checkForUpdate({ currentVersion: process.argv[1], projectDir: process.argv[2], force: true });
console.log(JSON.stringify(r || { isNewer: false }));
"@
    $currentVersion = (Get-Content (Join-Path $RepoRoot "VERSION") -Raw).Trim()
    $checkResult = & node --input-type=module -e $checkScript $currentVersion $RepoRoot 2>&1 | Select-Object -Last 1
    try {
        $checkJson = $checkResult | ConvertFrom-Json
    } catch {
        Write-Host "ERROR: Failed to parse update check output: $checkResult" -ForegroundColor Red
        exit 1
    }

    # v2.53.3 — with --force, install the latest tagged release even when the
    # local install reports 'newer' (the classic "stuck on a 2.54.0-dev build
    # copied from a master sibling-clone" case). Without --force, preserve the
    # original behaviour: stop when already current.
    if (-not $checkJson.isNewer -and -not $forceUpdate) {
        Write-Host "  ✅ Already current (v$currentVersion)" -ForegroundColor Green
        if ($currentVersion -match '-dev\b' -and $checkJson.latest) {
            Write-Host ""
            Write-Host "  ℹ Your local VERSION ends in '-dev' but the latest tagged release is v$($checkJson.latest)." -ForegroundColor Yellow
            Write-Host "    If this is an accidental install from a master clone, heal with:" -ForegroundColor Yellow
            Write-Host "      pforge self-update --force" -ForegroundColor Yellow
        }
        exit 0
    }

    $latestTag = "v$($checkJson.latest)"
    if ($checkJson.isNewer) {
        Write-Host "  ⬆ New release available: $latestTag (you have v$currentVersion)" -ForegroundColor Yellow
    } else {
        Write-Host "  ↻ Forcing heal to latest tagged release: $latestTag (you have v$currentVersion)" -ForegroundColor Yellow
    }

    if ($dryRun) {
        Write-Host "  [dry-run] Would run: pforge update --from-github --tag $latestTag" -ForegroundColor DarkGray
        exit 0
    }

    # Prompt unless --yes
    if (-not $autoYes) {
        $answer = Read-Host "  Install $latestTag now? [Y/n]"
        if ($answer -and $answer -notmatch '^[Yy]') {
            Write-Host "  Cancelled." -ForegroundColor Gray
            exit 0
        }
    }

    # Delegate to existing update --from-github
    Write-Host "" -ForegroundColor White
    $updateArgs = @('--from-github', '--tag', $latestTag)
    if ($forceUpdate) { $updateArgs += '--force' }
    $script:Arguments = $updateArgs
    Invoke-Update
}

# ─── Command: testbed-happypath ────────────────────────────────────────
function Invoke-TestbedHappypath {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       Plan Forge — Testbed Happy-Path Runner                 ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    $nodeArgs = @("$RepoRoot/pforge-mcp/testbed/cli-happypath.mjs", "--project-dir", $RepoRoot)

    if ($DryRun) { $nodeArgs += "--dry-run" }

    foreach ($a in $Arguments) {
        if ($a -eq '--dry-run') { $nodeArgs += "--dry-run" }
        elseif ($a -match '^--testbed-path=(.+)$') { $nodeArgs += "--testbed-path"; $nodeArgs += $Matches[1] }
        elseif ($a -match '^--testbed-path$') { /* next arg handled by node */ $nodeArgs += "--testbed-path" }
        else { $nodeArgs += $a }
    }

    Write-Host "Running happy-path scenarios..." -ForegroundColor DarkGray
    & node $nodeArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Some scenarios failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "All happy-path scenarios passed." -ForegroundColor Green
}

# ─── pforge config (v2.56.0) ──────────────────────────────────────────
# Minimal CLI for reading/writing `.forge.json` keys that have enum schemas.
# Current supported keys: updateSource (auto|github-tags|local-sibling).
function Invoke-Config {
    $action = if ($Arguments.Count -ge 1) { $Arguments[0] } else { '' }
    $key    = if ($Arguments.Count -ge 2) { $Arguments[1] } else { '' }
    $value  = if ($Arguments.Count -ge 3) { $Arguments[2] } else { '' }

    $configPath = Join-Path $RepoRoot ".forge.json"

    # Schema of settable keys (extend here when adding new enum keys)
    $schema = @{
        'update-source' = @{
            jsonKey = 'updateSource'
            allowed = @('auto', 'github-tags', 'local-sibling')
            default = 'auto'
            summary = 'Where pforge update pulls template bytes from.'
        }
    }

    if ($action -eq '' -or $action -eq 'help' -or $action -eq '--help') {
        Write-Host ""
        Write-Host "pforge config" -ForegroundColor Cyan
        Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray
        Write-Host "  pforge config get <key>          Read a value from .forge.json"
        Write-Host "  pforge config set <key> <value>  Write a value to .forge.json"
        Write-Host "  pforge config list               Show all settable keys"
        Write-Host ""
        Write-Host "Settable keys:" -ForegroundColor White
        foreach ($k in $schema.Keys) {
            Write-Host "  $k" -ForegroundColor Yellow
            Write-Host "    $($schema[$k].summary)" -ForegroundColor DarkGray
            Write-Host "    Values: $($schema[$k].allowed -join ', ')  (default: $($schema[$k].default))" -ForegroundColor DarkGray
        }
        return
    }

    if ($action -eq 'list') {
        $current = @{}
        if (Test-Path $configPath) {
            try { $current = Get-Content $configPath -Raw | ConvertFrom-Json } catch {}
        }
        foreach ($k in $schema.Keys) {
            $jk = $schema[$k].jsonKey
            $val = if ($current.$jk) { $current.$jk } else { "(unset → $($schema[$k].default))" }
            Write-Host ("  {0,-18}  {1}" -f $k, $val)
        }
        return
    }

    if (-not $schema.ContainsKey($key)) {
        Write-Host "ERROR: unknown config key '$key'" -ForegroundColor Red
        Write-Host "  Run 'pforge config' to see available keys." -ForegroundColor Yellow
        exit 1
    }
    $spec = $schema[$key]

    # Load current config
    $current = [ordered]@{}
    if (Test-Path $configPath) {
        try {
            $parsed = Get-Content $configPath -Raw | ConvertFrom-Json
            foreach ($p in $parsed.PSObject.Properties) { $current[$p.Name] = $p.Value }
        } catch {
            Write-Host "ERROR: .forge.json is malformed: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }

    switch ($action) {
        'get' {
            $val = if ($current.Contains($spec.jsonKey)) { $current[$spec.jsonKey] } else { $spec.default }
            Write-Host $val
        }
        'set' {
            if ($value -eq '') {
                Write-Host "ERROR: missing value — usage: pforge config set $key <value>" -ForegroundColor Red
                Write-Host "  Allowed: $($spec.allowed -join ', ')" -ForegroundColor Yellow
                exit 1
            }
            if ($value -notin $spec.allowed) {
                Write-Host "ERROR: '$value' is not a valid value for '$key'" -ForegroundColor Red
                Write-Host "  Allowed: $($spec.allowed -join ', ')" -ForegroundColor Yellow
                exit 1
            }
            $current[$spec.jsonKey] = $value

            # Write atomically: temp file → rename
            $tmpPath = "$configPath.tmp"
            try {
                ([pscustomobject]$current) | ConvertTo-Json -Depth 10 | Set-Content -Path $tmpPath -Encoding UTF8 -NoNewline
                Move-Item -Path $tmpPath -Destination $configPath -Force
            } catch {
                if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue }
                Write-Host "ERROR: failed to write .forge.json: $($_.Exception.Message)" -ForegroundColor Red
                exit 1
            }
            Write-Host "  ✅ $($spec.jsonKey) = $value" -ForegroundColor Green
        }
        default {
            Write-Host "ERROR: unknown action '$action' — expected get|set|list" -ForegroundColor Red
            exit 1
        }
    }
}

# ─── Command: skills (Phase-26 Slice 8) ───────────────────────────────
function Invoke-Skills {
    $sub = if ($Arguments.Count -gt 0) { $Arguments[0] } else { "" }
    $rest = if ($Arguments.Count -gt 1) { @($Arguments[1..($Arguments.Count - 1)]) } else { @() }

    if (-not $sub -or $sub -eq "help" -or $sub -eq "--help") {
        Write-Host ""
        Write-Host "pforge skills — auto-skill promotion (Phase-26 Slice 8)"
        Write-Host "─────────────────────────────────────────────"
        Write-Host "  pforge skills pending [--threshold N] [--json]"
        Write-Host "  pforge skills accept <sha256Prefix>"
        Write-Host "  pforge skills reject <sha256Prefix> [--reason <text>]"
        Write-Host "  pforge skills defer  <sha256Prefix>"
        Write-Host "  pforge skills promote --auto-promote [--threshold N]"
        return
    }

    $memoryModule = Join-Path $PSScriptRoot "pforge-mcp/memory.mjs"
    if (-not (Test-Path $memoryModule)) {
        Write-Host "ERROR: pforge-mcp/memory.mjs not found at $memoryModule" -ForegroundColor Red
        exit 1
    }
    $moduleUrl = "file:///" + ($memoryModule -replace '\\', '/')

    switch ($sub) {
        'pending' {
            $threshold = $null
            $asJson = $false
            for ($i = 0; $i -lt $rest.Count; $i++) {
                switch ($rest[$i]) {
                    '--threshold' { if (($i + 1) -lt $rest.Count) { $threshold = [int]$rest[$i + 1]; $i++ } }
                    '--json'      { $asJson = $true }
                }
            }
            $thresholdArg = if ($null -ne $threshold) { $threshold } else { "undefined" }
            $script = @"
import("$moduleUrl").then(m => {
  const skills = m.listPendingAutoSkills({ cwd: process.cwd(), threshold: $thresholdArg });
  process.stdout.write(JSON.stringify(skills, null, 2));
}).catch(e => { console.error(e.message); process.exit(1); });
"@
            $output = node -e $script
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            if ($asJson) {
                Write-Output $output
            } else {
                $skills = $output | ConvertFrom-Json
                if (-not $skills -or $skills.Count -eq 0) {
                    Write-Host "No auto-skills pending promotion." -ForegroundColor Yellow
                    return
                }
                Write-Host ""
                Write-Host "Pending auto-skills ($($skills.Count))" -ForegroundColor Cyan
                foreach ($s in $skills) {
                    Write-Host ("  {0}  reused {1}×  {2}" -f $s.sha256Prefix, $s.reuseCount, $s.summary)
                }
                Write-Host ""
                Write-Host "Use 'pforge skills accept <prefix>' to promote, or 'pforge skills promote --auto-promote' to accept all."
            }
        }
        'accept' {
            if ($rest.Count -eq 0) {
                Write-Host "ERROR: sha256Prefix required — usage: pforge skills accept <prefix>" -ForegroundColor Red; exit 1
            }
            $prefix = $rest[0]
            $script = @"
import("$moduleUrl").then(m => {
  const r = m.acceptAutoSkill({ cwd: process.cwd(), sha256Prefix: "$prefix" });
  process.stdout.write(JSON.stringify(r));
  if (!r.ok) process.exit(2);
}).catch(e => { console.error(e.message); process.exit(1); });
"@
            $output = node -e $script
            if ($LASTEXITCODE -eq 0) {
                $r = $output | ConvertFrom-Json
                Write-Host "✅ Promoted: $($r.promotedPath)" -ForegroundColor Green
            } else {
                Write-Host "ERROR: $output" -ForegroundColor Red; exit $LASTEXITCODE
            }
        }
        'reject' {
            if ($rest.Count -eq 0) {
                Write-Host "ERROR: sha256Prefix required — usage: pforge skills reject <prefix>" -ForegroundColor Red; exit 1
            }
            $prefix = $rest[0]
            $reason = ""
            for ($i = 1; $i -lt $rest.Count; $i++) {
                if ($rest[$i] -eq "--reason" -and ($i + 1) -lt $rest.Count) { $reason = $rest[$i + 1]; $i++ }
            }
            $reasonJson = ($reason | ConvertTo-Json -Compress)
            $script = @"
import("$moduleUrl").then(m => {
  const r = m.rejectAutoSkill({ cwd: process.cwd(), sha256Prefix: "$prefix", reason: $reasonJson });
  process.stdout.write(JSON.stringify(r));
  if (!r.ok) process.exit(2);
}).catch(e => { console.error(e.message); process.exit(1); });
"@
            $output = node -e $script
            if ($LASTEXITCODE -eq 0) {
                $r = $output | ConvertFrom-Json
                Write-Host "✅ Rejected: $($r.rejectedPath)" -ForegroundColor Green
            } else {
                Write-Host "ERROR: $output" -ForegroundColor Red; exit $LASTEXITCODE
            }
        }
        'defer' {
            if ($rest.Count -eq 0) {
                Write-Host "ERROR: sha256Prefix required — usage: pforge skills defer <prefix>" -ForegroundColor Red; exit 1
            }
            $prefix = $rest[0]
            $script = @"
import("$moduleUrl").then(m => {
  const r = m.deferAutoSkill({ cwd: process.cwd(), sha256Prefix: "$prefix" });
  process.stdout.write(JSON.stringify(r));
  if (!r.ok) process.exit(2);
}).catch(e => { console.error(e.message); process.exit(1); });
"@
            $output = node -e $script
            if ($LASTEXITCODE -eq 0) {
                $r = $output | ConvertFrom-Json
                Write-Host "⏳ Deferred until: $($r.deferredUntil)" -ForegroundColor Yellow
            } else {
                Write-Host "ERROR: $output" -ForegroundColor Red; exit $LASTEXITCODE
            }
        }
        'promote' {
            $autoPromote = $false
            $threshold = $null
            for ($i = 0; $i -lt $rest.Count; $i++) {
                switch ($rest[$i]) {
                    '--auto-promote' { $autoPromote = $true }
                    '--threshold'    { if (($i + 1) -lt $rest.Count) { $threshold = [int]$rest[$i + 1]; $i++ } }
                }
            }
            if (-not $autoPromote) {
                Write-Host "ERROR: --auto-promote flag required for non-interactive bulk promotion." -ForegroundColor Red
                Write-Host "  Use 'pforge skills pending' to review candidates first." -ForegroundColor Yellow
                exit 1
            }
            $thresholdArg = if ($null -ne $threshold) { $threshold } else { "undefined" }
            $script = @"
import("$moduleUrl").then(m => {
  const pending = m.listPendingAutoSkills({ cwd: process.cwd(), threshold: $thresholdArg });
  const results = [];
  for (const s of pending) {
    results.push(m.acceptAutoSkill({ cwd: process.cwd(), sha256Prefix: s.sha256Prefix }));
  }
  process.stdout.write(JSON.stringify({ count: pending.length, results }, null, 2));
}).catch(e => { console.error(e.message); process.exit(1); });
"@
            $output = node -e $script
            if ($LASTEXITCODE -ne 0) { Write-Host $output -ForegroundColor Red; exit $LASTEXITCODE }
            $r = $output | ConvertFrom-Json
            Write-Host "✅ Auto-promoted $($r.count) skill(s)." -ForegroundColor Green
        }
        default {
            Write-Host "ERROR: unknown skills subcommand '$sub'" -ForegroundColor Red
            Write-Host "  Run 'pforge skills' for usage."; exit 1
        }
    }
}

# ─── Command Router ────────────────────────────────────────────────────
function Invoke-ForgeMaster {
    $sub = if ($Arguments.Count -gt 0) { $Arguments[0] } else { "" }
    $lifecyclePath = Join-Path $RepoRoot "pforge-master/src/lifecycle.mjs"
    if (-not (Test-Path $lifecyclePath)) {
        Write-Host "ERROR: pforge-master not found at $lifecyclePath" -ForegroundColor Red
        exit 1
    }
    switch ($sub) {
        'status' { node $lifecyclePath status }
        'logs'   { node $lifecyclePath logs }
        default  {
            Write-Host "Usage: pforge forge-master <status|logs>" -ForegroundColor Yellow
            exit 1
        }
    }
}

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
    'self-update'  { Invoke-SelfUpdate }
    'analyze'      { Invoke-Analyze }
    'run-plan'     { Invoke-RunPlan }
    'org-rules'    { Invoke-OrgRules }
    'drift'        { Invoke-Drift }
    'incident'     { Invoke-Incident }
    'deploy-log'   { Invoke-DeployLog }
    'triage'       { Invoke-Triage }
    'regression-guard' { Invoke-RegressionGuard }
    'runbook'      { Invoke-Runbook }
    'hotspot'      { Invoke-Hotspot }
    'dep-watch'    { Invoke-DepWatch }
    'secret-scan'  { Invoke-SecretScan }
    'env-diff'        { Invoke-EnvDiff }
    'fix-proposal'    { Invoke-FixProposal }
    'quorum-analyze'  { Invoke-QuorumAnalyze }
    'health-trend'    { Invoke-HealthTrend }
    'version-bump' { Invoke-VersionBump }
    'smith'        { Invoke-Smith }
    'testbed-happypath' { Invoke-TestbedHappypath }
    'migrate-memory' { Invoke-MigrateMemory }
    'drain-memory' { Invoke-DrainMemory }
    'mcp-call'     { Invoke-McpCall }
    'tour'         { Invoke-Tour }
    'config'       { Invoke-Config }
    'skills'       { Invoke-Skills }
    'forge-master' { Invoke-ForgeMaster }
    'help'         { Show-Help }
    ''             { Show-Help }
    '--help'       { Show-Help }
    default {
        Write-Host "ERROR: Unknown command '$Command'" -ForegroundColor Red
        Show-Help
        exit 1
    }
}
