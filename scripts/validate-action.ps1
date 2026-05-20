#!/usr/bin/env pwsh
# Plan Forge Validate — GitHub Action Script (PowerShell twin of validate-action.sh)
# Validates Plan Forge setup, guardrail files, plan artifacts, and code cleanliness.
param(
    [string] $Path              = ".",
    [string] $FailOnWarnings    = "false",
    [string] $Sweep             = "true",
    [string] $SweepFail         = "false",
    [string] $Analyze           = "false",
    [string] $AnalyzePlan       = "",
    [int]    $AnalyzeThreshold  = 60
)

$ProjectDir     = $Path
$FailOnWarnings = $FailOnWarnings.ToLower()
$RunSweep       = $Sweep.ToLower() -eq "true"
$SweepFail      = $SweepFail.ToLower() -eq "true"
$RunAnalyze     = $Analyze.ToLower() -eq "true"

$PASS = 0; $FAIL = 0; $WARN = 0

function pass($msg) { Write-Host "  ✅ $msg"; $script:PASS++ }
function fail($msg) { Write-Host "  ❌ $msg"; $script:FAIL++ }
function warn($msg) { Write-Host "  ⚠️  $msg"; $script:WARN++ }

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗"
Write-Host "║       Plan Forge — Validate (CI)                             ║"
Write-Host "╚══════════════════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "Project: $ProjectDir"
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 1. SETUP HEALTH
# ═══════════════════════════════════════════════════════════════════
Write-Host "Setup Health:"

$Preset          = "unknown"
$TemplateVersion = "unknown"

$ConfigPath = Join-Path $ProjectDir ".forge.json"
if (Test-Path $ConfigPath) {
    try {
        $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        $Preset          = if ($cfg.preset)          { $cfg.preset }          else { "unknown" }
        $TemplateVersion = if ($cfg.templateVersion) { $cfg.templateVersion } else { "unknown" }
        pass ".forge.json valid (preset: $Preset, v$TemplateVersion)"
    } catch {
        fail ".forge.json exists but could not be parsed: $($_.Exception.Message)"
    }
} else {
    fail ".forge.json not found — run 'pforge init' to bootstrap"
}

$CopilotInstr = Join-Path $ProjectDir ".github/copilot-instructions.md"
if (Test-Path $CopilotInstr) {
    pass ".github/copilot-instructions.md exists"
} else {
    fail ".github/copilot-instructions.md missing"
}

$ArchInstr = Join-Path $ProjectDir ".github/instructions/architecture-principles.instructions.md"
$GitInstr  = Join-Path $ProjectDir ".github/instructions/git-workflow.instructions.md"
if ((Test-Path $ArchInstr) -and (Test-Path $GitInstr)) {
    pass "Core guardrail files present (architecture-principles, git-workflow)"
} else {
    fail "Missing core guardrail files"
}

Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 2. FILE COUNTS PER PRESET
# ═══════════════════════════════════════════════════════════════════
Write-Host "File Counts:"

$PresetKey = ($Preset -split ',')[0]

switch ($PresetKey) {
    { $_ -in 'dotnet','typescript','python','java','go','swift','azure-iac' } {
        $ExpInstr = 14; $ExpAgents = 17; $ExpPrompts = 9; $ExpSkills = 8
    }
    'custom' {
        $ExpInstr = 3; $ExpAgents = 5; $ExpPrompts = 7; $ExpSkills = 0
    }
    default {
        $ExpInstr = 3; $ExpAgents = 0; $ExpPrompts = 0; $ExpSkills = 0
    }
}

$InstrCount  = (Get-ChildItem (Join-Path $ProjectDir ".github/instructions") -Filter "*.instructions.md" -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
$AgentCount  = (Get-ChildItem (Join-Path $ProjectDir ".github/agents")       -Filter "*.agent.md"        -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
$PromptCount = (Get-ChildItem (Join-Path $ProjectDir ".github/prompts")      -Filter "*.prompt.md"       -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
$SkillCount  = (Get-ChildItem (Join-Path $ProjectDir ".github/skills")       -Filter "SKILL.md"          -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count

if ($InstrCount  -ge $ExpInstr)   { pass "$InstrCount instruction files (expected: >=$ExpInstr for $PresetKey)" }  else { warn "$InstrCount instruction files (expected: >=$ExpInstr for $PresetKey)" }
if ($AgentCount  -ge $ExpAgents)  { pass "$AgentCount agent definitions (expected: >=$ExpAgents for $PresetKey)" } else { warn "$AgentCount agent definitions (expected: >=$ExpAgents for $PresetKey)" }
if ($PromptCount -ge $ExpPrompts) { pass "$PromptCount prompt templates (expected: >=$ExpPrompts for $PresetKey)" } else { warn "$PromptCount prompt templates (expected: >=$ExpPrompts for $PresetKey)" }
if ($SkillCount  -ge $ExpSkills)  { pass "$SkillCount skills (expected: >=$ExpSkills for $PresetKey)" }           else { warn "$SkillCount skills (expected: >=$ExpSkills for $PresetKey)" }

Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 3. PLACEHOLDER CHECK
# ═══════════════════════════════════════════════════════════════════
Write-Host "Placeholder Check:"

if (Test-Path $CopilotInstr) {
    $content  = Get-Content $CopilotInstr -Raw
    $phList   = @()
    $allPh    = @('<YOUR PROJECT NAME>','<YOUR TECH STACK>','<YOUR BUILD COMMAND>','<YOUR TEST COMMAND>','<YOUR LINT COMMAND>','<YOUR DEV COMMAND>','<DATE>')
    foreach ($ph in $allPh) {
        if ($content -like "*$ph*") { $phList += $ph }
    }
    if ($phList.Count -gt 0) {
        fail "copilot-instructions.md has $($phList.Count) unresolved placeholder(s): $($phList -join ', ')"
    } else {
        pass "No unresolved placeholders in copilot-instructions.md"
    }
} else {
    warn "copilot-instructions.md not found — skipping placeholder check"
}

Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 4. ORPHAN DETECTION
# ═══════════════════════════════════════════════════════════════════
Write-Host "Orphan Detection:"

$AgentsMd  = Join-Path $ProjectDir "AGENTS.md"
$AgentsDir = Join-Path $ProjectDir ".github/agents"
$OrphansFound = $false

if ((Test-Path $AgentsMd) -and (Test-Path $AgentsDir)) {
    $referenced = (Select-String -Path $AgentsMd -Pattern '[a-z0-9-]+\.agent\.md' -AllMatches -ErrorAction SilentlyContinue).Matches.Value | Sort-Object -Unique
    foreach ($ref in $referenced) {
        if (-not (Test-Path (Join-Path $AgentsDir $ref))) {
            warn "AGENTS.md references '$ref' but file not found"
            $OrphansFound = $true
        }
    }
    if (-not $OrphansFound) { pass "No orphaned agent references" }
} else {
    pass "Agent orphan check skipped (AGENTS.md or agents/ not present)"
}

$InstrDir = Join-Path $ProjectDir ".github/instructions"
$ApplyToIssues = $false
if (Test-Path $InstrDir) {
    foreach ($f in Get-ChildItem $InstrDir -Filter "*.instructions.md" -File -ErrorAction SilentlyContinue) {
        $fContent = Get-Content $f.FullName -TotalCount 5
        $hasFrontmatter = $fContent[0] -eq '---'
        $hasApplyTo     = Select-String -InputObject ($fContent -join "`n") -Pattern 'applyTo' -Quiet
        if ($hasFrontmatter -and -not $hasApplyTo) {
            warn "$($f.Name) has frontmatter but no applyTo pattern"
            $ApplyToIssues = $true
        }
    }
    if (-not $ApplyToIssues) { pass "All instruction files have applyTo patterns" }
}

Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 5. PLAN ARTIFACT CHECK
# ═══════════════════════════════════════════════════════════════════
Write-Host "Plan Artifacts:"

$PlansDir = Join-Path $ProjectDir "docs/plans"
$Roadmap  = Join-Path $PlansDir "DEPLOYMENT-ROADMAP.md"
if (Test-Path $Roadmap) { pass "DEPLOYMENT-ROADMAP.md exists" } else { warn "DEPLOYMENT-ROADMAP.md not found" }

if (Test-Path $PlansDir) {
    $PlanFiles = Get-ChildItem -Path $PlansDir -Filter "Phase-*-PLAN.md" -File -ErrorAction SilentlyContinue
    if ($PlanFiles.Count -gt 0) {
        $PlansOk = 0; $PlansMissing = 0
        foreach ($plan in $PlanFiles) {
            $planContent = Get-Content $plan.FullName -Raw
            $hasScope  = ($planContent | Select-String '### In Scope|### Scope Contract|## Scope') ? $true : $false
            $hasSlices = ($planContent | Select-String '### Slice|## Execution Slices|## Slices') ? $true : $false
            if ($hasScope -and $hasSlices) {
                $PlansOk++
            } else {
                $missingParts = @()
                if (-not $hasScope)  { $missingParts += "scope contract" }
                if (-not $hasSlices) { $missingParts += "execution slices" }
                warn "$($plan.Name) missing: $($missingParts -join ', ')"
                $PlansMissing++
            }
        }
        if ($PlansMissing -eq 0) { pass "$($PlanFiles.Count) plan(s) — all have scope contracts and slices" }
    } else {
        pass "No phase plans yet (OK for new projects)"
    }
}

Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 6. COMPLETENESS SWEEP (optional)
# ═══════════════════════════════════════════════════════════════════
if ($RunSweep) {
    Write-Host "Completeness Sweep:"

    $sweepPattern = 'TODO|FIXME|HACK|will be replaced|placeholder|stub|mock data'
    $codeExtensions = @('cs','ts','tsx','js','jsx','py','go','java','kt','rb','rs','sql','sh','ps1')

    $sweepTotal = 0
    foreach ($ext in $codeExtensions) {
        $findings = Get-ChildItem -Path $ProjectDir -Recurse -Filter "*.$ext" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\bin\\|\\obj\\|\\dist\\|\\vendor\\|\\__pycache__\\|\\plan-forge\\' } |
            Select-Object -First 200 |
            ForEach-Object {
                $file = $_
                (Select-String -Path $file.FullName -Pattern $sweepPattern -ErrorAction SilentlyContinue) |
                    Select-Object -First 50 |
                    ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }
            }
        foreach ($finding in $findings) {
            if ($finding) {
                Write-Host "  $finding"
                $sweepTotal++
            }
        }
    }

    if ($sweepTotal -eq 0) {
        pass "Sweep clean — zero deferred-work markers"
    } elseif ($SweepFail) {
        fail "Found $sweepTotal deferred-work marker(s)"
    } else {
        warn "Found $sweepTotal deferred-work marker(s)"
    }

    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════
# 7. CROSS-ARTIFACT ANALYSIS (optional)
# ═══════════════════════════════════════════════════════════════════
if ($RunAnalyze) {
    Write-Host "Cross-Artifact Analysis:"

    if (-not $AnalyzePlan) {
        warn "analyze=true but no analyze-plan specified — skipping"
    } elseif (-not (Test-Path (Join-Path $ProjectDir $AnalyzePlan))) {
        fail "Plan file not found: $AnalyzePlan"
    } else {
        $PforgeScript = Join-Path $ProjectDir "pforge.ps1"
        if (Test-Path $PforgeScript) {
            $analyzeOutput = & pwsh -NoProfile -File $PforgeScript analyze $AnalyzePlan 2>&1
            Write-Host $analyzeOutput

            $score = 0
            if ($analyzeOutput -match 'Consistency Score:\s*(\d+)') { $score = [int]$Matches[1] }
            if ($score -ge $AnalyzeThreshold) {
                pass "Consistency score: $score/100 (threshold: $AnalyzeThreshold)"
            } else {
                fail "Consistency score: $score/100 (below threshold: $AnalyzeThreshold)"
            }
        } else {
            $PlanFile    = Join-Path $ProjectDir $AnalyzePlan
            $planContent = Get-Content $PlanFile -Raw
            $hasScope  = ($planContent | Select-String '### In Scope|### Scope Contract') ? $true : $false
            $hasSlices = ($planContent | Select-String '### Slice') ? $true : $false
            $hasGates  = ($planContent | Select-String -CaseSensitive 'validation gate|build.*pass|test.*pass') ? $true : $false
            if ($hasScope)  { pass "Plan has scope contract" }  else { warn "No scope contract found" }
            if ($hasSlices) { pass "Plan has slices" }           else { warn "No execution slices found" }
            if ($hasGates)  { pass "Plan has validation gates" } else { warn "No validation gates found" }
        }
    }

    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════
Write-Host "────────────────────────────────────────────────────"
Write-Host "  Results:  $PASS passed  |  $FAIL failed  |  $WARN warnings"
Write-Host "────────────────────────────────────────────────────"

if ($env:GITHUB_OUTPUT) {
    "passed=$PASS"   | Add-Content $env:GITHUB_OUTPUT
    "failed=$FAIL"   | Add-Content $env:GITHUB_OUTPUT
    "warnings=$WARN" | Add-Content $env:GITHUB_OUTPUT
}

if ($FAIL -gt 0) {
    Write-Host ""
    Write-Host "❌ VALIDATION FAILED — $FAIL issue(s) must be fixed."
    if ($env:GITHUB_OUTPUT) { "result=fail" | Add-Content $env:GITHUB_OUTPUT }
    exit 1
} elseif ($WARN -gt 0 -and $FailOnWarnings -eq "true") {
    Write-Host ""
    Write-Host "⚠️  VALIDATION FAILED (fail-on-warnings enabled) — $WARN warning(s)."
    if ($env:GITHUB_OUTPUT) { "result=fail" | Add-Content $env:GITHUB_OUTPUT }
    exit 1
} elseif ($WARN -gt 0) {
    Write-Host ""
    Write-Host "⚠️  Passed with $WARN warning(s)."
    if ($env:GITHUB_OUTPUT) { "result=warn" | Add-Content $env:GITHUB_OUTPUT }
    exit 0
} else {
    Write-Host ""
    Write-Host "✅ All checks passed. Your forge is solid."
    if ($env:GITHUB_OUTPUT) { "result=pass" | Add-Content $env:GITHUB_OUTPUT }
    exit 0
}
