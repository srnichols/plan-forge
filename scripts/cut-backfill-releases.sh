#!/usr/bin/env bash
# cut-backfill-releases.sh — Cut GH releases for backfilled versions
# Creates releases for v3.8.0, v3.8.1, v3.9.0, v3.9.1 (not Latest)
# and v3.9.2 (marked Latest).
# Usage: bash scripts/cut-backfill-releases.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A TITLES=(
    ["3.8.0"]="v3.8.0 - Auditor Automation & Observer (Phase-39)"
    ["3.8.1"]="v3.8.1 - forge-home orphan whitelist + cleanup CLI (Issue #203)"
    ["3.9.0"]="v3.9.0 - Embedding Status & Persistent TF-IDF Cache (Phase 56)"
    ["3.9.1"]="v3.9.1 - Local Recall Index Status (Phase 58)"
    ["3.9.2"]="v3.9.2 - Distribution Enumeration Fix"
)

new_release() {
    local version="$1"
    local latest="$2"   # "true" or "false"

    local notes
    notes=$(bash "$SCRIPT_DIR/extract-changelog-section.sh" "$version")

    local tmp
    tmp=$(mktemp --suffix=.md)
    printf '%s\n' "$notes" > "$tmp"

    local latest_flag
    if [[ "$latest" == "true" ]]; then
        latest_flag="--latest"
    else
        latest_flag="--latest=false"
    fi

    echo "=== creating v${version} (Latest=${latest}) ==="
    gh release create "v${version}" \
        --title "${TITLES[$version]}" \
        --notes-file "$tmp" \
        --verify-tag \
        $latest_flag 2>&1
    rm -f "$tmp"
    echo ""
}

for v in 3.8.0 3.8.1 3.9.0 3.9.1; do
    new_release "$v" "false"
done
new_release "3.9.2" "true"
