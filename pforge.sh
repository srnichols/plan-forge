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
  update [source]   Update framework files from Plan Forge source (preserves customizations)
  analyze <plan>    Cross-artifact analysis — requirement traceability, test coverage, scope compliance
  smith             Inspect your forge — environment, VS Code config, setup health, and common problems
  help              Show this help message

OPTIONS:
  --dry-run         Show what would be done without making changes
  --force           Skip confirmation prompts
  --help            Show help for a specific command

EXAMPLES:
  ./pforge.sh init --preset dotnet
  ./pforge.sh init --preset dotnet,azure-iac
  ./pforge.sh status
  ./pforge.sh new-phase user-auth
  ./pforge.sh new-phase user-auth --dry-run
  ./pforge.sh branch docs/plans/Phase-1-USER-AUTH-PLAN.md
  ./pforge.sh ext list
  ./pforge.sh update ../plan-forge
  ./pforge.sh update --dry-run

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
        echo "  ext search [query]  Search the community catalog"
        echo "  ext add <name>      Download and install from catalog"
        echo "  ext info <name>     Show extension details"
        echo "  ext install <path>  Install extension from local path"
        echo "  ext list            List installed extensions"
        echo "  ext remove <name>   Remove an installed extension"
        return 0
    fi

    local subcmd="$1"; shift
    case "$subcmd" in
        search)  cmd_ext_search "$@" ;;
        add)     cmd_ext_add "$@" ;;
        info)    cmd_ext_info "$@" ;;
        install) cmd_ext_install "$@" ;;
        list)    cmd_ext_list ;;
        remove)  cmd_ext_remove "$@" ;;
        *)
            echo "ERROR: Unknown ext command: $subcmd" >&2
            echo "  Available: search, add, info, install, list, remove" >&2
            exit 1
            ;;
    esac
}

# ─── Catalog Helpers ───────────────────────────────────────────────────
CATALOG_URL="https://raw.githubusercontent.com/srnichols/plan-forge/master/extensions/catalog.json"

get_ext_catalog() {
    local local_catalog="$REPO_ROOT/extensions/catalog.json"
    if [ -f "$local_catalog" ]; then
        cat "$local_catalog"
        return 0
    fi
    curl -sS --max-time 10 "$CATALOG_URL" 2>/dev/null || {
        echo "ERROR: Could not fetch extension catalog." >&2
        return 1
    }
}

cmd_ext_search() {
    local query="${*:-}"
    local catalog
    catalog="$(get_ext_catalog)" || return 1

    echo ""
    if [ -n "$query" ]; then
        echo "Plan Forge Extension Catalog — matching '$query':"
    else
        echo "Plan Forge Extension Catalog:"
    fi
    echo "───────────────────────────────────────────────────────"

    # Parse with grep/sed (no jq dependency)
    local found=0
    local ids
    ids="$(echo "$catalog" | grep -oP '"id"\s*:\s*"\K[^"]+' || true)"

    for id in $ids; do
        local name desc category verified
        # Extract fields for this extension
        name="$(echo "$catalog" | grep -A1 "\"$id\"" | grep '"name"' | head -1 | sed 's/.*"name":\s*"//' | sed 's/".*//' || echo "$id")"
        desc="$(echo "$catalog" | grep -A20 "\"id\":\s*\"$id\"" | grep '"description"' | head -1 | sed 's/.*"description":\s*"//' | sed 's/".*//' || true)"
        category="$(echo "$catalog" | grep -A25 "\"id\":\s*\"$id\"" | grep '"category"' | head -1 | sed 's/.*"category":\s*"//' | sed 's/".*//' || true)"

        # Filter by query if provided
        if [ -n "$query" ]; then
            local q_lower
            q_lower="$(echo "$query" | tr '[:upper:]' '[:lower:]')"
            local match=false
            echo "$name $desc $category $id" | tr '[:upper:]' '[:lower:]' | grep -q "$q_lower" && match=true
            [ "$match" = false ] && continue
        fi

        echo "  ✅ $id  [$category]"
        echo "     $desc"
        found=$((found + 1))
    done

    if [ "$found" -eq 0 ]; then
        echo "  No extensions found$([ -n "$query" ] && echo " matching '$query'")."
    fi
    echo ""
    echo "Use 'pforge ext info <name>' for details, 'pforge ext add <name>' to install."
}

cmd_ext_add() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Extension name required." >&2
        echo "  Usage: pforge ext add <name>" >&2
        echo "  Browse: pforge ext search" >&2
        exit 1
    fi

    local ext_name="$1"
    local catalog
    catalog="$(get_ext_catalog)" || return 1

    # Check if extension exists in catalog
    if ! echo "$catalog" | grep -q "\"id\":\s*\"$ext_name\""; then
        echo "ERROR: Extension '$ext_name' not found in catalog." >&2
        echo "  Run 'pforge ext search' to see available extensions." >&2
        exit 1
    fi

    # Extract download URL and path_in_repo
    local download_url path_in_repo
    download_url="$(echo "$catalog" | grep -A30 "\"id\":\s*\"$ext_name\"" | grep '"download_url"' | head -1 | sed 's/.*"download_url":\s*"//' | sed 's/".*//')"
    path_in_repo="$(echo "$catalog" | grep -A30 "\"id\":\s*\"$ext_name\"" | grep '"path_in_repo"' | head -1 | sed 's/.*"path_in_repo":\s*"//' | sed 's/".*//')"

    echo ""
    echo "Installing: $ext_name"

    local temp_dir
    temp_dir="$(mktemp -d)/planforge-ext-$ext_name"
    mkdir -p "$temp_dir"

    # Download
    if [ -n "$download_url" ]; then
        local zip_file="$temp_dir/repo.zip"
        echo "  Downloading..."
        curl -sL "$download_url" -o "$zip_file" || {
            echo "ERROR: Download failed." >&2
            rm -rf "$temp_dir"
            exit 1
        }
        unzip -q "$zip_file" -d "$temp_dir" 2>/dev/null

        if [ -n "$path_in_repo" ]; then
            # Find extracted root (ZIP has repo-branch/ prefix)
            local repo_dir
            repo_dir="$(find "$temp_dir" -maxdepth 1 -type d ! -name "$(basename "$temp_dir")" | head -1)"
            local ext_source="$repo_dir/$path_in_repo"
            if [ ! -d "$ext_source" ]; then
                echo "ERROR: Path '$path_in_repo' not found in archive." >&2
                rm -rf "$temp_dir"
                exit 1
            fi
            cmd_ext_install "$ext_source"
        else
            cmd_ext_install "$temp_dir"
        fi
    fi

    rm -rf "$temp_dir"
    echo ""
    echo "Extension '$ext_name' installed from catalog."
}

cmd_ext_info() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Extension name required." >&2
        echo "  Usage: pforge ext info <name>" >&2
        exit 1
    fi

    local ext_name="$1"
    local catalog
    catalog="$(get_ext_catalog)" || return 1

    if ! echo "$catalog" | grep -q "\"id\":\s*\"$ext_name\""; then
        echo "ERROR: Extension '$ext_name' not found in catalog." >&2
        exit 1
    fi

    # Extract fields
    local block
    block="$(echo "$catalog" | grep -A40 "\"id\":\s*\"$ext_name\"")"
    local name desc author version category license repository
    name="$(echo "$block" | grep '"name"' | head -1 | sed 's/.*"name":\s*"//' | sed 's/".*//')"
    desc="$(echo "$block" | grep '"description"' | head -1 | sed 's/.*"description":\s*"//' | sed 's/".*//')"
    author="$(echo "$block" | grep '"author"' | head -1 | sed 's/.*"author":\s*"//' | sed 's/".*//')"
    version="$(echo "$block" | grep '"version"' | head -1 | sed 's/.*"version":\s*"//' | sed 's/".*//')"
    category="$(echo "$block" | grep '"category"' | head -1 | sed 's/.*"category":\s*"//' | sed 's/".*//')"
    license="$(echo "$block" | grep '"license"' | head -1 | sed 's/.*"license":\s*"//' | sed 's/".*//')"
    repository="$(echo "$block" | grep '"repository"' | head -1 | sed 's/.*"repository":\s*"//' | sed 's/".*//')"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  $name"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  ID:          $ext_name"
    echo "  Version:     $version"
    echo "  Author:      $author"
    echo "  Category:    $category"
    echo "  License:     $license"
    echo ""
    echo "  $desc"
    echo ""
    echo "  Repository:  $repository"
    echo ""
    echo "  Install: pforge ext add $ext_name"
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

# ─── Command: update ───────────────────────────────────────────────────
# SHA256 helper — portable Linux + macOS
_pf_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

cmd_update() {
    local dry_run=false force=false source_path=""

    for arg in "$@"; do
        case "$arg" in
            --dry-run) dry_run=true ;;
            --force)   force=true ;;
            --*) ;;
            *)
                if [ -z "$source_path" ] && [ -d "$arg" ]; then
                    source_path="$(cd "$arg" && pwd)"
                fi
                ;;
        esac
    done

    # Auto-detect source: sibling directories ../plan-forge or ../Plan-Forge
    if [ -z "$source_path" ]; then
        local parent
        parent="$(dirname "$REPO_ROOT")"
        for candidate in "$parent/plan-forge" "$parent/Plan-Forge"; do
            if [ -f "$candidate/VERSION" ]; then
                source_path="$(cd "$candidate" && pwd)"
                break
            fi
        done
    fi

    if [ -z "$source_path" ]; then
        echo "ERROR: Plan Forge source not found." >&2
        echo "  Provide the path to your Plan Forge clone:" >&2
        echo "    ./pforge.sh update /path/to/plan-forge" >&2
        echo "  Or clone it next to your project:" >&2
        echo "    git clone https://github.com/srnichols/plan-forge.git ../plan-forge" >&2
        exit 1
    fi

    print_manual_steps "update" \
        "Clone/pull the latest Plan Forge template repo" \
        "Compare .forge.json templateVersion with the source VERSION" \
        "Copy updated framework files (prompts, agents, skills, hooks, runbook)" \
        "Skip files that don't exist in the target (user hasn't adopted that feature)" \
        "Never overwrite copilot-instructions.md, project-profile, project-principles, or plan files"

    # ─── Read versions ────────────────────────────────────────────
    local source_version
    source_version="$(tr -d '[:space:]' < "$source_path/VERSION")"

    local config_path="$REPO_ROOT/.forge.json"
    local current_version="unknown" current_preset_raw="custom"

    if [ -f "$config_path" ]; then
        current_version="$(python3 -c "import json; print(json.load(open('$config_path')).get('templateVersion','unknown'))" 2>/dev/null || \
                           grep -oP '"templateVersion":\s*"\K[^"]+' "$config_path" 2>/dev/null | head -1 || echo "unknown")"
        current_preset_raw="$(python3 -c "
import json
v = json.load(open('$config_path')).get('preset', 'custom')
print(v if isinstance(v, str) else ','.join(v))
" 2>/dev/null || grep -oP '"preset":\s*"\K[^"]+' "$config_path" 2>/dev/null | head -1 || echo "custom")"
    fi

    echo ""
    echo "Plan Forge Update"
    echo "─────────────────────────────────────────────"
    echo "  Source:   $source_path"
    echo "  Current:  v$current_version"
    echo "  Latest:   v$source_version"
    echo "  Preset:   $current_preset_raw"
    echo ""

    if [ "$current_version" = "$source_version" ] && ! $force; then
        echo "Already up to date (v$current_version). Use --force to re-apply."
        return 0
    fi

    # ─── Never-update list (relative paths) ───────────────────────
    local _never_update=(
        ".github/copilot-instructions.md"
        ".github/instructions/project-profile.instructions.md"
        ".github/instructions/project-principles.instructions.md"
        "docs/plans/DEPLOYMENT-ROADMAP.md"
        "docs/plans/PROJECT-PRINCIPLES.md"
        "AGENTS.md"
        ".forge.json"
    )

    # ─── Change tracking arrays: "src|dst|name" tuples ────────────
    local _updates=() _new_files=()

    # Inner helper — compare src vs dst, populate _updates / _new_files
    _pf_check() {
        local src="$1" dst="$2" rel="$3"
        local nu
        for nu in "${_never_update[@]}"; do
            [ "$nu" = "$rel" ] && return 0
        done
        [ -f "$src" ] || return 0
        if [ -f "$dst" ]; then
            if [ "$(_pf_sha256 "$src")" != "$(_pf_sha256 "$dst")" ]; then
                _updates+=("$src|$dst|$rel")
            fi
        else
            _new_files+=("$src|$dst|$rel")
        fi
    }

    # ─── Step prompts (step*.prompt.md) ───────────────────────────
    local src_prompts="$source_path/.github/prompts"
    if [ -d "$src_prompts" ]; then
        while IFS= read -r -d '' f; do
            local fname_p
            fname_p="$(basename "$f")"
            _pf_check "$f" "$REPO_ROOT/.github/prompts/$fname_p" ".github/prompts/$fname_p"
        done < <(find "$src_prompts" -maxdepth 1 -name "step*.prompt.md" -type f -print0 2>/dev/null)
    fi

    # ─── Pipeline agents ──────────────────────────────────────────
    local src_agents="$source_path/templates/.github/agents"
    if [ -d "$src_agents" ]; then
        local agent_name
        for agent_name in "specifier.agent.md" "plan-hardener.agent.md" "executor.agent.md" "reviewer-gate.agent.md" "shipper.agent.md"; do
            _pf_check "$src_agents/$agent_name" "$REPO_ROOT/.github/agents/$agent_name" ".github/agents/$agent_name"
        done
    fi

    # ─── Shared instructions ──────────────────────────────────────
    local src_instr="$source_path/.github/instructions"
    if [ -d "$src_instr" ]; then
        local instr_name
        for instr_name in "architecture-principles.instructions.md" "git-workflow.instructions.md" "ai-plan-hardening-runbook.instructions.md"; do
            _pf_check "$src_instr/$instr_name" "$REPO_ROOT/.github/instructions/$instr_name" ".github/instructions/$instr_name"
        done
    fi

    # ─── Runbook docs ─────────────────────────────────────────────
    local src_docs="$source_path/docs/plans"
    if [ -d "$src_docs" ]; then
        local doc_name
        for doc_name in "AI-Plan-Hardening-Runbook.md" "AI-Plan-Hardening-Runbook-Instructions.md" "DEPLOYMENT-ROADMAP-TEMPLATE.md" "PROJECT-PRINCIPLES-TEMPLATE.md"; do
            _pf_check "$src_docs/$doc_name" "$REPO_ROOT/docs/plans/$doc_name" "docs/plans/$doc_name"
        done
    fi

    # ─── Hooks ────────────────────────────────────────────────────
    local src_hooks="$source_path/templates/.github/hooks"
    if [ -d "$src_hooks" ]; then
        while IFS= read -r -d '' f; do
            local fname_h
            fname_h="$(basename "$f")"
            _pf_check "$f" "$REPO_ROOT/.github/hooks/$fname_h" ".github/hooks/$fname_h"
        done < <(find "$src_hooks" -maxdepth 1 -type f -print0 2>/dev/null)
    fi

    # ─── Preset-specific files (instructions, agents, prompts, skills) ─
    local _presets=()
    IFS=',' read -ra _presets <<< "$current_preset_raw"

    local p
    for p in "${_presets[@]}"; do
        p="${p// /}"          # trim whitespace
        [ "$p" = "custom" ] && continue

        local src_preset="$source_path/presets/$p/.github"
        [ -d "$src_preset" ] || continue

        echo "  Checking preset: $p"

        local sub_dir
        for sub_dir in instructions agents prompts; do
            local src_sub="$src_preset/$sub_dir"
            [ -d "$src_sub" ] || continue
            while IFS= read -r -d '' f; do
                local fname_s rel dst _skip
                fname_s="$(basename "$f")"
                rel=".github/$sub_dir/$fname_s"
                dst="$REPO_ROOT/.github/$sub_dir/$fname_s"
                # Skip existing files — they may have been customized
                [ -f "$dst" ] && continue
                # Skip never-update list entries
                _skip=false
                for nu in "${_never_update[@]}"; do
                    [ "$nu" = "$rel" ] && _skip=true && break
                done
                $_skip || _new_files+=("$f|$dst|$rel")
            done < <(find "$src_sub" -maxdepth 1 -type f -print0 2>/dev/null)
        done

        # Skills — add new subdirectories only; existing SKILL.md files may be customized
        local src_skills="$src_preset/skills"
        if [ -d "$src_skills" ]; then
            local skill_dir skill_name skill_src skill_dst
            for skill_dir in "$src_skills"/*/; do
                [ -d "$skill_dir" ] || continue
                skill_name="$(basename "$skill_dir")"
                skill_src="$skill_dir/SKILL.md"
                skill_dst="$REPO_ROOT/.github/skills/$skill_name/SKILL.md"
                [ -f "$skill_src" ] || continue
                # Only add if skill doesn't exist yet
                [ -f "$skill_dst" ] && continue
                _new_files+=("$skill_src|$skill_dst|.github/skills/$skill_name/SKILL.md")
            done
        fi
    done

    unset -f _pf_check

    # ─── MCP server files ────────────────────────────────────────
    local src_mcp="$SOURCE_PATH/mcp"
    local dst_mcp="$REPO_ROOT/mcp"
    if [ -d "$src_mcp" ]; then
        for mcp_file in server.mjs package.json; do
            local src_f="$src_mcp/$mcp_file"
            local dst_f="$dst_mcp/$mcp_file"
            if [ -f "$src_f" ]; then
                if [ -f "$dst_f" ]; then
                    local src_hash dst_hash
                    src_hash="$(sha256sum "$src_f" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$src_f" | cut -d' ' -f1)"
                    dst_hash="$(sha256sum "$dst_f" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$dst_f" | cut -d' ' -f1)"
                    if [ "$src_hash" != "$dst_hash" ]; then
                        _updates+=("$src_f|$dst_f|mcp/$mcp_file")
                    fi
                else
                    _new_files+=("$src_f|$dst_f|mcp/$mcp_file")
                fi
            fi
        done
    fi

    # ─── Report ───────────────────────────────────────────────────
    if [ "${#_updates[@]}" -eq 0 ] && [ "${#_new_files[@]}" -eq 0 ]; then
        echo "All framework files are up to date."
        return 0
    fi

    echo "Changes found:"
    local entry
    for entry in "${_updates[@]}"; do
        echo "  UPDATE  ${entry##*|}"
    done
    for entry in "${_new_files[@]}"; do
        echo "  NEW     ${entry##*|}"
    done
    echo ""
    echo "Protected (never updated):"
    echo "  .github/copilot-instructions.md, project-profile, project-principles,"
    echo "  DEPLOYMENT-ROADMAP.md, AGENTS.md, plan files, .forge.json"
    echo ""

    if $dry_run; then
        echo "DRY RUN — no files were changed."
        return 0
    fi

    # ─── Confirm ──────────────────────────────────────────────────
    if ! $force; then
        read -rp "Apply ${#_updates[@]} updates and ${#_new_files[@]} new files? [y/N] " confirm
        case "$confirm" in
            y|Y|yes|Yes) ;;
            *) echo "Cancelled."; return 0 ;;
        esac
    fi

    # ─── Apply updates ────────────────────────────────────────────
    for entry in "${_updates[@]}"; do
        local src="${entry%%|*}" rest="${entry#*|}"
        local dst="${rest%%|*}" name="${rest##*|}"
        cp "$src" "$dst"
        echo "  ✅ Updated $name"
    done

    # ─── Apply new files ──────────────────────────────────────────
    for entry in "${_new_files[@]}"; do
        local src="${entry%%|*}" rest="${entry#*|}"
        local dst="${rest%%|*}" name="${rest##*|}"
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        echo "  ✅ Added $name"
    done

    # ─── Update .forge.json templateVersion ───────────────────────
    if [ -f "$config_path" ]; then
        if command -v python3 >/dev/null 2>&1; then
            python3 -c "
import json
with open('$config_path') as f:
    c = json.load(f)
c['templateVersion'] = '$source_version'
with open('$config_path', 'w') as f:
    json.dump(c, f, indent=2)
    f.write('\n')
"
        else
            sed -i.bak "s/\"templateVersion\": \"[^\"]*\"/\"templateVersion\": \"$source_version\"/" "$config_path"
            rm -f "$config_path.bak"
        fi
        echo "  ✅ Updated .forge.json templateVersion to $source_version"
    fi

    echo ""
    echo "Update complete: v$current_version → v$source_version"
    echo "Run 'pforge check' to validate the updated setup."

    # Check if MCP files were updated — remind to reinstall deps
    local mcp_updated=false
    for entry in "${_updates[@]}" "${_new_files[@]}"; do
        local entry_name="${entry##*|}"
        if [[ "$entry_name" == mcp/* ]]; then
            mcp_updated=true
            break
        fi
    done
    if [ "$mcp_updated" = true ]; then
        echo ""
        echo "MCP server files were updated. Run: cd mcp && npm install"
    fi
}

# ─── Command: analyze ──────────────────────────────────────────────────
cmd_analyze() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Plan file required." >&2
        echo "  Usage: pforge analyze <plan-file>" >&2
        exit 1
    fi

    local plan_file="$1"
    [ ! -f "$plan_file" ] && plan_file="$REPO_ROOT/$plan_file"
    if [ ! -f "$plan_file" ]; then
        echo "ERROR: Plan file not found: $1" >&2
        exit 1
    fi

    print_manual_steps "analyze" \
        "Parse plan for requirements, slices, gates, scope" \
        "Cross-reference git changes against scope contract" \
        "Match acceptance criteria against test files" \
        "Score traceability, coverage, completeness, gates"

    local plan_content
    plan_content="$(cat "$plan_file")"
    local plan_name
    plan_name="$(basename "$plan_file" .md)"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       Plan Forge — Analyze                                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Plan: $plan_name"
    echo ""

    local score_trace=0 score_coverage=0 score_tests=0 score_gates=0

    # ═══════════════════════════════════════════════════════════════
    # 1. TRACEABILITY
    # ═══════════════════════════════════════════════════════════════
    echo "Traceability:"

    local must_count should_count slice_count
    must_count=$(echo "$plan_content" | grep -ciE '^\s*[-*]\s*\*\*MUST\*\*' || echo 0)
    should_count=$(echo "$plan_content" | grep -ciE '^\s*[-*]\s*\*\*SHOULD\*\*' || echo 0)
    slice_count=$(echo "$plan_content" | grep -c '^### Slice [0-9]' || echo 0)
    local total_criteria=$((must_count + should_count))

    if [ "$total_criteria" -gt 0 ]; then
        echo "  ✅ $total_criteria acceptance criteria ($must_count MUST, $should_count SHOULD)"
        score_trace=$((25 * total_criteria / total_criteria))  # Full if found
    else
        if echo "$plan_content" | grep -qiE 'acceptance criteria|definition of done'; then
            echo "  ✅ Acceptance criteria section detected (non-standard format)"
            score_trace=15
        else
            echo "  ⚠️  No MUST/SHOULD criteria found"
        fi
    fi

    if [ "$slice_count" -gt 0 ]; then
        echo "  ✅ $slice_count execution slices found"
        [ "$score_trace" -eq 0 ] && score_trace=10
    else
        echo "  ⚠️  No execution slices found"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 2. SCOPE COMPLIANCE
    # ═══════════════════════════════════════════════════════════════
    echo "Coverage:"

    local changed_files
    changed_files="$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)"
    changed_files="$(echo "$changed_files" | sort -u | grep -v '^$')"
    local total_changed
    total_changed="$(echo "$changed_files" | grep -c '.' || echo 0)"

    local violations=0 out_of_scope=0 in_scope=0

    if [ "$total_changed" -gt 0 ]; then
        # Extract forbidden paths
        local forbidden
        forbidden="$(echo "$plan_content" | sed -n '/### Forbidden Actions/,/^###/p' | grep -oP '`\K[^`]+' || true)"

        for file in $changed_files; do
            local is_forbidden=false
            for fp in $forbidden; do
                if echo "$file" | grep -q "$fp"; then
                    violations=$((violations + 1))
                    is_forbidden=true
                    break
                fi
            done
            [ "$is_forbidden" = true ] && continue
            in_scope=$((in_scope + 1))
        done
        out_of_scope=$((total_changed - in_scope - violations))

        echo "  ✅ $total_changed changed files analyzed"
        [ "$violations" -gt 0 ] && echo "  ❌ $violations forbidden file(s) touched"
        [ "$out_of_scope" -gt 0 ] && echo "  ⚠️  $out_of_scope file(s) outside Scope Contract"
        [ "$violations" -eq 0 ] && [ "$out_of_scope" -eq 0 ] && echo "  ✅ All changes within Scope Contract"

        score_coverage=$((25 * in_scope / total_changed))
        [ "$violations" -gt 0 ] && score_coverage=$((score_coverage > 10 ? score_coverage - 10 : 0))
    else
        echo "  ✅ No uncommitted changes (analyzing plan structure only)"
        score_coverage=25
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 3. TEST COVERAGE
    # ═══════════════════════════════════════════════════════════════
    echo "Test Coverage:"

    local test_file_count=0
    test_file_count=$(find "$REPO_ROOT" -type f \( -name "*.test.*" -o -name "*.spec.*" -o -name "*Tests.cs" -o -name "*Test.java" -o -name "*_test.go" -o -name "test_*.py" -o -name "*_test.py" \) ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/bin/*' ! -path '*/obj/*' 2>/dev/null | wc -l | tr -d ' ')

    if [ "$test_file_count" -gt 0 ]; then
        echo "  ✅ $test_file_count test file(s) found in project"
        score_tests=20
    else
        echo "  ⚠️  No test files found"
        score_tests=5
    fi

    if [ "$must_count" -gt 0 ]; then
        echo "  ✅ $must_count MUST criteria to verify against tests"
        [ "$test_file_count" -gt 0 ] && score_tests=25
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 4. VALIDATION GATES
    # ═══════════════════════════════════════════════════════════════
    echo "Validation Gates:"

    local gates_found=0
    gates_found=$(echo "$plan_content" | grep -ciE 'validation gate|build.*pass|test.*pass|\- \[ \].*build|\- \[ \].*test' || echo 0)

    if [ "$gates_found" -gt 0 ]; then
        echo "  ✅ $gates_found validation gate reference(s) found"
        score_gates=25
    elif [ "$slice_count" -gt 0 ]; then
        echo "  ⚠️  Slices found but no explicit validation gates"
        score_gates=10
    else
        echo "  ⚠️  No validation gates found"
        score_gates=0
    fi

    # Deferred work markers in changed files
    local marker_count=0
    if [ "$total_changed" -gt 0 ]; then
        for file in $changed_files; do
            local full_path="$REPO_ROOT/$file"
            if [ -f "$full_path" ]; then
                local mc
                mc=$(grep -ciE 'TODO|FIXME|HACK|stub|placeholder|mock data' "$full_path" 2>/dev/null || echo 0)
                marker_count=$((marker_count + mc))
            fi
        done
    fi

    if [ "$marker_count" -eq 0 ]; then
        echo "  ✅ 0 deferred-work markers in changed files"
    else
        echo "  ⚠️  $marker_count deferred-work marker(s) in changed files"
        score_gates=$((score_gates > 5 ? score_gates - 5 : 0))
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # CONSISTENCY SCORE
    # ═══════════════════════════════════════════════════════════════
    local total_score=$((score_trace + score_coverage + score_tests + score_gates))

    echo "Consistency Score: $total_score/100"
    echo "  - Traceability: $score_trace/25"
    echo "  - Coverage: $score_coverage/25"
    echo "  - Test Coverage: $score_tests/25"
    echo "  - Gates: $score_gates/25"

    echo ""
    echo "────────────────────────────────────────────────────"
    echo "  ${total_criteria:-0} requirements  |  $slice_count slices  |  ${total_changed:-0} files  |  $total_score% consistent"
    echo "────────────────────────────────────────────────────"

    if [ "$total_score" -lt 60 ]; then
        echo ""
        echo "ANALYSIS FAILED — score below 60%."
        exit 1
    elif [ "$total_score" -lt 80 ]; then
        echo ""
        echo "ANALYSIS WARNING — score below 80%."
        exit 0
    else
        echo ""
        echo "ANALYSIS PASSED — strong consistency."
        exit 0
    fi
}

# ─── Command: doctor ───────────────────────────────────────────────────
cmd_doctor() {
    print_manual_steps "smith" \
        "Check that required tools are installed (git, VS Code, bash)" \
        "Verify VS Code settings for Copilot agent mode" \
        "Validate .forge.json and file counts per preset" \
        "Check version currency against Plan Forge source" \
        "Scan for common problems (duplicates, orphans, broken references)"

    local d_pass=0 d_fail=0 d_warn=0

    doctor_pass()  { echo "  ✅ $1"; d_pass=$((d_pass + 1)); }
    doctor_fail()  { echo "  ❌ $1"; [ -n "${2:-}" ] && echo "     FIX: $2"; d_fail=$((d_fail + 1)); }
    doctor_warn()  { echo "  ⚠️  $1"; [ -n "${2:-}" ] && echo "     FIX: $2"; d_warn=$((d_warn + 1)); }

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       Plan Forge — The Smith                                  ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 1. ENVIRONMENT
    # ═══════════════════════════════════════════════════════════════
    echo "Environment:"

    # Git
    if command -v git &>/dev/null; then
        local git_ver
        git_ver="$(git --version 2>/dev/null | sed 's/git version //')"
        doctor_pass "git $git_ver"
    else
        doctor_fail "git not found" "Install from https://git-scm.com/downloads"
    fi

    # VS Code CLI
    if command -v code &>/dev/null; then
        local code_ver
        code_ver="$(code --version 2>/dev/null | head -1)"
        doctor_pass "code (VS Code CLI) ${code_ver:-found}"
    elif command -v code-insiders &>/dev/null; then
        doctor_pass "code-insiders (VS Code CLI) found"
    else
        doctor_warn "VS Code CLI not in PATH (optional)" "Open VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'"
    fi

    # Bash version
    local bash_ver="${BASH_VERSION:-unknown}"
    doctor_pass "bash $bash_ver"

    # Optional: GitHub CLI
    if command -v gh &>/dev/null; then
        local gh_ver
        gh_ver="$(gh --version 2>/dev/null | head -1 | sed 's/gh version //' | sed 's/ .*//')"
        doctor_pass "gh (GitHub CLI) $gh_ver"
    else
        doctor_warn "gh (GitHub CLI) not found (optional)" "Install from https://cli.github.com/"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 2. VS CODE CONFIGURATION
    # ═══════════════════════════════════════════════════════════════
    echo "VS Code Configuration:"

    local settings_path="$REPO_ROOT/.vscode/settings.json"
    if [ -f "$settings_path" ]; then
        # Check for key settings (basic grep — no jq dependency required)
        if grep -q '"chat.agent.enabled"' "$settings_path" 2>/dev/null; then
            if grep -q '"chat.agent.enabled":\s*true' "$settings_path" 2>/dev/null || grep -q '"chat.agent.enabled": true' "$settings_path" 2>/dev/null; then
                doctor_pass "chat.agent.enabled = true"
            else
                doctor_fail "chat.agent.enabled = false" "Set to true in .vscode/settings.json"
            fi
        else
            doctor_pass "chat.agent.enabled (default — OK)"
        fi

        if grep -q '"chat.useCustomizationsInParentRepositories"' "$settings_path" 2>/dev/null; then
            if grep -q '"chat.useCustomizationsInParentRepositories": true' "$settings_path" 2>/dev/null; then
                doctor_pass "chat.useCustomizationsInParentRepositories = true"
            else
                doctor_warn "chat.useCustomizationsInParentRepositories is not true" "Set to true for monorepo support"
            fi
        else
            doctor_warn "chat.useCustomizationsInParentRepositories not set" 'Add "chat.useCustomizationsInParentRepositories": true to .vscode/settings.json'
        fi

        if grep -q '"chat.promptFiles"' "$settings_path" 2>/dev/null; then
            if grep -q '"chat.promptFiles": true' "$settings_path" 2>/dev/null; then
                doctor_pass "chat.promptFiles = true"
            else
                doctor_warn "chat.promptFiles is not true" "Set to true to enable prompt template discovery"
            fi
        else
            doctor_warn "chat.promptFiles not set" 'Add "chat.promptFiles": true to .vscode/settings.json'
        fi
    else
        doctor_warn ".vscode/settings.json not found" "Run 'pforge init' or create it manually"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 3. SETUP HEALTH
    # ═══════════════════════════════════════════════════════════════
    echo "Setup Health:"

    local config_path="$REPO_ROOT/.forge.json"
    local preset="unknown"
    local template_version="unknown"

    if [ -f "$config_path" ]; then
        # Parse with grep/sed (no jq dependency)
        preset="$(grep -o '"preset"[^,}]*' "$config_path" | sed 's/"preset":\s*"//' | sed 's/"//' || echo "unknown")"
        template_version="$(grep -o '"templateVersion"[^,}]*' "$config_path" | sed 's/"templateVersion":\s*"//' | sed 's/"//' || echo "unknown")"
        doctor_pass ".forge.json valid (preset: $preset, v$template_version)"

        # Check configured agents
        local configured_agents
        configured_agents="$(grep -o '"agents"[^,}]*' "$config_path" | sed 's/"agents":\s*"//' | sed 's/"//' || echo "copilot")"
        [ -z "$configured_agents" ] && configured_agents="copilot"

        IFS=',' read -ra agent_arr <<< "$configured_agents"
        for ag in "${agent_arr[@]}"; do
            ag="$(echo "$ag" | tr -d ' ')"
            case "$ag" in
                copilot)
                    [ -f "$REPO_ROOT/.github/copilot-instructions.md" ] \
                        && doctor_pass "Agent: copilot (configured)" \
                        || doctor_warn "Agent: copilot configured but .github/copilot-instructions.md missing"
                    ;;
                claude)
                    [ -f "$REPO_ROOT/CLAUDE.md" ] \
                        && doctor_pass "Agent: claude (CLAUDE.md + .claude/skills/)" \
                        || doctor_warn "Agent: claude configured but CLAUDE.md missing" "Re-run setup with --agent claude"
                    ;;
                cursor)
                    [ -f "$REPO_ROOT/.cursor/rules" ] \
                        && doctor_pass "Agent: cursor (.cursor/rules + commands/)" \
                        || doctor_warn "Agent: cursor configured but .cursor/rules missing" "Re-run setup with --agent cursor"
                    ;;
                codex)
                    [ -d "$REPO_ROOT/.agents/skills" ] \
                        && doctor_pass "Agent: codex (.agents/skills/)" \
                        || doctor_warn "Agent: codex configured but .agents/skills/ missing" "Re-run setup with --agent codex"
                    ;;
            esac
        done
    else
        doctor_fail ".forge.json not found" "Run 'pforge init' to bootstrap your project"
    fi

    local copilot_instr="$REPO_ROOT/.github/copilot-instructions.md"
    if [ -f "$copilot_instr" ]; then
        doctor_pass ".github/copilot-instructions.md exists"
    else
        doctor_fail ".github/copilot-instructions.md missing" "Run 'pforge init' to create it"
    fi

    # File count checks (use first preset for multi-preset)
    local preset_key="${preset%%,*}"
    local exp_instr=3 exp_agents=5 exp_prompts=7 exp_skills=0
    case "$preset_key" in
        dotnet|typescript|python|java|go|azure-iac)
            exp_instr=14; exp_agents=17; exp_prompts=9; exp_skills=8 ;;
        custom)
            exp_instr=3; exp_agents=5; exp_prompts=7; exp_skills=0 ;;
    esac

    if [ "$preset_key" != "unknown" ]; then
        local instr_count=0 agent_count=0 prompt_count=0 skill_count=0

        [ -d "$REPO_ROOT/.github/instructions" ] && instr_count=$(find "$REPO_ROOT/.github/instructions" -name "*.instructions.md" -type f 2>/dev/null | wc -l | tr -d ' ')
        [ -d "$REPO_ROOT/.github/agents" ]       && agent_count=$(find "$REPO_ROOT/.github/agents" -name "*.agent.md" -type f 2>/dev/null | wc -l | tr -d ' ')
        [ -d "$REPO_ROOT/.github/prompts" ]      && prompt_count=$(find "$REPO_ROOT/.github/prompts" -name "*.prompt.md" -type f 2>/dev/null | wc -l | tr -d ' ')
        [ -d "$REPO_ROOT/.github/skills" ]       && skill_count=$(find "$REPO_ROOT/.github/skills" -name "SKILL.md" -type f 2>/dev/null | wc -l | tr -d ' ')

        [ "$instr_count" -ge "$exp_instr" ] \
            && doctor_pass "$instr_count instruction files (expected: >=$exp_instr for $preset_key)" \
            || doctor_warn "$instr_count instruction files (expected: >=$exp_instr for $preset_key)" "Run 'pforge update' to get missing files"

        [ "$agent_count" -ge "$exp_agents" ] \
            && doctor_pass "$agent_count agent definitions (expected: >=$exp_agents for $preset_key)" \
            || doctor_warn "$agent_count agent definitions (expected: >=$exp_agents for $preset_key)" "Run 'pforge update' to get missing agents"

        [ "$prompt_count" -ge "$exp_prompts" ] \
            && doctor_pass "$prompt_count prompt templates (expected: >=$exp_prompts for $preset_key)" \
            || doctor_warn "$prompt_count prompt templates (expected: >=$exp_prompts for $preset_key)" "Run 'pforge update' to get missing prompts"

        [ "$skill_count" -ge "$exp_skills" ] \
            && doctor_pass "$skill_count skills (expected: >=$exp_skills for $preset_key)" \
            || doctor_warn "$skill_count skills (expected: >=$exp_skills for $preset_key)" "Run 'pforge update' to get missing skills"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 4. VERSION CURRENCY
    # ═══════════════════════════════════════════════════════════════
    echo "Version Currency:"

    local source_version=""
    local parent_dir
    parent_dir="$(dirname "$REPO_ROOT")"
    for candidate in "$parent_dir/plan-forge" "$parent_dir/Plan-Forge"; do
        if [ -f "$candidate/VERSION" ]; then
            source_version="$(cat "$candidate/VERSION" | tr -d '[:space:]')"
            break
        fi
    done

    if [ -n "$source_version" ]; then
        if [ "$template_version" = "$source_version" ]; then
            doctor_pass "Up to date (v$template_version)"
        elif [ "$template_version" = "unknown" ]; then
            doctor_warn "Cannot determine installed version (.forge.json missing)"
        else
            doctor_warn "Installed v$template_version — latest is v$source_version" "Run 'pforge update' to upgrade"
        fi
    else
        doctor_pass "Installed v$template_version (source repo not found nearby — skipping currency check)"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 4b. MCP SERVER
    # ═══════════════════════════════════════════════════════════════
    echo "MCP Server:"

    local mcp_server="$REPO_ROOT/mcp/server.mjs"
    if [ -f "$mcp_server" ]; then
        doctor_pass "mcp/server.mjs exists"

        [ -f "$REPO_ROOT/mcp/package.json" ] \
            || doctor_warn "mcp/package.json missing" "Copy from Plan Forge template"

        if [ -d "$REPO_ROOT/mcp/node_modules" ]; then
            doctor_pass "MCP dependencies installed"
        else
            doctor_warn "MCP dependencies not installed" "Run: cd mcp && npm install"
        fi

        if [ -f "$REPO_ROOT/.vscode/mcp.json" ]; then
            if grep -q '"plan-forge"' "$REPO_ROOT/.vscode/mcp.json" 2>/dev/null; then
                doctor_pass ".vscode/mcp.json has 'plan-forge' server entry"
            else
                doctor_warn ".vscode/mcp.json missing 'plan-forge' entry" "Re-run setup or add manually"
            fi
        else
            doctor_warn ".vscode/mcp.json not found" "Run setup to generate MCP config"
        fi
    else
        doctor_pass "MCP server not installed (optional — run setup to add)"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 5. COMMON PROBLEMS
    # ═══════════════════════════════════════════════════════════════
    echo "Common Problems:"

    local problems_found=false

    # 5a. Duplicate instruction files (case-insensitive)
    if [ -d "$REPO_ROOT/.github/instructions" ]; then
        local dupes
        dupes="$(find "$REPO_ROOT/.github/instructions" -name "*.instructions.md" -type f -exec basename {} \; 2>/dev/null | tr '[:upper:]' '[:lower:]' | sort | uniq -d)"
        if [ -n "$dupes" ]; then
            doctor_fail "Duplicate instruction files detected: $dupes" "Remove duplicates from .github/instructions/"
            problems_found=true
        fi
    fi

    # 5b. Orphaned agents in AGENTS.md
    local agents_md="$REPO_ROOT/AGENTS.md"
    local agents_dir="$REPO_ROOT/.github/agents"
    if [ -f "$agents_md" ] && [ -d "$agents_dir" ]; then
        local referenced
        referenced="$(grep -oE '[a-z0-9-]+\.agent\.md' "$agents_md" 2>/dev/null | sort -u)"
        for ref in $referenced; do
            if [ ! -f "$agents_dir/$ref" ]; then
                doctor_warn "AGENTS.md references '$ref' but file not found in .github/agents/" "Remove from AGENTS.md or run 'pforge update'"
                problems_found=true
            fi
        done
    fi

    # 5c. Instruction files missing applyTo
    if [ -d "$REPO_ROOT/.github/instructions" ]; then
        for f in "$REPO_ROOT/.github/instructions/"*.instructions.md; do
            [ -f "$f" ] || continue
            if head -5 "$f" | grep -q '^---' && ! grep -q 'applyTo' "$f"; then
                local fname
                fname="$(basename "$f")"
                doctor_warn "$fname has frontmatter but no applyTo pattern" "Add 'applyTo: **' or a specific glob pattern"
                problems_found=true
            fi
        done
    fi

    # 5d. Unresolved placeholders in copilot-instructions.md
    if [ -f "$copilot_instr" ]; then
        local ph_count=0
        local ph_list=""
        for ph in '<YOUR PROJECT NAME>' '<YOUR TECH STACK>' '<YOUR BUILD COMMAND>' '<YOUR TEST COMMAND>' '<YOUR LINT COMMAND>' '<YOUR DEV COMMAND>' '<DATE>'; do
            if grep -qF "$ph" "$copilot_instr" 2>/dev/null; then
                ph_count=$((ph_count + 1))
                ph_list="${ph_list:+$ph_list, }$ph"
            fi
        done
        if [ "$ph_count" -gt 0 ]; then
            doctor_warn "copilot-instructions.md has $ph_count unresolved placeholder(s): $ph_list" "Edit .github/copilot-instructions.md and fill in your project details"
            problems_found=true
        fi
    fi

    # 5e. Roadmap missing
    if [ ! -f "$REPO_ROOT/docs/plans/DEPLOYMENT-ROADMAP.md" ]; then
        doctor_warn "DEPLOYMENT-ROADMAP.md not found" "Run 'pforge init' or create docs/plans/DEPLOYMENT-ROADMAP.md"
        problems_found=true
    fi

    if [ "$problems_found" = false ]; then
        doctor_pass "No common problems detected"
    fi

    # ═══════════════════════════════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════════════════════════════
    echo ""
    echo "────────────────────────────────────────────────────"
    echo "  Results:  $d_pass passed  |  $d_fail failed  |  $d_warn warnings"
    echo "────────────────────────────────────────────────────"

    if [ "$d_fail" -gt 0 ]; then
        echo ""
        echo "Fix the $d_fail issue(s) above for the best Plan Forge experience."
        exit 1
    elif [ "$d_warn" -gt 0 ]; then
        echo ""
        echo "$d_warn warning(s) — review the suggestions above."
        exit 0
    else
        echo ""
        echo "Your forge is ready. Happy smithing!"
        exit 0
    fi
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
    update)       cmd_update "$@" ;;
    analyze)      cmd_analyze "$@" ;;
    smith)        cmd_smith ;;
    help|--help)  show_help ;;
    *)
        echo "ERROR: Unknown command '$COMMAND'" >&2
        show_help
        exit 1
        ;;
esac
