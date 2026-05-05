#!/usr/bin/env bash
# sequence-plans.sh — Bash equivalent of sequence-plans.ps1
# Watches an in-flight pforge orchestrator (reads PID from .forge/last-orch.pid),
# waits for it to finish, then kicks off the next plan in the queue.
#
# Usage:
#   bash scripts/sequence-plans.sh \
#     --next-plan docs/plans/Phase-XYZ-PLAN.md \
#     --model claude-sonnet-4.6 \
#     --reason "Phase D follows Phase B"
#
# Source-safe: functions are available when script is sourced for testing.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
POLL_SECONDS=60
SKIP_COMMIT_PUSH=0
NEXT_PLAN=""
MODEL="claude-sonnet-4.6"
REASON="Sequenced plan run"

# ─── Helper functions ───────────────────────────────────────────────────────

get_current_orchestrator_pid() {
  local repo_root="${1:-$REPO_ROOT}"
  local pid_file="$repo_root/.forge/last-orch.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo ""
    return 0
  fi
  local content
  content=$(tr -d '[:space:]' < "$pid_file")
  if [[ "$content" =~ ^[0-9]+$ ]]; then
    echo "$content"
  else
    echo ""
  fi
}

test_orchestrator_alive() {
  local proc_id="${1:-}"
  if [[ -z "$proc_id" ]]; then
    return 1
  fi
  if kill -0 "$proc_id" 2>/dev/null; then
    return 0
  fi
  return 1
}

get_latest_run_dir() {
  local repo_root="${1:-$REPO_ROOT}"
  local runs_dir="$repo_root/.forge/runs"
  if [[ ! -d "$runs_dir" ]]; then
    echo ""
    return 0
  fi
  # Find newest subdirectory by modification time
  local latest
  latest=$(find "$runs_dir" -maxdepth 1 -mindepth 1 -type d -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | awk '{print $2}')
  echo "${latest:-}"
}

get_run_status() {
  local run_dir="${1:-}"
  local events_log="$run_dir/events.log"
  if [[ -z "$run_dir" || ! -f "$events_log" ]]; then
    echo "unknown"
    return 0
  fi
  local tail_content
  tail_content=$(tail -50 "$events_log")

  if echo "$tail_content" | grep -qE 'run-failed|run-aborted'; then
    echo "failed"
    return 0
  fi

  local completed_line
  completed_line=$(echo "$tail_content" | grep 'run-completed' | tail -1)
  if [[ -n "$completed_line" ]]; then
    # "failed":N with N >= 1 in JSON payload indicates slice failures
    if echo "$completed_line" | grep -qE '"failed":[1-9][0-9]*'; then
      echo "failed"
      return 0
    fi
    if echo "$completed_line" | grep -q '"status":"failed"'; then
      echo "failed"
      return 0
    fi
    echo "completed"
    return 0
  fi

  echo "in-progress"
}

write_stamp() {
  local msg="$1"
  echo "[$(date '+%H:%M:%S')] $msg"
}

# ─── Argument parsing ────────────────────────────────────────────────────────

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --next-plan)         NEXT_PLAN="$2";         shift 2 ;;
      --model)             MODEL="$2";              shift 2 ;;
      --reason)            REASON="$2";             shift 2 ;;
      --repo-root)         REPO_ROOT="$2";          shift 2 ;;
      --poll-seconds)      POLL_SECONDS="$2";       shift 2 ;;
      --skip-commit-push)  SKIP_COMMIT_PUSH=1;      shift   ;;
      *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
  done
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"

  if [[ -z "$NEXT_PLAN" ]]; then
    echo "Error: --next-plan is required" >&2
    exit 1
  fi

  cd "$REPO_ROOT"

  # Phase 1: wait for current run
  local initial_pid
  initial_pid=$(get_current_orchestrator_pid "$REPO_ROOT")

  if [[ -z "$initial_pid" ]]; then
    write_stamp "No orchestrator PID found in .forge/last-orch.pid — assuming nothing in flight."
  else
    write_stamp "Watching orchestrator PID $initial_pid (poll every ${POLL_SECONDS}s)..."
    local run_dir
    run_dir=$(get_latest_run_dir "$REPO_ROOT")
    write_stamp "Run dir: $run_dir"

    local iters=0
    while test_orchestrator_alive "$initial_pid"; do
      sleep "$POLL_SECONDS"
      iters=$((iters + 1))
      if (( iters % 5 == 0 )); then
        local last_event=""
        if [[ -f "$run_dir/events.log" ]]; then
          last_event=$(tail -1 "$run_dir/events.log")
          last_event="${last_event:0:120}"
        else
          last_event="(no log)"
        fi
        write_stamp "Still running (~$((iters * POLL_SECONDS / 60)) min). Last event: $last_event"
      fi
    done

    local final_status
    final_status=$(get_run_status "$run_dir")
    write_stamp "Orchestrator PID $initial_pid exited. Final status: $final_status"
    if [[ "$final_status" != "completed" ]]; then
      write_stamp "Run did not reach 'completed' (status=$final_status) - NOT proceeding. Inspect: $run_dir" >&2
      exit 1
    fi
  fi

  # Phase 2: commit + push pending work
  if [[ "$SKIP_COMMIT_PUSH" -eq 0 ]]; then
    local changes
    changes=$(git status --short)
    if [[ -n "$changes" ]]; then
      write_stamp "Committing in-flight Plan-Forge work before starting next plan..."
      git add -A
      local leaf
      leaf=$(basename "$NEXT_PLAN")
      git commit -m "feat(autoplan): commit in-flight changes before sequenced next-plan ($leaf)"
      git push origin master
    else
      write_stamp "No pending changes to commit."
    fi
  fi

  # Phase 3: kick off next plan
  if [[ ! -f "$NEXT_PLAN" ]]; then
    write_stamp "Next plan not found: $NEXT_PLAN" >&2
    exit 1
  fi
  write_stamp "Kicking off next plan: $NEXT_PLAN"
  "$REPO_ROOT/pforge.sh" run-plan "$NEXT_PLAN" \
    --model "$MODEL" \
    --manual-import \
    --manual-import-source human \
    --manual-import-reason "$REASON"
  write_stamp "Sequencer done. Monitor next run via .forge/runs/"
}

# Only run main if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
