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
  ext publish <p>   Validate and generate catalog entry for publishing
  update [source]   Update framework files from Plan Forge source (preserves customizations)
  analyze <plan>    Cross-artifact analysis — requirement traceability, test coverage, scope compliance
  run-plan <plan>   Execute a hardened plan — spawn CLI workers, validate at every boundary, track tokens
  org-rules export  Export org custom instructions from .github/instructions/ for GitHub org settings
  drift             Score codebase against architecture guardrail rules — track drift over time
  incident <desc>   Capture an incident — record description, severity, affected files, and optional resolvedAt for MTTR
  deploy-log <ver>  Record a deployment — log version, deployer, optional notes, and optional slice reference
  triage            Triage open alerts — rank incidents and drift violations by priority
  regression-guard  Run validation gates from plan files — guard against regressions when files change
  runbook <plan>    Generate an operational runbook from a hardened plan file
  hotspot           Identify git churn hotspots — most frequently changed files
  secret-scan       Scan recent commits for leaked secrets using Shannon entropy analysis
  env-diff          Compare environment variable keys across .env files — detect missing keys
  health-trend      Health trend analysis — drift, cost, incidents, model performance over time
  quorum-analyze    Assemble a quorum analysis prompt from LiveGuard data for multi-model dispatch
  smith             Inspect your forge — environment, VS Code config, setup health, and common problems
  tour              Guided walkthrough of your installed Plan Forge files
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
  ./pforge.sh run-plan docs/plans/Phase-1-AUTH-PLAN.md
  ./pforge.sh run-plan docs/plans/Phase-1-AUTH-PLAN.md --estimate
  ./pforge.sh run-plan docs/plans/Phase-1-AUTH-PLAN.md --assisted
  ./pforge.sh ext list
  ./pforge.sh org-rules export
  ./pforge.sh org-rules export --format markdown --output org-rules.md
  ./pforge.sh update ../plan-forge
  ./pforge.sh update --dry-run
  ./pforge.sh update --check

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
    local framework_total=0
    local fw_todo=0 fw_fixme=0 fw_hack=0 fw_placeholder=0 fw_stub=0 fw_other=0
    local pattern='TODO|FIXME|HACK|will be replaced|placeholder|stub|mock data|Simulate|Seed with sample'
    local framework_pattern='^(pforge-mcp/|pforge\.(ps1|sh)$|setup\.(ps1|sh)$|validate-setup\.(ps1|sh)$)'

    while IFS= read -r -d '' file; do
        local results
        results="$(grep -niE "$pattern" "$file" 2>/dev/null || true)"
        if [ -n "$results" ]; then
            local rel_path="${file#"$REPO_ROOT/"}"
            local is_framework=false
            if echo "$rel_path" | grep -qE "$framework_pattern"; then
                is_framework=true
            fi
            while IFS= read -r line; do
                if [ "$is_framework" = true ]; then
                    framework_total=$((framework_total + 1))
                    case "$line" in
                        *TODO*)        fw_todo=$((fw_todo + 1)) ;;
                        *FIXME*)       fw_fixme=$((fw_fixme + 1)) ;;
                        *HACK*)        fw_hack=$((fw_hack + 1)) ;;
                        *placeholder*) fw_placeholder=$((fw_placeholder + 1)) ;;
                        *stub*)        fw_stub=$((fw_stub + 1)) ;;
                        *)             fw_other=$((fw_other + 1)) ;;
                    esac
                else
                    echo "  $rel_path:$line"
                    total=$((total + 1))
                fi
            done <<< "$results"
        fi
    done < <(find "$REPO_ROOT" -type f \( -name "*.cs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.kt" -o -name "*.rs" -o -name "*.sql" -o -name "*.sh" -o -name "*.ps1" \) \
        ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/bin/*" ! -path "*/obj/*" ! -path "*/dist/*" ! -path "*/vendor/*" ! -path "*/__pycache__/*" \
        -print0)

    echo ""
    if [ "$total" -eq 0 ]; then
        echo "SWEEP CLEAN — zero deferred-work markers found in app code."
    else
        echo "FOUND $total deferred-work marker(s) in app code. Resolve before Step 5 (Review Gate)."
    fi
    if [ "$framework_total" -gt 0 ]; then
        local breakdown=""
        [ "$fw_todo" -gt 0 ] && breakdown="${breakdown}TODO: $fw_todo, "
        [ "$fw_fixme" -gt 0 ] && breakdown="${breakdown}FIXME: $fw_fixme, "
        [ "$fw_hack" -gt 0 ] && breakdown="${breakdown}HACK: $fw_hack, "
        [ "$fw_placeholder" -gt 0 ] && breakdown="${breakdown}placeholder: $fw_placeholder, "
        [ "$fw_stub" -gt 0 ] && breakdown="${breakdown}stub: $fw_stub, "
        [ "$fw_other" -gt 0 ] && breakdown="${breakdown}other: $fw_other, "
        breakdown="${breakdown%, }"
        echo "  ($framework_total marker(s) in framework code — $breakdown)"
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
        exit 1
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
        echo "  ext search [query]   Search the community catalog"
        echo "  ext add <name>       Download and install from catalog"
        echo "  ext info <name>      Show extension details"
        echo "  ext install <path>   Install extension from local path"
        echo "  ext list             List installed extensions"
        echo "  ext remove <name>    Remove an installed extension"
        echo "  ext publish <path>   Validate and generate catalog entry for publishing"
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
        publish) cmd_ext_publish "$@" ;;
        *)
            echo "ERROR: Unknown ext command: $subcmd" >&2
            echo "  Available: search, add, info, install, list, remove, publish" >&2
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

cmd_ext_publish() {
    if [ $# -eq 0 ]; then
        echo "ERROR: Extension path required." >&2
        echo "  Usage: pforge ext publish <path>" >&2
        echo "  Validates extension.json and prints the catalog entry to submit." >&2
        exit 1
    fi

    local ext_path="$1"
    [ ! -d "$ext_path" ] && ext_path="$REPO_ROOT/$ext_path"

    if [ ! -f "$ext_path/extension.json" ]; then
        echo "ERROR: extension.json not found in $ext_path" >&2
        exit 1
    fi

    # Extract all required fields
    local ext_json_file="$ext_path/extension.json"
    local id name description author version download_url repository license category effect

    _ext_field() { grep -oP "\"$1\"\s*:\s*\"\K[^\"]+" "$ext_json_file" | head -1; }

    id="$(_ext_field id)"
    name="$(_ext_field name)"
    description="$(_ext_field description)"
    author="$(_ext_field author)"
    version="$(_ext_field version)"
    download_url="$(_ext_field download_url)"
    repository="$(_ext_field repository)"
    license="$(_ext_field license)"
    category="$(_ext_field category)"
    effect="$(_ext_field effect)"

    local errors=0

    # Validate required fields
    for field_name in id name description author version download_url repository license category effect; do
        eval "field_val=\$$field_name"
        if [ -z "$field_val" ]; then
            echo "  MISSING  $field_name (required in extension.json)"
            errors=$((errors + 1))
        fi
    done

    # Validate category
    case "$category" in
        code|docs|process|integration|visibility) ;;
        "")  ;;  # already reported above
        *)
            echo "  INVALID  category '$category' — must be one of: code, docs, process, integration, visibility"
            errors=$((errors + 1))
            ;;
    esac

    # Validate effect
    case "$effect" in
        "Read-only"|"Read+Write") ;;
        "") ;;  # already reported above
        *)
            echo "  INVALID  effect '$effect' — must be 'Read-only' or 'Read+Write'"
            errors=$((errors + 1))
            ;;
    esac

    # Validate README
    if [ ! -f "$ext_path/README.md" ]; then
        echo "  MISSING  README.md (recommended for catalog)"
        errors=$((errors + 1))
    fi

    if [ "$errors" -gt 0 ]; then
        echo ""
        echo "ERROR: $errors validation error(s) — fix extension.json before publishing." >&2
        exit 1
    fi

    # Extract optional provides counts
    local inst_count agents_count prompts_count skills_count
    if command -v python3 >/dev/null 2>&1; then
        inst_count="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(d.get('provides',{}).get('instructions',0))" 2>/dev/null || echo "0")"
        agents_count="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(d.get('provides',{}).get('agents',0))" 2>/dev/null || echo "0")"
        prompts_count="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(d.get('provides',{}).get('prompts',0))" 2>/dev/null || echo "0")"
        skills_count="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(d.get('provides',{}).get('skills',0))" 2>/dev/null || echo "0")"
    else
        inst_count=0; agents_count=0; prompts_count=0; skills_count=0
    fi

    local speckit_compat
    speckit_compat="$(grep -oP '"speckit_compatible"\s*:\s*\K(true|false)' "$ext_json_file" | head -1)"
    [ -z "$speckit_compat" ] && speckit_compat="false"

    local planforge_ver
    planforge_ver="$(grep -oP '"planforge_version"\s*:\s*"\K[^\"]+"' "$ext_json_file" | head -1 | tr -d '"')"
    [ -z "$planforge_ver" ] && planforge_ver=">=1.2.0"

    local tags_json
    if command -v python3 >/dev/null 2>&1; then
        tags_json="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(json.dumps(d.get('tags', [])))" 2>/dev/null || echo "[]")"
    else
        tags_json="[]"
    fi

    local now
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"

    # Build Spec Kit files arrays (instructions→rules, agents→agents)
    local speckit_rules speckit_agents
    if command -v python3 >/dev/null 2>&1; then
        speckit_rules="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(json.dumps(d.get('files',{}).get('instructions',[])+d.get('files',{}).get('rules',[])))" 2>/dev/null || echo "[]")"
        speckit_agents="$(python3 -c "import json; d=json.load(open('$ext_json_file')); print(json.dumps(d.get('files',{}).get('agents',[])))" 2>/dev/null || echo "[]")"
    else
        speckit_rules="[]"
        speckit_agents="[]"
    fi

    echo ""
    echo "✓ Validation passed — extension is ready to publish."
    echo ""
    echo "Plan Forge Catalog Entry:"
    echo "────────────────────────────────────────────────────────────────"
    echo "Add to extensions/catalog.json in a fork of srnichols/plan-forge:"
    cat <<EOF
    "$id": {
      "name": "$name",
      "id": "$id",
      "description": "$description",
      "author": "$author",
      "version": "$version",
      "download_url": "$download_url",
      "repository": "$repository",
      "license": "$license",
      "category": "$category",
      "effect": "$effect",
      "requires": {
        "planforge_version": "$planforge_ver"
      },
      "provides": {
        "instructions": $inst_count,
        "agents": $agents_count,
        "prompts": $prompts_count,
        "skills": $skills_count
      },
      "tags": $tags_json,
      "speckit_compatible": $speckit_compat,
      "verified": false,
      "created_at": "$now",
      "updated_at": "$now"
    }
EOF
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "Spec Kit Catalog Entry:"
    echo "────────────────────────────────────────────────────────────────"
    echo "Add to your Spec Kit extensions.json:"
    cat <<EOF
{
  "name": "$id",
  "version": "$version",
  "description": "$description",
  "files": {
    "rules": $speckit_rules,
    "agents": $speckit_agents
  }
}
EOF
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "Next steps:"
    echo "  1. Fork https://github.com/srnichols/plan-forge"
    echo "  2. Edit extensions/catalog.json — add the Plan Forge entry above"
    echo "  3. Open a PR with title: feat(catalog): add $id"
    echo "     Link your extension repository in the PR description."
    echo "  4. If Spec Kit compatible, add the Spec Kit entry to your Spec Kit extensions.json"
    echo ""
    echo "  Full guide: extensions/PUBLISHING.md"
}

# ─── Command: update ───────────────────────────────────────────────────
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
            --dry-run|--check) dry_run=true ;;
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

    # ─── Core root files (CLI scripts + VERSION) ─────────────────
    local core_file
    for core_file in "pforge.ps1" "pforge.sh" "VERSION"; do
        local src_core="$source_path/$core_file"
        local dst_core="$REPO_ROOT/$core_file"
        if [ -f "$src_core" ]; then
            if [ -f "$dst_core" ]; then
                if [ "$(_pf_sha256 "$src_core")" != "$(_pf_sha256 "$dst_core")" ]; then
                    _updates+=("$src_core|$dst_core|$core_file")
                fi
            else
                _new_files+=("$src_core|$dst_core|$core_file")
            fi
        fi
    done

    # ─── MCP server files (auto-discover all files) ──────────────
    local src_mcp="$source_path/pforge-mcp"
    local dst_mcp="$REPO_ROOT/pforge-mcp"
    if [ -d "$src_mcp" ]; then
        while IFS= read -r -d '' f; do
            local rel_path rel_name dst_f
            rel_path="${f#"$src_mcp/"}"
            rel_name="pforge-mcp/$rel_path"
            dst_f="$dst_mcp/$rel_path"
            local _skip=false
            for nu in "${_never_update[@]}"; do
                [ "$nu" = "$rel_name" ] && _skip=true && break
            done
            $_skip && continue
            if [ -f "$dst_f" ]; then
                if [ "$(_pf_sha256 "$f")" != "$(_pf_sha256 "$dst_f")" ]; then
                    _updates+=("$f|$dst_f|$rel_name")
                fi
            else
                _new_files+=("$f|$dst_f|$rel_name")
            fi
        done < <(find "$src_mcp" -type f -not -path '*/node_modules/*' -print0 2>/dev/null)
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
        if [[ "$entry_name" == pforge-mcp/* ]]; then
            mcp_updated=true
            break
        fi
    done
    if [ "$mcp_updated" = true ]; then
        # Auto-install MCP dependencies
        local mcp_dir="$REPO_ROOT/pforge-mcp"
        if [ -f "$mcp_dir/package.json" ]; then
            echo ""
            echo "Installing MCP dependencies..."
            if (cd "$mcp_dir" && npm install --silent 2>/dev/null); then
                echo "  ✅ npm install complete"
            else
                echo "  ⚠️  npm install failed — run manually: cd pforge-mcp && npm install"
            fi
        fi

        # Detect if MCP server is running and advise restart
        if curl -s --max-time 2 "http://localhost:3100/api/status" >/dev/null 2>&1; then
            echo ""
            echo "⚠️  MCP server is running on port 3100 — restart it to pick up changes."
            echo "  Stop the current server, then: node pforge-mcp/server.mjs"
        fi
    fi

    # Check if CLI itself was updated
    local cli_updated=false
    for entry in "${_updates[@]}" "${_new_files[@]}"; do
        local entry_name="${entry##*|}"
        if [ "$entry_name" = "pforge.ps1" ] || [ "$entry_name" = "pforge.sh" ]; then
            cli_updated=true
            break
        fi
    done
    if [ "$cli_updated" = true ]; then
        echo ""
        echo "ℹ️  CLI scripts (pforge.ps1/pforge.sh) were updated."
        echo "  The new version is already on disk. No restart needed."
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

# ─── Command: drift ────────────────────────────────────────────────────
cmd_drift() {
    local threshold=70
    for arg in "$@"; do
        case "$arg" in
            --threshold=*) threshold="${arg#*=}" ;;
            --threshold)   shift; threshold="$1" ;;
            [0-9]*)        threshold="$arg" ;;
        esac
    done

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       Plan Forge — Drift Report                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Scanning source files for architecture guardrail violations..."
    echo "Threshold: $threshold/100"
    echo ""

    local files_scanned=0
    local violation_count=0
    local violations_json="["
    local first_violation=true
    local penalty_per_violation=2

    # Scan source files for guardrail violations
    while IFS= read -r -d '' file; do
        files_scanned=$((files_scanned + 1))
        local rel="${file#$REPO_ROOT/}"
        local content
        content=$(cat "$file" 2>/dev/null) || continue

        check_rule() {
            local rule_id="$1" pattern="$2" severity="$3" label="$4"
            local line_num=1 found=false
            while IFS= read -r line; do
                if echo "$line" | grep -qE "$pattern" 2>/dev/null; then
                    violation_count=$((violation_count + 1))
                    if [ "$first_violation" = "true" ]; then
                        first_violation=false
                    else
                        violations_json="$violations_json,"
                    fi
                    local escaped_rel escaped_label
                    escaped_rel=$(printf '%s' "$rel" | sed 's/\\/\\\\/g; s/"/\\"/g')
                    escaped_label=$(printf '%s' "$label" | sed 's/"/\\"/g')
                    violations_json="$violations_json{\"file\":\"$escaped_rel\",\"rule\":\"$rule_id\",\"severity\":\"$severity\",\"line\":$line_num,\"description\":\"$escaped_label\"}"
                fi
                line_num=$((line_num + 1))
            done <<< "$content"
        }

        check_rule "empty-catch"     'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*(//[^}]*)?[[:space:]]*\}'   "high"     "Empty catch block"
        check_rule "any-type"        ':[[:space:]]*any[[:space:];|,>]|<any>|as[[:space:]]+any'  "medium"   "Avoid 'any' type"
        check_rule "sync-over-async" '\.(Result|Wait\(\))'                                      "high"     "Sync-over-async"
        check_rule "sql-injection"   'SELECT|INSERT|UPDATE|DELETE.*\$\{'                        "critical" "SQL string interpolation"
        check_rule "deferred-work"   '\b(TODO|FIXME|HACK)\b'                                    "low"      "Deferred work marker"

    done < <(find "$REPO_ROOT" -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.cs" -o -name "*.py" \) \
        ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/bin/*' ! -path '*/obj/*' \
        ! -path '*/dist/*' ! -path '*/.forge/*' ! -path '*/vendor/*' ! -path '*/coverage/*' \
        -print0 2>/dev/null)

    violations_json="$violations_json]"

    local score=$(( 100 - violation_count * penalty_per_violation ))
    [ "$score" -lt 0 ] && score=0

    printf "Files scanned:  %d\n" "$files_scanned"
    if [ "$violation_count" -eq 0 ]; then
        printf "Violations:     \033[32m%d\033[0m\n" "$violation_count"
    elif [ "$violation_count" -le 5 ]; then
        printf "Violations:     \033[33m%d\033[0m\n" "$violation_count"
    else
        printf "Violations:     \033[31m%d\033[0m\n" "$violation_count"
    fi
    if [ "$score" -ge 80 ]; then
        printf "Score:          \033[32m%d/100\033[0m\n" "$score"
    elif [ "$score" -ge "$threshold" ]; then
        printf "Score:          \033[33m%d/100\033[0m\n" "$score"
    else
        printf "Score:          \033[31m%d/100\033[0m\n" "$score"
    fi
    echo ""

    # Append to drift-history.json
    local forge_dir="$REPO_ROOT/.forge"
    mkdir -p "$forge_dir"
    local history_file="$forge_dir/drift-history.json"
    local prev_score=""
    local history_count=0
    if [ -f "$history_file" ]; then
        history_count=$(grep -c '"score"' "$history_file" 2>/dev/null || echo 0)
        prev_score=$(grep -o '"score":[0-9]*' "$history_file" 2>/dev/null | tail -1 | grep -o '[0-9]*$')
    fi

    local delta=0 trend="stable"
    if [ -n "$prev_score" ]; then
        delta=$((score - prev_score))
        if [ "$delta" -gt 0 ]; then trend="improving"
        elif [ "$delta" -lt 0 ]; then trend="degrading"
        fi
    fi

    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
    local record="{\"timestamp\":\"$ts\",\"score\":$score,\"filesScanned\":$files_scanned,\"delta\":$delta,\"trend\":\"$trend\",\"violations\":$violations_json}"
    echo "$record" >> "$history_file"

    local history_length=$((history_count + 1))
    printf "Trend:          %s\n" "$trend"
    printf "History:        %d record(s) in .forge/drift-history.json\n" "$history_length"
    echo ""

    if [ "$score" -lt "$threshold" ]; then
        printf "\033[31m⚠  DRIFT ALERT — score %d is below threshold %d\033[0m\n" "$score" "$threshold"
        exit 1
    else
        printf "\033[32m✅ Drift score within threshold (%d >= %d)\033[0m\n" "$score" "$threshold"
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
        dotnet|typescript|python|java|go|swift|azure-iac)
            exp_instr=15; exp_agents=17; exp_prompts=9; exp_skills=8 ;;
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
    local version_check_cache="$REPO_ROOT/.forge/version-check.json"
    local cache_valid=false

    # Try cache first (skip network call if < 24h old)
    if [ -f "$version_check_cache" ]; then
        local cached_ver cached_at cache_age_s
        cached_ver="$(python3 -c "import json; print(json.load(open('$version_check_cache')).get('latestVersion',''))" 2>/dev/null \
                      || grep -oP '"latestVersion"\s*:\s*"\K[^"]+' "$version_check_cache" 2>/dev/null | head -1)"
        cached_at="$(python3 -c "import json; print(json.load(open('$version_check_cache')).get('checkedAt',''))" 2>/dev/null \
                     || grep -oP '"checkedAt"\s*:\s*"\K[^"]+' "$version_check_cache" 2>/dev/null | head -1)"
        if [ -n "$cached_ver" ] && [ -n "$cached_at" ]; then
            cache_age_s=$(( $(date +%s) - $(date -d "$cached_at" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${cached_at%%.*}" +%s 2>/dev/null || echo 0) ))
            if [ "$cache_age_s" -lt 86400 ] 2>/dev/null; then
                source_version="$cached_ver"
                cache_valid=true
            fi
        fi
    fi

    # Fetch from GitHub API if cache is stale or missing
    if [ "$cache_valid" = false ]; then
        local api_url="https://api.github.com/repos/srnichols/plan-forge/releases/latest"
        local gh_response
        gh_response="$(curl -sf --max-time 5 -H 'User-Agent: plan-forge-smith' "$api_url" 2>/dev/null)"
        if [ -n "$gh_response" ]; then
            source_version="$(echo "$gh_response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tag_name','').lstrip('v'))" 2>/dev/null \
                              || echo "$gh_response" | grep -oP '"tag_name"\s*:\s*"\K[^"]+' | head -1 | sed 's/^v//')"
            if [ -n "$source_version" ]; then
                mkdir -p "$REPO_ROOT/.forge"
                printf '{"checkedAt":"%s","latestVersion":"%s"}\n' \
                    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$source_version" > "$version_check_cache"
            fi
        else
            # Fall back to local source repo if offline
            local parent_dir
            parent_dir="$(dirname "$REPO_ROOT")"
            for candidate in "$parent_dir/plan-forge" "$parent_dir/Plan-Forge"; do
                if [ -f "$candidate/VERSION" ]; then
                    source_version="$(cat "$candidate/VERSION" | tr -d '[:space:]')"
                    break
                fi
            done
        fi
    fi

    if [ -n "$source_version" ]; then
        if [ "$template_version" = "$source_version" ]; then
            doctor_pass "Up to date (v$template_version)"
        elif [ "$template_version" = "unknown" ]; then
            doctor_warn "Cannot determine installed version (.forge.json missing)"
        else
            doctor_warn "Installed v$template_version — latest is v$source_version" "Run 'pforge update' to upgrade"
        fi
        if [ "$cache_valid" = true ]; then
            local cache_min=$(( cache_age_s / 60 ))
            echo "     (cached ${cache_min}m ago)"
        fi
    else
        doctor_pass "Installed v$template_version (GitHub unreachable and no local source — skipping currency check)"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 4b. MCP SERVER
    # ═══════════════════════════════════════════════════════════════
    echo "MCP Server:"

    local mcp_server="$REPO_ROOT/pforge-mcp/server.mjs"
    if [ -f "$mcp_server" ]; then
        doctor_pass "pforge-mcp/server.mjs exists"

        [ -f "$REPO_ROOT/pforge-mcp/package.json" ] \
            || doctor_warn "pforge-mcp/package.json missing" "Copy from Plan Forge template"

        if [ -d "$REPO_ROOT/pforge-mcp/node_modules" ]; then
            doctor_pass "MCP dependencies installed"
        else
            doctor_warn "MCP dependencies not installed" "Run: cd pforge-mcp && npm install"
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
    # 4b-ii. IMAGE GENERATION STACK
    # ═══════════════════════════════════════════════════════════════
    if [ -f "$mcp_server" ]; then
        echo "Image Generation:"

        # Check for sharp (format conversion)
        if [ -d "$REPO_ROOT/pforge-mcp/node_modules/sharp" ]; then
            doctor_pass "sharp installed (WebP, PNG, AVIF conversion)"
        else
            doctor_warn "sharp not installed — image format conversion disabled" "Run: cd pforge-mcp && npm install sharp"
        fi

        # Check for API keys (env vars + .forge/secrets.json fallback)
        local has_xai="${XAI_API_KEY:+1}"
        local has_openai="${OPENAI_API_KEY:+1}"
        local secrets_src=""

        # Fallback: check .forge/secrets.json
        local secrets_file="$REPO_ROOT/.forge/secrets.json"
        if [ -f "$secrets_file" ]; then
            if [ -z "$has_xai" ] && node -e "const s=JSON.parse(require('fs').readFileSync('$secrets_file','utf8'));process.exit(s.XAI_API_KEY?0:1)" 2>/dev/null; then
                has_xai=1; secrets_src=" (from .forge/secrets.json)"
            fi
            if [ -z "$has_openai" ] && node -e "const s=JSON.parse(require('fs').readFileSync('$secrets_file','utf8'));process.exit(s.OPENAI_API_KEY?0:1)" 2>/dev/null; then
                has_openai=1; secrets_src=" (from .forge/secrets.json)"
            fi
        fi

        if [ -n "$has_xai" ] && [ -n "$has_openai" ]; then
            doctor_pass "XAI_API_KEY set (Grok Aurora)$secrets_src"
            doctor_pass "OPENAI_API_KEY set (DALL-E)$secrets_src"
        elif [ -n "$has_xai" ]; then
            doctor_pass "XAI_API_KEY set (Grok Aurora)$secrets_src"
            doctor_pass "OPENAI_API_KEY not set (DALL-E unavailable — optional)"
        elif [ -n "$has_openai" ]; then
            doctor_pass "OPENAI_API_KEY set (DALL-E)$secrets_src"
            doctor_pass "XAI_API_KEY not set (Grok Aurora unavailable — optional)"
        else
            doctor_warn "No image API keys configured" "Set XAI_API_KEY or OPENAI_API_KEY env var, or add to .forge/secrets.json"
        fi

        # Check Node.js version (sharp requires >= 18.17.0)
        if command -v node &>/dev/null; then
            local node_ver
            node_ver="$(node --version 2>/dev/null | sed 's/^v//')"
            local node_major="${node_ver%%.*}"
            if [ "$node_major" -ge 18 ] 2>/dev/null; then
                doctor_pass "Node.js v$node_ver (sharp requires >= 18.17)"
            else
                doctor_fail "Node.js v$node_ver — sharp requires >= 18.17" "Upgrade Node.js from https://nodejs.org/"
            fi
        else
            doctor_fail "Node.js not found — required for image generation" "Install from https://nodejs.org/"
        fi

        echo ""
    fi

    # ═══════════════════════════════════════════════════════════════
    # 4d. MCP RUNTIME DEPENDENCIES
    # ═══════════════════════════════════════════════════════════════
    if [ -f "$mcp_server" ]; then
        echo "MCP Runtime:"

        # Granular dependency checks
        local mcp_deps_dir="$REPO_ROOT/pforge-mcp/node_modules"
        if [ -d "$mcp_deps_dir" ]; then
            # Critical deps
            local critical_deps=("@modelcontextprotocol/sdk:MCP SDK (protocol layer)" "express:Express (dashboard + REST API)" "ws:ws (WebSocket hub for real-time events)")
            for entry in "${critical_deps[@]}"; do
                local dep_name="${entry%%:*}"
                local dep_label="${entry#*:}"
                local dep_path="$mcp_deps_dir/$dep_name"
                if [ -d "$dep_path" ]; then
                    local dep_pkg="$dep_path/package.json"
                    if [ -f "$dep_pkg" ]; then
                        local dep_ver
                        dep_ver=$(jq -r '.version // "?"' "$dep_pkg" 2>/dev/null)
                        doctor_pass "$dep_label v$dep_ver"
                    else
                        doctor_pass "$dep_label installed"
                    fi
                else
                    doctor_fail "$dep_label missing" "Run: cd pforge-mcp && npm install"
                fi
            done

            # Optional deps
            if [ -d "$mcp_deps_dir/playwright" ]; then
                doctor_pass "Playwright (screenshot capture)"
            else
                doctor_warn "Playwright (screenshot capture) not installed (optional)" "Run: cd pforge-mcp && npm install playwright"
            fi
        fi

        # MCP version sync
        local mcp_pkg_path="$REPO_ROOT/pforge-mcp/package.json"
        local version_path="$REPO_ROOT/VERSION"
        if [ -f "$mcp_pkg_path" ] && [ -f "$version_path" ]; then
            local mcp_ver repo_ver
            mcp_ver=$(jq -r '.version // ""' "$mcp_pkg_path" 2>/dev/null)
            repo_ver=$(cat "$version_path" | tr -d '[:space:]')
            if [ "$mcp_ver" = "$repo_ver" ]; then
                doctor_pass "MCP server version v$mcp_ver matches VERSION file"
            else
                doctor_warn "MCP server v$mcp_ver but VERSION file says v$repo_ver" "Update version in pforge-mcp/package.json"
            fi
        fi

        echo ""
    fi

    # ═══════════════════════════════════════════════════════════════
    # 4e. DASHBOARD & SITE ASSETS
    # ═══════════════════════════════════════════════════════════════
    local dashboard_html="$REPO_ROOT/pforge-mcp/dashboard/index.html"
    local dashboard_js="$REPO_ROOT/pforge-mcp/dashboard/app.js"
    if [ -f "$dashboard_html" ] || [ -f "$dashboard_js" ]; then
        echo "Dashboard:"

        if [ -f "$dashboard_html" ]; then doctor_pass "dashboard/index.html"
        else doctor_warn "dashboard/index.html missing" "MCP dashboard will not render"; fi

        if [ -f "$dashboard_js" ]; then doctor_pass "dashboard/app.js"
        else doctor_warn "dashboard/app.js missing" "MCP dashboard has no frontend logic"; fi

        # Dashboard screenshots for docs
        local screenshot_dir="$REPO_ROOT/docs/assets/dashboard"
        if [ -d "$screenshot_dir" ]; then
            local expected_screenshots=("progress.png" "runs.png" "cost.png" "actions.png" "config.png" "traces.png" "skills.png" "replay.png" "extensions.png")
            local found_count=0 missing_names=""
            for ss in "${expected_screenshots[@]}"; do
                if [ -f "$screenshot_dir/$ss" ]; then
                    found_count=$((found_count + 1))
                else
                    [ -n "$missing_names" ] && missing_names="$missing_names, "
                    missing_names="$missing_names$ss"
                fi
            done
            if [ $found_count -eq ${#expected_screenshots[@]} ]; then
                doctor_pass "$found_count dashboard screenshots in docs/assets/dashboard/"
            else
                local missing_count=$(( ${#expected_screenshots[@]} - found_count ))
                doctor_warn "Missing $missing_count screenshot(s): $missing_names" "Run: node pforge-mcp/capture-screenshots.mjs"
            fi
        else
            doctor_warn "docs/assets/dashboard/ not found" "Run: node pforge-mcp/capture-screenshots.mjs to generate"
        fi

        # Site images — only relevant inside the plan-forge dev repo itself.
        # These are plan-forge marketing assets; downstream projects don't need them.
        local site_assets="$REPO_ROOT/docs/assets"
        local is_planforge_dev=0
        if [ -d "$REPO_ROOT/presets" ] && [ -f "$REPO_ROOT/pforge-mcp/server.mjs" ]; then
            is_planforge_dev=1
        fi
        if [ $is_planforge_dev -eq 1 ] && [ -d "$site_assets" ]; then
            local site_images=("og-card.webp" "hero-illustration.webp" "problem-80-20-wall.webp")
            local si_missing=""
            for img in "${site_images[@]}"; do
                [ ! -f "$site_assets/$img" ] && { [ -n "$si_missing" ] && si_missing="$si_missing, "; si_missing="$si_missing$img"; }
            done
            if [ -z "$si_missing" ]; then
                doctor_pass "${#site_images[@]} site images (WebP)"
            else
                doctor_warn "Missing site image(s): $si_missing" "Generate with forge_generate_image MCP tool"
            fi
        fi

        echo ""
    fi

    # ═══════════════════════════════════════════════════════════════
    # 4f. LIFECYCLE HOOKS
    # ═══════════════════════════════════════════════════════════════
    local hooks_dir="$REPO_ROOT/.github/hooks"
    if [ -d "$hooks_dir" ]; then
        echo "Lifecycle Hooks:"
        local expected_hooks=("SessionStart" "PreToolUse" "PostToolUse" "Stop")
        local hook_count=0 hook_missing=""
        # plan-forge.json (shipped by `pforge update` from templates/) declares core hooks in PascalCase.
        local hooks_json="$hooks_dir/plan-forge.json"
        for hook in "${expected_hooks[@]}"; do
            local found=0
            # Source 1: hook file matching the name (e.g. SessionStart.md, SessionStart.ps1)
            if ls "$hooks_dir"/*"$hook"* >/dev/null 2>&1; then
                found=1
            fi
            # Source 2: .github/hooks/plan-forge.json declares this hook
            if [ $found -eq 0 ] && [ -f "$hooks_json" ] && command -v jq >/dev/null 2>&1; then
                if jq -e ".hooks.\"$hook\"" "$hooks_json" >/dev/null 2>&1; then
                    found=1
                fi
            fi
            if [ $found -eq 1 ]; then
                hook_count=$((hook_count + 1))
            else
                [ -n "$hook_missing" ] && hook_missing="$hook_missing, "
                hook_missing="$hook_missing$hook"
            fi
        done
        if [ $hook_count -eq ${#expected_hooks[@]} ]; then
            doctor_pass "$hook_count/${#expected_hooks[@]} lifecycle hooks present"
        elif [ $hook_count -gt 0 ]; then
            doctor_warn "$hook_count/${#expected_hooks[@]} hooks — missing: $hook_missing" "Run 'pforge update' to install missing hooks"
        else
            doctor_warn "No lifecycle hooks found" "Run 'pforge update' to install hooks"
        fi
        echo ""
    fi

    # ═══════════════════════════════════════════════════════════════
    # 4g. EXTENSIONS & SPEC KIT
    # ═══════════════════════════════════════════════════════════════
    local catalog_path="$REPO_ROOT/extensions/catalog.json"
    if [ -f "$catalog_path" ]; then
        echo "Extensions:"
        local ext_count
        ext_count=$(jq -r '.extensions | length // 0' "$catalog_path" 2>/dev/null)
        if [ $? -eq 0 ]; then
            doctor_pass "Extension catalog valid ($ext_count extension(s))"
            local speckit_compat
            speckit_compat=$(jq -r '.speckit_compatible // false' "$catalog_path" 2>/dev/null)
            if [ "$speckit_compat" = "true" ]; then
                doctor_pass "Spec Kit compatible"
            fi
        else
            doctor_fail "extensions/catalog.json has invalid JSON" "Fix the JSON syntax"
        fi
        echo ""
    fi

    # ═══════════════════════════════════════════════════════════════
    # 4h. VERSION & CHANGELOG SYNC
    # ═══════════════════════════════════════════════════════════════
    echo "Version & Changelog:"

    local version_path="$REPO_ROOT/VERSION"
    local changelog_path="$REPO_ROOT/CHANGELOG.md"
    local current_ver=""

    if [ -f "$version_path" ]; then
        current_ver=$(cat "$version_path" | tr -d '[:space:]')
        doctor_pass "VERSION: $current_ver"
    else
        doctor_warn "VERSION file not found"
    fi

    if [ -f "$changelog_path" ]; then
        if grep -qiE "\[v?${current_ver}\]|## v?${current_ver}" "$changelog_path" 2>/dev/null; then
            doctor_pass "CHANGELOG.md has entry for v$current_ver"
        else
            doctor_warn "CHANGELOG.md missing entry for v$current_ver" "Add release notes for the current version"
        fi
    else
        doctor_warn "CHANGELOG.md not found"
    fi

    echo ""

    # ═══════════════════════════════════════════════════════════════
    # 4c. QUORUM MODE
    # ═══════════════════════════════════════════════════════════════
    local config_path="$REPO_ROOT/.forge.json"
    if [ -f "$config_path" ]; then
        local quorum_enabled quorum_auto quorum_threshold quorum_models quorum_reviewer
        quorum_enabled=$(jq -r '.quorum.enabled // false' "$config_path" 2>/dev/null)
        if [ "$quorum_enabled" != "null" ] && [ "$quorum_enabled" != "false" ] || jq -e '.quorum' "$config_path" >/dev/null 2>&1; then
            echo "Quorum Mode:"
            quorum_enabled=$(jq -r '.quorum.enabled // false' "$config_path" 2>/dev/null)
            quorum_auto=$(jq -r '.quorum.auto // true' "$config_path" 2>/dev/null)
            quorum_threshold=$(jq -r '.quorum.threshold // 7' "$config_path" 2>/dev/null)
            quorum_models=$(jq -r '.quorum.models // [] | join(", ")' "$config_path" 2>/dev/null)
            quorum_reviewer=$(jq -r '.quorum.reviewerModel // "claude-opus-4.6"' "$config_path" 2>/dev/null)

            if [ "$quorum_enabled" = "true" ]; then
                if [ "$quorum_auto" = "true" ]; then
                    doctor_pass "Quorum enabled — mode: auto (threshold: $quorum_threshold)"
                else
                    doctor_pass "Quorum enabled — mode: forced (all slices)"
                fi
            else
                doctor_pass "Quorum disabled (configure in .forge.json to enable)"
            fi

            if [ -n "$quorum_models" ] && [ "$quorum_models" != "" ]; then
                doctor_pass "Quorum models: $quorum_models"
            else
                doctor_warn "Quorum models not configured" "Add models array to .forge.json quorum block"
            fi

            # Threshold sanity
            if [ -n "$quorum_threshold" ]; then
                if [ "$quorum_threshold" -lt 3 ] 2>/dev/null || [ "$quorum_threshold" -gt 9 ] 2>/dev/null; then
                    doctor_warn "Quorum threshold $quorum_threshold is unusual (recommended: 5-8)" "Most projects use threshold 6-8 for balanced cost/quality"
                fi
            fi

            doctor_pass "Reviewer model: $quorum_reviewer"
            echo ""
        fi
    fi

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
    # CRUCIBLE (v2.37 / Phase CRUCIBLE-02 Slice 02.2)
    # ═══════════════════════════════════════════════════════════════
    # The Crucible funnel (forge_crucible_submit → ask → preview → finalize)
    # persists every smelt under .forge/crucible/ and every manual-import
    # bypass into .forge/crucible/manual-imports.jsonl. Surfacing the counts
    # here gives the forge operator a one-glance answer to "is the Crucible
    # gate healthy?" without having to open the dashboard.
    echo ""
    echo "Crucible:"
    crucible_dir="$REPO_ROOT/.forge/crucible"
    if [ -d "$crucible_dir" ]; then
        smelt_count=0
        in_progress=0
        finalized=0
        abandoned=0
        stale_in_progress=0
        stale_cutoff=$(( $(date +%s) - 7*24*60*60 ))

        for f in "$crucible_dir"/*.json; do
            [ -e "$f" ] || continue
            base=$(basename "$f")
            # Skip non-smelt files
            case "$base" in
                config.json|phase-claims.json) continue ;;
            esac
            smelt_count=$((smelt_count + 1))
            # Best-effort status read via grep — avoids a jq dependency
            status=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
            case "$status" in
                in_progress) in_progress=$((in_progress + 1))
                    # Stat portably: mtime in seconds
                    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
                    if [ "$mtime" -gt 0 ] && [ "$mtime" -lt "$stale_cutoff" ]; then
                        stale_in_progress=$((stale_in_progress + 1))
                    fi
                    ;;
                finalized) finalized=$((finalized + 1)) ;;
                abandoned) abandoned=$((abandoned + 1)) ;;
            esac
        done

        if [ "$smelt_count" -eq 0 ]; then
            doctor_pass "No smelts yet — run 'forge_crucible_submit' to start the funnel"
        else
            doctor_pass "$smelt_count smelt(s): $finalized finalized, $in_progress in-progress, $abandoned abandoned"
            if [ "$stale_in_progress" -gt 0 ]; then
                doctor_warn "$stale_in_progress in-progress smelt(s) idle for 7+ days" "Abandon them with 'forge_crucible_abandon' or resume via the dashboard"
            fi
        fi

        # Config file — Slice 01.5
        if [ -f "$crucible_dir/config.json" ]; then
            doctor_pass "Crucible config present — governance overrides active"
        fi

        # Manual-import audit trail — Slice 01.4
        if [ -f "$crucible_dir/manual-imports.jsonl" ]; then
            mi_count=$(wc -l < "$crucible_dir/manual-imports.jsonl" 2>/dev/null | tr -d ' ')
            if [ "${mi_count:-0}" -gt 0 ]; then
                doctor_pass "$mi_count manual-import bypass(es) recorded"
            fi
        fi

        # Phase claims — atomic phase-number allocation
        if [ -f "$crucible_dir/phase-claims.json" ]; then
            # Count unique phase IDs in claims array — grep is sufficient
            claim_count=$(grep -o '"phaseNumber"[[:space:]]*:' "$crucible_dir/phase-claims.json" 2>/dev/null | wc -l | tr -d ' ')
            doctor_pass "${claim_count:-0} phase number(s) claimed atomically"
        fi
    else
        doctor_pass "Crucible inactive — no .forge/crucible/ directory yet"
    fi

    # ═══════════════════════════════════════════════════════════════
    # TEMPERING (Phase TEMPER-01 Slice 01.2)
    # ═══════════════════════════════════════════════════════════════
    # The Tempering subsystem (forge_tempering_scan → forge_tempering_status)
    # parses existing coverage reports and flags layers below configured
    # minima. Surfacing freshness + gap counts here gives the forge operator
    # a one-glance answer to "is my test coverage honest?" without having
    # to open the dashboard.
    echo ""
    echo "Tempering:"
    tempering_dir="$REPO_ROOT/.forge/tempering"
    if [ -d "$tempering_dir" ]; then
        # Find the newest scan-*.json by mtime
        latest_scan=""
        scan_count=0
        for f in "$tempering_dir"/scan-*.json; do
            [ -e "$f" ] || continue
            scan_count=$((scan_count + 1))
            if [ -z "$latest_scan" ] || [ "$f" -nt "$latest_scan" ]; then
                latest_scan="$f"
            fi
        done

        if [ "$scan_count" -eq 0 ]; then
            doctor_pass "No Tempering scans yet — run 'forge_tempering_scan' to establish a baseline"
        else
            # Extract status + gap count — best-effort grep, no jq dep.
            status=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$latest_scan" 2>/dev/null | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')
            [ -z "$status" ] && status="unknown"
            gap_count=$(grep -o '"layer"[[:space:]]*:' "$latest_scan" 2>/dev/null | wc -l | tr -d ' ')

            # Age in days from mtime — portable across GNU/BSD stat.
            if stat -c %Y "$latest_scan" >/dev/null 2>&1; then
                mtime=$(stat -c %Y "$latest_scan")
            else
                mtime=$(stat -f %m "$latest_scan" 2>/dev/null || echo "0")
            fi
            now=$(date +%s)
            age_days=$(( (now - mtime) / 86400 ))

            doctor_pass "$scan_count scan(s); latest: $status, ${gap_count:-0} gap(s), $age_days day(s) old"

            # Stale-scan warning mirrors the `tempering-scan-stale` watcher rule.
            if [ "$age_days" -ge 7 ]; then
                doctor_warn "Latest scan is $age_days days old" "Re-run 'forge_tempering_scan' — coverage drifts fast"
            fi

            # Below-minimum warning — count gap records with gap ≥ 5.
            # Walks the file line-by-line looking for the "gap" field.
            below_min=$(awk '/"gap"[[:space:]]*:/ { gsub(/[^0-9.]/,"",$0); if ($0+0 >= 5) c++ } END { print c+0 }' "$latest_scan" 2>/dev/null)
            if [ "${below_min:-0}" -gt 0 ]; then
                doctor_warn "$below_min coverage layer(s) below minimum by ≥ 5 points" "Run 'forge_tempering_status' to inspect the gap report"
            fi
        fi

        if [ -f "$tempering_dir/config.json" ]; then
            doctor_pass "Tempering config present — enterprise minima active"
        fi

        # TEMPER-02 Slice 02.2 — summarise the latest Tempering run
        # record (`run-*.json`). Mirrors the PowerShell equivalent.
        latest_run=""
        run_count=0
        for f in "$tempering_dir"/run-*.json; do
            [ -e "$f" ] || continue
            run_count=$((run_count + 1))
            if [ -z "$latest_run" ] || [ "$f" -nt "$latest_run" ]; then
                latest_run="$f"
            fi
        done
        if [ "$run_count" -gt 0 ]; then
            run_verdict=$(grep -o '"verdict"[[:space:]]*:[[:space:]]*"[^"]*"' "$latest_run" 2>/dev/null | tail -n1 | sed 's/.*"\([^"]*\)"$/\1/')
            [ -z "$run_verdict" ] && run_verdict="unknown"
            scanner_count=$(grep -o '"scanner"[[:space:]]*:' "$latest_run" 2>/dev/null | wc -l | tr -d ' ')
            run_pass=$(awk 'BEGIN{s=0} /"pass"[[:space:]]*:[[:space:]]*[0-9]+/ { match($0,/[0-9]+/); s+=substr($0,RSTART,RLENGTH) } END{print s}' "$latest_run" 2>/dev/null)
            run_fail=$(awk 'BEGIN{s=0} /"fail"[[:space:]]*:[[:space:]]*[0-9]+/ { match($0,/[0-9]+/); s+=substr($0,RSTART,RLENGTH) } END{print s}' "$latest_run" 2>/dev/null)
            if stat -c %Y "$latest_run" >/dev/null 2>&1; then
                run_mtime=$(stat -c %Y "$latest_run")
            else
                run_mtime=$(stat -f %m "$latest_run" 2>/dev/null || echo "0")
            fi
            run_age_min=$(( ($(date +%s) - run_mtime) / 60 ))
            doctor_pass "$run_count run(s); latest: $run_verdict, ${run_pass:-0} pass / ${run_fail:-0} fail across ${scanner_count:-0} scanner(s), $run_age_min min old"
            case "$run_verdict" in
                fail|error|budget-exceeded)
                    doctor_warn "Latest Tempering run verdict=$run_verdict" "Open $(basename "$latest_run") for per-scanner detail"
                    ;;
            esac
        fi
    else
        doctor_pass "Tempering inactive — no .forge/tempering/ directory yet"
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

# ─── Command: run-plan ─────────────────────────────────────────────────
cmd_run_plan() {
    if [ $# -lt 1 ]; then
        echo "ERROR: Missing plan path" >&2
        echo "Usage: pforge run-plan <plan-file> [--estimate] [--assisted] [--model <name>] [--resume-from <N>] [--dry-run] [--foreground] [--no-quorum] [--quorum] [--quorum=auto] [--quorum-threshold <N>] [--manual-import [--manual-import-source <human|speckit|grandfather>] [--manual-import-reason <text>]]" >&2
        exit 1
    fi

    local plan_path="$1"
    shift
    local full_plan_path="$REPO_ROOT/$plan_path"

    if [ ! -f "$full_plan_path" ]; then
        echo "ERROR: Plan file not found: $plan_path" >&2
        exit 1
    fi

    # Parse flags
    local estimate=false
    local assisted=false
    local dry_run=false
    local foreground=false
    local model=""
    local resume_from=""
    local quorum_arg=""
    local quorum_threshold=""
    local manual_import=false
    local manual_import_source=""
    local manual_import_reason=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --estimate)     estimate=true ;;
            --assisted)     assisted=true ;;
            --dry-run)      dry_run=true ;;
            --foreground)   foreground=true ;;
            --no-quorum)    quorum_arg="--no-quorum" ;;
            --quorum=*)     quorum_arg="$1" ;;
            --quorum)       quorum_arg="--quorum" ;;
            --manual-import) manual_import=true ;;
            --manual-import-source)
                shift
                if [ -z "$1" ]; then echo "ERROR: --manual-import-source requires a value" >&2; exit 1; fi
                manual_import_source="$1" ;;
            --manual-import-reason)
                shift
                if [ -z "$1" ]; then echo "ERROR: --manual-import-reason requires a value" >&2; exit 1; fi
                manual_import_reason="$1" ;;
            --model)
                shift
                if [ -z "$1" ] || [ "${1#-}" != "$1" ]; then
                    echo "ERROR: --model requires a value" >&2; exit 1
                fi
                model="$1" ;;
            --resume-from)
                shift
                if [ -z "$1" ] || [ "${1#-}" != "$1" ]; then
                    echo "ERROR: --resume-from requires a value" >&2; exit 1
                fi
                resume_from="$1" ;;
            --quorum-threshold)
                shift
                if [ -z "$1" ]; then
                    echo "ERROR: --quorum-threshold requires a value" >&2; exit 1
                fi
                quorum_threshold="$1" ;;
        esac
        shift
    done

    local mode="auto"
    if [ "$assisted" = true ]; then mode="assisted"; fi

    print_manual_steps "run-plan" \
        "Parse plan to extract slices and validation gates" \
        "Execute each slice via CLI worker (gh copilot) or human (assisted mode)" \
        "Validate build/test gates at each slice boundary" \
        "Write results to .forge/runs/<timestamp>/"

    # Build node args
    local node_args=("$REPO_ROOT/pforge-mcp/orchestrator.mjs" "--run" "$full_plan_path" "--mode" "$mode")
    if [ "$estimate" = true ]; then node_args+=("--estimate"); fi
    if [ "$dry_run" = true ]; then node_args+=("--dry-run"); fi
    if [ -n "$model" ]; then node_args+=("--model" "$model"); fi
    if [ -n "$resume_from" ]; then node_args+=("--resume-from" "$resume_from"); fi
    if [ -n "$quorum_arg" ]; then node_args+=("$quorum_arg"); fi
    if [ -n "$quorum_threshold" ]; then node_args+=("--quorum-threshold" "$quorum_threshold"); fi
    if [ "$manual_import" = true ]; then node_args+=("--manual-import"); fi
    if [ -n "$manual_import_source" ]; then node_args+=("--manual-import-source" "$manual_import_source"); fi
    if [ -n "$manual_import_reason" ]; then node_args+=("--manual-import-reason" "$manual_import_reason"); fi

    echo ""
    if [ "$estimate" = true ]; then
        echo "Estimating cost for: $plan_path"
        echo ""
        node "${node_args[@]}"
    elif [ "$dry_run" = true ]; then
        echo "Dry run for: $plan_path"
        echo ""
        node "${node_args[@]}"
    elif [ "$foreground" = true ]; then
        # Blocking mode — useful for debugging or CI pipelines
        if [ "$assisted" = true ]; then
            echo "Starting assisted execution (foreground): $plan_path"
            echo "You code in VS Code, orchestrator validates gates."
        else
            echo "Starting full auto execution (foreground): $plan_path"
        fi
        echo ""
        node "${node_args[@]}"
    else
        # Background mode — default for interactive use
        if [ "$assisted" = true ]; then
            echo "Starting assisted execution (background): $plan_path"
            echo "You code in VS Code, orchestrator validates gates."
        else
            echo "Starting full auto execution (background): $plan_path"
        fi
        echo ""
        node "${node_args[@]}" &
        local bg_pid=$!
        echo "Orchestrator running in background  PID: $bg_pid"
        echo "Monitor : pforge plan-status"
        echo "Logs    : .forge/runs/ (latest sub-directory)"
        echo "Stop    : kill $bg_pid"
    fi
}

# ─── Command: org-rules ────────────────────────────────────────────────
cmd_org_rules() {
    local subcmd="${1:-export}"
    local format="github"
    local out_file=""
    shift 2>/dev/null || true

    while [ $# -gt 0 ]; do
        case "$1" in
            --format)      format="$2"; shift 2 ;;
            --format=*)    format="${1#--format=}"; shift ;;
            --output)      out_file="$2"; shift 2 ;;
            --output=*)    out_file="${1#--output=}"; shift ;;
            *) shift ;;
        esac
    done

    if [ "$subcmd" != "export" ]; then
        echo "ERROR: Unknown org-rules sub-command '$subcmd'. Use: export" >&2
        exit 1
    fi

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       Plan Forge — Org Rules Export                          ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    # Try MCP server REST API (port 3100) first
    if command -v curl >/dev/null 2>&1; then
        local body="{\"format\":\"${format}\"}"
        [ -n "$out_file" ] && body="{\"format\":\"${format}\",\"output\":\"${out_file}\"}"
        local http_code
        http_code=$(curl -s -o /tmp/pforge_org_rules_out.txt -w "%{http_code}" \
            -X POST "http://localhost:3100/api/tool/org-rules" \
            -H "Content-Type: application/json" \
            -d "$body" --max-time 5 2>/dev/null)
        if [ "$http_code" = "200" ]; then
            if [ -n "$out_file" ]; then
                echo "  ✅ Org rules exported to: $out_file"
            else
                cat /tmp/pforge_org_rules_out.txt
            fi
            rm -f /tmp/pforge_org_rules_out.txt
            return 0
        fi
        rm -f /tmp/pforge_org_rules_out.txt
    fi

    # Fallback: inline Node.js
    if ! command -v node >/dev/null 2>&1; then
        echo "ERROR: node not found. Install Node.js or start the MCP server (pforge-mcp/server.mjs)." >&2
        exit 1
    fi

    ORG_RULES_FORMAT="$format" ORG_RULES_OUTPUT="$out_file" node -e "
const fs=require('fs'),path=require('path'),cwd=process.cwd();
const fmt=process.env.ORG_RULES_FORMAT||'github';
const outFile=process.env.ORG_RULES_OUTPUT||'';
const instrDir=path.join(cwd,'.github','instructions');
const instrFiles=fs.existsSync(instrDir)?fs.readdirSync(instrDir).filter(f=>f.endsWith('.instructions.md')).sort().map(f=>path.join(instrDir,f)):[];
function stripFrontmatter(raw){return raw.replace(/^---[\s\S]*?---\s*/m,'').trim();}
const parts=[];
instrFiles.forEach(f=>{const body=stripFrontmatter(fs.readFileSync(f,'utf8'));if(body)parts.push(body);});
const ci=path.join(cwd,'.github','copilot-instructions.md');
if(fs.existsSync(ci))parts.push(stripFrontmatter(fs.readFileSync(ci,'utf8')));
const pp=path.join(cwd,'PROJECT-PRINCIPLES.md');
if(fs.existsSync(pp))parts.push(fs.readFileSync(pp,'utf8').trim());
const out=parts.join('\n\n---\n\n');
if(outFile){fs.writeFileSync(outFile,out,'utf8');console.log('Exported to: '+outFile);}
else{process.stdout.write(out+'\n');}
"
}

# ─── Command: incident ─────────────────────────────────────────────────
cmd_incident() {
    local description="${1:-}"
    if [ -z "$description" ]; then
        echo "ERROR: description is required. Usage: pforge incident \"<description>\" [--severity S] [--files f1,f2] [--resolved-at ISO]" >&2
        exit 1
    fi
    shift

    local severity="medium"
    local files=""
    local resolved_at=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --severity)    severity="$2";    shift 2 ;;
            --files)       files="$2";       shift 2 ;;
            --resolved-at) resolved_at="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "incident" \
        "Build incident payload (description, severity, files, resolvedAt)" \
        "POST to /api/incident on the MCP server" \
        "Append record to .forge/incidents.jsonl" \
        "Dispatch bridge notification if onCall configured in .forge.json"

    local port=3100

    # Build JSON payload using node to avoid manual escaping
    local payload
    payload=$(node -e "
      const p = {
        description: process.env.INC_DESC,
        severity: process.env.INC_SEV || 'medium',
        files: process.env.INC_FILES ? process.env.INC_FILES.split(',').map(f => f.trim()).filter(Boolean) : [],
      };
      if (process.env.INC_RESOLVED) p.resolvedAt = process.env.INC_RESOLVED;
      console.log(JSON.stringify(p));
    " INC_DESC="$description" INC_SEV="$severity" INC_FILES="$files" INC_RESOLVED="$resolved_at")

    local response
    response=$(curl -sf -X POST "http://localhost:${port}/api/incident" \
        -H "Content-Type: application/json" \
        -d "$payload") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }

    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      const sev_colors = { critical: '\x1b[31m', high: '\x1b[33m', medium: '\x1b[33m', low: '\x1b[37m' };
      const sc = sev_colors[d.severity] || '\x1b[37m';
      console.log('\n\u{1F6A8} Incident Captured');
      console.log('   ID:          ' + d.id);
      console.log('   Description: ' + d.description);
      console.log('   Severity:    ' + sc + d.severity + '\x1b[0m');
      console.log('   Captured at: ' + d.capturedAt);
      if (d.resolvedAt) {
        const mttrMin = Math.round(d.mttr / 60000 * 10) / 10;
        console.log('   Resolved at: \x1b[32m' + d.resolvedAt + '\x1b[0m');
        console.log('   MTTR:        \x1b[32m' + mttrMin + ' minutes\x1b[0m');
      } else {
        console.log('   MTTR:        \x1b[90mpending (supply --resolved-at when resolved)\x1b[0m');
      }
      if (d.files && d.files.length > 0) console.log('   Files:       ' + d.files.join(', '));
      console.log('   Saved to:    \x1b[90m.forge/incidents.jsonl\x1b[0m');
    "
}

# ─── Command: deploy-log ──────────────────────────────────────────────
cmd_deploy_log() {
    local version="${1:-}"
    if [ -z "$version" ]; then
        echo "ERROR: version is required. Usage: pforge deploy-log \"<version>\" [--by CI] [--notes \"...\"] [--slice S]" >&2
        exit 1
    fi
    shift

    local by="unknown"
    local notes=""
    local slice=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --by)    by="$2";    shift 2 ;;
            --notes) notes="$2"; shift 2 ;;
            --slice) slice="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "deploy-log" \
        "Build deploy payload (version, by, notes, slice)" \
        "POST to /api/deploy-journal on the MCP server" \
        "Append record to .forge/deploy-journal.jsonl"

    local port=3100

    local payload
    payload=$(node -e "
      const p = {
        version: process.env.DPL_VER,
        by: process.env.DPL_BY || 'unknown',
      };
      if (process.env.DPL_NOTES) p.notes = process.env.DPL_NOTES;
      if (process.env.DPL_SLICE) p.slice = process.env.DPL_SLICE;
      console.log(JSON.stringify(p));
    " DPL_VER="$version" DPL_BY="$by" DPL_NOTES="$notes" DPL_SLICE="$slice")

    local response
    response=$(curl -sf -X POST "http://localhost:${port}/api/deploy-journal" \
        -H "Content-Type: application/json" \
        -d "$payload") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }

    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F680} Deploy Recorded');
      console.log('   ID:          ' + d.id);
      console.log('   Version:     ' + d.version);
      console.log('   By:          ' + d.by);
      console.log('   Deployed at: ' + d.deployedAt);
      if (d.notes) console.log('   Notes:       ' + d.notes);
      if (d.slice) console.log('   Slice:       ' + d.slice);
      console.log('   Saved to:    \x1b[90m.forge/deploy-journal.jsonl\x1b[0m');
    "
}

# ─── Command: triage ───────────────────────────────────────────────────
cmd_triage() {
    local min_severity="low"
    local max_results=20
    while [ $# -gt 0 ]; do
        case "$1" in
            --min-severity) min_severity="$2"; shift 2 ;;
            --max)          max_results="$2";  shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "triage" \
        "Read open incidents from .forge/incidents.jsonl" \
        "Read latest drift violations from .forge/drift-history.json" \
        "Score each alert: severity_weight * recency_factor" \
        "Rank by priority (tiebreak: more recent first)"

    local port=3100
    local response
    response=$(curl -sf "http://localhost:${port}/api/triage?minSeverity=${min_severity}&max=${max_results}") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }

    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F6A8} Alert Triage (' + d.showing + '/' + d.total + ' alerts, min-severity: ' + d.minSeverity + ')');
      console.log('');
      if (d.alerts.length === 0) {
        console.log('   \x1b[32mNo open alerts found.\x1b[0m');
      } else {
        const sev_colors = { critical: '\x1b[31m', high: '\x1b[33m', medium: '\x1b[33m', low: '\x1b[37m' };
        for (const a of d.alerts) {
          const sc = sev_colors[a.severity] || '\x1b[37m';
          const icon = a.source === 'incident' ? '\u{1F6A8}' : '\u{1F4CA}';
          console.log('   ' + icon + ' ' + sc + '[' + a.severity + '] ' + a.description + '\x1b[0m');
          console.log('      \x1b[90mPriority: ' + a.priority + '  Source: ' + a.source + '  ID: ' + a.id + '\x1b[0m');
        }
      }
      console.log('');
      console.log('   \x1b[90mGenerated: ' + d.generatedAt + '\x1b[0m');
    "
}

# ─── Command: runbook ──────────────────────────────────────────────────
cmd_runbook() {
    local plan=""
    local no_incidents=false

    while [ $# -gt 0 ]; do
        case "$1" in
            --no-incidents) no_incidents=true; shift ;;
            --*) shift ;;
            *)
                if [ -z "$plan" ]; then plan="$1"; fi
                shift
                ;;
        esac
    done

    if [ -z "$plan" ]; then
        echo "ERROR: plan file is required. Usage: ./pforge.sh runbook <plan-file> [--no-incidents]" >&2
        exit 1
    fi

    print_manual_steps "runbook" \
        "Parse the plan file (slices, scope contract, gates)" \
        "Collect recent incidents from .forge/incidents.jsonl (unless --no-incidents)" \
        "Render a structured Markdown runbook" \
        "Save to .forge/runbooks/<plan-name>-runbook.md"

    local port=3100
    local include_incidents="true"
    if [ "$no_incidents" = "true" ]; then include_incidents="false"; fi

    local payload
    payload=$(node -e "
      console.log(JSON.stringify({ plan: process.env.RB_PLAN, includeIncidents: process.env.RB_INC === 'true' }));
    " RB_PLAN="$plan" RB_INC="$include_incidents")

    local response
    response=$(curl -sf -X POST "http://localhost:${port}/api/runbook" \
        -H "Content-Type: application/json" \
        -d "$payload") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }

    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F4D6} Runbook Generated');
      console.log('   File:   ' + d.runbook);
      console.log('   Slices: ' + d.slices);
      console.log('   At:     \x1b[90m' + d.generatedAt + '\x1b[0m');
    "
}

# ─── Command: hotspot ──────────────────────────────────────────────────
cmd_hotspot() {
    local top=10
    local since="6 months ago"
    while [ $# -gt 0 ]; do
        case "$1" in
            --top)   top="$2";   shift 2 ;;
            --since) since="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "hotspot" \
        "Run git log to collect file change frequency" \
        "Rank files by number of commits" \
        "Cache results in .forge/hotspot-cache.json (24h TTL)" \
        "Return top N hotspot files"

    local port=3100
    local encoded_since
    encoded_since=$(node -e "process.stdout.write(encodeURIComponent('${since}'))")
    local response
    response=$(curl -sf "http://localhost:${port}/api/hotspots?top=${top}&since=${encoded_since}") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F525} Git Churn Hotspots');
      console.log('   Since:       ' + d.since);
      console.log('   Total files: ' + d.totalFiles);
      console.log('   Showing:     ' + d.showing);
      console.log('');
      d.hotspots.forEach((h, i) => {
        const bar = '\u2588'.repeat(Math.min(h.commits, 40));
        console.log('   ' + (i + 1) + '. \x1b[33m' + h.file + ' (' + h.commits + ' commits)\x1b[0m');
        console.log('      \x1b[33m' + bar + '\x1b[0m');
      });
      console.log('');
      console.log('   Cached at: \x1b[90m' + d.generatedAt + '\x1b[0m');
    "
}

# ─── Command: secret-scan ──────────────────────────────────────────────
cmd_secret_scan() {
    local since="HEAD~1"
    local threshold="4.0"
    while [ $# -gt 0 ]; do
        case "$1" in
            --since)     since="$2";     shift 2 ;;
            --threshold) threshold="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "secret-scan" \
        "Run git diff to collect changed lines" \
        "Compute Shannon entropy for token-like strings" \
        "Flag findings above threshold ($threshold)" \
        "Cache results in .forge/secret-scan-cache.json"

    local port=3100
    local response
    response=$(curl -sf "http://localhost:${port}/api/secret-scan") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      if (d.cache === null) {
        console.log('\n\u{1F50D} Secret Scan Results');
        console.log('   No scan results yet. Run forge_secret_scan to populate.');
      } else {
        console.log('\n\u{1F50D} Secret Scan Results');
        console.log('   Since:         ' + d.since);
        console.log('   Threshold:     ' + d.threshold);
        console.log('   Scanned files: ' + d.scannedFiles);
        if (d.clean) {
          console.log('   Status:        \x1b[32m\u2705 Clean — no secrets detected\x1b[0m');
        } else {
          console.log('   Status:        \x1b[33m\u26A0 ' + d.findings.length + ' finding(s)\x1b[0m');
          d.findings.forEach(f => {
            console.log('      \x1b[31m' + f.file + ':' + f.line + ' [' + f.confidence + '] entropy=' + f.entropyScore + ' type=' + f.type + '\x1b[0m');
          });
        }
        console.log('');
        console.log('   Scanned at: \x1b[90m' + d.scannedAt + '\x1b[0m');
      }
    "
}

# ─── Command: env-diff ──────────────────────────────────────────────────
cmd_env_diff() {
    local baseline=".env"
    local files=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --baseline) baseline="$2"; shift 2 ;;
            --files)    files="$2";    shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "env-diff" \
        "Read baseline $baseline and compare key names" \
        "Detect missing keys across target .env files" \
        "Cache results in .forge/env-diff-cache.json (key names only, no values)"

    local port=3100
    local response
    response=$(curl -sf "http://localhost:${port}/api/env/diff") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      if (d.cache === null) {
        console.log('\n\u{1F50E} Environment Key Diff');
        console.log('   No diff data yet. Run forge_env_diff to populate.');
      } else {
        console.log('\n\u{1F50E} Environment Key Diff');
        console.log('   Baseline:       ' + d.baseline);
        console.log('   Files compared: ' + d.filesCompared);
        if (d.summary.clean) {
          console.log('   Status:        \x1b[32m\u2705 Clean — all keys aligned\x1b[0m');
        } else {
          console.log('   Status:        \x1b[33m\u26A0 ' + d.summary.totalGaps + ' gap(s) found\x1b[0m');
          d.pairs.forEach(p => {
            if ((p.missingInTarget && p.missingInTarget.length) || (p.missingInBaseline && p.missingInBaseline.length)) {
              console.log('   --- ' + p.file + ' ---');
              (p.missingInTarget || []).forEach(k => console.log('      \x1b[31mMissing in target: ' + k + '\x1b[0m'));
              (p.missingInBaseline || []).forEach(k => console.log('      \x1b[33mMissing in baseline: ' + k + '\x1b[0m'));
            }
          });
        }
        console.log('');
        console.log('   Scanned at: \x1b[90m' + d.scannedAt + '\x1b[0m');
      }
    "
}

# ─── Command: fix-proposal ──────────────────────────────────────────────
cmd_fix_proposal() {
    local source=""
    local incident_id=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --source)      source="$2";      shift 2 ;;
            --incident-id) incident_id="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "fix-proposal" \
        "Read LiveGuard data (drift, incidents, secrets, regression)" \
        "Generate 1-2 slice fix plan" \
        "Write to docs/plans/auto/LIVEGUARD-FIX-<id>.md" \
        "Append record to .forge/fix-proposals.json"

    local port=3100
    local body="{}"
    if [ -n "$source" ] && [ -n "$incident_id" ]; then
        body="{\"source\":\"${source}\",\"incidentId\":\"${incident_id}\"}"
    elif [ -n "$source" ]; then
        body="{\"source\":\"${source}\"}"
    elif [ -n "$incident_id" ]; then
        body="{\"incidentId\":\"${incident_id}\"}"
    fi
    local response
    response=$(curl -sf -X POST -H "Content-Type: application/json" -d "$body" "http://localhost:${port}/api/fix/propose") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F527} Fix Proposal');
      if (d.error) {
        console.log('   \x1b[33m' + d.error + '\x1b[0m');
      } else if (d.alreadyExists) {
        console.log('   \x1b[90mAlready exists: ' + d.plan + '\x1b[0m');
      } else {
        console.log('   Fix ID:   ' + d.fixId);
        console.log('   Source:   ' + d.source);
        console.log('   Plan:     \x1b[32m' + d.plan + '\x1b[0m');
        console.log('   Slices:   ' + (d.sliceCount || 'unknown'));
      }
    "
}

# ─── Command: quorum-analyze ───────────────────────────────────────────
cmd_quorum_analyze() {
    local source=""
    local goal=""
    local custom_question=""
    local quorum_size=3
    while [ $# -gt 0 ]; do
        case "$1" in
            --source)          source="$2";          shift 2 ;;
            --goal)            goal="$2";             shift 2 ;;
            --custom-question) custom_question="$2";  shift 2 ;;
            --quorum-size)     quorum_size="$2";      shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "quorum-analyze" \
        "Read LiveGuard data from .forge/ (source: ${source:-all})" \
        "Assemble 3-section prompt (context, question, voting instruction)" \
        "Return structured prompt object for multi-model dispatch"

    local port=3100
    local body="{\"quorumSize\":${quorum_size}}"
    if [ -n "$custom_question" ]; then
        if [ -n "$source" ]; then
            body="{\"source\":\"${source}\",\"customQuestion\":\"${custom_question}\",\"quorumSize\":${quorum_size}}"
        else
            body="{\"customQuestion\":\"${custom_question}\",\"quorumSize\":${quorum_size}}"
        fi
    elif [ -n "$goal" ]; then
        if [ -n "$source" ]; then
            body="{\"source\":\"${source}\",\"analysisGoal\":\"${goal}\",\"quorumSize\":${quorum_size}}"
        else
            body="{\"analysisGoal\":\"${goal}\",\"quorumSize\":${quorum_size}}"
        fi
    elif [ -n "$source" ]; then
        body="{\"source\":\"${source}\",\"quorumSize\":${quorum_size}}"
    fi

    local response
    response=$(curl -sf -X POST -H "Content-Type: application/json" -d "$body" "http://localhost:${port}/api/quorum/prompt") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F50E} Quorum Analyze');
      if (d.error) {
        console.log('   \x1b[33m' + d.error + '\x1b[0m');
      } else {
        console.log('   Question:  ' + d.questionUsed);
        console.log('   Tokens:    ~' + d.promptTokenEstimate);
        console.log('   Models:    ' + (d.suggestedModels || []).join(', '));
        console.log('   Data age:  \x1b[90m' + d.dataSnapshotAge + '\x1b[0m');
        console.log('');
        console.log('   \x1b[32mPrompt assembled — pipe to quorum runner or copy from JSON output.\x1b[0m');
      }
    "
}

# ─── Command: health-trend ─────────────────────────────────────────────
cmd_health_trend() {
    local days=30
    local metrics=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --days)    days="$2";    shift 2 ;;
            --metrics) metrics="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "health-trend" \
        "Read .forge/ operational data (drift, cost, incidents, model performance)" \
        "Filter to requested time window ($days days)" \
        "Compute per-metric summaries and overall health score" \
        "Report trend direction"

    local port=3100
    local uri="http://localhost:${port}/api/health-trend?days=${days}"
    if [ -n "$metrics" ]; then
        uri="${uri}&metrics=${metrics}"
    fi
    local response
    response=$(curl -sf "$uri") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      console.log('\n\u{1F3E5} Health Trend (' + d.days + '-day window)');
      const sc = d.healthScore;
      const color = sc >= 80 ? '\x1b[32m' : sc >= 50 ? '\x1b[33m' : '\x1b[31m';
      console.log('   Health Score: ' + color + (sc != null ? sc + '/100' : 'N/A') + '\x1b[0m');
      console.log('   Trend:        ' + d.trend);
      console.log('   Data Points:  ' + d.dataPoints);
      console.log('');
      if (d.drift) {
        console.log('   Drift:');
        console.log('     Snapshots: ' + d.drift.snapshots + '  Avg: ' + (d.drift.avg != null ? d.drift.avg : 'N/A') + '  Trend: ' + d.drift.trend);
      }
      if (d.cost) {
        console.log('   Cost:');
        console.log('     Runs: ' + d.cost.runs + '  Total: \$' + d.cost.totalUsd + '  Avg/run: \$' + d.cost.avgPerRun);
      }
      if (d.incidents) {
        console.log('   Incidents:');
        console.log('     Total: ' + d.incidents.total + '  Open: ' + d.incidents.open + '  Resolved: ' + d.incidents.resolved);
      }
      if (d.models) {
        console.log('   Models:');
        console.log('     Total slices: ' + d.models.totalSlices);
      }
      console.log('');
      console.log('   Generated: \x1b[90m' + d.generatedAt + '\x1b[0m');
    "
}

# ─── Command: drift ────────────────────────────────────────────────────
cmd_drift() {
    local threshold=70
    while [ $# -gt 0 ]; do
        case "$1" in
            --threshold) threshold="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    print_manual_steps "drift" \
        "Scan source files for architecture rule violations" \
        "Score codebase (100 minus penalties)" \
        "Compare against .forge/drift-history.json" \
        "Report trend: improving / stable / degrading"

    local port=3100
    local response
    response=$(curl -sf "http://localhost:${port}/api/drift?threshold=${threshold}") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }
    echo "$response" | node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const color = d.score >= ${threshold} ? '\x1b[32m' : '\x1b[31m';
      console.log('\n\u{1F4CA} Drift Score: ' + color + d.score + '/100\x1b[0m');
      console.log('   Trend: ' + d.trend + ' (\u0394' + d.delta + ')');
      console.log('   Files scanned: ' + d.filesScanned);
      console.log('   Violations: ' + d.violations.length);
      console.log('   History entries: ' + d.historyLength);
      d.violations.forEach(v => {
        const vc = v.severity === 'critical' ? '\x1b[31m' : '\x1b[33m';
        console.log('   \u26A0 ' + vc + '[' + v.severity + '] ' + v.file + ':' + v.line + ' ' + v.rule + '\x1b[0m');
      });
    "
}

# ─── Command: regression-guard ──────────────────────────────────────────
cmd_regression_guard() {
    local files=""
    local plan=""
    local fail_fast="false"

    while [ $# -gt 0 ]; do
        case "$1" in
            --files)     files="$2";     shift 2 ;;
            --plan)      plan="$2";      shift 2 ;;
            --fail-fast) fail_fast="true"; shift ;;
            *) shift ;;
        esac
    done

    print_manual_steps "regression-guard" \
        "Extract validation gate commands from plan files in docs/plans/" \
        "Check each command against the gate allowlist" \
        "Execute allowed commands and report passed/failed results" \
        "Return structured result with per-gate status"

    local port=3100

    local payload
    payload=$(node -e "
      const p = { files: process.env.RG_FILES ? process.env.RG_FILES.split(',').map(f => f.trim()).filter(Boolean) : [], failFast: process.env.RG_FAIL_FAST === 'true' };
      if (process.env.RG_PLAN) p.plan = process.env.RG_PLAN;
      console.log(JSON.stringify(p));
    " RG_FILES="$files" RG_FAIL_FAST="$fail_fast" RG_PLAN="$plan")

    local response
    response=$(curl -sf -X POST "http://localhost:${port}/api/regression-guard" \
        -H "Content-Type: application/json" \
        -d "$payload") || {
        echo "ERROR: MCP server not running on port ${port}. Start with: node pforge-mcp/server.mjs" >&2
        exit 1
    }

    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      const ok = d.success;
      const icon = ok ? '\u2705' : '\u274C';
      const color = ok ? '\x1b[32m' : '\x1b[31m';
      console.log('\n' + icon + ' Regression Guard: ' + color + (ok ? 'PASSED' : 'FAILED') + '\x1b[0m');
      console.log('   Gates checked: ' + d.gatesChecked);
      console.log('   \x1b[32mPassed:        ' + d.passed + '\x1b[0m');
      if (d.failed > 0) console.log('   \x1b[31mFailed:        ' + d.failed + '\x1b[0m');
      if (d.blocked > 0) console.log('   \x1b[33mBlocked:       ' + d.blocked + '\x1b[0m');
      if (d.skipped > 0) console.log('   \x1b[90mSkipped:       ' + d.skipped + '\x1b[0m');
      (d.results || []).forEach(r => {
        if (r.status === 'failed') {
          console.log('   \u274C Slice ' + r.sliceNumber + ' [' + r.planFile + ']: ' + r.sliceTitle);
          if (r.output) console.log('      \x1b[90m' + r.output + '\x1b[0m');
        } else if (r.status === 'blocked') {
          console.log('   \u26A0 Slice ' + r.sliceNumber + ' [' + r.planFile + ']: BLOCKED \u2014 ' + r.reason);
        }
      });
    "

    # Exit non-zero if any gates failed
    echo "$response" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      process.exit(d.success ? 0 : 1);
    " || exit 1
}

# ─── Command: tour ─────────────────────────────────────────────────────
cmd_tour() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           Welcome to Plan Forge — Guided Tour               ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    local instr_dir="$REPO_ROOT/.github/instructions"
    local agents_dir="$REPO_ROOT/.github/agents"
    local prompts_dir="$REPO_ROOT/.github/prompts"
    local skills_dir="$REPO_ROOT/.github/skills"
    local hooks_dir="$REPO_ROOT/.github/hooks"
    local forge_json="$REPO_ROOT/.forge.json"

    local sections=(
        "1|6|Instruction Files (.github/instructions/)|These auto-load in Copilot based on the file type you're editing.|They contain coding standards, security rules, testing patterns, and Temper Guards.|Each file has an 'applyTo' pattern — e.g., database.instructions.md loads for *.sql files.|$instr_dir|*.instructions.md|file"
        "2|6|Agent Definitions (.github/agents/)|Specialized AI reviewer personas — each focuses on one concern.|Agents are read-only: they audit code but can't edit files.|Invoke via the agent picker dropdown in Copilot Chat.|$agents_dir|*.agent.md|file"
        "3|6|Prompt Templates (.github/prompts/)|Scaffolding recipes and pipeline step prompts.|Attach in Copilot Chat to generate consistent code patterns.|Step prompts (step0–step6) guide the full pipeline workflow.|$prompts_dir|*.prompt.md|file"
        "4|6|Skills (.github/skills/)|Multi-step executable procedures invoked with / slash commands.|Each skill chains tool calls with validation between steps.|Examples: /database-migration, /test-sweep, /security-audit|$skills_dir||dir"
        "5|6|Lifecycle Hooks (.github/hooks/)|Automatic actions during agent sessions — no manual activation needed.|SessionStart: injects project context. PostToolUse: warns on TODOs.|PreToolUse: blocks edits to forbidden files. Stop: warns if no tests ran.|$hooks_dir||file"
        "6|6|Configuration (.forge.json)|Project config — preset, build/test commands, model routing, and extensions.|The orchestrator reads this to know how to execute your plans.|Edit directly or use the dashboard Config tab at localhost:3100/dashboard.|$forge_json||json"
    )

    for section in "${sections[@]}"; do
        IFS='|' read -r num total title desc1 desc2 desc3 dir_path pattern mode <<< "$section"

        printf "\033[33m[%s/%s] %s\033[0m\n" "$num" "$total" "$title"
        echo ""
        printf "  \033[37m%s\033[0m\n" "$desc1"
        printf "  \033[37m%s\033[0m\n" "$desc2"
        printf "  \033[37m%s\033[0m\n" "$desc3"
        echo ""

        if [ "$mode" = "json" ]; then
            if [ -f "$dir_path" ]; then
                printf "  \033[32mFound: %s\033[0m\n" "$(basename "$dir_path")"
                read -rp "  Press Enter to show key fields, or 's' to skip: " choice
                if [ "$choice" != "s" ]; then
                    local pname tpreset tstack
                    pname=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('$dir_path','utf8'));console.log(j.projectName||'(not set)')}catch{console.log('(parse error)')}" 2>/dev/null)
                    tpreset=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('$dir_path','utf8'));console.log(j.preset||'(not set)')}catch{console.log('(parse error)')}" 2>/dev/null)
                    tstack=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('$dir_path','utf8'));console.log(j.stack||'(not set)')}catch{console.log('(parse error)')}" 2>/dev/null)
                    echo "    Project: $pname"
                    echo "    Preset:  $tpreset"
                    echo "    Stack:   $tstack"
                fi
            else
                printf "  \033[33mNot found — run 'pforge init' first\033[0m\n"
            fi
        elif [ -d "$dir_path" ]; then
            local count=0
            if [ "$mode" = "dir" ]; then
                count=$(find "$dir_path" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
            elif [ -n "$pattern" ]; then
                count=$(find "$dir_path" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | wc -l | tr -d ' ')
            fi
            printf "  \033[32mFound: %s items\033[0m\n" "$count"
            read -rp "  Press Enter to list them, or 's' to skip: " choice
            if [ "$choice" != "s" ]; then
                if [ "$mode" = "dir" ]; then
                    find "$dir_path" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; 2>/dev/null | sort | while read -r f; do
                        echo "    • $f"
                    done
                elif [ -n "$pattern" ]; then
                    find "$dir_path" -maxdepth 1 -name "$pattern" -type f -exec basename {} \; 2>/dev/null | sort | while read -r f; do
                        echo "    • $f"
                    done
                fi
            fi
        else
            printf "  \033[33mNot found — run 'pforge init' first\033[0m\n"
        fi

        echo ""
        if [ "$num" -lt "$total" ]; then
            read -rp "  Press Enter to continue: "
        fi
        echo ""
    done

    echo "═══════════════════════════════════════════════════════════════"
    printf "  \033[32mTour complete! Next steps:\033[0m\n"
    echo ""
    echo "  • Run 'pforge smith' to verify your forge health"
    echo "  • Select the Specifier agent in Copilot Chat to plan your first feature"
    echo "  • Read the walkthrough: docs/QUICKSTART-WALKTHROUGH.md"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
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
    run-plan)     cmd_run_plan "$@" ;;
    org-rules)    cmd_org_rules "$@" ;;
    drift)        cmd_drift "$@" ;;
    incident)     cmd_incident "$@" ;;
    deploy-log)   cmd_deploy_log "$@" ;;
    triage)       cmd_triage "$@" ;;
    regression-guard) cmd_regression_guard "$@" ;;
    runbook)      cmd_runbook "$@" ;;
    hotspot)      cmd_hotspot "$@" ;;
    secret-scan)  cmd_secret_scan "$@" ;;
    env-diff)     cmd_env_diff "$@" ;;
    fix-proposal)    cmd_fix_proposal "$@" ;;
    quorum-analyze)  cmd_quorum_analyze "$@" ;;
    health-trend)    cmd_health_trend "$@" ;;
    smith)        cmd_smith ;;
    tour)         cmd_tour ;;
    help|--help)  show_help ;;
    *)
        echo "ERROR: Unknown command '$COMMAND'" >&2
        show_help
        exit 1
        ;;
esac
