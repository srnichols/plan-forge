<#
.SYNOPSIS
    Maintainer-only. Syncs consumer-visible code between planning/main and master.

.DESCRIPTION
    Automates the release-time branch dance documented in docs/RELEASE-CHECKLIST.md and
    AGENTS.md. Two directions:

      to-master    Fast-forward master to planning/main, then scrub the dev-only superset
                   (phase plans, archive, cleanup-findings, AGENTS.md) in one commit.

      to-planning  Merge master back into planning/main, then RESTORE the dev-only files
                   that master's scrub commit deletes.

    The restore step exists because `git merge master` fast-forwards planning/main straight
    through the scrub commit, silently deleting 70+ dev-only paths with no conflict to
    signal it. That happened seven times in a single release session before this script.

.PARAMETER Direction
    'to-master' or 'to-planning'.

.EXAMPLE
    pwsh scripts/sync-master.ps1 -Direction to-master
    # ...cut the release on master (version, tag, gh release, bump-back)...
    pwsh scripts/sync-master.ps1 -Direction to-planning
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('to-master', 'to-planning')]
    [string]$Direction
)

$ErrorActionPreference = 'Stop'

# Single source of truth for what lives only on planning/main.
$devOnlyPathspecs = @(
    'docs/plans/Phase-*-PLAN.md',
    'docs/plans/archive',
    'docs/plans/cleanup-findings',
    'docs/plans/DEPLOYMENT-ROADMAP.md',
    'docs/plans/PROJECT-PRINCIPLES.md',
    'AGENTS.md'
)

# These LOOK dev-only but ship to consumers. Losing them is the failure mode a naive
# scrub pattern would cause, so the count is asserted before and after.
$consumerPathspecs = @(
    'presets/*/AGENTS.md',
    'templates/AGENTS.md.template',
    'docs/plans/*-TEMPLATE.md',
    'docs/plans/examples/*'
)

function Fail($msg) { Write-Host "  ERROR  $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

if ((git status --porcelain)) { Fail "working tree is dirty — commit or stash first" }

$consumerCountBefore = @(git ls-files @consumerPathspecs).Count

if ($Direction -eq 'to-master') {
    git checkout master | Out-Null
    git merge --ff-only planning/main | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "master could not fast-forward to planning/main" }

    $toScrub = @(git ls-files @devOnlyPathspecs)
    Info "dev-only paths to scrub: $($toScrub.Count)"

    $caught = @($toScrub | Where-Object { $_ -match 'presets/|templates/|examples/|-TEMPLATE\.md|-EXAMPLE\.md' })
    if ($caught.Count -gt 0) { Fail "scrub pattern would delete consumer files: $($caught -join ', ')" }

    if ($toScrub.Count -eq 0) { Info "nothing to scrub"; exit 0 }

    git rm -r --quiet @devOnlyPathspecs
    $consumerCountAfter = @(git ls-files @consumerPathspecs).Count
    if ($consumerCountAfter -ne $consumerCountBefore) {
        git reset --hard HEAD | Out-Null
        Fail "consumer file count changed $consumerCountBefore -> $consumerCountAfter; scrub reverted"
    }

    git commit -q -m "chore(master): scrub dev-only files post planning/main sync"
    Ok "master synced and scrubbed ($($toScrub.Count) dev-only paths removed, $consumerCountAfter consumer files intact)"
    Info "next: cut the release on master, then re-run with -Direction to-planning"
}
else {
    git checkout planning/main | Out-Null
    $preSync = (git rev-parse HEAD).Trim()
    Info "pre-sync planning/main: $($preSync.Substring(0,7))"

    git merge master --no-edit | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "merge from master failed — resolve manually" }

    # What the merge actually removed, not what the scrub commit contains — so a
    # no-op merge correctly restores nothing instead of failing on an empty commit.
    $deleted = @(git diff --diff-filter=D --name-only $preSync HEAD | Where-Object { $_.Trim() })
    if ($deleted.Count -eq 0) { Ok "merge deleted nothing — planning/main intact"; exit 0 }

    Info "restoring $($deleted.Count) dev-only paths from $($preSync.Substring(0,7))"
    foreach ($f in $deleted) { git checkout $preSync -- $f 2>$null }
    git add -A | Out-Null

    # The superset invariant: planning/main may differ from master ONLY by dev-only paths.
    $devOnlyRegex = '^(docs/plans/Phase-|docs/plans/archive/|docs/plans/cleanup-findings/|docs/plans/DEPLOYMENT-ROADMAP\.md$|docs/plans/PROJECT-PRINCIPLES\.md$|AGENTS\.md$)'
    $leaked = @(git diff --cached --name-only master | Where-Object { $_ -notmatch $devOnlyRegex })
    if ($leaked.Count -gt 0) { Fail "planning/main differs from master by non-dev-only files: $($leaked -join ', ')" }

    git commit -q -m "chore(planning): restore dev-only files after master sync"
    Ok "planning/main restored ($($deleted.Count) dev-only paths, 0 non-dev-only differences from master)"
}

Info "push when ready: git push origin $(git rev-parse --abbrev-ref HEAD)"
