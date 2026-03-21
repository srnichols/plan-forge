# AI Plan Hardening Template

> **A repeatable framework for converting rough ideas into drift-proof execution contracts that AI coding agents follow without scope creep.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

### AI Agents: Autonomous Setup

> **If you are an AI coding agent** tasked with incorporating this framework into a project, read **[AGENT-SETUP.md](AGENT-SETUP.md)** — it has auto-detection rules, greenfield vs brownfield decision trees, exact non-interactive commands, merge strategies for existing guardrails, and a post-setup validator.

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

### Using with GitHub Copilot in VS Code?

See **[docs/COPILOT-VSCODE-GUIDE.md](docs/COPILOT-VSCODE-GUIDE.md)** for a complete walkthrough — how Agent Mode works, how instruction files auto-load, managing context budget, using memory to bridge sessions, and troubleshooting tips.

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
.\setup.ps1 -Preset java
.\setup.ps1 -Preset go
```

```bash
# Bash (macOS/Linux)
chmod +x setup.sh
./setup.sh

# Or specify a preset directly
./setup.sh --preset dotnet
./setup.sh --preset typescript
./setup.sh --preset python
./setup.sh --preset java
./setup.sh --preset go
```

### 3. Available Presets

| Preset | Stack | Build Cmd | Test Cmd |
|--------|-------|-----------|----------|
| `dotnet` | .NET / C# / Blazor / ASP.NET Core | `dotnet build` | `dotnet test` |
| `typescript` | TypeScript / React / Node.js / Express | `pnpm build` | `pnpm test` |
| `python` | Python / FastAPI / Django | `pytest` | `pytest --cov` |
| `java` | Java / Spring Boot / Gradle / Maven | `./gradlew build` | `./gradlew test` |
| `go` | Go / Chi / Gin / Standard Library | `go build ./...` | `go test ./...` |
| `custom` | Any stack | (you configure) | (you configure) |

### Instruction Files Per Preset

Each preset includes **12 instruction files** that auto-load based on the file being edited:

| Instruction File | Purpose |
|------------------|---------|
| `database.instructions.md` | ORM/query patterns, migrations, connection management |
| `testing.instructions.md` | Unit tests, integration tests, test containers |
| `security.instructions.md` | Auth, input validation, secret management, CORS |
| `deploy.instructions.md` | Dockerfiles, health checks, container optimization |
| `caching.instructions.md` | Redis, in-memory cache, TTL strategies, cache-aside pattern |
| `messaging.instructions.md` | Pub/sub, job queues, event-driven patterns, retry/DLQ |
| `observability.instructions.md` | OpenTelemetry, structured logging, metrics, health checks |
| `api-patterns.instructions.md` | REST conventions, pagination, error responses (RFC 9457) |
| `errorhandling.instructions.md` | Exception hierarchy, ProblemDetails, error boundaries |
| `performance.instructions.md` | Hot/cold path analysis, allocation reduction, query optimization |
| `multi-environment.instructions.md` | Dev/staging/production config, environment detection, feature flags |
| `version.instructions.md` | Semantic versioning, commit-driven bumps, release tagging |

### Prompt Templates Per Preset

Each preset includes **7 prompt templates** (`.github/prompts/`) that agents use as scaffolding recipes:

| Prompt Template | Purpose |
|-----------------|---------|
| `new-entity.prompt.md` | Scaffold end-to-end: migration, model, repository, service, tests |
| `new-service.prompt.md` | Service class with interface, DI, logging, validation |
| `new-controller.prompt.md` | REST controller with auth, error mapping, OpenAPI docs |
| `new-repository.prompt.md` | Data access layer with parameterized queries, connection pooling |
| `new-test.prompt.md` | Unit/integration test with naming conventions, traits, mocking |
| `bug-fix-tdd.prompt.md` | Red-Green-Refactor bug fix with regression test |
| `new-worker.prompt.md` | Background worker/job with retry, graceful shutdown, health checks |

### Agent Definitions Per Preset

Each preset includes **6 agent definitions** (`.github/agents/`) — specialized reviewer/executor roles:

| Agent | Purpose |
|-------|---------|
| `architecture-reviewer.agent.md` | Audit layer separation, pattern violations, coupling |
| `security-reviewer.agent.md` | OWASP Top 10, injection, auth gaps, secret exposure |
| `database-reviewer.agent.md` | SQL safety, N+1 queries, naming, indexing, migrations |
| `performance-analyzer.agent.md` | Hot paths, allocations, async anti-patterns, caching gaps |
| `test-runner.agent.md` | Run tests, analyze failures, diagnose root causes |
| `deploy-helper.agent.md` | Build, push, migrate, deploy, verify health checks |

### Pipeline Agents (Shared)

In addition to the preset reviewer agents, the template includes **3 pipeline agents** that automate the Plan → Execute → Review workflow with handoff buttons:

| Agent | Purpose | Hands Off To |
|-------|---------|--------------|
| `plan-hardener.agent.md` | Harden draft plans into execution contracts | Executor |
| `executor.agent.md` | Execute slices with validation gates | Reviewer Gate |
| `reviewer-gate.agent.md` | Read-only audit for drift and violations | (terminal) |

These are stack-independent and use `handoffs:` frontmatter to chain sessions with clickable buttons.

> **Tip**: Use `/create-agent` in VS Code Copilot to create additional project-specific agents interactively. See [CUSTOMIZATION.md](CUSTOMIZATION.md) for details.

### Skills Per Preset

Each preset includes **3 skills** (`.github/skills/`) — multi-step executable procedures:

| Skill | Purpose |
|-------|---------|
| `database-migration/` | Generate → validate → deploy schema migrations |
| `staging-deploy/` | Build images → run migrations → apply manifests → verify |
| `test-sweep/` | Run all test suites with aggregated pass/fail reporting |

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
├── AGENT-SETUP.md                     ← AI agent entry point (autonomous setup)
├── LICENSE
├── setup.ps1                          ← Setup wizard (PowerShell, supports -AutoDetect)
├── setup.sh                           ← Setup wizard (Bash, supports --auto-detect)
├── validate-setup.ps1                 ← Post-setup validator (PowerShell)
├── validate-setup.sh                  ← Post-setup validator (Bash)
├── CUSTOMIZATION.md                   ← How to adapt for your stack
│
├── docs/
│   ├── COPILOT-VSCODE-GUIDE.md        ← How to use with Copilot in VS Code
│   └── plans/                         ← Core pipeline documents
│   ├── README.md                      ← "How We Plan & Build"
│   ├── AI-Plan-Hardening-Runbook.md   ← Full runbook (prompts + templates)
│   ├── AI-Plan-Hardening-Runbook-Instructions.md  ← Step-by-step guide
│   ├── DEPLOYMENT-ROADMAP-TEMPLATE.md ← Skeleton for your roadmap
│   └── examples/
│       ├── Phase-DOTNET-EXAMPLE.md    ← .NET worked example
│       ├── Phase-TYPESCRIPT-EXAMPLE.md ← TypeScript worked example
│       ├── Phase-PYTHON-EXAMPLE.md    ← Python worked example
│       ├── Phase-JAVA-EXAMPLE.md      ← Java worked example
│       └── Phase-GO-EXAMPLE.md        ← Go worked example
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
│   │   └── .github/
│   │       ├── instructions/          ← 12 instruction files
│   │       ├── prompts/               ← 7 prompt templates
│   │       ├── agents/                ← 6 agent definitions
│   │       └── skills/                ← 3 multi-step skills
│   ├── typescript/                    ← TypeScript / React / Node / Express
│   ├── python/                        ← Python / FastAPI / Django
│   ├── java/                          ← Java / Spring Boot / Gradle / Maven
│   ├── go/                            ← Go / Chi / Gin / Standard Library
│   └── shared/                        ← Files common to ALL presets
│
└── templates/                         ← Raw templates for manual setup
    ├── AGENTS.md.template
    ├── copilot-instructions.md.template
    └── vscode-settings.json.template   ← VS Code / Copilot settings
```

---

## What the Setup Wizard Does

Running `setup.ps1` (PowerShell) or `setup.sh` (Bash) with a preset:

1. **Copies preset instruction files** from `presets/{stack}/` to your project root (12 instruction files)
2. **Copies prompt templates** for scaffolding new entities, services, tests (7 prompts)
3. **Copies agent definitions** for architecture review, security audit, testing (6 agents)
4. **Copies skill workflows** for migrations, deployments, test sweeps (3 skills)
5. **Generates `AGENTS.md`** with patterns for your tech stack
6. **Generates `.github/copilot-instructions.md`** with stack-specific conventions
7. **Copies shared instruction files** (git-workflow, architecture principles)
8. **Copies the core plan docs** to `docs/plans/`
9. **Creates `.plan-hardening.json`** with your build/test commands for reference

**Agent mode**: Pass `-AutoDetect` (PowerShell) or `--auto-detect` (Bash) to auto-detect the tech stack from project marker files (`.csproj`, `package.json`, `pyproject.toml`, etc.).

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
