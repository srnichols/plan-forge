<#
.SYNOPSIS
    Plan Forge — Stop Hook: Test Reminder
    When the session ends, warns if code was modified but tests weren't run.
#>
$ErrorActionPreference = 'SilentlyContinue'

$input = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

# Check if re-entry (prevent infinite loop)
if ($input -match '"stop_hook_active"\s*:\s*true') {
    Write-Output "{}"
    exit 0
}

# Check for uncommitted code changes
$changedCode = git diff --name-only 2>$null |
    Where-Object { $_ -notmatch '\.(md|json|yml|yaml|txt|csv)$' } |
    Select-Object -First 5

if (-not $changedCode) {
    Write-Output "{}"
    exit 0
}

# Check transcript for test execution
$testsRan = $false
if ($input -match '"transcript_path"\s*:\s*"([^"]+)"') {
    $transcriptPath = $Matches[1]
    if (Test-Path $transcriptPath) {
        $transcript = Get-Content $transcriptPath -Raw
        if ($transcript -match 'dotnet test|pnpm test|pytest|go test|gradle test|test-sweep') {
            $testsRan = $true
        }
    }
}

if ($testsRan) {
    Write-Output "{}"
    exit 0
}

# Warn
$warnings = @()
$warnings += "WARNING: Code files were modified but no test run was detected in this session. Consider running /test-sweep before ending to catch regressions."

# Remind to capture decisions to OpenBrain if configured
$mcpJson = Join-Path $repoRoot ".vscode/mcp.json"
if (Test-Path $mcpJson) {
    $mcpContent = Get-Content $mcpJson -Raw
    if ($mcpContent -match 'openbrain') {
        $warnings += "OPENBRAIN REMINDER: Code was modified in this session. Before ending, capture key decisions and outcomes with capture_thought() so the next session has full context."
    }
}

$joined = $warnings -join ' '
Write-Output "{`"systemMessage`":`"$joined`"}"
