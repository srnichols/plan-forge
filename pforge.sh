#!/usr/bin/env bash
# pforge — CLI wrapper for the Plan Forge Pipeline
# Convenience commands for common pipeline operations.
# Every command shows the equivalent manual steps.

set -euo pipefail

# ─── Find repo root ───────────────────────────────────────────────────
find_repo_root() {
    local dir
    dir="$(pwd)"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/.git" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    echo "ERROR: Not inside a git repository." >&2
    exit 2
}

REPO_ROOT="$(find_repo_root)"

# ─── Helpers ───────────────────────────────────────────────────────────
print_manual_steps() {
    local title="$1"; shift
    echo ""
    echo "Equivalent manual steps ($title):"
    local i=1
    for step in "$@"; do
        echo "  $i. $step"
        i=$((i + 1))
    done
    echo ""
}

show_help() {
    cat <<'EOF'

pforge — Plan Forge Pipeline CLI

COMMANDS:
  init              Bootstrap project with setup wizard (delegates to setup.sh)
  check             Validate setup (delegates to validate-setup.sh)
  status            Show all phases from DEPLOYMENT-ROADMAP.md with status
  new-phase <name>  Create a new phase plan file and add to roadmap
  branch <plan>     Create branch matching plan's declared Branch Strategy
  commit <plan> <N> Commit with conventional message from slice N's goal
  phase-status <plan> <status>  Update phase status in roadmap (planned|in-progress|complete|paused)
  sweep             Scan for TODO/FIXME/stub/placeholder markers in code files
  diff <plan>       Compare changed files against plan's Scope Contract
  ext install <p>   Install extension from path
  ext list          List installed extensions
  ext remove <name> Remove an installed extension
  help              Show this help message

OPTIONS:
  --dry-run         Show what would be done without making changes
  --force           Skip confirmation prompts
  --help            Show help for a specific command

EXAMPLES:
  ./pforge.sh init --preset dotnet
  ./pforge.sh status
  ./pforge.sh new-phase user-auth
  ./pforge.sh new-phase user-auth --dry-run
  ./pforge.sh branch docs/plans/Phase-1-USER-AUTH-PLAN.md
  ./pforge.sh ext list

EOF
}

# ─── Command: init ─────────────────────────────────────────────────────
cmd_init() {
    print_manual_steps "init" \
        "Run: ./setup.sh (with your preferred parameters)" \
        "Follow the interactive wizard"
    local script="$REPO_ROOT/setup.sh"
    if [ ! -f "$script" ]; then
        echo "ERROR: setup.sh not found at $script" >&2
        exit 1
    fi
    bash "$script" "$@"
}

# ─── Command: check ────────────────────────────────────────────────────
cmd_check() {
    print_manual_steps "check" \
        "Run: ./validate-setup.sh" \
        "Review the output for any missing files"
    local script="$REPO_ROOT/validate-setup.sh"
    if [ ! -f "$script" ]; then
        echo "ERROR: validate-setup.sh not found at $script" >&2
        exit 1
    fi
    bash "$script" "$@"
}

# ─── Command: status ───────────────────────────────────────────────────
cmd_status() {
    print_manual_steps "status" \
        "Open docs/plans/DEPLOYMENT-ROADMAP.md" \
        "Review the Phases section for status icons"

    local roadmap="$REPO_ROOT/docs/plans/DEPLOYMENT-ROADMAP.md"
    if [ ! -f "$roadmap" ]; then
        echo "ERROR: DEPLOYMENT-ROADMAP.md not found at $roadmap" >&2
        exit 1
    fi

    echo ""
    echo "Phase Status (from DEPLOYMENT-ROADMAP.md):"
    echo "─────────────────────────────────────────────"

    local current_phase="" current_goal=""
    while IFS= read -r line; do
        if [[ "$line" =~ ^###[[:space:]]+(Phase[[:space:]]+[0-9]+.*) ]]; then
            current_phase="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ \*\*Goal\*\*:[[:space:]]*(.+) ]]; then
            current_goal="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ \*\*Status\*\*:[[:space:]]*(.+) ]]; then
            if [ -n "$current_phase" ]; then
                echo "  $current_phase  ${BASH_REMATCH[1]}"
                [ -n "$current_goal" ] && echo "    $current_goal"
                current_phase="" current_goal=""
            fi
        fi
    done < "$roadmap"
    echo ""
}

# ─── Command: new-phase ────────────────────────────────────────────────
cmd_new_phase() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Phase name required." >&2
        echo "  Usage: pforge new-phase <name>" >&2
        exit 1
    fi

    local phase_name="$1"
    local dry_run=false
    for arg in "$@"; do
        [ "$arg" = "--dry-run" ] && dry_run=true
    done

    local upper_name
    upper_name="$(echo "$phase_name" | tr '[:lower:] ' '[:upper:]-')"

    local plans_dir="$REPO_ROOT/docs/plans"
    local next_num=1
    for f in "$plans_dir"/Phase-*-PLAN.md; do
        [ -f "$f" ] || continue
        local basename
        basename="$(basename "$f")"
        if [[ "$basename" =~ Phase-([0-9]+) ]]; then
            local num="${BASH_REMATCH[1]}"
            [ "$num" -ge "$next_num" ] && next_num=$((num + 1))
        fi
    done

    local file_name="Phase-${next_num}-${upper_name}-PLAN.md"
    local file_path="$plans_dir/$file_name"

    print_manual_steps "new-phase" \
        "Create file: docs/plans/$file_name" \
        "Add phase entry to docs/plans/DEPLOYMENT-ROADMAP.md" \
        "Fill in the plan using Step 1 (Draft) from the runbook"

    if $dry_run; then
        echo "[DRY RUN] Would create: $file_path"
        echo "[DRY RUN] Would add Phase $next_num entry to DEPLOYMENT-ROADMAP.md"
        return 0
    fi

    cat > "$file_path" <<TEMPLATE
# Phase $next_num: $phase_name

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase $next_num
> **Status**: 📋 Planned

---

## Overview

(Describe what this phase delivers)

---

## Prerequisites

- [ ] (list prerequisites)

## Acceptance Criteria

- [ ] (list measurable criteria)

---

## Execution Slices

(To be added during Plan Hardening — Step 2)
TEMPLATE
    echo "CREATED  $file_path"

    # Add entry to roadmap
    local roadmap="$REPO_ROOT/docs/plans/DEPLOYMENT-ROADMAP.md"
    if [ -f "$roadmap" ]; then
        local entry
        entry=$(cat <<ENTRY

---

### Phase ${next_num}: $phase_name
**Goal**: (one-line description)
**Plan**: [$file_name](./$file_name)
**Status**: 📋 Planned
ENTRY
)
        if grep -q "## Completed Phases" "$roadmap"; then
            sed -i.bak "s/## Completed Phases/${entry}\n\n## Completed Phases/" "$roadmap"
            rm -f "$roadmap.bak"
        else
            echo "$entry" >> "$roadmap"
        fi
        echo "UPDATED  DEPLOYMENT-ROADMAP.md (added Phase $next_num)"
    fi
}

# ─── Command: branch ───────────────────────────────────────────────────
cmd_branch() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Plan file path required." >&2
        echo "  Usage: pforge branch <plan-file>" >&2
        exit 1
    fi

    local plan_file="$1"
    local dry_run=false
    for arg in "$@"; do
        [ "$arg" = "--dry-run" ] && dry_run=true
    done

    [ ! -f "$plan_file" ] && plan_file="$REPO_ROOT/$plan_file"
    if [ ! -f "$plan_file" ]; then
        echo "ERROR: Plan file not found: $1" >&2
        exit 1
    fi

    local branch_name
    branch_name="$(grep -oP '\*\*Branch\*\*:\s*`\K[^`]+' "$plan_file" 2>/dev/null || true)"
    if [ -z "$branch_name" ]; then
        branch_name="$(grep -oP '\*\*Branch\*\*:\s*"\K[^"]+' "$plan_file" 2>/dev/null || true)"
    fi

    if [ -z "$branch_name" ] || [ "$branch_name" = "trunk" ]; then
        echo "No branch strategy declared (or trunk). No branch to create."
        return 0
    fi

    print_manual_steps "branch" \
        "Read the Branch Strategy section in your plan" \
        "Run: git checkout -b $branch_name"

    if $dry_run; then
        echo "[DRY RUN] Would create branch: $branch_name"
        return 0
    fi

    git checkout -b "$branch_name"
    echo "CREATED  branch: $branch_name"
}

# ─── Command: commit ───────────────────────────────────────────────────
cmd_commit() {
    if [ $# -lt 2 ]; then
        echo "ERROR: Plan file and slice number required." >&2
        echo "  Usage: pforge commit <plan-file> <slice-number>" >&2
        exit 1
    fi

    local plan_file="$1"
    local slice_num="$2"
    local dry_run=false
    for arg in "$@"; do
        [ "$arg" = "--dry-run" ] && dry_run=true
    done

    [ ! -f "$plan_file" ] && plan_file="$REPO_ROOT/$plan_file"
    if [ ! -f "$plan_file" ]; then
        echo "ERROR: Plan file not found: $1" >&2
        exit 1
    fi

    local plan_name
    plan_name="$(basename "$plan_file" .md)"

    # Extract phase number
    local phase_num=""
    if [[ "$plan_name" =~ Phase-([0-9]+) ]]; then
        phase_num="${BASH_REMATCH[1]}"
    fi

    # Extract slice goal
    local slice_goal="slice $slice_num"
    local goal_line
    goal_line="$(grep -A1 "### Slice.*${slice_num}" "$plan_file" | head -2 || true)"
    if [[ "$goal_line" =~ Slice[[:space:]]*[0-9.]*${slice_num}[[:space:]]*[:\—–-][[:space:]]*(.+) ]]; then
        slice_goal="${BASH_REMATCH[1]}"
    elif echo "$goal_line" | grep -q '^\*\*Goal\*\*:'; then
        slice_goal="$(echo "$goal_line" | grep '^\*\*Goal\*\*:' | sed 's/\*\*Goal\*\*:\s*//')"
    fi

    # Build commit message
    local scope
    if [ -n "$phase_num" ]; then
        scope="phase-$phase_num/slice-$slice_num"
    else
        scope="slice-$slice_num"
    fi
    local commit_msg="feat($scope): $slice_goal"

    print_manual_steps "commit" \
        "Read slice $slice_num goal from the plan" \
        "Run: git add -A" \
        "Run: git commit -m \"$commit_msg\""

    if $dry_run; then
        echo "[DRY RUN] Would commit with message:"
        echo "  $commit_msg"
        return 0
    fi

    git add -A
    git commit -m "$commit_msg"
    echo "COMMITTED  $commit_msg"
}

# ─── Command: phase-status ─────────────────────────────────────────────
cmd_phase_status() {
    if [ $# -lt 2 ]; then
        echo "ERROR: Plan file and status required." >&2
        echo "  Usage: pforge phase-status <plan-file> <status>" >&2
        echo "  Status: planned | in-progress | complete | paused" >&2
        exit 1
    fi

    local plan_file="$1"
    local new_status="$2"

    local status_text
    case "$new_status" in
        planned)     status_text="📋 Planned" ;;
        in-progress) status_text="🚧 In Progress" ;;
        complete)    status_text="✅ Complete" ;;
        paused)      status_text="⏸️ Paused" ;;
        *)
            echo "ERROR: Invalid status '$new_status'. Use: planned, in-progress, complete, paused" >&2
            exit 1
            ;;
    esac

    local plan_basename
    plan_basename="$(basename "$plan_file")"

    local roadmap="$REPO_ROOT/docs/plans/DEPLOYMENT-ROADMAP.md"
    if [ ! -f "$roadmap" ]; then
        echo "ERROR: DEPLOYMENT-ROADMAP.md not found." >&2
        exit 1
    fi

    print_manual_steps "phase-status" \
        "Open docs/plans/DEPLOYMENT-ROADMAP.md" \
        "Find the phase entry for $plan_basename" \
        "Change **Status**: to $status_text"

    # Update the status line following the plan link
    if grep -q "$plan_basename" "$roadmap"; then
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "/$plan_basename/{n;s/\*\*Status\*\*:.*/\*\*Status\*\*: $status_text/;}" "$roadmap"
        else
            sed -i "/$plan_basename/{n;s/\*\*Status\*\*:.*/\*\*Status\*\*: $status_text/;}" "$roadmap"
        fi
        echo "UPDATED  $plan_basename → $status_text"
    else
        echo "WARN: Could not find $plan_basename in roadmap. Update manually."
    fi
}

# ─── Command: sweep ────────────────────────────────────────────────────
cmd_sweep() {
    print_manual_steps "sweep" \
        "Search code files for: TODO, FIXME, HACK, stub, placeholder, mock data, will be replaced" \
        "Review each finding and resolve or document"

    echo ""
    echo "Completeness Sweep — scanning for deferred-work markers:"
    echo "─────────────────────────────────────────────────────────"

    local total=0
    local pattern='TODO|FIXME|HACK|will be replaced|placeholder|stub|mock data|Simulate|Seed with sample'

    while IFS= read -r -d '' file; do
        local results
        results="$(grep -niE "$pattern" "$file" 2>/dev/null || true)"
        if [ -n "$results" ]; then
            local rel_path="${file#"$REPO_ROOT/"}"
            while IFS= read -r line; do
                echo "  $rel_path:$line"
                total=$((total + 1))
            done <<< "$results"
        fi
    done < <(find "$REPO_ROOT" -type f \( -name "*.cs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.kt" -o -name "*.rs" -o -name "*.sql" -o -name "*.sh" -o -name "*.ps1" \) \
        ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/bin/*" ! -path "*/obj/*" ! -path "*/dist/*" ! -path "*/vendor/*" ! -path "*/__pycache__/*" \
        -print0)

    echo ""
    if [ "$total" -eq 0 ]; then
        echo "SWEEP CLEAN — zero deferred-work markers found."
    else
        echo "FOUND $total deferred-work marker(s). Resolve before Step 5 (Review Gate)."
    fi
}

# ─── Command: diff ─────────────────────────────────────────────────────
cmd_diff() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Plan file required." >&2
        echo "  Usage: pforge diff <plan-file>" >&2
        exit 1
    fi

    local plan_file="$1"
    [ ! -f "$plan_file" ] && plan_file="$REPO_ROOT/$plan_file"
    if [ ! -f "$plan_file" ]; then
        echo "ERROR: Plan file not found: $1" >&2
        exit 1
    fi

    print_manual_steps "diff" \
        "Run: git diff --name-only" \
        "Compare changed files against plan's In Scope and Forbidden Actions sections"

    # Get changed files
    local changed
    changed="$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)"
    changed="$(echo "$changed" | sort -u | grep -v '^$')"

    if [ -z "$changed" ]; then
        echo "No changed files detected."
        return 0
    fi

    local plan_content
    plan_content="$(cat "$plan_file")"

    # Extract forbidden paths (backtick-wrapped in Forbidden Actions section)
    local forbidden_section
    forbidden_section="$(echo "$plan_content" | awk '/### Forbidden Actions/,/^###? /' || true)"
    local forbidden_paths
    forbidden_paths="$(echo "$forbidden_section" | grep -oE '`[^`]+`' | tr -d '`' || true)"

    # Extract in-scope paths
    local inscope_section
    inscope_section="$(echo "$plan_content" | awk '/### In Scope/,/^###? /' || true)"
    local inscope_paths
    inscope_paths="$(echo "$inscope_section" | grep -oE '`[^`]+`' | tr -d '`' || true)"

    echo ""
    local file_count
    file_count="$(echo "$changed" | wc -l | tr -d ' ')"
    echo "Scope Drift Check — $file_count changed file(s) vs plan:"
    echo "───────────────────────────────────────────────────────────"

    local violations=0
    local out_of_scope=0

    while IFS= read -r file; do
        [ -z "$file" ] && continue

        # Check forbidden
        local is_forbidden=false
        while IFS= read -r fp; do
            [ -z "$fp" ] && continue
            if [[ "$file" == *"$fp"* ]]; then
                echo "  🔴 FORBIDDEN  $file  (matches: $fp)"
                violations=$((violations + 1))
                is_forbidden=true
                break
            fi
        done <<< "$forbidden_paths"
        $is_forbidden && continue

        # Check in-scope
        local is_in_scope=false
        if [ -z "$inscope_paths" ]; then
            is_in_scope=true
        else
            while IFS= read -r sp; do
                [ -z "$sp" ] && continue
                if [[ "$file" == *"$sp"* ]]; then
                    is_in_scope=true
                    break
                fi
            done <<< "$inscope_paths"
        fi

        if $is_in_scope; then
            echo "  ✅ IN SCOPE   $file"
        else
            echo "  🟡 UNPLANNED  $file  (not in Scope Contract)"
            out_of_scope=$((out_of_scope + 1))
        fi
    done <<< "$changed"

    echo ""
    if [ "$violations" -gt 0 ]; then
        echo "DRIFT DETECTED — $violations forbidden file(s) touched."
    elif [ "$out_of_scope" -gt 0 ]; then
        echo "POTENTIAL DRIFT — $out_of_scope file(s) not in Scope Contract. May need amendment."
    else
        echo "ALL CHANGES IN SCOPE — no drift detected."
    fi
}

# ─── Command: ext ──────────────────────────────────────────────────────
cmd_ext() {
    if [ $# -eq 0 ]; then
        echo "Extension commands:"
        echo "  ext install <path>  Install extension from path"
        echo "  ext list            List installed extensions"
        echo "  ext remove <name>   Remove an installed extension"
        return 0
    fi

    local subcmd="$1"; shift
    case "$subcmd" in
        install) cmd_ext_install "$@" ;;
        list)    cmd_ext_list ;;
        remove)  cmd_ext_remove "$@" ;;
        *)
            echo "ERROR: Unknown ext command: $subcmd" >&2
            echo "  Available: install, list, remove" >&2
            exit 1
            ;;
    esac
}

cmd_ext_install() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Extension path required." >&2
        echo "  Usage: pforge ext install <path>" >&2
        exit 1
    fi

    local ext_path="$1"
    [ ! -d "$ext_path" ] && ext_path="$REPO_ROOT/$ext_path"

    if [ ! -f "$ext_path/extension.json" ]; then
        echo "ERROR: extension.json not found in $ext_path" >&2
        exit 1
    fi

    local ext_name
    ext_name="$(python3 -c "import json; print(json.load(open('$ext_path/extension.json'))['name'])" 2>/dev/null || \
               grep -oP '"name"\s*:\s*"\K[^"]+' "$ext_path/extension.json" | head -1)"

    print_manual_steps "ext install" \
        "Copy extension folder to .forge/extensions/$ext_name/" \
        "Copy files from instructions/ → .github/instructions/" \
        "Copy files from agents/ → .github/agents/" \
        "Copy files from prompts/ → .github/prompts/"

    local dest_dir="$REPO_ROOT/.forge/extensions/$ext_name"
    mkdir -p "$dest_dir"
    cp -r "$ext_path/"* "$dest_dir/"
    echo "COPIED   extension to $dest_dir"

    for ft in instructions agents prompts; do
        local src_dir="$dest_dir/$ft"
        local dest_base="$REPO_ROOT/.github/$ft"
        if [ -d "$src_dir" ]; then
            mkdir -p "$dest_base"
            for f in "$src_dir"/*; do
                [ -f "$f" ] || continue
                local fname
                fname="$(basename "$f")"
                if [ ! -f "$dest_base/$fname" ]; then
                    cp "$f" "$dest_base/$fname"
                    echo "  INSTALL  .github/$ft/$fname"
                else
                    echo "  SKIP     .github/$ft/$fname (exists)"
                fi
            done
        fi
    done

    echo ""
    echo "Extension '$ext_name' installed."
}

cmd_ext_list() {
    print_manual_steps "ext list" \
        "Open .forge/extensions/extensions.json" \
        "Review the extensions array"

    local ext_json="$REPO_ROOT/.forge/extensions/extensions.json"
    if [ ! -f "$ext_json" ]; then
        echo "No extensions installed."
        return 0
    fi

    local count
    count="$(python3 -c "import json; d=json.load(open('$ext_json')); print(len(d.get('extensions',[])))" 2>/dev/null || echo "0")"

    if [ "$count" = "0" ]; then
        echo "No extensions installed."
        return 0
    fi

    echo ""
    echo "Installed Extensions:"
    echo "─────────────────────"
    python3 -c "
import json
d = json.load(open('$ext_json'))
for e in d.get('extensions', []):
    print(f\"  {e['name']} v{e['version']}  (installed {e.get('installedDate','unknown')})\")
" 2>/dev/null || grep -oP '"name"\s*:\s*"\K[^"]+' "$ext_json" | while read -r name; do
        echo "  $name"
    done
    echo ""
}

cmd_ext_remove() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Extension name required." >&2
        echo "  Usage: pforge ext remove <name>" >&2
        exit 1
    fi

    local ext_name="$1"
    local force=false
    for arg in "$@"; do
        [ "$arg" = "--force" ] && force=true
    done

    local ext_dir="$REPO_ROOT/.forge/extensions/$ext_name"
    if [ ! -f "$ext_dir/extension.json" ]; then
        echo "ERROR: Extension '$ext_name' not found." >&2
        exit 1
    fi

    if ! $force; then
        read -rp "Remove extension '$ext_name'? (y/N) " confirm
        [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && echo "Cancelled." && return 0
    fi

    print_manual_steps "ext remove" \
        "Remove extension files from .github/instructions/, .github/agents/, .github/prompts/" \
        "Delete .forge/extensions/$ext_name/" \
        "Update .forge/extensions/extensions.json"

    # Remove installed files listed in manifest
    for ft in instructions agents prompts; do
        local src_dir="$ext_dir/$ft"
        if [ -d "$src_dir" ]; then
            for f in "$src_dir"/*; do
                [ -f "$f" ] || continue
                local fname
                fname="$(basename "$f")"
                local target="$REPO_ROOT/.github/$ft/$fname"
                if [ -f "$target" ]; then
                    rm "$target"
                    echo "  REMOVE  .github/$ft/$fname"
                fi
            done
        fi
    done

    rm -rf "$ext_dir"
    echo "  REMOVE  .forge/extensions/$ext_name/"

    echo ""
    echo "Extension '$ext_name' removed."
}

# ─── Command Router ────────────────────────────────────────────────────
COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
    init)         cmd_init "$@" ;;
    check)        cmd_check "$@" ;;
    status)       cmd_status ;;
    new-phase)    cmd_new_phase "$@" ;;
    branch)       cmd_branch "$@" ;;
    commit)       cmd_commit "$@" ;;
    phase-status) cmd_phase_status "$@" ;;
    sweep)        cmd_sweep ;;
    diff)         cmd_diff "$@" ;;
    ext)          cmd_ext "$@" ;;
    help|--help)  show_help ;;
    *)
        echo "ERROR: Unknown command '$COMMAND'" >&2
        show_help
        exit 1
        ;;
esac
