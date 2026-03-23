# AI Agent Setup Guide

> **Audience**: You are an AI coding agent (Copilot, Claude, Cursor, Aider, etc.) tasked with incorporating the AI Plan Hardening framework into a target project.
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

For each file that was SKIPPED, the agent must merge the template content into the existing file:

#### `.github/copilot-instructions.md` (most common conflict)

The existing file has project-specific conventions. The template adds architecture principles and planning pipeline references. Merge strategy:

1. **Read the existing file** completely
2. **Read the template file** from `presets/<preset>/.github/copilot-instructions.md`
3. **Add these sections** if missing from the existing file:
   - "Architecture Principles" section (link to `architecture-principles.instructions.md`)
   - "Planning Pipeline" section (link to `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`)
   - "Red Flags" block (the ❌ stop markers)
4. **Do NOT duplicate** sections that already exist
5. **Do NOT remove** any existing project-specific content

#### `.github/instructions/*.instructions.md` files

If the target already has instruction files with the same name:

1. **Read both the existing and template versions**
2. **Keep the existing file as the base** (it has project-specific patterns)
3. **Append any sections** from the template that don't exist in the current file
4. **Preserve all `applyTo` frontmatter** from the existing file

If the target has instruction files with DIFFERENT names (e.g., `blazor.instructions.md` vs `frontend.instructions.md`):

1. **Copy the template files** — they don't conflict
2. No merging needed

#### `AGENTS.md`

If exists:
1. **Keep the existing file** — it documents actual project agents
2. **Add the "AI Agent Development Standards"** section from the template if not present
3. **Do NOT replace** existing worker documentation

#### `docs/plans/` directory

Always safe to copy — these are new planning documents that shouldn't conflict with existing project docs.

#### `.github/prompts/`, `.github/agents/`, `.github/skills/` directories

If these directories don't exist in the target project:
1. **Copy them** from the preset — no conflict possible

If the target already has files in these directories:
1. **Copy new files** that don't exist in the target
2. **Skip files** that already exist (they've been customized)
3. **Do NOT overwrite** existing prompt, agent, or skill files

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
| `.github/prompts/*.prompt.md` (7 files) | Scaffolding recipes for entities, services, tests, workers |
| `.github/agents/*.agent.md` (11 files) | Specialized reviewer/executor roles (security, architecture, API contracts, multi-tenancy, etc.) |
| `.github/skills/*/SKILL.md` (3 skills) | Multi-step procedures for migrations, deploys, test sweeps |

### Optional but Recommended

| File | Purpose |
|------|---------|
| `.vscode/settings.json` | Copilot IDE settings |
| `docs/COPILOT-VSCODE-GUIDE.md` | VS Code usage guide |
| `.plan-hardening.json` | Setup metadata |

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

Once setup and validation pass, the agent can run the 5-step planning pipeline:

1. **Read** `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
2. **Follow** the copy-paste prompts for each step
3. **Use 3 separate sessions** (plan → execute → review) to avoid context bleed
4. **Use prompt templates** (`.github/prompts/`) during execution for consistent scaffolding
5. **Use agent definitions** (`.github/agents/`) for focused reviews (security, architecture, performance)
6. **Use skills** (`.github/skills/`) for multi-step procedures (migrations, deploys, test sweeps)

For VS Code Copilot-specific workflow details, see `docs/COPILOT-VSCODE-GUIDE.md`.
