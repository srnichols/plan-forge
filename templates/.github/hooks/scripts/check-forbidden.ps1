<#
.SYNOPSIS
    Plan Forge — PreToolUse Hook
    Blocks file edits to paths listed in the active plan's Forbidden Actions section.
    Twin of check-forbidden.sh; both follow the scope-hint contract of pforge.ps1
    Get-PlanSectionHints / Test-PlanPathHint (meta-bugs #286, #287).
#>
$ErrorActionPreference = 'SilentlyContinue'

# Not $input: that is PowerShell's automatic pipeline enumerator, and the next
# native command (git) emptied it, so every payload check below saw nothing (meta-bug #287).
$hookInput = [Console]::In.ReadToEnd()
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = "." }
$repoPrefix = ($repoRoot -replace '\\', '/').TrimEnd('/') + '/'

# Parse tool name and file path from JSON input
$toolName = if ($hookInput -match '"tool_name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$filePath = if ($hookInput -match '"filePath"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }

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

# "in-progress" or "ready" when the plan's FIRST status line starts with
# In Progress, or with HARDENED / Ready for execution; '' otherwise.
function Get-PlanStatusTier([string]$Content) {
    $status = [regex]::Match($Content, '(?im)^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*Status\*\*|\*\*Status:|status:)[^\r\n]*')
    if (-not $status.Success) { return '' }
    $value = ($status.Value -replace '^[^:]*:', '') -replace '^[^A-Za-z0-9]+', ''
    if ($value -match '^in[ -]progress(?![A-Za-z0-9_])') { return 'in-progress' }
    if ($value -match '^(?:hardened|ready for execution)(?![A-Za-z0-9_])') { return 'ready' }
    return ''
}

# Resolve the plan whose Forbidden Actions apply: an explicit .forge/active-plan
# pointer, else the only plan In Progress, else the only plan HARDENED / Ready
# for execution. Several plans in the deciding tier are ambiguous — taking the
# first by name enforced a stale plan's rules on unrelated edits — so nothing
# is enforced then.
$activePlan = $null
$pointer = Join-Path $repoRoot ".forge/active-plan"
if (Test-Path -LiteralPath $pointer -PathType Leaf) {
    $pointed = Get-Content -LiteralPath $pointer -TotalCount 1
    if ($pointed -and $pointed.Trim()) {
        $candidate = Join-Path $repoRoot $pointed.Trim()
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $activePlan = $candidate }
    }
}
if (-not $activePlan) {
    $inProgress = @()
    $ready = @()
    foreach ($plan in Get-ChildItem -LiteralPath (Join-Path $repoRoot "docs/plans") -Filter "*-PLAN.md" -File -ErrorAction SilentlyContinue) {
        switch (Get-PlanStatusTier (Get-Content -LiteralPath $plan.FullName -Raw)) {
            'in-progress' { $inProgress += $plan.FullName }
            'ready' { $ready += $plan.FullName }
        }
    }
    if ($inProgress.Count -eq 1) { $activePlan = $inProgress[0] }
    elseif ($inProgress.Count -eq 0 -and $ready.Count -eq 1) { $activePlan = $ready[0] }
}

# No single active plan — allow everything
if (-not $activePlan) {
    Write-Output "{}"
    exit 0
}

# Forbidden Actions hints, each section stopping at the next heading. Only
# single-token hints with a letter or digit can name a path; prose such as
# "git push --force" is ignored.
$planContent = Get-Content -LiteralPath $activePlan -Raw
$sectionPattern = '(?m)^#{2,6}[ \t]+Forbidden Actions(?!\w)[^\n]*\n([\s\S]*?)(?=^#{2,6}[ \t]|\z)'
$paths = @()
foreach ($section in [regex]::Matches($planContent, $sectionPattern)) {
    foreach ($token in [regex]::Matches($section.Groups[1].Value, '`([^`\r\n]+)`')) {
        $hint = $token.Groups[1].Value.Trim()
        if ($hint -match '[A-Za-z0-9]' -and $hint -notmatch '\s') { $paths += $hint }
    }
}

# Match the repo-relative path: JSON-escaped Windows separators become "/",
# and the repository root is stripped so a hint cannot match a parent folder.
$normalizedPath = $filePath -replace '\\\\', '/' -replace '\\', '/'
if ($normalizedPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalizedPath = $normalizedPath.Substring($repoPrefix.Length)
}
$planRel = $activePlan -replace '\\', '/'
if ($planRel.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $planRel = $planRel.Substring($repoPrefix.Length)
}

foreach ($fp in $paths) {
    # "*" is the only wildcard; a bare word matches only a whole path segment.
    $hint = $fp -replace '\\', '/'
    if ($hint -match '^[A-Za-z0-9_-]+$') {
        $pattern = '(^|/)' + $hint + '($|/)'
    } else {
        $pattern = [regex]::Escape($hint) -replace '\\\*', '.*'
    }
    if ([regex]::IsMatch($normalizedPath, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        # $filePath is still JSON-escaped from the payload; the hint and plan path are not.
        $hintJson = $fp -replace '\\', '\\' -replace '"', '\"'
        $planJson = $planRel -replace '\\', '\\' -replace '"', '\"'
        $reason = "BLOCKED: '$filePath' matches Forbidden Action '$hintJson' in the active plan ($planJson). Modifying this path is not allowed."
        Write-Output "{`"hookSpecificOutput`":{`"hookEventName`":`"PreToolUse`",`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}}"
        exit 0
    }
}

Write-Output "{}"
