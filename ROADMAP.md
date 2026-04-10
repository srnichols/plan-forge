# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v2.17.0** (2026-04-07) — Platform Completion & Setup Hardening: nested subagent pipeline with termination guards across all 5 pipeline agent templates, `chat.subagents.allowInvocationsFromSubagents` VS Code setting, status-reporting instruction file with 7 standard output templates.

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

### v1.4 — MCP Server (Plan Forge as a Tool) ✅

Shipped in v2.0.0. 17+ MCP tools, `.vscode/mcp.json` auto-generation, composable with OpenBrain.

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

## v2.x — Autonomous Execution

> **Vision**: "Kick it off and let the system run." One command executes an entire hardened plan — spawning worker sessions, routing to optimal models, validating at every boundary, and reporting back. Everything from v1.x still works — this layers automation on top.

### v2.0 — `forge_run_plan` (DAG-Based Orchestration) ✅

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

### v2.3 — Machine-Readable API Surface ✅

Shipped. 14 MCP tools with full agent discoverability.

**Core Schema Files:**
- **`pforge-mcp/tools.json`** — auto-generated from MCP `TOOLS` array on server startup (always in sync). All 14+ tools with name, description, input schema, examples, and expected output shape.
- **`pforge-mcp/cli-schema.json`** — every CLI command with args, flags, types, defaults, examples. Machine-parseable alternative to `pforge help`.

**Dynamic Capability Discovery:**
- **`forge_capabilities` MCP tool** — single call returns the full capability surface: MCP tools, CLI commands, dashboard URL + tabs, config options, installed extensions. Agents call this once on session start instead of reading multiple files.
- **`.well-known` HTTP endpoint** — `GET http://localhost:3100/.well-known/plan-forge.json` serves the same capability surface over HTTP for non-MCP clients (dashboards, CI tools, external integrations).

**Semantic Agent Hints** (on every tool definition):
- **Intent tags** — `"intent": ["execute", "automate"]` tells agents *when* to use a tool (do vs read vs configure)
- **Prerequisites** — `"prerequisites": ["plan file exists", "gh copilot CLI installed"]` lets agents pre-check before calling
- **Produces / Consumes** — `"produces": [".forge/runs/*/summary.json"]`, `"consumes": ["docs/plans/*.md"]` for data flow understanding
- **Side effects** — `"sideEffects": ["creates source files", "runs build commands"]` prevents unintended invocation
- **Cost hint** — `"cost": "high"` (tokens + time) vs `"cost": "low"` (read-only, instant) prevents casual use of expensive tools

**Workflow Graphs** (tool chaining):
```json
{
  "workflows": {
    "execute-plan": {
      "steps": [
        { "tool": "forge_run_plan", "args": { "estimate": true }, "decision": "Review cost" },
        { "tool": "forge_run_plan", "args": { "estimate": false } },
        { "tool": "forge_plan_status" },
        { "tool": "forge_cost_report" }
      ]
    },
    "diagnose-project": {
      "steps": ["forge_smith", "forge_validate", "forge_sweep"]
    }
  }
}
```

**Error Catalog** (per tool):
- Structured error codes with recovery hints: `"PLAN_NOT_FOUND"` → "Check path or run `forge_status`", `"NO_WORKER"` → "Install gh copilot or use `--assisted`", `"GATE_FAILED"` → "Fix code, use `--resume-from N`"
- Agents self-heal instead of reporting generic failures

**Configuration Discovery:**
- `.forge.json` JSON Schema included in capability surface — valid fields, types, enums, defaults
- Agents know `modelRouting.default` accepts `["auto", "claude-sonnet-4.6", "gpt-5.2-codex", ...]` without reading docs

**Operational Metadata:**
- **Version compatibility** — `"schemaVersion": "2.3"`, `"serverVersion": "2.0.0"`, per-tool `"addedIn": "2.0.0"` for mismatch detection
- **Deprecation signals** — `"deprecated": true, "replacedBy": "forge_new_tool"` for graceful agent migration
- **Rate limit hints** — `"maxConcurrent": 1` for `forge_run_plan` (one at a time), `"maxConcurrent": 10` for read-only tools
- **Operation ID aliases** — `forge_run_plan` also discoverable as `"aliases": ["execute-plan", "run-plan"]` for natural language matching

### v2.4 — Unified Telemetry ✅

Shipped. OTLP-compatible traces, log registry, dashboard Traces tab.

**Core Trace Infrastructure:**
- **Trace context** — every `runPlan()` gets a `trace_id`; every slice gets a `span_id` correlated to the parent run
- **Structured log format** — OTLP-compatible JSON emitted to `.forge/runs/<timestamp>/trace.json`
- **Resource context** — trace root includes `service.name`, `service.version`, `host.name`, `os.type`, `project.name`, `user.name` (from git config) for multi-machine identification
- **Span kinds** — `SERVER` (run-plan), `INTERNAL` (slice orchestration), `CLIENT` (worker spawn, gate execution) for correct trace viewer rendering
- **Severity levels** — all events include `severity` (TRACE/DEBUG/INFO/WARN/ERROR/FATAL) and `severityNumber` per OTLP convention for filtering
- **Gates as child spans** — gate commands modeled as `CLIENT` child spans of slice spans (not just events) for waterfall timing visibility
- **Worker output summary** — first 50 lines or pattern-matched lines (created/modified/error) embedded in trace; full log in `slice-N-log.txt`, lazy-loaded on click
- **Event correlation** — orchestrator events, worker stdout, gate results, and cost data all linked by span
- **Optional collector forwarding** — if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, forward to Jaeger / Aspire Dashboard / Grafana
- **Metrics as derived views** — tokens/sec, cost/slice, gate pass rate, retry rate computed at query time from `index.jsonl` + `summary.json` (no separate metrics file, single source of truth). Cache with TTL if performance matters.

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
  "resource": {
    "service.name": "plan-forge-orchestrator",
    "service.version": "2.0.0",
    "host.name": "SCOTT-PC",
    "os.type": "windows",
    "project.name": "TimeTracker",
    "user.name": "scott"
  },
  "traceId": "abc123",
  "spans": [
    {
      "spanId": "s1", "parentSpanId": null, "name": "run-plan",
      "kind": "SERVER",
      "startTime": "...", "endTime": "...", "status": "completed",
      "attributes": { "plan": "Phase-1", "slices": 4, "mode": "auto" }
    },
    {
      "spanId": "s2", "parentSpanId": "s1", "name": "slice-1",
      "kind": "INTERNAL",
      "startTime": "...", "endTime": "...", "status": "passed",
      "attributes": { "model": "gpt-5-mini", "tokens_out": 4200, "cost_usd": 0.12, "attempts": 2 },
      "events": [
        { "time": "...", "name": "worker-spawned", "severity": "INFO", "severityNumber": 9, "attributes": { "cmd": "gh copilot" } },
        { "time": "...", "name": "gate-failed", "severity": "ERROR", "severityNumber": 17, "attributes": { "error": "CS1513" } },
        { "time": "...", "name": "retry", "severity": "WARN", "severityNumber": 13, "attributes": { "attempt": 2 } },
        { "time": "...", "name": "gate-passed", "severity": "INFO", "severityNumber": 9 }
      ],
      "logSummary": ["created: ClientsController.cs", "modified: Program.cs"]
    },
    {
      "spanId": "s2-gate-1", "parentSpanId": "s2", "name": "gate: dotnet build",
      "kind": "CLIENT",
      "startTime": "...", "endTime": "...", "status": "ERROR"
    },
    {
      "spanId": "s2-gate-2", "parentSpanId": "s2", "name": "gate: dotnet test",
      "kind": "CLIENT",
      "startTime": "...", "endTime": "...", "status": "OK"
    }
  ]
}
```

Example rendered trace:
```
Trace: run-plan (trace_id: abc123, plan: Phase-1-CLIENTS-CRUD)
  ├─ Span: slice-1 [P] INTERNAL (467s, 2 attempts)
  │    ├─ Span: worker CLIENT (gh-copilot --model gpt-5-mini, 420s)
  │    │    ├─ INFO: file created: ClientsController.cs
  │    │    └─ INFO: file modified: Program.cs
  │    ├─ Span: gate CLIENT (dotnet build, 12s) → ERROR CS1513
  │    ├─ WARN: retry attempt 2
  │    ├─ Span: worker CLIENT (attempt 2, 390s)
  │    ├─ Span: gate CLIENT (dotnet build, 10s) → OK
  │    └─ Span: gate CLIENT (dotnet test, 25s) → OK
  ├─ Span: slice-2 [P] INTERNAL (320s, claude-sonnet-4.6, $0.08)
  ├─ Span: slice-3 INTERNAL (319s, depends: slice-2)
  └─ Span: slice-4 INTERNAL (180s, depends: slice-1+3)
```

**File Architecture:**
```
.forge/runs/
├── index.jsonl                          ← append-only global index (1 line per run)
├── 2026-04-04T20-37-07_Phase-1/
│   ├── manifest.json                    ← artifact registry for this run
│   ├── trace.json                       ← OTLP trace (resource + spans + events)
│   │   ├── resource {}                  ← service, host, project, user
│   │   └── spans []
│   │       ├── run-plan (SERVER, root)
│   │       ├── slice-1 (INTERNAL)
│   │       │   ├── worker (CLIENT)
│   │       │   ├── gate: dotnet build (CLIENT)
│   │       │   └── gate: dotnet test (CLIENT)
│   │       └── slice-2 (INTERNAL)
│   ├── run.json                         ← run metadata
│   ├── summary.json                     ← aggregate results + cost
│   ├── events.log                       ← raw event stream
│   ├── slice-1.json                     ← per-slice result
│   ├── slice-1-log.txt                  ← full worker stdout/stderr
│   └── slice-2.json
└── 2026-04-04T14-22-00_Phase-2/
    └── ...
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

**Operational:**
- **Index corruption recovery** — `index.jsonl` reader skips malformed lines (`try/catch` per line). Periodic compaction rewrites index from actual directory contents.
- **Log rotation** — `maxRunHistory` config in `.forge.json` (default: 50). On run completion, prune oldest directories beyond the limit. Index reader ignores entries whose directory no longer exists.
- **Baggage propagation** — trace context (traceId, parentSpanId) passed to child spans so gate commands, worker output, and retries are all correlated in the waterfall.

### v2.5 — Quorum Mode (Multi-Model Consensus) ✅

Shipped. Dispatches high-complexity slices to multiple AI models in parallel dry-run, synthesizes a consensus execution plan, then executes with higher confidence.

- **Quorum dispatch** — fan out each slice to 3 models (Claude Opus 4.6, GPT-5.3-Codex, Gemini 3.1 Pro) in parallel dry-run sessions
- **Dry-run mode** — workers produce detailed implementation plans (files, code skeletons, edge cases, test strategy) without executing
- **Quorum reviewer** — synthesis agent merges 3 dry-run responses into a unified execution plan, picking best approach per file/component
- **Complexity scoring** — `scoreSliceComplexity()` scores slices 1-10 based on file count, cross-module deps, security sensitivity, historical failure rate
- **`quorum-mode=auto`** — slices scoring ≥6 automatically use quorum; others run normally (configurable threshold)
- **Full guardrail compliance** — dry-run workers load all instructions.md, project profile, and principles (same as primary workers)
- **Telemetry integration** — quorum legs modeled as child spans in trace.json; cost tracked per-leg
- **Dashboard indicators** — quorum status visible on Progress tab; dry-run responses browsable in Replay tab
- **Configuration** — `.forge.json` `quorum` block: `enabled`, `auto`, `threshold`, `models[]`, `reviewerModel`

### v2.6 — OpenClaw Bridge ✅

Shipped in v2.10.0. Telegram/Slack/Discord webhook notifications, approval gate state machine, 4 platform formatters, REST endpoints.
- **OpenBrain context** — orchestrator loads full project history before spawning workers

### v3.0 — Multi-Agent Orchestration ✅

Full autonomous development system. Most features shipped across v2.12–v2.13.

- ✅ **Agent-per-slice routing** — different AI models for different slice types based on learned performance data (v2.13.0)
- ✅ **Auto-escalation** — if a slice fails 3x on one model, re-routes to next in escalation chain (v2.12.0)
- ✅ **CI/CD integration** — orchestrator triggers GitHub Actions, waits for green, proceeds (v2.12.0)
- ✅ **Cost optimization** — historical data in `model-performance.json` drives model selection for best quality/cost ratio (v2.13.0)
- Team mode — deferred to v3.1

### v3.1 — Team Mode

Coordinate multiple orchestrators across developers.

- **Team mode** — multiple orchestrators coordinate across developers, avoiding merge conflicts
- **Team activity feed** — real-time cross-developer plan progress (deferred from v2.2)
- **Team dashboard** — multi-developer plan coordination UI (deferred from Enterprise backlog)

---

## v2.14 — Copilot Platform Integration

> **Research date**: 2026-04-06  
> **Sources**: VS Code 1.113–1.114 release notes, GitHub Copilot Changelog (March–April 2026), Copilot SDK public preview announcement, Copilot cloud agent updates, Org Custom Instructions GA  
> **Goal**: Leverage new Copilot platform capabilities to make Plan Forge a first-class citizen of the native Copilot ecosystem rather than a bolt-on layer. Ordered by effort/impact ratio — low-hanging fruit and biggest-bang items first.

### Phase A — Quick Wins (< 1 day each)

#### A1. One-Click Plugin Install Link on Website ✅

**Source**: VS Code 1.113 — URL handlers for plugin installation  
**Effort**: Trivial — one HTML link  
**Impact**: Eliminates 3-step manual install; visitors go from website → installed in one click

Add `vscode://chat-plugin/install?source=srnichols/plan-forge` and `vscode-insiders://chat-plugin/install?source=srnichols/plan-forge` buttons to `docs/index.html`, `docs/docs.html`, and `AGENT-SETUP.md`. Plan Forge already has a valid `plugin.json` — this just surfaces a URL handler that VS Code 1.113+ supports natively.

**Acceptance criteria**:
- Stable + Insiders install buttons on the website hero section
- `AGENT-SETUP.md` Quick Start includes the URL handler as preferred install method
- Fallback text for VS Code < 1.113 ("or run `Install Plugin From Source` manually")

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `docs/index.html` | Website / Marketing | Add install buttons to hero CTA section; add "One-Click Install" to feature list |
| `docs/docs.html` | Website / Marketing | Add install button next to "VS Code Plugin" card |
| `docs/capabilities.html` | Website / Reference | Mention URL handler install in setup instructions |
| `AGENT-SETUP.md` | AI-agent entry point | Add URL handler as first install option in Quick Start |
| `README.md` | Human docs | Add install link to Quick Start section |
| `docs/QUICKSTART-WALKTHROUGH.md` | Human docs | Add one-click install as preferred method |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | Mention URL handler in setup section |
| `docs/llms.txt` | AI discovery | Add install URL to entry points |
| `docs/.well-known/plan-forge.json` | AI discovery | Add `install_url` field to `entry_points` |

**Dashboard Sweep**: No dashboard changes needed — this is a website/docs-only feature.

#### A2. Model Deprecation Sweep ✅

**Source**: GitHub Copilot Changelog — GPT-5.1 deprecated (Apr 3), GPT-5.3-Codex LTS (Mar 18), GPT-5.4 GA (Mar 5), GPT-5.4 mini GA (Mar 17), Claude Sonnet 4 deprecation upcoming (Mar 31)  
**Effort**: Small — grep + update defaults  
**Impact**: Prevents users hitting deprecated model errors; keeps pricing table accurate

Audit all files referencing model names and update:
- `.forge.json` defaults and documentation: replace `gpt-5.1` references → `gpt-5.3-codex` (LTS) or `gpt-5.4`
- Quorum mode default models: verify Claude Sonnet 4.6 is still valid; check if Claude Sonnet 4 should be dropped from fallback chains
- `pforge-mcp/orchestrator.mjs` — escalation chain defaults: ensure deprecated models aren't in the default list
- Pricing/cost estimation tables in dashboard and `--estimate` output: update token rates for GPT-5.4 and GPT-5.4 mini
- README "Model Routing" section and any `copilot-instructions.md` template references

**Files to check**: `orchestrator.mjs`, `tools.json`, `README.md`, `CUSTOMIZATION.md`, `docs/capabilities.html`, `docs/faq.html`, dashboard `app.js`, preset `copilot-instructions.md.template`

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `pforge-mcp/orchestrator.mjs` | Source code | Escalation chain defaults, pricing table constants |
| `pforge-mcp/tools.json` | AI discovery | Model names in examples and defaults |
| `README.md` | Human docs | Model Routing section — update default model names, escalation chain example |
| `CUSTOMIZATION.md` | Human docs | `.forge.json` model routing examples, quorum model list |
| `docs/capabilities.md` | Human/AI docs | Agent-Per-Slice Routing table defaults, escalation chain example |
| `docs/capabilities.html` | Website / Reference | Same as capabilities.md (rendered version) |
| `docs/faq.html` | Website / FAQ | Model routing FAQ answer, cost estimation |
| `docs/index.html` | Website / Marketing | Any model names in feature descriptions |
| `pforge-mcp/dashboard/app.js` | Dashboard UI | Cost estimation pricing table, model dropdown options |
| `templates/copilot-instructions.md.template` | Template | MCP server comment mentioning model names |
| `docs/.well-known/plan-forge.json` | AI discovery | `ai_models_supported` count if models added/removed |
| `docs/llms.txt` | AI discovery | Model count if changed |
| `CHANGELOG.md` | Release notes | Document which models deprecated/added |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Cost** tab | `pforge-mcp/dashboard/app.js` → `loadCost()` | Update pricing constants for GPT-5.4, GPT-5.4 mini; remove GPT-5.1 rates |
| **Cost** tab — Model Performance table | `app.js` → Model Comparison section | Update model dropdown options; remove deprecated models from selectors |
| **Config** tab — Model Routing editor | `app.js` → Config Editor section | Update model dropdown/autocomplete to show current models; flag deprecated models with ⚠️ warning |
| **Actions** tab — Estimate panel | `app.js` → `estimateCost()` | Ensure cost estimation uses updated pricing for new default models |
| **Progress** tab — Slice cards | `app.js` → `renderSliceCards()` | Verify model name badges render correctly for new model names (length, truncation) |
| Server-side pricing | `pforge-mcp/orchestrator.mjs` | Update `PRICING` constant object with new model rates |

#### A3. Cloud Agent Integration Guide (`copilot-setup-steps.yml`) ✅

**Source**: GitHub Copilot cloud agent (renamed from "coding agent") now supports configurable setup steps, validation tools, and org-level runner controls (Mar–Apr 2026)  
**Effort**: Small — one YAML template + docs section  
**Impact**: High — makes Plan Forge guardrails apply automatically in every cloud agent session, not just local VS Code

Create a `copilot-setup-steps.yml` template that:
- Installs Node.js (for MCP server)
- Runs `setup.ps1` / `setup.sh` to deploy instruction files
- Configures `.vscode/mcp.json` for the MCP server
- Optionally runs `pforge smith` as a post-setup validation

Add to `docs/COPILOT-VSCODE-GUIDE.md` a new section: **"Using Plan Forge with Copilot Cloud Agent"** explaining:
- How `copilot-setup-steps.yml` works (runs on cloud agent runner before each session)
- How instruction files (.instructions.md) are automatically loaded by the cloud agent
- How Plan Forge's validation gates complement the cloud agent's built-in CodeQL/secret-scanning/code-review validation
- Positioning: "Copilot cloud agent plans. Plan Forge hardens." — cloud agent generates loose plans; Plan Forge converts them into locked execution contracts with scope isolation and forbidden actions

**Acceptance criteria**:
- `copilot-setup-steps.yml` template in `templates/`
- `setup.ps1`/`setup.sh` generate it during setup with `--cloud-agent` flag
- Docs section with step-by-step guide
- Example in `docs/plans/examples/`

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Using Plan Forge with Copilot Cloud Agent" — step-by-step guide |
| `README.md` | Human docs | Add cloud agent mention to Quick Start; add FAQ entry "Does Plan Forge work with Copilot cloud agent?" |
| `AGENT-SETUP.md` | AI-agent entry point | Add cloud agent setup instructions alongside local VS Code setup |
| `docs/index.html` | Website / Marketing | Add "Cloud Agent Ready" badge or feature bullet to hero section |
| `docs/capabilities.html` | Website / Reference | Add cloud agent to Execution Modes table |
| `docs/capabilities.md` | Human/AI docs | Add cloud agent execution mode |
| `docs/faq.html` | Website / FAQ | New FAQ: "How does Plan Forge work with Copilot cloud agent?" |
| `docs/docs.html` | Website / Marketing | Mention `copilot-setup-steps.yml` in setup resources |
| `templates/copilot-instructions.md.template` | Template | Add cloud agent Quick Commands section |
| `docs/llms.txt` | AI discovery | Add cloud agent as supported execution environment |
| `docs/.well-known/plan-forge.json` | AI discovery | Add `cloud_agent` to `ai_agents_supported` or `execution_modes` |
| `setup.ps1` / `setup.sh` | Source code | Implement `--cloud-agent` flag |
| `CHANGELOG.md` | Release notes | Document new template and flag |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Quick Actions | `app.js` → Actions Tab | Add "Cloud Agent Setup" button that runs `pforge smith --cloud-agent` to verify `copilot-setup-steps.yml` exists and is valid |
| **Config** tab | `app.js` → Config Editor | Add `cloudAgent` section to `.forge.json` visual editor (enabled, setup steps path) |
| **Progress** tab | `app.js` → `handleRunStarted()` | Show badge/indicator when run was triggered by cloud agent vs local (if detectable from run metadata) |
| Notification center | `app.js` → Notification Center | Add notification type for cloud agent session events (if WebSocket events are forwarded) |

#### A4. Copilot Memory Coexistence Documentation ✅

**Source**: Copilot Memory now on by default for Pro/Pro+ users (Mar 4) — repo-scoped, 28-day expiry, shared across coding agent/code review/CLI  
**Effort**: Small — documentation only  
**Impact**: Prevents user confusion about overlapping memory systems; positions OpenBrain as the long-term complement

Add a section to `docs/COPILOT-VSCODE-GUIDE.md` and `README.md` FAQ:

**"Plan Forge Memory vs. Copilot Memory vs. OpenBrain"**

| Feature | Copilot Memory | Plan Forge Session Memory | OpenBrain |
|---------|---------------|--------------------------|-----------|
| Scope | Repo | Session / Run | Cross-project |
| Persistence | 28 days (auto-expire) | Per-run (`.forge/runs/`) | Permanent |
| Content | Auto-discovered conventions | Slice results, gate outcomes, cost | Architecture decisions, lessons learned |
| Discovery | Automatic (GitHub infra) | Explicit (run artifacts) | Semantic search |
| Sharing | Coding agent + code review + CLI | Dashboard + MCP tools | Any integrated tool |

Key message: Copilot Memory handles *what* (conventions), Plan Forge tracks *how* (execution state), OpenBrain stores *why* (decisions). They're complementary layers, not competitors. A team using all three gets: automatic convention enforcement (Copilot Memory) + execution guardrails and traceability (Plan Forge) + institutional knowledge that never expires (OpenBrain).

**Acceptance criteria**:
- Comparison table in `docs/COPILOT-VSCODE-GUIDE.md`
- FAQ entry in `README.md`
- No feature changes needed — documentation only

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Memory Layers" with comparison table (Copilot Memory vs Plan Forge vs OpenBrain) |
| `README.md` | Human docs | New FAQ entry: "How does Plan Forge relate to Copilot Memory?" |
| `docs/faq.html` | Website / FAQ | New FAQ: "What's the difference between Copilot Memory and Plan Forge?" |
| `docs/capabilities.html` | Website / Reference | Add memory comparison to Features section |
| `docs/capabilities.md` | Human/AI docs | Add Memory Layers section |
| `CHANGELOG.md` | Release notes | Document memory coexistence guide |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Memory Search | `app.js` → Memory Search section | Add toggle/filter to show Copilot Memory entries alongside OpenBrain entries (if Copilot Memory data becomes accessible) |
| **Actions** tab — Memory Search | `app.js` → Memory Search section | Add info tooltip explaining the 3 memory layers (Copilot Memory / Plan Forge / OpenBrain) with links to docs |

Note: Primarily a docs-only feature. Dashboard changes are optional enhancements if memory data surfaces become queryable.

### Phase B — Medium Effort, High Value (1–3 days each)

#### B1. Org Custom Instructions Generator (`pforge org-rules export`)

**Source**: GitHub Copilot Org Custom Instructions — GA (Apr 2). Admins set default instructions across all repos; applied to Chat, code review, and cloud agent.  
**Effort**: Medium — new CLI command + consolidation logic  
**Impact**: High for enterprise — one command produces the org-level instruction block for GitHub settings; positions Plan Forge as the authoring tool for org governance

New CLI command: `pforge org-rules export [--format github|markdown|json]`

Logic:
1. Read all `.github/instructions/*.instructions.md` files
2. Read `copilot-instructions.md`
3. Read `PROJECT-PRINCIPLES.md` if present
4. Consolidate into a single instruction block optimized for the GitHub org custom instructions format (character limit TBD — research GitHub's max length)
5. Output to stdout or `--output <file>`
6. Include section headers: Architecture Principles, Coding Standards, Git Workflow, Security Rules, Testing Requirements
7. Strip applyTo frontmatter (org instructions don't support it — they apply universally)
8. Add a header comment: `# Generated by Plan Forge v2.14 from repo: <repo-name>`

Also document the **two-layer model** in Plan Forge docs:
- **Layer 1 (Org)**: Universal baseline from `pforge org-rules export` → GitHub org settings
- **Layer 2 (Repo)**: Project-specific profile from `copilot-instructions.md` + `instructions/*.instructions.md` → loaded per-repo

**Acceptance criteria**:
- `pforge org-rules export` CLI command (PS + Bash)
- Corresponding `forge_org_rules` MCP tool
- Docs explaining Layer 1 / Layer 2 model
- Example output in `docs/plans/examples/`

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Add `pforge org-rules export` to Quick Commands; update MCP tool count (18→19); add Layer 1/2 explanation |
| `docs/CLI-GUIDE.md` | Human docs | Add `org-rules export` command with flags and examples |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Org-Level vs Repo-Level Instructions" with Layer 1/2 model |
| `docs/capabilities.md` | Human/AI docs | Add `forge_org_rules` to MCP Tools table; update tool count; add CLI command |
| `docs/capabilities.html` | Website / Reference | Add tool to MCP table; update tool count in header |
| `docs/index.html` | Website / Marketing | Update MCP tool count; add Enterprise feature bullet |
| `docs/faq.html` | Website / FAQ | New FAQ: "Can I set org-wide coding standards?" |
| `docs/docs.html` | Website / Marketing | Update MCP tool count ("17 forge tools" → new count) |
| `pforge-mcp/tools.json` | AI discovery | Add `forge_org_rules` tool definition |
| `docs/.well-known/plan-forge.json` | AI discovery | Add tool to `mcp_tools` array; update `mcp_tools` count |
| `docs/llms.txt` | AI discovery | Update MCP tool count |
| `plugin.json` | VS Code plugin | Update description with new tool count |
| `templates/copilot-instructions.md.template` | Template | Add `pforge org-rules export` to Quick Commands |
| `pforge.ps1` / `pforge.sh` | Source code | Implement `org-rules` subcommand |
| `CHANGELOG.md` | Release notes | Document new CLI command and MCP tool |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Quick Actions | `app.js` → Actions Tab | Add "Export Org Rules" button that calls `forge_org_rules` MCP tool and displays output in a modal |
| **Config** tab | `app.js` → Config Editor | Show org-level instructions status (detected/not detected); link to export command |
| Server-side | `pforge-mcp/server.mjs` | Register `forge_org_rules` MCP tool handler |
| REST API | `pforge-mcp/server.mjs` | Add `POST /api/tool/org-rules` endpoint |

#### B2. Nested Subagent Pipeline (Pipeline-as-Subagents)

**Source**: VS Code 1.113 — Nested subagents: `chat.subagents.allowInvocationsFromSubagents` enables multi-step workflows where subagents can call other subagents  
**Effort**: Medium — refactor 5 pipeline agent definitions  
**Impact**: The pipeline currently requires manual handoff between sessions (Specifier → Plan Hardener → Executor → Reviewer Gate → Shipper). With nested subagents, the Specifier could programmatically spawn Plan Hardener as a child, which spawns Executor, etc. — making the 4-session pipeline collapse into 1 continuous session with automatic handoffs.

Changes needed:
- Update pipeline agent `.agent.md` files to include `subagent: true` capability and define which downstream agent they can invoke
- Add handoff instructions to each agent's system prompt: "After completing your phase, invoke the next pipeline agent as a subagent with context: [spec output / hardened plan / execution report]"
- Add `chat.subagents.allowInvocationsFromSubagents: true` to the generated `.vscode/settings.json` template
- Document in `docs/COPILOT-VSCODE-GUIDE.md`: "Enable nested subagents for single-session pipeline execution"
- Preserve backward compatibility — handoff buttons still work for users who prefer manual control or can't enable nested subagents

**Notes for Step-0 spec**:
- Risk: infinite recursion if guard conditions aren't tight — each agent must terminate after its phase
- The VS Code setting is global, not per-agent — document implications
- Test with the greenfield walkthrough end-to-end

**Acceptance criteria**:
- Pipeline agents can invoke next-stage agents as nested subagents
- Setting auto-configured during setup
- Manual handoff buttons preserved as fallback
- End-to-end test with walkthrough project

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Update pipeline description — mention single-session mode; update session count ("4 sessions" → "4 sessions (or 1 with nested subagents)") |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Single-Session Pipeline with Nested Subagents"; document setting |
| `docs/capabilities.md` | Human/AI docs | Update Pipeline table — add "Sessions: 4 (manual) / 1 (nested subagents)" |
| `docs/capabilities.html` | Website / Reference | Update pipeline section |
| `docs/index.html` | Website / Marketing | Update session count references |
| `docs/faq.html` | Website / FAQ | Update FAQ "How many sessions?" answer |
| `templates/copilot-instructions.md.template` | Template | Update pipeline description; document nested subagent capability |
| `templates/vscode-settings.json.template` | Template | Add `chat.subagents.allowInvocationsFromSubagents` setting |
| `docs/.well-known/plan-forge.json` | AI discovery | Update `sessions` count or add `nested_subagent_mode` field |
| `docs/llms.txt` | AI discovery | Update session description |
| `presets/*/AGENTS.md` (9 files) | AI-agent docs | Update pipeline agent descriptions with subagent invocation info |
| `docs/walkthroughs/greenfield-todo-api.md` | Human docs | Update walkthrough to demonstrate single-session flow |
| `CHANGELOG.md` | Release notes | Document nested subagent pipeline mode |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Progress** tab — Slice cards | `app.js` → `renderSliceCards()` | Add visual indicator for subagent handoffs: show which pipeline agent is active per slice (Specifier → Hardener → Executor → Reviewer → Shipper) with transition arrows |
| **Traces** tab — Waterfall | `app.js` → Traces section | Add nested subagent spans as child spans in the trace waterfall; show agent-to-agent handoff events |
| **Replay** tab | `app.js` → Session Replay | Support replaying nested subagent chains — show which subagent produced which output in sequence |
| **Runs** tab — Run detail drawer | `app.js` → Run Detail Drawer | Show pipeline mode ("4-session manual" vs "1-session nested subagents") in run metadata |
| **Config** tab | `app.js` → Config Editor | Add `pipeline.nestedSubagents` toggle to the visual editor |

#### B3. `/troubleshoot` Integration Skill ✅

**Source**: VS Code 1.114 — `/troubleshoot` can now reference previous chat sessions via `#session`, enabling diagnosis of why instructions were ignored or guardrails bypassed  
**Effort**: Small-to-medium — new skill file + docs  
**Impact**: Directly addresses the #1 user complaint: "why didn't Copilot follow my instructions?"

New skill: `.github/skills/forge-troubleshoot/SKILL.md`

When invoked (manually or auto-detected), the skill:
1. Runs `pforge smith` to verify all instruction files are correctly installed
2. Checks `.vscode/settings.json` for correct `instructions` and `customInstructions` configuration
3. Suggests running VS Code's `/troubleshoot #session` on the problematic session
4. Provides a checklist of common Plan Forge instruction loading failures:
   - `applyTo` pattern doesn't match the files being edited
   - `.instructions.md` file not in `.github/instructions/` directory
   - `copilot-instructions.md` not in `.github/` root
   - Instruction file too large (VS Code has context limits)
   - `settings.json` overrides blocking auto-load
5. If OpenBrain is available, searches for similar past issues and their resolution

Also add troubleshooting guidance to `docs/COPILOT-VSCODE-GUIDE.md`:
- "If guardrails were ignored in a session, run `/troubleshoot #session:<id>` to see if instruction files were loaded"
- Common causes and fixes table

**Acceptance criteria**:
- Skill file with detection triggers
- Shared skill version in `presets/shared/skills/forge-troubleshoot/`
- Docs section in VS Code guide
- Works for all 9 presets

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Update skill count (11→12); add `/forge-troubleshoot` to Skill Slash Commands table |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Troubleshooting Guardrail Issues"; document `/troubleshoot #session` integration |
| `docs/capabilities.md` | Human/AI docs | Add `/forge-troubleshoot` to Skills table; update skill count |
| `docs/capabilities.html` | Website / Reference | Add skill to table; update count in header |
| `docs/index.html` | Website / Marketing | Update skill count |
| `docs/faq.html` | Website / FAQ | New FAQ: "Why didn't Copilot follow my instruction files?" |
| `templates/copilot-instructions.md.template` | Template | Add `/forge-troubleshoot` to Skill Slash Commands table |
| `docs/.well-known/plan-forge.json` | AI discovery | Update `skills` count |
| `docs/llms.txt` | AI discovery | Update skill count |
| `plugin.json` | VS Code plugin | Update description with new skill count |
| `presets/shared/skills/forge-troubleshoot/SKILL.md` | Skill definition | New file — skill entry point |
| `CHANGELOG.md` | Release notes | Document new skill |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Skills** tab — Skill Catalog | `app.js` → Extension Marketplace / Skills section | Add `forge-troubleshoot` to the built-in skill catalog grid with description and status tracking |
| **Skills** tab — Skill execution | `app.js` → Skill runs rendering | Support rendering `/forge-troubleshoot` step events (smith check → settings check → session diagnosis → results) |
| **Actions** tab — Quick Actions | `app.js` → Actions Tab | Add "Troubleshoot" button that triggers the troubleshoot skill via `forge_run_skill` |

#### B4. Validation Tools Complement Guide

**Source**: Coding agent validation tools configurable (Mar 18) — admins toggle CodeQL, secret scanning, Copilot code review per repo  
**Effort**: Small — documentation + optional `.forge.json` config  
**Impact**: Clarifies that Plan Forge validation (build + test gates) and cloud agent validation (security scanning) are orthogonal; guides users to enable both

Add to `docs/COPILOT-VSCODE-GUIDE.md` a section: **"Validation Layers"**

| Layer | What It Checks | Where It Runs | Configured In |
|-------|---------------|---------------|---------------|
| **Plan Forge gates** | Build compiles, tests pass, sweep clean | MCP orchestrator | `.forge.json` gateCommands |
| **CodeQL** | Security vulnerabilities, code smells | Cloud agent runner | Repo settings → Code security |
| **Secret scanning** | Leaked credentials, API keys | Cloud agent runner | Repo settings → Code security |
| **Copilot code review** | Style, patterns, logic issues | Cloud agent PR review | Repo settings → Copilot |
| **GitHub Actions CI** | Full CI pipeline (lint, test, deploy) | GitHub runners | `.github/workflows/` |

Optionally, add a `.forge.json` key `cloudAgentValidation` that documents which external validation tools the project expects, so `pforge smith` can warn if they're not enabled.

**Acceptance criteria**:
- Documentation section with comparison table
- Optional `.forge.json` schema addition
- `pforge smith` check (advisory, not blocking)

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Validation Layers" with comparison table (Plan Forge gates vs CodeQL vs secret scanning vs Copilot review vs CI) |
| `README.md` | Human docs | Add FAQ: "How do Plan Forge gates relate to CodeQL and secret scanning?" |
| `docs/faq.html` | Website / FAQ | New FAQ with validation layers comparison |
| `docs/capabilities.md` | Human/AI docs | Add Validation Layers section after Execution Modes |
| `docs/capabilities.html` | Website / Reference | Add validation layers comparison |
| `CUSTOMIZATION.md` | Human docs | Document `cloudAgentValidation` `.forge.json` key |
| `CHANGELOG.md` | Release notes | Document validation tools complement guide |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Progress** tab — Gate results | `app.js` → `handleSliceCompleted()` | Show validation layer indicators per slice: Plan Forge gate ✅/❌ + CodeQL status + secret scan status (if cloud agent data is available) |
| **Config** tab | `app.js` → Config Editor | Add `cloudAgentValidation` section to `.forge.json` visual editor with checkboxes for expected external validation tools |
| **Actions** tab — Smith panel | `app.js` → Actions Tab | `pforge smith` output should include advisory check for cloud agent validation tool configuration |
| **Runs** tab — Run detail drawer | `app.js` → Run Detail Drawer | Show which validation layers ran for each slice in the detail view |

### Phase C — Strategic Investments (3–7 days each)

#### C1. Copilot SDK Tool Provider

**Source**: Copilot SDK public preview (Apr 2) — 5 languages, custom tools + agents, system prompt customization (replace/append/prepend/transform), streaming, BYOK, OpenTelemetry built-in, permission framework  
**Effort**: High — new package/module  
**Impact**: Strategic — transforms Plan Forge from "files you install" to "tools that run inside any Copilot SDK-based agent"

Build a `@plan-forge/copilot-sdk` npm package that exposes Plan Forge guardrails as Copilot SDK tools:

```typescript
// Usage in any Copilot SDK agent
import { planForgeTools } from '@plan-forge/copilot-sdk';

const agent = new CopilotAgent({
  tools: [...planForgeTools],
  systemPrompt: { 
    transform: (base) => base + planForgeInstructions 
  }
});
```

Exposed tools (subset of MCP tools, repackaged for SDK):
- `forge.harden(planText)` — take loose plan text → return hardened plan with scope contracts
- `forge.validateSlice(sliceN, buildOutput, testOutput)` — check gate passage
- `forge.sweep(directory)` — scan for TODOs/stubs/mocks
- `forge.analyze(planFile)` — consistency scoring
- `forge.smith()` — diagnostic check

SDK-specific features:
- **System prompt transform** — automatically append Plan Forge instructions to any agent's system prompt using SDK's `transform` mode (no manual copy-paste)
- **OpenTelemetry passthrough** — SDK's built-in OTEL traces propagate through Plan Forge tools, creating unified trace trees
- **Permission framework** — declare Plan Forge tools as "read" (smith, analyze, sweep) vs "write" (harden, run-plan) for SDK permission scoping

**Notes for Step-0 spec**:
- Must decide: TypeScript-first or multi-language? SDK supports 5 languages but TypeScript aligns with Plan Forge's Node.js base
- The SDK is in public preview — API may change. Pin to a specific SDK version and document upgrade path
- This is the path to Plan Forge becoming embeddable rather than installable
- Consider publishing to npm and registering in the Copilot SDK tool marketplace (if one emerges)

**Acceptance criteria**:
- npm package with typed exports
- README with usage examples
- Integration tests against Copilot SDK
- Example agent that uses Plan Forge tools
- OTEL trace continuity verified

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | New "SDK Integration" section; add npm install instructions; link to SDK README |
| `docs/index.html` | Website / Marketing | Add "Copilot SDK Integration" feature card; add npm badge |
| `docs/capabilities.md` | Human/AI docs | New "SDK Tools" section listing exposed functions |
| `docs/capabilities.html` | Website / Reference | Add SDK integration section |
| `docs/docs.html` | Website / Marketing | Add SDK package card to documentation grid |
| `docs/faq.html` | Website / FAQ | New FAQ: "Can I embed Plan Forge in my own Copilot agent?" |
| `docs/examples.html` | Website / Examples | Add SDK usage example |
| `AGENT-SETUP.md` | AI-agent entry point | Add SDK as alternative integration path |
| `docs/.well-known/plan-forge.json` | AI discovery | Add `sdk` section with package name, npm URL, exposed tools |
| `docs/llms.txt` | AI discovery | Add SDK entry point |
| `CHANGELOG.md` | Release notes | Document SDK package release |
| `ROADMAP.md` | Roadmap | Mark C1 as shipped |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Traces** tab | `app.js` → Traces section | Support rendering SDK-originated trace spans — SDK tools propagate OTEL traces that should appear in the waterfall alongside MCP tool traces |
| **Cost** tab | `app.js` → `loadCost()` | Track and display cost from SDK-invoked tool calls (may arrive via different telemetry path than MCP) |
| **Actions** tab | `app.js` → Actions Tab | If SDK agent is detected, show SDK connection status badge in header (similar to WebSocket badge) |
| **Config** tab | `app.js` → Config Editor | Add SDK configuration section: package version, connected agents, permission scopes |
| REST API | `pforge-mcp/server.mjs` | Ensure `/api/traces` and `/api/cost` aggregate data from both MCP and SDK sources |

#### C2. Cloud Agent Plan Export (`forge_export_plan`)

**Source**: Copilot cloud agent now generates implementation plans before coding (Apr 1)  
**Effort**: Medium-to-high — new MCP tool + plan parser  
**Impact**: Bridges the gap between Copilot's loose planning and Plan Forge's hardened execution

New MCP tool: `forge_export_plan`

Takes a Copilot cloud agent session plan (markdown format) and converts it into a hardened Plan Forge plan:
- Parses the cloud agent's step-by-step plan
- Maps each step to a Plan Forge slice with scope isolation
- Adds validation gates (build + test commands from `.forge.json`)
- Identifies potential parallel slices (steps with no file overlap)
- Adds forbidden actions based on scope analysis
- Outputs a `Phase-X-PLAN.md` in Plan Forge format ready for `forge_run_plan`

Workflow:
1. User asks cloud agent to plan a feature → cloud agent produces a plan
2. User reviews and says "harden this plan"
3. `forge_export_plan` converts it → hardened Plan Forge format
4. `forge_run_plan` executes it with full guardrails

**Notes for Step-0 spec**:
- Cloud agent plan format is not formally documented — need to reverse-engineer from examples
- May need heuristics: "Step 1: Create X" → Slice 1, Scope: [files involved]
- Could use an LLM call itself to do the semantic mapping (meta-tool: AI-assisted plan hardening)
- Fallback: if plan format doesn't parse cleanly, output a template with TODOs for human refinement

**Acceptance criteria**:
- `forge_export_plan` MCP tool
- `pforge export-plan <session-log>` CLI command
- Handles at least 3 plan formats (numbered steps, headings, checkboxes)
- Output passes `pforge validate`
- Example in docs

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Update MCP tool count; add `pforge export-plan` to Quick Commands; add FAQ |
| `docs/CLI-GUIDE.md` | Human docs | Add `export-plan` command with usage examples |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | Add "Hardening Cloud Agent Plans" workflow section |
| `docs/capabilities.md` | Human/AI docs | Add `forge_export_plan` to MCP Tools table; update count; add CLI command |
| `docs/capabilities.html` | Website / Reference | Add tool to table; update count |
| `docs/index.html` | Website / Marketing | Update MCP tool count; mention cloud agent plan hardening |
| `docs/docs.html` | Website / Marketing | Update MCP tool count |
| `docs/faq.html` | Website / FAQ | New FAQ: "Can I harden a Copilot cloud agent plan?" |
| `pforge-mcp/tools.json` | AI discovery | Add `forge_export_plan` tool definition |
| `docs/.well-known/plan-forge.json` | AI discovery | Add tool; update count |
| `docs/llms.txt` | AI discovery | Update tool count |
| `plugin.json` | VS Code plugin | Update tool count in description |
| `templates/copilot-instructions.md.template` | Template | Add `pforge export-plan` to Quick Commands |
| `pforge.ps1` / `pforge.sh` | Source code | Implement `export-plan` subcommand |
| `CHANGELOG.md` | Release notes | Document new tool and command |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Quick Actions | `app.js` → Actions Tab | Add "Import Cloud Agent Plan" button/dropzone — paste or upload a cloud agent plan, preview parsed slices, then export as hardened Plan Forge plan |
| **Actions** tab — Plan Browser | `app.js` → Plan Browser section | Show imported/exported plans with a badge indicating source ("cloud agent → hardened") |
| **Progress** tab | `app.js` → `handleRunStarted()` | Show "Source: Cloud Agent Export" badge on runs that originated from an exported plan |
| **Runs** tab — Run detail drawer | `app.js` → Run Detail Drawer | Link back to original cloud agent plan text in the run metadata |
| REST API | `pforge-mcp/server.mjs` | Add `POST /api/tool/export-plan` endpoint for the import/export workflow |

#### C3. `forge_sync_memories` — Bridge to Copilot Memory

**Source**: Copilot Memory (Mar 4) — auto-discovers repo conventions, 28-day TTL, repo-scoped  
**Effort**: Medium — depends on whether Copilot Memory has a write API (currently unclear)  
**Impact**: Extends Plan Forge's captured architecture decisions into the ephemeral Copilot Memory layer

New MCP tool: `forge_sync_memories`

If Copilot Memory exposes a write/import API:
- Export Plan Forge captured decisions (from OpenBrain or `.forge/` artifacts) into Copilot Memory format
- This gives short-lived Copilot Memory entries a "permanent backing store" in OpenBrain
- Sync runs periodically or on-demand, refreshing the 28-day TTL

If Copilot Memory does NOT expose a write API (likely in current preview):
- Alternative approach: generate a `.github/copilot-memory-hints.md` file that contains the most important architecture decisions in a format Copilot Memory's auto-discovery will pick up
- This is a soft-sync — Plan Forge writes hints that Copilot Memory reads organically

**Notes for Step-0 spec**:
- Copilot Memory API is not documented yet — this item is speculative
- Start with the soft-sync approach (`.github/copilot-memory-hints.md`) which works today
- Monitor GitHub's API releases for a future hard-sync path
- Privacy consideration: ensure no secrets or sensitive data flow into Memory

**Acceptance criteria** (soft-sync v1):
- `forge_sync_memories` generates `.github/copilot-memory-hints.md` from OpenBrain/forge decisions
- Content is architecture decisions only (no code, no secrets)
- Runs as part of `pforge smith` or on-demand
- Documented in Copilot Memory coexistence guide (A4)

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Update MCP tool count; add FAQ: "Can Plan Forge sync decisions to Copilot Memory?" |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | Expand Memory Layers section (from A4) with sync workflow |
| `docs/capabilities.md` | Human/AI docs | Add `forge_sync_memories` to MCP Tools table; update count |
| `docs/capabilities.html` | Website / Reference | Add tool to table; update count |
| `docs/index.html` | Website / Marketing | Update tool count; add memory sync feature mention |
| `docs/docs.html` | Website / Marketing | Update tool count |
| `pforge-mcp/tools.json` | AI discovery | Add `forge_sync_memories` tool definition |
| `docs/.well-known/plan-forge.json` | AI discovery | Add tool; update count |
| `docs/llms.txt` | AI discovery | Update tool count |
| `plugin.json` | VS Code plugin | Update tool count in description |
| `CHANGELOG.md` | Release notes | Document memory sync feature |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Memory Search | `app.js` → Memory Search section | Add "Sync to Copilot Memory" button that triggers `forge_sync_memories`; show last sync timestamp and entry count |
| **Actions** tab — Memory Search | `app.js` → Memory Search section | Display synced decisions with a "🔄 synced" badge; show TTL countdown (28 days from last sync) |
| **Config** tab | `app.js` → Config Editor | Add `memorySyncEnabled` toggle and `memorySyncSchedule` (manual / on-smith / daily) to `.forge.json` editor |
| Notification center | `app.js` → Notification Center | Add notification when memory sync completes or when synced entries are approaching TTL expiry |

#### C4. Fine-Grained Tool Approval Integration

**Source**: VS Code 1.114 proposed API — tools can scope approval to specific argument combinations. E.g., approve `read_file("config.json")` without blanket-approving all `read_file` calls.  
**Effort**: Medium — requires Plan Forge to ship as a VS Code extension (not just files)  
**Impact**: Moderate — improves UX by auto-approving safe forge operations while requiring confirmation for destructive ones

If/when Plan Forge ships as a VS Code extension:
- Classify MCP tools by risk level:
  - **Auto-approvable** (read-only, instant): `forge_smith`, `forge_validate`, `forge_sweep`, `forge_capabilities`, `forge_plan_status`, `forge_cost_report`, `forge_analyze`
  - **Require approval** (side effects): `forge_run_plan`, `forge_abort`, `forge_new_phase`, `forge_run_skill`
  - **Conditional** (depends on args): `forge_diff` (read-only = auto, apply = approval)
- Register tool approval scopes using the proposed API so VS Code pre-approves safe tools

**Notes for Step-0 spec**:
- This API is still "proposed" in 1.114 — may not stabilize until 1.115+
- Requires Plan Forge to be a real VS Code extension, not just instruction files + MCP server
- Track the API's status in VS Code release notes before committing development effort
- If the API stabilizes, this becomes a strong reason to create a Plan Forge VS Code extension

**Acceptance criteria**:
- Tool risk classification documented
- VS Code extension prototype with approval scopes (if API is stable)
- Fallback: document manual tool approval patterns for current users

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Add tool risk classification table; document VS Code extension install |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | New section: "Tool Approval Levels" — which tools auto-approve vs require confirmation |
| `docs/capabilities.md` | Human/AI docs | Add risk level column to MCP Tools table |
| `docs/capabilities.html` | Website / Reference | Add risk level indicators to tool table |
| `docs/faq.html` | Website / FAQ | New FAQ: "Which Plan Forge tools are safe to auto-approve?" |
| `pforge-mcp/tools.json` | AI discovery | Add `riskLevel` field to each tool definition |
| `docs/.well-known/plan-forge.json` | AI discovery | Add risk classification metadata |
| `CHANGELOG.md` | Release notes | Document tool approval integration |

**Dashboard Sweep** (update after feature is live):
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Actions** tab — Quick Actions | `app.js` → Actions Tab | Color-code action buttons by risk level: green (auto-approvable), yellow (conditional), red (requires approval) |
| **Config** tab | `app.js` → Config Editor | Show tool approval matrix — which tools are auto-approved, which require confirmation; allow editing approval scopes |
| Header | `dashboard/index.html` | Add approval-pending indicator in header when a tool is awaiting user confirmation (alongside bridge approval badges) |
| Bridge Status | `app.js` → Bridge Status & Escalation | Integrate tool approval requests into the existing approval gate workflow |

### Phase D — Watch List (No Build Yet — Monitor & Evaluate)

These items depend on external platform changes. Track them; build when APIs stabilize or opportunities mature.

| # | Item | Source | What to Watch | Trigger to Build |
|---|------|--------|---------------|-----------------|
| D1 | **Cloud agent signed commits** | Copilot changelog Apr 3 | Cloud agent now signs commits with verified signature | Plan Forge's Shipper agent could verify commit signatures as an additional gate — build when users request auditability |
| D2 | **Copilot for Jira integration** | Copilot changelog Mar 5, public preview | Jira ↔ Copilot bidirectional sync | Plan Forge Step 0 (Specifier) could ingest Jira ticket as spec input — build when the Jira API is documented |
| D3 | **Merge conflict resolution** | Copilot changelog Mar 26 | `@copilot` resolves merge conflicts automatically | Plan Forge's branch-per-slice strategy could invoke this when parallel slices create conflicts — build when the API is callable from MCP |
| D4 | **Session tracing for audit** | Copilot changelog Mar 20 | Every cloud agent commit links to session logs | Plan Forge's Trace tab could deep-link to Copilot session logs for full provenance — build when trace format is documented |
| D5 | **Chat Customizations editor** | VS Code 1.113 | Unified UI for instructions, prompts, agents, skills | `pforge smith` could detect and suggest the editor for reviewing installed files — low effort, add when convenient |
| D6 | **Copilot code review agentic mode** | Copilot changelog Mar 5 | Code review is now agentic (multi-step, tool-using) | Plan Forge's `/code-review` skill could delegate to native agentic review and layer Plan Forge-specific checks on top |
| D7 | **Plan mode in Copilot metrics** | Copilot changelog Mar 2 | GitHub exposes plan-mode usage metrics | Track whether Plan Forge users' plan-mode metrics improve vs. non-Plan Forge users — build advocacy materials |

**Doc Sweep for Watch List items** (update when each item is triggered):
| Item | Files to Update |
|------|-----------------|
| D1 Signed commits | `docs/capabilities.md` (Shipper agent section), `docs/capabilities.html`, `presets/*/AGENTS.md` (shipper agent), `CHANGELOG.md` |
| D2 Jira integration | `docs/capabilities.md` (new integration section), `docs/capabilities.html`, `docs/index.html` (integrations list), `docs/faq.html`, `README.md`, `docs/.well-known/plan-forge.json`, `CHANGELOG.md` |
| D3 Merge conflict | `docs/capabilities.md` (parallel execution section), `docs/capabilities.html`, `README.md` (execution modes), `CHANGELOG.md` |
| D4 Session tracing | `docs/capabilities.md` (traces section), `docs/capabilities.html`, `docs/dashboard.html` (Traces tab), `CHANGELOG.md` |
| D5 Customizations editor | `docs/COPILOT-VSCODE-GUIDE.md`, `docs/faq.html`, `CHANGELOG.md` |
| D6 Agentic code review | `docs/capabilities.md` (skills table), `docs/capabilities.html`, `templates/copilot-instructions.md.template` (update `/code-review` skill description), `CHANGELOG.md` |
| D7 Plan mode metrics | `docs/index.html` (stats/social proof section), `README.md` (metrics), marketing materials only |
**Dashboard Sweep for Watch List items** (update when each item is triggered):
| Item | Dashboard Changes |
|------|-------------------|
| D1 Signed commits | **Runs** tab: show commit signature verification status (✅ signed / ⚠️ unsigned) per slice in run detail drawer |
| D2 Jira integration | **Actions** tab: add Jira ticket picker/linker in Plan Browser; **Progress** tab: show linked Jira ticket ID on slice cards |
| D3 Merge conflict | **Progress** tab: add merge conflict indicator on parallel `[P]` slices; show auto-resolution status if triggered |
| D4 Session tracing | **Traces** tab: add deep-link button per span to open the corresponding Copilot session log on GitHub |
| D5 Customizations editor | No dashboard changes — VS Code native feature; mention in `pforge smith` output only |
| D6 Agentic code review | **Skills** tab: update `/code-review` skill rendering to show native agentic review delegation steps |
| D7 Plan mode metrics | **Runs** tab or new **Metrics** tab: show plan-mode adoption stats if GitHub metrics API exposes them |

### Setup & Updater Sweep (Post v2.14 Release Gate)

> **Purpose**: After all v2.14 features ship, verify that new users get everything on first `setup.ps1`/`setup.sh` run, and existing users can upgrade cleanly. This is the **release gate** — v2.14 is not shippable until every item below is addressed.

#### New Install (`setup.ps1` / `setup.sh`)

These items ensure a user running `setup.ps1 -Preset <stack>` for the first time gets all v2.14 capabilities automatically.

| Feature | Script Section | Change Needed |
|---------|---------------|---------------|
| **A1** Plugin install link | Done banner (Step 8 "Next steps" output) | Add line: "Install Plan Forge plugin: vscode://chat-plugin/install?source=srnichols/plan-forge" |
| **A2** Model deprecation | Step 5 `.forge.json` generation | Ensure default `modelRouting` and `escalationChain` use current models (GPT-5.3-Codex, GPT-5.4, Claude Sonnet 4.6); no deprecated models in defaults |
| **A3** Cloud agent | New step or flag: `--cloud-agent` | Generate `copilot-setup-steps.yml` in project root; add cloud agent section to `.forge.json`; conditionally install based on flag or prompt |
| **A4** Memory docs | No setup change | Documentation only — no files to generate |
| **B1** Org rules export | Step 7b / CLI copy | Copy `pforge.ps1`/`pforge.sh` updated with `org-rules` subcommand; add `forge_org_rules` to MCP server tools |
| **B2** Nested subagents | Step 6 VS Code settings | Add `"chat.subagents.allowInvocationsFromSubagents": true` to `vscode-settings.json.template`; update pipeline `.agent.md` files with subagent invocation capability |
| **B3** Troubleshoot skill | Step 3 / Step 3b shared skills | Copy `presets/shared/skills/forge-troubleshoot/SKILL.md` to `.github/skills/forge-troubleshoot/`; include in capabilities.json skill count |
| **B4** Validation tools | Step 5 `.forge.json` | Add `cloudAgentValidation` key with sensible defaults (all recommended, advisory) |
| **C1** SDK tool provider | Step 7b MCP setup | If SDK package is published, add optional `pforge-sdk/` copy step; document in Next Steps output |
| **C2** Plan export | Step 7b MCP tools | Ensure `forge_export_plan` is registered in server.mjs; `pforge.ps1` includes `export-plan` subcommand |
| **C3** Memory sync | Step 7b MCP tools | Ensure `forge_sync_memories` is registered in server.mjs; add `memorySyncEnabled` default to `.forge.json` |
| **C4** Tool approval | Step 6 VS Code settings | If API is stable: add tool approval scopes to settings template; otherwise no change |

#### Existing User Upgrade (`pforge smith` + manual re-run)

Plan Forge doesn't have a formal `upgrade` command yet. Existing users upgrade by pulling the latest Plan Forge repo and re-running `setup.ps1 -Force`. These items ensure that path works cleanly.

| Concern | Script | Change Needed |
|---------|--------|---------------|
| **Additive file merge** | `setup.ps1` Step 3 | When `-Force` is used, new files (e.g., `forge-troubleshoot` skill, `copilot-setup-steps.yml`) are added without overwriting user-customized files. Current behavior: `-Force` overwrites everything. **Consider**: add `-Merge` flag that only copies files that don't exist yet, preserving user edits. |
| **`.forge.json` schema migration** | `setup.ps1` Step 5 | If `.forge.json` already exists, merge new keys (`cloudAgentValidation`, `memorySyncEnabled`, `pipeline.nestedSubagents`) into existing config instead of overwriting. Preserve user's `modelRouting`, `quorum`, `gateCommands`, and `extensions`. |
| **`.vscode/settings.json` merge** | `setup.ps1` Step 6 | If `settings.json` exists, add new keys (`allowInvocationsFromSubagents`) without replacing user's existing settings. Currently overwrites. |
| **`.vscode/mcp.json` tool additions** | `setup.ps1` Step 7b | Already handles merge correctly (checks for existing `plan-forge` server). Verify new MCP tools (`forge_org_rules`, `forge_export_plan`, `forge_sync_memories`) are available after server.mjs update. |
| **Deprecated model cleanup** | `pforge smith` | Add smith diagnostic: "⚠ Your `.forge.json` references deprecated model GPT-5.1. Recommended: GPT-5.3-Codex (LTS) or GPT-5.4." with auto-fix suggestion. |
| **Version tracking** | `.forge.json` → `templateVersion` | Setup already writes `templateVersion` from `VERSION` file. Smith should compare installed `templateVersion` vs latest and warn if outdated: "Your project uses Plan Forge 2.13.1 templates but 2.14.0 is available. Re-run setup.ps1 -Force to upgrade." |
| **New skill detection** | `validate-setup.ps1` | Add check for `forge-troubleshoot` skill directory existence. Update expected file counts for v2.14 (skill count 11→12, MCP tools count if changed). |
| **Cloud agent detection** | `pforge smith` | Add smith check: if repo has `.github/` but no `copilot-setup-steps.yml`, suggest: "Consider adding cloud agent support: re-run setup.ps1 --cloud-agent" |

#### Validate-Setup Updates (`validate-setup.ps1` / `validate-setup.sh`)

| Check | Current | After v2.14 |
|-------|---------|-------------|
| Skill count | Validates shared skills exist | Add `forge-troubleshoot` to expected skills list |
| `.forge.json` schema | Checks `projectName`, `preset`, `agents`, `stack` | Add checks for new optional keys: `cloudAgentValidation`, `memorySyncEnabled`, `pipeline` |
| Settings template | Checks `.vscode/settings.json` exists | Verify `allowInvocationsFromSubagents` key is present (warn if missing, don't fail) |
| Model references | Not checked | New check: scan `.forge.json` for deprecated model names and warn |
| Cloud agent | Not checked | New check: if `copilot-setup-steps.yml` exists, verify it has required steps |
| MCP tool count | Not explicitly checked | Add advisory check: compare registered tools in server.mjs vs expected count |

#### Templates to Update

| Template File | What Changes |
|---------------|-------------|
| `templates/copilot-instructions.md.template` | Add new CLI commands (`org-rules export`, `export-plan`); update skill table (add `/forge-troubleshoot`); update MCP tool count in comments; add cloud agent Quick Commands |
| `templates/vscode-settings.json.template` | Add `chat.subagents.allowInvocationsFromSubagents: true` |
| `templates/AGENTS.md.template` | Update pipeline agent descriptions with nested subagent capability |
| `templates/copilot-setup-steps.yml` | **New template** — cloud agent setup steps for GitHub Copilot cloud agent |

#### Agent Adapters to Update

Each agent adapter function (`Install-ClaudeAgent`, `Install-CursorAgent`, etc.) may need updates:

| Adapter | Function | Change |
|---------|----------|--------|
| **Claude** | `Install-ClaudeAgent` | Add `/forge-troubleshoot` to CLAUDE.md slash commands; update model references |
| **Cursor** | `Install-CursorAgent` | Add troubleshoot command to `.cursor/commands/`; update model references |
| **Codex** | `Install-CodexAgent` | Add troubleshoot skill to `.agents/skills/`; update model references |
| **Gemini** | `Install-GeminiAgent` | Add `/planforge-troubleshoot` command to GEMINI.md; update model references |
| **Windsurf** | `Install-WindsurfAgent` | Add troubleshoot rule to `.windsurf/rules/`; update model references |
| **Generic** | `Install-GenericAgent` | Add troubleshoot skill; update model references |
| **All adapters** | All functions | If org-rules export or plan import are CLI-only (not agent-specific), no adapter changes needed for B1/C2 |

#### Release Checklist

Before tagging v2.14.0:

- [ ] `setup.ps1` generates all new files for a fresh project
- [ ] `setup.sh` generates identical output (parity check)
- [ ] `setup.ps1 -Force` on an existing v2.13.x project preserves user customizations
- [ ] `validate-setup.ps1` passes with updated counts and checks
- [ ] `validate-setup.sh` produces identical results
- [ ] `pforge smith` detects deprecated models and suggests upgrade
- [ ] `pforge smith` detects missing cloud agent setup and suggests it
- [ ] `node pforge-mcp/orchestrator.mjs --test` passes (update expected count)
- [ ] All 9 presets tested: `setup.ps1 -Preset <each> -Force` → validate passes
- [ ] Agent adapters tested: `setup.ps1 -Agent all` → all 7 adapters produce correct output
- [ ] `VERSION` bumped to `2.14.0`
- [ ] `CHANGELOG.md` updated with all v2.14 items
- [ ] `plugin.json` version bumped to `2.14.0` with updated description

---

## v2.18 — Temper Guards & Onboarding Polish

> **Source**: Comparative analysis with [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (April 2026). Agent Skills' #1 innovation is anti-rationalization tables — documented rebuttals for excuses agents use to skip steps. Plan Forge has structural enforcement (gates, scope contracts, forbidden actions) but lacks a psychological defense layer. v2.18 adds that layer to instruction files and skills, plus onboarding streamlining.
>
> **Design principle**: Build onto existing instruction files and skill format — no new runtime, no new tools. These are pure documentation enhancements with zero infrastructure cost.

### T1. Temper Guards in Instruction Files

**What**: Add a `## Temper Guards` section to core instruction files. Each table lists common excuses agents use to cut corners within a passing build, paired with documented rebuttals. Named after the metallurgical process — tempering strengthens steel against brittle failure while preserving its edge.

**Why**: Validation gates catch code that doesn't compile or pass tests. They cannot catch quality erosion that still compiles — controller-level business logic, missing edge-case handling, DTOs that bypass validation, raw SQL where the ORM should be used. Temper Guards attack this at the cognitive layer before the agent writes the code.

**Approach**: Each instruction file already tells agents *what to do*. Temper Guards add *why not to skip it*. Format:

```markdown
## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple code gets modified later. The test documents the contract. Write it now. |
| "I'll add tests after the feature works" | Debt compounds. Red-Green-Refactor means test exists before code. |
```

**Files to enhance** (priority order — highest agent-laziness risk first):

| Instruction File | Key Temper Guards |
|------------------|-------------------|
| `testing.instructions.md` | "Too simple to test", "Integration test covers it", "Just a DTO — no logic", "Mocking is too complex" |
| `security.instructions.md` | "This is internal-only", "Input validation is overkill", "We'll add auth later", "No real users yet" |
| `errorhandling.instructions.md` | "This can't fail", "A generic catch is fine", "Logging it is enough", "The caller handles errors" |
| `architecture-principles.instructions.md` | "Putting logic in the controller is simpler", "One service handles both", "We'll refactor later", "This is a one-off" |
| `database.instructions.md` | "N+1 won't matter at our scale", "Raw SQL is faster here", "Migrations are overkill for this change" |
| `api-patterns.instructions.md` | "Nobody uses pagination yet", "Versioning can wait", "Error codes aren't needed for MVP" |

**Scope**: All 9 presets benefit (shared instruction files propagate). Stack-specific variants add framework-specific guards (e.g., TypeScript: "any is fine here temporarily"; .NET: "`dynamic` is easier than generics"; Python: "type hints slow me down").

**Effort**: ~3 hours  
**Acceptance criteria**:
- Temper Guards section added to 6+ instruction files across all presets
- Each table has 3–6 entries with concrete, non-generic rebuttals
- Stack-specific variants include framework-specific temptations
- No runtime changes — pure Markdown enhancement

### T2. Warning Signs in Instruction Files

**What**: Add a `## Warning Signs` section to instruction files — observable behavioral patterns indicating the file's guidance is being violated. Named for what they are: signals that something's going wrong.

**Why**: The Review Gate (Step 5) runs *after* all slices complete. Warning Signs give both the agent (during execution) and the reviewer (during audit) a specific checklist of *behavioral* anti-patterns to watch for. The PostToolUse hook already scans for TODO/FIXME markers — Warning Signs extend this to architectural and quality markers.

**Example for `architecture-principles.instructions.md`**:
```markdown
## Warning Signs

- A controller method contains database queries (skipped the service layer)
- A service returns HTTP status codes or HttpResponse objects (leaking HTTP concerns)
- A repository contains if/else business logic (business rules in data access)
- A single file handles both HTTP routing and data persistence
- A new utility class exists for a one-time operation (premature abstraction)
- A God object: single class with >10 public methods or >300 lines
```

**Files to enhance** (same set as T1):
| File | Key Warning Signs |
|------|-------------------|
| `testing.instructions.md` | Test file has fewer test methods than the class under test has public methods; test names describe implementation not behavior |
| `security.instructions.md` | Route handler missing auth middleware; string interpolation in SQL; hardcoded secret in assignment |
| `errorhandling.instructions.md` | Empty catch block; all exceptions caught as base Exception; error message exposes stack trace |
| `database.instructions.md` | Query inside a loop; SELECT * in production code; missing index on foreign key |
| `api-patterns.instructions.md` | Endpoint returns unbounded collection; no Content-Type header; 200 OK for error conditions |

**Effort**: ~2 hours  
**Acceptance criteria**:
- Warning Signs section in 6+ instruction files
- Each list has 4–6 concrete, grep-checkable patterns
- Signs are behavioral (observable in code) not subjective

### T3. Context Fuel Instruction File

**What**: A new `context-fuel.instructions.md` (shared, `applyTo: '**'`) that teaches agents how to manage their own context window within the Plan Forge ecosystem. Named because context is what fuels good agent output — running low starves quality.

**Why**: Plan Forge loads 15–18 instruction files per preset. In long sessions, agents silently drop earlier context and start making mistakes that were already guarded against. There's no explicit guidance for "you're losing context — here's what to do."

**Content**:
- When to use `forge_capabilities` (session start) vs reading individual files
- How to prioritize instruction files for the current task (database work → load `database.instructions.md` first)
- Recognizing context degradation: repeated mistakes, forgotten constraints, contradicting earlier decisions
- When to recommend a fresh session (Plan Forge's 4-session model exists for this)
- How to use OpenBrain `search_thoughts` to restore lost context mid-session
- Token budget awareness: large plan files + many instruction files can exceed windows

**Effort**: ~2 hours — one new instruction file + add to `presets/shared/`  
**Acceptance criteria**:
- `context-fuel.instructions.md` in shared preset
- Loads on `applyTo: '**'` with `priority: LOW` (informational, not blocking)
- Contains actionable steps, not abstract advice
- References Plan Forge-specific tools (forge_capabilities, OpenBrain)

### T4. Quick Forge Card on Website

**What**: A single "5-Minute Quick Start" card on `planforge.software` that shows exactly 4 steps: install → init → plan → execute. Distills the onboarding to the minimum viable path.

**Why**: Plan Forge's documentation is comprehensive (50+ files, full manual, blog) which is a strength for depth but a weakness for first impressions. Evaluators need a fast signal: "can I be productive in 5 minutes?"

**Content**:
```
1. Install the plugin: [one-click link]
2. Init your project: pforge init -Preset <stack>
3. Describe your feature to the Specifier agent
4. Click through the pipeline: Specify → Harden → Execute → Review → Ship
```

**Effort**: ~1 hour — HTML/CSS card on `docs/index.html`  
**Acceptance criteria**:
- Card visible above the fold on the homepage
- 4 steps maximum, no jargon
- Links to detailed walkthrough for users who want more

### T5. `pforge tour` — Interactive Walkthrough

**What**: A new CLI command that walks through the installed Plan Forge files interactively, explaining what each type does (instructions, agents, prompts, skills, hooks, .forge.json). Guided introduction that builds familiarity without reading docs.

**Why**: New users face 100+ files after setup. `pforge tour` provides a curated walk-through that teaches the framework by showing real files in their project, not abstract documentation.

**Flow**:
```
$ pforge tour
Welcome to Plan Forge! Let's walk through your project.

[1/6] Instruction Files (.github/instructions/)
  You have 17 instruction files. These auto-load when you edit matching files.
  Example: database.instructions.md loads when editing *.sql files.
  → Press Enter to see a list, or 's' to skip...

[2/6] Agent Definitions (.github/agents/)
  You have 19 agents. These are specialized reviewers you can invoke in chat.
  → Press Enter to see them, or 's' to skip...

[3/6] ...
```

**Effort**: ~4 hours (PS + Bash parity)  
**Acceptance criteria**:
- `pforge tour` command in both `pforge.ps1` and `pforge.sh`
- Covers 6 categories: instructions, agents, prompts, skills, pipeline, config
- Interactive (press Enter to continue, 's' to skip)
- Uses real file counts and names from the user's project
- No MCP dependency — works standalone

**Doc Sweep** (update after all T1–T5 are live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Add `pforge tour` to Quick Commands; mention Temper Guards in "How It Works" section |
| `docs/CLI-GUIDE.md` | Human docs | Add `tour` command documentation |
| `docs/index.html` | Website | Add Quick Forge Card (T4); mention Temper Guards as feature |
| `docs/capabilities.md` | Human/AI docs | Document Temper Guards and Warning Signs as instruction file features |
| `docs/capabilities.html` | Website | Update features list |
| `docs/COPILOT-VSCODE-GUIDE.md` | Human docs | Reference context-fuel.instructions.md in "Managing Context Budget" section |
| `CUSTOMIZATION.md` | Human docs | Document Temper Guards format for teams adding custom guards |
| `docs/faq.html` | Website / FAQ | New FAQ: "What are Temper Guards?" / "How does Plan Forge prevent agents from cutting corners?" |
| `templates/copilot-instructions.md.template` | Template | Add `pforge tour` to Quick Commands |
| `CHANGELOG.md` | Release notes | Document all T1–T5 items |

**MCP & Capabilities Sweep** (update after all T1–T5 are live):
| File | What to Update |
|------|----------------|
| `pforge-mcp/capabilities.mjs` → `guardrails.shared` | Add `context-fuel` to shared guardrails list |
| `pforge-mcp/capabilities.mjs` → `guardrails` | Add `temperGuards` and `warningSigns` as documented instruction file features |
| `pforge-mcp/capabilities.mjs` → `presets.counts` | Update instruction counts if `context-fuel.instructions.md` adds to the total |
| `docs/capabilities.md` | Add Temper Guards + Warning Signs to guardrails feature description |
| `docs/capabilities.html` | Mirror capabilities.md updates |
| `docs/.well-known/plan-forge.json` | Update guardrail feature descriptions |
| `docs/llms.txt` | Mention Temper Guards as a guardrail mechanism |
| `plugin.json` | Update description if feature count changes |

**Dashboard Sweep**: No dashboard changes — v2.18 is all instruction-layer and CLI enhancements.

### v2.18 Release Gate

Before tagging v2.18.0:

- [ ] Temper Guards section present in 6+ instruction files across all presets
- [ ] Warning Signs section present in 6+ instruction files across all presets
- [ ] `context-fuel.instructions.md` exists in `presets/shared/` with `applyTo: '**'`
- [ ] Quick Forge Card visible on `docs/index.html` above the fold
- [ ] `pforge tour` works in both `pforge.ps1` and `pforge.sh` (parity check)
- [ ] `pforge-mcp/capabilities.mjs` updated with new guardrail features
- [ ] `docs/capabilities.md` and `docs/capabilities.html` updated
- [ ] `validate-setup.ps1` / `validate-setup.sh` updated to check for `context-fuel.instructions.md`
- [ ] All 9 presets tested: `setup.ps1 -Preset <each>` installs Temper Guards files
- [ ] `VERSION` bumped to `2.18.0`
- [ ] `CHANGELOG.md` updated with all T1–T5 items

---

## v2.19 — Skill Blueprint & Verification Gates

> **Source**: Continued learnings from agent-skills analysis. Agent Skills has a documented skill anatomy spec and mandatory verification checklists. Plan Forge skills have a consistent implicit format but no formal spec, and not all skills end with verifiable exit criteria.

### S1. Skill Blueprint Spec (`docs/SKILL-BLUEPRINT.md`)

**What**: A formal specification document for the Plan Forge skill format — the blueprint that skill authors (internal and extension contributors) follow when creating new skills.

**Why**: Plan Forge has 12+ skills per preset, and the extension ecosystem invites third-party contributions. Without a formal spec, contributors reverse-engineer the format from existing skills. A blueprint ensures consistency and lowers the barrier for community skill authoring.

**Plan Forge Skill Blueprint** (extended format):

```
SKILL.md
├── Frontmatter
│   ├── name (kebab-case, matches directory)
│   ├── description (what + when trigger)
│   ├── argument-hint (optional CLI-style usage hint)
│   └── tools (MCP tools / VS Code tools this skill uses)
├── Trigger (natural language phrases that activate the skill)
├── Steps (numbered workflow with validation between steps)
├── Safety Rules (invariants — what the skill must never do)
├── Temper Guards (NEW — excuses agents use to shortcut this skill + rebuttals)
├── Warning Signs (NEW — behavioral indicators the skill is being violated)
├── Exit Proof (NEW — verifiable checklist confirming the skill completed correctly)
└── Persistent Memory (OpenBrain search-before / capture-after hooks)
```

**New sections explained**:
- **Temper Guards** — same format as instruction files but scoped to this skill's workflow. E.g., for `/database-migration`: "I'll just edit the model, no migration needed" → "Schema changes without migrations break other environments."
- **Warning Signs** — behavioral patterns indicating the skill's process was circumvented.
- **Exit Proof** — checklist of evidence requirements. Every checkbox must be verifiable with output (test results, build log, command output). Replaces vague "make sure it works" with "paste the output of `dotnet test` showing N tests pass."

**Effort**: ~4 hours (spec doc + update 4–5 existing skills as reference implementations)  
**Acceptance criteria**:
- `docs/SKILL-BLUEPRINT.md` published
- Updated `CUSTOMIZATION.md` links to it
- 4+ existing skills updated with Temper Guards, Warning Signs, and Exit Proof sections
- Extension `PUBLISHING.md` references the blueprint for skill contributions

### S2. Exit Proof in Existing Skills

**What**: Add `## Exit Proof` sections to all existing shared and stack-specific skills. Each proof is a checklist of verifiable evidence.

**Why**: Skills currently end with a "Report" section that summarizes output. But there's no formal "did this skill actually complete?" gate. Exit Proof makes skill completion binary — either you have the evidence or you don't.

**Example for `/database-migration`**:
```markdown
## Exit Proof

After completing this skill, confirm:
- [ ] Migration file exists in the expected directory
- [ ] `dotnet ef migrations list` (or equivalent) shows the new migration
- [ ] `dotnet ef database update` completes without errors
- [ ] Application builds successfully after migration
- [ ] At least one test exercises the new schema (query or seed)
- [ ] No `TODO` or `FIXME` markers in migration file
```

**Example for `/test-sweep`**:
```markdown
## Exit Proof

- [ ] All test suites executed (paste command + output summary)
- [ ] Zero test failures (or all failures explained with linked issues)
- [ ] Coverage report generated (if configured)
- [ ] No skipped tests without documented reason
```

**Skills to update**: All 12+ shared/stack skills (health-check, forge-execute, forge-troubleshoot, security-audit, database-migration, staging-deploy, test-sweep, dependency-audit, code-review, release-notes, api-doc-gen, onboarding)

**Effort**: ~3 hours  
**Acceptance criteria**:
- Exit Proof section in all shared skills
- Stack-specific skills have framework-appropriate proof commands
- Each checklist has 4–6 concrete, paste-the-output items

### S3. Temper Guards in Existing Skills

**What**: Add `## Temper Guards` sections to skills that have the highest risk of agent shortcuts.

**Why**: Skills define multi-step procedures. Agents are tempted to collapse steps ("I'll combine the migration and the seed data"), skip validation ("the build passed, no need to run tests separately"), or defer work ("I'll add the rollback logic later"). Temper Guards in skills catch these within the workflow itself.

**Skills to enhance** (highest shortcut risk):

| Skill | Key Temper Guards |
|-------|-------------------|
| `/database-migration` | "I'll just edit the model directly" / "Rollback migration isn't needed" / "Seed data can wait" |
| `/staging-deploy` | "It works locally, skip staging" / "Health check endpoint isn't needed yet" / "I'll add monitoring after launch" |
| `/security-audit` | "This scan is probably all false positives" / "We'll fix the medium findings later" / "Test files don't need security review" |
| `/code-review` | "The tests pass, so the code is fine" / "This change is too small to review" / "I wrote it, I can review it" |
| `/test-sweep` | "Skipped tests are probably flaky" / "80% coverage is good enough" / "Integration tests cover the unit tests" |

**Effort**: ~2 hours  
**Acceptance criteria**:
- Temper Guards in 5+ skills
- Each table has 3–5 entries with concrete rebuttals specific to that skill's domain

**Doc Sweep** (update after S1–S3 are live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Update skill description to mention Exit Proof and Temper Guards |
| `docs/capabilities.md` | Human/AI docs | Document Skill Blueprint format; update skill feature list |
| `docs/capabilities.html` | Website | Update skills section |
| `CUSTOMIZATION.md` | Human docs | Link to SKILL-BLUEPRINT.md; document how to add Temper Guards to custom skills |
| `docs/EXTENSIONS.md` | Human docs | Reference blueprint for extension skill contributions |
| `extensions/PUBLISHING.md` | Human docs | Add SKILL-BLUEPRINT.md as required reading for skill submissions |
| `docs/manual/extensions.html` | Website / Manual | Update skill authoring section |
| `CHANGELOG.md` | Release notes | Document S1–S3 |

**MCP & Capabilities Sweep** (update after S1–S3 are live):
| File | What to Update |
|------|----------------|
| `pforge-mcp/capabilities.mjs` → `skills` | Update skill descriptions to mention Exit Proof and Temper Guards as standard sections |
| `pforge-mcp/capabilities.mjs` → `skills` | If any new skills are added, update the skills object and counts |
| `docs/capabilities.md` | Document Skill Blueprint as the canonical skill format spec |
| `docs/capabilities.html` | Mirror capabilities.md updates |
| `docs/.well-known/plan-forge.json` | Update skill feature descriptions |
| `docs/llms.txt` | Mention Skill Blueprint and Exit Proof |

**Dashboard Sweep**: No dashboard changes — v2.19 is skill-layer enhancements.

### v2.19 Release Gate

Before tagging v2.19.0:

- [ ] `docs/SKILL-BLUEPRINT.md` published with full format specification
- [ ] 4+ existing skills updated with Temper Guards, Warning Signs, and Exit Proof sections
- [ ] All shared skills have Exit Proof checklists with verifiable evidence requirements
- [ ] 5+ skills have Temper Guards with domain-specific rebuttals
- [ ] `CUSTOMIZATION.md` links to SKILL-BLUEPRINT.md
- [ ] `extensions/PUBLISHING.md` references the blueprint for skill contributions
- [ ] `pforge-mcp/capabilities.mjs` updated with new skill features
- [ ] `docs/capabilities.md` and `docs/capabilities.html` updated
- [ ] `VERSION` bumped to `2.19.0`
- [ ] `CHANGELOG.md` updated with all S1–S3 items

---

## v2.20 — Forge Quench (Code Simplification Skill)

> **Source**: Agent Skills' `code-simplification` skill based on Chesterton's Fence, Rule of 500, and complexity preservation. Plan Forge has review agents that flag complexity but no dedicated simplification workflow.

**What**: A new shared skill `/forge-quench` that systematically reduces code complexity while preserving exact behavior. Named after the metallurgical quenching process — rapidly cooling hot metal simplifies its crystal structure and hardens it.

**When to use**: After a feature is complete and tests pass, but before the Review Gate. Code works but is harder to read or maintain than it should be.

**Workflow**:
1. **Measure** — calculate cyclomatic complexity of changed files; identify the top 3-5 most complex functions
2. **Understand first** (Chesterton's Fence) — before simplifying any code, document *why* the complexity exists. If the reason is still valid, leave it. If the reason is gone, simplify.
3. **Propose** — generate before/after diffs for each simplification with rationale
4. **Prove** — run full test suite after each change to verify behavior unchanged
5. **Report** — complexity delta, files changed, test results, functions simplified

**Safety rails**:
- NEVER simplify code you don't understand — always document the "why" first
- NEVER combine simplification with feature changes — one concern per commit
- ALWAYS run tests after each simplification — not just at the end
- STOP if any test fails — revert the simplification, don't fix the test

**Temper Guards**:
| Shortcut | Why It Breaks |
|----------|--------------|
| "This code is obviously redundant — just delete it" | Chesterton's Fence: understand before removing. It may handle an edge case you haven't seen. |
| "I'll simplify and add the feature at the same time" | Mixed commits make revert impossible. Simplify first, commit, then add the feature. |
| "The tests still pass so the simplification is safe" | Tests may not cover the behavior the complexity protected. Check coverage of the specific function. |
| "This whole class can be replaced with a utility function" | If it's used in multiple places, you're creating a God utility. Prefer targeted simplification. |

**Exit Proof**:
- [ ] Complexity metrics reduced (paste before/after scores)
- [ ] All tests pass (paste test output)
- [ ] No behavior changes (same inputs produce same outputs)
- [ ] Each simplification committed separately with rationale in commit message
- [ ] No new TODO/FIXME/HACK markers introduced

**Effort**: ~5 hours (skill file + stack variants for complexity measurement commands)  
**Roadmap fit**: v2.20 — follows naturally after v2.19's Skill Blueprint and Exit Proof foundation.

**Doc Sweep** (update after feature is live):
| File | Type | What to Update |
|------|------|----------------|
| `README.md` | Human docs | Add `/forge-quench` to Skills table; update skill count |
| `docs/CLI-GUIDE.md` | Human docs | (if CLI wrapper added) Add `quench` command |
| `docs/capabilities.md` | Human/AI docs | Add to Skills table; update count |
| `docs/capabilities.html` | Website | Add to skills section |
| `docs/index.html` | Website | Update skill count |
| `templates/copilot-instructions.md.template` | Template | Add `/forge-quench` to Skill Slash Commands table |
| `CHANGELOG.md` | Release notes | Document new skill |

**MCP & Capabilities Sweep** (update after feature is live):
| File | What to Update |
|------|----------------|
| `pforge-mcp/capabilities.mjs` → `skills` | Add `/forge-quench` with description to the skills object |
| `pforge-mcp/capabilities.mjs` → `presets.counts` | Increment skill counts for all app presets (e.g., dotnet: skills 8→9) |
| `pforge-mcp/tools.json` | If `forge_run_skill` examples reference skills, add `forge-quench` |
| `docs/capabilities.md` | Add `/forge-quench` to Skills table; update total skill count |
| `docs/capabilities.html` | Mirror capabilities.md updates |
| `docs/.well-known/plan-forge.json` | Update `skills` count |
| `docs/llms.txt` | Update skill count |
| `plugin.json` | Update description with new skill count |

**Dashboard Sweep**:
| Tab / Component | File | What to Update |
|-----------------|------|----------------|
| **Skills** tab — Skill Catalog | `app.js` → Extension / Skills section | Add `forge-quench` to built-in skill grid with description |

### v2.20 Release Gate

Before tagging v2.20.0:

- [ ] `presets/shared/skills/forge-quench/SKILL.md` exists with full Blueprint format (Temper Guards, Warning Signs, Exit Proof)
- [ ] Stack-specific variants have correct complexity measurement commands per framework
- [ ] Skill follows Chesterton's Fence principle — `## Understand First` step is mandatory before any simplification
- [ ] All tests pass after running `/forge-quench` on test fixtures
- [ ] `pforge-mcp/capabilities.mjs` skill counts updated
- [ ] `docs/capabilities.md` and `docs/capabilities.html` updated
- [ ] Agent adapters updated: Claude, Cursor, Codex, Gemini, Windsurf, Generic all include `/forge-quench`
- [ ] `validate-setup.ps1` / `validate-setup.sh` expected skill counts updated
- [ ] `VERSION` bumped to `2.20.0`
- [ ] `CHANGELOG.md` updated

---

## Backlog

These are planned but not yet prioritized into a version:

### Security & Compliance
- Preset-specific validation minimum count checks in `validate-setup`

### Agent Expansion

*(all planned adapters shipped)*

### Stack Expansion
- *(all planned stacks shipped)*

### Extension Ecosystem
- Dual-publish extensions to Spec Kit catalog
- Auto-update notification when source version is newer

### Community & Docs
- `specify init` detection — auto-detect Spec Kit project and layer Plan Forge guardrails on top
- **Interactive User Manual** (`docs/manual/`) — structured web-based reference book with TOC, chapter navigation, client-side search, screenshots, Mermaid diagrams. Consolidates README, AGENT-SETUP, CLI-GUIDE, CUSTOMIZATION, COPILOT-VSCODE-GUIDE, walkthroughs, FAQ, and demos into ~13 navigable chapters. Vanilla HTML (matches existing site), zero build dependencies. Plan: `docs/manual/book-manual-plan.md`

### Enterprise
- **Web UI** for plan visualization and status tracking → ✅ shipped as `/ui` in v2.13.0

### Shipped (Backlog Items)
- ✅ **Agent-per-slice routing** — model-performance.json drives auto-selection; success rate shown in --estimate
- ✅ **OpenBrain deep context** — project history injected into worker prompts before each slice
- ✅ **Spec Kit auto-detect** — `setup.ps1`/`setup.sh` detect `specs/` + `constitution.md` and set `speckit: true`
- ✅ **Dual-publish extensions** — `pforge ext publish` outputs Plan Forge + Spec Kit catalog entries
- ✅ **Web UI** — read-only plan browser at `localhost:3100/ui` with DAG view
- ✅ **Quorum Analysis** — `pforge analyze --quorum`, `pforge diagnose --quorum`, `/code-review --quorum`, API provider abstraction (xAI, OpenAI)
- ✅ **Image Generation** — `forge_generate_image` MCP tool, WebP/AVIF conversion via sharp, magic byte detection
- ✅ **Expanded Smith Diagnostics** — MCP deps, dashboard assets, lifecycle hooks, extensions catalog, VERSION sync
- ✅ **`/security-audit` skill** — OWASP + dependency audit + secrets detection, 7 stack variants
- ✅ **Gemini CLI adapter** — GEMINI.md + .gemini/commands/*.toml + settings.json
- ✅ **Rust preset** + **PHP/Laravel preset** — 98 files each, auto-detect
- ✅ **Extension registry** — `pforge ext publish` + live catalog on extensions.html
- ✅ **Community walkthroughs** — greenfield Todo API + brownfield legacy security fix
- ✅ **Swift/iOS preset** — 49 files, auto-detect via Package.swift/xcodeproj
- ✅ **Windsurf adapter** — `.windsurf/rules/*.md` with trigger frontmatter + workflows
- ✅ **Generic agent** — `--agent generic --commands-dir <path>` for any AI tool

---

## Under Consideration

No committed timeline — evaluating based on community feedback:

- ~~**Multi-model prompt variants**~~ → shipped as "Tuning for Different Models" in CUSTOMIZATION.md

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
