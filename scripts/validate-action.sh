#!/usr/bin/env bash
# Plan Forge Validate — GitHub Action Script
# Validates Plan Forge setup, guardrail files, plan artifacts, and code cleanliness.
set -uo pipefail

PROJECT_DIR="${INPUT_PATH:-.}"
FAIL_ON_WARNINGS="${INPUT_FAIL_ON_WARNINGS:-false}"
RUN_SWEEP="${INPUT_SWEEP:-true}"
SWEEP_FAIL="${INPUT_SWEEP_FAIL:-false}"

PASS=0
FAIL=0
WARN=0

# ─── Helpers ────────────────────────────────────────────────────────
pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Plan Forge — Validate (CI)                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_DIR"
echo ""

# ═══════════════════════════════════════════════════════════════════
# 1. SETUP HEALTH
# ═══════════════════════════════════════════════════════════════════
echo "Setup Health:"

PRESET="unknown"
TEMPLATE_VERSION="unknown"

CONFIG_PATH="$PROJECT_DIR/.forge.json"
if [ -f "$CONFIG_PATH" ]; then
    # Parse with grep/sed — no jq dependency
    PRESET="$(grep -o '"preset"[^,}]*' "$CONFIG_PATH" | sed 's/"preset":\s*"//' | sed 's/"//' || echo "unknown")"
    TEMPLATE_VERSION="$(grep -o '"templateVersion"[^,}]*' "$CONFIG_PATH" | sed 's/"templateVersion":\s*"//' | sed 's/"//' || echo "unknown")"
    pass ".forge.json valid (preset: $PRESET, v$TEMPLATE_VERSION)"
else
    fail ".forge.json not found — run 'pforge init' to bootstrap"
fi

COPILOT_INSTR="$PROJECT_DIR/.github/copilot-instructions.md"
if [ -f "$COPILOT_INSTR" ]; then
    pass ".github/copilot-instructions.md exists"
else
    fail ".github/copilot-instructions.md missing"
fi

# Core guardrails
ARCH_INSTR="$PROJECT_DIR/.github/instructions/architecture-principles.instructions.md"
GIT_INSTR="$PROJECT_DIR/.github/instructions/git-workflow.instructions.md"
if [ -f "$ARCH_INSTR" ] && [ -f "$GIT_INSTR" ]; then
    pass "Core guardrail files present (architecture-principles, git-workflow)"
else
    fail "Missing core guardrail files"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════
# 2. FILE COUNTS PER PRESET
# ═══════════════════════════════════════════════════════════════════
echo "File Counts:"

PRESET_KEY="${PRESET%%,*}"  # First preset for multi-preset

case "$PRESET_KEY" in
    dotnet|typescript|python|java|go|swift|azure-iac)
        EXP_INSTR=14; EXP_AGENTS=17; EXP_PROMPTS=9; EXP_SKILLS=8 ;;
    custom)
        EXP_INSTR=3; EXP_AGENTS=5; EXP_PROMPTS=7; EXP_SKILLS=0 ;;
    *)
        EXP_INSTR=3; EXP_AGENTS=0; EXP_PROMPTS=0; EXP_SKILLS=0 ;;
esac

INSTR_COUNT=0; AGENT_COUNT=0; PROMPT_COUNT=0; SKILL_COUNT=0
[ -d "$PROJECT_DIR/.github/instructions" ] && INSTR_COUNT=$(find "$PROJECT_DIR/.github/instructions" -name "*.instructions.md" -type f 2>/dev/null | wc -l | tr -d ' ')
[ -d "$PROJECT_DIR/.github/agents" ]       && AGENT_COUNT=$(find "$PROJECT_DIR/.github/agents" -name "*.agent.md" -type f 2>/dev/null | wc -l | tr -d ' ')
[ -d "$PROJECT_DIR/.github/prompts" ]      && PROMPT_COUNT=$(find "$PROJECT_DIR/.github/prompts" -name "*.prompt.md" -type f 2>/dev/null | wc -l | tr -d ' ')
[ -d "$PROJECT_DIR/.github/skills" ]       && SKILL_COUNT=$(find "$PROJECT_DIR/.github/skills" -name "SKILL.md" -type f 2>/dev/null | wc -l | tr -d ' ')

[ "$INSTR_COUNT" -ge "$EXP_INSTR" ] \
    && pass "$INSTR_COUNT instruction files (expected: >=$EXP_INSTR for $PRESET_KEY)" \
    || warn "$INSTR_COUNT instruction files (expected: >=$EXP_INSTR for $PRESET_KEY)"

[ "$AGENT_COUNT" -ge "$EXP_AGENTS" ] \
    && pass "$AGENT_COUNT agent definitions (expected: >=$EXP_AGENTS for $PRESET_KEY)" \
    || warn "$AGENT_COUNT agent definitions (expected: >=$EXP_AGENTS for $PRESET_KEY)"

[ "$PROMPT_COUNT" -ge "$EXP_PROMPTS" ] \
    && pass "$PROMPT_COUNT prompt templates (expected: >=$EXP_PROMPTS for $PRESET_KEY)" \
    || warn "$PROMPT_COUNT prompt templates (expected: >=$EXP_PROMPTS for $PRESET_KEY)"

[ "$SKILL_COUNT" -ge "$EXP_SKILLS" ] \
    && pass "$SKILL_COUNT skills (expected: >=$EXP_SKILLS for $PRESET_KEY)" \
    || warn "$SKILL_COUNT skills (expected: >=$EXP_SKILLS for $PRESET_KEY)"

echo ""

# ═══════════════════════════════════════════════════════════════════
# 3. PLACEHOLDER CHECK
# ═══════════════════════════════════════════════════════════════════
echo "Placeholder Check:"

if [ -f "$COPILOT_INSTR" ]; then
    PH_COUNT=0
    PH_LIST=""
    for ph in '<YOUR PROJECT NAME>' '<YOUR TECH STACK>' '<YOUR BUILD COMMAND>' '<YOUR TEST COMMAND>' '<YOUR LINT COMMAND>' '<YOUR DEV COMMAND>' '<DATE>'; do
        if grep -qF "$ph" "$COPILOT_INSTR" 2>/dev/null; then
            PH_COUNT=$((PH_COUNT + 1))
            PH_LIST="${PH_LIST:+$PH_LIST, }$ph"
        fi
    done
    if [ "$PH_COUNT" -gt 0 ]; then
        fail "copilot-instructions.md has $PH_COUNT unresolved placeholder(s): $PH_LIST"
    else
        pass "No unresolved placeholders in copilot-instructions.md"
    fi
else
    warn "copilot-instructions.md not found — skipping placeholder check"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════
# 4. ORPHAN DETECTION
# ═══════════════════════════════════════════════════════════════════
echo "Orphan Detection:"

AGENTS_MD="$PROJECT_DIR/AGENTS.md"
AGENTS_DIR="$PROJECT_DIR/.github/agents"
ORPHANS_FOUND=false

if [ -f "$AGENTS_MD" ] && [ -d "$AGENTS_DIR" ]; then
    REFERENCED=$(grep -oE '[a-z0-9-]+\.agent\.md' "$AGENTS_MD" 2>/dev/null | sort -u)
    for ref in $REFERENCED; do
        if [ ! -f "$AGENTS_DIR/$ref" ]; then
            warn "AGENTS.md references '$ref' but file not found"
            ORPHANS_FOUND=true
        fi
    done
    if [ "$ORPHANS_FOUND" = false ]; then
        pass "No orphaned agent references"
    fi
else
    pass "Agent orphan check skipped (AGENTS.md or agents/ not present)"
fi

# Instruction files missing applyTo
INSTR_DIR="$PROJECT_DIR/.github/instructions"
APPLY_TO_ISSUES=false
if [ -d "$INSTR_DIR" ]; then
    for f in "$INSTR_DIR"/*.instructions.md; do
        [ -f "$f" ] || continue
        if head -5 "$f" | grep -q '^---' && ! grep -q 'applyTo' "$f"; then
            FNAME="$(basename "$f")"
            warn "$FNAME has frontmatter but no applyTo pattern"
            APPLY_TO_ISSUES=true
        fi
    done
    if [ "$APPLY_TO_ISSUES" = false ]; then
        pass "All instruction files have applyTo patterns"
    fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════
# 5. PLAN ARTIFACT CHECK
# ═══════════════════════════════════════════════════════════════════
echo "Plan Artifacts:"

PLANS_DIR="$PROJECT_DIR/docs/plans"
ROADMAP="$PLANS_DIR/DEPLOYMENT-ROADMAP.md"

if [ -f "$ROADMAP" ]; then
    pass "DEPLOYMENT-ROADMAP.md exists"
else
    warn "DEPLOYMENT-ROADMAP.md not found"
fi

# Check active plans for required sections
if [ -d "$PLANS_DIR" ]; then
    PLAN_COUNT=$(find "$PLANS_DIR" -name "Phase-*-PLAN.md" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$PLAN_COUNT" -gt 0 ]; then
        PLANS_OK=0
        PLANS_MISSING=0
        for plan in "$PLANS_DIR"/Phase-*-PLAN.md; do
            [ -f "$plan" ] || continue
            PLAN_NAME="$(basename "$plan")"
            # Check for scope contract and slices
            HAS_SCOPE=$(grep -c '### In Scope\|### Scope Contract\|## Scope' "$plan" 2>/dev/null || echo 0)
            HAS_SLICES=$(grep -c '### Slice\|## Execution Slices\|## Slices' "$plan" 2>/dev/null || echo 0)
            if [ "$HAS_SCOPE" -gt 0 ] && [ "$HAS_SLICES" -gt 0 ]; then
                PLANS_OK=$((PLANS_OK + 1))
            else
                MISSING_PARTS=""
                [ "$HAS_SCOPE" -eq 0 ] && MISSING_PARTS="scope contract"
                [ "$HAS_SLICES" -eq 0 ] && MISSING_PARTS="${MISSING_PARTS:+$MISSING_PARTS, }execution slices"
                warn "$PLAN_NAME missing: $MISSING_PARTS"
                PLANS_MISSING=$((PLANS_MISSING + 1))
            fi
        done
        if [ "$PLANS_MISSING" -eq 0 ]; then
            pass "$PLAN_COUNT plan(s) — all have scope contracts and slices"
        fi
    else
        pass "No phase plans yet (OK for new projects)"
    fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════
# 6. COMPLETENESS SWEEP (optional)
# ═══════════════════════════════════════════════════════════════════
if [ "$RUN_SWEEP" = "true" ]; then
    echo "Completeness Sweep:"

    SWEEP_PATTERNS='TODO|FIXME|HACK|will be replaced|placeholder|stub|mock data'
    CODE_EXTENSIONS="cs ts tsx js jsx py go java kt rb rs sql sh ps1"

    SWEEP_TOTAL=0
    for ext in $CODE_EXTENSIONS; do
        while IFS= read -r finding; do
            if [ -n "$finding" ]; then
                echo "  $finding"
                SWEEP_TOTAL=$((SWEEP_TOTAL + 1))
            fi
        done < <(find "$PROJECT_DIR" -name "*.$ext" -type f \
            ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/bin/*' \
            ! -path '*/obj/*' ! -path '*/dist/*' ! -path '*/vendor/*' \
            ! -path '*/__pycache__/*' ! -path '*/plan-forge/*' \
            -exec grep -Hni -E "$SWEEP_PATTERNS" {} \; 2>/dev/null | head -50)
    done

    if [ "$SWEEP_TOTAL" -eq 0 ]; then
        pass "Sweep clean — zero deferred-work markers"
    else
        if [ "$SWEEP_FAIL" = "true" ]; then
            fail "Found $SWEEP_TOTAL deferred-work marker(s)"
        else
            warn "Found $SWEEP_TOTAL deferred-work marker(s)"
        fi
    fi

    echo ""
fi

# ═══════════════════════════════════════════════════════════════════
# 7. CROSS-ARTIFACT ANALYSIS (optional)
# ═══════════════════════════════════════════════════════════════════
RUN_ANALYZE="${INPUT_ANALYZE:-false}"
ANALYZE_PLAN="${INPUT_ANALYZE_PLAN:-}"
ANALYZE_THRESHOLD="${INPUT_ANALYZE_THRESHOLD:-60}"

if [ "$RUN_ANALYZE" = "true" ]; then
    echo "Cross-Artifact Analysis:"

    if [ -z "$ANALYZE_PLAN" ]; then
        warn "analyze=true but no analyze-plan specified — skipping"
    elif [ ! -f "$PROJECT_DIR/$ANALYZE_PLAN" ]; then
        fail "Plan file not found: $ANALYZE_PLAN"
    else
        # Run pforge analyze if available, otherwise do basic plan structure checks
        PFORGE_SCRIPT=""
        [ -f "$PROJECT_DIR/pforge.sh" ] && PFORGE_SCRIPT="$PROJECT_DIR/pforge.sh"

        if [ -n "$PFORGE_SCRIPT" ]; then
            ANALYZE_OUTPUT="$(bash "$PFORGE_SCRIPT" analyze "$ANALYZE_PLAN" 2>&1)" || true
            echo "$ANALYZE_OUTPUT"

            # Extract score from output
            SCORE="$(echo "$ANALYZE_OUTPUT" | grep -oP 'Consistency Score: \K\d+' || echo "0")"
            if [ "$SCORE" -ge "$ANALYZE_THRESHOLD" ]; then
                pass "Consistency score: $SCORE/100 (threshold: $ANALYZE_THRESHOLD)"
            else
                fail "Consistency score: $SCORE/100 (below threshold: $ANALYZE_THRESHOLD)"
            fi
        else
            # Fallback: basic plan structure validation
            PLAN_FILE="$PROJECT_DIR/$ANALYZE_PLAN"
            HAS_SCOPE=$(grep -c '### In Scope\|### Scope Contract' "$PLAN_FILE" 2>/dev/null || echo 0)
            HAS_SLICES=$(grep -c '### Slice' "$PLAN_FILE" 2>/dev/null || echo 0)
            HAS_GATES=$(grep -ciE 'validation gate|build.*pass|test.*pass' "$PLAN_FILE" 2>/dev/null || echo 0)

            [ "$HAS_SCOPE" -gt 0 ] && pass "Plan has scope contract" || warn "No scope contract found"
            [ "$HAS_SLICES" -gt 0 ] && pass "Plan has $HAS_SLICES slices" || warn "No execution slices found"
            [ "$HAS_GATES" -gt 0 ] && pass "Plan has validation gates" || warn "No validation gates found"
        fi
    fi

    echo ""
fi

# ═══════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════
echo "────────────────────────────────────────────────────"
echo "  Results:  $PASS passed  |  $FAIL failed  |  $WARN warnings"
echo "────────────────────────────────────────────────────"

# Set outputs for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "passed=$PASS" >> "$GITHUB_OUTPUT"
    echo "failed=$FAIL" >> "$GITHUB_OUTPUT"
    echo "warnings=$WARN" >> "$GITHUB_OUTPUT"
fi

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "❌ VALIDATION FAILED — $FAIL issue(s) must be fixed."
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "result=fail" >> "$GITHUB_OUTPUT"
    exit 1
elif [ "$WARN" -gt 0 ] && [ "$FAIL_ON_WARNINGS" = "true" ]; then
    echo ""
    echo "⚠️  VALIDATION FAILED (fail-on-warnings enabled) — $WARN warning(s)."
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "result=fail" >> "$GITHUB_OUTPUT"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo ""
    echo "⚠️  Passed with $WARN warning(s)."
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "result=warn" >> "$GITHUB_OUTPUT"
    exit 0
else
    echo ""
    echo "✅ All checks passed. Your forge is solid."
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "result=pass" >> "$GITHUB_OUTPUT"
    exit 0
fi
