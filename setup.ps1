<#
.SYNOPSIS
    AI Plan Hardening Template — Project Setup Wizard

.DESCRIPTION
    Interactive script that bootstraps a project with the AI Plan Hardening
    Pipeline files, instruction files, and AGENTS.md from a chosen preset.

.PARAMETER Preset
    Tech stack preset to apply: dotnet, typescript, python, or custom.

.PARAMETER ProjectPath
    Target project directory. Defaults to current directory.

.PARAMETER ProjectName
    Name of the project (used in generated files).

.PARAMETER Force
    Overwrite existing files without prompting.

.EXAMPLE
    .\setup.ps1 -Preset dotnet -ProjectPath "C:\Projects\MyApp" -ProjectName "MyApp"

.EXAMPLE
    .\setup.ps1  # Interactive mode — prompts for all values
#>

param(
    [ValidateSet('dotnet', 'typescript', 'python', 'custom')]
    [string]$Preset,

    [string]$ProjectPath,

    [string]$ProjectName,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$templateRoot = $PSScriptRoot

# ─── Helpers ───────────────────────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       AI Plan Hardening — Project Setup Wizard              ║" -ForegroundColor Cyan
    Write-Host "║       Bootstraps planning pipeline + tech instructions      ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Prompt-Value([string]$Message, [string]$Default) {
    if ($Default) {
        $input = Read-Host "$Message [$Default]"
        if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
        return $input
    }
    else {
        do {
            $input = Read-Host $Message
        } while ([string]::IsNullOrWhiteSpace($input))
        return $input
    }
}

function Copy-WithCreate([string]$Source, [string]$Destination, [bool]$Overwrite) {
    $destDir = Split-Path $Destination -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    if ((Test-Path $Destination) -and -not $Overwrite) {
        Write-Host "  SKIP  $Destination (exists)" -ForegroundColor Yellow
        return $false
    }
    Copy-Item -Path $Source -Destination $Destination -Force
    Write-Host "  COPY  $Destination" -ForegroundColor Green
    return $true
}

function Replace-Placeholders([string]$FilePath, [string]$Name, [string]$Stack) {
    if (-not (Test-Path $FilePath)) { return }
    $content = Get-Content $FilePath -Raw
    $content = $content -replace '<YOUR PROJECT NAME>', $Name
    $content = $content -replace '<YOUR TECH STACK>', $Stack
    $content = $content -replace '<DATE>', (Get-Date -Format 'yyyy-MM-dd')
    Set-Content -Path $FilePath -Value $content -NoNewline
}

# ─── Interactive Prompts ───────────────────────────────────────────────
Write-Banner

if (-not $ProjectPath) {
    $ProjectPath = Prompt-Value "Target project directory" (Get-Location).Path
}
$ProjectPath = (Resolve-Path $ProjectPath -ErrorAction SilentlyContinue)?.Path ?? $ProjectPath

if (-not (Test-Path $ProjectPath)) {
    Write-Host "Creating directory: $ProjectPath" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null
}

if (-not $ProjectName) {
    $defaultName = Split-Path $ProjectPath -Leaf
    $ProjectName = Prompt-Value "Project name" $defaultName
}

if (-not $Preset) {
    Write-Host ""
    Write-Host "Available presets:" -ForegroundColor Cyan
    Write-Host "  1) dotnet      — .NET / C# / ASP.NET Core"
    Write-Host "  2) typescript  — TypeScript / React / Node.js / Express"
    Write-Host "  3) python      — Python / FastAPI / SQLAlchemy"
    Write-Host "  4) custom      — Shared files only (add your own instructions)"
    Write-Host ""
    $choice = Prompt-Value "Select preset (1-4 or name)" "1"
    $Preset = switch ($choice) {
        '1' { 'dotnet' }
        '2' { 'typescript' }
        '3' { 'python' }
        '4' { 'custom' }
        default { $choice }
    }
}

$stackLabel = switch ($Preset) {
    'dotnet'     { '.NET / C# / ASP.NET Core' }
    'typescript' { 'TypeScript / React / Node.js' }
    'python'     { 'Python / FastAPI' }
    'custom'     { 'Custom (configure manually)' }
}

# ─── Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Project:  $ProjectName"
Write-Host "  Path:     $ProjectPath"
Write-Host "  Preset:   $Preset ($stackLabel)"
Write-Host "  Force:    $Force"
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "Proceed? (Y/n)"
    if ($confirm -and $confirm -notin @('y', 'Y', 'yes', 'Yes', '')) {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
}

# ─── Step 1: Copy Core Files ──────────────────────────────────────────
Write-Host ""
Write-Host "Step 1: Core planning files" -ForegroundColor Cyan

$coreFiles = @(
    @{ Src = "docs/plans/AI-Plan-Hardening-Runbook.md";              Dst = "docs/plans/AI-Plan-Hardening-Runbook.md" }
    @{ Src = "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"; Dst = "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md" }
    @{ Src = "docs/plans/README.md";                                 Dst = "docs/plans/README.md" }
    @{ Src = "docs/plans/DEPLOYMENT-ROADMAP-TEMPLATE.md";            Dst = "docs/plans/DEPLOYMENT-ROADMAP.md" }
)

foreach ($f in $coreFiles) {
    $src = Join-Path $templateRoot $f.Src
    $dst = Join-Path $ProjectPath $f.Dst
    if (Test-Path $src) {
        Copy-WithCreate $src $dst $Force.IsPresent
    }
    else {
        Write-Host "  WARN  Source not found: $($f.Src)" -ForegroundColor Yellow
    }
}

# ─── Step 2: Copy Shared Instruction Files ─────────────────────────────
Write-Host ""
Write-Host "Step 2: Shared instruction files" -ForegroundColor Cyan

$sharedFiles = @(
    @{ Src = ".github/instructions/ai-plan-hardening-runbook.instructions.md"; Dst = ".github/instructions/ai-plan-hardening-runbook.instructions.md" }
    @{ Src = ".github/instructions/architecture-principles.instructions.md";   Dst = ".github/instructions/architecture-principles.instructions.md" }
    @{ Src = ".github/instructions/git-workflow.instructions.md";              Dst = ".github/instructions/git-workflow.instructions.md" }
)

foreach ($f in $sharedFiles) {
    $src = Join-Path $templateRoot $f.Src
    $dst = Join-Path $ProjectPath $f.Dst
    if (Test-Path $src) {
        Copy-WithCreate $src $dst $Force.IsPresent
    }
}

# ─── Step 3: Copy Preset Files ────────────────────────────────────────
if ($Preset -ne 'custom') {
    Write-Host ""
    Write-Host "Step 3: $Preset preset files" -ForegroundColor Cyan

    $presetDir = Join-Path $templateRoot "presets/$Preset"
    if (-not (Test-Path $presetDir)) {
        Write-Host "  ERROR  Preset directory not found: $presetDir" -ForegroundColor Red
        exit 1
    }

    # Copy all files from preset, preserving relative paths
    Get-ChildItem -Path $presetDir -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($presetDir.Length + 1)
        $dst = Join-Path $ProjectPath $relativePath
        Copy-WithCreate $_.FullName $dst $Force.IsPresent
    }

    # Copy preset copilot-instructions to project root if no root one exists
    $presetCopilot = Join-Path $presetDir ".github/copilot-instructions.md"
    $rootCopilot = Join-Path $ProjectPath ".github/copilot-instructions.md"
    if ((Test-Path $presetCopilot) -and -not (Test-Path $rootCopilot)) {
        Copy-WithCreate $presetCopilot $rootCopilot $Force.IsPresent
    }

    # Copy preset AGENTS.md to project root if no root one exists
    $presetAgents = Join-Path $presetDir "AGENTS.md"
    $rootAgents = Join-Path $ProjectPath "AGENTS.md"
    if ((Test-Path $presetAgents) -and -not (Test-Path $rootAgents)) {
        Copy-WithCreate $presetAgents $rootAgents $Force.IsPresent
    }
}
else {
    Write-Host ""
    Write-Host "Step 3: Custom preset — copying template copilot-instructions.md only" -ForegroundColor Cyan

    $src = Join-Path $templateRoot ".github/copilot-instructions.md"
    $dst = Join-Path $ProjectPath ".github/copilot-instructions.md"
    if (Test-Path $src) {
        Copy-WithCreate $src $dst $Force.IsPresent
    }
}

# ─── Step 4: Replace Placeholders ─────────────────────────────────────
Write-Host ""
Write-Host "Step 4: Replacing placeholders" -ForegroundColor Cyan

Get-ChildItem -Path $ProjectPath -Recurse -Include "*.md" -File | ForEach-Object {
    Replace-Placeholders $_.FullName $ProjectName $stackLabel
}

Write-Host "  DONE  Placeholders replaced" -ForegroundColor Green

# ─── Step 5: Generate .plan-hardening.json ─────────────────────────────
Write-Host ""
Write-Host "Step 5: Generating .plan-hardening.json" -ForegroundColor Cyan

$configPath = Join-Path $ProjectPath ".plan-hardening.json"
$config = @{
    projectName  = $ProjectName
    preset       = $Preset
    stack        = $stackLabel
    setupDate    = (Get-Date -Format 'yyyy-MM-dd')
    templateVersion = "1.0.0"
} | ConvertTo-Json -Depth 3

Set-Content -Path $configPath -Value $config
Write-Host "  CREATED  .plan-hardening.json" -ForegroundColor Green

# ─── Step 6: Copy VS Code Settings Template ────────────────────────────
Write-Host ""
Write-Host "Step 6: VS Code settings template" -ForegroundColor Cyan

$vscodeSrc = Join-Path $templateRoot "templates/vscode-settings.json.template"
$vscodeDst = Join-Path $ProjectPath ".vscode/settings.json"
if (Test-Path $vscodeSrc) {
    Copy-WithCreate $vscodeSrc $vscodeDst $Force.IsPresent
}

# ─── Step 7: Copy Copilot VS Code Guide ────────────────────────────────
$guideSrc = Join-Path $templateRoot "docs/COPILOT-VSCODE-GUIDE.md"
$guideDst = Join-Path $ProjectPath "docs/COPILOT-VSCODE-GUIDE.md"
if (Test-Path $guideSrc) {
    Copy-WithCreate $guideSrc $guideDst $Force.IsPresent
}

# ─── Done ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    Setup Complete!                          ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Files installed to: $ProjectPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Review .github/copilot-instructions.md — fill in project-specific details"
Write-Host "  2. Review AGENTS.md — customize worker patterns for your app"
Write-Host "  3. Review .vscode/settings.json — uncomment instruction file references"
Write-Host "  4. Review docs/plans/DEPLOYMENT-ROADMAP.md — add your phases"
Write-Host "  5. Read docs/COPILOT-VSCODE-GUIDE.md for Copilot Agent Mode workflow"
Write-Host "  6. Start planning: open docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
Write-Host ""
