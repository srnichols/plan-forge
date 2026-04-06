# Plan Forge CLI Guide

> **Optional**: The `pforge` CLI is a convenience wrapper for common pipeline operations. Every command shows the equivalent manual steps, so non-CLI users can follow along. The manual workflow (copy-paste prompts, edit files, run git commands) works identically without the CLI.
>
> **For AI Agents**: See [AI Agent Usage](#ai-agent-usage) at the bottom for platform detection, decision rules, and programmatic integration.

---

## Installation

The CLI is two scripts — no dependencies beyond Git and your shell:

| Platform | File | Usage |
|----------|------|-------|
| **Windows / PowerShell** | `pforge.ps1` | `.\pforge.ps1 <command>` |
| **macOS / Linux / Bash** | `pforge.sh` | `./pforge.sh <command>` |

Both scripts are copied to your project root during setup. If you ran `setup.ps1` / `setup.sh`, they're already there.

**Not there?** Copy them manually from the Plan Forge template repo:
```bash
cp /path/to/plan-forge/pforge.ps1 .
cp /path/to/plan-forge/pforge.sh .
chmod +x pforge.sh
```

---

## Commands

Each command shows **PowerShell** and **Bash** syntax. Both are functionally identical.

### `pforge init`

Bootstrap a project with the Plan Forge Pipeline. Delegates to `setup.ps1` / `setup.sh`.

```powershell
# PowerShell
.\pforge.ps1 init -Preset dotnet
.\pforge.ps1 init -Preset typescript -ProjectPath ./my-app
.\pforge.ps1 init -Preset swift -ProjectPath ./my-ios-app
.\pforge.ps1 init -Preset azure-iac -ProjectPath ./infra
.\pforge.ps1 init -Preset dotnet,azure-iac -ProjectPath ./my-app
.\pforge.ps1 init -Preset dotnet -Agent claude          # Add Claude Code support
.\pforge.ps1 init -Preset dotnet -Agent all              # All agents
```

```bash
# Bash
./pforge.sh init --preset dotnet
./pforge.sh init --preset typescript --path ./my-app
./pforge.sh init --preset swift --path ./my-ios-app
./pforge.sh init --preset azure-iac --path ./infra
./pforge.sh init --preset dotnet,azure-iac --path ./my-app
./pforge.sh init --preset dotnet --agent claude           # Add Claude Code support
./pforge.sh init --preset dotnet --agent all               # All agents
```

**Equivalent manual steps:**
1. Run `.\setup.ps1` / `./setup.sh` with your preferred parameters
2. Follow the interactive wizard

---

### `pforge check`

Validate that setup completed correctly. Delegates to `validate-setup.ps1` / `validate-setup.sh`.

```powershell
# PowerShell
.\pforge.ps1 check
```

```bash
# Bash
./pforge.sh check
```

**Equivalent manual steps:**
1. Run `.\validate-setup.ps1`
2. Review the output for any missing files

---

### `pforge status`

Show all phases from `DEPLOYMENT-ROADMAP.md` with their current status.

```powershell
# PowerShell
.\pforge.ps1 status
```

```bash
# Bash
./pforge.sh status
```

**Output:**
```
Phase Status (from DEPLOYMENT-ROADMAP.md):
─────────────────────────────────────────────
  Phase 1: User Authentication  📋 Planned
    Add OAuth2 login and role-based access
  Phase 2: Dashboard Widgets  🚧 In Progress
    Personalized metrics and activity feed
```

**Equivalent manual steps:**
1. Open `docs/plans/DEPLOYMENT-ROADMAP.md`
2. Review the Phases section for status icons

---

### `pforge new-phase <name>`

Create a new phase plan file and add an entry to the deployment roadmap.

```powershell
# PowerShell — preview what would be created
.\pforge.ps1 new-phase user-auth --dry-run

# Create the phase
.\pforge.ps1 new-phase user-auth
```

```bash
# Bash
./pforge.sh new-phase user-auth --dry-run
./pforge.sh new-phase user-auth
```

**What it does:**
1. Finds the next phase number (e.g., Phase 3)
2. Creates `docs/plans/Phase-3-USER-AUTH-PLAN.md` from template
3. Adds a Phase 3 entry to `DEPLOYMENT-ROADMAP.md`

**Equivalent manual steps:**
1. Create file `docs/plans/Phase-N-NAME-PLAN.md`
2. Add phase entry to `docs/plans/DEPLOYMENT-ROADMAP.md`
3. Fill in the plan using Step 1 (Draft) from the runbook

---

### `pforge branch <plan-file>`

Create a Git branch matching the plan's declared Branch Strategy.

```powershell
# PowerShell — preview
.\pforge.ps1 branch docs/plans/Phase-3-USER-AUTH-PLAN.md --dry-run

# Create
.\pforge.ps1 branch docs/plans/Phase-3-USER-AUTH-PLAN.md
```

```bash
# Bash
./pforge.sh branch docs/plans/Phase-3-USER-AUTH-PLAN.md --dry-run
./pforge.sh branch docs/plans/Phase-3-USER-AUTH-PLAN.md
```

**What it does:**
1. Reads the `**Branch**:` field from the plan's Branch Strategy section
2. Creates the branch (e.g., `feature/phase-3-user-auth`)

If no branch strategy is declared or the plan uses "trunk," no branch is created.

**Equivalent manual steps:**
1. Read the Branch Strategy section in your plan
2. Run `git checkout -b <branch-name>`

---

### `pforge commit <plan-file> <slice-number>`

Stage all changes and commit with a conventional commit message derived from the slice's goal.

```powershell
# PowerShell — preview
.\pforge.ps1 commit docs/plans/Phase-3-USER-AUTH-PLAN.md 2 --dry-run

# Commit
.\pforge.ps1 commit docs/plans/Phase-3-USER-AUTH-PLAN.md 2
```

```bash
# Bash
./pforge.sh commit docs/plans/Phase-3-USER-AUTH-PLAN.md 2 --dry-run
./pforge.sh commit docs/plans/Phase-3-USER-AUTH-PLAN.md 2
```

**What it does:**
1. Reads the plan file to find Slice 2's goal text
2. Generates a conventional commit message: `feat(phase-3/slice-2): implement UserProfileRepository`
3. Runs `git add -A` then `git commit -m "..."`

**Equivalent manual steps:**
1. Read the slice goal from your plan
2. Run `git add -A`
3. Run `git commit -m "feat(phase-N/slice-K): <goal>"`

---

### `pforge phase-status <plan-file> <status>`

Update a phase's status in the deployment roadmap.

```powershell
# PowerShell
.\pforge.ps1 phase-status docs/plans/Phase-3-USER-AUTH-PLAN.md in-progress
.\pforge.ps1 phase-status docs/plans/Phase-3-USER-AUTH-PLAN.md complete
```

```bash
# Bash
./pforge.sh phase-status docs/plans/Phase-3-USER-AUTH-PLAN.md in-progress
./pforge.sh phase-status docs/plans/Phase-3-USER-AUTH-PLAN.md complete
```

**Valid statuses:** `planned`, `in-progress`, `complete`, `paused`

**What it does:**
1. Finds the phase entry in `DEPLOYMENT-ROADMAP.md` by matching the plan filename
2. Updates the `**Status**:` line to the corresponding icon (📋, 🚧, ✅, ⏸️)

**Equivalent manual steps:**
1. Open `docs/plans/DEPLOYMENT-ROADMAP.md`
2. Find the phase entry
3. Change `**Status**:` to the new status icon

---

### `pforge sweep`

Scan all code files for deferred-work markers (TODO, FIXME, HACK, stub, placeholder, mock data). This is the CLI equivalent of the Completeness Sweep (Step 4).

```powershell
# PowerShell
.\pforge.ps1 sweep
```

```bash
# Bash
./pforge.sh sweep
```

**Output:**
```
Completeness Sweep — scanning for deferred-work markers:
─────────────────────────────────────────────────────────
  src/Services/UserService.cs:42: // TODO: Wire to real email service
  src/Controllers/AuthController.cs:18: // FIXME: Add rate limiting

FOUND 2 deferred-work marker(s). Resolve before Step 5 (Review Gate).
```

**Equivalent manual steps:**
1. Search code files for: TODO, FIXME, HACK, stub, placeholder, mock data
2. Review each finding and resolve or document

---

### `pforge diff <plan-file>`

Compare changed files (uncommitted) against the plan's Scope Contract. Flags forbidden files, unplanned files, and confirms in-scope changes.

```powershell
# PowerShell
.\pforge.ps1 diff docs/plans/Phase-3-USER-AUTH-PLAN.md
```

```bash
# Bash
./pforge.sh diff docs/plans/Phase-3-USER-AUTH-PLAN.md
```

**Output:**
```
Scope Drift Check — 4 changed file(s) vs plan:
───────────────────────────────────────────────────────────
  ✅ IN SCOPE   src/Services/UserService.cs
  ✅ IN SCOPE   src/Repositories/UserRepository.cs
  🟡 UNPLANNED  src/Config/AppSettings.cs  (not in Scope Contract)
  🔴 FORBIDDEN  tests/Legacy/OldTests.cs  (matches: tests/Legacy/)

DRIFT DETECTED — 1 forbidden file(s) touched.
```

**Equivalent manual steps:**
1. Run `git diff --name-only`
2. Compare each changed file against the plan's In Scope and Forbidden Actions sections

---

### `pforge analyze <plan-file>`

Cross-artifact consistency analysis — validates that requirements are traced to slices, code changes are within scope, tests cover MUST criteria, and validation gates are defined.

```powershell
# PowerShell — Single-model analysis
.\pforge.ps1 analyze docs/plans/Phase-1-AUTH-PLAN.md

# Multi-model quorum analysis
.\pforge.ps1 analyze docs/plans/Phase-1-AUTH-PLAN.md --quorum

# Code file analysis (auto-detects mode from filename)
.\pforge.ps1 analyze src/services/billing.ts --mode file

# Custom model lineup
.\pforge.ps1 analyze docs/plans/Phase-1-AUTH-PLAN.md --models grok-3-mini,grok-4
```

```bash
# Bash — Single-model analysis
./pforge.sh analyze docs/plans/Phase-1-AUTH-PLAN.md

# Multi-model quorum analysis
./pforge.sh analyze docs/plans/Phase-1-AUTH-PLAN.md --quorum

# Code file analysis
./pforge.sh analyze src/services/billing.ts --mode file

# Custom model lineup
./pforge.sh analyze docs/plans/Phase-1-AUTH-PLAN.md --models grok-4,grok-3-mini
```

**Four scoring dimensions** (25 points each, 100 total):

| Dimension | What It Checks |
|---|---|
| Traceability | MUST/SHOULD criteria exist, slices defined, criteria mapped to slices |
| Coverage | Changed files within Scope Contract, no forbidden edits |
| Test Coverage | MUST criteria matched against test files via keyword fuzzy matching |
| Gates | Validation gates referenced in slices, no deferred-work markers in changed files |

**Quorum mode** (`--quorum`): Dispatches analysis to multiple AI models in parallel, then synthesizes findings into a consensus report with confidence levels and contradictions resolved.

**Flags**:
| Flag | Description |
|------|-------------|
| `--quorum` | Multi-model consensus analysis |
| `--mode plan\|file` | Explicit analysis mode (auto-detected if omitted) |
| `--models m1,m2` | Comma-separated model override (default: quorum config models) |

**Exit codes**: 0 = pass (score >= 60), 1 = fail (score < 60)

**Also available as**: `forge_analyze` MCP tool, and `analyze: true` input on the GitHub Action.

---

### `pforge diagnose <file>`

Multi-model bug investigation — dispatches file analysis to multiple AI models independently, then synthesizes root cause analysis with fix recommendations.

```powershell
# PowerShell
.\pforge.ps1 diagnose src/services/billing.ts

# With custom models
.\pforge.ps1 diagnose src/auth/token-validator.ts --models grok-3-mini,grok-4
```

```bash
# Bash
./pforge.sh diagnose src/services/billing.ts

# With custom models
./pforge.sh diagnose src/auth/token-validator.ts --models grok-4.20,grok-3-mini
```

**Each model analyzes independently for**:
- Root cause identification
- Failure modes and edge cases
- Reproduction steps
- Impact assessment
- Fix recommendations with confidence levels
- Regression risk

**Output**: Synthesized consensus report saved to `.forge/analysis/diagnose-*`. Includes per-model findings, agreement/disagreement areas, and prioritized action items.

**Also available as**: `forge_diagnose` MCP tool.

---

### `pforge ext search [query]`

Browse the community extension catalog. Shows all extensions, or filter by keyword.

```powershell
# PowerShell
.\pforge.ps1 ext search              # Show all extensions
.\pforge.ps1 ext search saas         # Filter by keyword
.\pforge.ps1 ext search integration  # Filter by category
```

```bash
# Bash
./pforge.sh ext search
./pforge.sh ext search compliance
```

Fetches from the local `extensions/catalog.json` first, falls back to GitHub. Extensions marked with `speckit_compatible` work in both Plan Forge and Spec Kit.

---

### `pforge ext add <name>`

Download and install an extension from the community catalog in one step.

```powershell
# PowerShell
.\pforge.ps1 ext add saas-multi-tenancy
.\pforge.ps1 ext add plan-forge-memory
```

```bash
# Bash
./pforge.sh ext add azure-infrastructure
```

Downloads the extension ZIP from GitHub, extracts the relevant subfolder, and delegates to `ext install`. No manual cloning needed.

---

### `pforge ext info <name>`

Show detailed information about a catalog extension before installing.

```powershell
# PowerShell
.\pforge.ps1 ext info plan-forge-memory
```

```bash
# Bash
./pforge.sh ext info saas-multi-tenancy
```

Shows: name, version, author, category, provides (instructions/agents/prompts/skills), tags, Spec Kit compatibility, and install command.

---

### `pforge ext install <path>`

Install an extension from a local path.

```powershell
# PowerShell
.\pforge.ps1 ext install .forge/extensions/healthcare-compliance
```

```bash
# Bash
./pforge.sh ext install .forge/extensions/healthcare-compliance
```

**What it does:**
1. Validates `extension.json` exists in the source path
2. Copies the extension folder to `.forge/extensions/`
3. Copies instruction/agent/prompt files to `.github/` directories
4. Updates `extensions.json` manifest

**Equivalent manual steps:**
1. Copy the extension folder to `.forge/extensions/<name>/`
2. Copy files from `instructions/` → `.github/instructions/`
3. Copy files from `agents/` → `.github/agents/`
4. Copy files from `prompts/` → `.github/prompts/`

---

### `pforge ext list`

List all installed extensions.

```powershell
# PowerShell
.\pforge.ps1 ext list
```

```bash
# Bash
./pforge.sh ext list
```

**Output:**
```
Installed Extensions:
─────────────────────
  healthcare-compliance v1.0.0  (installed 2026-03-23)
```

---

### `pforge ext remove <name>`

Remove an installed extension. Prompts for confirmation unless `--force` is used.

```powershell
# PowerShell
.\pforge.ps1 ext remove healthcare-compliance
.\pforge.ps1 ext remove healthcare-compliance --force
```

```bash
# Bash
./pforge.sh ext remove healthcare-compliance
./pforge.sh ext remove healthcare-compliance --force
```

**What it does:**
1. Reads the extension manifest to find installed files
2. Removes those files from `.github/` directories
3. Deletes the extension folder from `.forge/extensions/`
4. Updates `extensions.json` manifest

---

### `pforge update [source-path]`

Update framework files from a Plan Forge source without re-running the full setup wizard. Preserves all user-customized files.

```powershell
# PowerShell — auto-detect source (looks for ../plan-forge)
.\pforge.ps1 update

# Specify source path explicitly
.\pforge.ps1 update C:\path\to\plan-forge

# Preview changes without applying
.\pforge.ps1 update --dry-run

# Skip confirmation prompt
.\pforge.ps1 update --force
```

```bash
# Bash
./pforge.sh update
./pforge.sh update /path/to/plan-forge
./pforge.sh update --dry-run
./pforge.sh update --force
```

**Bootstrapping from an older version**: If your `pforge.ps1` / `pforge.sh` doesn't have the `update` command yet (pre-v1.2.1), replace it first:

```powershell
# PowerShell — download latest pforge.ps1, then update
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/srnichols/plan-forge/master/pforge.ps1" -OutFile pforge.ps1
.\pforge.ps1 update ../plan-forge
```

```bash
# Bash — download latest pforge.sh, then update
curl -sL https://raw.githubusercontent.com/srnichols/plan-forge/master/pforge.sh -o pforge.sh && chmod +x pforge.sh
./pforge.sh update ../plan-forge
```

**What it updates** (framework files — safe to replace):
- Pipeline prompts (`step0-step6*.prompt.md`)
- Pipeline agents (specifier, plan-hardener, executor, reviewer-gate, shipper)
- Shared instruction files (architecture-principles, git-workflow, ai-plan-hardening-runbook)
- Runbook and Instructions docs
- Lifecycle hooks
- **New** preset-specific files (instructions, agents, prompts, skills) that don’t yet exist in your project

**What it never touches** (user-customized files):
- `.github/copilot-instructions.md`
- `project-profile.instructions.md`
- `project-principles.instructions.md`
- `docs/plans/DEPLOYMENT-ROADMAP.md`
- `docs/plans/PROJECT-PRINCIPLES.md`
- `AGENTS.md`
- `.forge.json` (only `templateVersion` is updated)
- Your plan files (`Phase-*-PLAN.md`)
- Existing preset instruction/agent/prompt/skill files (preserved — you may have customized them)

**What it does:**
1. Compares `.forge.json` templateVersion with the source VERSION
2. Hashes each framework file to detect actual changes
3. Shows a preview of updates and new files
4. Asks for confirmation (unless `--force`)
5. Copies changed files and updates `.forge.json` version

**Equivalent manual steps:**
1. Clone the latest Plan Forge repo
2. Compare VERSION against your `.forge.json` templateVersion
3. Copy updated framework files, being careful not to overwrite customized files
4. Update `.forge.json` templateVersion

---

### `pforge run-plan <plan-file>`

Execute a hardened plan — spawn CLI workers for each slice, validate at every boundary, track tokens.

```powershell
# PowerShell — estimate cost without executing
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --estimate

# Full auto execution (gh copilot CLI)
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md

# Assisted mode (you code in VS Code, orchestrator validates gates)
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --assisted

# Specify model
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --model claude-sonnet-4.6

# Resume from slice 3 after fixing a failure
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --resume-from 3
```

```bash
# Bash
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --estimate
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --assisted
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --model gpt-5.2-codex
```

**Execution Modes:**

| Mode | Flag | What Happens |
|------|------|--------------|
| **Full Auto** | *(default)* | `gh copilot` CLI executes each slice with full project context |
| **Assisted** | `--assisted` | You code in VS Code; orchestrator prompts you and validates gates |
| **Estimate** | `--estimate` | Shows slice count, token estimate, and cost — without executing |

**Flags:**
- `--estimate` — Cost prediction only
- `--assisted` — Interactive mode (human codes, orchestrator validates)
- `--model <name>` — Override model (e.g., `claude-sonnet-4.6`, `gpt-5.2-codex`)
- `--resume-from <N>` — Skip completed slices, resume from slice N
- `--dry-run` — Parse and validate plan without executing

**Results written to:** `.forge/runs/<timestamp>/`
- `run.json` — run metadata
- `slice-N.json` — per-slice results with token tracking
- `slice-N-log.txt` — worker session logs
- `summary.json` — aggregate results with sweep + analyze scores

**Also available as:** `forge_run_plan` MCP tool (callable from Copilot Chat or Claude)

**Equivalent manual steps:**
1. Parse the plan to identify slices and validation gates
2. For each slice: execute code changes, run build/test commands
3. On failure: stop and fix before proceeding
4. After all slices: run `pforge sweep` and `pforge analyze`

---

### `pforge smith`

Inspect your forge — diagnose your environment, VS Code configuration, setup health, version currency, and common problems. Every issue includes a `FIX:` suggestion.

```powershell
# PowerShell
.\pforge.ps1 smith
```

```bash
# Bash
./pforge.sh smith
```

**What The Smith checks:**

| Category | Checks |
|----------|--------|
| **Environment** | git, VS Code CLI, PowerShell/bash version, GitHub CLI |
| **VS Code Config** | `chat.agent.enabled`, `chat.useCustomizationsInParentRepositories`, `chat.promptFiles` |
| **Setup Health** | `.forge.json` valid, `copilot-instructions.md` exists, file counts match preset expectations |
| **Version Currency** | Compare installed `templateVersion` vs source `VERSION` |
| **Common Problems** | Duplicate instructions, orphaned agents, missing `applyTo`, unresolved placeholders |

**Example output:**
```
╔══════════════════════════════════════════════════════════════╗
║       Plan Forge — The Smith                                 ║
╚══════════════════════════════════════════════════════════════╝

Environment:
  ✅ git 2.44.0
  ✅ code (VS Code CLI) 1.99.0
  ✅ PowerShell 7.5.0

VS Code Configuration:
  ✅ chat.agent.enabled = true
  ❌ chat.useCustomizationsInParentRepositories not set
     FIX: Add "chat.useCustomizationsInParentRepositories": true to .vscode/settings.json

Setup Health:
  ✅ .forge.json valid (preset: dotnet, v1.3.0)
  ✅ 17 instruction files (expected: >=15 for dotnet)

────────────────────────────────────────────────────
  Results:  8 passed  |  1 failed  |  2 warnings
────────────────────────────────────────────────────
```

**Equivalent manual steps:**
1. Check that required tools are installed (git, VS Code, PowerShell)
2. Verify VS Code settings for Copilot agent mode
3. Validate `.forge.json` and file counts per preset
4. Check version currency against Plan Forge source
5. Scan for common problems (duplicates, orphans, broken references)

---

### `pforge help`

Show all available commands.

```powershell
# PowerShell
.\pforge.ps1 help
```

```bash
# Bash
./pforge.sh help
```

---

## CLI vs Manual Workflow

| Task | CLI | Manual |
|------|-----|--------|
| Bootstrap project | `pforge init -Preset dotnet` | Run `setup.ps1`, follow wizard |
| Bootstrap Azure IaC | `pforge init -Preset azure-iac` | Run `setup.ps1 -Preset azure-iac` |
| Bootstrap mixed (app + infra) | `pforge init -Preset dotnet,azure-iac` | Run `setup.ps1 -Preset dotnet,azure-iac` |
| Check setup | `pforge check` | Run `validate-setup.ps1` |
| See phase status | `pforge status` | Open `DEPLOYMENT-ROADMAP.md` |
| Start new phase | `pforge new-phase <name>` | Create plan file, edit roadmap |
| Create branch | `pforge branch <plan>` | Read plan, run `git checkout -b` |
| Commit a slice | `pforge commit <plan> <N>` | Read slice goal, run `git add -A && git commit -m "..."` |
| Update phase status | `pforge phase-status <plan> <status>` | Edit DEPLOYMENT-ROADMAP.md manually |
| Completeness sweep | `pforge sweep` | grep for TODO/FIXME/stub across codebase |
| Scope drift check | `pforge diff <plan>` | git diff + manual comparison to Scope Contract |
| Install extension | `pforge ext install <path>` | Copy files to 3 directories |
| Update framework | `pforge update [source]` | Clone latest Plan Forge, manually copy framework files |
| Inspect the forge | `pforge smith` | Manually check tools, VS Code settings, file counts, version |
| Harden a plan | *(use prompt)* | Paste Step 2 prompt into Copilot |
| Execute slices | *(use prompt)* | Paste Step 3 prompt into Copilot |
| Review & audit | *(use prompt)* | Paste Step 5 prompt into Copilot |

The CLI handles **project management tasks** (setup, status, phases, branches, extensions). The **core pipeline** (hardening, execution, review) still runs through Copilot Agent Mode — those are AI-driven workflows, not shell commands.

---

## CI Integration

Automate plan validation in your GitHub workflow with the Plan Forge Validate action:

```yaml
# .github/workflows/plan-forge-validate.yml
name: Plan Forge Validate
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: srnichols/plan-forge-validate@v1
        with:
          sweep: true
          fail-on-warnings: false
```

The action runs the same checks as `pforge smith` + `pforge check` + `pforge sweep` — setup health, file counts, placeholders, orphans, plan artifacts, and code cleanliness. See [docs/plans/examples/plan-forge-validate.yml](../docs/plans/examples/plan-forge-validate.yml) for a complete example.

**Inputs:**
| Input | Default | Description |
|-------|---------|-------------|
| `path` | `.` | Project directory to validate |
| `fail-on-warnings` | `false` | Treat warnings as failures |
| `sweep` | `true` | Run completeness sweep |
| `sweep-fail` | `false` | Fail on sweep markers |

**Outputs:** `passed`, `failed`, `warnings`, `result` (pass/warn/fail) — usable in downstream steps.

---

## Options

| Flag | Applies To | Effect |
|------|-----------|--------|
| `--dry-run` | `new-phase`, `branch` | Show what would happen without making changes |
| `--force` | `ext remove` | Skip confirmation prompt |
| `--help` | All commands | Show help for the command |

---

## Troubleshooting

**"Not inside a git repository"**
The CLI needs to find your repo root via `.git`. Run from inside your project directory.

**"setup.ps1 not found"**
The `init` command delegates to `setup.ps1` / `setup.sh` in the repo root. Make sure the setup scripts exist.

**"extension.json not found"**
The `ext install` command requires a valid `extension.json` in the source path. See [docs/EXTENSIONS.md](EXTENSIONS.md) for the extension manifest format.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (command failed, file not found, invalid input) |
| `2` | Missing prerequisite (not in a git repo, required tool missing) |

---

## API Providers

Plan Forge supports OpenAI-compatible HTTP endpoints via the API provider registry. Models are auto-routed by name pattern — no configuration needed beyond setting the API key.

### xAI Grok

Set your API key:

```powershell
# PowerShell (session)
$env:XAI_API_KEY = "your-key-here"

# PowerShell (persistent — add to $PROFILE)
[Environment]::SetEnvironmentVariable("XAI_API_KEY", "your-key-here", "User")
```

```bash
# Bash (session)
export XAI_API_KEY="your-key-here"

# Bash (persistent — add to ~/.bashrc or ~/.zshrc)
echo 'export XAI_API_KEY="your-key-here"' >> ~/.bashrc
```

**Available Grok models**:

| Model | Input $/M | Output $/M | Notes |
|-------|-----------|------------|-------|
| `grok-4.20` | $3.00 | $15.00 | Latest, recommended |
| `grok-4` | $2.00 | $10.00 | Stable reasoning model |
| `grok-3` | $3.00 | $15.00 | Previous generation |
| `grok-3-mini` | $0.30 | $0.50 | Fast, budget-friendly |

**Use in CLI commands**:

```bash
pforge run-plan docs/plans/Phase-1.md --model grok-4.20         # Plan execution
pforge analyze docs/plans/Phase-1.md --models grok-4,grok-3-mini # Multi-model analysis
pforge diagnose src/services/billing.ts --models grok-4.20       # Bug investigation
```

**How it works**: Any model name matching `grok-*` auto-routes to `api.x.ai/v1` via the `XAI_API_KEY` env var. The orchestrator uses the standard OpenAI chat completions API format. No `.forge.json` changes required.

Get your API key at [console.x.ai](https://console.x.ai/).

---

## AI Agent Usage

> **Audience**: You are an AI coding agent using the Plan Forge CLI programmatically.
>
> **Persistent memory**: If the OpenBrain MCP server is available, search for prior decisions at session start (`search_thoughts`) and capture key decisions after slices (`capture_thought`). See the `plan-forge-memory` extension in `docs/plans/examples/extensions/`. This bridges the 3-session model with long-term context.

### Platform Detection

Detect the correct script before running commands:

```
IF operating system is Windows
   AND shell is PowerShell
   → Use .\pforge.ps1 <command>

IF operating system is macOS or Linux
   → Use ./pforge.sh <command>

IF pforge.ps1 does NOT exist in repo root
   AND pforge.sh does NOT exist in repo root
   → CLI not installed — use manual steps instead (each command section documents them)
```

### When to Use the CLI vs Manual Operations

```
Use CLI when:
  • Creating a new phase         → pforge new-phase <name>
  • Checking setup validity       → pforge check
  • Inspecting the forge          → pforge smith
  • Reading roadmap status        → pforge status
  • Creating a branch from a plan → pforge branch <plan>
  • Installing an extension       → pforge ext install <path>

Do NOT use CLI when:
  • Hardening a plan (Step 2)     → Use the Step 2 prompt in Agent Mode
  • Executing slices (Step 3)     → Use the Step 3 prompt in Agent Mode
  • Running review gate (Step 5)  → Use the Step 5 prompt in Agent Mode
  • Editing plan content          → Edit the Markdown file directly
```

### Recommended Agent Workflow

When setting up a new feature for a user:

```
1. pforge smith                          # Inspect the forge (environment + setup)
2. pforge check                          # Verify setup files are valid
3. pforge new-phase <feature-name>       # Create plan file + roadmap entry
3. pforge phase-status <plan-file> in-progress  # Mark phase as active
4. pforge branch <plan-file> --dry-run   # Show what branch would be created
5. (ask user to confirm branch name)
6. pforge branch <plan-file>             # Create the branch
7. (proceed with Step 1-5 pipeline prompts in Agent Mode)
8. pforge commit <plan-file> <N>         # Commit after each slice passes
9. pforge phase-status <plan-file> complete    # Mark phase done when finished
```

### Parsing Output

CLI output is human-readable, not structured. To check results programmatically:

| Need | Approach |
|------|----------|
| Did the command succeed? | Check exit code (`$LASTEXITCODE` in PowerShell, `$?` in Bash) |
| What files were created? | Run `git status --short` after the command |
| What phases exist? | Read `docs/plans/DEPLOYMENT-ROADMAP.md` directly |
| What extensions are installed? | Read `.forge/extensions/extensions.json` |

### Error Handling

```
IF exit code = 1 → Command failed. Read stderr for details. Fix and retry.
IF exit code = 2 → Missing prerequisite. Check: Are you in a git repo?
                    Does the required file exist (setup.ps1, plan file, extension.json)?
IF command not found → CLI not installed. Fall back to manual steps.
```

### Key Files the CLI Reads/Writes

| File | Read By | Written By |
|------|---------|------------|
| `docs/plans/DEPLOYMENT-ROADMAP.md` | `status`, `new-phase` | `new-phase` |
| `docs/plans/Phase-N-*-PLAN.md` | `branch` | `new-phase` |
| `.forge/extensions/extensions.json` | `ext list` | `ext install`, `ext remove` |
| `.forge/extensions/*/extension.json` | `ext install`, `ext remove` | — |
| `.github/instructions/*.instructions.md` | — | `ext install`, `ext remove` |
| `.github/agents/*.agent.md` | — | `ext install`, `ext remove` |
| `.github/prompts/*.prompt.md` | — | `ext install`, `ext remove` |
