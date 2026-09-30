<#
.SYNOPSIS
    Plan Forge — PostToolUse Hook
    Scans edited files for deferred-work markers (TODO, FIXME, stub, etc.)
    and warns during execution rather than waiting for the Completeness Sweep.
#>
$ErrorActionPreference = 'SilentlyContinue'

# Not $input: that is PowerShell's automatic pipeline enumerator, and the next
# native command (git) emptied it, so every payload check below saw nothing (meta-bug #287).
$hookInput = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }

$toolName = if ($hookInput -match '"tool_name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$filePath = if ($hookInput -match '"filePath"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }

# Only check after file-editing tools
$editTools = @('editFiles', 'create_file', 'replace_string_in_file', 'insert_edit_into_file', 'multi_replace_string_in_file')
if ($toolName -notin $editTools) {
    Write-Output "{}"
    exit 0
}

if (-not $filePath -or -not (Test-Path $filePath)) {
    Write-Output "{}"
    exit 0
}

# Skip non-code files
$skipExtensions = @('.md', '.json', '.yml', '.yaml', '.xml', '.txt', '.csv')
$ext = [System.IO.Path]::GetExtension($filePath)
if ($ext -in $skipExtensions) {
    Write-Output "{}"
    exit 0
}

# Scan for deferred-work markers
$markers = Select-String -Path $filePath -Pattern 'TODO|HACK|FIXME|will be replaced|placeholder|stub|mock data|Simulate|Seed with sample' -CaseSensitive:$false | Select-Object -First 5

if ($markers) {
    $findings = ($markers | ForEach-Object { "Line $($_.LineNumber): $($_.Line.Trim())" }) -join '; '
    $escaped = $findings -replace '"', '\"' -replace "`n", '\n' -replace "`r", ''
    Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"PostToolUse`",`"additionalContext`":`"WARNING: Deferred-work markers found in edited file. These must be resolved before the Completeness Sweep (Step 4): $escaped`"}}"
} else {
    Write-Output "{}"
}
