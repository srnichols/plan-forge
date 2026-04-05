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

### v2.2 — Parallel Execution + Team Features ✅

Shipped in v2.0.0. Execute independent slices simultaneously with conflict detection.

- ✅ **`[P]`-tagged slices** execute in parallel via `ParallelScheduler`
- ✅ **Worker pool** — configurable `maxParallelism` (default: 3)
- ✅ **Conflict detection** — overlapping scopes fall back to sequential
- ✅ **Auto-retry** — gate failures re-invoke worker with error context (`maxRetries` config)
- ✅ **Scope isolation** — worker prompts include `SCOPE:` directive to prevent cross-slice file edits
- Team activity feed — deferred to v3.0

### v2.3 — Machine-Readable API Surface

Give AI agents instant understanding of Plan Forge capabilities without parsing Markdown docs.

- **`pforge-mcp/tools.json`** — auto-generated from MCP `TOOLS` array. All 13 tools with name, description, input schema, examples. Agents load one file instead of reading CLI-GUIDE.md.
- **`pforge-mcp/cli-schema.json`** — every CLI command with args, flags, types, defaults, examples. Machine-parseable alternative to `pforge help`.
- **Auto-generation** — `tools.json` regenerated on server startup from the live `TOOLS` definition (always in sync)
- **Agent discovery** — agents check for `pforge-mcp/tools.json` on session start; if present, skip doc parsing

### v2.4 — Unified Telemetry

OpenTelemetry-compatible structured logging across the entire system for end-to-end observability. Built-in trace viewer in the dashboard — no external tools required.

- **Trace context** — every `runPlan()` gets a `trace_id`; every slice gets a `span_id` correlated to the parent run
- **Structured log format** — OTLP-compatible JSON emitted to `.forge/runs/<timestamp>/trace.json`
- **Event correlation** — orchestrator events, worker stdout, gate results, and cost data all linked by span
- **Optional collector forwarding** — if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, forward to Jaeger / Aspire Dashboard / Grafana
- **Metrics** — tokens/sec, cost/slice, gate pass rate, retry rate exported as OTLP metrics

**Built-In Trace Viewer** (dashboard "Traces" tab at `localhost:3100/dashboard`):
- **Waterfall timeline** — horizontal bars showing span duration per slice (like Chrome DevTools Network tab)
- **Parallel lane rendering** — `[P]`-tagged slices shown side-by-side with dependency arrows
- **Span detail panel** — click any span to see logs, tokens, cost, gate results, retry attempts
- **Log stream** — filterable by level (info/warn/error), searchable by keyword
- **REST API** — `GET /api/traces` (list runs), `GET /api/traces/:runId` (single run detail)
- Zero external dependencies — vanilla JS canvas rendering, reads `.forge/runs/*/trace.json`

**Trace JSON format** (simplified OTLP):
```json
{
  "traceId": "abc123",
  "spans": [
    {
      "spanId": "s1", "parentSpanId": null, "name": "run-plan",
      "startTime": "...", "endTime": "...", "status": "completed",
      "attributes": { "plan": "Phase-1", "slices": 4, "mode": "auto" }
    },
    {
      "spanId": "s2", "parentSpanId": "s1", "name": "slice-1",
      "startTime": "...", "endTime": "...", "status": "passed",
      "attributes": { "model": "gpt-5-mini", "tokens_out": 4200, "cost_usd": 0.12, "attempts": 2 },
      "events": [
        { "time": "...", "name": "worker-spawned", "attributes": { "cmd": "gh copilot" } },
        { "time": "...", "name": "gate-failed", "attributes": { "error": "CS1513" } },
        { "time": "...", "name": "retry", "attributes": { "attempt": 2 } },
        { "time": "...", "name": "gate-passed" }
      ]
    }
  ]
}
```

Example rendered trace:
```
Trace: run-plan (trace_id: abc123, plan: Phase-1-CLIENTS-CRUD)
  ├─ Span: slice-1 [P] (467s, passed, gpt-5-mini, $0.12, 2 attempts)
  │    ├─ Log: worker spawned (gh-copilot --model gpt-5-mini)
  │    ├─ Log: file created: ClientsController.cs
  │    ├─ Log: gate: dotnet build → failed (CS1513)
  │    ├─ Log: retry: re-invoked with error context
  │    └─ Log: gate: dotnet build → passed
  ├─ Span: slice-2 [P] (320s, passed, claude-sonnet-4.6, $0.08)
  ├─ Span: slice-3 (319s, passed, depends: slice-2)
  └─ Span: slice-4 (180s, passed, depends: slice-1+3)
```

**Log Registry** (central discovery for all log sources):
- **Per-run manifest** — `.forge/runs/<timestamp>/manifest.json` lists every artifact (run.json, summary.json, trace.json, slice-N.json, slice-N-log.txt) with status and format. Dashboard reads this instead of guessing file names.
- **Global index** — `.forge/runs/index.jsonl` is an append-only file (one JSON entry per line per run). REST `/api/traces` reads this for instant run listing — no directory scanning.
- **Auto-registration** — orchestrator writes manifest as last step of each run, appends to index. New log sources (e.g., trace.json) just add a manifest entry — dashboard auto-discovers.
- **Query flow** — `GET /api/traces` reads `index.jsonl` → returns run list. `GET /api/traces/:runId` reads `manifest.json` → returns artifact map. Dashboard fetches specific files by name from manifest.

**Multi-Agent Concurrency** (safe concurrent runs):
- **`runId` on all events** — hub broadcasts include `runId` field so clients filter by active run
- **Append-only cost history** — `cost-history.json` switches from JSON array to JSONL (one entry per line) — safe for concurrent writes, no file locking needed
- **Dashboard run filter** — dropdown to select which run's events to display when multiple runs are active
- **Trace isolation** — each `trace.json` is per-run directory, no cross-contamination between concurrent executions
- **Shared resource safety** — `events.log` scoped per run directory (already isolated); `server-ports.json` uses atomic write

### v2.5 — OpenClaw Bridge

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
