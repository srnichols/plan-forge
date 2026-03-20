# Customizing the AI Plan Hardening Framework

> **Purpose**: Guide for adapting this template to your specific project, tech stack, and team workflow.  
> **Also see**: [docs/COPILOT-VSCODE-GUIDE.md](docs/COPILOT-VSCODE-GUIDE.md) — How to run the pipeline in VS Code with Copilot

---

## After Running `setup.ps1`

The setup wizard copies preset files and generates your project-specific configuration. Here's what to customize next:

### 1. Update `.github/copilot-instructions.md`

The wizard generates a starter file. Customize it with:

- **Project overview**: What your app does, who it's for
- **Tech stack details**: Specific versions, frameworks, libraries
- **Architecture patterns**: How your layers are organized
- **Domain-specific rules**: Business logic conventions, data models
- **Common patterns**: Code examples your team uses repeatedly

### 2. Add Domain-Specific Instruction Files

The presets include common instruction files (database, testing, security). Add your own for project-specific domains:

```
.github/instructions/
├── architecture-principles.instructions.md  ← From preset
├── database.instructions.md                 ← From preset
├── testing.instructions.md                  ← From preset
├── security.instructions.md                 ← From preset
├── git-workflow.instructions.md             ← From shared
│
├── your-domain.instructions.md              ← ADD: Your domain rules
├── your-api.instructions.md                 ← ADD: API conventions
└── your-ui.instructions.md                  ← ADD: UI patterns
```

Each instruction file should have YAML frontmatter:

```yaml
---
description: Short description of what this file covers
applyTo: 'path/glob/pattern/**/*.ext'
priority: HIGH
---
```

### How `applyTo` Works (Copilot Automatic Loading)

GitHub Copilot reads instruction files **automatically** based on the `applyTo` glob pattern in the YAML frontmatter. When you open a file matching the pattern, Copilot loads that instruction file into context.

**Key rules:**
- `applyTo: '**'` loads for ALL files (use sparingly — consumes context budget)
- `applyTo: '**/*.cs'` loads only when editing C# files
- `applyTo: 'docs/plans/**'` loads only when editing plan documents
- Multiple patterns: not currently supported — use one glob per file
- The `.github/copilot-instructions.md` file (no frontmatter) is loaded **every** session

**Common patterns by stack:**

| Stack | Pattern | Loads When |
|-------|---------|------------|
| .NET | `'**/*.cs'` | Any C# file |
| TypeScript | `'**/*.ts'` | Any TypeScript file |
| Python | `'**/*.py'` | Any Python file |
| SQL | `'**/*.sql'` | Any SQL migration |
| Docker | `'**/Dockerfile'`, `'docker-compose*.yml'` | Docker files |
| Plans | `'docs/plans/**'` | Plan documents |

**Context budget tip:** Each loaded instruction file consumes part of Copilot's context window. Keep instruction files under ~150 lines and use specific `applyTo` patterns instead of `'**'`.

### VS Code Settings (Optional)

Copy `templates/vscode-settings.json.template` to `.vscode/settings.json` in your project to get recommended Copilot settings:

```powershell
# Copy the template
cp templates/vscode-settings.json.template .vscode/settings.json
```

The template configures:
- Copilot agent mode enabled
- Code generation instruction file references
- Markdown word wrap for plan files
- File associations for `.instructions.md` files

### 3. Configure `AGENTS.md`

The wizard generates a starter `AGENTS.md`. Add:

- **Background workers/services**: What they do, how they're configured
- **Event processing**: Pub/sub topics, message schemas
- **Scheduled tasks**: Cron patterns, what runs when
- **Agent communication**: How services talk to each other

### 4. Set Up Your Roadmap

Edit `docs/plans/DEPLOYMENT-ROADMAP.md`:

```markdown
## Active Phases

### Phase 1: <Your First Feature>
**Goal**: One-line description
**Plan**: [Phase-1-YOUR-FEATURE-PLAN.md](./Phase-1-YOUR-FEATURE-PLAN.md)
**Status**: 📋 Planned
```

---

## Customizing the Runbook Prompts

### Build & Test Commands

The runbook prompts use `{BUILD_CMD}` and `{TEST_CMD}` placeholders. If you used a preset, these are already filled in. For custom setups, search and replace:

| Placeholder | .NET | TypeScript | Python | Your Stack |
|-------------|------|------------|--------|------------|
| `{BUILD_CMD}` | `dotnet build` | `pnpm build` | `python -m build` | `???` |
| `{TEST_CMD}` | `dotnet test` | `pnpm test` | `pytest` | `???` |
| `{LINT_CMD}` | `dotnet format --verify-no-changes` | `pnpm lint` | `ruff check .` | `???` |
| `{TEST_FILTER}` | `--filter "Category=UnitTests"` | `-- --run --grep unit` | `-m unit` | `???` |

### Validation Gate Commands

Update the Execution Slice template's validation gates to match your stack:

```markdown
**Validation Gates**:
- [ ] `{BUILD_CMD}` passes with zero errors
- [ ] `{TEST_CMD}` — all pass
- [ ] `{LINT_CMD}` — no violations
```

### Anti-Pattern Grep

The runbook includes an optional anti-pattern scan. Customize for your language:

**C# / .NET:**
```bash
grep -rn "\.Result\b\|\.Wait()\|\.GetAwaiter().GetResult()" --include="*.cs"
```

**TypeScript / JavaScript:**
```bash
grep -rn "any\b\|as any\|@ts-ignore\|@ts-expect-error" --include="*.ts"
```

**Python:**
```bash
grep -rn "# type: ignore\|noqa\|bare except" --include="*.py"
```

---

## Customizing Pre-flight Checks

The Pre-flight Prompt in the Instructions file checks for guardrail files. Update the domain keyword → guardrail mapping for your project:

```text
5. DOMAIN GUARDRAILS — Scan <YOUR-PLAN>.md for keywords to identify relevant domains.
   For each domain detected, confirm the guardrail file exists:
   - UI/Component/Frontend → .github/instructions/frontend.instructions.md
   - Database/SQL/Repository → .github/instructions/database.instructions.md
   - API/Route/Controller → .github/instructions/api.instructions.md
   - Auth/OAuth/JWT → .github/instructions/security.instructions.md
   - Docker/K8s/Deploy → .github/instructions/deploy.instructions.md
   - <YOUR DOMAIN> → .github/instructions/<your-domain>.instructions.md
```

---

## Customizing the Reviewer Gate

The Reviewer Gate checklist in the runbook is generic. Add project-specific checks:

```markdown
Review checklist:
1. SCOPE COMPLIANCE — Are all changes within the Scope Contract?
2. FORBIDDEN ACTIONS — Were any off-limits files touched?
3. ARCHITECTURE — Does the code follow layer separation?
4. ERROR HANDLING — Proper error types, no empty catch blocks?
5. SECURITY — Input validation? No secrets in code?
6. TESTING — New features covered by tests?
7. <YOUR CHECK> — Your project-specific rule
8. <YOUR CHECK> — Another project-specific rule
```

---

## Adding a New Tech Preset

To contribute a preset for a new tech stack:

1. Create `presets/your-stack/` directory
2. Add these files:
   - `.github/copilot-instructions.md` — Stack-specific conventions
   - `.github/instructions/architecture-principles.instructions.md` — Adapted principles
   - `.github/instructions/database.instructions.md` — ORM/query patterns
   - `.github/instructions/testing.instructions.md` — Test framework patterns  
   - `.github/instructions/security.instructions.md` — Security patterns
   - `.github/instructions/deploy.instructions.md` — Deployment patterns
   - `AGENTS.md` — Agent/worker patterns for this stack
3. Add an example plan in `docs/plans/examples/Phase-YOUR-STACK-EXAMPLE.md`
4. Update `setup.ps1` to support the new preset name
5. Update `README.md` preset table

### Preset File Conventions

- Use the same file names across presets (consistency)
- Include frontmatter with `applyTo` globs matching the stack's file extensions
- Include at least 3 "do this" / "don't do this" examples per instruction file
- Reference the stack's actual tooling (test runners, linters, build tools)

---

## Removing Template Scaffolding

After setup, you can safely delete these directories:

```
presets/          ← Only needed during setup
templates/        ← Only needed for manual setup
setup.ps1         ← Only needed once
CUSTOMIZATION.md  ← Keep or delete (your preference)
```

The essential files for ongoing use are:

```
docs/plans/                    ← Runbook + your plans
.github/instructions/          ← Guardrail files
.github/copilot-instructions.md
AGENTS.md
```
