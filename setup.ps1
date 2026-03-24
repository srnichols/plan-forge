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
    [ValidateSet('dotnet', 'typescript', 'python', 'java', 'go', 'custom')]
    [string]$Preset,

    [string]$ProjectPath,

    [string]$ProjectName,

    [switch]$Force,

    [switch]$AutoDetect,

    [switch]$InstallExtensions
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

function Get-PromptValue([string]$Message, [string]$Default) {
    if ($Default) {
        $response = Read-Host "$Message [$Default]"
        if ([string]::IsNullOrWhiteSpace($response)) { return $Default }
        return $response
    }
    else {
        do {
            $response = Read-Host $Message
        } while ([string]::IsNullOrWhiteSpace($response))
        return $response
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

function Update-Placeholders([string]$FilePath, [string]$Name, [string]$Stack) {
    if (-not (Test-Path $FilePath)) { return }
    $content = Get-Content $FilePath -Raw
    $content = $content -replace '<YOUR PROJECT NAME>', $Name
    $content = $content -replace '<YOUR TECH STACK>', $Stack
    $content = $content -replace '<DATE>', (Get-Date -Format 'yyyy-MM-dd')
    Set-Content -Path $FilePath -Value $content -NoNewline
}

function Find-Preset([string]$TargetPath) {
    # .NET markers
    $hasCsproj = $null -ne (Get-ChildItem -Path $TargetPath -Filter "*.csproj" -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1)
    $hasSln    = $null -ne (Get-ChildItem -Path $TargetPath -Filter "*.sln" -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1)
    $hasFsproj = $null -ne (Get-ChildItem -Path $TargetPath -Filter "*.fsproj" -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1)

    # Python markers
    $hasPyproject    = Test-Path (Join-Path $TargetPath "pyproject.toml")
    $hasRequirements = Test-Path (Join-Path $TargetPath "requirements.txt")
    $hasSetupPy      = Test-Path (Join-Path $TargetPath "setup.py")
    $hasPipfile      = Test-Path (Join-Path $TargetPath "Pipfile")

    # Java markers
    $hasPom        = Test-Path (Join-Path $TargetPath "pom.xml")
    $hasBuildGradle = Test-Path (Join-Path $TargetPath "build.gradle")
    $hasBuildGradleKts = Test-Path (Join-Path $TargetPath "build.gradle.kts")

    # Go markers
    $hasGoMod = Test-Path (Join-Path $TargetPath "go.mod")

    # Node/TypeScript markers
    $hasPackageJson = Test-Path (Join-Path $TargetPath "package.json")
    $hasTsConfig    = Test-Path (Join-Path $TargetPath "tsconfig.json")

    if ($hasCsproj -or $hasSln -or $hasFsproj) {
        Write-Host "  AUTO-DETECT  Found .NET project markers" -ForegroundColor Magenta
        return 'dotnet'
    }
    if ($hasGoMod) {
        Write-Host "  AUTO-DETECT  Found Go project markers" -ForegroundColor Magenta
        return 'go'
    }
    if ($hasPom -or $hasBuildGradle -or $hasBuildGradleKts) {
        Write-Host "  AUTO-DETECT  Found Java project markers" -ForegroundColor Magenta
        return 'java'
    }
    if ($hasPyproject -or $hasRequirements -or $hasSetupPy -or $hasPipfile) {
        Write-Host "  AUTO-DETECT  Found Python project markers" -ForegroundColor Magenta
        return 'python'
    }
    if ($hasPackageJson -or $hasTsConfig) {
        Write-Host "  AUTO-DETECT  Found TypeScript/Node project markers" -ForegroundColor Magenta
        return 'typescript'
    }

    Write-Host "  AUTO-DETECT  No known markers found — using 'custom'" -ForegroundColor Yellow
    return 'custom'
}

# ─── Interactive Prompts ───────────────────────────────────────────────
Write-Banner

if (-not $ProjectPath) {
    $ProjectPath = Get-PromptValue "Target project directory" (Get-Location).Path
}
$ProjectPath = (Resolve-Path $ProjectPath -ErrorAction SilentlyContinue)?.Path ?? $ProjectPath

if (-not (Test-Path $ProjectPath)) {
    Write-Host "Creating directory: $ProjectPath" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null
}

if (-not $ProjectName) {
    $defaultName = Split-Path $ProjectPath -Leaf
    $ProjectName = Get-PromptValue "Project name" $defaultName
}

if (-not $Preset) {
    if ($AutoDetect) {
        Write-Host ""
        Write-Host "Auto-detecting tech stack..." -ForegroundColor Cyan
        $Preset = Find-Preset $ProjectPath
    }
    else {
        Write-Host ""
        Write-Host "Available presets:" -ForegroundColor Cyan
        Write-Host "  1) dotnet      — .NET / C# / ASP.NET Core"
        Write-Host "  2) typescript  — TypeScript / React / Node.js / Express"
        Write-Host "  3) python      — Python / FastAPI / SQLAlchemy"
        Write-Host "  4) java        — Java / Spring Boot / Gradle / Maven"
        Write-Host "  5) go          — Go / Chi / Gin / Standard Library"
        Write-Host "  6) custom      — Shared files only (add your own instructions)"
        Write-Host ""
        $choice = Get-PromptValue "Select preset (1-6 or name)" "1"
        $Preset = switch ($choice) {
            '1' { 'dotnet' }
            '2' { 'typescript' }
            '3' { 'python' }
            '4' { 'java' }
            '5' { 'go' }
            '6' { 'custom' }
            default { $choice }
        }
    }
}

$stackLabel = switch ($Preset) {
    'dotnet'     { '.NET / C# / ASP.NET Core' }
    'typescript' { 'TypeScript / React / Node.js' }
    'python'     { 'Python / FastAPI' }
    'java'       { 'Java / Spring Boot' }
    'go'         { 'Go / Standard Library' }
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
    @{ Src = "docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md";            Dst = "docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md" }
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
    @{ Src = "templates/.github/instructions/project-principles.instructions.md"; Dst = ".github/instructions/project-principles.instructions.md" }
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

# ─── Step 3b: Copy Shared Agents ───────────────────────────────────────
if ($Preset -ne 'custom') {
    Write-Host ""
    Write-Host "Step 3b: Shared agents (cross-stack reviewers + pipeline agents)" -ForegroundColor Cyan

    # Shared agents (api-contract, accessibility, multi-tenancy, cicd, observability)
    $sharedAgentsDir = Join-Path $templateRoot "presets/shared/.github/agents"
    if (Test-Path $sharedAgentsDir) {
        Get-ChildItem -Path $sharedAgentsDir -Filter "*.agent.md" -File | ForEach-Object {
            $dst = Join-Path $ProjectPath ".github/agents/$($_.Name)"
            Copy-WithCreate $_.FullName $dst $Force.IsPresent
        }
    }

    # Pipeline agents (plan-hardener, executor, reviewer-gate)
    $pipelineAgentsDir = Join-Path $templateRoot "templates/.github/agents"
    if (Test-Path $pipelineAgentsDir) {
        Get-ChildItem -Path $pipelineAgentsDir -Filter "*.agent.md" -File | ForEach-Object {
            $dst = Join-Path $ProjectPath ".github/agents/$($_.Name)"
            Copy-WithCreate $_.FullName $dst $Force.IsPresent
        }
    }
}

# ─── Step 3c: Copy Project Principles Prompt + Extension Templates ─────
if ($Preset -ne 'custom') {
    Write-Host ""
    Write-Host "Step 3c: Project Principles prompt + extension templates" -ForegroundColor Cyan

    # Project Principles prompt
    $ppPromptSrc = Join-Path $templateRoot "templates/.github/prompts/project-principles.prompt.md"
    $ppPromptDst = Join-Path $ProjectPath ".github/prompts/project-principles.prompt.md"
    if (Test-Path $ppPromptSrc) {
        Copy-WithCreate $ppPromptSrc $ppPromptDst $Force.IsPresent
    }

    # Extension template directory
    $extTemplateSrc = Join-Path $templateRoot "templates/.plan-hardening"
    if (Test-Path $extTemplateSrc) {
        Get-ChildItem -Path $extTemplateSrc -Recurse -File | ForEach-Object {
            $relativePath = $_.FullName.Substring($extTemplateSrc.Length + 1)
            $dst = Join-Path $ProjectPath ".plan-hardening/$relativePath"
            Copy-WithCreate $_.FullName $dst $Force.IsPresent
        }
    }
}

# ─── Step 3d: Install Extensions (if requested) ─────────────────────
if ($InstallExtensions) {
    $extDir = Join-Path $ProjectPath ".plan-hardening/extensions"
    if (Test-Path $extDir) {
        Write-Host ""
        Write-Host "Step 3d: Installing extensions" -ForegroundColor Cyan

        Get-ChildItem -Path $extDir -Directory | Where-Object {
            Test-Path (Join-Path $_.FullName "extension.json")
        } | ForEach-Object {
            $manifest = Get-Content (Join-Path $_.FullName "extension.json") -Raw | ConvertFrom-Json
            Write-Host "  Installing: $($manifest.name) v$($manifest.version)" -ForegroundColor Magenta

            @('instructions', 'agents', 'prompts') | ForEach-Object {
                $srcSubDir = Join-Path $_.FullName $_
                if (Test-Path $srcSubDir) {
                    $destBase = Join-Path $ProjectPath ".github/$_"
                    Get-ChildItem -Path $srcSubDir -File | ForEach-Object {
                        $dst = Join-Path $destBase $_.Name
                        Copy-WithCreate $_.FullName $dst $Force.IsPresent
                    }
                }
            }
        }
    }
}

# ─── Step 4: Replace Placeholders ─────────────────────────────────────
Write-Host ""
Write-Host "Step 4: Replacing placeholders" -ForegroundColor Cyan

Get-ChildItem -Path $ProjectPath -Recurse -Include "*.md" -File | ForEach-Object {
    Update-Placeholders $_.FullName $ProjectName $stackLabel
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
Write-Host "  4. Review .github/prompts/ — customize scaffolding recipes for your conventions"
Write-Host "  5. Review .github/agents/ — tailor reviewer checklists for your project"
Write-Host "  6. Review .github/skills/ — update build/deploy commands for your CI/CD"
Write-Host "  7. Review docs/plans/DEPLOYMENT-ROADMAP.md — add your phases"
Write-Host "  8. Read docs/COPILOT-VSCODE-GUIDE.md for Copilot Agent Mode workflow"
Write-Host "  9. Start planning: open docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
Write-Host ""
Write-Host "Optional (recommended):" -ForegroundColor Yellow
Write-Host "  - Run .github/prompts/project-profile.prompt.md to generate project-specific guardrails"
Write-Host "  - Run .github/prompts/project-principles.prompt.md to define project principles"
Write-Host "  - Use .github/prompts/step0-specify-feature.prompt.md to define your first feature"
Write-Host ""
