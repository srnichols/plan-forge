#!/usr/bin/env bash
# Plan Forge — PreToolUse Hook
# Blocks file edits to paths listed in the active plan's Forbidden Actions section.
# Runs before every tool invocation during agent sessions.

set -euo pipefail

INPUT=$(cat)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

# Extract tool name and file path from input
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | sed 's/"tool_name":"//;s/"//' || true)
FILE_PATH=$(echo "$INPUT" | grep -o '"filePath":"[^"]*"' | sed 's/"filePath":"//;s/"//' || true)

# Only check file-editing tools
case "$TOOL_NAME" in
    editFiles|create_file|replace_string_in_file|insert_edit_into_file|multi_replace_string_in_file)
        ;;
    *)
        echo "{}"
        exit 0
        ;;
esac

# If no file path detected, allow
if [[ -z "$FILE_PATH" ]]; then
    echo "{}"
    exit 0
fi

# Find active plan (most recent *-PLAN.md with "In Progress" or "HARDENED")
ACTIVE_PLAN=""
for plan in "$REPO_ROOT"/docs/plans/*-PLAN.md; do
    [[ -f "$plan" ]] || continue
    if grep -qiE 'In Progress|HARDENED|Ready for execution' "$plan" 2>/dev/null; then
        ACTIVE_PLAN="$plan"
        break
    fi
done

# If no active plan, allow everything
if [[ -z "$ACTIVE_PLAN" ]]; then
    echo "{}"
    exit 0
fi

# Extract Forbidden Actions section
FORBIDDEN_SECTION=$(awk '/### Forbidden Actions/,/^###? / { print }' "$ACTIVE_PLAN" 2>/dev/null || true)

if [[ -z "$FORBIDDEN_SECTION" ]]; then
    echo "{}"
    exit 0
fi

# Check if the file path matches any forbidden path pattern
# Extract paths after "Do not modify:" lines
FORBIDDEN_PATHS=$(echo "$FORBIDDEN_SECTION" | grep -oE '`[^`]+`' | tr -d '`' || true)

for forbidden in $FORBIDDEN_PATHS; do
    # Check if the file path starts with or matches the forbidden pattern
    if [[ "$FILE_PATH" == *"$forbidden"* ]]; then
        echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"BLOCKED: '$FILE_PATH' matches Forbidden Action '$forbidden' in the active plan's Scope Contract. Modifying this path is not allowed.\"}}"
        exit 0
    fi
done

# No forbidden path matched — allow
echo "{}"
