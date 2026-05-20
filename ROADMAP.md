# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v3.12.1** (2026-05-20) — `forge_diff_stats` tool-surface cleanup. Added `forge_diff_stats` to `TOOL_NAMES` frozen array in `enums.mjs` and to `_READ_ONLY_TOOLS` in `server/tool-handlers.mjs`. Updated Appendix Q (`api-surface-index.html`) with both tools correctly placed. Resolves the handler-name collision introduced by Phase WORKER-GUARDRAILS A2.

Previous: **v3.12.0** (2026-05-20) — `pforge-sdk/session-reader` (v0.10.0). New `session-reader` sub-path provides offline access to `.forge/fm-sessions/*.jsonl` Forge-Master conversation session files without a running MCP server. `listSessions`, `readSession`, `readAllSessionTurns` (archive + active, deduped and sorted), `parseSessionLine`, `getLane`, `summarizeSession`. 76 tests.

Previous: **v3.11.0** (2026-05-20) — Anvil, Hallmark, and pipeline tools published on MCP surface. Eight MCP tools now discoverable and callable: `forge_anvil_stat`, `forge_anvil_clear`, `forge_anvil_rebuild`, `forge_anvil_dlq_list`, `forge_anvil_dlq_drain`, `forge_hallmark_show`, `forge_hallmark_verify`, `forge_pipelines_list`. Added `TOOL_NAMES` coverage for `forge_embedding_status`, `forge_local_recall_status`, `forge_local_search`. Refreshed tool-surface fixtures and `docs/manual/api-surface-index.html`.

Previous: **v3.10.2** (2026-05-20) — Phase 55 CLEAN-CODE-SWEEP: eliminated all 4 residual clean-code blocking errors. Split `orchestrator/run-plan.mjs` and `server/rest-api.mjs`, decomposed two `complexity-error` functions, cleared frozen-arrays drift, triaged SKIP-LEAK sites. Final audit: 0 errors.

Previous: **v3.10.1** (2026-05-20) — `forge_audit_export` MCP tool (#098), ACI-paginated audit event export. `GET /api/audit/export` REST endpoint. 12 tests.

Previous: **v3.9.1** (2026-05-19) — `forge_local_recall_status` MCP tool (#097) — diagnostic surface for the local TF-IDF / neural-embedding recall index. `pforge local-recall status` CLI.

Previous: **v3.8.2** (2026-05-20) — CLI-GUIDE Documentation Refresh. Added full CLI-GUIDE entries for 14 commands: `digest`, `fm-recall`, `plan-from-sarif`, `sync-spaces`, `forge-home-cleanup`, `timeline`, `patterns`, `graph`, `sync-memories`, `sync-instructions`, `github`, `crucible`, `skills`, and `mcp-call`. Completes v3.6 Documentation Candidate #3.

Previous: **v3.8.1** `forge_memory_report` now silences 115+ false-positive orphan reports by recognizing 20+ legitimate state files and 20+ known subdirectories, plus ephemeral-pattern exclusions for logs, tmp files, and meta-bug drafts. New `pforge forge-home-cleanup` CLI dispatches to `scripts/forge-home-cleanup.mjs` — moves stale ephemeral files to `.forge/archive/<YYYY-MM>/` and prunes archive slots older than `--max-age-days` (default 90). `.forge/.gitignore` template added. 12 new tests.

Previous: **v3.8.0** (2026-05-19) — Auditor Automation & Observer (Phase-39). Automated post-run auditing hooks (`hooks.postRun.invokeAuditor.onFailure` + `everyNRuns`), cross-run watcher mode with four new anomaly codes, and a live-pipeline Observer that subscribes to the hub WebSocket, batches events, and narrates notable patterns via the Forge-Master reasoning loop. CLI: `pforge forge-master observe`.

Previous: **v3.7.0** (2026-05-18) — Worker Guardrails (A1–A8). Hardened Forbidden Actions matching, diff classification, PreCommit chain, plan-health auditor agent, network allowlists, lockHash, objective-gated tempering, and tool denylists.

Previous: **v3.5.1** (2026-05-17) — Classifier-Lane GitHub Issue Creation (Phase CLASSIFIER-ISSUE). New `forge_classifier_issue` MCP tool closes the tempering audit loop: when `routeFinding` returns `lane: "classifier"` (infra noise), the tool creates a GitHub issue labelled `classifier-noise` proposing a classifier rule update. Hash-based deduplication prevents spam — repeated patterns add a comment on the existing issue instead of creating a duplicate.

Previous: **v3.4.1** (2026-05-17) — Snapshot Pop Hotfix (Issue #201). `popSliceSnapshot` now uses `git stash apply` + explicit drop instead of blind `git stash pop`. Startup janitor drops orphaned `pforge-slice-N-snapshot` stashes older than 7 days.

Previous: **v3.4.0** (2026-05-18) — Team Dashboard (Phase-TEAM-DASHBOARD). New "Team" tab in the dashboard aggregates `.forge/team-activity.jsonl` per operator into per-developer coordination cards (last active, today's runs, success rate, cost, recent plans) and a conflict-risk banner (none/low/medium/high) based on concurrent developer activity in the last 8 h. Exposed as `GET /api/team-dashboard`, `forge_team_dashboard` MCP tool, and `pforge team dashboard` CLI. 12 new tests.

Previous: **v3.3.4** (2026-05-17) — Forge-Master Shim Graceful Degradation (Issue #200). `forge_master_ask` no longer throws when `pforge-master` is not installed.

Previous: **v3.3.0** (2026-05-17) — Agentic Code Review Delegation (D6). `pforge review-delegate` and `forge_review_delegate` MCP tool. Dispatches a structured review task to the Copilot cloud agent, posts inline PR comments, and files a LiveGuard incident for blocking findings.

Previous: **v3.1.2** (2026-05-18) — Cloud Agent Validation Stack (B4). Adds `cloudAgentValidation` to `.forge.json` — declare which GitHub scanning tools (CodeQL, secret scanning, dependency review, Copilot code review) are active. `forge_github_status` surfaces the full validation stack in one call via a new `cloud-agent-validation` check.

Previous: **v3.1.0** (2026-05-17) — Chat Customizations Editor (D5). Adds a Settings → Copilot tab to the dashboard for previewing and syncing `.github/copilot-instructions.md` without leaving the browser. Three new REST endpoints (`GET /api/copilot-instructions`, `POST /api/copilot-instructions/preview`, `POST /api/copilot-instructions/sync`). 12 new tests.

Previous: **v3.0.0** (2026-05-17) — Copilot Instructions Sync (`forge_sync_instructions`). Completes the Copilot integration trilogy: generates `.github/copilot-instructions.md` from forge project context (project profile, project principles, extra instruction files, `.forge.json` config). GitHub Copilot reads this file automatically, giving every conversation project-specific guidance without manual setup. New `pforge sync-instructions` CLI. 30 tests.

Previous: **v2.99.1** (2026-05-17) — DEP0190 Spawn Hardening (Issue #192). Eliminates Node's DEP0190 DeprecationWarning on Windows by replacing `shell:true + array args` with explicit `cmd.exe` routing at all 3 spawn sites.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Quorum Advisory Mode (Phase-38.7). Multi-model quorum dispatch for high-stakes advisory questions. When `quorumAdvisory` pref is enabled, Forge-Master fans out to 2–3 models in parallel, emits a `quorum-estimate` SSE event with per-model cost before dispatch, and returns all replies with a dissent summary. Hard-blocked on operational/troubleshoot/build lanes. Dashboard adds segmented control and multi-model reply cards.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Pattern Surfacing (Phase-38.6). Adds a read-only pattern detector that scans run history and surfaces recurring patterns as advisory observations. Four detectors: gate-failure-recurrence, model-failure-rate-by-complexity, slice-flap-pattern, cost-anomaly. New `forge_patterns_list` MCP tool (advisory lane only). Dashboard "Recurring Patterns" panel grouped by severity. CLI: `pforge patterns list [--since <iso>]`.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Daily Digest (Phase-38.5). Adds `pforge digest` CLI command with `--date`, `--force`, `--notify` flags. Digest aggregator builds structured daily report covering probe lane-match deltas, aging meta-bugs, stalled phases, drift trend, and cost anomalies. Markdown + JSON renderers. Dashboard "Yesterday's Digest" tile. GitHub Actions workflow (opt-in cron). Idempotent output to `.forge/digests/`.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Planner-Executor Split (Phase-38.4). Adds a planner decomposition layer to `runTurn`: complex multi-step queries are decomposed into up to 5 ordered read-only tool calls, executed with dependency-aware parallelism, and synthesized into a single reply. New `plan` SSE event emitted before tool-call events. Falls back to the existing reactive tool loop for simple queries. New files: `planner.mjs`, `plan-executor.mjs`. 3 new planner validation probes.

Previous: **v2.90.10** (2026-05-05) — Plan Forge Knowledge Graph (Phase-38.3). Adds a queryable in-memory knowledge graph over Plan Forge artifacts. New `forge_graph_query` MCP tool (advisory lane only) covers Phase, Slice, Commit, File, Bug, and Run nodes with typed edges. Snapshot persisted atomically to `.forge/graph/snapshot.json`. New CLI: `pforge graph rebuild|stats|query`.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Cross-Session Recall (Phase-38.2). Adds a BM25 recall index over all past `fm-session` JSONL files. `runTurn` now queries the index for operational, troubleshoot, and advisory lanes and injects the top-3 related prior turns as `> **Recall (advisory):**` advisory context. Index stored at `.forge/fm-sessions/recall-index.json` with lazy daily refresh. New CLI: `pforge fm-recall query|rebuild`. Dashboard renders "Related conversations" collapsible section when recall results are present.

Previous: **v2.90.10** (2026-05-05) — Forge-Master Conversation Memory (Phase-38.1). Adds file-based JSONL session persistence to the Forge-Master reasoning engine. `runTurn` loads prior conversation turns before classification and persists each turn to disk. Per-tab session IDs flow from the dashboard (`sessionStorage` UUID) through `x-pforge-session-id` HTTP header to `deps.sessionId` in `runTurn`. Sessions auto-rotate at 200 turns. New CLI: `pforge fm-session list|purge`.

**In flight (next)**: Auth/RBAC scaffold ✅ complete (Phase-AUTH-RBAC-SCAFFOLD). Next phase TBD — candidates: enterprise hardening track (Entra ID SSO first provider, multi-tenancy productization, fleet dashboard cross-team view).

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

---

## v3.6 Documentation & Surface Candidates

> Items deferred from the v3.x doc rebaseline (see [docs/V3-CAPABILITY-AUDIT.md §4.5](docs/V3-CAPABILITY-AUDIT.md)). Each is chapter-sized or product-sized — too large for a doc-only commit. Tracked here so they aren't lost.

| # | Item | Effort | Trigger to start |
|---|------|--------|-----------------|
| 1 | ~~**Typed REST `client` sub-path for `pforge-sdk@0.4.0`**~~ **DONE (v3.10.3-dev)** — `PForgeClient`, `createClient`, `PForgeClientError`; method groups for runs / memory / crucible / liveguard; generic `tool()` dispatcher. 38 tests. | M | ✅ Shipped as `pforge-sdk@0.4.0` |
| 2 | **Lattice + Hallmark as standalone catalog extensions** — extract to standalone packages so projects can adopt code-graph or provenance stamping without the full forge. | L | Demand signal from at least 3 external repos. |
| 3 | ~~**CLI-GUIDE refresh** covering `pforge digest`, `plan-from-sarif`, `sync-spaces`, `hammer-fm`, `fm-session`, `fm-recall` — these commands exist but their CLI-GUIDE entries are stubs.~~ **DONE (v3.8.2)** — Added full entries for `digest`, `fm-recall`, `plan-from-sarif`, `sync-spaces`, `forge-home-cleanup`, `timeline`, `patterns`, `graph`, `sync-memories`, `sync-instructions`, `github`, `crucible`, `skills`, and `mcp-call`. | S | ✅ Triggered by `forge-home-cleanup` CLI addition (v3.8.1) |
| 4 | ~~**Manual Appendix G — "Unified API Surface Index"**~~ **DONE (v3.12.0)** — `docs/manual/api-surface-index.html` (Appendix Q) updated: resolved 3 merge conflicts, added 15 missing MCP tools across 2 new domains (Anvil, Semantic recall), corrected all tool counts (88 listed → 103 total), added `digest-reader` SDK sub-path, expanded REST prefix table. | M | ✅ Shipped — SDK 0.4.0+ landed |
| 5 | **Landing-page screenshot refresh** — several screenshots on [docs/index.html](docs/index.html), [docs/dashboard.html](docs/dashboard.html), and [docs/shop-tour.html](docs/shop-tour.html) predate the 37-tab dashboard taxonomy. | S | Next visible UI change to the dashboard chrome. |
| 6 | **L3 retrofit** — wire `forge_diagnose`, `forge_sweep`, `forge_run_skill` through `captureMemory()` and add an `l3Writes` field to `tools.json` for auditable coverage. | M | After v3.6 ships; pre-requisite for "L4 shared tenant" experiment. |

---

## Shipped Versions (Compressed)

> Full details for each release are in [CHANGELOG.md](CHANGELOG.md). Only summaries are kept here.

### v1.x — Foundation

- **v1.4** — MCP Server: 17+ tools, `.vscode/mcp.json` auto-generation
- **v1.5** — Cross-Artifact Analysis: `pforge analyze <plan>` consistency scoring
- **v1.6** — Intelligence Layer: merged into v2.0/v2.1 (tokens, cost, metrics)

### v2.0 — Autonomous Execution ✅

DAG-based orchestration engine. `forge_run_plan` MCP tool + `pforge run-plan` CLI. Full Auto and Assisted modes. Model routing per slice. File-based status in `.forge/runs/`. Validation gates at every boundary. Token tracking, cost estimation, auto-sweep, auto-analyze. 103 self-tests.

### v2.1 — WebSocket Hub + Dashboard ✅

Real-time dashboard at `localhost:3100/dashboard` with 12 features: slice progress, model routing viz, run history, cost tracker, session replay, extension marketplace UI, notifications, config editor. WebSocket event bus, session registry.

### v2.2 — Parallel Execution ✅

`[P]`-tagged slices execute in parallel via ParallelScheduler. Configurable `maxParallelism`, conflict detection, auto-retry, scope isolation.

### v2.3 — Machine-Readable API Surface ✅

`tools.json`, `cli-schema.json`, `forge_capabilities` MCP tool, `.well-known` HTTP endpoint. Intent tags, prerequisites, cost hints, workflow graphs, error catalog, deprecation signals.

### v2.4 — Unified Telemetry ✅

OTLP-compatible traces in `.forge/runs/*/trace.json`. Resource context, span kinds, severity levels, gates as child spans. Built-in trace viewer in dashboard. Log registry with per-run manifests and global index.

### v2.5 — Quorum Mode ✅

Multi-model consensus for high-complexity slices. 3 models in parallel dry-run, reviewer synthesizes best approach. Complexity scoring (1-10), auto threshold, `quorum=auto` default. 83 tests.

### v2.6 — OpenClaw Bridge ✅

Telegram/Slack/Discord webhook notifications, approval gate state machine, 4 platform formatters, REST endpoints.

### v3.0 — Multi-Agent Orchestration ✅

Agent-per-slice routing from `model-performance.json`. Auto-escalation on failure. CI/CD integration. Cost optimization from historical data.

### v2.14 — Copilot Platform Integration (Quick Wins) ✅

- **A1** One-click plugin install (`vscode://chat-plugin/install`)
- **A2** Model deprecation sweep (GPT-5.1 → GPT-5.3-Codex/5.4)
- **A3** Cloud agent integration (`copilot-setup-steps.yml`)
- **A4** Copilot Memory coexistence docs

### v2.15–v2.17 ✅

- **v2.15** — `forge_org_rules` MCP tool, `/forge-troubleshoot` skill, quorum=auto default
- **v2.16** — Nested subagent pipeline, status-reporting instruction file
- **v2.17** — Dashboard reliability fixes, event watcher rewrite

### v2.18 — Temper Guards & Onboarding Polish ✅

Temper Guards (anti-shortcut tables) and Warning Signs (behavioral anti-patterns) in 41 instruction files across 8 presets. `context-fuel.instructions.md` for agent context management. Quick Forge Card on website. `pforge tour` interactive CLI walkthrough.

### v2.19 — Skill Blueprint & Verification Gates ✅

`docs/SKILL-BLUEPRINT.md` formal spec. Exit Proof checklists and Temper Guards in all 79 skills. Full skill format: Frontmatter → Trigger → Steps → Safety Rules → Temper Guards → Warning Signs → Exit Proof → Persistent Memory.

### v2.20 — Forge Quench ✅

`/forge-quench` code simplification skill. Chesterton's Fence principle (understand before removing). 5-step workflow: Measure → Understand → Propose → Prove → Report. 9 variants with stack-specific complexity tools (radon, gocyclo, clippy, eslint, phpmd, pmd, swiftlint).

---

## Shipped (LiveGuard)

### v2.27.0 — LiveGuard I: Post-Coding Intelligence ✅

9 MCP tools for post-deploy monitoring, drift detection, incident tracking, and operational runbooks. 14 REST endpoints. `.forge.json` `onCall` field. Dashboard LIVEGUARD section.

### v2.28.0 — LiveGuard II: Secret Scanning & Env Diff ✅

`forge_secret_scan` (Shannon entropy, sidecar annotations, redacted output) and `forge_env_diff` (key-name-only comparison). 4 new REST endpoints. Manual chapters 15–17 + Appendix F fully written. Dashboard Security + Env tabs.

---

## Shipped

### v2.67.0 — Zero-Key Forge-Master via GitHub Models (Phase-33) ✅

New `github-copilot-tools.mjs` provider adapter: `resolveGitHubToken()` 4-tier resolution (passed → `GITHUB_TOKEN` env → `.forge/secrets.json` → `gh auth token` subprocess cache), targets `https://models.github.ai/inference`, OpenAI-compatible chat completions with function calling included in Copilot subscriptions. Provider-selection order flipped to `githubCopilot → anthropic → openai → xai`. `config.mjs` gains `forgeMaster.defaultProvider = "githubCopilot"` and `forgeMaster.providers.githubCopilot.model = "gpt-4o-mini"`. `GITHUB_TOKEN` first in dashboard secrets UI. Skippable smoke test (`FORGE_SMOKE=1`). `scripts/smoke-forge-master.mjs` transcript writer.

### v2.66.0 — Forge-Master Advisory Mode (Phase-32) ✅

Event-delegated prompt gallery: `data-prompt-id` + delegated `click` listener replaces inline `onclick` (fixes HTML-attribute quoting bug). Intent-router glossary expanded: 9+ keyword families (slice/gate, phase refs, harden, tempering, quorum, meta-bug, crucible). New `advisory` lane: `LANES.ADVISORY`, `LANE_TOOLS.advisory` (8 read-only tools), keyword rules for advisory phrases. `pforge-master/src/principles.mjs`: `loadPrinciples({ cwd })` with per-cwd mtime cache, 10-principle `UNIVERSAL_BASELINE` (Architecture-First → Keep Gates Boring), replace/append `.forge.json#forgeMaster.philosophy` semantics. System-prompt `{principles_block}` placeholder; principles survive token-pressure trimming.

### v2.65.0 — Advisory-to-Enforcement Calibration (Phase-31) ✅

Committed-before-timeout dashboard badge (`live-session.js`). Plan-parser lint advisory in `pforge analyze` (`runAnalyze` + `planPath` parameter). Reflexion prompt wiring — `<prior_attempt>` block injected into system-prompt preamble on retries. `--strict-gates` CLI flag for opt-in gate enforcement without default flip. `scoreSliceComplexity` threshold recalibrated 6→3. Tempering suppression promoter (`promoteSuppressions`, `logSuppression`, `readSuppressions`, `readPromoteThreshold`).

### v2.64.0 — Settings Panel Decomposition (Phase-30) ✅

Settings tab decomposed into 9 sub-tabs (General, Models, Execution, API Keys, Updates, Memory, Brain, Bridge, Crucible). Cross-group tab migration: Extensions → Settings; Bug Registry + Watcher → LiveGuard. Phase-30.1 hotfix for Forge-Master Studio tab clickability.

### v2.63.0 — Forge-Master Studio (Phase-29) ✅

Dashboard tab for Forge-Master: prompt gallery, chat stream, tool-call trace pane. `/api/forge-master/*` route wiring. `pforge forge-master status|logs` CLI. `forgeMaster.studio` capabilities block. `forge-master-chat` MCP server auto-registration.

### v2.62.x — Forge-Master MVP + Hardening (Phase-28 arc) ✅

`forge_master_ask` MCP tool for open-ended reasoning (intent classification, memory retrieval, read-only tool orchestration). Bug-sweep hotfixes: Windows `spawn` ENOENT (#82), box-drawing prose detection (#83), self-update cache invalidation. Worker role guardrails: API-only models blocked from code-writing; gate portability linter; 10-min gate timeout. Self-repair capture: `forge_meta_bug_file` tool with hash-based dedupe. OpenBrain queue drain on server start (#84).

### v2.61.0 — Cost Projection UI + Per-Slice Estimator (Phase-27.2) ✅

`forge_estimate_slice` MCP tool. Dashboard projected-cost badges on slice cards. Plan-projection strip with budget warnings. `scoreSliceComplexity` calibration report.

### v2.60.0 — Forge-Master Alpha (Phase-27.1) ✅

Forge-Master alpha subsystem — preparation for Phase-28 MVP.

### v2.58.0 — Phase-26 Competitive & Self-Deterministic Loop ✅

Three new opt-in subsystems: competitive slice execution (L9, worktree race), auto-fix patch proposals (L6, advisory `.patch` drafts), cost-anomaly detection (L5, per-model median window). New Dashboard "Inner Loop" tab with six panels + six read-only API endpoints. Best-defaults preset in `setup.ps1`/`setup.sh`. Four CLI orchestrator bug fixes: `--resume-from` honored in estimate (#81), `tokens_in` no longer double-counts on `gh copilot` breakdown+aggregate (#79), `spawnWorker` honors explicit `worker` override + adds `role` parameter (#78), xAI Grok no longer refuses analysis prompts via new `buildApiMessages` system wrap (#80).

### v2.57.0 — Phase-25 Inner-Loop Enhancements ✅

Seven opt-in reflective subsystems forming a closed research loop: reflexion retry context (L7), trajectory capture (L8), auto-skill library (L2), adaptive gate synthesis (L6), plan postmortems with hardener feedback (L5), cross-project federation (L4-lite), reviewer-agent in-loop (L4, advisory). Every new behavior defaults to off/suggest/advisory.

### v2.50.0–v2.56.0 — FORGE-SHOP arc + packaging hardening ✅

v2.50.0 Forge Shop unified surfaces. v2.51.0 ask-bus pub/sub + `pforge update --from-github` + testbed harness. v2.52.0 orchestrator silent-failure guard + testbed happy-path + dashboard polish (v2.52.1 packaging hotfix). v2.53.0 Dashboard UX modernization + Capability-surface sync + Setup/Smith audit remediation (v2.53.1–v2.53.3 corrupt-install self-heal, dev-source refusal, `self-update --force`). v2.55.0 "The Forge Shop" rebrand. v2.56.0 Update Source preference.

### v2.30.0 — LiveGuard IV: Composite Run, Auto-Chaining, Test Status ✅

`forge_liveguard_run` composite tool (all checks in one call), drift `--autoIncident` auto-chains to incidents + fix proposals, drift `testStatus` field, regression history tracking, auto-resolve incidents on passing gates, sweep categorization, diff exit-code enforcement, executable gate requirement in hardener.

### v2.31–v2.39 — Crucible Arc ✅

Crucible lane model: smelt (experiment) → funnel (consolidation) → harden (ship). `forge_smelt`, `forge_funnel`, `forge_crucible_abandon`, crucible-aware `forge_smith` diagnostics, crucible-aware watcher with stalled-smelt detection, crucible-aware fix proposals (abandon-or-resume). `.forge/crucible/` store.

### v2.40–v2.45 — Tempering & Agent Orchestration ✅

TEMPER arc: visual-regression detection, baseline management, tempering-run lifecycle, agent model-routing improvements, runtime-aware escalation chains, TEMPER dashboard tab.

### v2.46–v2.48 — Self-Recursive + FORGE-SHOP kickoff ✅

v2.47.0 Self-Recursive Improvement. v2.48.0 FORGE-SHOP-01 Home tab (4-quadrant operator dashboard + activity feed).

### v2.49.0–v2.49.1 — Review queue + hotfix bundle ✅

v2.49.0 FORGE-SHOP-02 review queue (`forge_review_add/list/resolve`, Review tab, blocker notifications). v2.49.1 hotfix bundle: 5 field bugs (#56, #62, #64, #65, #70).

### v2.29.0–v2.29.3 — LiveGuard III: Self-Healing Proposals, Hooks & OpenClaw Bridge ✅

`forge_fix_proposal`, `forge_quorum_analyze`, PreDeploy/PostSlice/PreAgentHandoff hooks, OpenClaw bridge. Plus 9 bug fixes: C# empty-catch scanning, CRLF plan parsing on Windows, .NET dep-watch (.slnx support), prose validation gate parsing, framework code separation in drift/sweep scoring.

### v2.28.0 — LiveGuard II ✅

`forge_secret_scan` (Shannon entropy, sidecar annotations, redacted output) and `forge_env_diff` (key-name-only comparison). 4 new REST endpoints. Manual chapters 15–17 + Appendix F fully written. Dashboard Security + Env tabs.

---

## Planned

### LiveGuard Complements

#### B4. Validation Tools Complement Guide ✅ Shipped — v3.1.2

Document how Plan Forge gates complement cloud agent validation (CodeQL, secret scanning, Copilot code review). Adds `cloudAgentValidation` to `.forge.json` and a `cloud-agent-validation` check to `forge_github_status`. Comparison table expanded in COPILOT-VSCODE-GUIDE.md.

### v2.14 Phase C — Strategic Investments

#### C1. Copilot SDK Tool Provider

`@plan-forge/copilot-sdk` npm package exposing guardrails as Copilot SDK tools. `forge.harden()`, `forge.validateSlice()`, `forge.sweep()`, `forge.analyze()`, `forge.smith()`. System prompt transforms, OTEL passthrough, permission framework. Depends on SDK API stabilization.

#### C2. Cloud Agent Plan Export (`forge_export_plan`) ✅ Shipped — v2.97.0

Convert Copilot cloud agent session plans into hardened Plan Forge format. Parses loose plans → adds scope isolation, validation gates, forbidden actions → outputs `Phase-X-PLAN.md`.

#### C3. `forge_sync_memories` ✅ Shipped — v2.99.0 / `forge_sync_instructions` ✅ Shipped — v3.0.0

`forge_sync_memories`: Generate `.github/copilot-memory-hints.md` from OpenBrain/forge decisions. Soft-sync approach (Copilot Memory auto-discovers hints).
`forge_sync_instructions`: Generate `.github/copilot-instructions.md` from forge project context (profile, principles, config). GitHub Copilot reads this file automatically.

#### C4. Fine-Grained Tool Approval

Classify MCP tools by risk level (auto-approvable vs require confirmation). Depends on VS Code proposed API stabilization.

### v2.14 Phase D — Watch List

| # | Item | Trigger to Build |
|---|------|-----------------|
| D1 | Cloud agent signed commits | Users request auditability |
| D2 | Jira integration | Jira API documented |
| D3 | Merge conflict resolution | API callable from MCP |
| D4 | Session tracing for audit | Trace format documented |
| D5 | Chat Customizations editor | ✅ Shipped — v3.1.0 |
| D6 | Agentic code review delegation | ✅ Shipped — v3.3.0 |
| D7 | Plan mode metrics | GitHub metrics API exposes data |

---

### v2.21 — Forge Anneal (Documentation Consolidation) ✅

Shipped v2.21.0 (2026-04-10). Documentation audit: README thinning, ROADMAP compression, overlap dedup, runbook consolidation.

---

### v3.1 — Team Mode

Coordinate multiple orchestrators across developers.

- Multiple orchestrators coordinate, avoiding merge conflicts
- Team activity feed (real-time cross-developer plan progress)
- Team dashboard (multi-developer plan coordination UI)

---

## Backlog

### Phase-31 candidates
- ~~Advisory-to-enforcement calibration~~ — shipped v2.65.0
- ~~Orchestrator timeout-retry cleanup~~ — meta-bug [#88](https://github.com/srnichols/plan-forge/issues/88) closed
- ~~Plan-gate parser hardening for bare bash blocks~~ — meta-bug [#89](https://github.com/srnichols/plan-forge/issues/89) closed; `runtime.planParser.implicitGates` shipped
- ~~`scoreSliceComplexity` recalibration~~ — threshold recalibrated 6→3 in v2.65.0

### Community & Docs
- `specify init` detection — auto-detect Spec Kit project and layer Plan Forge guardrails *(waits on user demand)*

---

## Under Consideration

No committed timeline — evaluating based on community feedback.

---

## How to Influence the Roadmap

1. **Vote on existing issues** — 👍 reactions help us prioritize
2. **Open a feature request** — [GitHub Issues](https://github.com/srnichols/plan-forge/issues) with the `enhancement` label
3. **Contribute directly** — See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

