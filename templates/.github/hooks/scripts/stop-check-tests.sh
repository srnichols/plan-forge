#!/usr/bin/env bash
# Plan Forge — Stop Hook: Test Reminder
# When the agent session ends, check if code files were modified
# but tests weren't run. Warns the agent to run /test-sweep first.

set -euo pipefail

INPUT=$(cat)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

# Check if this is a re-entry (prevent infinite loop)
STOP_ACTIVE=$(echo "$INPUT" | grep -o '"stop_hook_active":true' || true)
if [[ -n "$STOP_ACTIVE" ]]; then
    echo "{}"
    exit 0
fi

# Check if any code files were modified (uncommitted changes)
CHANGED_CODE=$(git diff --name-only 2>/dev/null | grep -vE '\.(md|json|yml|yaml|txt|csv)$' | head -5 || true)

if [[ -z "$CHANGED_CODE" ]]; then
    # No code changes — safe to stop
    echo "{}"
    exit 0
fi

# Check transcript for evidence that tests were run
TRANSCRIPT_PATH=$(echo "$INPUT" | grep -o '"transcript_path":"[^"]*"' | sed 's/"transcript_path":"//;s/"//' || true)

TESTS_RAN=false
if [[ -n "$TRANSCRIPT_PATH" ]] && [[ -f "$TRANSCRIPT_PATH" ]]; then
    # Look for test commands in the transcript
    if grep -qiE 'dotnet test|pnpm test|pytest|go test|gradle test|test-sweep' "$TRANSCRIPT_PATH" 2>/dev/null; then
        TESTS_RAN=true
    fi
fi

if [[ "$TESTS_RAN" == true ]]; then
    echo "{}"
    exit 0
fi

# Code changed but tests not detected — warn
WARNINGS="WARNING: Code files were modified but no test run was detected in this session. Consider running /test-sweep before ending to catch regressions."

# Remind to capture decisions to OpenBrain if configured
MCP_JSON="$REPO_ROOT/.vscode/mcp.json"
if [[ -f "$MCP_JSON" ]] && grep -q 'openbrain' "$MCP_JSON" 2>/dev/null; then
    WARNINGS="$WARNINGS OPENBRAIN REMINDER: Code was modified in this session. Before ending, capture key decisions with: capture_thought('Decision: <what you decided and why>', project: '<project-name>', created_by: 'copilot-vscode', source: '<current-step>', type: 'decision'). Include architecture choices, pattern decisions, and anything the next session needs to know."
fi

echo "{\"systemMessage\":\"$WARNINGS\"}"
