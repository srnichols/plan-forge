#!/usr/bin/env bash
# Plan Forge — PreCommit chain: diff-classify
#
# Classifies staged git changes by category (plan, test, docs, config, chore,
# scope, unknown) and reports a summary. Advisory-only — never blocks commits.
#
# Output: JSON { blocked: false, advisory: "...", classification: { ... } }

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

# Get staged file list
STAGED="$(git diff --staged --name-only 2>/dev/null || true)"

if [[ -z "$STAGED" ]]; then
  printf '{"blocked":false,"advisory":"No staged changes detected.","classification":{"files":[],"summary":{},"total":0}}'
  exit 0
fi

# Count categories
plan=0; test_=0; docs=0; config=0; chore=0; scope=0; unknown=0
declare -a FILE_ENTRIES=()

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  category="unknown"

  # plan
  if [[ "$file" =~ ^docs/plans/ ]]; then
    category="plan"
  # test
  elif [[ "$file" =~ \.(test|spec)\.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb)$ ]] || \
       [[ "$file" =~ /__tests__/ ]] || [[ "$file" =~ (^|/)tests/ ]]; then
    category="test"
  # docs
  elif [[ "$file" =~ \.(md|mdx|txt|rst|adoc)$ ]] || \
       ([[ "$file" =~ ^docs/ ]] && ! [[ "$file" =~ ^docs/plans/ ]]); then
    category="docs"
  # config
  elif [[ "$file" =~ (^|/)(\.env[^/]*|Dockerfile[^/]*|docker-compose[^/]*)$ ]] || \
       [[ "$file" =~ ^\.github/ ]] || [[ "$file" =~ ^\.vscode/ ]] || \
       [[ "$file" =~ ^\.forge\.json$ ]] || [[ "$file" =~ ^\.forge/ ]] || \
       [[ "$file" =~ (^|/)(tsconfig|jest\.config|vitest\.config|eslint|prettier|babel\.config)[^/]*$ ]]; then
    category="config"
  # chore
  elif [[ "$file" =~ (^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Makefile)$ ]] || \
       [[ "$file" =~ \.(sh|ps1)$ ]]; then
    category="chore"
  # scope
  elif [[ "$file" =~ \.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb|rs|cpp|c|h|hpp|swift|kt)$ ]]; then
    category="scope"
  fi

  case "$category" in
    plan)    ((plan++))    ;;
    test)    ((test_++))   ;;
    docs)    ((docs++))    ;;
    config)  ((config++))  ;;
    chore)   ((chore++))   ;;
    scope)   ((scope++))   ;;
    unknown) ((unknown++)) ;;
  esac

  FILE_ENTRIES+=("{\"file\":\"$file\",\"category\":\"$category\"}")
done <<< "$STAGED"

TOTAL=$((plan + test_ + docs + config + chore + scope + unknown))

# Build summary JSON (omit zero-count categories)
SUMMARY_PARTS=()
[[ $plan    -gt 0 ]] && SUMMARY_PARTS+=('"plan":'$plan)
[[ $test_   -gt 0 ]] && SUMMARY_PARTS+=('"test":'$test_)
[[ $docs    -gt 0 ]] && SUMMARY_PARTS+=('"docs":'$docs)
[[ $config  -gt 0 ]] && SUMMARY_PARTS+=('"config":'$config)
[[ $chore   -gt 0 ]] && SUMMARY_PARTS+=('"chore":'$chore)
[[ $scope   -gt 0 ]] && SUMMARY_PARTS+=('"scope":'$scope)
[[ $unknown -gt 0 ]] && SUMMARY_PARTS+=('"unknown":'$unknown)

SUMMARY_JSON="{$(IFS=,; echo "${SUMMARY_PARTS[*]}")}"

# Build advisory text
ADVISORY_PARTS=()
[[ $plan    -gt 0 ]] && ADVISORY_PARTS+=("plan: $plan")
[[ $test_   -gt 0 ]] && ADVISORY_PARTS+=("test: $test_")
[[ $docs    -gt 0 ]] && ADVISORY_PARTS+=("docs: $docs")
[[ $config  -gt 0 ]] && ADVISORY_PARTS+=("config: $config")
[[ $chore   -gt 0 ]] && ADVISORY_PARTS+=("chore: $chore")
[[ $scope   -gt 0 ]] && ADVISORY_PARTS+=("scope: $scope")
[[ $unknown -gt 0 ]] && ADVISORY_PARTS+=("unknown: $unknown")

ADVISORY="Staged diff: $TOTAL file(s) — $(IFS=', '; echo "${ADVISORY_PARTS[*]}")"

# Build files JSON array
FILES_JSON="[$(IFS=,; echo "${FILE_ENTRIES[*]}")]"

printf '{"blocked":false,"advisory":"%s","classification":{"files":%s,"summary":%s,"total":%d}}' \
  "$ADVISORY" "$FILES_JSON" "$SUMMARY_JSON" "$TOTAL"
