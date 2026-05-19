<#
.SYNOPSIS
    Plan Forge — PreCommit chain: diff-classify

    Classifies staged git changes by category (plan, test, docs, config, chore,
    scope, unknown) and reports a summary. Advisory-only — never blocks commits.

    Output: JSON { blocked: false, advisory: "...", classification: { ... } }
#>
$ErrorActionPreference = 'SilentlyContinue'

# Get staged file list
$staged = git diff --staged --name-only 2>$null
if (-not $staged) {
    Write-Output '{"blocked":false,"advisory":"No staged changes detected.","classification":{"files":[],"summary":{},"total":0}}'
    exit 0
}

$files = @($staged | Where-Object { $_ -ne "" })

if ($files.Count -eq 0) {
    Write-Output '{"blocked":false,"advisory":"No staged changes detected.","classification":{"files":[],"summary":{},"total":0}}'
    exit 0
}

$counts = @{ plan = 0; test = 0; docs = 0; config = 0; chore = 0; scope = 0; unknown = 0 }
$fileEntries = @()

foreach ($file in $files) {
    $category = "unknown"

    if ($file -match '^docs/plans/') {
        $category = "plan"
    } elseif ($file -match '\.(test|spec)\.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb)$' -or
              $file -match '/__tests__/' -or
              $file -match '(^|/)tests/') {
        $category = "test"
    } elseif ($file -match '\.(md|mdx|txt|rst|adoc)$' -or
              ($file -match '^docs/' -and $file -notmatch '^docs/plans/')) {
        $category = "docs"
    } elseif ($file -match '(^|/)(\.env[^/]*|Dockerfile[^/]*|docker-compose[^/]*)$' -or
              $file -match '^\.github/' -or
              $file -match '^\.vscode/' -or
              $file -match '^\.forge\.json$' -or
              $file -match '^\.forge/' -or
              $file -match '(^|/)(tsconfig|jest\.config|vitest\.config|eslint|prettier|babel\.config)[^/]*$') {
        $category = "config"
    } elseif ($file -match '(^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Makefile)$' -or
              $file -match '\.(sh|ps1)$') {
        $category = "chore"
    } elseif ($file -match '\.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb|rs|cpp|c|h|hpp|swift|kt)$') {
        $category = "scope"
    }

    $counts[$category]++
    $fileEntries += "{`"file`":`"$($file -replace '\\', '/')`",`"category`":`"$category`"}"
}

$total = ($counts.Values | Measure-Object -Sum).Sum

# Build summary JSON (omit zero-count categories)
$summaryParts = @()
foreach ($cat in @('plan','test','docs','config','chore','scope','unknown')) {
    if ($counts[$cat] -gt 0) {
        $summaryParts += "`"$cat`":$($counts[$cat])"
    }
}
$summaryJson = "{$($summaryParts -join ',')}"

# Build advisory text
$advisoryParts = @()
foreach ($cat in @('plan','test','docs','config','chore','scope','unknown')) {
    if ($counts[$cat] -gt 0) {
        $advisoryParts += "$cat`: $($counts[$cat])"
    }
}
$advisory = "Staged diff: $total file(s) — $($advisoryParts -join ', ')"
$advisoryEscaped = $advisory -replace '"', '\"'

$filesJson = "[$($fileEntries -join ',')]"

Write-Output "{`"blocked`":false,`"advisory`":`"$advisoryEscaped`",`"classification`":{`"files`":$filesJson,`"summary`":$summaryJson,`"total`":$total}}"
