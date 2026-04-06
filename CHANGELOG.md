# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [2.9.1] — 2026-04-06

### Added — Security Audit Skill (Phase 12)
- **`/security-audit` skill** — 4-phase comprehensive security procedure: OWASP Top 10 vulnerability scan, dependency audit, secrets detection (13 regex patterns), and combined severity-rated report
- **6 variants**: shared base + TypeScript (npm audit), Python (pip-audit), .NET (dotnet list --vulnerable), Go (govulncheck), Java (mvn dependency-check)
- **Stack-specific OWASP checks**: prototype pollution (Node.js), pickle injection (Python), BinaryFormatter (C#), race conditions (Go), JNDI injection (Java)
- **Quorum support**: 3-model independent OWASP scan with synthesized findings
- Registered in copilot-instructions.md template and all agent adapters (Claude, Cursor, Codex, Gemini)

### Added — Gemini CLI Adapter (Phase 13)
- **`-Agent gemini`** — new adapter generates `GEMINI.md` (project context + `@import` guardrails), `.gemini/commands/planforge/*.toml` (all prompts + agents as TOML commands), `.gemini/settings.json` (MCP server config)
- Gemini CLI uses `@file.md` import syntax for instruction files instead of embedding (lighter context, auto-updated)
- Commands use TOML format with `prompt = """..."""` multi-line strings
- Pipeline commands invoked as `/planforge:step0-specify`, `/planforge:step3-execute-slice`, etc.
- `-Agent all` now includes gemini (5 agents total: copilot, claude, cursor, codex, gemini)

### Added — Community Walkthroughs (Phase 14)
- **Greenfield walkthrough** (`docs/walkthroughs/greenfield-todo-api.md`) — build a Todo API from scratch using the full pipeline: setup, specify, harden, execute, review, ship. Shows guardrails auto-loading, validation gates catching errors, and independent review finding gaps
- **Brownfield walkthrough** (`docs/walkthroughs/brownfield-legacy-app.md`) — add Plan Forge to a legacy Express app with SQL injection, hardcoded secrets, and no tests. Shows security audit, incremental fixes, and consistency scoring going from 0 to 88
- **Examples page updated** — walkthrough cards on `docs/examples.html` with links to both guides

### Added — Stack Expansion
- **Rust preset** (`presets/rust/`) — 49 files: tokio/axum patterns, cargo-audit, ownership/borrowing checks, `Cargo.toml` auto-detection
- **PHP/Laravel preset** (`presets/php/`) — 49 files: Laravel patterns, composer audit, mass assignment/CSRF checks, `composer.json`/`artisan` auto-detection

---

## [2.9.0] — 2026-04-06

### Fixed — Bug Fixes (Phase 11)
- **B1**: Fixed notification hook — WebSocket events now correctly trigger toast notifications for `run-completed` and `slice-failed` (previously the monkey-patch was never applied)
- **B2**: Fixed cost export dropdown positioning — menu now anchors correctly via relative parent container
- **B3**: Fixed keyboard j/k edge case — `selectedRunIdx` now guards against empty rows and -1 initial state
- **B4**: Fixed MCP server version — updated from stale `2.6.0` to match VERSION file
- **B5**: Fixed memory search — replaced stub/placeholder response with real local file search across `.forge/` and `docs/plans/`

### Added — Dashboard Full Capability Surface (Phase 11)

#### Memory Search Redesign
- **Categorized presets** — 6 categories (Plans, Architecture, Config, Testing, Cost, Issues) with clickable chip buttons that auto-populate and submit searches
- **`GET /api/memory/presets`** — context-aware preset API that reads project config for relevant suggestions
- **Helpful empty states** — when no results, shows alternative query suggestions from presets
- **Result cards** — formatted with file path, line number, and excerpt instead of raw text

#### Hub Client Monitor
- **Client count badge** in header — polls `GET /api/hub` every 10s showing connected WebSocket client count
- **Auto-start/stop** — polling starts on WS connect, stops on disconnect

#### Runs Auto-Refresh
- Runs table automatically reloads when `run-started` or `run-completed` events arrive via WebSocket

#### Version Footer
- Dashboard footer shows Plan Forge version fetched from `/api/capabilities`

#### Plan Scope Contract
- **Scope Contract accordion** in Plan Browser — shows In Scope, Out of Scope, and Forbidden file lists
- **`GET /api/plans`** response now includes `scopeContract` and per-slice metadata (tasks, buildCommand, testCommand, depends, parallel, scope)

#### Slice Task Detail
- Run Detail Drawer shows expandable **Tasks & commands** section per slice — task list, build command, test command

#### Resume From Slice
- **Resume button** appears in Run Detail Drawer when a run has failed slices — "Resume from Slice N" skips completed slices

#### Config Advanced Settings
- **Advanced Settings** panel: max parallelism, max retries, run history limit
- **Quorum Settings**: enable/disable, complexity threshold (1-10), model list
- **Worker Detection**: `GET /api/workers` endpoint + display in Config and Launch panels

#### Run Launch Panel
- **Launch Plan modal** from Actions tab — pick plan, mode (auto/assisted), model, quorum toggle
- **Estimate First** button for cost preview before execution
- **Worker detection** shows available CLI workers and API providers in the modal

#### Duration Chart
- **Duration Per Run** bar chart in Cost tab — color-coded (blue <2min, amber 2-5min, red >5min)

#### Cost CSV Export
- Cost export dropdown now offers both **JSON** and **CSV** formats

#### Event History Log
- **Event Log** collapsible panel on Progress tab — scrollable list of all WebSocket events with timestamps, color-coded by type, auto-tailing during active runs

#### Trace Span Search
- **Search input** in Traces tab — filters spans by name, attributes, or log summary content in real time

#### DAG Dependency Visualizer
- **DAG View** accordion in Plan Browser — shows slice dependency tree with `[P]` parallel tags and `→` dependency arrows

#### Tab Badges
- **Active badges** on tab buttons: Runs (new run count), Cost (anomaly indicator), Skills (active execution count)
- Badges clear when visiting the respective tab

#### Auto-Scroll
- Progress tab auto-scrolls to currently executing slice card during active runs

#### Elapsed Time on Executing Slices
- Executing slice cards show a live **elapsed timer** counting seconds

#### Notification Sound
- Optional audio cue on `run-completed` and `slice-failed` events (respects localStorage `pf-sound` preference)

---

## [2.8.0] — 2026-04-06

### Added — Dashboard Power UX (Phase 10)

#### Run Detail Drawer
- **Side-panel drawer** — click any run row to slide open a 480px drawer showing per-slice detail cards with status icon, worker badge, tokens, cost, gate errors, failed commands, and expandable gate output
- **`GET /api/runs/:runIdx` endpoint** — returns summary.json + all slice-*.json for a single run

#### Filter Bar + Sortable Columns
- **5-filter bar** on Runs tab — filter by plan, status, model, mode, and date range with AND logic
- **Sortable columns** — click any column header to cycle asc → desc → default sort; indicator arrows show current direction
- **Runs counter** — shows filtered/total count in real time

#### Cost Trend + Anomaly Detection
- **Cost trend line chart** — Chart.js line chart plots per-run cost with a dashed average line
- **Anomaly color coding** — points colored green (≤2× avg), amber (2-3×), red (>3×)
- **Anomaly banner** — auto-appears when any of the latest 5 runs exceeds 3× historical average; dismissable

#### Run Comparison
- **Compare mode** — toggle Compare, select 2 runs, view side-by-side cards with cost/duration/token deltas
- **Delta color coding** — green for lower values, red for higher values between runs

#### Quorum Visualization
- **Quorum banner** in Traces waterfall — shows model legs, success rate, and dispatch duration for quorum-enabled runs
- **Per-span quorum badges** — slice spans show 🔮 indicator with leg counts
- **Quorum detail panel** — click a quorum span to see complexity score, threshold, models, leg status, dispatch time, reviewer cost
- **`GET /api/traces/:runId` enhanced** — now attaches quorum data from slice-N-quorum.json files

#### Plan Slice Toggle
- **Per-slice checkboxes** in Plan Browser — expand "Select slices" to toggle individual slices on/off before running
- Unchecked slices passed as `--skip-slices` argument to the executor

#### Skill Catalog
- **Skill catalog grid** in Skills tab — shows all available skills (built-in + custom from .github/skills/)
- **`GET /api/skills` endpoint** — scans custom skills directory and returns combined list with built-in skills
- Custom skills tagged with blue "custom" badge; built-in with gray "built-in" badge

#### Export
- **JSON + CSV export** for run history from the Runs tab via dropdown menu
- **Cost data export** as JSON from the Cost tab
- Exports respect active filters — only matching runs are exported

#### Keyboard Navigation
- **Global shortcuts** — `1`-`9` switch tabs, `j`/`k` navigate rows, `Enter` opens detail, `Esc` closes panels
- **Shortcuts modal** — press `?` to see all available keyboard shortcuts
- **Visual focus indicator** — selected row highlighted with blue outline

#### Theme Toggle
- **Light/dark theme switch** — header toggle button persists preference in localStorage
- Chart axis colors and backgrounds adapt to theme automatically

#### Responsive Layout
- **Tablet breakpoint** (1024px) — Mode/Model columns hidden, grid layouts adjusted
- **Mobile breakpoint** (768px) — single-column layout, date filters hidden, filter bar wraps

#### Enhanced Span Attributes
- **Formatted attribute table** — span detail now renders a proper table with friendly labels instead of raw JSON
- **Expandable log summaries** — log entries shown in collapsible `<details>` blocks
- **Structured event rendering** — events display per-event attributes with severity color coding

### Changed
- Runs tab fully rewritten — now power-user oriented with filter/sort/compare/export
- Cost tab enhanced — trend chart + anomaly detection + export added alongside existing donut/bar charts
- Traces waterfall enhanced — quorum banners, per-span badges, formatted attribute detail
- Skills tab enhanced — skill catalog grid above execution timeline
- Plan Browser enhanced — per-slice toggle checkboxes before run
- Updated dashboard.html documentation with all v2.8 feature descriptions
- Added vendor prefix for user-select CSS (Safari compatibility)

---

## [2.7.0] — 2026-04-06

### Added — Dashboard Enhancements (Phase 9)

#### Plan Browser
- **Plan file browser** in Progress tab — lists all `Phase-*-PLAN.md` files with status icons, slice count, and branch name
- **Estimate** and **Run** buttons per plan — launch `run-plan --estimate` or full execution directly from the dashboard
- **`GET /api/plans` endpoint** — scans `docs/plans/` and returns parsed plan metadata

#### Git Operations
- **Create Branch** action card — prompts for branch name and creates a git branch from the plan's branch strategy
- **Auto-Commit** action card — generates a conventional commit message from the current slice goal
- **Diff** action card — shows changed files color-coded against the scope contract (green = in-scope, yellow = out-of-scope, red = forbidden)

#### Sweep Table
- **Structured sweep output** — TODO/FIXME/HACK/STUB markers rendered as a filterable table with File, Line, Type, and Text columns
- **Type badges** — color-coded by severity: TODO (blue), FIXME (amber), HACK (red), STUB (gray)
- **Filter buttons** — toggle visibility by type with live counts

#### Model Comparison
- **Model comparison table** in Cost tab — aggregates per-model performance: run count, pass rate (color-coded), average duration, average cost, total tokens
- Useful for comparing Claude vs Grok efficiency on your specific workloads

#### Phase Status Editor
- **Editable phase status** — Status action now renders phases with inline `<select>` dropdowns (planned → in-progress → complete → paused)
- Changes persist via `phase-status` CLI command

#### OpenBrain Memory Browser
- **Memory search panel** in Config tab — search project knowledge when OpenBrain MCP server is connected
- **`POST /api/memory/search` endpoint** — proxies search to OpenBrain's `search_thoughts` tool
- Results rendered as cards with titles and content excerpts

#### Extension Install/Uninstall
- **Install/Uninstall buttons** on extension cards — manage extensions without leaving the dashboard
- Installed extensions show a green checkmark with an Uninstall option
- Confirmation dialog on uninstall to prevent accidental removal

### Changed
- Actions tab now shows 11 cards (was 8) — added Create Branch, Auto-Commit, Diff
- Sweep button renders structured table instead of raw text
- Status button renders editable dropdowns instead of plain text
- Updated dashboard.html documentation with v2.7 feature descriptions and screenshots
- Updated capture-screenshots.mjs with v2.7 data injection for plan browser, model comparison, memory search, and extension install buttons

---

## [2.6.0] — 2026-04-06

### Added — Skill Slash Command Upgrade (Phase 8)

#### Tier 1 — MCP Integration & Modernization
- **De-duplicated 3 contaminated skills** — `dependency-audit`, `api-doc-gen`, `onboarding` were identical across all 5 presets with multi-stack commands. Each now has ONLY its stack's tools (40 files changed)
- **`tools:` frontmatter** — all 40 app-preset skills now declare required tool access in YAML frontmatter
- **Conditional step logic** — skills include "If step fails → skip/stop" patterns for intelligent flow control
- **MCP tool integration** — `/test-sweep` calls `forge_sweep`, `/code-review` calls `forge_analyze` + `forge_diff`, `/staging-deploy` calls `forge_validate`, `/onboarding` calls `forge_smith`
- **Structured reports** — all skills output pass/fail summary with counts

#### Tier 2 — New Skills & Hub Integration
- **`/health-check` skill** — chains `forge_smith` → `forge_validate` → `forge_sweep` into a structured diagnostic pipeline
- **`/forge-execute` skill** — guided wrapper: list plans → estimate cost → choose mode → execute → report results
- **Skill event schema** — 4 new event types: `skill-started`, `skill-step-started`, `skill-step-completed`, `skill-completed`
- **Dashboard Skills tab** — real-time timeline of skill executions with per-step status
- **`forge_skill_status` MCP tool** — query recent skill execution events from the hub

#### Tier 3 — Executable Skill Engine
- **`skill-runner.mjs`** — new module: parses SKILL.md frontmatter/steps/safety rules, executes steps with gate validation, emits events (29 self-tests passing)
- **`forge_run_skill` MCP tool** — execute any skill programmatically with dry-run mode, hub event broadcasting, and structured results

### Added — API Provider Abstraction & Quorum Analysis
- **API provider registry** — pattern-based model routing via `API_PROVIDERS` config. Models matching `/^grok-/` auto-route to xAI API via `callApiWorker()`. Extensible to any OpenAI-compatible endpoint
- **xAI Grok support** — `grok-4.20`, `grok-4`, `grok-3`, `grok-3-mini` available via `api.x.ai`. Requires `XAI_API_KEY` env var. Pricing integrated into cost tracking
- **`detectWorkers()` enhancement** — now reports both CLI workers (`gh-copilot`, `claude`, `codex`) and API workers (`api-xai`) with `type: "cli"|"api"` field
- **`spawnWorker()` API routing** — automatically routes API-backed models through HTTP before falling back to CLI workers
- **`forge_diagnose` MCP tool** — multi-model bug investigation. Dispatches file analysis to N models independently, then synthesizes root cause analysis with fix recommendations
- **`pforge diagnose <file> --models m1,m2` CLI command** — programmatic multi-model bug investigation from the command line
- **`forge_analyze` quorum enhancements** — `quorum` (boolean), `mode` (plan/file), and `models` (custom model list) parameters for multi-model consensus analysis
- **`pforge analyze --quorum --mode --models` CLI flags** — quorum consistency scoring with explicit mode and model overrides
- **`/code-review --quorum` skill** — all 5 preset code-review skills updated for multi-model code review via quorum infrastructure
- **`analyzeWithQuorum()`** — new orchestrator function supporting plan/file/diagnose modes with parallel model dispatch and reviewer synthesis
- **Grok model pricing** — grok-4.20 ($3/$15), grok-4 ($2/$10), grok-3 ($3/$15), grok-3-mini ($0.30/$0.50) per million tokens

### Fixed
- **UTF-8 BOM** — `pforge.ps1`, `setup.ps1`, `validate-setup.ps1` now have UTF-8 BOM for Windows PowerShell 5.1 compatibility (em-dashes, arrows, checkmarks, box-drawing were corrupted without BOM)

---

## [2.5.0] — 2026-04-05

### Added — Quorum Mode (Multi-Model Consensus)
- **Quorum dispatch** — fan out slice to 3 AI models (Claude Opus 4.6, GPT-5.3-Codex, Gemini 3.1 Pro) in parallel dry-run sessions, each producing a detailed implementation plan without executing code
- **Quorum reviewer** — synthesis agent merges dry-run responses into a unified execution plan, picking the best approach per file/component
- **Complexity scoring** — `scoreSliceComplexity()` rates slices 1-10 based on 7 weighted signals: file scope count, cross-module dependencies, security keywords, database/migration keywords, gate count, task count, and historical failure rate
- **Quorum auto mode** — `--quorum=auto` triggers quorum only for slices scoring ≥ threshold (default: 7). Low-complexity slices run normally, saving tokens
- **CLI flags** — `--quorum` (force all slices), `--quorum=auto` (threshold-based), `--quorum-threshold N` (override threshold)
- **MCP tool** — `forge_run_plan` accepts `quorum` ("false"/"true"/"auto") and `quorumThreshold` parameters
- **Config** — `.forge.json` `quorum` block: `enabled`, `auto`, `threshold`, `models[]`, `reviewerModel`, `dryRunTimeout`
- **Cost tracking** — tokens tracked per dry-run leg + reviewer + execution. `--estimate --quorum` shows overhead breakdown
- **Telemetry** — quorum legs modeled as CLIENT child spans in `trace.json`; events: `quorum-dispatch-started`, `quorum-leg-completed`, `quorum-review-completed`
- **Graceful degradation** — <2 successful dry-runs falls back to normal execution. Reviewer failure uses best single response
- **Capabilities** — `quorum-execute` workflow, quorum config in schema, 6 new glossary terms, updated CLI examples
- **83 self-tests** passing (was 65), including complexity scoring + config tests

## [2.4.0] — 2026-04-05

### Added — Unified Telemetry
- **`pforge-mcp/telemetry.mjs`** — OTLP-compatible trace/span/log capture. Every run produces `trace.json` with resource context, span kinds (SERVER/INTERNAL/CLIENT), severity levels, and log summaries.
- **Log Registry** — per-run `manifest.json` + global `index.jsonl` (append-only, corruption-tolerant). Dashboard reads index for instant run listing.
- **Dashboard Traces tab** — waterfall timeline with span detail panel, severity filters (All/Errors/Warnings), span attributes viewer
- **REST API** — `GET /api/traces` (list runs from index), `GET /api/traces/:runId` (trace detail)
- **Log rotation** — `maxRunHistory` config in `.forge.json` (default: 50), auto-prunes oldest runs

## [2.3.0] — 2026-04-05

### Added — Machine-Readable API Surface
- **`forge_capabilities`** MCP tool (14th tool) — returns full capability surface: enriched tools with semantic metadata, CLI schema, workflow graphs, config schema, dashboard info
- **`pforge-mcp/capabilities.mjs`** — enriched metadata for all 14 tools: intent tags, prerequisites, produces/consumes, side effects, cost hints, error catalog with recovery hints
- **Workflow graphs** — 4 tool-chaining sequences: execute-plan, diagnose-project, plan-and-execute, review-run
- **`tools.json` + `cli-schema.json`** — auto-generated on server startup (always in sync)
- **`.well-known/plan-forge.json`** — HTTP discovery endpoint + `GET /api/capabilities` REST equivalent
- **Operational metadata** — version compatibility, deprecation signals, rate limit hints, operation ID aliases

---

## [2.0.0] — 2026-04-04

### Added — Autonomous Execution (v2.0)
- **`forge_run_plan`** MCP tool + `pforge run-plan` CLI command — one-command plan execution with DAG-based slice orchestration, `gh copilot` CLI worker spawning, validation gates at every boundary, token tracking from JSONL output, model routing from `.forge.json`, auto-sweep + auto-analyze, session log capture, cost estimation, and resume-from support
- **`forge_abort`** MCP tool — signal abort between slices during plan execution
- **`forge_plan_status`** MCP tool — read latest run status from `.forge/runs/`
- **`forge_cost_report`** MCP tool — cost tracking report with total spend, per-model breakdown, and monthly aggregation from `.forge/cost-history.json`
- **Cost calculation engine** — per-slice cost from token counts using embedded model pricing table (23 models), cost breakdown in `summary.json`, cost history aggregation across runs
- **Historical estimation** — `--estimate` uses historical average tokens per slice when cost history exists, falls back to heuristic; shows confidence level
- **WebSocket Hub** (`pforge-mcp/hub.mjs`) — real-time event broadcasting for live progress monitoring. Localhost-only WS server (port 3101) with port fallback, heartbeat, session registry, event history buffer (last 100 events), versioned events (v1.0)
- **Event Schema** (`pforge-mcp/EVENTS.md`) — documented event types: `run-started`, `slice-started`, `slice-completed`, `slice-failed`, `run-completed`, `run-aborted`
- **Live orchestrator events** — when hub is running, `forge_run_plan` broadcasts slice lifecycle events to all connected WebSocket clients in real-time
- **Dashboard** (`pforge-mcp/dashboard/`) — real-time monitoring UI at `localhost:3100/dashboard`. Vanilla JS + Tailwind CDN + Chart.js. No build step. Features: live slice progress cards, run history table, cost tracker with charts, quick actions panel (Smith, Sweep, Analyze, Status, Validate, Extensions)
- **REST API** — Express endpoints: `GET /api/status`, `GET /api/runs`, `GET /api/config`, `POST /api/config`, `GET /api/cost`, `POST /api/tool/:name`, `GET /api/hub`, `GET /api/replay/:run/:slice`
- **Session Replay** — dashboard tab to browse and filter agent session logs per slice (errors, file ops, full log)
- **Extension Marketplace UI** — visual catalog browser with search/filter
- **Notification Center** — bell icon with persistent notifications (localStorage), auto-notifies on run-complete and slice-failed
- **Config Editor** — visual editor for `.forge.json` (agents, model routing) with save confirmation
- **Parallel Execution** — `[P]`-tagged slices execute concurrently via `ParallelScheduler` (up to configurable `maxParallelism`, default: 3). DAG-aware: respects dependencies, merge points, and scope-based conflict detection
- **Scope Conflict Detection** — warns and falls back to sequential when parallel slices have overlapping file scopes
- **Execution modes** — Full Auto (`gh copilot` CLI with any model) and Assisted (human codes in VS Code, orchestrator validates gates)
- **`.forge/SCHEMA.md`** — documents all `.forge/` files with formats, schemas, and ownership

---

## [Unreleased — v1.3.0]

### Added
- **`pforge smith`** — Forge-themed diagnostic command that inspects environment, VS Code config, setup health, version currency, and common problems with actionable FIX suggestions (PowerShell + Bash parity)
- **Plan Forge Validate GitHub Action** (`srnichols/plan-forge-validate@v1`) — Composite action for CI plan validation: setup health, file counts, placeholders, orphan detection, plan artifacts, completeness sweep
- **Multi-agent support** — `-Agent` (PowerShell) / `--agent` (Bash) parameter on setup scripts. Supports `claude`, `cursor`, `codex`, or `all` alongside the default Copilot files
  - Claude Code: rich `CLAUDE.md` (project context + all 16 guardrail files embedded by domain) + `.claude/skills/` (all prompts + all reviewer agents as invocable skills)
  - Cursor: rich `.cursor/rules` (project context + all guardrails) + `.cursor/commands/` (all prompts + all reviewer agents as commands)
  - Codex CLI: `.agents/skills/` (all prompts + all reviewer agents as skills)
  - Smart guardrail instructions emulate Copilot's auto-loading, post-edit scanning, and forbidden path checking
- `.forge.json` now records configured agents in an `agents` field
- `pforge smith` detects and validates agent-specific file paths
- **MCP Server** (`pforge-mcp/server.mjs`) — Node.js MCP server exposing 14 forge tools. Auto-generates `.vscode/mcp.json` and `.claude/mcp.json` during setup. Composable with OpenBrain.
- **Extension ecosystem** — `pforge ext search`, `pforge ext add <name>`, `pforge ext info <name>` commands with `extensions/catalog.json` community catalog (Spec Kit catalog-compatible format)
- **Cross-artifact analysis** (`pforge analyze`) — Consistency scoring across requirements, scope, tests, and validation gates. Four dimensions (traceability, coverage, test coverage, gates) scored 0–100. CI integration via `plan-forge-validate@v1` with `analyze` input.
- **Spec Kit comparison FAQ** — Honest side-by-side guidance on when to use Spec Kit vs Plan Forge

---

## [1.2.2] — 2026-04-02

### Added
- **`azure-iac` preset** — Azure Bicep / Terraform / PowerShell / azd with 12 IaC-specific instruction files: `bicep`, `terraform`, `powershell`, `azd`, `naming`, `security`, `testing`, `deploy`, `waf`, `caf`, `landing-zone`, `policy`
- **`azure-sweeper` agent** — 8-layer enterprise governance sweep: WAF → CAF → Landing Zone → Policy → Org Rules → Resource Graph → Telemetry → Remediation codegen
- **WAF / CAF / Landing Zone / Policy instruction files** — Azure Well-Architected Framework, Cloud Adoption Framework, and Azure Landing Zone baselines; Azure Policy enforcement rules
- **3 azure-iac skills** — `/infra-deploy`, `/infra-test`, `/azure-sweep` slash commands
- **5 azure-iac agents** — `bicep-reviewer`, `terraform-reviewer`, `security-reviewer`, `deploy-helper`, `azure-sweeper`
- **6 azure-iac scaffolding prompts** — `new-bicep-module`, `new-terraform-module`, `new-pester-test`, `new-pipeline`, `new-azd-service`, `new-org-rules`
- **`azure-infrastructure` example extension** — for mixed app+infra repos using the `azure-iac` preset as an extension
- **Multi-preset support** — `setup.ps1 -Preset dotnet,azure-iac` and `setup.sh --preset dotnet,azure-iac` apply multiple presets in one pass; first preset sets `copilot-instructions.md` and `AGENTS.md`, subsequent presets add their unique files
- **`pforge.sh update`** — full `cmd_update()` bash implementation mirroring `pforge.ps1` `Invoke-Update`, with SHA256 hash comparison, preset-aware new-file delivery, and `--dry-run`/`--force` flags
- **Preset-aware `pforge update`** — both PS1 and SH update commands now deliver new preset-specific files (instructions, agents, prompts, skills) that don't yet exist in the project

### Fixed
- **Skills count corrected** — all presets ship with 8 skills (not 3); 5 additional skills (`dependency-audit`, `code-review`, `release-notes`, `api-doc-gen`, `onboarding`) were present in codebase but undocumented in counts
- **Instruction file count corrected** — 16 per app preset (not 15); `project-principles.instructions.md` was present but missing from totals (17 for TypeScript)
- **Prompt template count corrected** — 15 per app preset (not 14); `project-principles.prompt.md` was present but missing from count
- **Agent count corrected in AGENT-SETUP.md** — 18 per app preset installation (6 stack + 7 cross-stack + 5 pipeline), not 15
- **Update command preservation logic** — preset-aware update block now only ADDS new files; existing preset files (which may be user-customized) are never overwritten by either `pforge.ps1` or `pforge.sh`

### Changed
- `setup.ps1` and `setup.sh` wired for `azure-iac` auto-detection (`.bicep`, `bicepconfig.json`, `azure.yaml`, `*.tf` markers)
- `validate-setup.ps1` and `validate-setup.sh` have `azure-iac`-specific checks (`bicep.instructions.md`, `naming.instructions.md`, `deploy.instructions.md` instead of `database.instructions.md`)
- `AGENT-SETUP.md`, `docs/CLI-GUIDE.md`, README, CUSTOMIZATION.md, COPILOT-VSCODE-GUIDE.md all updated with correct counts, azure-iac tables, and multi-preset examples

---

## [1.2.1] — 2026-04-01

### Added
- **Claude Opus 4.6 prompt calibration** — softened aggressive STOP/MUST/HALT language across all pipeline prompts; Claude 4.6 is more responsive to instructions and overtriggers on aggressive phrasing
- **Few-shot examples in Step 0** — strong and weak specification examples (in `<examples>` tags) teach the model what good specs look like
- **MUST/SHOULD/MAY acceptance criteria** — structured format in Step 0 makes criteria mechanically testable and directly translatable to validation gates
- **Complexity estimation routing** — Step 0 now classifies work as Micro/Small/Medium/Large and recommends whether to skip, light-harden, or run the full pipeline
- **XML-structured spec output** — optional machine-readable `<specification>` block in Step 0 output for unambiguous downstream parsing
- **Plan quality self-check** — 7-point checklist in Step 2 catches broken plans before they enter execution (missing validation gates, unresolved TBDs, untraceable criteria)
- **Anti-hallucination directive** — `<investigate_before_coding>` block in Step 3 prevents the agent from assuming file contents without reading them
- **Anti-overengineering guard** — `<implementation_discipline>` block in Step 3 prevents adding features, abstractions, or error handling beyond what the slice requires
- **Context budget awareness** — slice templates now guide authors to list only domain-relevant instruction files (not all 15), reducing context window consumption
- **Lightweight re-anchor option** — 4 yes/no questions by default, full re-anchor every 3rd slice or on violation; saves ~500-1,000 tokens per clean slice
- **Session budget check** — Step 2 now flags plans with 8+ slices for session break points and slices with 5+ context files for trimming
- **Memory capture protocol** — Step 6 (Ship) now saves conventions, lessons learned, and forbidden patterns to `/memories/repo/` so future phases avoid past mistakes
- **Memory loading in Step 2** — hardening now reads `/memories/repo/` for prior phase lessons before scoping and slicing decisions
- **Claude 4.6 tuning section** — added to CUSTOMIZATION.md with guidance for over-halting, over-exploring, overengineering, context budgets, and effort parameter settings
- **Recommended plan template ordering** — Scope Contract and Stop Conditions first in hardened plans (most-referenced sections at top improves long-context performance)

## [1.1.0] — 2026-03-23

### Added
- **Project Principles** — workshop prompt with 3 paths: interview, starter sets, codebase discovery
- **External Specification Support** — optional spec source field in Scope Contract with traceability
- **Requirements Register** — optional REQ-xxx → slice mapping with bidirectional verification in Step 5
- **Branch Strategy** — trunk / feature-branch / branch-per-slice guidance with preflight checking
- **Extension Ecosystem** — `.forge/extensions/` directory, manifest schema, install/remove workflow
- **CLI Wrapper** (`pforge`) — init, check, status, new-phase, branch, ext commands
- **CLI Guide** — `docs/CLI-GUIDE.md` with dual-audience (human + AI agent) documentation
- **Extensions Guide** — `docs/EXTENSIONS.md` with structure, manifest, distribution channels
- **Lifecycle Hooks** — `.github/hooks/plan-forge.json` with SessionStart (inject principles), PreToolUse (enforce Forbidden Actions), PostToolUse (warn on TODO/FIXME markers)
- **Skill Slash Commands** — all 3 skills now have proper frontmatter for `/database-migration`, `/staging-deploy`, `/test-sweep` invocation
- **5 New Skills** — `/dependency-audit`, `/code-review`, `/release-notes`, `/api-doc-gen`, `/onboarding` (8 total per preset)
- **2 New Shared Agents** — `dependency-reviewer.agent.md` (supply chain security) and `compliance-reviewer.agent.md` (GDPR/CCPA/SOC2)
- **Agents vs Skills explainer** — README now explains the difference with comparison table
- **Auto-format hook** — PostToolUse auto-runs project formatter (dotnet format, prettier, ruff, gofmt) after every file edit
- **`pforge commit`** — auto-generates conventional commit messages from slice goals
- **`pforge phase-status`** — updates roadmap status icons without manual editing
- **Setup wizard asks for build/test/lint commands** — eliminates placeholder editing step
- **Stop hook** — warns when agent session ends with code changes but no test run detected
- **`pforge sweep`** — scan code files for TODO/FIXME/stub/placeholder markers from terminal
- **`pforge diff`** — compare changed files against plan's Scope Contract for drift detection
- **Monorepo FAQ** — documents `chat.useCustomizationsInParentRepositories` setting
- **Agent Plugin Packaging** — `plugin.json` at repo root for `Chat: Install Plugin From Source` installation
- **VS Code Checkpoints** — added as Option 0 in Rollback Protocol for beginners
- **CHANGELOG** — version history
- **CONTRIBUTING.md** — contribution guide
- **VERSION file** — version tracking read by setup scripts
- **"Start Here" path selector** — quick navigation at top of README
- **Documentation Map** — reading order after setup
- **Troubleshooting table** — common problems and fixes in README

### Changed
- Renamed project from "AI Plan Hardening Template" to **Plan Forge**
- Renamed CLI from `pharden` to `pforge`
- Renamed config directory from `.plan-hardening/` to `.forge/`
- Renamed config file from `.plan-hardening.json` to `.forge.json`
- Updated all documentation, scripts, and presets for consistent branding
- CUSTOMIZATION.md now starts with Project Principles before Project Profile
- AGENT-SETUP.md Section 5 now documents CLI and post-setup recommendations
- Placeholder validation now shows "TODO" instead of "WARN" for better clarity
- Setup scripts auto-run validation after completing

## [1.0.0] — 2026-03-01

### Added
- Initial release
- 6-step pipeline (Step 0–5) with 3-session isolation
- 5 tech stack presets (dotnet, typescript, python, java, go) + custom
- 15 instruction files per preset with `applyTo` auto-loading
- 14 prompt templates per preset for scaffolding
- 6 stack-specific + 5 shared agent definitions per preset
- 3 skills per preset (database-migration, staging-deploy, test-sweep)
- Pipeline agents with handoff buttons (plan-hardener → executor → reviewer-gate)
- Setup wizard with auto-detection (`setup.ps1` / `setup.sh`)
- Validation scripts (`validate-setup.ps1` / `validate-setup.sh`)
- Worked examples for TypeScript, .NET, and Python
