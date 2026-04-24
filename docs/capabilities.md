# Plan Forge — Capabilities Reference

> **Tools**: 67 MCP (20 core + 14 LiveGuard + 2 Watcher + 6 Crucible + 6 Tempering + 4 Bug Registry + 3 Testbed + 3 Review + 3 Notify/Home/Delegate + additional doctor/memory/search/timeline/org) | **CLI**: 46+ commands | **Presets**: 9 | **Agents**: 20 | **Skills**: 14
>
> Machine-readable version: call `forge_capabilities` MCP tool, `GET https://planforge.software/.well-known/plan-forge.json`, or read `pforge-mcp/tools.json` (auto-generated on every MCP server start).

---

## MCP Tools (67)

| Tool | Intent | Cost | Description |
|------|--------|------|-------------|
| `forge_capabilities` | discover | low | Returns full API surface — tools, workflows, config, memory, glossary |
| `forge_run_plan` | execute | high | Execute a hardened plan — DAG scheduling, validation gates, token tracking |
| `forge_abort` | stop | low | Abort active plan execution between slices |
| `forge_plan_status` | read | low | Latest run status from `.forge/runs/` |
| `forge_cost_report` | read | low | Cost tracking — total spend, per-model, monthly aggregation |
| `forge_smith` | diagnose | low | Environment diagnostics — VS Code config, setup health, version |
| `forge_validate` | validate | low | Check setup files, counts, placeholders |
| `forge_sweep` | scan | low | Find TODO/FIXME/stub/placeholder markers |
| `forge_status` | read | low | Phase status from DEPLOYMENT-ROADMAP.md |
| `forge_diff` | compare | low | Scope drift detection against plan's Scope Contract |
| `forge_analyze` | score | medium | Consistency scoring (0-100) with optional quorum mode for multi-model consensus. Supports plan/file modes and custom model overrides |
| `forge_diagnose` | analyze | medium | Multi-model bug investigation — dispatches file analysis to N models independently, synthesizes root cause + fix recommendations |
| `forge_ext_search` | search | low | Browse extension catalog |
| `forge_ext_info` | read | low | Extension details |
| `forge_new_phase` | create | low | Create plan file + roadmap entry |
| `forge_skill_status` | read | low | Query recent skill execution events from the hub |
| `forge_run_skill` | execute | medium | Execute any skill programmatically with dry-run mode and structured results |
| `forge_generate_image` | create | medium | Generate images via xAI Grok Aurora or OpenAI DALL-E. Saves to disk. For logos, diagrams, icons, mockups |
| `forge_memory_capture` | capture | low | Normalise and broadcast a `memory-captured` hub event; returns `capture_thought` payload for OpenBrain |
| `forge_drift_report` | drift-detect | low | Score codebase against architecture guardrail rules; track drift over time |
| `forge_incident_capture` | capture-incident | low | Record incidents with severity, affected files, MTTR tracking, on-call notification |
| `forge_dep_watch` | dep-scan | low | Scan dependencies for CVEs; compare against previous snapshot; alert on new vulnerabilities |
| `forge_regression_guard` | regression-check | medium | Extract validation gates from plans, execute against codebase, report pass/fail |
| `forge_runbook` | generate-runbook | low | Generate operational runbook from a hardened plan file |
| `forge_hotspot` | churn-analysis | low | Identify git churn hotspots — files that change most frequently |
| `forge_health_trend` | health, health-dna | low | Aggregate drift, cost, incidents, model performance, tests over time; health score 0–100; project health DNA fingerprint |
| `forge_alert_triage` | triage-alerts | low | Read incidents and drift violations, rank by priority, return prioritized list |
| `forge_deploy_journal` | record-deploy | low | Record deployments with version, deployer, notes; correlates with incident capture |
| `forge_secret_scan` | secret-scan | low | High-entropy secret detection in diffs — values always redacted, findings masked before caching |
| `forge_env_diff` | env-diff | low | Environment variable key divergence across `.env` files — keys only, values never read |
| `forge_fix_proposal` | propose-fix | medium | Generate actionable fix plans for regressions, drift, or incidents |
| `forge_quorum_analyze` | quorum-analyze | low | Build XSS-validated quorum prompts from drift, incidents, deploy journal, or secret findings |
| `forge_liveguard_run` | liveguard-all | medium | Composite LiveGuard scan: drift + sweep + secrets + regression + deps + alerts + health in one call |
| `forge_watch` | observe | low | Watcher v2.34/v2.35 — read-only observer that tails another project's pforge run from a second VS Code session. Snapshot or analyze mode. Returns counts, anomalies, recommendations, diff cursor. Optionally appends to watcher's own `.forge/watch-history.jsonl`. |
| `forge_watch_live` | stream | low | Watcher v2.35 live tail — streams events from a target project for a fixed duration via WebSocket subscription (preferred) or `events.log` polling (fallback). Read-only subscriber. |
| `forge_crucible_submit` | crucible | low | **v2.37-dev** — Start a smelt (raw idea) in the Crucible interview funnel; infers lane (tweak/feature/full); emits `crucible-smelt-started`. |
| `forge_crucible_ask` | crucible | low | **v2.37-dev** — Return next interview question (lane-scoped) with optional recommended default sourced from L3 memory / principles / prior phases. |
| `forge_crucible_preview` | crucible | low | **v2.37-dev** — Render current draft + list unresolved `{{TBD:}}` fields before finalization. |
| `forge_crucible_finalize` | crucible | medium | **v2.37-dev** — Atomically claim next phase number, write `docs/plans/<phase>.md` with `crucibleId:` frontmatter, mark smelt finalized, emit `crucible-smelt-finalized`. |
| `forge_crucible_list` | crucible | low | **v2.37-dev** — List all smelts with status filter (in-progress / finalized / abandoned). |
| `forge_crucible_abandon` | crucible | low | **v2.37-dev** — Mark smelt abandoned, release any claimed phase number. |
| `forge_tempering_run` | tempering | medium | **v2.40+** — Run full tempering pipeline (scan + score) against a Crucible-finalized plan. Writes temper-score snapshot. |
| `forge_tempering_scan` | tempering | low | **v2.40+** — Scan for temper-quality signals (Scope Contract clarity, validation gates, slice sizing, forbidden actions). |
| `forge_tempering_status` | tempering | low | **v2.40+** — Read latest tempering results per plan. |
| `forge_tempering_approve_baseline` | tempering | low | **v2.40+** — Approve current tempering score as the new baseline threshold. |
| `forge_tempering_drain` | tempering | medium | **v2.80+** — Run the audit drain loop: iterates content-audit scan → triage → fix rounds until convergence or maxRounds. Accepts `project`, `maxRounds`, `scanners`, `dryRun`, `env`. |
| `forge_triage_route` | tempering | low | **v2.80+** — Route a single finding through the triage classifier. Returns `{ lane, payload, confidence }` where lane is `"bug"`, `"spec"`, or `"classifier"`. |
| `forge_bug_register` | bug-registry | low | **v2.45+** — Register a bug with severity, title, description, affected files, linked plan/slice. |
| `forge_bug_list` | bug-registry | low | **v2.45+** — List bugs with status/severity/plan filters. |
| `forge_bug_update_status` | bug-registry | low | **v2.45+** — Update bug status (open → investigating → in-progress → resolved → closed). |
| `forge_bug_validate_fix` | bug-registry | medium | **v2.45+** — Verify proposed fix against bug description + linked slice gates. |
| `forge_testbed_run` | testbed | medium | **v2.50+** — Execute a single testbed scenario by ID against a target project. |
| `forge_testbed_happypath` | testbed | high | **v2.52+** — Run all happy-path scenarios sequentially, aggregate results, return pass/fail summary. |
| `forge_testbed_findings` | testbed | low | **v2.50+** — Read cumulative testbed findings (failures, flaky scenarios, runtime trends). |
| `forge_review_add` | review | low | Capture a review thread (audit, gate failure, drift finding) linked to a plan/slice. |
| `forge_review_list` | review | low | List open/resolved review threads. |
| `forge_review_resolve` | review | low | Mark a review thread resolved with outcome + rationale. |
| `forge_notify_send` | notify | low | Emit a notification through configured channels (Telegram, Slack, webhook, email). |
| `forge_notify_test` | notify | low | Smoke-test each notification channel and return success/failure per channel. |
| `forge_home_snapshot` | dashboard | low | Build the dashboard **Home** tab payload (run state, drift, incidents, cost, health DNA, notifications). |
| `forge_timeline` | timeline | low | Unified event timeline across runs, incidents, deploys, bugs, Crucible, Tempering (cursor-paged). |
| `forge_search` | search | low | Cross-surface search over plans, events, bugs, incidents, memory (filters by type/date/severity). |
| `forge_memory_report` | memory | low | Summarize OpenBrain memory usage — captures per day, hit rate on searches, top-recalled thoughts. |
| `forge_org_rules` | org-rules | low | Export aggregated `.github/instructions/*.md` as a single org-rules document (for GitHub org custom instructions). |
| `forge_doctor_quorum` | diagnostics | low | Health-check every quorum participant model — auth, latency, rate-limit headers, per-model availability. |
| `forge_delegate_to_agent` | agent-routing | medium | Delegate a prompt/slice to a specialized reviewer agent (database, security, performance, etc.) and return the agent's report. |
| `forge_self_update` | release | low | Check for the latest Plan Forge release, fetch release notes, and (optionally) trigger install. |

## Execution Modes

| Mode | Flag | Worker | Description |
|------|------|--------|-------------|
| **Full Auto** | *(default)* | `gh copilot` CLI | Agent executes each slice with full project context |
| **Assisted** | `--assisted` | Human in VS Code | Orchestrator prompts, human codes, gates validate |
| **Cloud Agent** | *(via `copilot-setup-steps.yml`)* | Copilot cloud agent | Cloud agent provisions environment, guardrails auto-load, MCP tools available |
| **Quorum** | `--quorum` | 3 models + reviewer | All slices: 3 dry-run analyses → synthesis → execute |
| **Quorum Auto** | `--quorum=auto` | 3 models (selective) | Only high-complexity slices (score ≥ threshold) get quorum |
| **Estimate** | `--estimate` | None | Returns cost prediction without executing |
| **Dry Run** | `--dry-run` | None | Parses and validates plan structure |
| **Resume** | `--resume-from N` | Same as auto | Skips completed slices |

## Inner Loop (v2.57.0, extended in v2.58.0)

Ten opt-in subsystems that turn deterministic slice execution into a closed research loop. All default to *off*, *suggest*, or *advisory* — nothing in existing workflows breaks. See `docs/manual/inner-loop.html` and `docs/manual/competitive-loop.html` for the full state-flow diagrams.

| Subsystem | Level | Default | Config Key | Storage |
|-----------|-------|---------|------------|---------|
| **Reflexion retry context** | L7 | always on | *(none)* | in-memory |
| **Trajectories** | L8 | always on | *(none)* | `.forge/trajectories/<slice>/*.md` |
| **Auto-skill library** | L2 | always on | *(none, Phase-26 toggles)* | `.forge/auto-skills/*.md` |
| **Adaptive gate synthesis** | L6 | suggest | `runtime.gateSynthesis.mode` | stdout only (never mutates plans) |
| **Plan postmortems** | L5 | always on | *(retention=10)* | `.forge/plans/<basename>/postmortem-*.json` |
| **Cross-project federation** | L4-lite | off | `brain.federation.enabled` | read-only, absolute local paths only |
| **Reviewer-agent in-loop** | L4 | off, advisory | `runtime.reviewer.enabled` | verdict attached to gate-check response |
| **Competitive execution** (v2.58) | L9 | off | `innerLoop.competitive.enabled` | worktrees under `.forge/worktrees/`; losers cleaned up |
| **Auto-fix proposals** (v2.58) | L6 | advisory | `innerLoop.autoFix.applyWithoutReview` | `.forge/proposed-fixes/*.patch` |
| **Cost-anomaly detection** (v2.58) | L5 | advisory | `innerLoop.costAnomaly.ratio` | `.forge/cost-anomalies.jsonl` |

Discover at runtime via `forge_capabilities` → `innerLoop`. Configure via Dashboard → Config tab, Dashboard → Inner Loop tab (v2.58+), or `.forge.json`.

## Self-Deterministic Agent Loop

The ten inner-loop subsystems above compose into what we call a **self-deterministic agent loop**. The slice executor stays deterministic — same plan, same config, same outcome — while the Phase-25 reflective layer (L1–L8) and Phase-26 competitive layer (C1–C3) let the loop observe itself and feed what it learns back into the next slice, the next plan's hardener, or a sibling project. Every feedback arrow is opt-in or advisory; the execution contract never mutates silently. Canonical narrative with two Mermaid diagrams: [`docs/manual/self-deterministic-loop.html`](manual/self-deterministic-loop.html).

## Agent-Per-Slice Routing

Assign a different AI model to each execution role via `modelRouting` in `.forge.json`. The orchestrator selects the appropriate model automatically based on the current operation:

| Role | Key | Default | Typical Use |
|------|-----|---------|-------------|
| General / fallback | `default` | `claude-opus-4.6` | Spec, harden, review |
| Slice execution | `execute` | `gpt-5.2-codex` | Writing code, generating tests |
| Review & audit | `review` | `claude-sonnet-4.6` | Gate checks, drift detection |

Config (`.forge.json`):
```json
{
  "modelRouting": {
    "default": "claude-opus-4.6",
    "execute": "gpt-5.2-codex",
    "review": "claude-sonnet-4.6"
  }
}
```

Override at runtime: `pforge run-plan <plan> --model gpt-5.2-codex` (applies to all roles for that run).
API providers (xAI Grok, etc.) are auto-routed by model name pattern — no extra config required.

## Auto-Escalation

When a slice fails repeatedly, the orchestrator automatically re-routes to the next model in `escalationChain` rather than retrying on the same model.

Config (`.forge.json`):
```json
{
  "escalationChain": ["auto", "claude-sonnet-4.6", "claude-opus-4.6"]
}
```

- Attempt 0: uses the configured/default model
- Attempt 1+: walks the chain in order (`"auto"` defers to `modelRouting.execute`)
- Emits `slice-escalated` event with `sliceId`, `reason`, and `models`
- Set `maxRetries` to control how many attempts are made before a slice is marked failed

## Model Performance Tracking

Per-slice performance data is appended to `.forge/model-performance.json` after every run. The orchestrator reads this file on startup and auto-selects the cheapest model with >80% historical success rate for each slice type.

| Field | Description |
|-------|-------------|
| `model` | Model name used for the slice |
| `sliceGoal` | Slice goal text (used for slice-type matching) |
| `passed` | `true` if the validation gate passed |
| `durationMs` | Slice execution time in milliseconds |
| `cost` | Estimated token cost for the slice |

- `--estimate` output shows the recommended model per slice with historical success rate
- Dashboard **Cost tab** shows a **Model Performance** table: run count, pass rate (color-coded), average duration, cost per run, total tokens
- `forge_cost_report` MCP tool includes `forge_model_stats` (aggregated per-model stats)

## CLI Commands (45+)

```
pforge smith                          # Environment diagnostics (+ Bug Registry, Notifications, Timeline/Search sources)
pforge check                          # Validate setup (MCP server, VERSION, dashboard, secrets)
pforge status                         # Phase status from roadmap
pforge sweep                          # Find deferred-work markers
pforge tour                           # Guided walkthrough of installed files
pforge new-phase <name>               # Create plan + roadmap entry
pforge branch <plan>                  # Git branch from plan's Branch Strategy
pforge commit <plan> <N>              # Conventional commit from slice goal
pforge phase-status <plan> <status>   # Update roadmap status
pforge diff <plan>                    # Scope drift detection
pforge analyze <plan>                 # Consistency scoring (0-100)
pforge analyze <plan> --quorum        # Multi-model consensus analysis
pforge analyze <file> --mode file     # Code file analysis
pforge analyze <target> --models m1,m2 # Custom model lineup
pforge diagnose <file>                # Multi-model bug investigation
pforge diagnose <file> --models m1,m2 # Bug investigation with custom models
pforge run-plan <plan>                # Execute plan (Full Auto)
pforge run-plan <plan> --estimate     # Cost prediction
pforge run-plan <plan> --assisted     # Human + automated gates
pforge run-plan <plan> --quorum       # Multi-model consensus (all slices)
pforge run-plan <plan> --quorum=auto  # Consensus for complex slices only
pforge run-plan <plan> --quorum=power # Flagship models, threshold 5, 5min timeout
pforge run-plan <plan> --quorum=speed # Fast models, threshold 7, 2min timeout
pforge ext search|add|info|list       # Extension management

# LiveGuard CLI (v2.27.0+)
pforge drift [--threshold N]          # Architecture drift score
pforge incident list                   # Open incidents
pforge incident capture                # Capture a new incident
pforge dep-watch                       # Dependency vulnerability scan
pforge regression-guard [--plan <plan>] # Validate regression gates
pforge hotspot [--top N]              # High-churn / high-failure files
pforge health-trend [--window 7d|30d|90d] # MTTBF + drift + cost trend
pforge triage                         # Ranked cross-signal alert list
pforge deploy-log <version> [--notes …] [--slice …] # Deployment journal entry
pforge runbook <plan>                 # Generate plan runbook

# LiveGuard CLI (v2.28.0+)
pforge secret-scan [--depth N]        # High-entropy secret detection
pforge env-diff                       # Env variable key divergence across .env files

# LiveGuard CLI (v2.29.0+)
pforge fix-proposal <finding-id>      # Generate scoped fix plan for drift / incident
pforge quorum-analyze                 # Assemble quorum prompt from LiveGuard data

# Release + version CLI (v2.33+)
pforge self-update [--force|--dry-run] # Install latest Plan Forge release
pforge version-bump <version>          # Update VERSION, package.json, docs
pforge migrate-memory [--dry-run]      # Merge legacy *-history.json into .jsonl siblings

# Config CLI (v2.56+)
pforge config get <key>                # Read a settable key from .forge.json
pforge config set <key> <value>        # Write atomically (tmp + rename)
pforge config list                     # Show all settable keys
# Current settable keys:
#   update-source  →  auto | github-tags | local-sibling  (default: auto)

# Org + export CLI (v2.40+)
pforge org-rules export [--format github] [--output <file>]  # Export org custom instructions

# Testbed CLI (v2.52+)
pforge testbed-happypath [--dry-run]  # Run all happy-path scenarios sequentially

# Generic MCP proxy (v2.53+)
pforge mcp-call <tool> [--json '{…}']  # Call any MCP tool by name (covers tools without a dedicated CLI wrapper)

# Agent installers
pforge claude | pforge codex | pforge cursor | pforge copilot  # Install native agent files
```

## API Providers

Plan Forge supports OpenAI-compatible HTTP endpoints via the `API_PROVIDERS` registry. Models are auto-routed by name pattern.

| Provider | Models | Env Var | Endpoint |
|----------|--------|---------|----------|
| **GitHub Copilot** *(recommended)* | `gpt-4o-mini` *(default)*, `gpt-4o`, `claude-sonnet-4`, `claude-opus-4` | `GITHUB_TOKEN` (or `gh auth login`) | `models.github.ai/inference` |
| **xAI Grok** | `grok-4.20`, `grok-4`, `grok-3`, `grok-3-mini`, `grok-4.1-fast-*` | `XAI_API_KEY` | `api.x.ai/v1` |

Set the env var, use any matching model name in `--models` or `.forge.json`, and the orchestrator routes automatically.

### API Key Fallback (`.forge/secrets.json`)

Lookup order: environment variable → `.forge/secrets.json` → null.

Store API keys in the gitignored `.forge/` directory as an alternative to environment variables:

```json
{
  "XAI_API_KEY": "xai-...",
  "OPENAI_API_KEY": "sk-..."
}
```

`.forge/` is in `.gitignore` by default — secrets are never committed.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Current run status |
| GET | `/api/runs` | Run history (last 50) |
| GET | `/api/config` | Read `.forge.json` |
| POST | `/api/config` | Write `.forge.json` |
| GET | `/api/cost` | Cost report |
| POST | `/api/tool/:name` | Invoke CLI tool via HTTP |
| GET | `/api/hub` | WebSocket hub status |
| GET | `/api/replay/:run/:slice` | Session replay log |
| GET | `/api/traces` | All runs from index |
| GET | `/api/traces/:runId` | Single run trace detail |
| GET | `/api/capabilities` | Full capability surface |
| GET | `/.well-known/plan-forge.json` | Discovery endpoint (RFC 8615) |
| POST | `/api/runs/trigger` | Start a plan run remotely — fire-and-forget, returns `triggerId` |
| POST | `/api/runs/abort` | Abort the active run |
| POST | `/api/memory/search` | Semantic search via OpenBrain (requires OpenBrain configured) |
| POST | `/api/memory/capture` | Normalise + broadcast `memory-captured` event; returns capture payload |

### LiveGuard REST (v2.27.0)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/drift` | Run architecture drift check; returns score, violations, trend |
| GET | `/api/drift/history` | Drift score history from `.forge/drift-history.json` |
| POST | `/api/incident` | Capture an incident with severity, affected files, optional resolution |
| GET | `/api/incidents` | List all captured incidents from `.forge/incidents.jsonl` |
| POST | `/api/regression-guard` | Run regression guard — execute validation gates from plan files |
| POST | `/api/deploy-journal` | Record a deployment with version, deployer, notes |
| GET | `/api/deploy-journal` | List all deploy journal entries |
| GET | `/api/triage` | Prioritized alert triage — ranked cross-signal alert list |
| POST | `/api/runbook` | Generate operational runbook from a plan file |
| GET | `/api/runbooks` | List all generated runbooks |
| GET | `/api/hotspots` | Git churn hotspot analysis |
| GET | `/api/health-trend` | Health trend analysis over configurable time window |
| POST | `/api/tool/org-rules` | Generate org-rules instruction file via REST |
| POST | `/api/image/generate` | Generate image via xAI Aurora or OpenAI DALL-E |

**LiveGuard REST (v2.28)** — Secret-scan and env-diff endpoints (shipped). See also v2.29 endpoints below. Full reference in [Chapter 16 — LiveGuard Tools Reference](manual/liveguard-tools.html).

**LiveGuard REST (v2.29):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/fix/proposals` | none | List all fix proposals from `.forge/fix-proposals.json` |
| `POST` | `/api/fix/propose` | `approvalSecret` | Generate a fix plan from regression/drift/incident/secret source |
| `GET` | `/api/quorum/prompt` | none | Assemble quorum prompt (query params: `source`, `goal`) |
| `POST` | `/api/quorum/prompt` | none | Assemble quorum prompt (JSON body, supports `customQuestion`) |

Write endpoints (`/api/runs/trigger`, `/api/runs/abort`, `/api/memory/capture`, `POST /api/config`) require `Authorization: Bearer <secret>` or `?token=<secret>` when `bridge.approvalSecret` is set in `.forge.json`. Without a secret, all endpoints are open (suitable for local-only use).

Dashboard: `http://localhost:3100/dashboard` (9+ tabs: Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces, Skills + LIVEGUARD section: 🛡️ Health, Incidents, Triage, Security, Env)

### Web UI — Live Dashboard

Real-time execution dashboard served at `http://localhost:3100/dashboard`. No build step required; updates via WebSocket as slices run.

| Tab | Purpose |
|-----|---------|
| **Progress** | Live slice cards — status, gate output, retry count |
| **Runs** | Full run history with pass/fail summary |
| **Cost** | Per-model spend, monthly aggregation, token breakdown |
| **Actions** | Trigger runs, abort, estimate cost |
| **Replay** | Session log replay for any past slice |
| **Extensions** | Browse, install, and manage extensions |
| **Config** | Edit `.forge.json` live — model routing, quorum, parallelism |
| **Traces** | OTLP waterfall timeline, span detail, severity filter |

### LiveGuard Dashboard Section

A second LIVEGUARD section appears in the tab bar after a visual divider. LIVEGUARD tabs use amber — visually distinct from FORGE tabs.

| Tab | Purpose |
|-----|---------|
| **🛡️ Health** | Overall health score, drift trend, MTTBF chart |
| **Incidents** | Open incident list, MTTR tracking, **fix-proposals feed** (v2.29) |
| **Triage** | Ranked cross-signal alert list with severity badges |
| **Security** | Secret scan results, env diff gap summary |
| **Env** | Environment variable key comparison across `.env.*` files |

Standalone (no MCP client needed): `node pforge-mcp/server.mjs --dashboard-only`

## LiveGuard MCP Tools (14 shipped v2.27–v2.30, extended through v2.53)

> Post-coding intelligence — watches gates after the forge ships. All 14 LiveGuard tools (plus 2 Watcher tools) are included in the 36-tool count above. Available as MCP tools and REST endpoints.

| Tool | What It Guards | Since |
|------|---------------|-------|
| `forge_drift_report` | Architecture drift vs. plan baseline. `--autoIncident` auto-chains to incidents + fix proposals | v2.27 |
| `forge_incident_capture` | Incident log + MTTR tracking | v2.27 |
| `forge_dep_watch` | Dependency vulnerability changes (.NET + npm) | v2.27 |
| `forge_regression_guard` | Regression gate pass/fail history. Auto-resolves overlapping incidents on pass | v2.27 |
| `forge_runbook` | Operational runbook store | v2.27 |
| `forge_hotspot` | High-churn / high-failure files | v2.27 |
| `forge_health_trend` | Long-term health + MTTBF trending | v2.27 |
| `forge_alert_triage` | Ranked cross-signal alert list | v2.27 |
| `forge_deploy_journal` | Deploy log with pre/post health delta | v2.27 |
| `forge_secret_scan` | High-entropy secret detection in diffs — values always redacted | v2.28 |
| `forge_env_diff` | Env variable key divergence across `.env` files — keys only, values never read | v2.28 |
| `forge_fix_proposal` | Generates scoped 1-2 slice fix plan from regression/drift/incident/secret failure; loop-capped, human-approved | v2.29 |
| `forge_quorum_analyze` | Assembles structured LiveGuard quorum prompt for multi-model analysis — no LLM calls in server | v2.29 |
| `forge_liveguard_run` | Composite health check — runs all LiveGuard tools in one call, returns unified green/yellow/red status | v2.30 |

## Lifecycle Hooks (v2.29.0)

Three hooks configured in `.forge.json` `hooks.*` block. Specs in `.github/hooks/*.md`.

| Hook | Trigger | Behavior | Blocking? |
|------|---------|----------|-----------|
| **PreDeploy** | File write to `deploy/**`, `Dockerfile*`, `*.tf`; CLI command `docker push`, `git push`, `azd up` | Runs `forge_secret_scan`; blocks on findings (hard stop). Runs `forge_env_diff`; warns on missing keys. | Hard block on secrets; advisory on env gaps |
| **PostSlice** | `git commit` with conventional commit message (`feat\|fix\|refactor\|...`) | Reads drift history; injects amber advisory (delta >5) or red warning (delta >10 or score <70) | Never blocks |
| **PreAgentHandoff** | SessionStart with dirty branch, active plan, or `--resume-from` flag | Injects LiveGuard context header; runs regression guard on dirty files; POSTs snapshot to OpenClaw (fire-and-forget, 5s timeout). Skipped when `PFORGE_QUORUM_TURN` env var is set. | Never blocks |

Config (`.forge.json`):
```json
{
  "hooks": {
    "preDeploy":        { "enabled": true, "blockOnSecrets": true,  "warnOnEnvGaps": true, "scanSince": "HEAD~1" },
    "postSlice":        { "enabled": true, "silentDeltaThreshold": 5, "warnDeltaThreshold": 10, "scoreFloor": 70 },
    "preAgentHandoff":  { "enabled": true, "injectContext": true, "runRegressionGuard": true, "cacheMaxAgeMinutes": 30, "minAlertSeverity": "medium" }
  },
  "openclaw": { "endpoint": "https://your-openclaw-instance", "apiKey": "see .forge/secrets.json" }
}
```

## Pipeline (6 Steps)

| Step | Name | Prompt | Agent | Description |
|------|------|--------|-------|-------------|
| 0 | Specify | `step0-specify-feature.prompt.md` | Specifier | Define what and why |
| 1 | Preflight | `step1-preflight-check.prompt.md` | — | Verify prerequisites |
| 2 | Harden | `step2-harden-plan.prompt.md` | Plan Hardener | Lock spec into execution contract |
| 3 | Execute | `step3-execute-slice.prompt.md` | Executor | Build slice-by-slice (or `pforge run-plan`) |
| 4 | Sweep | `step4-completeness-sweep.prompt.md` | — | Eliminate TODO/stub markers |
| 5 | Review | `step5-review-gate.prompt.md` | Reviewer Gate | Independent audit |

Session isolation: Steps 0-2 (Session 1) → Steps 3-4 (Session 2) → Step 5 (Session 3)

## Plan Format

```markdown
### Slice 1: Title [depends: Slice 2] [P] [scope: src/auth/**]
**Build command**: `dotnet build`
**Test command**: `dotnet test`

**Tasks**:
1. Create the service
2. Add validation

**Validation Gate**:
```bash
dotnet build
dotnet test
```
```

| Tag | Meaning |
|-----|---------|
| `[P]` | Parallel-eligible — runs concurrently with other `[P]` slices |
| `[depends: Slice N]` | Waits for Slice N to complete |
| `[scope: path/**]` | Restricts worker to these paths, enables conflict detection |

## Guardrails (17-18 per preset)

Auto-loading instruction files in `.github/instructions/`:

| Domain | File | Loads When |
|--------|------|-----------|
| Architecture | `architecture-principles.instructions.md` | All files |
| Context Management | `context-fuel.instructions.md` | All files |
| Security | `security.instructions.md` | Auth, middleware, API files |
| Database | `database.instructions.md` | Data access, migration files |
| Testing | `testing.instructions.md` | Test files |
| API Patterns | `api-patterns.instructions.md` | Controller, endpoint files |
| Error Handling | `errorhandling.instructions.md` | Exception, error files |
| Performance | `performance.instructions.md` | Hot paths, query files |
| Naming | `naming.instructions.md` | All files |
| + 9 more | See preset directory | Per `applyTo` pattern |

### Temper Guards & Warning Signs

Every instruction file includes two defensive sections:

- **Temper Guards** — tables of common shortcuts agents take that still produce compiling code but erode quality (e.g., "This is too simple to test" → "Simple code gets modified later. The test documents the contract."). Named after the metallurgical process — tempering strengthens steel against brittle failure.
- **Warning Signs** — observable behavioral patterns indicating the file's guidance is being violated (e.g., "Controller contains database queries", "Empty catch block"). Helps agents self-monitor during execution and reviewers catch violations during audit.

## Agents (19 per app preset)

**Stack-specific (6)**: architecture-reviewer, database-reviewer, deploy-helper, performance-analyzer, security-reviewer, test-runner

**Cross-stack (8)**: accessibility-reviewer, api-contract-reviewer, cicd-reviewer, compliance-reviewer, dependency-reviewer, error-handling-reviewer, multi-tenancy-reviewer, observability-reviewer

**Pipeline (6)**: specifier → preflight → plan-hardener → executor → reviewer-gate → shipper

**AI Tool Adapters**: `pforge init -Agent <tool>` generates adapter files for each platform:

| Adapter | Files Generated | Notes |
|---------|----------------|-------|
| `copilot` | `.github/copilot-instructions.md` | Default — always included |
| `claude` | `CLAUDE.md`, `.claude/commands/planforge/*.md` | Claude Code slash commands |
| `cursor` | `.cursorrules`, `.cursor/rules/*.mdc` | Cursor rules + commands |
| `windsurf` | `.windsurfrules`, `.windsurf/workflows/*.md` | Windsurf rules + workflows |
| `codex` | `AGENTS.md`, `.codex/context.md` | OpenAI Codex context |
| `gemini` | `GEMINI.md`, `.gemini/commands/planforge/*.toml`, `.gemini/settings.json` | Gemini CLI commands + MCP config |
| `generic` | `.ai/instructions.md`, `.ai/commands/` | Any AI tool (configurable dir) |
| `all` | All of the above | Full multi-tool support |

## Skills (13)

Every skill follows the [Skill Blueprint](SKILL-BLUEPRINT.md) format: Frontmatter → Trigger → Steps → Safety Rules → Temper Guards → Warning Signs → Exit Proof → Persistent Memory.

| Skill | Description |
|-------|-------------|
| `/database-migration` | Generate, review, test, deploy schema migrations |
| `/staging-deploy` | Build, push, migrate, deploy, verify |
| `/test-sweep` | Run all test suites, aggregate results |
| `/dependency-audit` | Vulnerabilities, outdated, license issues |
| `/security-audit` | OWASP scan, dependency CVEs, secret leak detection, hardening report |
| `/code-review` | Architecture, security, testing, patterns |
| `/release-notes` | Generate from git history + CHANGELOG |
| `/api-doc-gen` | OpenAPI spec generation + validation |
| `/onboarding` | New developer setup walkthrough |
| `/health-check` | Forge diagnostic: smith → validate → sweep |
| `/forge-execute` | Guided plan execution: list → estimate → execute → report |
| `/forge-troubleshoot` | Diagnose and resolve plan failures, gate errors, and environment issues |
| `/forge-quench` | Reduce code complexity while preserving behavior — Chesterton's Fence |

## Telemetry

Per-run in `.forge/runs/<timestamp>/`:

| File | Format | Content |
|------|--------|---------|
| `trace.json` | OTLP JSON | Spans (SERVER/INTERNAL/CLIENT), events with severity, resource context |
| `manifest.json` | JSON | Artifact registry — lists all files in the run |
| `run.json` | JSON | Run metadata (plan, model, mode, sliceCount) |
| `summary.json` | JSON | Aggregate results, cost breakdown, sweep/analyze scores |
| `slice-N.json` | JSON | Per-slice result (status, tokens, gate output, attempts) |
| `slice-N-log.txt` | Text | Full worker stdout/stderr session log |
| `events.log` | Text | Timestamped lifecycle events |

Global: `.forge/runs/index.jsonl` — append-only run index for instant lookup

Severity levels: TRACE(1), DEBUG(5), INFO(9), WARN(13), ERROR(17), FATAL(21)

## Cost Tracking

- 23-model pricing table (Claude, GPT, Gemini)
- Per-slice token counts from worker stderr stats
- `.forge/cost-history.json` — aggregate across runs
- `forge_cost_report` MCP tool / `GET /api/cost`
- `--estimate` uses historical averages when available
- `--estimate --quorum` shows overhead breakdown per quorum-eligible slice

## Quorum Mode

Multi-model consensus: dispatch complex slices to 3 AI models for independent dry-run analysis, then a reviewer synthesizes the best approach.

```
slice → scoreComplexity (1-10)
          ├─ score < threshold → normal execution
          └─ score ≥ threshold → quorumDispatch
                    ├─ Claude Opus 4.6  → dry-run plan  ─┐
                    ├─ GPT-5.3-Codex    → dry-run plan  ─┼─ Promise.all() (parallel)
                    └─ Grok 4.20        → dry-run plan  ─┘
                              ↓
                    quorumReview (synthesis — pick best approach per file)
                              ↓
                    spawnWorker (enhanced prompt) → gate ✓
```

| Signal | Weight | Source |
|--------|--------|--------|
| File scope count | 20% | `[scope:]` patterns in slice header |
| Cross-module deps | 20% | `[depends:]` tag count |
| Security keywords | 15% | auth, token, RBAC, encryption, JWT, etc. |
| Database keywords | 15% | migration, schema, ALTER, CREATE TABLE, etc. |
| Gate line count | 10% | Lines in validation gate |
| Task count | 10% | Number of tasks in slice |
| Historical failures | 10% | Past failure rate from `.forge/runs/` |

Config (`.forge.json`):
```json
{
  "quorum": {
    "enabled": false,
    "auto": true,
    "threshold": 7,
    "models": ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    "reviewerModel": "claude-opus-4.6",
    "dryRunTimeout": 300000
  }
}
```

- `strictAvailability: false` (default) — drop unavailable models with a warning, continue if ≥1 remain
- `strictAvailability: true` — fast-fail (exit 2) if *any* configured model is unavailable
- Zero available models always fast-fails regardless of this setting

CLI: `--quorum` (all slices) | `--quorum=auto` (threshold) | `--quorum-threshold N` (override) | `--quorum=power` (flagship preset) | `--quorum=speed` (fast preset)

### Quorum Presets

| Preset | Models | Reviewer | Threshold | Timeout |
|--------|--------|----------|-----------|---------|
| `power` | Claude Opus 4.6 + GPT-5.3-Codex + Grok 4.20 Reasoning | Claude Opus 4.6 | 5 | 5 min |
| `speed` | Claude Sonnet 4.6 + GPT-5.4-mini + Grok 4.1 Fast Reasoning | Claude Sonnet 4.6 | 7 | 2 min |

Use via CLI (`--quorum=power`), MCP (`quorum: "power"`), or config (`.forge.json` → `quorum.preset: "power"`).

Degradation: <2 successful dry-runs → falls back to normal execution. Reviewer failure → uses best single response.

### A/B Test Results (Invoice Engine — rate tiers, discounts, tax, banker's rounding)

| Metric | Standard | Quorum (3 models) | Delta |
|--------|----------|-------------------|-------|
| Pass rate | 4/4 | 4/4 | Tie |
| Duration | 12 min | 32 min | +168% |
| Tests generated | 15 | **18** | **+20%** |
| Code structure | Inline | **Extracted helpers** | Better |
| Test robustness | Hardcoded dates | **Relative dates** | Better |
| Edge cases | Standard | **+voided regen, +sequence** | Better |

## Memory Layers

Plan Forge uses three distinct memory systems. Each has a specific role in the 3-session pipeline:

| Layer | What It Is | Scope | Managed By | Best For |
|-------|-----------|-------|------------|---------|
| **Copilot Memory** | Built-in `/memories/` note storage (user / session / repo scopes) | User / Session / Repo | Copilot Chat natively | Free-form notes, personal patterns, ad-hoc insights |
| **Plan Forge Session Bridge** | Structured `/memories/repo/current-phase.md` + `lessons-learned.md` | Repository | You (via pipeline prompts) | Carrying Session 1 → 2 → 3 state through the hardening pipeline |
| **OpenBrain** | Semantic vector memory via MCP `search_thoughts` / `capture_thought` | Global (workspace-agnostic) | OpenBrain MCP server | Auto-injecting relevant prior decisions before each slice begins |

All three are complementary. A typical phase uses all three: Copilot Memory for quick notes, the session bridge files for structured handoffs, and OpenBrain for surfacing past decisions automatically without manual prompting.

See [COPILOT-VSCODE-GUIDE.md#memory-layers](COPILOT-VSCODE-GUIDE.md#memory-layers) for the full usage guide.

## OpenBrain Memory (Optional)

When configured (`.vscode/mcp.json` includes `openbrain`), the orchestrator injects prior decisions and conventions as context before each slice begins — bridging the 3-session model with long-term semantic memory.

| Hook | When | What |
|------|------|------|
| Before slice | Worker prompt injection | `search_thoughts` — prior conventions injected as context |
| After slice | Worker prompt injection | `capture_thought` — decisions recorded for future slices |
| After run | Summary field | `_memoryCapture` with run summary + cost anomaly |

Key OpenBrain tools: `search_thoughts`, `capture_thought`, `capture_thoughts`, `thought_stats`

## Presets

| Preset | Instructions | Agents | Prompts | Skills |
|--------|-------------|--------|---------|--------|
| dotnet | 17 | 19 | 15 | 9 |
| typescript | 18 | 19 | 15 | 9 |
| python | 17 | 19 | 15 | 9 |
| java | 17 | 19 | 15 | 9 |
| go | 17 | 19 | 15 | 9 |
| php | 17 | 19 | 15 | 9 |
| rust | 17 | 19 | 15 | 9 |
| swift | 16 | 19 | 13 | 9 |
| azure-iac | 12 | 18 | 6 | 3 |
| custom | 3 | 5 | 7 | 0 |

## External Integration (OpenClaw / CI / Webhooks)

External agents and CI systems can control Plan Forge over HTTP. Discover the full surface on first connect:

```bash
# Programmatic discovery
curl http://localhost:3100/api/capabilities
curl http://localhost:3100/.well-known/plan-forge.json

# Start a plan run (fire-and-forget)
curl -X POST http://localhost:3100/api/runs/trigger \
  -H "Authorization: Bearer <approvalSecret>" \
  -H "Content-Type: application/json" \
  -d '{ "plan": "docs/plans/my-feature.md" }'

# Abort the active run
curl -X POST http://localhost:3100/api/runs/abort \
  -H "Authorization: Bearer <approvalSecret>"

# Search project memory (OpenBrain)
curl -X POST http://localhost:3100/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{ "query": "authentication patterns", "topK": 5 }'

# Capture a memory thought
curl -X POST http://localhost:3100/api/memory/capture \
  -H "Authorization: Bearer <approvalSecret>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Decided to use OIDC", "tags": ["auth","decision"] }'
```

Required `.forge.json` config:
```json
{
  "bridge": {
    "approvalSecret": "your-secret-here",
    "enabled": true,
    "channels": [
      { "type": "telegram", "botToken": "...", "chatId": "...", "approvalRequired": true }
    ]
  }
}
```

Full reference: `AGENT-SETUP.md` Section 6.

## Bridge (External Notifications)

The Plan Forge Bridge connects the WebSocket hub to external platforms, dispatching run events as notifications. Configured in `.forge.json` under the `bridge` key.

**Supported channels**: Telegram, Slack, Discord, generic webhooks

**Notification levels** (hierarchical — each level includes the ones below):

| Level | Events |
|-------|--------|
| `all` | run-started, slice-started, slice-completed, slice-failed, run-completed, run-aborted |
| `important` | run-started, slice-failed, run-completed, run-aborted |
| `critical` | slice-failed, run-aborted (+ run-completed with failures) |

**Config (`.forge.json`)**:
```json
{
  "bridge": {
    "enabled": true,
    "channels": [
      { "type": "telegram", "url": "https://api.telegram.org/bot<TOKEN>/sendMessage", "chatId": "<CHAT_ID>", "level": "important" },
      { "type": "slack",    "url": "https://hooks.slack.com/services/...", "level": "all" },
      { "type": "discord",  "url": "https://discord.com/api/webhooks/...", "level": "critical" },
      { "type": "webhook",  "url": "https://your-endpoint.example.com/hook", "level": "all" }
    ]
  }
}
```

Rate limit: 1 notification per 5 seconds per channel (anti-spam). Bridge reconnects automatically after disconnect.

Start the bridge: `node pforge-mcp/bridge.mjs` (or via dashboard standalone mode).

## CI/CD Hook Event

The `ci-triggered` event is emitted when a CI workflow is dispatched from a plan run, enabling external integrations to react when CI is started.

| Field | Description |
|-------|-------------|
| `workflow` | Workflow file name or ID |
| `ref` | Git ref (branch name or SHA) |
| `inputs` | Workflow dispatch input parameters |

The event is observable via the WebSocket hub (`GET /api/hub`) or captured in the run's `events.log` file. The `slice-escalated` event is emitted separately when a slice is re-routed to a new model via the escalation chain.

## Auto-Update

`pforge smith` automatically checks for a newer Plan Forge release:

- Fetches `VERSION` from the GitHub source tree with a 5 s timeout
- Result cached in `.forge/version-check.json` for 24 hours
- Warns: `⚠ New version available: vX.Y.Z → run pforge update`
- Silent when offline (network errors are suppressed)

### Upgrading (preferred paths)

Run `pforge self-update` to pull the latest tagged release from GitHub — this is the recommended path for existing installs. Do **not** re-clone the Plan Forge repo just to upgrade; that's the first-time install path.

```
pforge self-update --force        # overwrites framework files with latest GitHub release
pforge update                     # v2.56.0+ auto-mode: newer of sibling vs. GitHub tag
pforge update --from-github       # explicit GitHub release source
```

Both commands preserve `.forge.json`, `copilot-instructions.md`, project principles, and plan files. See `pforge config get update-source` (v2.56.0+) for the update-source preference (`auto` | `github-tags` | `local-sibling`).

---

## LiveGuard — Post-Coding Intelligence (v2.27.0–v2.28.0)

LiveGuard is the operational intelligence layer that activates after the forge pipeline ships code. While the build pipeline (Chapters 1–14) focuses on writing correct, tested, guardrailed code, LiveGuard watches what happens after — catching drift, secrets, environment divergence, incidents, and regressions before they become production failures.

### LiveGuard MCP Tools (v2.27.0 — 9 tools)

| Tool | Guards | Data Store |
|------|--------|------------|
| `forge_drift_report` | Architecture drift vs. plan baseline | `.forge/drift-history.json` |
| `forge_incident_capture` | Incident log, MTTR, on-call tracking | `.forge/incidents/*.json` |
| `forge_dep_watch` | Dependency vulnerability change detection | `.forge/deps-snapshot.json` |
| `forge_regression_guard` | Validation gate pass/fail history | `.forge/regression-gates.json` |
| `forge_runbook` | Operational runbook store and retrieval | `.forge/runbooks/*.md` |
| `forge_hotspot` | High-churn / high-failure file detection | `.forge/hotspot-cache.json` |
| `forge_health_trend` | Long-term health trend + MTTBF scoring | `.forge/health-trend.json` |
| `forge_alert_triage` | Cross-signal ranked alert list | `.forge/alert-triage-cache.json` |
| `forge_deploy_journal` | Deploy log with pre/post health delta | `.forge/deploy-journal.jsonl` |

### LiveGuard MCP Tools (v2.28.0 — 2 additional tools)

| Tool | Guards | Security Notes |
|------|--------|----------------|
| `forge_secret_scan` | High-entropy string detection in `git diff` staged changes | Never logs values — redacts to `<REDACTED>` in all output |
| `forge_env_diff` | Environment variable key divergence across `.env*` files | Keys-only parse — never reads values; excludes `.env.local` |

### LiveGuard MCP Tools (v2.29.0 — 2 additional tools)

| Tool | Guards | Data Store |
|------|--------|------------|
| `forge_fix_proposal` | Generates 1–2 slice fix plans from regression, drift, incident, or secret-scan failures | `docs/plans/auto/LIVEGUARD-FIX-<id>.md`, `.forge/fix-proposals.json` |
| `forge_quorum_analyze` | Assembles a structured 3-section quorum prompt (Context, Question, Voting Instruction) from any LiveGuard data source for multi-model dispatch | (no persistence — returns prompt text) |

### LiveGuard MCP Tools (v2.30.0 — 1 additional tool)

| Tool | Guards | Data Store |
|------|--------|------------|
| `forge_liveguard_run` | Composite run — executes drift + sweep + secret-scan + regression-guard + dep-watch + alert-triage + health-trend in a single call; returns unified `overallStatus` (green / yellow / red) | Writes to each underlying tool's cache |

### Watcher MCP Tools (v2.34.0 / v2.35.0 — 2 tools)

| Tool | Guards | Data Store |
|------|--------|------------|
| `forge_watch` | Read-only snapshot watcher — tails another project's pforge run, detects anomalies (10 codes), maps them to concrete next-step recommendations, writes to the **watcher's** `.forge/watch-history.jsonl` | `<watcher>/.forge/watch-history.jsonl` |
| `forge_watch_live` | Live tail — streams events from a target project for a fixed duration via the target's WebSocket hub (`.forge/server-ports.json`) when running, `events.log` polling otherwise | (ephemeral; caps at 500 events/call) |

### LiveGuard REST Endpoints (v2.27.0 — 14 new endpoints)

| Method | Path | Tool |
|--------|------|------|
| GET | `/api/drift/history` | `forge_drift_report` |
| POST | `/api/drift/check` | `forge_drift_report` |
| GET | `/api/incidents` | `forge_incident_capture` |
| POST | `/api/incidents` | `forge_incident_capture` |
| GET | `/api/deps/snapshot` | `forge_dep_watch` |
| GET | `/api/regression/gates` | `forge_regression_guard` |
| POST | `/api/regression/gates` | `forge_regression_guard` |
| GET | `/api/runbooks` | `forge_runbook` |
| GET | `/api/hotspots` | `forge_hotspot` |
| GET | `/api/health-trend` | `forge_health_trend` |
| GET | `/api/alerts/triage` | `forge_alert_triage` |
| GET | `/api/deploy/journal` | `forge_deploy_journal` |
| POST | `/api/deploy/journal` | `forge_deploy_journal` |
| GET | `/api/liveguard/events` | unified event log |

### LiveGuard REST Endpoints (v2.28.0 — 4 additional endpoints)

| Method | Path | Tool |
|--------|------|------|
| GET | `/api/secrets/scan` | `forge_secret_scan` |
| POST | `/api/secrets/scan` | `forge_secret_scan` |
| GET | `/api/env/diff` | `forge_env_diff` |
| POST | `/api/env/diff` | `forge_env_diff` |

### LiveGuard Dashboard (v2.28.0)

The existing unified dashboard at `localhost:3100/dashboard` gains a **LIVEGUARD section** (5 amber-accented tabs) separated by a visual divider from the existing FORGE section (10 blue-accented tabs, including the v2.35 **Watcher** tab). Single WebSocket, single Chart.js, no new server process.

**Dashboard sections after v2.35.0 (25 tabs total)**:

| Section | Tabs | Active Color |
|---------|---------|--------------|
| FORGE | Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces, Skills, **Watcher** | Blue (`#3b82f6`) |
| LIVEGUARD | Health, Incidents, Triage, Security, Env | Amber (`#f59e0b`) |

Each LiveGuard tab includes a `Docs ↗` link to the corresponding manual chapter.

### LiveGuard Telemetry

Every LiveGuard tool call writes to `.forge/liveguard-events.jsonl` and broadcasts a `liveguard-tool-completed` hub event. Structure mirrors the existing plan-run telemetry (OTLP-compatible, Severity constants from `telemetry.mjs`).

**Manual documentation**: See [Plan Forge Manual — Act IV](manual/what-is-liveguard.html) (Chapters 15–17 + Appendix F).

---

## Dual-Publish Extensions

`pforge ext publish <path>` validates the extension and outputs two catalog entries simultaneously:

- **Plan Forge catalog entry** — `catalog.json` format, installable with `pforge ext install`
- **Spec Kit-compatible entry** — `extensions.json` format for the Spec Kit extension registry

Extensions marked `speckit_compatible: true` in their `extension.json` work in both tools. See `extensions/PUBLISHING.md` for the full dual-publish workflow.

## File Outputs

Directories and files written by Plan Forge at runtime. All paths are relative to the project root.

| Path | Written By | Gitignored | Purpose |
|------|-----------|------------|---------|
| `.forge/` | All tools | Yes (`**/.forge/`) | Runtime data — runs, cost, drift, incidents, caches |
| `.forge/runs/<timestamp>/` | `forge_run_plan` | Yes | Per-run telemetry, traces, slice results |
| `.forge/cost-history.json` | `forge_cost_report` | Yes | Aggregate cost across runs |
| `.forge/drift-history.json` | `forge_drift_report` | Yes | Architecture drift score history |
| `.forge/incidents/` | `forge_incident_capture` | Yes | Incident logs with MTTR tracking |
| `.forge/runbooks/` | `forge_runbook` | Yes | Generated operational runbooks |
| `.forge/liveguard-events.jsonl` | LiveGuard tools | Yes | LiveGuard telemetry event log |
| `.forge/deploy-journal.jsonl` | `forge_deploy_journal` | Yes | Deploy history with health deltas |
| `.forge/fix-proposals.json` | `forge_fix_proposal` | Yes | Auto-generated fix plan proposals |
| `.forge/secret-scan-cache.json` | `forge_secret_scan` | Yes | Redacted secret scan results |
| `docs/plans/auto/` | `forge_fix_proposal` | Yes (`docs/plans/auto/*`) | Auto-generated fix plans (runtime artifacts) |
| `docs/plans/auto/README.md` | Committed | No (gitignore exception) | Explains the directory's purpose |

## Configuration (`.forge.json`)

```json
{
  "preset": "dotnet",
  "projectName": "MyApp",
  "modelRouting": {
    "default": "claude-opus-4.6",
    "execute": "gpt-5.2-codex",
    "review": "claude-sonnet-4.6"
  },
  "maxParallelism": 3,
  "maxRetries": 1,
  "maxRunHistory": 50,
  "quorum": {
    "enabled": false,
    "auto": true,
    "threshold": 7,
    "models": ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    "reviewerModel": "claude-opus-4.6",
    "preset": null
  }
}
```

## Lifecycle Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| SessionStart | Agent session begins | Inject Project Principles + forbidden patterns |
| PreToolUse | Before file edit | Block edits to Forbidden Actions paths |
| PostToolUse | After file edit | Auto-format + warn on TODO/FIXME markers |
| Stop | Session ends | Warn if code changed but no tests run |

---

*Generated from the Plan Forge capability surface. For the live version, call `forge_capabilities` or visit `https://planforge.software/.well-known/plan-forge.json`.*
