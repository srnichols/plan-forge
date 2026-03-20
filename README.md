# AI Plan Hardening Template

> **A repeatable framework for converting rough ideas into drift-proof execution contracts that AI coding agents follow without scope creep.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## The Problem

AI coding agents (Copilot, Cursor, Claude, etc.) are powerful but drift-prone. Without guardrails, they:
- Silently expand scope ("I'll also add...")
- Make architectural decisions that weren't discussed
- Skip validation and ship broken code
- Lose context in long sessions

## The Solution

A **5-step pipeline** with **3 isolated agent sessions** that converts rough plans into bounded execution contracts:

```
SESSION 1 — Plan Hardening
  Step 1: Pre-flight checks (automated verification)
  Step 2: Harden the plan + resolve ambiguities

SESSION 2 — Execution
  Step 3: Execute slices (bounded 30-120 min chunks)
  Step 4: Completeness sweep (eliminate TODO/mock/stub artifacts)

SESSION 3 — Review & Audit
  Step 5: Independent review + drift detection (fresh agent, read-only)
```

### Why 3 Sessions?

The executor shouldn't self-audit. Fresh context eliminates blind spots from implementation decisions. Each session loads the same guardrails but brings independent judgment.

---

## Quick Start

### 1. Use This Template

Click **"Use this template"** on GitHub, or clone and run the setup wizard:

```bash
git clone https://github.com/YOUR-ORG/ai-plan-hardening-template.git my-project-plans
cd my-project-plans
```

### 2. Run the Setup Wizard

The wizard bootstraps your `.github/instructions/`, `AGENTS.md`, and `copilot-instructions.md` based on your tech stack:

```powershell
# PowerShell (Windows/macOS/Linux)
.\setup.ps1

# Or specify a preset directly
.\setup.ps1 -Preset dotnet
.\setup.ps1 -Preset typescript
.\setup.ps1 -Preset python
```

```bash
# Bash (macOS/Linux)
chmod +x setup.sh
./setup.sh

# Or specify a preset directly
./setup.sh --preset dotnet
./setup.sh --preset typescript
./setup.sh --preset python
```

### 3. Available Presets

| Preset | Stack | Build Cmd | Test Cmd |
|--------|-------|-----------|----------|
| `dotnet` | .NET / C# / Blazor / ASP.NET Core | `dotnet build` | `dotnet test` |
| `typescript` | TypeScript / React / Node.js / Express | `pnpm build` | `pnpm test` |
| `python` | Python / FastAPI / Django | `pytest` | `pytest --cov` |
| `custom` | Any stack | (you configure) | (you configure) |

### 4. Start Planning

```
1. Add your phase to docs/plans/DEPLOYMENT-ROADMAP.md
2. Draft a *-PLAN.md in docs/plans/
3. Copy the Pre-flight Prompt from the Instructions file → paste into agent chat
4. Copy the Hardening Prompt → paste into a NEW agent session
5. Copy the Execution Prompt → paste into a NEW agent session
6. Copy the Review Prompt → paste into a FRESH agent session
```

---

## Repo Structure

```
ai-plan-hardening-template/
├── README.md                          ← You are here
├── LICENSE
├── setup.ps1                          ← Interactive setup wizard (PowerShell)
├── setup.sh                           ← Interactive setup wizard (Bash)
├── CUSTOMIZATION.md                   ← How to adapt for your stack
│
├── docs/plans/                        ← Core pipeline documents
│   ├── README.md                      ← "How We Plan & Build"
│   ├── AI-Plan-Hardening-Runbook.md   ← Full runbook (prompts + templates)
│   ├── AI-Plan-Hardening-Runbook-Instructions.md  ← Step-by-step guide
│   ├── DEPLOYMENT-ROADMAP-TEMPLATE.md ← Skeleton for your roadmap
│   └── examples/
│       ├── Phase-DOTNET-EXAMPLE.md    ← .NET worked example
│       ├── Phase-TYPESCRIPT-EXAMPLE.md ← TypeScript worked example
│       └── Phase-PYTHON-EXAMPLE.md    ← Python worked example
│
├── .github/
│   ├── copilot-instructions.md        ← Minimal (setup wizard fills this)
│   └── instructions/
│       ├── ai-plan-hardening-runbook.instructions.md  ← Auto-loads for plans
│       ├── architecture-principles.instructions.md    ← Universal principles
│       └── git-workflow.instructions.md               ← Commit conventions
│
├── presets/                           ← Tech-specific starter files
│   ├── dotnet/                        ← .NET / C# / Blazor / ASP.NET
│   ├── typescript/                    ← TypeScript / React / Node / Express
│   ├── python/                        ← Python / FastAPI / Django
│   └── shared/                        ← Files common to ALL presets
│
└── templates/                         ← Raw templates for manual setup
    ├── AGENTS.md.template
    └── copilot-instructions.md.template
```

---

## What the Setup Wizard Does

Running `setup.ps1` (PowerShell) or `setup.sh` (Bash) with a preset:

1. **Copies preset instruction files** from `presets/{stack}/` to your project root
2. **Generates `AGENTS.md`** with patterns for your tech stack
3. **Generates `.github/copilot-instructions.md`** with stack-specific conventions
4. **Copies shared instruction files** (git-workflow, architecture principles)
5. **Copies the core plan docs** to `docs/plans/`
6. **Creates `.plan-hardening.json`** with your build/test commands for reference

After running the wizard, you can **delete the `presets/` and `templates/` directories** — they're only needed during setup.

---

## When to Use This Pipeline

| Change Size | Examples | Recommendation |
|-------------|----------|----------------|
| **Micro** (<30 min) | Bug fix, config tweak, copy change | **Skip** — direct commit |
| **Small** (30–120 min) | Single-file feature, simple migration | **Optional** — light hardening |
| **Medium** (2–8 hrs) | Multi-file feature, new API endpoint | **Full pipeline** — all 5 steps |
| **Large** (1+ days) | New module, schema redesign | **Full pipeline + branch-per-slice** |

> **Rule of thumb**: If the work touches 3+ files or takes more than 2 hours, run the full pipeline.

---

## Key Concepts

### 6 Mandatory Template Blocks

Every hardened plan must contain:

| Block | Purpose |
|-------|---------|
| **Scope Contract** | What's in, what's out, what's forbidden |
| **Required Decisions** | Ambiguities resolved before execution |
| **Execution Slices** | 30-120 min chunks with dependencies and validation |
| **Re-anchor Checkpoints** | Drift detection between slices |
| **Definition of Done** | Measurable completion criteria |
| **Post-Mortem** | Lessons learned for next phase |

### Parallel Execution

Slices can be tagged `[parallel-safe]` or `[sequential]`:
- Parallel slices in the same group run concurrently (different agent sessions)
- A **Parallel Merge Checkpoint** runs after each group
- If any parallel slice fails, all slices in that group halt

### Stop Conditions

Execution halts immediately if:
- A Required Decision is still TBD
- The agent needs to guess about behavior or architecture
- A Validation Gate fails (build breaks, tests fail)
- Work exceeds the current slice boundary
- A Forbidden Action would be triggered

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b preset/rust`)
3. Add your preset in `presets/your-stack/`
4. Update `setup.ps1` and `setup.sh` to support the new preset
5. Add a worked example in `docs/plans/examples/`
6. Submit a PR

---

## License

MIT — see [LICENSE](LICENSE) for details.
