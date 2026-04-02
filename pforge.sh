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
    help|--help)  show_help ;;
    *)
        echo "ERROR: Unknown command '$COMMAND'" >&2
        show_help
        exit 1
        ;;
esac
