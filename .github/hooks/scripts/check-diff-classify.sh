#!/usr/bin/env bash
# Plan Forge — Diff-Classify PreCommit chain entry
# Classifies the staged diff against security/safety categories.
# Returns { "blocked": true, "message": "..." } on severity >= high or an unreadable diff.
# Returns { "blocked": false, "advisory": "..." } on medium.
# Returns {} on low/none.
# The logic lives in check-diff-classify.mjs: Node reads the staged diff itself,
# because passing it through an environment variable failed on large diffs.

set -euo pipefail

exec node "$(dirname "${BASH_SOURCE[0]}")/check-diff-classify.mjs"
