<#
.SYNOPSIS
    Plan Forge — PreToolUse Hook
    Blocks file edits to paths listed in the active plan's Forbidden Actions section.
#>
$ErrorActionPreference = 'SilentlyContinue'

$input = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

# Parse tool name and file path from JSON input
$toolName = if ($input -match '"tool_name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$filePath = if ($input -match '"filePath"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }

# Only check file-editing tools
$editTools = @('editFiles', 'create_file', 'replace_string_in_file', 'insert_edit_into_file', 'multi_replace_string_in_file')
if ($toolName -notin $editTools) {
    Write-Output "{}"
    exit 0
}

if (-not $filePath) {
    Write-Output "{}"
    exit 0
}

# Find active plan
$activePlan = Get-ChildItem -Path (Join-Path $repoRoot "docs/plans") -Filter "*-PLAN.md" -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content $_.FullName -Raw) -match 'In Progress|HARDENED|Ready for execution' } |
    Select-Object -First 1

if (-not $activePlan) {
    Write-Output "{}"
    exit 0
}

# Extract Forbidden Actions section
$planContent = Get-Content $activePlan.FullName -Raw
$forbiddenMatch = [regex]::Match($planContent, '### Forbidden Actions(.*?)(?=^###?\s|\z)', [System.Text.RegularExpressions.RegexOptions]::Singleline -bor [System.Text.RegularExpressions.RegexOptions]::Multiline)

if (-not $forbiddenMatch.Success) {
    Write-Output "{}"
    exit 0
}

# Extract backtick-wrapped paths
$forbidden = $forbiddenMatch.Groups[1].Value
$paths = [regex]::Matches($forbidden, '`([^`]+)`') | ForEach-Object { $_.Groups[1].Value }

foreach ($fp in $paths) {
    if ($filePath -like "*$fp*") {
        $reason = "BLOCKED: '$filePath' matches Forbidden Action '$fp' in the active plan's Scope Contract. Modifying this path is not allowed."
        $escaped = $reason -replace '"', '\"'
        Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"PreToolUse`",`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$escaped`"}}"
        exit 0
    }
}

Write-Output "{}"
