#!/usr/bin/env bash
# Plan Forge — PreToolUse Hook
# Blocks file edits to paths listed in the active plan's Forbidden Actions section.
# Runs before every tool invocation during agent sessions.
# Twin of check-forbidden.ps1; both follow the scope-hint contract of pforge.sh
# plan_section_hints / plan_hint_regexes (meta-bugs #286, #287).

set -euo pipefail

INPUT=$(cat)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

# Extract tool name and file path from input (whitespace around ":" is allowed)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 \
    | sed -e 's/^"tool_name"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' || true)
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"filePath"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 \
    | sed -e 's/^"filePath"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' || true)

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

REPO_PREFIX="${REPO_ROOT%/}/"

# Print "in-progress" or "ready" when the plan's FIRST status line starts with
# In Progress, or with HARDENED / Ready for execution; nothing otherwise.
plan_status_tier() {
    awk '
        NR == 1 { bom = "\357\273\277"; if (index($0, bom) == 1) $0 = substr($0, length(bom) + 1) }
        tolower($0) ~ /^[ \t]*(>[ \t]*)?([-*][ \t]+)?(\*\*status\*\*|\*\*status:|status:)/ {
            value = $0
            sub(/^[^:]*:/, "", value)
            sub(/^[^A-Za-z0-9]+/, "", value)
            value = tolower(value)
            if (value ~ /^in[ -]progress([^a-z0-9_]|$)/) print "in-progress"
            else if (value ~ /^(hardened|ready for execution)([^a-z0-9_]|$)/) print "ready"
            exit
        }
    ' "$1" 2>/dev/null
}

# Resolve the plan whose Forbidden Actions apply: an explicit .forge/active-plan
# pointer, else the only plan In Progress, else the only plan HARDENED / Ready
# for execution. Several plans in the deciding tier are ambiguous — taking the
# first by name enforced a stale plan's rules on unrelated edits — so nothing
# is enforced then.
ACTIVE_PLAN=""
if [[ -f "$REPO_ROOT/.forge/active-plan" ]]; then
    POINTED="$(head -n 1 "$REPO_ROOT/.forge/active-plan" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [[ -n "$POINTED" && -f "$REPO_PREFIX$POINTED" ]]; then
        ACTIVE_PLAN="$REPO_PREFIX$POINTED"
    fi
fi
if [[ -z "$ACTIVE_PLAN" ]]; then
    IN_PROGRESS=()
    READY=()
    for plan in "$REPO_ROOT"/docs/plans/*-PLAN.md; do
        [[ -f "$plan" ]] || continue
        case "$(plan_status_tier "$plan")" in
            in-progress) IN_PROGRESS+=("$plan") ;;
            ready) READY+=("$plan") ;;
        esac
    done
    if [[ ${#IN_PROGRESS[@]} -eq 1 ]]; then
        ACTIVE_PLAN="${IN_PROGRESS[0]}"
    elif [[ ${#IN_PROGRESS[@]} -eq 0 && ${#READY[@]} -eq 1 ]]; then
        ACTIVE_PLAN="${READY[0]}"
    fi
fi

# No single active plan — allow everything
if [[ -z "$ACTIVE_PLAN" ]]; then
    echo "{}"
    exit 0
fi

# Forbidden Actions hints, stopping at the next heading. The old
# awk '/### Forbidden Actions/,/^###? /' range ended on its own heading line,
# so no path was ever blocked (meta-bug #286). Only single-token hints with a
# letter or digit can name a path.
FORBIDDEN_HINTS=$(awk '
    /^##+[ \t]/ {
        text = $0
        sub(/^##+[ \t]+/, "", text)
        after = substr(text, length("Forbidden Actions") + 1, 1)
        in_section = (index(text, "Forbidden Actions") == 1 && after !~ /[A-Za-z0-9_]/)
        next
    }
    in_section { print }
' "$ACTIVE_PLAN" 2>/dev/null | grep -oE '`[^`]+`' | tr -d '`' \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  | grep -v '[[:space:]]' | grep '[A-Za-z0-9]' || true)

if [[ -z "$FORBIDDEN_HINTS" ]]; then
    echo "{}"
    exit 0
fi

# One ERE per hint, built in a single pass: "*" is the only wildcard and a bare
# word matches only a whole path segment.
FORBIDDEN_REGEXES=$(printf '%s\n' "$FORBIDDEN_HINTS" | sed -E \
    -e 's#\\#/#g' \
    -e 's/[].[^$+?(){}|]/\\&/g' \
    -e 's/\*/.*/g' \
    -e 's#^[A-Za-z0-9_-]+$#(^|/)&($|/)#')

# Match the repo-relative path: JSON-escaped Windows separators become "/",
# and the repository root is stripped so a hint cannot match a parent folder.
NORMALIZED_PATH="${FILE_PATH//\\\\//}"
NORMALIZED_PATH="${NORMALIZED_PATH//\\//}"
shopt -s nocasematch
if [[ "$NORMALIZED_PATH" == "$REPO_PREFIX"* ]]; then
    NORMALIZED_PATH="${NORMALIZED_PATH:${#REPO_PREFIX}}"
fi

json_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

while IFS= read -r forbidden && IFS= read -r pattern <&3; do
    if [[ "$NORMALIZED_PATH" =~ $pattern ]]; then
        # FILE_PATH is still JSON-escaped from the payload; the hint and plan path are not.
        HINT_JSON="$(json_escape "$forbidden")"
        PLAN_JSON="$(json_escape "${ACTIVE_PLAN#"$REPO_PREFIX"}")"
        echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"BLOCKED: '$FILE_PATH' matches Forbidden Action '$HINT_JSON' in the active plan ($PLAN_JSON). Modifying this path is not allowed.\"}}"
        exit 0
    fi
done <<< "$FORBIDDEN_HINTS" 3<<< "$FORBIDDEN_REGEXES"

# No forbidden path matched — allow
echo "{}"
