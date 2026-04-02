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
    # SAFE TO UPDATE: Framework files that users typically don't customize
    $safeFiles = @(
        # Pipeline prompts (step0-step6)
        @{ Src = "shared/.github/prompts"; Dst = ".github/prompts"; Pattern = "step*.prompt.md" }
        # Pipeline agents
        @{ Src = "templates/.github/agents"; Dst = ".github/agents"; Pattern = "*.agent.md";
           Names = @("specifier.agent.md", "plan-hardener.agent.md", "executor.agent.md", "reviewer-gate.agent.md", "shipper.agent.md") }
        # Shared instruction files
        @{ Src = "shared/.github/instructions"; Dst = ".github/instructions"; Pattern = "*.instructions.md";
           Names = @("architecture-principles.instructions.md", "git-workflow.instructions.md", "ai-plan-hardening-runbook.instructions.md") }
        # Runbook and instructions
        @{ Src = "docs/plans"; Dst = "docs/plans"; Pattern = "*.md";
           Names = @("AI-Plan-Hardening-Runbook.md", "AI-Plan-Hardening-Runbook-Instructions.md", "DEPLOYMENT-ROADMAP-TEMPLATE.md", "PROJECT-PRINCIPLES-TEMPLATE.md", "README.md") }
        # Hooks
        @{ Src = "templates/.github/hooks"; Dst = ".github/hooks"; Pattern = "*" }
    )

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
    $skipped = @()
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
    'help'         { Show-Help }
    ''             { Show-Help }
    '--help'       { Show-Help }
    default {
        Write-Host "ERROR: Unknown command '$Command'" -ForegroundColor Red
        Show-Help
        exit 1
    }
}
