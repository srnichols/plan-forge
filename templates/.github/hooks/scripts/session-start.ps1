<#
.SYNOPSIS
    Plan Forge — SessionStart Hook
    Injects Project Principles and current phase context into every agent session.
#>
$ErrorActionPreference = 'SilentlyContinue'

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

$contextParts = @()

# Inject Project Principles summary
$ppFile = Join-Path $repoRoot "docs/plans/PROJECT-PRINCIPLES.md"
if (Test-Path $ppFile) {
    $content = Get-Content $ppFile -Raw
    $principles = ($content | Select-String '^\|\s*\d+\s*\|' -AllMatches).Matches.Value | Select-Object -First 7
    if ($principles) {
        $contextParts += "PROJECT PRINCIPLES (non-negotiable): $($principles -join ' ')"
    }
    # Extract forbidden patterns section
    $forbidden = ($content -split '## Forbidden Patterns')[1]
    if ($forbidden) {
        $forbiddenRows = ($forbidden | Select-String '^\|\s*\d+\s*\|' -AllMatches).Matches.Value | Select-Object -First 5
        if ($forbiddenRows) {
            $contextParts += "FORBIDDEN PATTERNS: $($forbiddenRows -join ' ')"
        }
    }
}

# Inject current phase from roadmap
$roadmap = Join-Path $repoRoot "docs/plans/DEPLOYMENT-ROADMAP.md"
if (Test-Path $roadmap) {
    $lines = Get-Content $roadmap
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'In Progress') {
            for ($j = $i; $j -ge 0; $j--) {
                if ($lines[$j] -match '^### Phase') {
                    $contextParts += "CURRENT PHASE: $($lines[$j])"
                    break
                }
            }
            break
        }
    }
}

# Inject forge version
$forgeJson = Join-Path $repoRoot ".forge.json"
if (Test-Path $forgeJson) {
    $config = Get-Content $forgeJson -Raw | ConvertFrom-Json
    if ($config.templateVersion) {
        $contextParts += "Plan Forge v$($config.templateVersion) ($($config.preset) preset)"
    }
}

# Inject OpenBrain reminder if MCP is configured
$mcpJson = Join-Path $repoRoot ".vscode/mcp.json"
if (Test-Path $mcpJson) {
    $mcpContent = Get-Content $mcpJson -Raw
    if ($mcpContent -match 'openbrain') {
        $obReminder = "OPENBRAIN MEMORY: OpenBrain MCP is configured. BEFORE starting work, search for prior decisions and lessons: search_thoughts('<current task topic>', project: '<project-name>'). AFTER completing work, capture key decisions."
        if ($contextParts.Count -gt 0 -and $contextParts[-1] -match 'CURRENT PHASE:\s*### Phase \d+') {
            $phaseTopic = $contextParts[-1] -replace 'CURRENT PHASE:\s*### Phase \d+[:\s]*', ''
            $obReminder = "OPENBRAIN MEMORY: OpenBrain MCP is configured. BEFORE starting work, run: search_thoughts('$phaseTopic', project: '<project-name>') to load prior decisions, patterns, and lessons. AFTER completing work, capture key decisions with capture_thought()."
        }
        $contextParts += $obReminder
    }
}

# Output
if ($contextParts.Count -gt 0) {
    $joined = $contextParts -join "`n"
    $escaped = $joined -replace '"', '\"' -replace "`n", '\n' -replace "`r", ''
    Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"SessionStart`",`"additionalContext`":`"$escaped`"}}"
} else {
    Write-Output "{}"
}
