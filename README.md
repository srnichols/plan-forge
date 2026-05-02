# Plan Forge

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/plan-forge-logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/plan-forge-logo-light.svg">
  <img alt="Plan Forge" src="docs/assets/plan-forge-logo-light.svg" width="400">
</picture>

## The AI-Native SDLC Forge Shop

> **A blacksmith doesn't hand raw iron to a customer. They smelt it, hammer it, temper it — and then they watch, because a blade that isn't maintained will dull.**
>
> Plan Forge is a **full-lifecycle AI development shop**. Raw ideas are **smelted** through the Crucible into structured plans. Plans are **forged** into working code through a 7-step hardened pipeline. Shipped code is **guarded** by LiveGuard — drift, secrets, dependencies, incidents, all watched in real time. And every finding is **learned** back into the shop's memory, so the next run starts smarter than the last.
>
> *Smelt the idea. Forge the code. Guard the build. Learn from every run.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Website](https://planforge.software/)** · **[Shop Tour](https://planforge.software/shop-tour.html)** · **[Manual](https://planforge.software/manual/)** · **[Documentation](https://planforge.software/docs.html)** · **[FAQ](https://planforge.software/faq.html)** · **[Extensions](https://planforge.software/extensions.html)** · **[Spec Kit Interop](https://planforge.software/speckit-interop.html)**

```
69 MCP Tools · 45+ CLI Commands · 14 Agents · 15 Skills · 9 Presets · 7 Adapters · 3285 Tests · v2.80.0
```

---

## The Four Stations

Plan Forge is one shop with four stations. Each one handles a distinct part of the software lifecycle — and they all share one memory.

| Station | Verb | What happens here | Start with |
|---------|------|------------------|-----------|
| 🪨 **Smelt** | *Smelt the idea* | Rough idea → Crucible interview → tempered plan with scope contract and validation gates. | [Crucible](docs/manual/crucible.html) · [Tempering design notes](docs/plans/tempering-design-notes.md) |
| 🔨 **Forge** | *Forge the code* | Hardened plan → DAG-scheduled execution → quorum consensus → shipped code. The classic 7-step pipeline. | [Your First Plan](docs/manual/your-first-plan.html) · [AI Plan Hardening Runbook](docs/plans/AI-Plan-Hardening-Runbook.md) |
| 🛡️ **Guard** | *Guard the build* | Shipped code → drift scoring, secret scan, dep watch, regression guard, incident capture, remote alerts. | [What is LiveGuard?](docs/manual/what-is-liveguard.html) · [LiveGuard Tools](docs/manual/liveguard-tools.html) |
| 🧠 **Learn** | *Learn from every run* | Findings → OpenBrain memory → Health DNA → self-tuned escalation, cost, and quorum thresholds. | [Memory Architecture](docs/manual/memory-architecture.html) · [Bug Registry + Testbed](docs/capabilities.md) |

And the **control room** that ties them together: the [live dashboard](docs/manual/dashboard.html) at `localhost:3100/dashboard` with 25 tabs, session replay, WebSocket event hub, cost reports, OTLP traces, and a remote bridge for Telegram / Slack / Discord / OpenClaw.

---

## Start Here

| You are... | Start with |
|------------|------------|
| **Evaluating Plan Forge** | Read [the Shop Tour](https://planforge.software/shop-tour.html) → Skim [capabilities](docs/capabilities.md) |
| **A developer using VS Code + Copilot** | Run [Quick Start](#quick-start) → Read [COPILOT-VSCODE-GUIDE.md](docs/COPILOT-VSCODE-GUIDE.md) |
| **An AI agent setting up a project** | Read [AGENT-SETUP.md](AGENT-SETUP.md) (your entry point) |
| **Already shipping and want the watch layer** | Jump to [LiveGuard](docs/manual/what-is-liveguard.html) — runs standalone on any codebase |
| **Just browsing** | Keep reading — or visit [planforge.software](https://planforge.software/) |

---

## Verified Results

**Verified**: 38+ phases self-built, 3285 self-tests, 69 MCP tools, zero manual rollbacks. See [docs/capabilities.md](docs/capabilities.md).

### A/B Test Results (April 2026)

Same app, same model (Claude Opus 4.6), same time (~7 min). Only difference: Run A had Plan Forge.

| Metric | Plan Forge | Vibe Coding |
|--------|-----------|-------------|
| **Tests** | **60** | 13 |
| **Interfaces** | **6** | 0 |
| **DTOs** | **9** | 0 |
| **Quality Score** | **99/100** | **44/100** |

[Read the full results →](https://planforge.software/blog/ab-test-plan-forge-vs-vibe-coding.html)

---

## How the Stations Work Together

The four stations form a closed loop: **Smelt** intake → **Forge** builds → **Guard** watches → **Learn** captures findings into memory → next **Smelt** starts smarter. Inside the Forge, a deterministic slice executor runs the plan; a reflective inner loop — retries with reflexion context, trajectory capture, auto-skill promotion, and postmortems — turns every slice into a research step that teaches the next one. Together, the ten opt-in inner-loop subsystems compose into a self-deterministic agent loop that keeps execution reproducible while the loop's context improves each pass.

For architecture diagrams, the 7-step pipeline mermaid, the LiveGuard cycle, and the self-improving feedback loops, see **[the Shop Tour](https://planforge.software/shop-tour.html)** and the [interactive manual](https://planforge.software/manual/).

---

## Quick Start

### Prerequisites

- **VS Code** with **GitHub Copilot** (free, Pro, or Enterprise)
- **Git** installed

### 1. Clone and Run Setup

```bash
git clone https://github.com/srnichols/plan-forge.git my-project-plans
cd my-project-plans
```

```powershell
# Windows (PowerShell)
.\setup.ps1 -Preset dotnet          # or: typescript, python, java, go, swift, rust, php, azure-iac

# Mac / Linux
./setup.sh --preset dotnet
```

Setup copies all framework files, installs MCP dependencies, and generates config. Zero manual steps.

### 2. Start Planning

1. Open VS Code → Copilot Chat → **Agent Mode**
2. Describe your feature → the pipeline guides you through 7 steps
3. LiveGuard watches automatically after you ship

See [docs/CLI-GUIDE.md](docs/CLI-GUIDE.md) for all presets, flags, and multi-agent options.

---

## What's Included

### 9 Tech-Stack Presets

| Preset | Stack | Preset | Stack |
|--------|-------|--------|-------|
| `dotnet` | .NET / C# / ASP.NET Core | `swift` | Swift / SwiftUI / Vapor |
| `typescript` | TypeScript / React / Node | `rust` | Rust / Axum / Tokio |
| `python` | Python / FastAPI / Django | `php` | PHP / Laravel / Symfony |
| `java` | Java / Spring Boot | `azure-iac` | Bicep / Terraform / azd |
| `go` | Go / Chi / Gin | | |

### 7 AI Agent Adapters

One setup command, every tool: `setup.ps1 -Agent all`

GitHub Copilot (primary) · Claude Code · Cursor · Codex CLI · Gemini CLI · Windsurf · Generic

### MCP Server (69 Tools)

`pforge-mcp/server.mjs` exposes core, LiveGuard, Watcher, Crucible, Tempering, Bug Registry, Testbed, and Forge-Master operations. Live dashboard at `localhost:3100/dashboard`. REST API for external integrations.

Key tools: `forge_run_plan` · `forge_liveguard_run` · `forge_analyze` · `forge_master_ask` · `forge_capabilities` · `forge_smith` · `forge_cost_report`

### Optional Capabilities

| Feature | How to Enable | What It Does |
|---------|--------------|-------------|
| **Quorum mode** | Automatic (complexity ≥ 6) | 3 models analyze in parallel, reviewer synthesizes. Self-tuning threshold. |
| **Audit Loop** | `pforge audit-loop` or `.forge.json#audit` | Closed-loop drain: content-audit scanner → triage → fix. Default off; opt-in via `audit.mode: "auto"` or `"always"`. |
| **Auto-escalation** | Built-in | Model fails → auto-promotes. Chain reorders by success rate. |
| **Cost tracking** | Built-in | Per-slice tokens, 23-model pricing, `--estimate` with historical calibration. |
| **OpenBrain memory** | Configure MCP endpoint | 13 tools auto-capture findings. 4 prompts search before acting. |
| **Extensions** | `pforge ext add <name>` | HIPAA, SaaS multi-tenancy, etc. |
| **CI validation** | `srnichols/plan-forge-validate@v1` | GitHub Action for plan quality gates. |
| **Notifications** | Configure in `.forge.json` | Slack, Discord, Telegram, webhooks via bridge. |
| **Spec Kit bridge** | Auto-detected | Import specs + constitution from Spec Kit projects. |

---

## Documentation

| Resource | Purpose |
|----------|---------|
| **[docs/COPILOT-VSCODE-GUIDE.md](docs/COPILOT-VSCODE-GUIDE.md)** | VS Code + Copilot walkthrough |
| **[docs/CLI-GUIDE.md](docs/CLI-GUIDE.md)** | `pforge` CLI reference |
| **[docs/capabilities.md](docs/capabilities.md)** | Full feature reference — all 69 tools, 14 agents, 15 skills |
| **[CUSTOMIZATION.md](CUSTOMIZATION.md)** | Adapt guardrails for your project |
| **[planforge.software/manual/](https://planforge.software/manual/)** | Interactive web manual (24 chapters + 6 appendices) |
| **[planforge.software/faq.html](https://planforge.software/faq.html)** | FAQ |
| **[AGENT-SETUP.md](AGENT-SETUP.md)** | AI agent entry point |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md)** | Maintainer guide · release & distribution-sync checklist |

---

## Git Workflow

```bash
git commit -m "<type>(<scope>): <description>"   # feat, fix, refactor, test, docs, chore
```

See [.github/instructions/git-workflow.instructions.md](.github/instructions/git-workflow.instructions.md) for conventions.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For extensions: [extensions/PUBLISHING.md](extensions/PUBLISHING.md). For skills: [docs/SKILL-BLUEPRINT.md](docs/SKILL-BLUEPRINT.md).

---

## License

[MIT](LICENSE) — use these guardrails in your projects, teams, and tools.
