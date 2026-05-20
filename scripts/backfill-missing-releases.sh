#!/usr/bin/env bash
# backfill-missing-releases.sh — Backfill missing GitHub tags + Releases
# for versions shipped to master without following the release checklist.
#
# Idempotent: skips any version where the tag OR release already exists.
# Run from repo root.
#
# Usage:
#   bash scripts/backfill-missing-releases.sh               # process all
#   bash scripts/backfill-missing-releases.sh --only v2.95.0  # one version
#   bash scripts/backfill-missing-releases.sh --dry-run     # show actions, do nothing
set -uo pipefail

ONLY=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --only) ONLY="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# (version, sha) pairs in chronological order
declare -a VERSIONS=(
    v2.95.0 v2.96.0 v2.96.1 v2.96.2 v2.96.3 v2.96.4
    v2.98.0 v2.99.0 v2.99.1
    v3.0.0 v3.0.1 v3.1.0 v3.1.1 v3.1.2
    v3.2.0 v3.2.1 v3.3.0 v3.3.1 v3.4.0
)
declare -A SHAS=(
    [v2.95.0]=e6eb6685d2  [v2.96.0]=fe7a2e7092  [v2.96.1]=9211c9370d
    [v2.96.2]=d6405c10d9  [v2.96.3]=b284b6dabd  [v2.96.4]=c22386a5b1
    [v2.98.0]=657f56495e  [v2.99.0]=277d8ed109  [v2.99.1]=67a54dbe42
    [v3.0.0]=97aa9871bc   [v3.0.1]=53cc1cfbf6   [v3.1.0]=4a469e31c5
    [v3.1.1]=c68230b717   [v3.1.2]=a7a5ef05c6   [v3.2.0]=6c15162f54
    [v3.2.1]=3cbcc4c6c5   [v3.3.0]=54b77d8      [v3.3.1]=5e58b3a
    [v3.4.0]=5c8c8bd
)

extract_changelog_section() {
    local version_numeric="$1"
    bash "$SCRIPT_DIR/extract-changelog-section.sh" "$version_numeric" CHANGELOG.md 2>/dev/null || echo ""
}

get_title() {
    local section="$1"
    local first_line
    first_line=$(echo "$section" | head -1)
    # "## [3.2.0] — 2026-05-17" -> "v3.2.0 — 2026-05-17"
    if [[ "$first_line" =~ ^\#\#[[:space:]]+\[([^]]+)\](.*)$ ]]; then
        local v="${BASH_REMATCH[1]}"
        local rest
        rest=$(echo "${BASH_REMATCH[2]}" | sed 's/^[[:space:]]*//')
        if [[ -n "$rest" ]]; then
            echo "v$v $rest"
        else
            echo "v$v"
        fi
    else
        echo "$first_line"
    fi
}

declare -a results=()

for tag in "${VERSIONS[@]}"; do
    sha="${SHAS[$tag]}"
    numeric="${tag#v}"

    if [[ -n "$ONLY" && "$ONLY" != "$tag" ]]; then
        continue
    fi

    echo ""
    echo -e "\033[36m=== $tag @ $sha ===\033[0m"

    # Verify SHA points at a commit with matching clean VERSION
    version_at_sha=$(git show "${sha}:VERSION" 2>/dev/null | tr -d '[:space:]' || echo "")
    if [[ "$version_at_sha" != "$numeric" ]]; then
        echo -e "\033[31m  SKIP: SHA $sha has VERSION='$version_at_sha', expected '$numeric'\033[0m"
        results+=("$tag: sha-mismatch (VERSION=$version_at_sha)")
        continue
    fi
    echo "  VERSION at SHA: OK ($version_at_sha)"

    # Tag existence
    tag_exists=$(git tag -l "$tag")
    if [[ -n "$tag_exists" ]]; then
        echo -e "\033[33m  Tag $tag already exists locally\033[0m"
    else
        echo "  Tag ${tag}: WILL CREATE"
    fi

    # Release existence
    release_exists=false
    if gh release view "$tag" --repo srnichols/plan-forge >/dev/null 2>&1; then
        release_exists=true
        echo -e "\033[33m  Release $tag already exists on GitHub\033[0m"
    else
        echo "  Release ${tag}: WILL CREATE"
    fi

    if [[ -n "$tag_exists" && "$release_exists" == "true" ]]; then
        results+=("$tag: already-done")
        continue
    fi

    # Extract notes
    section=$(extract_changelog_section "$numeric")
    if [[ -z "$section" ]]; then
        echo -e "\033[31m  SKIP: no CHANGELOG section for [$numeric]\033[0m"
        results+=("$tag: no-changelog")
        continue
    fi
    title=$(get_title "$section")

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  DRY-RUN: title='$title'"
        echo "  DRY-RUN: notes-bytes=${#section}"
        results+=("$tag: dry-run")
        continue
    fi

    # Write notes to temp file
    notes_file=$(mktemp --suffix=.md)
    printf '%s' "$section" > "$notes_file"
    today=$(date +%Y-%m-%d)

    if [[ -z "$tag_exists" ]]; then
        echo "  Creating tag..."
        git tag -a "$tag" "$sha" -m "$title (backfilled $today)"
        git push origin "$tag"
    fi

    if [[ "$release_exists" == "false" ]]; then
        echo "  Creating GitHub Release..."
        gh release create "$tag" \
            --repo srnichols/plan-forge \
            --title "$title" \
            --notes-file "$notes_file" \
            --verify-tag
    fi

    rm -f "$notes_file"
    results+=("$tag: ok")
    echo -e "\033[32m  DONE\033[0m"
done

echo ""
echo "=== SUMMARY ==="
for r in "${results[@]}"; do
    echo "  $r"
done
