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
.\pforge.ps1 init -Preset php -ProjectPath ./my-php-app
.\pforge.ps1 init -Preset rust -ProjectPath ./my-rust-app
.\pforge.ps1 init -Preset azure-iac -ProjectPath ./infra
.\pforge.ps1 init -Preset dotnet,azure-iac -ProjectPath ./my-app
.\pforge.ps1 init -Preset dotnet -Agent claude          # Add Claude Code support
.\pforge.ps1 init -Preset dotnet -Agent windsurf        # Add Windsurf support
.\pforge.ps1 init -Preset dotnet -Agent gemini          # Add Gemini CLI support
.\pforge.ps1 init -Preset dotnet -Agent generic         # Generic AI adapter (.ai/)
.\pforge.ps1 init -Preset dotnet -Agent all              # All agents
```

```bash
# Bash
./pforge.sh init --preset dotnet
./pforge.sh init --preset typescript --path ./my-app
./pforge.sh init --preset swift --path ./my-ios-app
./pforge.sh init --preset php --path ./my-php-app
./pforge.sh init --preset rust --path ./my-rust-app
./pforge.sh init --preset azure-iac --path ./infra
./pforge.sh init --preset dotnet,azure-iac --path ./my-app
./pforge.sh init --preset dotnet --agent claude           # Add Claude Code support
./pforge.sh init --preset dotnet --agent windsurf         # Add Windsurf support
./pforge.sh init --preset dotnet --agent gemini           # Add Gemini CLI support
./pforge.sh init --preset dotnet --agent generic          # Generic AI adapter (.ai/)
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

> **`analyze` vs `diagnose` — which do I use?**
>
> | | `pforge analyze` | `pforge diagnose` |
> |---|---|---|
> | **Purpose** | Plan quality scoring | Bug investigation |
> | **Input** | Plan file or code file | Code file with a suspected bug |
> | **Question it answers** | "Is this plan well-structured and complete?" | "What's wrong with this code and how do I fix it?" |
> | **Output** | Consistency score (0–100) across 4 dimensions | Root cause analysis with fix recommendations |
> | **When to use** | After hardening a plan, before execution | When a slice fails or code behaves unexpectedly |
> | **Multi-model** | `--quorum` flag (consensus scoring) | Always multi-model (independent investigation) |

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

### `pforge ext publish <path>`

Generate a community catalog entry for your extension and output next steps for submission. Does not upload anything — prints the catalog JSON you need to add via pull request.

```powershell
# PowerShell
.\pforge.ps1 ext publish .forge/extensions/my-extension
```

```bash
# Bash
./pforge.sh ext publish .forge/extensions/my-extension
```

**What it does:**
1. Validates `extension.json` exists and contains all required fields (`name`, `version`, `description`, `author`)
2. Counts artifact files (instructions, agents, prompts, skills) from the extension directory
3. Generates a ready-to-paste catalog entry in the `extensions/catalog.json` format
4. Prints the 4-step submission workflow (fork → edit catalog → open PR → link repo)

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  Catalog Entry: my-extension
╚══════════════════════════════════════════════════════════════╝

Add the following entry to extensions/catalog.json:
"my-extension": { ... }

─────────────────────────────────────────────────────────────
Next steps to publish:
  1. Fork   https://github.com/srnichols/plan-forge
  2. Edit   extensions/catalog.json — add the entry above
  3. Open PR with title: feat(catalog): add my-extension
  4. Link to your extension's repository in the PR description
```

**Also see**: `extensions/PUBLISHING.md` for the full submission guide, and [docs/EXTENSIONS.md](EXTENSIONS.md) for extension structure.

---

### `pforge update [source-path]`

Update framework files from a Plan Forge source without re-running the full setup wizard. Preserves all user-customized files.

```powershell
# PowerShell — auto-detect source (looks for ../plan-forge)
.\pforge.ps1 update

# Specify source path explicitly
.\pforge.ps1 update C:\path\to\plan-forge

# Download from GitHub (no local clone needed)
.\pforge.ps1 update --from-github

# Download a specific release tag
.\pforge.ps1 update --from-github --tag v2.50.0

# Preview changes without applying
.\pforge.ps1 update --dry-run
.\pforge.ps1 update --from-github --dry-run

# Skip confirmation prompt
.\pforge.ps1 update --force

# Keep downloaded tarball for rollback
.\pforge.ps1 update --from-github --keep-cache
```

```bash
# Bash
./pforge.sh update
./pforge.sh update /path/to/plan-forge
./pforge.sh update --from-github
./pforge.sh update --from-github --tag v2.50.0
./pforge.sh update --dry-run
./pforge.sh update --from-github --dry-run
./pforge.sh update --force
./pforge.sh update --from-github --keep-cache
```

**`--from-github` flag** (new in v2.51.0): Downloads the release tarball directly from GitHub — no local Plan Forge clone required. Resolves the latest release tag automatically, or use `--tag <tag>` to pin a specific version. The tarball is verified (gzip magic bytes + SHA-256 audit log) and size-capped at 50 MB (configurable via `.forge.json` `update.fromGitHub.maxTarballBytes`). Honors `GITHUB_TOKEN` env var for higher API rate limits.

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
- Shared instruction files (architecture-principles, git-workflow, ai-plan-hardening-runbook, status-reporting)
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

# Quorum presets
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --quorum=power
.\pforge.ps1 run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --quorum=speed
```

```bash
# Bash
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --estimate
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --assisted
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --model gpt-5.2-codex
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --quorum=power
./pforge.sh run-plan docs/plans/Phase-7-INVENTORY-PLAN.md --quorum=speed
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
- `--quorum` — Multi-model consensus on all slices (3× cost)
- `--quorum=auto` — Consensus only for complex slices (threshold-based)
- `--quorum=power` — Flagship preset: Claude Opus 4.6 + GPT-5.3-Codex + Grok 4.20 Reasoning (threshold 5, 5min timeout)
- `--quorum=speed` — Fast preset: Claude Sonnet 4.6 + GPT-5.4-mini + Grok 4.1 Fast Reasoning (threshold 7, 2min timeout)
- `--quorum-threshold <N>` — Override complexity threshold (1-10)

> **OAuth-only quorum works.** The `--quorum=*` presets fan out via the local `copilot` CLI &mdash; one subprocess per model &mdash; so a GitHub Copilot subscription alone is enough; no API keys required. Add `XAI_API_KEY` (env var or `.forge/secrets.json`) to mix in a Grok leg alongside the Copilot-served legs. Models whose CLI/credentials aren't reachable are dropped at startup by `filterQuorumModels` rather than failing the run. See [advanced-execution.html#quorum-mixed-example](manual/advanced-execution.html#quorum-mixed-example) for a worked 2× Copilot + 1× Grok config.

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

> **Internal note**: `pforge smith` reads hook names from `pforge-mcp/bin/enums-cli.mjs` rather than a hardcoded array. If you're writing a custom diagnostic script that needs the canonical list of hooks, run:
> ```bash
> node pforge-mcp/bin/enums-cli.mjs --enum HOOK_PASCAL
> # → one hook name per line: SessionStart PreToolUse PostToolUse Stop PreDeploy PostSlice PreAgentHandoff PostRun
> ```
> Other available enums: `HOOK_NAMES`, `MODEL_TIERS`, `QUORUM_MODES`, `FORGE_MASTER_MODES`, `WATCHER_MODES`, `COST_SOURCES`, `TOOL_NAMES`. Source of truth: `pforge-mcp/enums.mjs`.

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

## LiveGuard Commands (v2.27+)

Operational intelligence commands for post-coding monitoring. Requires MCP server running (`node pforge-mcp/server.mjs`).

### `pforge drift`

Score the codebase against architecture guardrail rules. Tracks drift over time in `.forge/drift-history.json`. Separates app-code violations from framework code. Includes test status when `npm test` or `dotnet test` is available.

```powershell
.\pforge.ps1 drift
.\pforge.ps1 drift --threshold 80
```

### `pforge incident <description>`

Capture an incident — record description, severity, affected files, and optional `resolvedAt` for MTTR.

```powershell
.\pforge.ps1 incident "API timeout under load" --severity high --files "src/api/handler.ts"
```

### `pforge triage`

Rank open alerts by priority — combines severity weight × recency factor.

```powershell
.\pforge.ps1 triage
.\pforge.ps1 triage --min-severity high --max 5
```

### `pforge deploy-log`

Log a deployment with version, environment, and status.

```powershell
.\pforge.ps1 deploy-log --version v2.27.0 --env production --status success
```

### `pforge regression-guard`

Run validation gates from plans — extracts `bash` code blocks and executes them with allowlist enforcement.

```powershell
.\pforge.ps1 regression-guard --plan docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md
```

### `pforge runbook`

Auto-generate an operational runbook from a plan file and incident history.

```powershell
.\pforge.ps1 runbook --plan docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md
```

### `pforge hotspot`

Identify high-churn files via git log analysis. Results cached for 24h.

```powershell
.\pforge.ps1 hotspot --top 15 --since "3 months ago"
```

### `pforge dep-watch`

Scan dependencies for vulnerabilities. Diffs against previous snapshot.

```powershell
.\pforge.ps1 dep-watch
```

### `pforge secret-scan`

Scan recent commits for potential secrets using entropy analysis.

```powershell
.\pforge.ps1 secret-scan --since HEAD~3
```

### `pforge env-diff`

Compare environment variable keys across `.env` files. Reports gaps.

```powershell
.\pforge.ps1 env-diff --baseline .env --files .env.staging,.env.production
```

### `pforge health-trend`

Aggregated health score from drift, cost, incidents, and model performance over time.

```powershell
.\pforge.ps1 health-trend --days 30
```

### `pforge tempering-run`

Run the tempering harness with an optional numeric objective. The objective command runs before and after the scanner suite; the candidate is accepted only if the metric improves in the configured direction.

```powershell
# PowerShell — require coverage to go up
.\pforge.ps1 tempering-run --objective "node scripts/measure-coverage.mjs" --accept-if greater

# PowerShell — require bundle size to go down
.\pforge.ps1 tempering-run --objective "node scripts/measure-bundle-kb.mjs" --accept-if less
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--objective <cmd>` | *(off)* | Shell command that prints exactly one numeric value on stdout. Runs before and after the tempering scanners. |
| `--accept-if greater\|less` | `greater` | Accept the candidate only if the post-run metric is greater than or less than the baseline. |

**Notes:**
- Non-zero objective exit or non-numeric stdout fails the run.
- The worker never sees the captured baseline value.
- MCP equivalent: `forge_tempering_run` with `objective.command` + `objective.acceptIf`.

### `pforge audit-loop`

Run the audit drain loop — discovers bugs from the running system by probing live routes, triaging findings, and iterating until convergence.

Without `--auto`, runs a manual one-shot drain (ignores `.forge.json#audit` config). With `--auto`, respects `audit.mode` in `.forge.json` (`off` / `auto` / `always`) and exits early if no threshold trips.

```powershell
# PowerShell — manual one-shot (always runs one drain)
.\pforge.ps1 audit-loop

# PowerShell — respect config thresholds
.\pforge.ps1 audit-loop --auto

# PowerShell — dry run with custom max rounds
.\pforge.ps1 audit-loop --dry-run --max=3

# PowerShell — target staging environment
.\pforge.ps1 audit-loop --env=staging
```

```bash
# Bash — manual one-shot
./pforge.sh audit-loop

# Bash — respect config
./pforge.sh audit-loop --auto

# Bash — dry run
./pforge.sh audit-loop --dry-run --max=3
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | *(off)* | Respect `.forge.json#audit` config. Without this flag, always runs one drain |
| `--max=N` | `5` | Maximum drain rounds before stopping |
| `--dry-run` | *(off)* | Show what would happen without triage side effects |
| `--env=ENV` | `dev` | Target environment (`dev`, `staging`). Production is forbidden |

**When to use:**
- After shipping a plan, run `pforge audit-loop` to discover regressions in your running app
- Set `audit.mode: "auto"` in `.forge.json` and use `--auto` for threshold-gated runs (e.g., in CI after deploy)
- Use `--dry-run` to preview findings before committing to triage

**Related MCP tools:** `forge_tempering_drain`, `forge_triage_route`

---

### `pforge audit export`

Export audit events from `.forge/runs/` as JSONL or CSV. Streams `events.log` files written by the orchestrator — reads line-by-line without loading all events into memory. Useful for compliance exports, cost analysis, and piping into spreadsheets or SIEM tools.

```powershell
# PowerShell — all events as JSONL (one JSON object per line)
.\pforge.ps1 audit export

# PowerShell — events from a date onwards
.\pforge.ps1 audit export --since 2026-05-01

# PowerShell — CSV export to file
.\pforge.ps1 audit export --format csv > audit.csv

# PowerShell — filter by event type (repeatable)
.\pforge.ps1 audit export --type gate-pass --type gate-fail

# PowerShell — scope to a single run
.\pforge.ps1 audit export --run 20260507T120000Z

# PowerShell — date window
.\pforge.ps1 audit export --since 2026-05-01 --until 2026-05-31
```

```bash
# Bash — all events as JSONL
./pforge.sh audit export

# Bash — events from a date onwards
./pforge.sh audit export --since 2026-05-01

# Bash — CSV export to file
./pforge.sh audit export --format csv > audit.csv

# Bash — filter by event type
./pforge.sh audit export --type gate-pass --type gate-fail

# Bash — scope to a single run
./pforge.sh audit export --run 20260507T120000Z
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--since <ISO>` | *(all)* | Only events on or after this timestamp (ISO 8601, inclusive) |
| `--until <ISO>` | *(all)* | Only events on or before this timestamp (ISO 8601, inclusive) |
| `--type <name>` | *(all)* | Filter by event type; repeatable (e.g. `--type gate-pass --type slice-start`) |
| `--run <id>` | *(all runs)* | Scope to a single run directory ID |
| `--format <fmt>` | `json` | Output format: `json` (JSONL, one object per line) or `csv` |

**JSONL output fields** (one object per event):

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 event timestamp |
| `run_id` | Run directory ID (e.g. `20260507T120000Z`) |
| `plan` | Plan file path associated with the run |
| `slice_id` | Slice identifier within the plan |
| `event_type` | Event type string (see common types below) |
| `source` | Originating worker or component |
| `security_risk` | Security risk flag (from pre-deploy scans) |
| `gate_result` | Gate pass/fail result |
| `cost_usd` | Cost in USD for this event |
| `tokens_in` | Input token count |
| `tokens_out` | Output token count |
| `model` | Model used for this event |
| `worker` | Worker identifier |

**CSV output** has the same columns as the JSONL fields above, with a header row.

**Common event types** for `--type` filtering:

| Type | Meaning |
|------|---------|
| `slice-start` | A plan slice began execution |
| `slice-end` | A plan slice completed |
| `gate-pass` | A validation gate passed |
| `gate-fail` | A validation gate failed |
| `llm-invoke` | An LLM was called (includes token/cost fields) |
| `pre-deploy` | A pre-deploy LiveGuard scan ran |
| `secret-scan` | A secret scan ran |
| `quorum-vote` | A quorum model cast a vote |

**When to use:**
- Export the last month of gate results: `pforge audit export --since 2026-05-01 --type gate-pass --type gate-fail --format csv > gates.csv`
- Pull cost data for a single run: `pforge audit export --run <runId> --type llm-invoke`
- Feed into a SIEM or compliance tool: `pforge audit export --since 2026-01-01 | jq .`

**Related MCP tool:** `forge_audit_export` (ACI-paginated, adds `limit` / `truncated` / `total` pagination for agent use)

---

## Memory Subsystem Commands (v2.95.0)

Anvil, Hallmark, and Lattice operations. Requires MCP server running (`node pforge-mcp/server.mjs`).

### `pforge anvil stat`

Show Anvil cache statistics — hit rate, entry count, DLQ depth, and cache age.

```powershell
.\pforge.ps1 anvil stat
```

```bash
./pforge.sh anvil stat
```

**Output:**
```
Anvil Cache Statistics:
  Entries:    1,247
  Hit rate:   83.4%  (last 24h)
  Cache size: 2.1 MB
  DLQ depth:  0
  Oldest entry: 2026-05-10T14:22:00Z
```

---

### `pforge anvil clear`

Clear the Anvil cache. Forces all subsequent writes to go to L2/L3 (no deduplication until cache is rebuilt).

```powershell
.\pforge.ps1 anvil clear
.\pforge.ps1 anvil clear --force   # Skip confirmation
```

```bash
./pforge.sh anvil clear
./pforge.sh anvil clear --force
```

---

### `pforge anvil rebuild`

Rebuild the Anvil cache from current L2 state. Use after a major refactor or when the cache is stale.

```powershell
.\pforge.ps1 anvil rebuild
.\pforge.ps1 anvil rebuild --dry-run   # Preview what would be indexed
```

```bash
./pforge.sh anvil rebuild
./pforge.sh anvil rebuild --dry-run
```

---

### `pforge anvil dlq list`

List all entries in the Slag-Heap DLQ — failed or rejected L3 writes awaiting replay.

```powershell
.\pforge.ps1 anvil dlq list
.\pforge.ps1 anvil dlq list --max 20
```

```bash
./pforge.sh anvil dlq list
./pforge.sh anvil dlq list --max 20
```

**Output:**
```
Slag-Heap DLQ (3 entries):
  [2026-05-15T10:14:22Z]  forge_drift_report  →  quota_exceeded (retries: 1)
  [2026-05-15T11:02:45Z]  forge_incident_capture  →  schema_mismatch (retries: 0)
  [2026-05-16T03:17:09Z]  forge_run_plan  →  connection_timeout (retries: 2)
```

---

### `pforge anvil dlq drain`

Replay all DLQ entries against OpenBrain. Entries that fail after 3 retries are archived.

```powershell
.\pforge.ps1 anvil dlq drain
.\pforge.ps1 anvil dlq drain --dry-run   # Preview without replaying
```

```bash
./pforge.sh anvil dlq drain
./pforge.sh anvil dlq drain --dry-run
```

---

### `pforge hallmark show`

Show the Hallmark provenance envelope for a specific thought by ID, or list recent Hallmark-stamped thoughts.

```powershell
.\pforge.ps1 hallmark show --id <thought-id>
.\pforge.ps1 hallmark show --last 10
```

```bash
./pforge.sh hallmark show --id <thought-id>
./pforge.sh hallmark show --last 10
```

**Output (single thought):**
```
Hallmark Provenance Envelope
  Thought ID:           abc-123
  Source file:          pforge-mcp/server.mjs
  Source file hash:     sha256:4a7c9f2...
  Code hash:            sha256:b1e3d80...
  Capability negotiated: true
  Schema version:       hallmark-provenance.v1
  Captured at:          2026-05-16T04:10:00Z
```

---

### `pforge hallmark verify`

Audit Hallmark provenance coverage — checks what percentage of recent L3 writes have valid provenance envelopes, and flags legacy (non-stamped) thoughts.

```powershell
.\pforge.ps1 hallmark verify
.\pforge.ps1 hallmark verify --since "7 days ago"
```

```bash
./pforge.sh hallmark verify
./pforge.sh hallmark verify --since "7 days ago"
```

**Output:**
```
Hallmark Coverage Audit (last 7 days):
  Total L3 writes:    342
  Hallmark-stamped:   338  (98.8%)
  Legacy (no stamp):    4   ← review these
  DLQ entries:          2
```

---

### `pforge lattice index`

Build or update the Lattice structural code index for the current project.

```powershell
.\pforge.ps1 lattice index
.\pforge.ps1 lattice index --path src/services   # Scope to a subdirectory
.\pforge.ps1 lattice index --force               # Full rebuild (ignores incremental)
```

```bash
./pforge.sh lattice index
./pforge.sh lattice index --path src/services
./pforge.sh lattice index --force
```

---

### `pforge lattice query <symbol>`

Query the Lattice index for a symbol — returns callers, callees, and cross-references.

```powershell
.\pforge.ps1 lattice query captureMemory
.\pforge.ps1 lattice query forge_run_plan --depth 2
```

```bash
./pforge.sh lattice query captureMemory
./pforge.sh lattice query forge_run_plan --depth 2
```

**Output:**
```
Lattice Query: captureMemory
  Callers (12):
    forge_run_plan       (server.mjs:1042)
    forge_drift_report   (server.mjs:2187)
    ...
  Callees (3):
    buildRunSummaryThought
    openbrain-queue flush
    hallmarkEnvelope.wrap
```

---

### `pforge lattice callers <symbol>`

List all callers of a symbol — shorthand for `pforge lattice query --callers-only`.

```powershell
.\pforge.ps1 lattice callers buildRunSummaryThought
```

```bash
./pforge.sh lattice callers buildRunSummaryThought
```

---

### `pforge lattice blast <file-or-symbol>`

Compute blast radius — what would be affected if this file or symbol changed? Returns a risk score (0.0–1.0) and an affected-file list.

```powershell
.\pforge.ps1 lattice blast pforge-mcp/memory.mjs
.\pforge.ps1 lattice blast captureMemory --format json
```

```bash
./pforge.sh lattice blast pforge-mcp/memory.mjs
./pforge.sh lattice blast captureMemory
```

**Output:**
```
Blast Radius: pforge-mcp/memory.mjs
  Risk score:  0.81  (HIGH)
  Affected files (23):
    pforge-mcp/server.mjs
    pforge-mcp/orchestrator.mjs
    ...
```

---

### `pforge lattice stat`

Show Lattice index statistics — symbol count, last indexed, coverage percentage.

```powershell
.\pforge.ps1 lattice stat
```

```bash
./pforge.sh lattice stat
```

**Output:**
```
Lattice Index Statistics:
  Symbols indexed:  4,821
  Files indexed:      127
  Last indexed:     2026-05-16T03:45:00Z
  Coverage:         94.3%
```

---

### `pforge brain status` (v3.6.0)

Local config check for OpenBrain (the L3 semantic memory layer). Reports whether `.vscode/mcp.json` (or `.claude/mcp.json`) has an OpenBrain SSE entry, and which config file Plan Forge would use.

```powershell
.\pforge.ps1 brain status
.\pforge.ps1 brain status --ping     # Also probe the endpoint (opt-in)
```

```bash
./pforge.sh brain status
./pforge.sh brain status --ping
```

Exit code is informational only — Plan Forge works without OpenBrain. Use `pforge brain hint` to see install options.

---

### `pforge brain hint` (v3.6.0)

Print the four OpenBrain install options (Docker Compose / Supabase Cloud / Kubernetes-or-Azure / Skip-for-now). Same content as the [setup.ps1](../setup.ps1) / [setup.sh](../setup.sh) end-of-flow wizard.

```powershell
.\pforge.ps1 brain hint
```

```bash
./pforge.sh brain hint
```

---

### `pforge brain test` (v3.6.0)

End-to-end round-trip self-test. Captures a unique marker thought via OpenBrain `capture_thought`, then immediately searches for it via `search_thoughts`. Prints duration, marker ID, and pass/fail.

Requires the MCP server running on `localhost:3100` and an OpenBrain SSE entry in `.vscode/mcp.json` (or `.claude/mcp.json`).

```powershell
.\pforge.ps1 brain test
```

```bash
./pforge.sh brain test
```

**Output (success):**
```
🧠 Brain Test — round-trip OK
   Endpoint:  https://openbrain.example/sse
   Marker:    pforge-brain-test-1747545600000
   Duration:  342ms
   Captured:  id=abc-123
```

Exits non-zero if the round-trip fails. Use this to confirm OpenBrain is reachable, the API key is valid, and the embed pipeline is up before running `pforge brain replay`.

---

### `pforge brain replay <source>` (v3.6.0)

Replay capture-only records into OpenBrain. Use cases: backfill records from a queue file written while OpenBrain was down, re-capture from a markdown plan after recovering from data loss, or migrate from one OpenBrain instance to another.

`<source>` can be:
- a `.jsonl` queue file (one record per line, e.g. `.forge/openbrain-queue.jsonl`)
- a single `.md` file (normalized into capture_thought payloads, H2-split)
- a directory of `.md` files (each split and queued)

```powershell
.\pforge.ps1 brain replay .forge/openbrain-queue.jsonl
.\pforge.ps1 brain replay docs/plans/Phase-X-PLAN.md --dry-run
.\pforge.ps1 brain replay docs/plans/ --rate 250 --max 100
```

```bash
./pforge.sh brain replay .forge/openbrain-queue.jsonl
./pforge.sh brain replay docs/plans/Phase-X-PLAN.md --dry-run
./pforge.sh brain replay docs/plans/ --rate 250 --max 100
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--dry-run` | boolean | Preview records without sending to OpenBrain |
| `--project <name>` | string | Override project tag (defaults to `.forge.json` `projectName` or `plan-forge`) |
| `--rate <ms>` | number | Rate-limit between sends in milliseconds |
| `--max <n>` | number | Cap on number of records to replay |

Writes a per-record receipt log to `.forge/openbrain-replay-<timestamp>.jsonl`. **Receipts now record real per-record success/failure** (v3.6.1): if OpenBrain returns an `isError: true` tool response (e.g. Ollama embed context-overflow), the record is logged with the verbatim error body instead of being silently accepted as `status:"sent"`.

> ⚠️ **v3.6.0 receipt bug**: In v3.6.0 the receipt log silently marked over-context Ollama failures as `sent`. Upgrade to v3.6.1+ before relying on receipts for data-integrity.

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

The CLI handles **project management tasks** (setup, status, phases, branches, extensions). The **core pipeline** (hardening, execution, review) still runs through Copilot Agent Mode — those are AI-driven workflows, not shell commands. For open-ended reasoning across multiple tools, use `forge_master_ask` (Forge-Master) via MCP instead of chaining CLI commands manually.

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

### `.forge/secrets.json` Fallback

As an alternative to environment variables, store API keys in `.forge/secrets.json`:

```json
{
  "XAI_API_KEY": "xai-...",
  "OPENAI_API_KEY": "sk-..."
}
```

Lookup order: environment variable → `.forge/secrets.json` → null. The `.forge/` directory is gitignored by default — secrets are never committed.

Get your API key at [console.x.ai](https://console.x.ai/).

---

## Bridge Configuration

The Plan Forge Bridge forwards run events (slice completions, failures, run summaries) to external notification channels. Start it with `node pforge-mcp/bridge.mjs`.

Configure in `.forge.json` under the `bridge` key:

```json
{
  "bridge": {
    "enabled": true,
    "channels": [
      { "type": "telegram", "url": "https://api.telegram.org/bot<TOKEN>/sendMessage", "chatId": "<CHAT_ID>", "level": "important" },
      { "type": "slack",    "url": "https://hooks.slack.com/services/...", "level": "all" },
      { "type": "discord",  "url": "https://discord.com/api/webhooks/...", "level": "critical" },
      { "type": "webhook",  "url": "https://your-endpoint.example.com/hook", "level": "all" }
    ]
  }
}
```

**Notification levels** (hierarchical — each includes those below):

| Level | Events Delivered |
|-------|-----------------|
| `all` | Every event: run-started, slice-started, slice-completed, slice-failed, run-completed, run-aborted |
| `important` | run-started, slice-failed, run-completed, run-aborted |
| `critical` | slice-failed, run-aborted (+ failed run-completed) |

**REST endpoints** (when MCP server is running):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bridge/status` | Connected channels + pending approvals |
| POST | `/api/bridge/approve/:runId` | Approve a paused run |
| GET | `/api/bridge/approve/:runId` | Browser-friendly approval link (for Telegram buttons) |

Rate limit: 1 notification per 5 seconds per channel.

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

---

## `hammer-fm` — Forge-Master End-to-End Hammer Harness

Runs named scenario packs against a live Forge-Master dashboard, scores SSE output, and writes JSON + Markdown reports.

```
pforge hammer-fm [options]

Options:
  --scenario=<name>        Scenario pack name (required); see Bundled Scenarios below
  --tier=<t>               Tier to test: keyword-only | low | medium | high | all
                           "all" runs each prompt 4× (once per tier). Default: keyword-only
  --base-url=<url>         Forge-Master base URL. Default: http://localhost:3100
  --output-dir=<dir>       Write reports here. Default: .forge/hammer-forge-master/reports/
  --dry-run                Print what would run; make no HTTP requests
  --help                   Show usage

Exit codes:
  0 — all prompts passed
  1 — one or more failures or runtime error
  2 — connection refused (dashboard unreachable)
```

### Bundled Scenarios

| Scenario name | Prompts | Purpose |
|---------------|---------|---------|
| `shipped-prompts` | 8 | One prompt per category — validates all 7 lane classifications |
| `realistic-qa` | 20 | Ambiguous, multi-intent, follow-up, off-topic, operational |
| `dial-sweep` | 10 | Same prompts across all 4 tiers for tier-comparison report |
| `phase-38.1-baseline` | 6 | Conversation-memory flows for Phase-38.1 hardening |

### Scenario JSON Schema

Scenario files live in `scripts/hammer-fm/scenarios/`. Each file must match:

```jsonc
{
  "name": "human-readable name",
  "description": "what this scenario tests",
  "prompts": [
    {
      "id": "unique-slug",          // required; must be unique within file
      "message": "prompt text",     // required
      "expectedLane": "PLAN_OPS",   // optional; one of the 8 Forge-Master lanes
      "expectedTools": ["forge_run_plan"],  // optional array
      "mustContain": ["keyword"],   // optional; scored against final text event
      "mustNotContain": ["error"],  // optional
      "notes": "why this prompt",   // optional
      "purpose": "test ambiguity"   // optional
    }
  ]
}
```

### Adding a Custom Scenario

1. Create `scripts/hammer-fm/scenarios/<name>.json` matching the schema above
2. Run: `pforge hammer-fm --scenario=<name> --dry-run` to validate
3. Run: `pforge hammer-fm --scenario=<name> --tier=keyword-only` for a live run

### Reports

Reports are written to `.forge/hammer-forge-master/reports/` (gitignored):
- `<scenario>-<tier>-<timestamp>.json` — machine-readable per-prompt results
- `<scenario>-<tier>-<timestamp>.md` — Markdown table with pass/fail, scores, tier comparison

### Key Files

| File | Purpose |
|------|---------|
| `scripts/hammer-fm.mjs` | CLI entry point; exports `main(argv, deps)` |
| `scripts/hammer-fm/sse-client.mjs` | SSE stream reader with chunk-boundary handling |
| `scripts/hammer-fm/scorers.mjs` | 6 pure scorer functions |
| `scripts/hammer-fm/reporter.mjs` | Markdown + JSON report writer |
| `scripts/hammer-fm/scenarios/` | Bundled scenario JSON files |
| `pforge-mcp/tests/hammer-fm.test.mjs` | 35 unit tests |

---

## `fm-session` — Forge-Master Conversation Session Management

Manage file-based Forge-Master conversation sessions stored in `.forge/fm-sessions/`.

Each browser tab generates a unique session ID via `sessionStorage` and sends it as `x-pforge-session-id` on every chat request. The MCP server persists each turn to a JSONL file in `.forge/fm-sessions/`.

```
pforge fm-session list
pforge fm-session purge <session-id>
pforge fm-session purge --all
```

### Subcommands

| Subcommand | Description |
|-----------|-------------|
| `list` | List all active sessions with turn counts |
| `purge <id>` | Remove active + archive files for a specific session |
| `purge --all` | Remove entire `.forge/fm-sessions/` directory |

### Session File Format

Active file: `.forge/fm-sessions/<session-id>.jsonl`
Archive file: `.forge/fm-sessions/<session-id>.archive.jsonl`

Each line is a JSON object:
```json
{"turn": 1, "timestamp": "2025-01-01T00:00:00.000Z", "userMessage": "...", "classification": "operational", "replyHash": "a1b2c3d4e5f60000", "toolCalls": []}
```

Sessions auto-rotate: when a session reaches 200 turns, the oldest 100 are moved to the archive file and the active file is rewritten with the newest 100.

### Notes

- Session files are stored in `.forge/` which is gitignored — sessions are never committed
- Ephemeral sessions (no `x-pforge-session-id` header) write nothing to disk
- Use `purge --all` to reclaim disk space when sessions accumulate

---

## `pforge digest` — Daily Digest (v2.90.10+)

Generates a structured daily digest covering probe lane-match deltas, aging meta-bugs, stalled phases, drift trend, and cost anomalies. Writes to `.forge/digests/<date>.json` and prints Markdown to stdout.

```powershell
# PowerShell
.\pforge.ps1 digest
.\pforge.ps1 digest --date 2026-05-19
.\pforge.ps1 digest --force
.\pforge.ps1 digest --notify
```

```bash
# Bash
./pforge.sh digest
./pforge.sh digest --date 2026-05-19
./pforge.sh digest --force
./pforge.sh digest --notify
```

### Flags

| Flag | Description |
|------|-------------|
| `--date <YYYY-MM-DD>` | Generate digest for a specific date (default: today) |
| `--force` | Regenerate even if a digest for that date already exists |
| `--notify` | Dispatch the digest to configured `extensions/notify-*` adapters |

### Notes

- Output is idempotent — running twice on the same day writes the same file unless `--force` is used
- Digest files accumulate in `.forge/digests/` (gitignored); use `forge-home-cleanup` to prune old entries
- MCP equivalent: `forge_digest_generate`

---

## `pforge fm-recall` — Cross-Session Recall (v2.90.10+)

Query the BM25 recall index built from all past Forge-Master conversation sessions stored in `.forge/fm-sessions/`. Used by `forge_master_ask` to inject prior-turn context into new queries.

```powershell
# PowerShell
.\pforge.ps1 fm-recall query "why did phase 27 fail"
.\pforge.ps1 fm-recall rebuild
```

```bash
# Bash
./pforge.sh fm-recall query "why did phase 27 fail"
./pforge.sh fm-recall rebuild
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `query "<text>"` | Search all prior sessions; returns top-3 matching turns with date, lane, and session ID |
| `rebuild` | Rebuild the recall index from all `.forge/fm-sessions/*.jsonl` files |

### Notes

- Index is stored at `.forge/fm-sessions/recall-index.json` and refreshes lazily once per day
- Run `rebuild` manually after importing a bulk set of session files or after `purge --all`
- Results are shown as `[date · lane · sessionId] userMessage` — use the session ID with `fm-session` to inspect further

---

## `pforge plan-from-sarif` — SARIF to Plan Forge Plan

Convert a CodeQL SARIF result file into a Plan Forge hardened-plan Markdown document. Each SARIF finding becomes a slice with a validation gate.

```powershell
# PowerShell
.\pforge.ps1 plan-from-sarif results.sarif
.\pforge.ps1 plan-from-sarif results.sarif --output docs/plans/Phase-99-SECURITY-PLAN.md
.\pforge.ps1 plan-from-sarif - < results.sarif         # read from stdin
```

```bash
# Bash
./pforge.sh plan-from-sarif results.sarif
./pforge.sh plan-from-sarif results.sarif --output docs/plans/Phase-99-SECURITY-PLAN.md
./pforge.sh plan-from-sarif - < results.sarif           # read from stdin
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<sarif-file>` | Path to a SARIF JSON file (CodeQL output). Use `-` to read from stdin. |
| `--output <file>` | Write the generated plan to this path (default: stdout) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Plan generated successfully |
| `1` | SARIF has no findings — nothing to convert |
| `2` | Invalid arguments or SARIF parse error |

### Notes

- Pairs naturally with GitHub Advanced Security: `gh code-scanning alerts list --json | pforge plan-from-sarif -`
- The generated plan is a DRAFT — run it through `step2-harden-plan.prompt.md` before executing

---

## `pforge sync-spaces` — Push to GitHub Copilot Space

Uploads the active plan, instruction files, tool catalog, and project profile into a designated GitHub Copilot Space. Unchanged files (matching SHA-256) are skipped to stay within API rate limits.

```powershell
# PowerShell
.\pforge.ps1 sync-spaces --space myorg/forge-context
.\pforge.ps1 sync-spaces --space myorg/forge-context --dry-run
.\pforge.ps1 sync-spaces --space myorg/forge-context --force
.\pforge.ps1 sync-spaces --space myorg/forge-context --no-instructions
.\pforge.ps1 sync-spaces --org myorg
```

```bash
# Bash
./pforge.sh sync-spaces --space myorg/forge-context
./pforge.sh sync-spaces --space myorg/forge-context --dry-run
./pforge.sh sync-spaces --space myorg/forge-context --force
./pforge.sh sync-spaces --space myorg/forge-context --no-instructions
./pforge.sh sync-spaces --org myorg
```

### Flags

| Flag | Description |
|------|-------------|
| `--space <owner/name>` | Target Copilot Space (required unless `--org` resolves one) |
| `--org <slug>` | Resolve space from org listing instead of explicit `--space` ref |
| `--dry-run` | Print what would be uploaded; make no API calls |
| `--force` | Upload all files even if SHA-256 matches (bypasses skip logic) |
| `--no-instructions` | Skip uploading `.github/instructions/` files |

### What Gets Uploaded

| Source | Space path |
|--------|-----------|
| `.forge/active-plan` pointer | `plan-forge/active-plan.md` |
| `.github/instructions/*.instructions.md` | `plan-forge/instructions/<name>.md` |
| `pforge-mcp/tools.json` | `plan-forge/tool-catalog.md` |
| `.github/instructions/project-profile.instructions.md` | `plan-forge/project-profile.md` |

### Notes

- Requires `gh` CLI authenticated: `gh auth login`
- GitHub Copilot Spaces REST API is in beta — check `gh api` access before large syncs
- MCP equivalent: `forge_sync_spaces`

---

## `pforge forge-home-cleanup` — Clean Up Ephemeral `.forge/` Files (v3.8.1+)

Archives ephemeral files from `.forge/` to `.forge/archive/<YYYY-MM>/` and optionally prunes archive slots older than a configurable age. Recognises logs, tmp files, release notes, meta-bug drafts, and `.pid` files as ephemeral.

```powershell
# PowerShell
.\pforge.ps1 forge-home-cleanup
.\pforge.ps1 forge-home-cleanup --dry-run
.\pforge.ps1 forge-home-cleanup --no-confirm
.\pforge.ps1 forge-home-cleanup --max-age-days=30
.\pforge.ps1 forge-home-cleanup --max-age-days=0     # archive only — never prune
```

```bash
# Bash
./pforge.sh forge-home-cleanup
./pforge.sh forge-home-cleanup --dry-run
./pforge.sh forge-home-cleanup --no-confirm
./pforge.sh forge-home-cleanup --max-age-days=30
./pforge.sh forge-home-cleanup --max-age-days=0      # archive only — never prune
```

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print what would be moved or deleted; make no changes |
| `--no-confirm` | Skip interactive confirmation prompts |
| `--max-age-days=<N>` | Delete archive slots older than N days (default: 90). Pass 0 to disable deletion. |
| `--cwd <path>` | Project root to scan (default: current directory) |

### Notes

- Only top-level files in `.forge/` are archived — subdirectories are left in place
- The `.forge/archive/` directory is gitignored by default (added by `setup.ps1`/`setup.sh`)
- `forge_memory_report` surfaces orphan reports; run this command to resolve them
- MCP equivalent: `forge_forge_home_cleanup`

---

## `pforge timeline` — Unified Event Timeline

Offline-first chronological view across all Plan Forge event sources. Reads directly from `.forge/` files — no running server required.

```powershell
# PowerShell
.\pforge.ps1 timeline
.\pforge.ps1 timeline --window 6h
.\pforge.ps1 timeline --from 2026-05-18T00:00:00Z --to 2026-05-19T00:00:00Z
.\pforge.ps1 timeline --source run,bug
.\pforge.ps1 timeline --correlation abc123
.\pforge.ps1 timeline --group-by correlation --limit 50
.\pforge.ps1 timeline --json
```

```bash
# Bash
./pforge.sh timeline
./pforge.sh timeline --window 6h
./pforge.sh timeline --from 2026-05-18T00:00:00Z --to 2026-05-19T00:00:00Z
./pforge.sh timeline --source run,bug
./pforge.sh timeline --correlation abc123
./pforge.sh timeline --group-by correlation --limit 50
./pforge.sh timeline --json
```

### Flags

| Flag | Description |
|------|-------------|
| `--window <15m\|1h\|6h\|24h\|7d\|30d>` | Time window relative to now (default: `24h`) |
| `--from <iso>` | Start of window (ISO timestamp) |
| `--to <iso>` | End of window (ISO timestamp) |
| `--source <name,...>` | Comma-separated source filter |
| `--correlation <id>` | Filter to a single correlationId thread |
| `--group-by <time\|correlation>` | Group mode (default: `time`) |
| `--limit <n>` | Max events returned (default: 100, max: 2000) |
| `--json` | Output raw JSON instead of human-readable table |

### Sources

`hub-event`, `run`, `memory`, `openbrain`, `watch`, `tempering`, `bug`, `incident`, `forge-master`

### Notes

- `--group-by correlation` groups related events (e.g. all events from one slice run) into threads
- Pairs with `pforge incident` — supply the incident ID as `--correlation` to trace root cause
- MCP equivalent: `forge_timeline`

---

## `pforge patterns` — Recurring Pattern Surfacing (v2.90.10+)

Runs all registered pattern detectors against plan run history and surfaces recurring failure patterns grouped by severity. Useful for spotting systematic issues before they cause regressions.

```powershell
# PowerShell
.\pforge.ps1 patterns list
.\pforge.ps1 patterns list --since 2026-05-01
```

```bash
# Bash
./pforge.sh patterns list
./pforge.sh patterns list --since 2026-05-01
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | Run all detectors and print findings grouped by severity (🔴 error / 🟡 warning / ℹ️ info) |
| `list --since <iso>` | Restrict to patterns whose `lastSeen` is on or after the ISO timestamp |

### Detectors

| Detector | What It Finds |
|----------|--------------|
| `gate-failure-recurrence` | Same gate failing across multiple runs |
| `model-failure-rate-by-complexity` | Models with high failure rates on complex slices |
| `slice-flap-pattern` | Slices that repeatedly pass then fail (flakey gates) |
| `cost-anomaly` | Runs whose cost is an outlier relative to the rolling baseline |

### Notes

- Patterns are advisory — they don't block execution
- MCP equivalent: `forge_patterns_list`

---

## `pforge graph` — Knowledge Graph (v2.90.10+)

Builds and queries an in-memory knowledge graph over Plan Forge artifacts. Nodes: Phase, Slice, Commit, File, Bug, Run. Edges capture dependencies and authorship.

```powershell
# PowerShell
.\pforge.ps1 graph rebuild
.\pforge.ps1 graph stats
.\pforge.ps1 graph query phase
.\pforge.ps1 graph query file src/auth.mjs
.\pforge.ps1 graph query neighbors Phase-42
.\pforge.ps1 graph query recent-changes
```

```bash
# Bash
./pforge.sh graph rebuild
./pforge.sh graph stats
./pforge.sh graph query phase
./pforge.sh graph query file src/auth.mjs
./pforge.sh graph query neighbors Phase-42
./pforge.sh graph query recent-changes
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `rebuild` | Rebuild the knowledge graph snapshot; writes to `.forge/graph/snapshot.json` |
| `stats` | Print node count by type from the snapshot |
| `query <type>` | Query the graph. Types: `phase`, `file`, `recent-changes`, `neighbors <id>` |

### Notes

- Snapshot is rebuilt automatically by `forge_run_plan` at the start of each plan execution
- MCP equivalent: `forge_graph_query`

---

## `pforge sync-memories` — Generate Copilot Memory Hints (v3.0+)

Generates `.github/copilot-memory-hints.md` from forge decisions — trajectory notes, auto-skill promotions, and OpenBrain entries. Gives GitHub Copilot project-specific decision context without manual maintenance.

```powershell
# PowerShell
.\pforge.ps1 sync-memories
.\pforge.ps1 sync-memories --dry-run
.\pforge.ps1 sync-memories --force
.\pforge.ps1 sync-memories --limit 50
.\pforge.ps1 sync-memories --since 2026-05-01
.\pforge.ps1 sync-memories --output .github/copilot-memory-hints.md
```

```bash
# Bash
./pforge.sh sync-memories
./pforge.sh sync-memories --dry-run
./pforge.sh sync-memories --force
./pforge.sh sync-memories --limit 50
./pforge.sh sync-memories --since 2026-05-01
./pforge.sh sync-memories --output .github/copilot-memory-hints.md
```

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the generated content; don't write the file |
| `--force` | Overwrite even if content is unchanged |
| `--limit <N>` | Maximum number of memory entries to include |
| `--since <iso>` | Only include entries created on or after this ISO timestamp |
| `--output <path>` | Write to a custom path (default: `.github/copilot-memory-hints.md`) |

### Notes

- Complements `sync-instructions` — instructions define *how* to code; memory hints carry *what was decided*
- MCP equivalent: `forge_sync_memories`

---

## `pforge sync-instructions` — Generate Copilot Instructions (v3.0+)

Generates `.github/copilot-instructions.md` from forge project context (project profile, project principles, extra instruction files, `.forge.json` config). GitHub Copilot reads this file automatically, giving every conversation project-specific guidance without manual setup.

```powershell
# PowerShell
.\pforge.ps1 sync-instructions
.\pforge.ps1 sync-instructions --dry-run
.\pforge.ps1 sync-instructions --force
.\pforge.ps1 sync-instructions --no-principles
.\pforge.ps1 sync-instructions --no-profile
.\pforge.ps1 sync-instructions --no-extras
.\pforge.ps1 sync-instructions --output .github/copilot-instructions.md
```

```bash
# Bash
./pforge.sh sync-instructions
./pforge.sh sync-instructions --dry-run
./pforge.sh sync-instructions --force
./pforge.sh sync-instructions --no-principles
./pforge.sh sync-instructions --no-profile
./pforge.sh sync-instructions --no-extras
./pforge.sh sync-instructions --output .github/copilot-instructions.md
```

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print the generated content; don't write the file |
| `--force` | Overwrite even if content is unchanged |
| `--no-principles` | Exclude `docs/plans/PROJECT-PRINCIPLES.md` from the output |
| `--no-profile` | Exclude `project-profile.instructions.md` from the output |
| `--no-extras` | Exclude extra instruction files beyond profile and principles |
| `--output <path>` | Write to a custom path (default: `.github/copilot-instructions.md`) |

### Notes

- Run after editing `project-profile.instructions.md` or `PROJECT-PRINCIPLES.md` to keep Copilot in sync
- The dashboard Settings → Copilot tab provides a browser-based preview before writing
- MCP equivalent: `forge_sync_instructions`

---

## `pforge github` — GitHub AI Surface Inspector (v3.1.2+)

Inspect and validate the GitHub-native AI features that Plan Forge integrates with — cloud agent validation stack, Copilot metrics, and GitHub Actions health.

```powershell
# PowerShell
.\pforge.ps1 github status
.\pforge.ps1 github doctor
.\pforge.ps1 github metrics
```

```bash
# Bash
./pforge.sh github status
./pforge.sh github doctor
./pforge.sh github metrics
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `status` | Print a checklist of GitHub-native primitives Plan Forge integrates with (CodeQL, secret scanning, dependency review, Copilot code review) |
| `doctor` | Run diagnostic checks; surface misconfigurations and missing permissions |
| `metrics` | Fetch Copilot usage metrics (org mode) or personal commit activity (personal mode) |

### Notes

- `status` reads from `cloudAgentValidation` in `.forge.json` — configure it with `pforge check`
- `doctor` requires `gh` CLI auth with `admin:org` scope for org-level checks
- MCP equivalents: `forge_github_status`, `forge_github_metrics`

---

## `pforge crucible` — Crucible Smelt System

Submit ideas, requirements, and feature proposals to the Crucible — Plan Forge's structured smelt pipeline that converts raw ideas into hardened plan slices.

```powershell
# PowerShell
.\pforge.ps1 crucible list
.\pforge.ps1 crucible submit --title "Add pagination" --description "REST endpoints need cursor-based pagination"
.\pforge.ps1 crucible smelt <id>
.\pforge.ps1 crucible status <id>
.\pforge.ps1 crucible export <id>
```

```bash
# Bash
./pforge.sh crucible list
./pforge.sh crucible submit --title "Add pagination" --description "REST endpoints need cursor-based pagination"
./pforge.sh crucible smelt <id>
./pforge.sh crucible status <id>
./pforge.sh crucible export <id>
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List all pending and in-progress crucible submissions |
| `submit` | Create a new submission with `--title` and `--description` |
| `smelt <id>` | Run the smelt pipeline on a submission — generates structured slices |
| `status <id>` | Show the current status and output of a submission |
| `export <id>` | Export a smelted submission as a Plan Forge plan Markdown |

### Notes

- The smelt pipeline uses `forge_master_ask` under the hood to decompose ideas into actionable slices
- Submissions are stored in `.forge/crucible/` and are gitignored
- MCP equivalents: `forge_crucible_list`, `forge_crucible_submit`, `forge_crucible_smelt`, `forge_crucible_status`, `forge_crucible_export`

---

## `pforge skills` — Auto-Skill Promotion

Manage the auto-skill promotion queue. Plan Forge detects repeated workflow patterns in run history and proposes them as reusable skills. Use this command to review, accept, reject, or defer promotion candidates.

```powershell
# PowerShell
.\pforge.ps1 skills pending
.\pforge.ps1 skills pending --threshold 3
.\pforge.ps1 skills pending --json
.\pforge.ps1 skills accept <sha256Prefix>
.\pforge.ps1 skills reject <sha256Prefix> --reason "Too narrow scope"
.\pforge.ps1 skills defer  <sha256Prefix>
.\pforge.ps1 skills promote <sha256Prefix>
```

```bash
# Bash
./pforge.sh skills pending
./pforge.sh skills pending --threshold 3
./pforge.sh skills pending --json
./pforge.sh skills accept <sha256Prefix>
./pforge.sh skills reject <sha256Prefix> --reason "Too narrow scope"
./pforge.sh skills defer  <sha256Prefix>
./pforge.sh skills promote <sha256Prefix>
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `pending [--threshold N]` | List skill candidates with ≥ N occurrences (default: 2). `--json` for machine-readable output |
| `accept <prefix>` | Accept a candidate — moves it to `.github/skills/` as a new skill file |
| `reject <prefix>` | Reject a candidate permanently. Optionally supply `--reason` |
| `defer <prefix>` | Defer a candidate — keeps it in queue for review next run |
| `promote <prefix>` | Manually promote a candidate even if below threshold |

### Notes

- Candidate IDs are stable SHA-256 hashes of the skill fingerprint — safe to use in scripts
- Accepted skills are immediately available for `pforge run-skill` and `/slash` invocation
- MCP equivalents: `forge_skills_pending`, `forge_skills_accept`, `forge_skills_reject`, `forge_skills_defer`

---

## `pforge mcp-call` — Generic MCP Tool Proxy

Invoke any MCP tool exposed by the running `pforge-mcp` server on `:3100` without needing a bespoke CLI wrapper. Covers crucible-*, tempering-*, bug-*, `generate-image`, `run-skill`, `skill-status`, and any future tool.

```powershell
# PowerShell
.\pforge.ps1 mcp-call forge_crucible_list
.\pforge.ps1 mcp-call forge_crucible_submit --title="Add pagination" --description="..."
.\pforge.ps1 mcp-call forge_bug_register --json '{"severity":"high","title":"x"}'
.\pforge.ps1 mcp-call forge_cost_report
```

```bash
# Bash
./pforge.sh mcp-call forge_crucible_list
./pforge.sh mcp-call forge_crucible_submit --title="Add pagination" --description="..."
./pforge.sh mcp-call forge_bug_register --json '{"severity":"high","title":"x"}'
./pforge.sh mcp-call forge_cost_report
```

### Usage

```
pforge mcp-call <tool_name> [--arg=value ...] [--json '{"key":"val"}']
```

| Argument | Description |
|----------|-------------|
| `<tool_name>` | The MCP tool name (e.g. `forge_crucible_list`) — required |
| `--arg=value` | Pass individual key-value args to the tool |
| `--json <payload>` | Pass a raw JSON object as the tool's full argument payload |

### Notes

- Requires the MCP server to be running (`node pforge-mcp/server.mjs` or `pforge run-plan` in background mode)
- Server must be accessible at `http://localhost:3100` (default port; configurable in `.forge.json`)
- Use `forge_capabilities` to discover all available tool names and their argument schemas

---

## `master observe` — Forge-Master Observer (v3.8+)

Background hub subscriber that batches live Plan Forge events and narrates notable patterns. **Mute-by-default**: must be explicitly enabled in `.forge.json` or started via CLI.

```
pforge master observe --start [--detach]
pforge master observe --stop
pforge master observe --status
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `--start` | Connect the observer to the hub WebSocket. Events are batched per `batchWindowMs`. |
| `--start --detach` | Start as a background daemon process; PID written to `.forge/forge-master-observer.pid`. |
| `--stop` | Gracefully shut down the observer daemon (sends SIGTERM). |
| `--status` | Print whether the observer daemon is running and, if so, its PID. |

### Configuration (`.forge.json`)

```json
{
  "forgeMaster": {
    "observer": {
      "enabled": true,
      "maxUsdPerDay": 0.10,
      "maxNarrationsPerHour": 6,
      "batchWindowMs": 60000,
      "modelTier": null
    }
  }
}
```

Set `PFORGE_FORGE_MASTER_OBSERVE_DISABLE=1` to override `enabled` to `false` at the process level (useful in CI or non-interactive pipelines).

### Budget Enforcement

- The observer tracks spend in `.forge/forge-master-observer-state.json` (atomic write).
- Once `maxUsdPerDay` is exhausted, LLM narrations are skipped and a budget-block event is logged.
- Budget resets at midnight UTC.

### Notes

- Observer is read-only — it cannot call write tools or modify project files.
- Observer tokens are attributed to `forge-master` in `forge_cost_report`, not to the active run.
- The daemon reconnects on WebSocket disconnect with exponential backoff (3 retries, 1 s base).
- MCP equivalent: `forge_master_observe` with `action: "start" | "stop" | "status"`.

