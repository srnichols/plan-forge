#!/usr/bin/env bash
#
# AI Plan Hardening Template — Project Setup Wizard (Bash)
#
# Usage:
#   ./setup.sh --preset dotnet --path ~/projects/MyApp --name MyApp
#   ./setup.sh                  # Interactive mode
#   ./setup.sh --force          # Overwrite existing files
#
# Presets: dotnet, typescript, python, custom

set -euo pipefail

TEMPLATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Defaults ──────────────────────────────────────────────────────────
PRESET=""
PROJECT_PATH=""
PROJECT_NAME=""
FORCE=false

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
        --help|-h)
            echo "Usage: ./setup.sh [--preset dotnet|typescript|python|custom] [--path DIR] [--name NAME] [--force]"
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
        # macOS sed requires '' after -i
        sed -i '' "s|<YOUR PROJECT NAME>|${name}|g" "$file"
        sed -i '' "s|<YOUR TECH STACK>|${stack}|g" "$file"
        sed -i '' "s|<DATE>|${today}|g" "$file"
    else
        sed -i "s|<YOUR PROJECT NAME>|${name}|g" "$file"
        sed -i "s|<YOUR TECH STACK>|${stack}|g" "$file"
        sed -i "s|<DATE>|${today}|g" "$file"
    fi
}

# ─── Banner ────────────────────────────────────────────────────────────
echo ""
cyan "╔══════════════════════════════════════════════════════════════╗"
cyan "║       AI Plan Hardening — Project Setup Wizard              ║"
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
    echo ""
    cyan "Available presets:"
    echo "  1) dotnet      — .NET / C# / ASP.NET Core"
    echo "  2) typescript  — TypeScript / React / Node.js / Express"
    echo "  3) python      — Python / FastAPI / SQLAlchemy"
    echo "  4) custom      — Shared files only (add your own instructions)"
    echo ""
    choice="$(prompt_value "Select preset (1-4 or name)" "1")"
    case "$choice" in
        1|dotnet)     PRESET="dotnet" ;;
        2|typescript) PRESET="typescript" ;;
        3|python)     PRESET="python" ;;
        4|custom)     PRESET="custom" ;;
        *)            PRESET="$choice" ;;
    esac
fi

case "$PRESET" in
    dotnet)     STACK_LABEL=".NET / C# / ASP.NET Core" ;;
    typescript) STACK_LABEL="TypeScript / React / Node.js" ;;
    python)     STACK_LABEL="Python / FastAPI" ;;
    custom)     STACK_LABEL="Custom (configure manually)" ;;
    *)          red "Unknown preset: $PRESET"; exit 1 ;;
esac

# ─── Summary ───────────────────────────────────────────────────────────
echo ""
cyan "Configuration:"
echo "  Project:  $PROJECT_NAME"
echo "  Path:     $PROJECT_PATH"
echo "  Preset:   $PRESET ($STACK_LABEL)"
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
)

for rel in "${SHARED_FILES[@]}"; do
    src="$TEMPLATE_ROOT/$rel"
    dst="$PROJECT_PATH/$rel"
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

# ─── Step 4: Replace Placeholders ─────────────────────────────────────
echo ""
cyan "Step 4: Replacing placeholders"

while IFS= read -r -d '' file; do
    replace_placeholders "$file" "$PROJECT_NAME" "$STACK_LABEL"
done < <(find "$PROJECT_PATH" -name "*.md" -type f -print0)

green "  DONE  Placeholders replaced"

# ─── Step 5: Generate .plan-hardening.json ─────────────────────────────
echo ""
cyan "Step 5: Generating .plan-hardening.json"

CONFIG_PATH="$PROJECT_PATH/.plan-hardening.json"
cat > "$CONFIG_PATH" <<EOF
{
  "projectName": "$PROJECT_NAME",
  "preset": "$PRESET",
  "stack": "$STACK_LABEL",
  "setupDate": "$(date +%Y-%m-%d)",
  "templateVersion": "1.0.0"
}
EOF

green "  CREATED  .plan-hardening.json"

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
echo "  4. Review docs/plans/DEPLOYMENT-ROADMAP.md — add your phases"
echo "  5. Read docs/COPILOT-VSCODE-GUIDE.md for Copilot Agent Mode workflow"
echo "  6. Start planning: open docs/plans/AI-Plan-Hardening-Runbook-Instructions.md"
echo ""
