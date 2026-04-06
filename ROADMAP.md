# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v2.10.0** (2026-04-06) — OpenClaw Bridge: Telegram/Slack/Discord notifications, approval gate state machine, 4 platform formatters. Plus: Security Audit skill, Gemini CLI adapter, Rust + PHP presets, community walkthroughs, extension registry.

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
- **`quorum-mode=auto`** — slices scoring ≥7 automatically use quorum; others run normally (configurable threshold)
- **Full guardrail compliance** — dry-run workers load all instructions.md, project profile, and principles (same as primary workers)
- **Telemetry integration** — quorum legs modeled as child spans in trace.json; cost tracked per-leg
- **Dashboard indicators** — quorum status visible on Progress tab; dry-run responses browsable in Replay tab
- **Configuration** — `.forge.json` `quorum` block: `enabled`, `auto`, `threshold`, `models[]`, `reviewerModel`

### v2.6 — OpenClaw Bridge ✅

Shipped in v2.10.0. Telegram/Slack/Discord webhook notifications, approval gate state machine, 4 platform formatters, REST endpoints.
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

### Security & Compliance
- **`/security-audit` skill** — multi-step security procedure: run security reviewer across all files, dependency audit, secrets scan, produce combined security report with severity ratings 🔜
- Preset-specific validation minimum count checks in `validate-setup`

### Agent Expansion
- **Gemini CLI adapter** (requires TOML format — different from Markdown adapters) 🔜
- Windsurf adapter
- Generic bring-your-own-agent pattern (`--agent generic --commands-dir <path>`)

### Stack Expansion
- **Rust preset** (`presets/rust/`) 🔜
- **PHP / Laravel preset** (`presets/php/`) 🔜
- Swift / iOS preset (`presets/swift/`)

### Extension Ecosystem
- **Extension registry/website** for discoverability 🔜
- Dual-publish extensions to Spec Kit catalog
- Auto-update notification when source version is newer

### Community & Docs
- **Community walkthroughs** — greenfield and brownfield worked examples 🔜
- `specify init` detection — auto-detect Spec Kit project and layer Plan Forge guardrails on top

### Enterprise
- **Team dashboard** for multi-developer plan coordination
- **Web UI** for plan visualization and status tracking

### Shipped (Backlog Items)
- ✅ **Quorum Analysis** — `pforge analyze --quorum`, `pforge diagnose --quorum`, `/code-review --quorum`, API provider abstraction (xAI, OpenAI)
- ✅ **Image Generation** — `forge_generate_image` MCP tool, WebP/AVIF conversion via sharp, magic byte detection
- ✅ **Expanded Smith Diagnostics** — MCP deps, dashboard assets, lifecycle hooks, extensions catalog, VERSION sync

---

## Under Consideration

No committed timeline — evaluating based on community feedback:

- ~~**Multi-model prompt variants**~~ → shipped as "Tuning for Different Models" in CUSTOMIZATION.md

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
