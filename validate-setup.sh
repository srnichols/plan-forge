#!/usr/bin/env bash
#
# AI Plan Hardening — Setup Validator (Bash)
#
# Usage:
#   ./validate-setup.sh --path ~/projects/MyApp
#   ./validate-setup.sh            # Validates current directory
#
# Returns exit code 0 on success, 1 on failure.

set -euo pipefail

# ─── Defaults ──────────────────────────────────────────────────────────
PROJECT_PATH="$(pwd)"

# ─── Color helpers ─────────────────────────────────────────────────────
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

# ─── Parse arguments ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --path|-p) PROJECT_PATH="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: ./validate-setup.sh [--path DIR]"
            exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

PROJECT_PATH="$(cd "$PROJECT_PATH" 2>/dev/null && pwd || echo "$PROJECT_PATH")"

# ─── Counters ─────────────────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0

check_file() {
    local rel_path="$1"
    local required="${2:-true}"
    local full_path="$PROJECT_PATH/$rel_path"

    if [[ -f "$full_path" ]]; then
        local size
        size="$(wc -c < "$full_path" | tr -d ' ')"
        if [[ "$size" -eq 0 ]]; then
            red "  FAIL  $rel_path (empty file)"
            if [[ "$required" == "true" ]]; then ((FAIL++)); else ((WARN++)); fi
            return 1
        fi
        green "  PASS  $rel_path ($size bytes)"
        ((PASS++))
        return 0
    else
        if [[ "$required" == "true" ]]; then
            red "  FAIL  $rel_path (missing)"
            ((FAIL++))
        else
            yellow "  WARN  $rel_path (missing — optional)"
            ((WARN++))
        fi
        return 1
    fi
}

check_no_placeholders() {
    local rel_path="$1"
    local full_path="$PROJECT_PATH/$rel_path"

    [[ ! -f "$full_path" ]] && return

    local placeholders=("<YOUR PROJECT NAME>" "<YOUR TECH STACK>" "<YOUR BUILD COMMAND>" "<YOUR TEST COMMAND>" "<YOUR LINT COMMAND>")
    for ph in "${placeholders[@]}"; do
        if grep -qF "$ph" "$full_path"; then
            yellow "  WARN  $rel_path contains unresolved placeholder: $ph"
            ((WARN++))
        fi
    done
}

# ─── Banner ────────────────────────────────────────────────────────────
echo ""
cyan "╔══════════════════════════════════════════════════════════════╗"
cyan "║       AI Plan Hardening — Setup Validator                   ║"
cyan "╚══════════════════════════════════════════════════════════════╝"
echo ""
cyan "Validating: $PROJECT_PATH"
echo ""

# ─── Required Files ────────────────────────────────────────────────────
cyan "Required files:"

check_file ".github/copilot-instructions.md" || true
check_file ".github/instructions/architecture-principles.instructions.md" || true
check_file ".github/instructions/git-workflow.instructions.md" || true
check_file ".github/instructions/ai-plan-hardening-runbook.instructions.md" || true
check_file "docs/plans/AI-Plan-Hardening-Runbook.md" || true
check_file "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md" || true
check_file "docs/plans/DEPLOYMENT-ROADMAP.md" || true

# ─── Preset-Dependent Files ───────────────────────────────────────────
echo ""
cyan "Preset-dependent files:"

CONFIG_PATH="$PROJECT_PATH/.plan-hardening.json"
if [[ -f "$CONFIG_PATH" ]]; then
    # Simple JSON parse — extract preset value
    PRESET="$(grep '"preset"' "$CONFIG_PATH" | sed 's/.*: *"\([^"]*\)".*/\1/')"
    cyan "  INFO  Detected preset: $PRESET"

    if [[ "$PRESET" != "custom" ]]; then
        check_file "AGENTS.md" || true
        check_file ".github/instructions/database.instructions.md" || true
        check_file ".github/instructions/testing.instructions.md" || true
        check_file ".github/instructions/security.instructions.md" || true
    fi
else
    yellow "  WARN  .plan-hardening.json not found — skipping preset checks"
    ((WARN++))
fi

# ─── Optional Files ───────────────────────────────────────────────────
echo ""
cyan "Optional files:"

check_file ".vscode/settings.json" "false" || true
check_file "docs/COPILOT-VSCODE-GUIDE.md" "false" || true
check_file ".plan-hardening.json" "false" || true

# ─── Placeholder Scan ─────────────────────────────────────────────────
echo ""
cyan "Placeholder scan:"

check_no_placeholders ".github/copilot-instructions.md"
check_no_placeholders "AGENTS.md"
check_no_placeholders "docs/plans/DEPLOYMENT-ROADMAP.md"

# ─── Summary ──────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
if [[ $FAIL -gt 0 ]]; then
    red "  Results:  $PASS passed  |  $FAIL failed  |  $WARN warnings"
else
    green "  Results:  $PASS passed  |  $FAIL failed  |  $WARN warnings"
fi
echo "────────────────────────────────────────────────────"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    red "VALIDATION FAILED"
    red "Fix the $FAIL failed check(s) above before proceeding."
    exit 1
else
    echo ""
    green "VALIDATION PASSED"
    if [[ $WARN -gt 0 ]]; then
        yellow "$WARN warning(s) — review optional items above."
    fi
    exit 0
fi
