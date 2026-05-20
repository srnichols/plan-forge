#!/usr/bin/env bash
# sequence-plans.tests.sh — Bash tests for scripts/sequence-plans.sh
#
# Covers the same logical cases as sequence-plans.tests.ps1 (Pester).
# No external test framework required — uses simple assert helpers.
#
# Usage: bash scripts/tests/sequence-plans.tests.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEQUENCE_PLANS="$SCRIPT_DIR/../sequence-plans.sh"

# Source the script in function-only mode (it guards against direct execution)
source "$SEQUENCE_PLANS" 2>/dev/null || true

PASS=0
FAIL=0

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc"
        echo "     expected: $expected"
        echo "     actual  : $actual"
        FAIL=$((FAIL + 1))
    fi
}

assert_empty() {
    local desc="$1" actual="$2"
    if [[ -z "$actual" ]]; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc (expected empty, got: $actual)"
        FAIL=$((FAIL + 1))
    fi
}

# ─── get_current_orchestrator_pid ───────────────────────────────────────────

echo ""
echo "Describe: get_current_orchestrator_pid"

echo "  Context: when the PID file does not exist"
tmp=$(mktemp -d)
result=$(REPO_ROOT="$tmp" get_current_orchestrator_pid "$tmp")
assert_empty "returns empty" "$result"
rm -rf "$tmp"

echo "  Context: when the PID file contains a valid integer"
tmp=$(mktemp -d)
mkdir -p "$tmp/.forge"
echo "12345" > "$tmp/.forge/last-orch.pid"
result=$(REPO_ROOT="$tmp" get_current_orchestrator_pid "$tmp")
assert_eq "returns the integer PID" "12345" "$result"
rm -rf "$tmp"

tmp=$(mktemp -d)
mkdir -p "$tmp/.forge"
printf '99999\n' > "$tmp/.forge/last-orch.pid"
result=$(REPO_ROOT="$tmp" get_current_orchestrator_pid "$tmp")
assert_eq "handles trailing newline in PID file" "99999" "$result"
rm -rf "$tmp"

echo "  Context: when the PID file contains non-numeric content"
tmp=$(mktemp -d)
mkdir -p "$tmp/.forge"
echo "not-a-pid" > "$tmp/.forge/last-orch.pid"
result=$(REPO_ROOT="$tmp" get_current_orchestrator_pid "$tmp")
assert_empty "returns empty for text content" "$result"
rm -rf "$tmp"

tmp=$(mktemp -d)
mkdir -p "$tmp/.forge"
echo "" > "$tmp/.forge/last-orch.pid"
result=$(REPO_ROOT="$tmp" get_current_orchestrator_pid "$tmp")
assert_empty "returns empty for empty file" "$result"
rm -rf "$tmp"

# ─── is_orchestrator_alive ───────────────────────────────────────────────────

echo ""
echo "Describe: test_orchestrator_alive"

echo "  Context: when ProcId is 0"
result=$(test_orchestrator_alive 0 2>/dev/null && echo "true" || echo "false")
assert_eq "returns false for 0" "false" "$result"

echo "  Context: when ProcId is a non-existent PID"
result=$(test_orchestrator_alive 2147483647 2>/dev/null && echo "true" || echo "false")
assert_eq "returns false for a non-existent PID" "false" "$result"

echo "  Context: when the process exists"
result=$(test_orchestrator_alive $$ 2>/dev/null && echo "true" || echo "false")
assert_eq "returns true for the current process" "true" "$result"

# ─── get_latest_run_dir ──────────────────────────────────────────────────────

echo ""
echo "Describe: get_latest_run_dir"

echo "  Context: when the runs directory does not exist"
tmp=$(mktemp -d)
result=$(REPO_ROOT="$tmp" get_latest_run_dir "$tmp")
assert_empty "returns empty" "$result"
rm -rf "$tmp"

echo "  Context: when the runs directory is empty"
tmp=$(mktemp -d)
mkdir -p "$tmp/.forge/runs"
result=$(REPO_ROOT="$tmp" get_latest_run_dir "$tmp")
assert_empty "returns empty" "$result"
rm -rf "$tmp"

echo "  Context: when multiple run directories exist"
tmp=$(mktemp -d)
mkdir -p "$tmp/.forge/runs/run-001"
sleep 0.01
mkdir -p "$tmp/.forge/runs/run-002"
# Update newer dir's mtime
touch "$tmp/.forge/runs/run-002"
result=$(REPO_ROOT="$tmp" get_latest_run_dir "$tmp")
assert_eq "returns the most recently modified directory" "$tmp/.forge/runs/run-002" "$result"
rm -rf "$tmp"

# ─── get_run_status ──────────────────────────────────────────────────────────

echo ""
echo "Describe: get_run_status"

echo "  Context: when RunDir is missing"
result=$(get_run_status "" 2>/dev/null)
assert_eq "returns unknown for empty RunDir" "unknown" "$result"

tmp=$(mktemp -d)
result=$(get_run_status "$tmp")
assert_eq "returns unknown when events.log is absent" "unknown" "$result"
rm -rf "$tmp"

echo "  Context: when events.log contains run-failed"
tmp=$(mktemp -d)
printf '{"event":"slice-started","slice":1}\n{"event":"run-failed","reason":"timeout"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns failed" "failed" "$result"
rm -rf "$tmp"

echo "  Context: when events.log contains run-aborted"
tmp=$(mktemp -d)
printf '{"event":"run-aborted"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns failed" "failed" "$result"
rm -rf "$tmp"

echo "  Context: when run-completed has slice failures"
tmp=$(mktemp -d)
printf '{"event":"run-completed","slices":5,"failed":2,"status":"partial"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns failed when failed:N > 0" "failed" "$result"
rm -rf "$tmp"

tmp=$(mktemp -d)
printf '{"event":"run-completed","failed":0,"status":"failed"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns failed when status field is failed" "failed" "$result"
rm -rf "$tmp"

echo "  Context: when run-completed shows clean success"
tmp=$(mktemp -d)
printf '{"event":"run-completed","slices":3,"failed":0,"status":"ok"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns completed" "completed" "$result"
rm -rf "$tmp"

tmp=$(mktemp -d)
printf '{"event":"run-completed"}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns completed when no failed key" "completed" "$result"
rm -rf "$tmp"

echo "  Context: when the log has no terminal event"
tmp=$(mktemp -d)
printf '{"event":"run-started"}\n{"event":"slice-started","slice":1}\n' > "$tmp/events.log"
result=$(get_run_status "$tmp")
assert_eq "returns in-progress" "in-progress" "$result"
rm -rf "$tmp"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "──────────────────────────────────────────────────"
echo "  Results:  $PASS passed  |  $FAIL failed"
echo "──────────────────────────────────────────────────"

[[ "$FAIL" -gt 0 ]] && exit 1 || exit 0
