#!/usr/bin/env bash
# Plan Forge — Error Catalog PreCommit chain entry
# Checks that docs/manual/errors-and-exit-codes.html is in sync with
# pforge-mcp/enums.mjs ERROR_CODES. Degrades gracefully if the generator
# script is absent (non-Plan-Forge repos).
# Returns { "blocked": true, "message": "..." } if out of sync.
# Returns {} on success or when the check cannot run.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
CHECKER="$REPO_ROOT/scripts/check-error-catalog.mjs"

if [[ ! -f "$CHECKER" ]]; then
  printf '{}'
  exit 0
fi

OUTPUT=$(node "$CHECKER" 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  MSG=$(printf '%s' "$OUTPUT" | tr '"' "'" | tr $'\n' ' ')
  printf '{"blocked":true,"message":"error-catalog out of sync: %s Run: node scripts/generate-error-catalog.mjs"}' "$MSG"
  exit 0
fi

printf '{}'
