#!/usr/bin/env bash
#
# Maintainer-only. Syncs consumer-visible code between planning/main and master.
#
# Automates the release-time branch dance documented in docs/RELEASE-CHECKLIST.md and
# AGENTS.md. Two directions:
#
#   to-master    Fast-forward master to planning/main, then scrub the dev-only superset
#                (phase plans, archive, cleanup-findings, AGENTS.md) in one commit.
#
#   to-planning  Merge master back into planning/main, then RESTORE the dev-only files
#                that master's scrub commit deletes.
#
# The restore step exists because `git merge master` fast-forwards planning/main straight
# through the scrub commit, silently deleting 70+ dev-only paths with no conflict to
# signal it. That happened seven times in a single release session before this script.
#
# Usage:
#   bash scripts/sync-master.sh to-master
#   # ...cut the release on master (version, tag, gh release, bump-back)...
#   bash scripts/sync-master.sh to-planning

set -euo pipefail

DIRECTION="${1:-}"
if [[ "$DIRECTION" != "to-master" && "$DIRECTION" != "to-planning" ]]; then
    echo "Usage: $0 <to-master|to-planning>" >&2
    exit 2
fi

# Single source of truth for what lives only on planning/main.
DEV_ONLY_PATHSPECS=(
    'docs/plans/Phase-*-PLAN.md'
    'docs/plans/archive'
    'docs/plans/cleanup-findings'
    'docs/plans/DEPLOYMENT-ROADMAP.md'
    'docs/plans/PROJECT-PRINCIPLES.md'
    'AGENTS.md'
)

# These LOOK dev-only but ship to consumers. Losing them is the failure mode a naive
# scrub pattern would cause, so the count is asserted before and after.
CONSUMER_PATHSPECS=(
    'presets/*/AGENTS.md'
    'templates/AGENTS.md.template'
    'docs/plans/*-TEMPLATE.md'
    'docs/plans/examples/*'
)

DEV_ONLY_REGEX='^(docs/plans/Phase-|docs/plans/archive/|docs/plans/cleanup-findings/|docs/plans/DEPLOYMENT-ROADMAP\.md$|docs/plans/PROJECT-PRINCIPLES\.md$|AGENTS\.md$)'

fail() { printf "\033[31m  ERROR  %s\033[0m\n" "$1" >&2; exit 1; }
ok()   { printf "\033[32m  OK  %s\033[0m\n" "$1"; }
info() { printf "  %s\n" "$1"; }

[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty — commit or stash first"

consumer_count_before="$(git ls-files "${CONSUMER_PATHSPECS[@]}" | wc -l | tr -d ' ')"

if [[ "$DIRECTION" == "to-master" ]]; then
    git checkout master >/dev/null 2>&1
    git merge --ff-only planning/main >/dev/null || fail "master could not fast-forward to planning/main"

    to_scrub="$(git ls-files "${DEV_ONLY_PATHSPECS[@]}")"
    scrub_count="$(printf '%s\n' "$to_scrub" | grep -c . || true)"
    info "dev-only paths to scrub: $scrub_count"

    caught="$(printf '%s\n' "$to_scrub" | grep -E 'presets/|templates/|examples/|-TEMPLATE\.md|-EXAMPLE\.md' || true)"
    [[ -z "$caught" ]] || fail "scrub pattern would delete consumer files: $caught"

    if [[ "$scrub_count" -eq 0 ]]; then info "nothing to scrub"; exit 0; fi

    git rm -r --quiet "${DEV_ONLY_PATHSPECS[@]}"
    consumer_count_after="$(git ls-files "${CONSUMER_PATHSPECS[@]}" | wc -l | tr -d ' ')"
    if [[ "$consumer_count_after" != "$consumer_count_before" ]]; then
        git reset --hard HEAD >/dev/null
        fail "consumer file count changed $consumer_count_before -> $consumer_count_after; scrub reverted"
    fi

    git commit -q -m "chore(master): scrub dev-only files post planning/main sync"
    ok "master synced and scrubbed ($scrub_count dev-only paths removed, $consumer_count_after consumer files intact)"
    info "next: cut the release on master, then re-run with to-planning"
else
    git checkout planning/main >/dev/null 2>&1
    pre_sync="$(git rev-parse HEAD)"
    info "pre-sync planning/main: ${pre_sync:0:7}"

    git merge master --no-edit >/dev/null || fail "merge from master failed — resolve manually"

    # What the merge actually removed, not what the scrub commit contains — so a
    # no-op merge correctly restores nothing instead of failing on an empty commit.
    deleted="$(git diff --diff-filter=D --name-only "$pre_sync" HEAD | grep . || true)"
    if [[ -z "$deleted" ]]; then ok "merge deleted nothing — planning/main intact"; exit 0; fi

    deleted_count="$(printf '%s\n' "$deleted" | grep -c .)"
    info "restoring $deleted_count dev-only paths from ${pre_sync:0:7}"
    while IFS= read -r f; do
        [[ -n "$f" ]] && git checkout "$pre_sync" -- "$f" 2>/dev/null || true
    done <<< "$deleted"
    git add -A >/dev/null

    # The superset invariant: planning/main may differ from master ONLY by dev-only paths.
    leaked="$(git diff --cached --name-only master | grep -Ev "$DEV_ONLY_REGEX" || true)"
    [[ -z "$leaked" ]] || fail "planning/main differs from master by non-dev-only files: $leaked"

    git commit -q -m "chore(planning): restore dev-only files after master sync"
    ok "planning/main restored ($deleted_count dev-only paths, 0 non-dev-only differences from master)"
fi

info "push when ready: git push origin $(git rev-parse --abbrev-ref HEAD)"
