<#
.SYNOPSIS
    Validates that Plan Forge setup completed correctly.

.DESCRIPTION
    Checks that all required files exist, are non-empty, and contain no
    unresolved placeholders. Returns exit code 0 on success, 1 on failure.

.PARAMETER ProjectPath
    Target project directory to validate. Defaults to current directory.

.EXAMPLE
    .\validate-setup.ps1 -ProjectPath "C:\Projects\MyApp"

.EXAMPLE
    .\validate-setup.ps1  # Validates current directory
#>

param(
    [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

$pass = 0
$fail = 0
$warn = 0

function Check-FileExists([string]$RelPath, [bool]$Required = $true) {
    $fullPath = Join-Path $ProjectPath $RelPath
    if (Test-Path $fullPath) {
        $size = (Get-Item $fullPath).Length
        if ($size -eq 0) {
            Write-Host "  FAIL  $RelPath (empty file)" -ForegroundColor Red
            if ($Required) { $script:fail++ } else { $script:warn++ }
            return $false
        }
        Write-Host "  PASS  $RelPath ($size bytes)" -ForegroundColor Green
        $script:pass++
        return $true
    }
    else {
        if ($Required) {
            Write-Host "  FAIL  $RelPath (missing)" -ForegroundColor Red
            $script:fail++
        }
        else {
            Write-Host "  WARN  $RelPath (missing — optional)" -ForegroundColor Yellow
            $script:warn++
        }
        return $false
    }
}

function Check-NoPlaceholders([string]$RelPath) {
    $fullPath = Join-Path $ProjectPath $RelPath
    if (-not (Test-Path $fullPath)) { return }
    $content = Get-Content $fullPath -Raw
    $placeholders = @('<YOUR PROJECT NAME>', '<YOUR TECH STACK>', '<YOUR BUILD COMMAND>', '<YOUR TEST COMMAND>', '<YOUR LINT COMMAND>')
    foreach ($ph in $placeholders) {
        if ($content -match [regex]::Escape($ph)) {
            Write-Host "  TODO  $RelPath contains placeholder to fill in: $ph" -ForegroundColor Magenta
            $script:warn++
        }
    }
}

# ─── Banner ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       Plan Forge — Setup Validator                   ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Validating: $ProjectPath" -ForegroundColor Cyan
Write-Host ""

# ─── Required Files ────────────────────────────────────────────────────
Write-Host "Required files:" -ForegroundColor Cyan

Check-FileExists ".github/copilot-instructions.md"
Check-FileExists ".github/instructions/architecture-principles.instructions.md"
Check-FileExists ".github/instructions/git-workflow.instructions.md"
Check-FileExists ".github/instructions/ai-plan-hardening-runbook.instructions.md"
Check-FileExists "docs/plans/AI-Plan-Hardening-Runbook.md"
Check-FileExists "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
Check-FileExists "docs/plans/DEPLOYMENT-ROADMAP.md"

# ─── Preset-Dependent Files ───────────────────────────────────────────
Write-Host ""
Write-Host "Preset-dependent files:" -ForegroundColor Cyan

$configPath = Join-Path $ProjectPath ".forge.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $preset = $config.preset
    Write-Host "  INFO  Detected preset: $preset" -ForegroundColor Cyan

    if ($preset -ne 'custom') {
        Check-FileExists "AGENTS.md"
        Check-FileExists ".github/instructions/testing.instructions.md"
        Check-FileExists ".github/instructions/security.instructions.md"

        if ($preset -eq 'azure-iac') {
            # IaC-specific instruction files
            Check-FileExists ".github/instructions/bicep.instructions.md"
            Check-FileExists ".github/instructions/naming.instructions.md"
            Check-FileExists ".github/instructions/deploy.instructions.md"
        }
        else {
            # App-stack presets
            Check-FileExists ".github/instructions/database.instructions.md"
        }
    }

    # Check for agentic files (prompt templates, agent definitions, skills)
    Write-Host ""
    Write-Host "Agentic files (prompts, agents, skills):" -ForegroundColor Cyan

    if ($preset -ne 'custom') {
        $promptsDir = Join-Path $ProjectPath ".github/prompts"
        $agentsDir  = Join-Path $ProjectPath ".github/agents"
        $skillsDir  = Join-Path $ProjectPath ".github/skills"

        if (Test-Path $promptsDir) {
            $promptCount = (Get-ChildItem -Path $promptsDir -Filter "*.prompt.md" -File).Count
            Write-Host "  PASS  .github/prompts/ ($promptCount prompt templates)" -ForegroundColor Green
            $pass++
        }
        else {
            Write-Host "  WARN  .github/prompts/ (missing — optional)" -ForegroundColor Yellow
            $warn++
        }

        if (Test-Path $agentsDir) {
            $agentCount = (Get-ChildItem -Path $agentsDir -Filter "*.agent.md" -File).Count
            Write-Host "  PASS  .github/agents/ ($agentCount agent definitions)" -ForegroundColor Green
            $pass++
        }
        else {
            Write-Host "  WARN  .github/agents/ (missing — optional)" -ForegroundColor Yellow
            $warn++
        }

        if (Test-Path $skillsDir) {
            $skillCount = (Get-ChildItem -Path $skillsDir -Recurse -Filter "SKILL.md" -File).Count
            Write-Host "  PASS  .github/skills/ ($skillCount skills)" -ForegroundColor Green
            $pass++
        }
        else {
            Write-Host "  WARN  .github/skills/ (missing — optional)" -ForegroundColor Yellow
            $warn++
        }
    }
}
else {
    Write-Host "  WARN  .forge.json not found — skipping preset checks" -ForegroundColor Yellow
    $warn++
}

# ─── Agent-Specific Files ─────────────────────────────────────────────
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $configuredAgents = @('copilot')
    if ($config.agents) {
        if ($config.agents -is [System.Array]) {
            $configuredAgents = $config.agents
        } elseif ($config.agents -is [string]) {
            $configuredAgents = $config.agents -split ','
        }
    }

    $extraAgents = $configuredAgents | Where-Object { $_ -ne 'copilot' }
    if ($extraAgents.Count -gt 0) {
        Write-Host ""
        Write-Host "Agent-specific files:" -ForegroundColor Cyan

        foreach ($ag in $extraAgents) {
            switch ($ag.Trim()) {
                'claude' {
                    Check-FileExists "CLAUDE.md" $false
                    if (Test-Path (Join-Path $ProjectPath ".claude/skills")) {
                        $claudeSkills = (Get-ChildItem -Path (Join-Path $ProjectPath ".claude/skills") -Recurse -Filter "SKILL.md" -File).Count
                        Write-Host "  PASS  .claude/skills/ ($claudeSkills Claude skills)" -ForegroundColor Green
                        $pass++
                    } else {
                        Write-Host "  WARN  .claude/skills/ (missing)" -ForegroundColor Yellow
                        $warn++
                    }
                }
                'cursor' {
                    Check-FileExists ".cursor/rules" $false
                    if (Test-Path (Join-Path $ProjectPath ".cursor/commands")) {
                        $cursorCmds = (Get-ChildItem -Path (Join-Path $ProjectPath ".cursor/commands") -Filter "*.md" -File).Count
                        Write-Host "  PASS  .cursor/commands/ ($cursorCmds Cursor commands)" -ForegroundColor Green
                        $pass++
                    } else {
                        Write-Host "  WARN  .cursor/commands/ (missing)" -ForegroundColor Yellow
                        $warn++
                    }
                }
                'codex' {
                    if (Test-Path (Join-Path $ProjectPath ".agents/skills")) {
                        $codexSkills = (Get-ChildItem -Path (Join-Path $ProjectPath ".agents/skills") -Recurse -Filter "SKILL.md" -File).Count
                        Write-Host "  PASS  .agents/skills/ ($codexSkills Codex skills)" -ForegroundColor Green
                        $pass++
                    } else {
                        Write-Host "  WARN  .agents/skills/ (missing)" -ForegroundColor Yellow
                        $warn++
                    }
                }
            }
        }
    }
}

# ─── Optional Files ───────────────────────────────────────────────────
Write-Host ""
Write-Host "Optional files:" -ForegroundColor Cyan

Check-FileExists ".vscode/settings.json" $false
Check-FileExists "docs/COPILOT-VSCODE-GUIDE.md" $false
Check-FileExists ".forge.json" $false

# ─── New Capabilities (Optional) ──────────────────────────────────────
Write-Host ""
Write-Host "Optional capabilities:" -ForegroundColor Cyan

# Project Principles
$ppPath = Join-Path $ProjectPath "docs/plans/PROJECT-PRINCIPLES.md"
if (Test-Path $ppPath) {
    $principleCount = (Select-String -Path $ppPath -Pattern '^\|\s*\d+\s*\|' -AllMatches).Count
    Write-Host "  PASS  Project Principles: found ($principleCount principles)" -ForegroundColor Green
    $pass++
}
else {
    Write-Host "  WARN  Project Principles: not created (optional — run project-principles.prompt.md)" -ForegroundColor Yellow
    $warn++
}

# Extensions
$extJsonPath = Join-Path $ProjectPath ".forge/extensions/extensions.json"
if (Test-Path $extJsonPath) {
    $extData = Get-Content $extJsonPath -Raw | ConvertFrom-Json
    $extCount = if ($extData.extensions) { $extData.extensions.Count } else { 0 }
    if ($extCount -gt 0) {
        Write-Host "  PASS  Extensions: $extCount installed" -ForegroundColor Green
        $pass++
    }
    else {
        Write-Host "  WARN  Extensions: none installed (optional)" -ForegroundColor Yellow
        $warn++
    }
}
else {
    Write-Host "  WARN  Extensions: not configured (optional)" -ForegroundColor Yellow
    $warn++
}

# CLI
$cliPath = Join-Path $ProjectPath "pforge.ps1"
if (Test-Path $cliPath) {
    Write-Host "  PASS  CLI: pforge.ps1 found" -ForegroundColor Green
    $pass++
}
else {
    Write-Host "  WARN  CLI: pforge.ps1 not installed (optional)" -ForegroundColor Yellow
    $warn++
}

# ─── Placeholder Scan ─────────────────────────────────────────────────
Write-Host ""
Write-Host "Placeholder scan:" -ForegroundColor Cyan

Check-NoPlaceholders ".github/copilot-instructions.md"
Check-NoPlaceholders "AGENTS.md"
Check-NoPlaceholders "docs/plans/DEPLOYMENT-ROADMAP.md"

# ─── Summary ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Results:  $pass passed  |  $fail failed  |  $warn warnings" -ForegroundColor $(if ($fail -gt 0) { 'Red' } else { 'Green' })
Write-Host "────────────────────────────────────────────────────" -ForegroundColor Gray

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "VALIDATION FAILED" -ForegroundColor Red
    Write-Host "Fix the $fail failed check(s) above before proceeding." -ForegroundColor Red
    exit 1
}
else {
    Write-Host ""
    Write-Host "VALIDATION PASSED" -ForegroundColor Green
    if ($warn -gt 0) {
        Write-Host "$warn warning(s) — review optional items above." -ForegroundColor Yellow
    }
    exit 0
}
