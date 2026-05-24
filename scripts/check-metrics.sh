#!/usr/bin/env bash
# check-metrics.sh — Metrics drift detector
# ----------------------------------------------------------------------------
# Scans documentation surfaces for stale aliases defined in docs/_metrics.json.
# Does NOT modify files. Prints a report of any drift found.
#
# Usage:
#   bash scripts/check-metrics.sh
#   bash scripts/check-metrics.sh --strict   # exit 1 on any drift (for CI)
set -uo pipefail

STRICT=false
for arg in "$@"; do
    case "$arg" in
        --strict|-strict) STRICT=true ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

METRICS_PATH="$REPO_ROOT/docs/_metrics.json"
if [[ ! -f "$METRICS_PATH" ]]; then
    echo "Error: docs/_metrics.json not found at $METRICS_PATH" >&2
    exit 2
fi

# Parse JSON with node (no jq dependency)
read_json() {
    node -e "const d=require('$METRICS_PATH'); console.log($1 ?? '')" 2>/dev/null || echo ""
}

read_json_array() {
    node -e "const d=require('$METRICS_PATH'); const v=$1; (Array.isArray(v)?v:[]).forEach(x=>console.log(x))" 2>/dev/null || true
}

# Collect scan targets
TARGETS=()
while IFS= read -r -d '' f; do
    fname="$(basename "$f")"
    [[ "$fname" == "_metrics.json" ]] && continue
    [[ "$fname" == "CHANGELOG.md" ]] && continue
    # V3-CAPABILITY-AUDIT.md is a forensic snapshot that intentionally
    # mentions old MCP-tool counts alongside corrected values.
    [[ "$fname" == "V3-CAPABILITY-AUDIT.md" ]] && continue
    TARGETS+=("$f")
done < <(find "$REPO_ROOT" \
    \( -path "$REPO_ROOT/docs/plans" -prune \) -o \
    \( -path "$REPO_ROOT/docs/blog" -o -path "$REPO_ROOT/docs/manual" -o -path "$REPO_ROOT/docs" \) \
    \( -name "*.html" -o -name "*.md" \) -not -name "CHANGELOG.md" -not -name "_metrics.json" -not -name "V3-CAPABILITY-AUDIT.md" \
    -type f -print0 2>/dev/null)

# Also add root README.md
[[ -f "$REPO_ROOT/README.md" ]] && TARGETS+=("$REPO_ROOT/README.md")

echo "Scanning ${#TARGETS[@]} files for stale metric aliases..."
echo ""

FINDINGS=0

check_pattern() {
    local category="$1"
    local alias_val="$2"
    local pattern="$3"

    for target in "${TARGETS[@]}"; do
        while IFS= read -r match; do
            local rel_path="${target#$REPO_ROOT/}"
            local lineno
            lineno=$(echo "$match" | cut -d: -f1)
            local text
            text=$(echo "$match" | cut -d: -f2-)
            printf '  %s:%s\n' "$rel_path" "$lineno"
            printf '    stale value: %s\n' "$alias_val"
            printf '    text       : %s\n' "$text"
            echo ""
            FINDINGS=$((FINDINGS + 1))
        done < <(grep -niP "$pattern" "$target" 2>/dev/null | head -20 || true)
    done
}

# MCP tools aliases
echo "Checking MCP tools aliases..."
while IFS= read -r alias; do
    [[ -z "$alias" ]] && continue
    for pat in "${alias} MCP tool" "${alias} tools \(" "\(${alias} tools\)" "all ${alias} tools"; do
        for target in "${TARGETS[@]}"; do
            while IFS= read -r match; do
                [[ -z "$match" ]] && continue
                rel="${target#$REPO_ROOT/}"
                lineno=$(echo "$match" | cut -d: -f1)
                text=$(echo "$match" | cut -d: -f2-)
                printf '--- MCP tools ---\n  %s:%s\n    stale value: %s\n    text       : %s\n\n' "$rel" "$lineno" "$alias" "$text"
                FINDINGS=$((FINDINGS + 1))
            done < <(grep -niF "$pat" "$target" 2>/dev/null || true)
        done
    done
done < <(read_json_array "d._knownStaleAliases.mcpTools")

# Dashboard tabs
while IFS= read -r alias; do
    [[ -z "$alias" ]] && continue
    for pat in "${alias} tabs" "${alias} real-time tabs" "with ${alias} tabs"; do
        for target in "${TARGETS[@]}"; do
            while IFS= read -r match; do
                [[ -z "$match" ]] && continue
                rel="${target#$REPO_ROOT/}"
                lineno=$(echo "$match" | cut -d: -f1)
                text=$(echo "$match" | cut -d: -f2-)
                printf '--- Dashboard tabs ---\n  %s:%s\n    stale value: %s\n    text       : %s\n\n' "$rel" "$lineno" "$alias" "$text"
                FINDINGS=$((FINDINGS + 1))
            done < <(grep -niF "$pat" "$target" 2>/dev/null || true)
        done
    done
done < <(read_json_array "d._knownStaleAliases.dashboardTabs")

# Version badges
while IFS= read -r alias; do
    [[ -z "$alias" ]] && continue
    for target in "${TARGETS[@]}"; do
        while IFS= read -r match; do
            [[ -z "$match" ]] && continue
            rel="${target#$REPO_ROOT/}"
            lineno=$(echo "$match" | cut -d: -f1)
            text=$(echo "$match" | cut -d: -f2-)
            printf '--- Version badge ---\n  %s:%s\n    stale value: %s\n    text       : %s\n\n' "$rel" "$lineno" "$alias" "$text"
            FINDINGS=$((FINDINGS + 1))
        done < <(grep -niF "$alias" "$target" 2>/dev/null || true)
    done
done < <(read_json_array "d._knownStaleAliases.versionBadges")

if [[ "$FINDINGS" -eq 0 ]]; then
    echo -e "\033[32m[OK] No stale metric aliases found.\033[0m"
    echo ""
    echo -e "\033[90mCurrent canonical values (docs/_metrics.json):\033[0m"
    printf '  version           : %s\n' "$(read_json 'd.version')"
    printf '  tests             : %s/%s\n' "$(read_json 'd.testsPassing')" "$(read_json 'd.testsTotal')"
    printf '  MCP tools         : %s\n' "$(read_json 'd.mcpTools.total')"
    printf '  dashboard tabs    : %s\n' "$(read_json 'd.dashboardTabs')"
    printf '  agents            : %s\n' "$(read_json 'd.agents')"
    printf '  skills            : %s\n' "$(read_json 'd.skills')"
    printf '  manual chapters   : %s\n' "$(read_json 'd.manualChapters')"
    exit 0
fi

echo -e "\033[33m[DRIFT] $FINDINGS stale reference(s) found.\033[0m"
echo "Update docs/_metrics.json first if a stale value is now correct."
echo "Then fix the surfaces above to match the canonical values."

if [[ "$STRICT" == "true" ]]; then
    exit 1
fi
exit 0
