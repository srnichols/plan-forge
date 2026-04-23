# Plan Forge — Project Roadmap

> **Purpose**: Public roadmap for the Plan Forge framework itself.  
> **Not to be confused with**: `docs/plans/DEPLOYMENT-ROADMAP.md` — that's the template your project uses for feature tracking.

---

## Current Release

**v2.68.0** (2026-04-22) — Forge-Master Reasoning Dial (Phase-34). Three-tier reasoning dial (Fast / Balanced / Deep) added to the Forge-Master dashboard. `reasoning-tier.mjs` resolves tier → model without exposing model names in the UI. Auto-escalation default-on for `tempering`, `principle-judgment`, and `meta-bug-triage` lanes. 429 graceful degradation: `high → medium → low` fallback chain with turn-trace fields. `GET/PUT /api/forge-master/prefs` REST endpoints. Opt-out via `forgeMaster.autoEscalate = false`.

Previous: v2.67.0 (2026-04-22) — Zero-Key Forge-Master via GitHub Models (Phase-33). New `github-copilot-tools.mjs` provider adapter targets `https://models.github.ai/inference` and authenticates via `GITHUB_TOKEN` / `gh auth login` — no third-party API key required. Provider-selection order flipped to `githubCopilot → anthropic → openai → xai`. `GITHUB_TOKEN` is now the first entry in the dashboard secrets UI. Skippable smoke test guards against regressions without breaking CI.

Previous: v2.66.0 (2026-04-22) — Forge-Master Advisory Mode (Phase-32). Event-delegated prompt gallery, intent-router glossary expanded (9+ keyword families), advisory lane with `LANES.ADVISORY`, `principles.mjs` UNIVERSAL_BASELINE, `{principles_block}` in system prompt.

Previous: v2.65.1 (2026-04-22) — version-bump architectural rebuild (Phase-31.1, closes #91). `Get-VersionTargets` manifest, `pforge.sh` parity port, Vitest regression suite.

Previous: v2.63.1 (Phase-28.5 tempering mtime sort + docs nav hover fix), v2.63.0 (Phase-29 Forge-Master Studio dashboard tab + routes + CLI), v2.62.x (Forge-Master MVP, worker role guardrails, self-repair capture, OpenBrain queue drain), v2.61.0 (Phase-27.2 cost projection UI + per-slice estimator).

**In flight (next)**: TBD — Phase-35 planning open. Candidates include per-tier rate-limit budget tracking, cost meter on the dial, ML-backed complexity scoring, VS Code LM adapter for Forge-Master, Team Mode (v3.1).

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

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

Committed-before-timeout dashboard badge (`live-session.js`). Plan-parser lint advisory in `pforge analyze` (`runAnalyze` + `planPath` parameter). Reflexion prompt wiring — `<prior_attempt>` block injected into system-prompt preamble on retries. `--strict-gates` CLI flag for opt-in gate enforcement without default flip. `scoreSliceComplexity` threshold recalibrated 6→3 (research note in `docs/research/complexity-threshold-v2.65.md`). Tempering suppression promoter (`promoteSuppressions`, `logSuppression`, `readSuppressions`, `readPromoteThreshold`).

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

#### B4. Validation Tools Complement Guide

Document how Plan Forge gates complement cloud agent validation (CodeQL, secret scanning, Copilot code review). Add comparison table to COPILOT-VSCODE-GUIDE.md. Optional `.forge.json` `cloudAgentValidation` key. *(Related content already lives in [faq.html](docs/faq.html) and [index.html](docs/index.html) — formal guide-page table is incremental polish.)*

### v2.14 Phase C — Strategic Investments

#### C1. Copilot SDK Tool Provider

`@plan-forge/copilot-sdk` npm package exposing guardrails as Copilot SDK tools. `forge.harden()`, `forge.validateSlice()`, `forge.sweep()`, `forge.analyze()`, `forge.smith()`. System prompt transforms, OTEL passthrough, permission framework. Depends on SDK API stabilization.

#### C2. Cloud Agent Plan Export (`forge_export_plan`)

Convert Copilot cloud agent session plans into hardened Plan Forge format. Parses loose plans → adds scope isolation, validation gates, forbidden actions → outputs `Phase-X-PLAN.md`.

#### C3. `forge_sync_memories`

Generate `.github/copilot-memory-hints.md` from OpenBrain/forge decisions. Soft-sync approach (Copilot Memory auto-discovers hints). Hard-sync via write API when available.

#### C4. Fine-Grained Tool Approval

Classify MCP tools by risk level (auto-approvable vs require confirmation). Depends on VS Code proposed API stabilization.

### v2.14 Phase D — Watch List

| # | Item | Trigger to Build |
|---|------|-----------------|
| D1 | Cloud agent signed commits | Users request auditability |
| D2 | Jira integration | Jira API documented |
| D3 | Merge conflict resolution | API callable from MCP |
| D4 | Session tracing for audit | Trace format documented |
| D5 | Chat Customizations editor | Add when convenient |
| D6 | Agentic code review delegation | Native review API matures |
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
- Advisory-to-enforcement calibration — graduate Phase-25/26 subsystems (reviewer-agent, auto-fix, cost-anomaly, competitive) from advisory to blocking/auto-apply once field data justifies thresholds
- Orchestrator timeout-retry cleanup — meta-bug [#88](https://github.com/srnichols/plan-forge/issues/88)
- Plan-gate parser hardening for bare bash blocks — meta-bug [#89](https://github.com/srnichols/plan-forge/issues/89)
- `scoreSliceComplexity` recalibration — threshold 5 selects zero slices on real plans (v2.61.0 research report)

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
