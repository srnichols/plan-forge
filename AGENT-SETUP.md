# AI Agent Setup Guide

> **Audience**: You are an AI coding agent (Copilot, Claude, Cursor, Aider, etc.) tasked with incorporating the Plan Forge framework into a target project.
>
> **This file is your entry point.** Read it top-to-bottom, then execute the appropriate path.

---

## Quick Decision: Greenfield or Brownfield?

Scan the target project directory. Choose ONE path:

```
IF target has NO .github/copilot-instructions.md
   AND NO .github/instructions/ directory
   AND NO AGENTS.md
   → GREENFIELD — Go to Section 1

IF target has ANY of those files already
   → BROWNFIELD — Go to Section 2
```

---

## Section 1: Greenfield Setup (New Project or No Existing Guardrails)

### Step 1: Auto-Detect Tech Stack

Scan the target project root for these marker files to determine the correct preset:

| Marker File(s) | Preset | Stack Label |
|----------------|--------|-------------|
| `*.csproj`, `*.sln`, `*.fsproj` | `dotnet` | .NET / C# / ASP.NET Core |
| `go.mod` | `go` | Go / Standard Library |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | `java` | Java / Spring Boot |
| `package.json` + (`tsconfig.json` OR `*.ts` files) | `typescript` | TypeScript / React / Node.js |
| `package.json` WITHOUT TypeScript markers | `typescript` | TypeScript / React / Node.js |
| `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` | `python` | Python / FastAPI |
| None of the above | `custom` | Custom (configure manually) |

**Priority rule**: If multiple markers exist (e.g., `.csproj` + `package.json`), pick the one that matches the primary application — check for a `Program.cs` or `Startup.cs` (→ dotnet), `go.mod` (→ go), `pom.xml` (→ java) vs `src/index.ts` (→ typescript).

### Step 2: Run the Setup Script Non-Interactively

```powershell
# PowerShell — pass all parameters to skip prompts
.\setup.ps1 -Preset <detected-preset> -ProjectPath "<target-path>" -ProjectName "<project-name>" -Force
```

```bash
# Bash — same thing
./setup.sh --preset <detected-preset> --path "<target-path>" --name "<project-name>" --force
```

**`-Force` is required for unattended agent execution** — it skips confirmation prompts and overwrites template files.

### Step 3: Customize Generated Files

After setup completes, the agent MUST:

1. **Edit `.github/copilot-instructions.md`** — Replace placeholder sections with actual project details:
   - Project description, tech stack versions, architecture patterns
   - Build/test/lint commands
   - Domain-specific conventions
2. **Edit `AGENTS.md`** — If the project has background services/workers, document them. Otherwise leave the template structure.
3. **Edit `docs/plans/DEPLOYMENT-ROADMAP.md`** — Add the current phase or feature being planned.

### Step 4: Validate

Run the validation script to confirm everything landed correctly:

```powershell
.\validate-setup.ps1 -ProjectPath "<target-path>"
```

```bash
./validate-setup.sh --path "<target-path>"
```

All checks must pass before proceeding to plan hardening.

---

## Section 2: Brownfield Setup (Existing Project with Guardrails)

The target project already has some guardrail files. **Do NOT overwrite them** — merge instead.

### Step 1: Auto-Detect (Same as Greenfield Step 1)

Determine the correct preset using the marker file table above.

### Step 2: Run Setup WITHOUT `-Force`

```powershell
.\setup.ps1 -Preset <detected-preset> -ProjectPath "<target-path>" -ProjectName "<project-name>"
```

Without `-Force`, the script will **SKIP** any file that already exists. This is correct — we don't want to blast existing guardrails.

### Step 3: Merge What Was Skipped

For each file that was SKIPPED, apply the appropriate merge strategy:

```
DECISION TREE — For each skipped file:

IF file is .github/copilot-instructions.md:
  → Read BOTH existing + template (presets/<preset>/.github/copilot-instructions.md)
  → ADD missing sections: "Architecture Principles", "Planning Pipeline", "Red Flags"
  → DO NOT duplicate or remove existing content

IF file is .github/instructions/*.instructions.md:
  → Same filename exists? Keep existing as base, append missing sections from template
  → Different filenames? Copy template files directly (no conflict)
  → Always preserve existing `applyTo` frontmatter

IF file is AGENTS.md:
  → Keep existing file, add "AI Agent Development Standards" section if missing

IF file is in docs/plans/:
  → Always safe to copy — no conflicts with existing docs

IF file is in .github/prompts/, .github/agents/, or .github/skills/:
  → Copy files that DON'T exist in target
  → SKIP files that already exist (they've been customized)
```

**Key rule**: Never delete or overwrite existing project-specific content. Only add what's missing.

### Step 4: Validate

Run validation (same as Greenfield Step 4). The validator checks for the minimum required files regardless of how they got there.

---

## Section 3: What Files Must Exist After Setup

The validation script checks for these files. All must be present and non-empty:

### Required (All Projects)

| File | Purpose |
|------|---------|
| `.github/copilot-instructions.md` | Master Copilot config — loaded every session |
| `.github/instructions/architecture-principles.instructions.md` | Universal coding principles |
| `.github/instructions/git-workflow.instructions.md` | Commit conventions |
| `.github/instructions/ai-plan-hardening-runbook.instructions.md` | Auto-loads for plan docs |
| `docs/plans/AI-Plan-Hardening-Runbook.md` | Full pipeline runbook |
| `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md` | Copy-paste prompts |
| `docs/plans/DEPLOYMENT-ROADMAP.md` | Phase tracker |

### Required (Non-Custom Presets)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent/worker documentation |
| `.github/instructions/database.instructions.md` | Database patterns |
| `.github/instructions/testing.instructions.md` | Test conventions |
| `.github/instructions/security.instructions.md` | Security rules |

### Required (Non-Custom Presets — Agentic Files)

| Directory / Files | Purpose |
|-------------------|---------|
| `.github/prompts/*.prompt.md` (14 files) | Scaffolding recipes for entities, services, tests, workers, middleware, DTOs, config, Dockerfiles |
| `.github/agents/*.agent.md` (15 files) | Specialized reviewer/executor roles (security, architecture, API contracts, dependency, compliance, multi-tenancy, pipeline agents, etc.) |
| `.github/skills/*/SKILL.md` (8 skills) | Multi-step procedures for migrations, deploys, test sweeps, code review, dependency audit, release notes, API docs, onboarding |

### Optional but Recommended

| File | Purpose |
|------|---------|
| `.vscode/settings.json` | Copilot IDE settings |
| `docs/COPILOT-VSCODE-GUIDE.md` | VS Code usage guide |
| `docs/CLI-GUIDE.md` | CLI wrapper documentation |
| `docs/EXTENSIONS.md` | Extension system documentation |
| `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md` | Template for defining project principles |
| `.github/instructions/project-principles.instructions.md` | Auto-loads Project Principles when they exist |
| `.github/prompts/project-principles.prompt.md` | Guided workshop to define Project Principles |
| `.forge.json` | Setup metadata |
| `.forge/capabilities.json` | Machine-readable manifest of all prompts, agents, skills, instructions |
| `.forge/extensions/extensions.json` | Installed extensions manifest |
| `.github/hooks/plan-forge.json` | Lifecycle hooks (SessionStart, PreToolUse, PostToolUse) |
| `.github/hooks/scripts/*.sh`, `*.ps1` | Hook scripts (inject context, enforce forbidden actions, warn on TODOs) |
| `pforge.ps1` / `pforge.sh` | CLI wrapper scripts |

---

## Section 4: Placeholder Resolution

After setup, these placeholders may remain in generated files. The agent must replace ALL of them:

| Placeholder | Replace With |
|-------------|-------------|
| `<YOUR PROJECT NAME>` | Actual project name |
| `<YOUR TECH STACK>` | Actual tech stack description |
| `<DATE>` | Current date (YYYY-MM-DD) |
| `<YOUR BUILD COMMAND>` | Actual build command (e.g., `dotnet build`, `pnpm build`) |
| `<YOUR TEST COMMAND>` | Actual test command (e.g., `dotnet test`, `pnpm test`) |
| `<YOUR LINT COMMAND>` | Actual lint command (e.g., `dotnet format`, `pnpm lint`) |

The validation script flags any remaining `<YOUR` or `<DATE>` strings.

---

## Section 5: After Setup — Using the Pipeline

Once setup and validation pass, the agent can run the 5-step planning pipeline.

### Option A: Using the CLI (`pforge`)

If `pforge.ps1` (Windows) or `pforge.sh` (macOS/Linux) exists in the repo root, use CLI commands for project management tasks:

```
pforge check                          # Validate setup
pforge status                         # Show all phases with status
pforge new-phase <feature-name>       # Create plan file + roadmap entry
pforge branch <plan-file>             # Create branch from plan's Branch Strategy
pforge ext install <path>             # Install an extension
pforge ext list                       # List installed extensions
```

See `docs/CLI-GUIDE.md` for full command reference and AI Agent integration guide.

> **Important**: The CLI handles project management. The core pipeline (hardening, execution, review) still runs through Agent Mode prompts — see Option B.

### Option B: Using the Pipeline Prompts (Manual or Agent Mode)

1. **Read** `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
2. **Follow** the copy-paste prompts for each step (Step 0–6)
3. **Use 4 sessions** (specify & plan → execute → review → ship) to avoid context bleed
4. **Use prompt templates** (`.github/prompts/`) during execution for consistent scaffolding
5. **Use agent definitions** (`.github/agents/`) for focused reviews (security, architecture, performance)
6. **Use skills** (`.github/skills/`) for multi-step procedures (migrations, deploys, test sweeps)

### Option C: Using Pipeline Agents (Recommended for Autonomous Execution)

Instead of copy-pasting prompts, use the **5 pipeline agents** that chain with handoff buttons:

| Agent | File | Step | Hands Off To |
|-------|------|------|-------------|
| **Specifier** | `.github/agents/specifier.agent.md` | Step 0 | Plan Hardener |
| **Plan Hardener** | `.github/agents/plan-hardener.agent.md` | Steps 1–2 | Executor |
| **Executor** | `.github/agents/executor.agent.md` | Steps 3–4 | Reviewer Gate |
| **Reviewer Gate** | `.github/agents/reviewer-gate.agent.md` | Step 5 | Shipper (PASS) / Executor (LOCKOUT) |
| **Shipper** | `.github/agents/shipper.agent.md` | Step 6 | (terminal) |

**For autonomous AI agent execution:**
1. Start with the Specifier agent — provide the feature description
2. Follow the handoff chain through to Ship
3. Each handoff uses `send: false` — the user reviews the prompt before it's sent
4. If the Review Gate issues a LOCKOUT, the "Fix Issues →" handoff returns to the Executor

### Lifecycle Hooks

Plan Forge installs lifecycle hooks (`.github/hooks/plan-forge.json`) that run automatically:

| Hook | What It Does |
|------|-------------|
| **SessionStart** | Injects Project Principles, current phase, and forbidden patterns into context |
| **PreToolUse** | Blocks file edits to paths listed in the active plan's Forbidden Actions |
| **PostToolUse** | Auto-formats edited files, warns on TODO/FIXME/stub markers |
| **Stop** | Warns if code was modified but no test run was detected |

These hooks enforce guardrails without manual intervention. The agent should expect that:
- Forbidden file edits will be blocked automatically
- TODO markers in edited files will trigger warnings
- Sessions without test runs will produce a reminder

### Post-Setup Recommendations

After the pipeline is installed, recommend these optional steps to the user:

1. **Define Project Principles** — Run `.github/prompts/project-principles.prompt.md` to declare non-negotiable principles, tech commitments, and forbidden patterns. These are automatically checked in Steps 1, 2, and 5.
2. **Generate a Project Profile** — Run `.github/prompts/project-profile.prompt.md` to generate Copilot-specific coding guardrails.
3. **Install Extensions** — If the team has shared guardrail packages, install them via `pforge ext install <path>` or manually. See `docs/EXTENSIONS.md`.

For VS Code Copilot-specific workflow details, see `docs/COPILOT-VSCODE-GUIDE.md`.
