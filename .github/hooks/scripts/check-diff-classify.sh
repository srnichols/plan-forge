#!/usr/bin/env bash
# Plan Forge — Diff-Classify PreCommit chain entry
# Classifies staged diff against security/safety categories.
# Returns { "blocked": true, "message": "..." } on severity >= high.
# Returns { "blocked": false, "advisory": "..." } on medium.
# Returns {} on low/none.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
MODULE="$REPO_ROOT/pforge-mcp/diff-classify.mjs"

# Degrade gracefully if module not available
if [[ ! -f "$MODULE" ]]; then
  printf '{}'
  exit 0
fi

DIFF="$(git diff --cached 2>/dev/null || true)"

if [[ -z "$DIFF" ]]; then
  printf '{}'
  exit 0
fi

RESULT=$(PFORGE_DIFF_INPUT="$DIFF" PFORGE_MODULE_PATH="$MODULE" node --input-type=module <<'NODEEOF'
const { classifyDiff, SEVERITY_ORDER } = await import(process.env.PFORGE_MODULE_PATH);
const diff = process.env.PFORGE_DIFF_INPUT || '';
const result = classifyDiff(diff);
const idx = SEVERITY_ORDER.indexOf(result.severity);
if (idx >= 3) {
  const cats = result.findings.map(f => f.category).join(', ');
  process.stdout.write(JSON.stringify({ blocked: true, message: `diff-classify blocked [${result.severity}]: ${cats}` }));
} else if (idx === 2) {
  const cats = result.findings.map(f => f.category).join(', ');
  process.stdout.write(JSON.stringify({ blocked: false, advisory: `diff-classify warning [medium]: ${cats}` }));
} else {
  process.stdout.write('{}');
}
NODEEOF
)

printf '%s' "$RESULT"
