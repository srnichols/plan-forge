#!/usr/bin/env bash
# Plan Forge — PreDeploy Hook (PreToolUse gate)
# Checks secret-scan and env-diff caches before deploy-pattern file writes or commands.
# Returns permissionDecision: "deny" when secrets are found and blockOnSecrets is enabled.

set -euo pipefail

INPUT=$(cat)
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

# Extract tool name, file path, and command from input
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | sed 's/"tool_name":"//;s/"//' || true)
FILE_PATH=$(echo "$INPUT" | grep -o '"filePath":"[^"]*"' | sed 's/"filePath":"//;s/"//' || true)
COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | sed 's/"command":"//;s/"//' || true)

# ── Deploy trigger detection ──────────────────────────────────────────
is_deploy_trigger() {
  # File path patterns
  if [[ -n "$FILE_PATH" ]]; then
    case "$FILE_PATH" in
      deploy/*|Dockerfile*|*.bicep|*.tf|k8s/*|docker-compose*.yml)
        return 0 ;;
    esac
  fi
  # Command patterns
  if [[ -n "$COMMAND" ]]; then
    if echo "$COMMAND" | grep -qE '\b(pforge\s+deploy-log|docker\s+push|az\s+deploy|kubectl\s+apply|azd\s+up|git\s+push)\b'; then
      return 0
    fi
  fi
  return 1
}

# Exit early if not a deploy trigger
if ! is_deploy_trigger; then
  echo "{}"
  exit 0
fi

# ── Load config ──────────────────────────────────────────────────────
BLOCK_ON_SECRETS=true
WARN_ON_ENV_GAPS=true

if [[ -f "$REPO_ROOT/.forge.json" ]]; then
  BLOCK_ON_SECRETS=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$REPO_ROOT/.forge.json','utf-8'));
      console.log(c?.hooks?.preDeploy?.blockOnSecrets ?? true);
    } catch { console.log(true); }
  " 2>/dev/null || echo "true")
  WARN_ON_ENV_GAPS=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$REPO_ROOT/.forge.json','utf-8'));
      console.log(c?.hooks?.preDeploy?.warnOnEnvGaps ?? true);
    } catch { console.log(true); }
  " 2>/dev/null || echo "true")
fi

# ── Check secret-scan cache ──────────────────────────────────────────
SECRET_CACHE="$REPO_ROOT/.forge/secret-scan-cache.json"
if [[ -f "$SECRET_CACHE" && "$BLOCK_ON_SECRETS" == "true" ]]; then
  CLEAN=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$SECRET_CACHE','utf-8'));
      console.log(c.clean === true ? 'true' : 'false');
    } catch { console.log('true'); }
  " 2>/dev/null || echo "true")

  if [[ "$CLEAN" == "false" ]]; then
    FINDING_COUNT=$(node -e "
      try {
        const c = JSON.parse(require('fs').readFileSync('$SECRET_CACHE','utf-8'));
        console.log((c.findings || []).length);
      } catch { console.log(0); }
    " 2>/dev/null || echo "0")

    if [[ "$FINDING_COUNT" -gt 0 ]]; then
      REASON="PreDeploy BLOCKED: LiveGuard detected $FINDING_COUNT potential secret(s). Deploy is blocked until resolved. Run: pforge secret-scan --since HEAD~1"
      ESCAPED=$(echo "$REASON" | sed 's/"/\\"/g')
      echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$ESCAPED\"}}"
      exit 0
    fi
  fi
fi

# ── Check env-diff cache (advisory only — never blocks) ──────────────
ENV_CACHE="$REPO_ROOT/.forge/env-diff-cache.json"
if [[ -f "$ENV_CACHE" && "$WARN_ON_ENV_GAPS" == "true" ]]; then
  TOTAL_MISSING=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$ENV_CACHE','utf-8'));
      console.log(c?.summary?.totalMissing ?? c?.summary?.totalGaps ?? 0);
    } catch { console.log(0); }
  " 2>/dev/null || echo "0")

  if [[ "$TOTAL_MISSING" -gt 0 ]]; then
    # Advisory — do NOT block, just warn via stderr
    echo "⚠️ PreDeploy Advisory: $TOTAL_MISSING missing env key(s) detected. Deploy will proceed, but target environment may be missing required config." >&2
  fi
fi

# Allow the deploy action
echo "{}"
