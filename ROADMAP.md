# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v2.0.0** (2026-04-04) — Autonomous Execution: DAG orchestrator, cost tracking, WebSocket hub, dashboard, parallel execution.

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

---

## Shipped in v2.0.0

These features shipped alongside the v2.0 autonomous execution release:

- **`pforge smith`** — forge-themed diagnostics: environment, VS Code config, setup health, version currency, common problems (PS + Bash)
- **GitHub Action** (`srnichols/plan-forge-validate@v1`) — CI plan validation with 6 checks, configurable sweep, action outputs
- **Multi-agent support** — `-Agent claude|cursor|codex|all` generates rich native files:
  - Claude Code: `CLAUDE.md` with all 16 guardrails embedded + `.claude/skills/` (all prompts + all 19 reviewer agents)
  - Cursor: `.cursor/rules` with guardrails + `.cursor/commands/` (all prompts + all agents)
  - Codex CLI: `.agents/skills/` (all prompts + all agents)
  - Smart guardrail instructions emulate Copilot's auto-loading, post-edit scanning, and forbidden path checking
- **Extension ecosystem** — `pforge ext search/add/info` with `extensions/catalog.json` (Spec Kit catalog-compatible)
- **Spec Kit bridge** — Step 0 auto-detects Spec Kit artifacts, Project Principles Path D imports constitution, shared extension format
- **Spec Kit interop page** — `docs/speckit-interop.html` with combined workflow and artifact mapping
- **Feature parity table** — agent-by-agent comparison on `index.html`

---

## Planned

### v1.4 — MCP Server (Plan Forge as a Tool)

Expose Plan Forge operations as MCP tools so any agent with MCP support can invoke them as function calls — not just read prompt files.

- **`plan-forge-mcp` server** — lightweight MCP server (Node.js or Python) exposing:
  - `forge_smith` — run diagnostics, return structured JSON results
  - `forge_validate` — run setup validation, return pass/fail/warnings
  - `forge_sweep` — completeness sweep, return marker locations
  - `forge_status` — read roadmap phases, return structured status
  - `forge_diff` — scope drift check against active plan
  - `forge_ext_search` — search extension catalog, return matches
- **MCP config generation** — setup.ps1/sh generates `.vscode/mcp.json` (Copilot) and `.claude/mcp.json` (Claude) entries
- **Self-hosted** — runs locally alongside the project, zero cloud dependencies
- **Composable with OpenBrain** — if both MCP servers are configured, agents get Plan Forge operations + persistent memory in one session

### v1.5 — Cross-Artifact Analysis

~~Validate consistency across the full spec → plan → code → test chain.~~

**Shipped**: `pforge analyze <plan>` — consistency scoring with 4 dimensions (traceability, coverage, test coverage, gates). MCP tool `forge_analyze`. GitHub Action `analyze` input.

### v1.6 — Intelligence Layer

~~Data-driven pipeline optimization from historical execution data.~~

Merged into v2.0–v2.1 — token tracking, cost estimation, and historical metrics are built into the orchestrator and dashboard rather than standalone CLI features.

- ~~Token usage estimation per slice~~ → v2.0 logs actual tokens per slice during `forge_run_plan`
- ~~Plan complexity scoring~~ → v2.0 auto-recommends pipeline depth from plan structure
- ~~Historical metrics~~ → v2.1 dashboard run history + trend charts
- ~~Slice duration estimation~~ → v2.1 dashboard shows actual + predicted durations

---

## v2.x — Autonomous Execution (Feature Branch: `feature/v2.0-autonomous-execution`)

> **Vision**: "Kick it off and let the system run." One command executes an entire hardened plan — spawning worker sessions, routing to optimal models, validating at every boundary, and reporting back. Everything from v1.x still works — this layers automation on top.

### v2.0 — `forge_run_plan` (DAG-Based Orchestration) 🚧

Built on the existing `pforge-mcp/server.mjs` Node.js process — no new services.

- ✅ **CLI Spawning Spike** — `gh copilot` CLI confirmed as primary worker (non-interactive, context-aware, multi-model)
- ✅ **DAG-based orchestration engine** (`pforge-mcp/orchestrator.mjs`) — plan parser, topological sort, pluggable scheduler, event emitter (DI)
- ✅ **`forge_run_plan <plan>`** MCP tool + `pforge run-plan <plan>` CLI command
- ✅ **Two execution modes**: Full Auto (`gh copilot` with any model) and Assisted (human + automated gates)
- ✅ **Model routing config** in `.forge.json` — specify model per step type
- ✅ **File-based status** — `.forge/runs/<timestamp>/` with per-slice results, session logs, tokens
- ✅ **Validation gates enforced** — build + test must pass at each slice boundary
- ✅ **Abort/status** — `forge_abort` to stop, `forge_plan_status` for progress
- ✅ **Token tracking** — parsed from JSONL output, logged per slice/model
- ✅ **Cost estimation** — `--estimate` flag predicts tokens and cost before running
- ✅ **Auto-sweep + auto-analyze** — runs after all slices pass, scores in summary
- ✅ **`.forge/SCHEMA.md`** — documents all `.forge/` files

### v2.1 — WebSocket Hub + Dashboard (Real-Time Communication)

Add lightweight inter-session communication and a visual monitoring UI to the MCP server.

**Infrastructure:**
- **WebSocket server** (`ws` package) embedded in `pforge-mcp/server.mjs` — no separate service
- **Event bus** — sessions publish events (`slice-complete`, `build-failed`, `review-passed`)
- **Session registry** — tracks active workers, their model, slice assignment, status
- **`forge_plan_status`** MCP tool — live progress view from any connected session

**Dashboard Core** (`pforge-mcp/dashboard/` — lightweight HTML + JS, served at `localhost:3100/dashboard`):
- Real-time slice progress cards (pending → executing → pass/fail)
- Model routing visualization (which model is running which slice)
- Consistency score after completion
- OpenBrain thought count per run
- Event log with timestamps
- Abort/retry controls
- Accessible on any device (phone via Tailscale, browser, etc.)

**Dashboard Features:**
- **Multi-project overview** — see all Plan Forge projects at a glance (reads `.forge.json` per repo)
- **Phase timeline** — visual Gantt-style view of phases from `DEPLOYMENT-ROADMAP.md`
- **Run history + trend charts** — consistency scores, slice durations, and sweep results over time
- **OpenBrain memory explorer** — browse captured decisions, search by project/phase/type, see most-referenced thoughts
- **Quick actions panel** — one-click buttons for smith, analyze, sweep, new-phase, ext search (calls MCP tools)
- **Cost tracker** — token usage per slice/phase/project by model, monthly spend summary
- **Diff viewer** — visual plan-vs-code traceability (requirement → implementing file → test file)
- **Session replay** — stored agent session logs per slice; replay what the agent read, decided, and changed
- **Extension marketplace UI** — visual catalog browser with cards, descriptions, install buttons
- **Notifications center** — bell icon with run completions, sweep warnings, review findings (persists across reloads)
- **Config editor** — visual editor for `.forge.json` (preset, agents, model routing, extensions)

### v2.2 — Parallel Execution + Team Features

Execute independent slices simultaneously and support multi-developer coordination.

- **`[P]`-tagged slices** in hardened plans execute in parallel (already part of plan format)
- **Worker pool** — configurable max parallelism (default: 3 concurrent sessions)
- **Merge checkpoints** — parallel branches converge at defined sync points
- **Conflict detection** — warn if parallel slices touch overlapping files
- **Team activity feed** — see who's working on what phase, who's running what (multi-user dashboard)

### v2.3 — OpenClaw Bridge

Connect autonomous execution to the unified system architecture.

- **Trigger from anywhere** — Slack, WhatsApp, Telegram, Discord, phone, terminal
- **Progress notifications** — "Slice 3 of 8 complete. Build passed. Score: 91."
- **Approval gates** — "Phase 7 ready to ship. Approve?" → reply "yes" from Telegram or Slack
- **OpenBrain context** — orchestrator loads full project history before spawning workers

### v3.0 — Multi-Agent Orchestration

Full autonomous development system.

- **Agent-per-slice routing** — different AI models for different slice types based on learned performance data
- **Auto-escalation** — if a slice fails 3x on Codex, re-route to Claude automatically
- **CI/CD integration** — orchestrator triggers GitHub Actions, waits for green, proceeds
- **Team mode** — multiple orchestrators coordinate across developers, avoiding merge conflicts
- **Cost optimization** — historical data drives model selection for best quality/cost ratio

---

## Backlog

These are planned but not yet prioritized into a version:

### Stack Expansion
- Rust preset (`presets/rust/`)
- PHP / Laravel preset (`presets/php/`)
- Swift / iOS preset (`presets/swift/`)

### Agent Expansion
- Gemini CLI adapter (requires TOML format — different from Markdown adapters)
- Windsurf adapter
- Generic bring-your-own-agent pattern (`--agent generic --commands-dir <path>`)

### Extension Ecosystem
- Dual-publish extensions to Spec Kit catalog
- Extension website or registry for discoverability
- Auto-update notification when source version is newer

### Enterprise
- **`/security-audit` skill** — multi-step security procedure: run security reviewer across all files, dependency audit, secrets scan, produce combined security report with severity ratings
- **Team dashboard** for multi-developer plan coordination
- **Web UI** for plan visualization and status tracking
- Preset-specific validation minimum count checks in `validate-setup`

---

## Under Consideration

No committed timeline — evaluating based on community feedback:

- **Community walkthroughs** — greenfield and brownfield worked examples (demos like Spec Kit's repos)
- **`specify init` detection** — auto-detect Spec Kit project and layer Plan Forge guardrails on top
- ~~**Multi-model prompt variants** — GPT-4, Gemini-specific prompt tuning documentation~~ → shipped as "Tuning for Different Models" section in CUSTOMIZATION.md

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
