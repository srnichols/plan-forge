<#
.SYNOPSIS
    Plan Forge — Diff-Classify PreCommit chain entry
    Classifies the staged diff against security/safety categories.
    Returns { "blocked": true, "message": "..." } on severity >= high or an unreadable diff,
    { "blocked": false, "advisory": "..." } on medium, {} on low/none.
    The logic lives in check-diff-classify.mjs: Node reads the staged diff itself,
    because passing it through an environment variable lost its line breaks and
    failed on large diffs.
#>
& node (Join-Path $PSScriptRoot 'check-diff-classify.mjs')
exit $LASTEXITCODE
