#!/usr/bin/env bash
#
# Plan Forge — Setup Validator (Bash)
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
            printf '\033[0;35m  TODO  %s contains placeholder to fill in: %s\033[0m\n' "$rel_path" "$ph"
            ((WARN++))
        fi
    done
}

# ─── Banner ────────────────────────────────────────────────────────────
echo ""
cyan "╔══════════════════════════════════════════════════════════════╗"
cyan "║       Plan Forge — Setup Validator                   ║"
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

CONFIG_PATH="$PROJECT_PATH/.forge.json"
if [[ -f "$CONFIG_PATH" ]]; then
    # Simple JSON parse — extract preset value
    PRESET="$(grep '"preset"' "$CONFIG_PATH" | sed 's/.*: *"\([^"]*\)".*/\1/')"
    cyan "  INFO  Detected preset: $PRESET"

    if [[ "$PRESET" != "custom" ]]; then
        check_file "AGENTS.md" || true
        check_file ".github/instructions/testing.instructions.md" || true
        check_file ".github/instructions/security.instructions.md" || true

        if [[ "$PRESET" == "azure-iac" ]]; then
            # IaC-specific instruction files
            check_file ".github/instructions/bicep.instructions.md" || true
            check_file ".github/instructions/naming.instructions.md" || true
            check_file ".github/instructions/deploy.instructions.md" || true
        else
            # App-stack presets
            check_file ".github/instructions/database.instructions.md" || true
        fi
    fi

    # Check for agentic files (prompt templates, agent definitions, skills)
    echo ""
    cyan "Agentic files (prompts, agents, skills):"

    if [[ "$PRESET" != "custom" ]]; then
        PROMPTS_DIR="$PROJECT_PATH/.github/prompts"
        AGENTS_DIR="$PROJECT_PATH/.github/agents"
        SKILLS_DIR="$PROJECT_PATH/.github/skills"

        if [[ -d "$PROMPTS_DIR" ]]; then
            PROMPT_COUNT=$(find "$PROMPTS_DIR" -name "*.prompt.md" -type f 2>/dev/null | wc -l | tr -d ' ')
            green "  PASS  .github/prompts/ ($PROMPT_COUNT prompt templates)"
            ((PASS++))
        else
            yellow "  WARN  .github/prompts/ (missing — optional)"
            ((WARN++))
        fi

        if [[ -d "$AGENTS_DIR" ]]; then
            AGENT_COUNT=$(find "$AGENTS_DIR" -name "*.agent.md" -type f 2>/dev/null | wc -l | tr -d ' ')
            green "  PASS  .github/agents/ ($AGENT_COUNT agent definitions)"
            ((PASS++))
        else
            yellow "  WARN  .github/agents/ (missing — optional)"
            ((WARN++))
        fi

        if [[ -d "$SKILLS_DIR" ]]; then
            SKILL_COUNT=$(find "$SKILLS_DIR" -name "SKILL.md" -type f 2>/dev/null | wc -l | tr -d ' ')
            green "  PASS  .github/skills/ ($SKILL_COUNT skills)"
            ((PASS++))
        else
            yellow "  WARN  .github/skills/ (missing — optional)"
            ((WARN++))
        fi
    fi
else
    yellow "  WARN  .forge.json not found — skipping preset checks"
    ((WARN++))
fi

# ─── Optional Files ───────────────────────────────────────────────────
echo ""
cyan "Optional files:"

check_file ".vscode/settings.json" "false" || true
check_file "docs/COPILOT-VSCODE-GUIDE.md" "false" || true
check_file ".forge.json" "false" || true

# ─── New Capabilities (Optional) ──────────────────────────────────────
echo ""
cyan "Optional capabilities:"

# Project Principles
PP_PATH="$PROJECT_PATH/docs/plans/PROJECT-PRINCIPLES.md"
if [[ -f "$PP_PATH" ]]; then
    PP_COUNT=$(grep -cE '^\|\s*[0-9]+\s*\|' "$PP_PATH" 2>/dev/null || echo "0")
    green "  PASS  Project Principles: found ($PP_COUNT principles)"
    ((PASS++))
else
    yellow "  WARN  Project Principles: not created (optional — run project-principles.prompt.md)"
    ((WARN++))
fi

# Extensions
EXT_JSON="$PROJECT_PATH/.forge/extensions/extensions.json"
if [[ -f "$EXT_JSON" ]]; then
    EXT_COUNT=$(python3 -c "import json; print(len(json.load(open('$EXT_JSON')).get('extensions',[])))" 2>/dev/null || echo "0")
    if [[ "$EXT_COUNT" -gt 0 ]]; then
        green "  PASS  Extensions: $EXT_COUNT installed"
        ((PASS++))
    else
        yellow "  WARN  Extensions: none installed (optional)"
        ((WARN++))
    fi
else
    yellow "  WARN  Extensions: not configured (optional)"
    ((WARN++))
fi

# CLI
if [[ -f "$PROJECT_PATH/pforge.sh" ]] || [[ -f "$PROJECT_PATH/pforge.ps1" ]]; then
    green "  PASS  CLI: pforge script found"
    ((PASS++))
else
    yellow "  WARN  CLI: pforge not installed (optional)"
    ((WARN++))
fi

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
