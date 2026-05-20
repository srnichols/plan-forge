#!/usr/bin/env bash
# sync-planning-to-master.sh — Sync planning/main → master, filtering forbidden paths.
# Run from repo root. Assumes planning/main is at the desired release HEAD.
set -uo pipefail

RELEASE_RANGE="v3.7.0..v3.9.2"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release-range) RELEASE_RANGE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# 1. Verify clean working tree, checkout master, pull
status=$(git status --porcelain)
if [[ -n "$status" ]]; then
    echo "Error: Working tree not clean. Aborting." >&2
    echo "$status" >&2
    exit 1
fi

echo -e "\033[36m=== checkout master + pull ===\033[0m"
git checkout master
git pull origin master
echo ""

# 2. Preserve master-only files that should NOT be wiped
echo -e "\033[36m=== preserving master-only files ===\033[0m"
declare -a MASTER_ONLY_KEEP=('.github/workflows/sync-master-to-planning.yml')
declare -A SAVED=()
for f in "${MASTER_ONLY_KEEP[@]}"; do
    if [[ -f "$f" ]]; then
        SAVED["$f"]=$(cat "$f")
        echo "  saved $f ($(wc -c < "$f") bytes)"
    fi
done
echo ""

# 3. Reset working tree + index to planning/main's tree (preserves HEAD ref)
echo -e "\033[36m=== read-tree planning/main onto master ===\033[0m"
git read-tree --reset -u planning/main
echo ""

# 4. Restore the master-only files
echo -e "\033[36m=== restoring master-only files ===\033[0m"
for f in "${MASTER_ONLY_KEEP[@]}"; do
    if [[ -v "SAVED[$f]" ]]; then
        dir="$(dirname "$f")"
        [[ -n "$dir" && "$dir" != "." ]] && mkdir -p "$dir"
        printf '%s' "${SAVED[$f]}" > "$f"
        git add "$f"
        echo "  restored $f"
    fi
done
echo ""

# 5. Remove forbidden paths
echo -e "\033[36m=== removing forbidden paths ===\033[0m"
declare -a FORBIDDEN_FILES=(
    'AGENTS.md'
    '.github/instructions/project-principles.instructions.md'
    'docs/plans/DEPLOYMENT-ROADMAP.md'
    'docs/plans/PROJECT-PRINCIPLES.md'
)
for f in "${FORBIDDEN_FILES[@]}"; do
    if [[ -f "$f" ]]; then
        git rm -f "$f" | true
        echo "  rm $f"
    fi
done

declare -a FORBIDDEN_DIRS=(
    'docs/plans/archive'
    'docs/plans/cleanup-findings'
)
for d in "${FORBIDDEN_DIRS[@]}"; do
    if [[ -d "$d" ]]; then
        git rm -rf "$d" | true
        echo "  rm -rf $d/"
    fi
done

# Phase-*-PLAN.md files at docs/plans/ root (NOT under examples/)
while IFS= read -r -d '' plan; do
    git rm -f "$plan" | true
    echo "  rm $(basename "$plan")"
done < <(find docs/plans -maxdepth 1 -name "Phase-*-PLAN.md" -type f -print0 2>/dev/null)
echo ""

# 6. Verify
echo -e "\033[36m=== verification ===\033[0m"
declare -A CHECKS=(
    ["AGENTS.md"]="absent"
    ["docs/plans/PROJECT-PRINCIPLES.md"]="absent"
    ["docs/plans/DEPLOYMENT-ROADMAP.md"]="absent"
    ["docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md"]="present"
    [".github/workflows/sync-master-to-planning.yml"]="present"
    ["VERSION"]="present"
)
for path in "${!CHECKS[@]}"; do
    should="${CHECKS[$path]}"
    if [[ -e "$path" ]]; then
        actual="present"
    else
        actual="absent"
    fi
    if [[ "$actual" == "$should" ]]; then
        marker="OK "
    else
        marker="FAIL"
    fi
    echo "  [$marker] $path ($should, actual=$actual)"
done

ver=$(cat VERSION 2>/dev/null | tr -d '[:space:]')
echo "  VERSION reads: $ver"
stale_count=$(find docs/plans -maxdepth 1 -name "Phase-*-PLAN.md" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "  docs/plans/Phase-*-PLAN.md (root): $stale_count"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "\033[33m=== DRY RUN — not committing ===\033[0m"
    echo "Staged stats:"
    git diff --cached --stat | tail -5
    echo ""
    echo "To commit: re-run without --dry-run"
    exit 0
fi

echo -e "\033[36m=== creating release sync commit ===\033[0m"
git commit -m "chore(release): sync $RELEASE_RANGE from planning/main

Brings master to v3.9.2 (Latest), backfilling v3.8.0, v3.8.1, v3.9.0, v3.9.1
along the way. All five GitHub Releases were cut at their respective release
commits on planning/main. This commit collapses the planning/main tree into
master with forbidden dev-only paths filtered out.

Filtered:
- AGENTS.md (planning/main-only per its preamble)
- docs/plans/Phase-*-PLAN.md (phase plans are dev artifacts)
- docs/plans/{archive,cleanup-findings}/ (dev artifacts)
- docs/plans/{PROJECT-PRINCIPLES,DEPLOYMENT-ROADMAP}.md (planning/main-only)
- .github/instructions/project-principles.instructions.md (ships from templates/)

Preserved master-only:
- .github/workflows/sync-master-to-planning.yml (master->planning sync workflow)"
echo ""
git log --oneline -3
