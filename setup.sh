#!/usr/bin/env bash
#
# Plan Forge — Project Setup Wizard (Bash)
#
# Usage:
#   ./setup.sh --preset dotnet --path ~/projects/MyApp --name MyApp
#   ./setup.sh                  # Interactive mode
#   ./setup.sh --force          # Overwrite existing files
#
# Presets: dotnet, typescript, python, java, go, custom

set -euo pipefail

TEMPLATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Defaults ──────────────────────────────────────────────────────────
PRESET=""
PROJECT_PATH=""
PROJECT_NAME=""
FORCE=false
AUTO_DETECT=false

# ─── Color helpers ─────────────────────────────────────────────────────
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

# ─── Parse arguments ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --preset|-p)  PRESET="$2"; shift 2 ;;
        --path)       PROJECT_PATH="$2"; shift 2 ;;
        --name|-n)    PROJECT_NAME="$2"; shift 2 ;;
        --force|-f)   FORCE=true; shift ;;
        --auto-detect|-a) AUTO_DETECT=true; shift ;;
        --help|-h)
            echo "Usage: ./setup.sh [--preset dotnet|typescript|python|java|go|custom] [--path DIR] [--name NAME] [--force] [--auto-detect]"
            exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

# ─── Helpers ───────────────────────────────────────────────────────────
prompt_value() {
    local message="$1"
    local default="${2:-}"
    local value
    if [[ -n "$default" ]]; then
        read -rp "$message [$default]: " value
        echo "${value:-$default}"
    else
        while true; do
            read -rp "$message: " value
            [[ -n "$value" ]] && break
        done
        echo "$value"
    fi
}

copy_with_create() {
    local src="$1"
    local dst="$2"
    local dst_dir
    dst_dir="$(dirname "$dst")"

    mkdir -p "$dst_dir"

    if [[ -f "$dst" ]] && [[ "$FORCE" != true ]]; then
        yellow "  SKIP  $dst (exists)"
        return 1
    fi

    cp "$src" "$dst"
    green "  COPY  $dst"
    return 0
}

replace_placeholders() {
    local file="$1"
    local name="$2"
    local stack="$3"
    local today
    today="$(date +%Y-%m-%d)"

    [[ ! -f "$file" ]] && return

    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|<YOUR PROJECT NAME>|${name}|g" "$file"
        sed -i '' "s|<YOUR TECH STACK>|${stack}|g" "$file"
        sed -i '' "s|<YOUR BUILD COMMAND>|${BUILD_CMD}|g" "$file"
        sed -i '' "s|<YOUR TEST COMMAND>|${TEST_CMD}|g" "$file"
        sed -i '' "s|<YOUR LINT COMMAND>|${LINT_CMD}|g" "$file"
        sed -i '' "s|<YOUR DEV COMMAND>||g" "$file"
        sed -i '' "s|<DATE>|${today}|g" "$file"
    else
        sed -i "s|<YOUR PROJECT NAME>|${name}|g" "$file"
        sed -i "s|<YOUR TECH STACK>|${stack}|g" "$file"
        sed -i "s|<YOUR BUILD COMMAND>|${BUILD_CMD}|g" "$file"
        sed -i "s|<YOUR TEST COMMAND>|${TEST_CMD}|g" "$file"
        sed -i "s|<YOUR LINT COMMAND>|${LINT_CMD}|g" "$file"
        sed -i "s|<YOUR DEV COMMAND>||g" "$file"
        sed -i "s|<DATE>|${today}|g" "$file"
    fi
}

detect_preset() {
    local target="$1"

    # .NET markers
    if find "$target" -maxdepth 3 -name "*.csproj" -o -name "*.sln" -o -name "*.fsproj" 2>/dev/null | head -1 | grep -q .; then
        yellow "  AUTO-DETECT  Found .NET project markers"
        echo "dotnet"
        return
    fi

    # Go markers
    if [[ -f "$target/go.mod" ]]; then
        yellow "  AUTO-DETECT  Found Go project markers"
        echo "go"
        return
    fi

    # Java markers
    if [[ -f "$target/pom.xml" ]] || [[ -f "$target/build.gradle" ]] || [[ -f "$target/build.gradle.kts" ]]; then
        yellow "  AUTO-DETECT  Found Java project markers"
        echo "java"
        return
    fi

    # Python markers
    if [[ -f "$target/pyproject.toml" ]] || [[ -f "$target/requirements.txt" ]] || [[ -f "$target/setup.py" ]] || [[ -f "$target/Pipfile" ]]; then
        yellow "  AUTO-DETECT  Found Python project markers"
        echo "python"
        return
    fi

    # TypeScript/Node markers
    if [[ -f "$target/package.json" ]] || [[ -f "$target/tsconfig.json" ]]; then
        yellow "  AUTO-DETECT  Found TypeScript/Node project markers"
        echo "typescript"
        return
    fi

    yellow "  AUTO-DETECT  No known markers found — using 'custom'"
    echo "custom"
}

# ─── Banner ────────────────────────────────────────────────────────────
echo ""
cyan "╔══════════════════════════════════════════════════════════════╗"
cyan "║       Plan Forge — Project Setup Wizard              ║"
cyan "║       Bootstraps planning pipeline + tech instructions      ║"
cyan "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Interactive Prompts ───────────────────────────────────────────────
if [[ -z "$PROJECT_PATH" ]]; then
    PROJECT_PATH="$(prompt_value "Target project directory" "$(pwd)")"
fi

# Resolve to absolute path
PROJECT_PATH="$(cd "$PROJECT_PATH" 2>/dev/null && pwd || echo "$PROJECT_PATH")"

if [[ ! -d "$PROJECT_PATH" ]]; then
    yellow "Creating directory: $PROJECT_PATH"
    mkdir -p "$PROJECT_PATH"
fi

if [[ -z "$PROJECT_NAME" ]]; then
    default_name="$(basename "$PROJECT_PATH")"
    PROJECT_NAME="$(prompt_value "Project name" "$default_name")"
fi

if [[ -z "$PRESET" ]]; then
    if [[ "$AUTO_DETECT" == true ]]; then
        echo ""
        cyan "Auto-detecting tech stack..."
        PRESET="$(detect_preset "$PROJECT_PATH")"
        if [[ "$FORCE" != true ]]; then
            read -rp "Detected preset: $PRESET. Is this correct? (Y/n) " confirm_preset
            if [[ -n "$confirm_preset" ]] && [[ "$confirm_preset" != [yY]* ]]; then
                echo ""
                cyan "Available presets:"
                echo "  1) dotnet      — .NET / C# / ASP.NET Core"
                echo "  2) typescript  — TypeScript / React / Node.js / Express"
                echo "  3) python      — Python / FastAPI / SQLAlchemy"
                echo "  4) java        — Java / Spring Boot / Gradle / Maven"
                echo "  5) go          — Go / Chi / Gin / Standard Library"
                echo "  6) custom      — Shared files only (add your own instructions)"
                echo ""
                choice="$(prompt_value "Select preset (1-6 or name)" "1")"
                case "$choice" in
                    1|dotnet)     PRESET="dotnet" ;;
                    2|typescript) PRESET="typescript" ;;
                    3|python)     PRESET="python" ;;
                    4|java)       PRESET="java" ;;
                    5|go)         PRESET="go" ;;
                    6|custom)     PRESET="custom" ;;
                    *)            PRESET="$choice" ;;
                esac
            fi
        fi
    else
        echo ""
        cyan "Available presets:"
        echo "  1) dotnet      — .NET / C# / ASP.NET Core"
        echo "  2) typescript  — TypeScript / React / Node.js / Express"
        echo "  3) python      — Python / FastAPI / SQLAlchemy"
        echo "  4) java        — Java / Spring Boot / Gradle / Maven"
        echo "  5) go          — Go / Chi / Gin / Standard Library"
        echo "  6) custom      — Shared files only (add your own instructions)"
        echo ""
        choice="$(prompt_value "Select preset (1-6 or name)" "1")"
        case "$choice" in
            1|dotnet)     PRESET="dotnet" ;;
            2|typescript) PRESET="typescript" ;;
            3|python)     PRESET="python" ;;
            4|java)       PRESET="java" ;;
            5|go)         PRESET="go" ;;
            6|custom)     PRESET="custom" ;;
            *)            PRESET="$choice" ;;
        esac
    fi
fi

case "$PRESET" in
    dotnet)     STACK_LABEL=".NET / C# / ASP.NET Core" ;;
    typescript) STACK_LABEL="TypeScript / React / Node.js" ;;
    python)     STACK_LABEL="Python / FastAPI" ;;
    java)       STACK_LABEL="Java / Spring Boot" ;;
    go)         STACK_LABEL="Go / Standard Library" ;;
    custom)     STACK_LABEL="Custom (configure manually)" ;;
    *)          red "Unknown preset: $PRESET"; exit 1 ;;
esac

# ─── Build/Test/Lint Commands ──────────────────────────────────────────
case "$PRESET" in
    dotnet)     DEFAULT_BUILD="dotnet build"; DEFAULT_TEST="dotnet test"; DEFAULT_LINT="dotnet format --verify-no-changes" ;;
    typescript) DEFAULT_BUILD="pnpm build"; DEFAULT_TEST="pnpm test"; DEFAULT_LINT="pnpm lint" ;;
    python)     DEFAULT_BUILD="python -m build"; DEFAULT_TEST="pytest"; DEFAULT_LINT="ruff check ." ;;
    java)       DEFAULT_BUILD="./gradlew build"; DEFAULT_TEST="./gradlew test"; DEFAULT_LINT="./gradlew spotlessCheck" ;;
    go)         DEFAULT_BUILD="go build ./..."; DEFAULT_TEST="go test ./..."; DEFAULT_LINT="golangci-lint run" ;;
    custom)     DEFAULT_BUILD=""; DEFAULT_TEST=""; DEFAULT_LINT="" ;;
esac

if [[ "$FORCE" != true ]]; then
    echo ""
    cyan "Build/Test/Lint commands (press Enter for defaults):"
    BUILD_CMD="$(prompt_value "Build command" "$DEFAULT_BUILD")"
    TEST_CMD="$(prompt_value "Test command" "$DEFAULT_TEST")"
    LINT_CMD="$(prompt_value "Lint command" "$DEFAULT_LINT")"
else
    BUILD_CMD="$DEFAULT_BUILD"
    TEST_CMD="$DEFAULT_TEST"
    LINT_CMD="$DEFAULT_LINT"
fi

# ─── Summary ───────────────────────────────────────────────────────────
echo ""
cyan "Configuration:"
echo "  Project:  $PROJECT_NAME"
echo "  Path:     $PROJECT_PATH"
echo "  Preset:   $PRESET ($STACK_LABEL)"
echo "  Build:    $BUILD_CMD"
echo "  Test:     $TEST_CMD"
echo "  Lint:     $LINT_CMD"
echo "  Force:    $FORCE"
echo ""

if [[ "$FORCE" != true ]]; then
    read -rp "Proceed? (Y/n) " confirm
    if [[ -n "$confirm" ]] && [[ "$confirm" != [yY]* ]]; then
        red "Aborted."
        exit 0
    fi
fi

# ─── Step 1: Copy Core Files ──────────────────────────────────────────
echo ""
cyan "Step 1: Core planning files"

declare -A CORE_FILES=(
    ["docs/plans/AI-Plan-Hardening-Runbook.md"]="docs/plans/AI-Plan-Hardening-Runbook.md"
    ["docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"]="docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
    ["docs/plans/README.md"]="docs/plans/README.md"
    ["docs/plans/DEPLOYMENT-ROADMAP-TEMPLATE.md"]="docs/plans/DEPLOYMENT-ROADMAP.md"
    ["docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md"]="docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md"
)

for src_rel in "${!CORE_FILES[@]}"; do
    dst_rel="${CORE_FILES[$src_rel]}"
    src="$TEMPLATE_ROOT/$src_rel"
    dst="$PROJECT_PATH/$dst_rel"
    if [[ -f "$src" ]]; then
        copy_with_create "$src" "$dst" || true
    else
        yellow "  WARN  Source not found: $src_rel"
    fi
done

# ─── Step 2: Copy Shared Instruction Files ─────────────────────────────
echo ""
cyan "Step 2: Shared instruction files"

SHARED_FILES=(
    ".github/instructions/ai-plan-hardening-runbook.instructions.md"
    ".github/instructions/architecture-principles.instructions.md"
    ".github/instructions/git-workflow.instructions.md"
    "templates/.github/instructions/project-principles.instructions.md:.github/instructions/project-principles.instructions.md"
)

for rel in "${SHARED_FILES[@]}"; do
    if [[ "$rel" == *":"* ]]; then
        src="$TEMPLATE_ROOT/${rel%%:*}"
        dst="$PROJECT_PATH/${rel##*:}"
    else
        src="$TEMPLATE_ROOT/$rel"
        dst="$PROJECT_PATH/$rel"
    fi
    if [[ -f "$src" ]]; then
        copy_with_create "$src" "$dst" || true
    fi
done

# ─── Step 3: Copy Preset Files ────────────────────────────────────────
if [[ "$PRESET" != "custom" ]]; then
    echo ""
    cyan "Step 3: $PRESET preset files"

    PRESET_DIR="$TEMPLATE_ROOT/presets/$PRESET"
    if [[ ! -d "$PRESET_DIR" ]]; then
        red "  ERROR  Preset directory not found: $PRESET_DIR"
        exit 1
    fi

    # Copy all files from preset, preserving relative paths
    while IFS= read -r -d '' file; do
        rel_path="${file#"$PRESET_DIR/"}"
        dst="$PROJECT_PATH/$rel_path"
        copy_with_create "$file" "$dst" || true
    done < <(find "$PRESET_DIR" -type f -print0)

    # Copy preset copilot-instructions to project root if none exists
    preset_copilot="$PRESET_DIR/.github/copilot-instructions.md"
    root_copilot="$PROJECT_PATH/.github/copilot-instructions.md"
    if [[ -f "$preset_copilot" ]] && [[ ! -f "$root_copilot" ]]; then
        copy_with_create "$preset_copilot" "$root_copilot" || true
    fi

    # Copy preset AGENTS.md to project root if none exists
    preset_agents="$PRESET_DIR/AGENTS.md"
    root_agents="$PROJECT_PATH/AGENTS.md"
    if [[ -f "$preset_agents" ]] && [[ ! -f "$root_agents" ]]; then
        copy_with_create "$preset_agents" "$root_agents" || true
    fi
else
    echo ""
    cyan "Step 3: Custom preset — copying template copilot-instructions.md only"

    src="$TEMPLATE_ROOT/.github/copilot-instructions.md"
    dst="$PROJECT_PATH/.github/copilot-instructions.md"
    if [[ -f "$src" ]]; then
        copy_with_create "$src" "$dst" || true
    fi
fi

# ─── Step 3b: Copy Shared Agents ───────────────────────────────────────
if [[ "$PRESET" != "custom" ]]; then
    echo ""
    cyan "Step 3b: Shared agents (cross-stack reviewers + pipeline agents)"

    # Shared agents (api-contract, accessibility, multi-tenancy, cicd, observability)
    SHARED_AGENTS_DIR="$TEMPLATE_ROOT/presets/shared/.github/agents"
    if [[ -d "$SHARED_AGENTS_DIR" ]]; then
        while IFS= read -r -d '' file; do
            filename="$(basename "$file")"
            dst="$PROJECT_PATH/.github/agents/$filename"
            copy_with_create "$file" "$dst" || true
        done < <(find "$SHARED_AGENTS_DIR" -name "*.agent.md" -type f -print0)
    fi

    # Pipeline agents (specifier, plan-hardener, executor, reviewer-gate, shipper)
    PIPELINE_AGENTS_DIR="$TEMPLATE_ROOT/templates/.github/agents"
    if [[ -d "$PIPELINE_AGENTS_DIR" ]]; then
        while IFS= read -r -d '' file; do
            filename="$(basename "$file")"
            dst="$PROJECT_PATH/.github/agents/$filename"
            copy_with_create "$file" "$dst" || true
        done < <(find "$PIPELINE_AGENTS_DIR" -name "*.agent.md" -type f -print0)
    fi
fi

# ─── Step 3c: Copy Project Principles Prompt + Extension Templates ─────
if [[ "$PRESET" != "custom" ]]; then
    echo ""
    cyan "Step 3c: Project Principles prompt + extension templates + hooks"

    # Project Principles prompt
    pp_prompt_src="$TEMPLATE_ROOT/templates/.github/prompts/project-principles.prompt.md"
    pp_prompt_dst="$PROJECT_PATH/.github/prompts/project-principles.prompt.md"
    if [[ -f "$pp_prompt_src" ]]; then
        copy_with_create "$pp_prompt_src" "$pp_prompt_dst" || true
    fi

    # Extension template directory
    ext_template_src="$TEMPLATE_ROOT/templates/.forge"
    if [[ -d "$ext_template_src" ]]; then
        while IFS= read -r -d '' file; do
            rel_path="${file#"$ext_template_src/"}"
            dst="$PROJECT_PATH/.forge/$rel_path"
            copy_with_create "$file" "$dst" || true
        done < <(find "$ext_template_src" -type f -print0)
    fi

    # Hooks
    hooks_src="$TEMPLATE_ROOT/templates/.github/hooks"
    if [[ -d "$hooks_src" ]]; then
        while IFS= read -r -d '' file; do
            rel_path="${file#"$hooks_src/"}"
            dst="$PROJECT_PATH/.github/hooks/$rel_path"
            copy_with_create "$file" "$dst" || true
        done < <(find "$hooks_src" -type f -print0)
    fi
fi

# ─── Step 4: Replace Placeholders ─────────────────────────────────────
echo ""
cyan "Step 4: Replacing placeholders"

while IFS= read -r -d '' file; do
    replace_placeholders "$file" "$PROJECT_NAME" "$STACK_LABEL"
done < <(find "$PROJECT_PATH" -name "*.md" -type f -print0)

green "  DONE  Placeholders replaced"

# ─── Step 5: Generate .forge.json ─────────────────────────────
echo ""
cyan "Step 5: Generating .forge.json"

CONFIG_PATH="$PROJECT_PATH/.forge.json"
VERSION_FILE="$TEMPLATE_ROOT/VERSION"
TEMPLATE_VERSION="1.0.0"
if [[ -f "$VERSION_FILE" ]]; then
    TEMPLATE_VERSION="$(tr -d '\n' < "$VERSION_FILE")"
fi
cat > "$CONFIG_PATH" <<EOF
{
  "projectName": "$PROJECT_NAME",
  "preset": "$PRESET",
  "stack": "$STACK_LABEL",
  "setupDate": "$(date +%Y-%m-%d)",
  "templateVersion": "$TEMPLATE_VERSION"
}
EOF

green "  CREATED  .forge.json"

# ─── Step 5b: Generate capabilities.json (machine-readable discovery) ────
CAPABILITIES_PATH="$PROJECT_PATH/.forge/capabilities.json"
mkdir -p "$(dirname "$CAPABILITIES_PATH")"

PROMPT_LIST="[]"
if [[ -d "$PROJECT_PATH/.github/prompts" ]]; then
    PROMPT_LIST=$(find "$PROJECT_PATH/.github/prompts" -maxdepth 1 -name "*.prompt.md" -printf '"%f",' 2>/dev/null | sed 's/,$//' | awk '{print "["$0"]"}')
    [[ "$PROMPT_LIST" == "[]" ]] || true
fi

AGENT_LIST="[]"
if [[ -d "$PROJECT_PATH/.github/agents" ]]; then
    AGENT_LIST=$(find "$PROJECT_PATH/.github/agents" -maxdepth 1 -name "*.agent.md" -printf '"%f",' 2>/dev/null | sed 's/,$//' | awk '{print "["$0"]"}')
    [[ "$AGENT_LIST" == "[]" ]] || true
fi

SKILL_LIST="[]"
if [[ -d "$PROJECT_PATH/.github/skills" ]]; then
    SKILL_LIST=$(find "$PROJECT_PATH/.github/skills" -mindepth 1 -maxdepth 1 -type d -printf '"%f",' 2>/dev/null | sed 's/,$//' | awk '{print "["$0"]"}')
    [[ "$SKILL_LIST" == "[]" ]] || true
fi

INSTR_LIST="[]"
if [[ -d "$PROJECT_PATH/.github/instructions" ]]; then
    INSTR_LIST=$(find "$PROJECT_PATH/.github/instructions" -maxdepth 1 -name "*.instructions.md" -printf '"%f",' 2>/dev/null | sed 's/,$//' | awk '{print "["$0"]"}')
    [[ "$INSTR_LIST" == "[]" ]] || true
fi

cat > "$CAPABILITIES_PATH" <<EOF
{
  "generatedBy": "plan-forge-setup",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "preset": "$PRESET",
  "prompts": ${PROMPT_LIST:-[]},
  "agents": ${AGENT_LIST:-[]},
  "skills": ${SKILL_LIST:-[]},
  "instructions": ${INSTR_LIST:-[]},
  "hooks": [".github/hooks/plan-forge.json"]
}
EOF

green "  CREATED  .forge/capabilities.json"

# ─── Step 6: Copy VS Code Settings Template ────────────────────────────
echo ""
cyan "Step 6: VS Code settings template"

vscode_src="$TEMPLATE_ROOT/templates/vscode-settings.json.template"
vscode_dst="$PROJECT_PATH/.vscode/settings.json"
if [[ -f "$vscode_src" ]]; then
    copy_with_create "$vscode_src" "$vscode_dst" || true
fi

# ─── Step 7: Copy Copilot VS Code Guide ────────────────────────────────
guide_src="$TEMPLATE_ROOT/docs/COPILOT-VSCODE-GUIDE.md"
guide_dst="$PROJECT_PATH/docs/COPILOT-VSCODE-GUIDE.md"
if [[ -f "$guide_src" ]]; then
    copy_with_create "$guide_src" "$guide_dst" || true
fi

# ─── Done ──────────────────────────────────────────────────────────────
echo ""
green "╔══════════════════════════════════════════════════════════════╗"
green "║                    Setup Complete!                          ║"
green "╚══════════════════════════════════════════════════════════════╝"
echo ""
cyan "Files installed to: $PROJECT_PATH"
echo ""
yellow "Next steps:"
echo "  1. Review .github/copilot-instructions.md — fill in project-specific details"
echo "  2. Review AGENTS.md — customize worker patterns for your app"
echo "  3. Review .vscode/settings.json — uncomment instruction file references"
echo "  4. Review .github/prompts/ — customize scaffolding recipes for your conventions"
echo "  5. Review .github/agents/ — tailor reviewer checklists for your project"
echo "  6. Review .github/skills/ — update build/deploy commands for your CI/CD"
echo "  7. Review docs/plans/DEPLOYMENT-ROADMAP.md — add your phases"
echo "  8. Read docs/COPILOT-VSCODE-GUIDE.md for Copilot Agent Mode workflow"
echo "  9. Start planning: open docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
echo ""
yellow "Optional (recommended):"
echo "  - Run .github/prompts/project-profile.prompt.md to generate project-specific guardrails"
echo "  - Run .github/prompts/project-principles.prompt.md to define project principles"
echo "  - Use .github/prompts/step0-specify-feature.prompt.md to define your first feature"
echo ""

# ─── Step 8: Auto-validate ─────────────────────────────────────────────
cyan "Running validation..."
validate_script="$TEMPLATE_ROOT/validate-setup.sh"
if [[ -f "$validate_script" ]]; then
    bash "$validate_script" --path "$PROJECT_PATH"
fi
