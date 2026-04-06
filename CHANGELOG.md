# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
