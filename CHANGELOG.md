# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [2.29.1] — 2026-04-13

### Fixed — 9 Platform Bugs from v2.29.0 Testing
- **`forge_drift_report`** — `empty-catch` regex now matches C#'s parameterless `catch { }` syntax (was only matching `catch (e) {}`)
- **`forge_diff`** — CRLF git warnings on Windows no longer crash with `NativeCommandError` (4 call sites fixed)
- **`forge_dep_watch`** — .NET project support via `dotnet list package --vulnerable --format json` (was npm-only)
- **`forge_regression_guard`** — parses inline `**Validation Gate**: \`cmd\`` format + falls back to `buildCommand` fields
- **`forge_fix_proposal`** — incident-based proposals now reference specific files, suggest concrete investigation steps, and generate project-type-aware test gates
- **`pforge smith`** — detects LiveGuard hooks (`PostSlice`, `PreAgentHandoff`, `PreDeploy`) in addition to core hooks
- **`forge_sweep`** / **`forge_drift_report`** — framework code (`pforge-mcp/`, `pforge.*`, `setup.*`) separated from app code in scoring and sweep output; SQL injection false-positives in browser JS eliminated
- **`forge_alert_triage`** — drift violations from framework paths excluded from app scoring

## [2.29.0] — 2026-04-13

### Added — LiveGuard: Fix Proposals, Quorum Analysis, Deploy/Slice/Handoff Hooks, OpenClaw Bridge
- **`forge_fix_proposal`** — generates 1–2 slice fix plans from regression, drift, incident, or secret-scan failures. Writes to `docs/plans/auto/LIVEGUARD-FIX-<id>.md`. Capped at one proposal per `incidentId` to prevent spam. Persists proposal records to `.forge/fix-proposals.json`. Auto-detects source when not specified (drift → incident → secret fallback chain).
- **`forge_quorum_analyze`** — assembles a structured 3-section quorum prompt (Context, Question, Voting Instruction) from any LiveGuard data source. No LLM calls — returns the prompt for multi-model dispatch. Supports `customQuestion` freeform override (max 500 chars, XSS-validated) and `analysisGoal` presets (`root-cause`, `risk-assess`, `fix-review`, `runbook-validate`). Configurable `quorumSize` (1–10, default 3).
- **PreDeploy hook** — `runPreDeployHook()` intercepts deploy triggers (Dockerfile edits, `docker push`, `kubectl apply`, etc.) and evaluates secret-scan + env-diff caches. Blocks on secret findings (configurable), advises on env key gaps and stale caches. Configurable via `.forge.json` `hooks.preDeploy`.
- **PostSlice hook** — `runPostSliceHook()` fires after conventional commits, reads drift history, and computes score delta. Returns silent/advisory/warning based on configurable thresholds (`silentDeltaThreshold`, `warnDeltaThreshold`, `scoreFloor`). Duplicate-firing prevention within sessions.
- **PreAgentHandoff hook** — `runPreAgentHandoffHook()` builds a structured LiveGuard context header for injection into new agent sessions. Includes drift score, open incidents, deploy history, secret scan status, and top alerts filtered by severity. Skips context injection when `PFORGE_QUORUM_TURN` env var is set. Fires regression guard on dirty branches. Posts snapshot to OpenClaw when configured.
- **OpenClaw bridge** — `loadOpenClawConfig()` and `postOpenClawSnapshot()` enable fire-and-forget context snapshots to external OpenClaw endpoints. API key fallback to `.forge/secrets.json`.
- **`loadQuorumConfig()`** — reads quorum configuration from `.forge.json` with preset support (`power`, `speed`), merge order: defaults < preset < user config.

### Changed
- TOOL_METADATA expanded to 33 entries (20 core + 13 LiveGuard)
- LIVEGUARD_TOOLS set expanded to 13 entries (added `forge_fix_proposal`, `forge_quorum_analyze`)
- Capabilities surface updated across `capabilities.mjs`, `capabilities.md`, and `capabilities.html`

### Testing
- 68 new test cases across `server.test.mjs` (327 → 380) and `orchestrator.test.mjs` (91 → 106), 577 total across all test files
- `forge_fix_proposal`: plan file writing, fix-proposals.json persistence, duplicate detection, source-specific plan structure (incident/drift/secret/regression), auto-detection data flow
- `forge_quorum_analyze`: XSS regex validation (script/javascript/on-event patterns), customQuestion length cap, quorumSize clamping, GOAL_PRESETS resolution (4 presets), prompt 3-section assembly, dataSnapshotAge computation, source-specific data loading (drift/incident/triage/runbook/fix-proposal/targetFile)
- `loadQuorumConfig`: defaults, .forge.json merge, corrupt config resilience, preset override, user-overrides-preset priority
- `loadOpenClawConfig`: no config, endpoint+apiKey, secrets.json fallback, missing endpoint, corrupt config/secrets resilience
- `scoreSliceComplexity`: simple vs security-sensitive scoring, signals object shape
- LIVEGUARD_TOOLS v2.29.0: all 13 tools write to `liveguard-events.jsonl`, `forge_fix_proposal` + `forge_quorum_analyze` membership
- Hook integration: PreDeploy→PostSlice chaining (block+trigger, pass+advisory), PreAgentHandoff with full LiveGuard state (drift+incidents+deploy+secrets combined context header)
- TOOL_METADATA v2.29.0 count validation (≥33 entries)

---

## [2.28.0] — 2026-04-13

### Added — LiveGuard: Secret Scan, Env Diff, Dashboard Tab, Telemetry Retrofit
- **`forge_secret_scan`** — post-commit Shannon entropy analysis scanning git diff output for high-entropy strings (leaked secrets). Key-name heuristics classify findings as `api_key`, `secret`, `token`, `password`, `auth`, `private_key`, or `credential`. Confidence levels (`high`/`medium`/`low`) combine entropy score with key-name match. Caches results in `.forge/secret-scan-cache.json` with `<REDACTED>` masking. Annotates deploy journal sidecar (`deploy-journal-meta.json`) when HEAD matches last deploy.
- **`forge_env_diff`** — environment variable key comparison across `.env` files. Detects missing keys between baseline and targets. Auto-detects `.env.*` files (excludes `.env.example`). Compares key names only (never values). Caches results in `.forge/env-diff-cache.json`. Integrates with `forge_runbook` to surface environment key gaps.
- **Dashboard LiveGuard section** — 5 new amber-themed tabs (`lg-health`, `lg-incidents`, `lg-triage`, `lg-security`, `lg-env`) with badge state tracking, tab load hooks, and keyboard shortcut support. Total dashboard tabs: 14 (9 core + 5 LiveGuard).
- **Telemetry retrofit** — `emitToolTelemetry()` integrated into all 11 LiveGuard tool handlers. Writes to `telemetry/tool-calls.jsonl` (all tools) and `liveguard-events.jsonl` (LiveGuard tools only). Best-effort: telemetry failures never crash tools. `DEGRADED` status for graceful degradation paths.
- **`forge_runbook` env-diff integration** — runbook generation now reads `.forge/env-diff-cache.json` and includes "Environment Key Gaps" section when gaps exist. Backward-compatible: absent cache is silently skipped.

### Changed
- TOOL_METADATA expanded to 31 entries (20 core + 11 LiveGuard)
- LIVEGUARD_TOOLS set expanded to 11 entries (added `forge_secret_scan`, `forge_env_diff`)
- Capabilities surface updated across `capabilities.mjs`, `capabilities.md`, and `capabilities.html`

### Testing
- 75 new test cases in `server.test.mjs` (158 → 233), 415 total across all test files
- Shannon entropy computation: empty/null/repeated/balanced/high-entropy string validation
- Threshold clamping: min (3.5), max (5.0), default (4.0), in-range preservation
- Key pattern matching: 7 secret-type patterns + benign variable rejection
- Type inference: 8 type categories (`api_key`, `secret`, `token`, `password`, `auth`, `private_key`, `credential`, `unknown`)
- Confidence classification: high/medium/low boundary conditions
- `.env` key parsing: comments, empty lines, `=` in values, whitespace trimming, value exclusion
- Key comparison: missing-in-target, missing-in-baseline, clean detection, totalGaps aggregation
- Auto-detect `.env.*` files: inclusion, `.example` exclusion, empty case
- Graceful degradation: baseline-not-found structured error, missing target file error
- `emitToolTelemetry`: LIVEGUARD_TOOLS set membership (11 tools), record shape, result truncation, non-object input wrapping, never-throw guarantee, DEGRADED status
- Dashboard tab smoke: 14 tab buttons (9 core + 5 LG), section divider, amber hover style, tabLoadHooks coverage, badge state tracking, keyboard shortcuts
- `forge_runbook` backward compatibility: env-diff cache integration, clean-skip, absent-cache safety, missingInBaseline handling

---

## [2.27.0] — 2026-04-13

### Added — LiveGuard: Post-Coding Operational Intelligence
- **9 new MCP tools** for post-coding operational awareness:
  - `forge_drift_report` — architecture drift scoring with violation tracking, threshold alerting, and history trend
  - `forge_incident_capture` — incident recording with MTTR computation, severity validation, and onCall bridge dispatch
  - `forge_deploy_journal` — deployment log with version tracking, preceding-deploy correlation, and JSONL persistence
  - `forge_dep_watch` — dependency vulnerability scanning with diff (new/resolved), snapshot persistence, and hub events
  - `forge_regression_guard` — validation gate extraction from plans, allowlist enforcement, shell execution, and fail-fast mode
  - `forge_runbook` — auto-generate operational runbooks from plan files and incident history
  - `forge_hotspot` — git churn analysis to identify high-risk files (24h cache TTL)
  - `forge_health_trend` — aggregated health score from drift, cost, incident, and model performance data over configurable time windows
  - `forge_alert_triage` — prioritized alert ranking combining severity weight × recency factor with tiebreak rules
- **14 REST API endpoints** for external agent and CI/CD integration
- `isGateCommandAllowed()` — command allowlist with blocked-pattern safety net (rm -rf /, dd, mkfs)
- `getHealthTrend()` — multi-metric health aggregation with configurable time windows and metric filtering
- `inferSliceType()` — automatic slice classification (test, review, migration, execute) from title and task keywords
- `recommendModel()` — historical performance-based model selection with MIN_SAMPLE threshold and cost optimization
- `readForgeJsonl()` — JSONL reader complementing `appendForgeJsonl()` for round-trip operational data persistence

### Changed
- TOOL_METADATA expanded to 29 entries (20 core + 9 LiveGuard)
- Capabilities surface updated across `capabilities.mjs`, `capabilities.md`, and `capabilities.html`

### Testing
- 75 new test cases across `server.test.mjs` and `orchestrator.test.mjs` (232 → 307 total)
- Full TOOL_METADATA coverage for all 9 LiveGuard tools
- Behavioral tests for drift scoring, incident MTTR, deploy journal, dep watch snapshots, health trend, alert triage, regression guard, runbook naming, hotspot metadata
- `isGateCommandAllowed` tests: allowlist prefixes, dangerous-pattern blocking, env-var prefix handling, edge cases
- `inferSliceType` tests: test/review/migration/execute classification with keyword matching
- `recommendModel` tests: MIN_SAMPLE threshold, success rate filtering, cost-based selection, sliceType filtering, fallback behavior
- `getHealthTrend` tests: metric filtering, time-window exclusion, drift/incident/model aggregation, healthScore computation

---

## [2.29.0] — planned

### Added
- `forge_fix_proposal` MCP tool — generates 1-2 slice fix plan (`docs/plans/auto/LIVEGUARD-FIX-<id>.md`) from regression, drift, incident, or secret-scan failure; capped at one proposal per incidentId; `source="secret"` supported with credential-rotation template; `alreadyExists: true` on duplicate calls
- `forge_quorum_analyze` MCP tool — assembles structured 3-section quorum prompt from any LiveGuard data source; `customQuestion` freeform override (max 500 chars, XSS-validated); echoes `questionUsed` for audit trail; no LLM calls from `server.mjs`
- `GET /api/fix/proposals` — list all fix proposals (no auth)
- `POST /api/fix/propose` — generate fix proposal (requires `approvalSecret`)
- `GET /api/quorum/prompt` + `POST /api/quorum/prompt` — assemble quorum prompt (no auth, read-only)
- `docs/plans/auto/` directory — gitignored runtime directory; `README.md` committed via explicit gitignore exception `!docs/plans/auto/README.md`
- `generateFixPlan()` and `postOpenClawSnapshot()` helpers in `orchestrator.mjs`

### Hooks (new)
- **PreDeploy** — blocks file writes to `deploy/**`, `Dockerfile*`, `*.tf`, `k8s/**` and CLI commands (`docker push`, `git push`, `azd up`) when `forge_secret_scan` returns findings; warns on env key gaps; configurable via `.forge.json` `hooks.preDeploy.*`
- **PostSlice** — injects amber advisory (delta >5, score ≥70) or red warning (delta >10, score <70) after every `feat|fix|refactor|perf|chore|style|test` commit; never blocks; configurable via `hooks.postSlice.*`
- **PreAgentHandoff** — injects LiveGuard context header at session start; skips entirely when `PFORGE_QUORUM_TURN` env var is set (quorum turns get clean context); fires OpenClaw snapshot POST (5s hard timeout, fire-and-forget); configurable via `hooks.preAgentHandoff.*` + `openclaw.*`

### Integration
- OpenClaw analytics bridge — optional `POST` to `openclaw.endpoint` on `PreAgentHandoff` with drift score, open incidents, last deploy version, alert summary, secret scan status
- `.forge.json` `hooks.*` config block (all three hooks) + `openclaw.endpoint` + `openclaw.apiKey` (references `.forge/secrets.json`)

### Config (`.forge.json`)
- `hooks.preDeploy.blockOnSecrets` (default `true`), `.warnOnEnvGaps` (default `true`), `.scanSince` (default `"HEAD~1"`)
- `hooks.postSlice.silentDeltaThreshold` (default 5), `.warnDeltaThreshold` (default 10), `.scoreFloor` (default 70)
- `hooks.preAgentHandoff.injectContext` (default `true`), `.runRegressionGuard` (default `true`), `.cacheMaxAgeMinutes` (default 30), `.minAlertSeverity` (default `"medium"`)

---
## [2.26.0] - 2026-04-12

### Added
- `faq.html`: 3 new QAs — remote trigger, memory API, and discovery layer for OpenClaw/external agents
- `capabilities.html`: `forge_memory_capture` card added to MCP tool grid; 19 MCP count updated throughout; new "REST API — External Integration" section with run control, memory, discovery, and auth details
- `capabilities.md`: `forge_memory_capture` row in MCP table; 4 new REST endpoints in API table (trigger, abort, memory/search, memory/capture); auth note on write endpoints; new "External Integration" section with curl examples and required config

### Changed
- MCP tool count updated to 19 across all docs (faq.html ×2, capabilities.html ×6, capabilities.md ×2)

---
## [2.25.0] — 2026-04-12

### Added
- **REST API discovery — all bases covered** — OpenClaw and any external agent can now discover the full Plan Forge REST surface via three complementary paths:
  - `forge_capabilities` MCP tool — `restApi.endpoints` array now includes all 13 endpoints (trigger, abort, memory search/capture, bridge approve, well-known)
  - `/.well-known/plan-forge.json` — already served; capability surface now includes the full endpoint list
  - `docs/llms.txt` — new REST API section documents all endpoints with auth requirements and body shapes
  - `AGENT-SETUP.md` Section 6 — new "External Integration" section with copy-pasteable curl examples for OpenClaw, CI, and webhook use cases

---

## [2.24.0] — 2026-04-12

### Added
- **`forge_memory_capture` MCP tool** — new MCP capability for OpenClaw and external agents to capture thoughts, decisions, lessons, and conventions into OpenBrain persistent memory. Accepts `content`, `project`, `type` (decision/lesson/convention/pattern/gotcha), `source`, and `created_by`. Returns a structured `capture_thought` payload ready for OpenBrain.
- **`POST /api/memory/capture` REST endpoint** — companion HTTP endpoint so OpenClaw can POST memories directly without going through an AI worker. Validates, normalises, and broadcasts a `memory-captured` hub event. Secured with the same `bridge.approvalSecret` Bearer token. Returns the thought payload for OpenBrain persistence.

---

## [2.23.0] — 2026-04-12

### Added
- **`POST /api/runs/trigger`** — inbound HTTP trigger endpoint so OpenClaw (or any external orchestrator) can start a plan run on the MCP server without sitting at VS Code. Accepts `plan`, `quorum`, `model`, `resumeFrom`, `estimate`, and `dryRun`. Returns `{ ok, triggerId, message }` immediately; run executes in background with full dashboard + bridge notifications.
- **`POST /api/runs/abort`** — companion endpoint to abort an in-progress triggered run. Auth: same `bridge.approvalSecret` Bearer token used by the approval gate.
- **Blog index infographic link** — "🗺️ View System Infographic →" button added below hero image on blog index page.

### Fixed
- **Dashboard nested interactive control** — moved "Plan Browser →" anchor outside `<summary>` to resolve accessibility violation.
- **Plan Browser inline style** — extracted `height: calc(100vh - 56px)` into `.layout-body` CSS class.
- **Infographic CSS** — extracted all inline styles from feature cards into named classes; added `-webkit-backdrop-filter` Safari fallbacks throughout.

---

## [2.22.0] — 2026-04-10

### Fixed
- **Grok image model names** — corrected `grok-2-image` → `grok-imagine-image` in dashboard dropdown and REST API default; added URL response handling alongside b64_json
- **Grok pricing table** — updated to match current xAI API rates ($2.00/$6.00 for flagship, $0.20/$0.50 for fast); added 6 new model IDs

### Added
- **Quorum power/speed presets** — `--quorum=power` (flagship models, threshold 5) and `--quorum=speed` (fast models, threshold 7); available via CLI, MCP, and `.forge.json`
- **3-provider quorum default** — Claude Opus 4.6 + GPT-5.3-Codex + Grok 4.20 Reasoning (three different vendors for genuine multi-vendor consensus)
- **`.forge/secrets.json` API key fallback** — store API keys in gitignored `.forge/secrets.json` as an alternative to environment variables; lookup order: env var → secrets file → null

---

## [2.21.0] — 2026-04-10

### Changed — Forge Anneal (Documentation Consolidation)

- **README.md** — thinned from 1,082 to 216 lines (80% reduction). Detailed preset/agent/skill tables moved to `capabilities.md` and `CUSTOMIZATION.md`. FAQ moved to website. Pipeline details moved to `COPILOT-VSCODE-GUIDE.md`. README now covers: hero + value prop + quickstart + compact "what's included" + doc links.
- **ROADMAP.md** — compressed from 1,714 to 191 lines (89% reduction). Shipped versions compressed to 2-3 line summaries. Full release details live in `CHANGELOG.md`. Only planned/in-progress items retain full detail.
- **AI-Plan-Hardening-Runbook.md** — replaced 996-line full template runbook with 22-line redirect to pipeline agents and prompt templates (`step0-*.prompt.md` through `step6-*.prompt.md`). Prompt files ARE the runbook in executable form.
- **UNIFIED-SYSTEM-ARCHITECTURE.md** — compressed from 1,840 to 75 lines. Executive summary, architecture diagram, integration points, and memory layers retained. Full content preserved in git history.
- **Total reduction**: 10,910 → 5,782 lines across 14 human-facing docs (47% reduction, 5,128 lines removed)

---

## [2.20.0] — 2026-04-10

### Added — Forge Quench (Code Simplification Skill)

- **`/forge-quench` skill** — new shared skill that systematically reduces code complexity while preserving exact behavior. Named after the metallurgical quenching process. 5-step workflow: Measure → Understand First (Chesterton's Fence) → Propose → Apply & Prove → Report. Each simplification is committed individually with rationale; tests run after every change; failing tests trigger immediate revert.
- **8 stack-specific variants** — each preset (dotnet, typescript, python, java, go, swift, rust, php) has a forge-quench variant with framework-appropriate complexity measurement tools: `radon` (Python), `gocyclo`/`gocognit` (Go), `cargo clippy` (Rust), ESLint complexity rule (TypeScript), `phpmd` (PHP), `pmd` (Java), `swiftlint` (Swift), manual analysis (.NET)
- **Full Skill Blueprint compliance** — all 9 forge-quench files include Temper Guards (5 entries), Warning Signs (6 items), Exit Proof (6 verifiable checkboxes), and Persistent Memory hooks

---

## [2.19.0] — 2026-04-10

### Added — Skill Blueprint & Verification Gates

- **SKILL-BLUEPRINT.md** (S1) — formal specification for Plan Forge skill format published at `docs/SKILL-BLUEPRINT.md`. Documents all required sections (Frontmatter, Trigger, Steps, Safety Rules, Temper Guards, Warning Signs, Exit Proof, Persistent Memory), naming conventions, token budget guidance, cross-skill references, and new skill checklist
- **Exit Proof in all skills** (S2) — all 79 SKILL.md files across 9 presets now include `## Exit Proof` checklists with 4–6 verifiable evidence requirements per skill. Stack-specific commands used throughout (e.g., `dotnet test`, `pytest`, `cargo test`, `go test ./...`)
- **Temper Guards and Warning Signs in all skills** (S3) — all 79 SKILL.md files now include `## Temper Guards` tables (3–5 shortcut/rebuttal pairs per skill) and `## Warning Signs` lists (4–6 observable anti-patterns). Domain-specific to each skill type (migration, deploy, review, audit, etc.)

Every SKILL.md now follows the full Skill Blueprint format: Frontmatter → Trigger → Steps → Safety Rules → Temper Guards → Warning Signs → Exit Proof → Persistent Memory.

---

## [2.18.0] — 2026-04-10

### Added — Temper Guards & Onboarding Polish

- **Temper Guards in instruction files** (T1) — 40 instruction files across all 8 app presets now include `## Temper Guards` tables: documented shortcuts agents use to cut corners (e.g., "This is too simple to test", "We'll add auth later") paired with concrete rebuttals. Covers testing, security, error handling, database, API patterns, and architecture principles. Stack-specific terminology used throughout (e.g., Zod for TypeScript, Pydantic for Python, `[Authorize]` for .NET)
- **Warning Signs in instruction files** (T2) — same 40 files include `## Warning Signs` sections: observable behavioral anti-patterns that agents and reviewers can grep for during and after execution (e.g., "Controller contains database queries", "Empty catch block", "String interpolation in SQL")
- **`context-fuel.instructions.md`** (T3) — new shared instruction file (`applyTo: '**'`, priority LOW) teaching agents context window management within Plan Forge: when to load which files, recognizing context degradation, token budget awareness, and session boundary guidance. Registered in `setup.ps1` and `setup.sh` Step 2
- **Quick Forge Card** (T4) — 4-step quickstart card added to `planforge.software` homepage hero section: install plugin → init project → describe feature → click through pipeline. Links to detailed setup guide
- **`pforge tour`** (T5) — new interactive CLI command in both `pforge.ps1` and `pforge.sh` that walks through 6 categories of installed Plan Forge files (instructions, agents, prompts, skills, hooks, config) with real file counts from the user's project
- **MCP capabilities updated** — `capabilities.mjs` guardrails section now documents `temperGuards`, `warningSigns`, and `contextFuel` features; `context-fuel` added to shared guardrails list

---

## [2.17.0] — 2026-04-07

### Fixed — Dashboard Reliability
- **Event watcher rewrite** — on server startup the watcher now replays the full event history from the latest run log into hub history (not just tail from EOF); fixes dashboard showing "Waiting for run events" after a server restart
- **Run-switch watcher detach** — on each new plan run, the old `watchFile` listener is explicitly removed and the read offset reset before the new log is attached; prevents duplicate events and stale handlers accumulating across runs
- **ES module import cleanup** — replaced legacy `require('fs')` calls in the file-watcher code path with proper `import` statements, fixing module-type errors in `server.mjs`

### Added — Setup Completion & Smith Diagnostics
- **Phase 24 hardened plan** — `docs/plans/Phase-24-DASHBOARD-SETUP-HARDENING-v2.17-PLAN.md` documents the full scope contract, acceptance criteria, and 6-slice execution plan for the Dashboard Reliability & Setup Completion release

---

## [2.16.0] — 2026-04-07

### Added — Platform Completion & Setup Hardening (Phase 23)
- **Nested Subagent Pipeline (B2)** — all 5 pipeline agent templates (`specifier`, `plan-hardener`, `executor`, `reviewer-gate`, `shipper`) updated with `agents` tool in YAML frontmatter, `## Nested Subagent Invocation` section with precise handoff instructions, and termination guards to prevent recursion; Reviewer Gate LOCKOUT loop capped at 2 fix cycles before human escalation; Shipper marked as terminal node; `"chat.subagents.allowInvocationsFromSubagents": true` added to `templates/vscode-settings.json.template`; "Single-Session Pipeline with Nested Subagents" section added to `docs/COPILOT-VSCODE-GUIDE.md` explaining the 4→1 session collapse, VS Code setting, termination guard table, and manual handoff fallback
- **Status-reporting instruction file** — new `.github/instructions/status-reporting.instructions.md` with 7 standard output templates (progress update, slice complete, blocker report, failure/recovery, run summary, handoff summary, slice status table); auto-loads via `applyTo` on plan, MCP, and forge files; wired into `setup.ps1` / `setup.sh` Step 2 and `copilot-instructions.md.template`

---

## [2.15.0] — 2026-04-07

### Added — Copilot Platform Integration (Phase 22)
- **One-click plugin install** (A1) — `vscode://chat-plugin/install?source=srnichols/plan-forge` and `vscode-insiders://` buttons added to `docs/index.html`, `docs/docs.html`, `docs/capabilities.html`, `AGENT-SETUP.md`, `README.md`, and `docs/QUICKSTART-WALKTHROUGH.md`; fallback text for VS Code < 1.113
- **Model deprecation sweep** (A2) — removed all `gpt-5.1` references from `pforge-mcp/server.mjs`, `README.md`, `CUSTOMIZATION.md`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/faq.html`, and `templates/copilot-instructions.md.template`; confirmed `gpt-5.3-codex` (LTS), `gpt-5.4`, `gpt-5.4-mini`, and Claude Sonnet 4.6 are current defaults
- **Cloud agent integration guide** (A3) — new `templates/copilot-setup-steps.yml` template for Copilot cloud agent setup; "Using Plan Forge with Copilot Cloud Agent" section added to `docs/COPILOT-VSCODE-GUIDE.md`; cloud agent references added to `README.md`, `AGENT-SETUP.md`, `docs/index.html`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/faq.html`
- **Copilot Memory coexistence docs** (A4) — Memory Layers three-way comparison table (Copilot Memory vs Plan Forge Run Memory vs OpenBrain) added to `docs/COPILOT-VSCODE-GUIDE.md`, `docs/capabilities.md`, `docs/capabilities.html`, `README.md`, and `docs/faq.html`
- **`forge_org_rules` MCP tool + `pforge org-rules export` CLI** (B1) — consolidates `.github/instructions/*.instructions.md`, `copilot-instructions.md`, and `PROJECT-PRINCIPLES.md` into a single org-level instruction block; supports `--format github|markdown|json` and `--output <file>`; documents the two-layer model (Layer 1 org baseline vs Layer 2 repo-specific)
- **`/forge-troubleshoot` skill** (B3) — new skill at `presets/shared/skills/forge-troubleshoot/SKILL.md`; auto-detects "instructions ignored" / "guardrail bypass" triggers; 5-step diagnosis: `pforge smith` → settings check → `/troubleshoot #session` suggestion → failure checklist → OpenBrain history search
- **Quorum mode default** — `quorum=auto` is now the orchestrator and `forge_run_plan` default; threshold-based multi-model consensus kicks in automatically for complex slices (complexity ≥ 7) without requiring explicit `--quorum` flag

---

## [2.14.0] — 2026-04-07

### Added — Quality Engineering (Phase 21)
- **Vitest test suite** — `pforge-mcp/tests/` with framework tests covering parser slice extraction, bridge formatters (Telegram/Slack/Discord/Generic), analyzer scoring (MUST/SHOULD extraction + checkbox fallback), and constants validation (SUPPORTED_AGENTS, MODEL_PRICING); run with `npm test` in `pforge-mcp/`
- **Background orchestrator mode** — `pforge run-plan` now spawns `node orchestrator.mjs` as a detached background process, writes PID to `.forge/orchestrator.pid`, and polls `GET /api/runs/latest` every 5 s for live progress; `--foreground` flag restores blocking behavior for debugging
- **`GET /api/runs/latest` endpoint** — `server.mjs` exposes the most recent run's summary and current slice status for the background polling client
- **Parser format tolerance** — `parsePlan()` now accepts case-insensitive slice headers (`### Slice N:`, `### Slice N —`, `### Slice N.`), case-insensitive `Build Command` / `build command` / `**Build command**`, and flexible `Depends On` parsing (`Slice 1`, `1`, `depends: 1`)
- **Auto-discover updater** — `pforge update` (ps1 and sh) now scans the entire `pforge-mcp/` directory tree by SHA-256 hash instead of a hardcoded file list; new files are added automatically; `--check` is now an alias for `--dry-run`
- **Dashboard config loading states** — config tab shows an animated skeleton placeholder while the API fetch is in-flight; fields populate only after the response arrives; 5 s timeout handler prevents indefinite spinner
- **stderr streaming safety** — `parseStderrStats()` is called inside the worker `close` handler so it always receives the fully-accumulated stderr string, not a partial stream; covered by `tests/worker.test.mjs`

---

## [2.13.1] — 2026-04-07

### Added — Dashboard Capabilities + Doc Refresh (Phase 20)
- **Model performance chart** — dashboard now renders a per-model success-rate bar chart sourced from `.forge/model-performance.json`; updates live on each run completion event
- **Routing indicator** — dashboard displays the auto-selected model for the next slice alongside its historical success rate and estimated cost tier
- **Bridge status section** — MCP bridge health (connected / reconnecting / offline) and last-heartbeat timestamp shown in the dashboard sidebar; escalation indicators highlight slices currently in quorum
- **Plan Browser link** — dashboard header now links to the Web UI plan browser (`/ui`) opened in a new tab
- **Public docs refresh** — `docs/index.html` updated with Web UI plan browser section, agent-per-slice routing feature entry, and OpenBrain deep-context description

---

## [2.13.0] — 2026-04-07

### Added — Platform Complete (Phase 19)
- **Agent-per-slice routing** — orchestrator reads `.forge/model-performance.json` and auto-selects the cheapest model with >80% success rate for each slice type; `--estimate` output now shows recommended model per slice with historical success rate; `slice-model-routed` event emitted on selection
- **OpenBrain deep context** — `loadProjectContext()` in `memory.mjs` searches project history for decisions and patterns relevant to each slice title; context block injected into worker prompts before slice instructions; graceful no-op when OpenBrain is not configured
- **Preset minimum-count validation** — `validate-setup.ps1` / `validate-setup.sh` now check per-preset minimum file counts (≥15 instructions, ≥6 agents, ≥9 prompts, ≥8 skills for full stacks; ≥5/1/3 for azure-iac); missing counts reported as warnings
- **Spec Kit auto-detection** — `setup.ps1` / `setup.sh` detect `specs/`, `memory/constitution.md`, and `specs/*/spec.md` at startup and set `speckit: true` in `.forge.json`; prints "Spec Kit artifacts detected. Plan Forge will layer guardrails on top."
- **Dual-publish extensions** — `pforge ext publish` now outputs both a Plan Forge catalog entry and a Spec Kit-compatible `extensions.json` entry; `extensions/PUBLISHING.md` updated with dual-publish instructions
- **Auto-update notification in `pforge smith`** — fetches `VERSION` from GitHub (5 s timeout, 24 h cache in `.forge/version-check.json`); warns when a newer release is available with `pforge update` command; skips silently when offline
- **Web UI plan browser** (`localhost:3100/ui`) — read-only single-page app served from `pforge-mcp/ui/`; lists plans via `/api/plans`, renders slice metadata cards, DAG dependency view, and scope contract; no execution controls (those remain on the dashboard)

---

## [2.12.0] — 2026-04-06

### Added — Escalation & CI Trigger Events (Phase 18)
- **`slice-escalated` event** — emitted when a slice is escalated to quorum for multi-model consensus (includes `sliceId`, `reason`, `models`)
- **`ci-triggered` event** — emitted when a CI workflow is dispatched from a plan run (includes `workflow`, `ref`, `inputs`)

---

## [2.11.0] — 2026-04-06

### Added — v2.11 Quick Wins (Phase 17)
- **Windsurf adapter** (`-Agent windsurf`) — generates `.windsurf/rules/*.md` with trigger frontmatter (always_on/glob/model_decision), `.windsurf/workflows/planforge/*.md` for commands. 6th supported agent IDE.
- **Generic agent adapter** (`-Agent generic`) — copies all prompts, agents, and skills to a user-specified `--commands-dir` path. Works with any AI tool that reads markdown files.
- **Swift/iOS preset** (`presets/swift/`) — 49 files: XCTest patterns, Swift Package Manager, Vapor/SwiftUI conventions. Auto-detect via `Package.swift`, `*.xcodeproj`, `*.xcworkspace`.
- `-Agent all` now includes windsurf + generic (7 agents total)

---

## [2.10.0] — 2026-04-06

### Added — OpenClaw Bridge (Phase 16)
- **`pforge-mcp/bridge.mjs`** — BridgeManager subscribes to WebSocket hub events and dispatches formatted notifications to external platforms (Telegram, Slack, Discord, generic webhooks)
- **Platform formatters** — per-platform rich formatting: Telegram Markdown v2 with emoji, Slack Block Kit with action buttons, Discord Embeds with color-coded sidebars, Generic JSON envelope
- **ApprovalGate state machine** — pause execution at `run-completed`, POST approval request to configured channels, resume on `POST /api/bridge/approve/:runId` callback; auto-rejects after configurable timeout (default 30 min)
- **REST endpoints** — `GET /api/bridge/status` (connected channels + pending approvals), `POST /api/bridge/approve/:runId` (approval callback), `GET /api/bridge/approve/:runId` (browser-friendly for Telegram inline buttons)
- **Notification level filtering** — `all`, `important`, `critical-only` per channel
- **Rate limiting** — max 1 notification per 5 seconds per channel to prevent spam during parallel slices
- **Config via `.forge.json`** — `bridge.channels[]` array with type, url, level, approvalRequired per channel
- **4 new EVENTS.md event types** — `approval-requested`, `approval-received`, `bridge-notification-sent`, `bridge-notification-failed`
- No new npm dependencies — uses Node.js built-in `fetch`

---

## [2.9.2] — 2026-04-06

### Added — Extension Registry (Phase 15)
- **`pforge ext publish <path>`** — validates extension.json, counts artifact files, and generates a ready-to-submit catalog.json entry (PowerShell + Bash)
- **Live Extension Catalog** on `docs/extensions.html` — dynamically fetches catalog.json from GitHub, renders searchable/filterable extension cards with install commands
- Plan executed via `pforge run-plan --quorum` orchestrator (3 slices, $0.03, 7.5 min)

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
