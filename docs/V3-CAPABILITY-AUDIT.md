# Plan Forge v3.x — Capability ↔ Documentation Audit

> **Generated**: 2026-05-17 against `master` @ commit `14e38f1`  
> **System version**: `v3.5.1`  
> **Purpose**: Authoritative inventory of every capability surface (MCP, CLI, REST, SDK, Dashboard, Hooks, Skills, Agents, Prompts, Instructions, Presets, Extensions, Manual) cross-referenced with every documentation surface, so we can see exactly what is named where — and what isn't.
>
> **Method**: All counts come from parsing the source of truth (`pforge-mcp/tools.json`, `pforge.ps1` switch, `pforge-mcp/server.mjs` route handlers, `pforge-sdk/package.json` exports, `docs/manual/assets/manual.js` CHAPTERS, etc.). No hand-counts.

---

## 1. The System (authoritative counts)

| Surface | Count | Source of Truth |
|---|---:|---|
| **MCP tools** | **88** | `pforge-mcp/tools.json` (auto-generated each boot from `capabilities.mjs`) |
| **CLI commands** (top-level) | **57** | `pforge.ps1` line 7071 switch + subcommand handlers |
| **REST endpoints** | **~103** | `pforge-mcp/server.mjs` `app.{get,post,put,delete}` handlers |
| **SDK sub-path exports** | **4** | `pforge-sdk/package.json#exports` |
| **Dashboard groups / tabs** | **4 / ~36** | `pforge-mcp/dashboard/index.html` `data-tab` and `data-group` |
| **Lifecycle hooks** | **8** | `templates/.github/hooks/` + `.github/hooks/` |
| **Skill IDs** (unique across presets) | **18** | `presets/**/skills/*/SKILL.md` |
| **Pipeline agents** | **6** | `templates/.github/agents/*.agent.md` (5) + `.github/agents/` (1) |
| **Pipeline prompts** | **8** | `.github/prompts/step*.prompt.md` + `project-profile`, `project-principles` |
| **Auto-load instruction files** | **8** | `.github/instructions/*.instructions.md` |
| **Stack presets** | **9** | `presets/{azure-iac,dotnet,go,java,php,python,rust,swift,typescript}` (+ `shared`) |
| **Extensions** (catalog entries) | **7** | `extensions/catalog.json#extensions` |
| **Manual entries** (chapters + appendices + front matter) | **61** | `docs/manual/assets/manual.js#CHAPTERS` |

### 1.1 MCP tools — grouped breakdown (88 total)

| Group | Count | Tools |
|---|---:|---|
| Core orchestration & discovery | 35 | `forge_capabilities`, `forge_run_plan`, `forge_abort`, `forge_plan_status`, `forge_cost_report`, `forge_estimate_quorum`, `forge_estimate_slice`, `forge_smith`, `forge_validate`, `forge_sweep`, `forge_status`, `forge_diff`, `forge_analyze`, `forge_diagnose`, `forge_ext_search`, `forge_ext_info`, `forge_new_phase`, `forge_skill_status`, `forge_run_skill`, `forge_generate_image`, `forge_home_snapshot`, `forge_delegate_to_agent`, `forge_search`, `forge_timeline`, `forge_export_plan`, `forge_meta_bug_file`, `forge_graph_query`, `forge_patterns_list`, `forge_org_rules`, `forge_classifier_issue`, `forge_github_status`, `forge_github_metrics`, `forge_delegate_review`, `forge_team_dashboard`, `forge_team_activity` |
| LiveGuard | 14 | `forge_drift_report`, `forge_incident_capture`, `forge_regression_guard`, `forge_runbook`, `forge_hotspot`, `forge_health_trend`, `forge_alert_triage`, `forge_deploy_journal`, `forge_dep_watch`, `forge_secret_scan`, `forge_env_diff`, `forge_fix_proposal`, `forge_quorum_analyze`, `forge_liveguard_run` |
| Watcher | 2 | `forge_watch`, `forge_watch_live` |
| Crucible | 8 | `forge_crucible_submit/ask/preview/finalize/list/abandon/import/status` |
| Tempering | 6 | `forge_tempering_scan/status/run/approve_baseline/drain`, `forge_triage_route` |
| Bug Registry | 4 | `forge_bug_register/list/update_status/validate_fix` |
| Testbed | 3 | `forge_testbed_run/findings/happypath` |
| Review | 3 | `forge_review_add/list/resolve` |
| Notify | 2 | `forge_notify_send/test` |
| **Lattice (v2.95+)** | 5 | `forge_lattice_index/stat/query/callers/blast` |
| Memory | 2 | `forge_memory_report`, `forge_memory_capture` |
| **Sync (v2.99+)** | 2 | `forge_sync_memories`, `forge_sync_instructions` |
| Forge-Master (v2.63+) | 1 | `forge_master_ask` |
| Doctor | 1 | `forge_doctor_quorum` |

### 1.2 CLI-only families (NOT MCP-exposed)

These are intentionally CLI-only because they are local-file utilities that don't benefit from MCP overhead. Capability metadata still lives in `pforge-mcp/capabilities.mjs` for agent discoverability.

| Family | Commands | Module |
|---|---|---|
| **Hallmark (v2.95+)** | `pforge hallmark show`, `pforge hallmark verify` | `pforge-sdk/hallmark` |
| **Anvil (v2.95+)** | `pforge anvil stat`, `pforge anvil clear`, `pforge anvil rebuild`, `pforge anvil dlq list\|drain` | `pforge-mcp/anvil.mjs` |

### 1.3 CLI top-level commands (57)

```
analyze, anvil, audit, audit-loop, branch, check, commit, config, crucible,
dep-watch, deploy-log, diff, digest, drain-memory, drift, env-diff, ext,
fix-proposal, fm-recall, fm-session, forge-master, github, graph, hallmark,
hammer-fm, health-trend, help, hotspot, incident, init, lattice, mcp-call,
migrate-memory, new-phase, org-rules, patterns, phase-status, plan-from-sarif,
quorum-analyze, regression-guard, run-plan, runbook, secret-scan, self-update,
skills, smith, status, sweep, sync-instructions, sync-memories, sync-spaces,
team, testbed-happypath, timeline, tour, triage, update, version-bump
```

### 1.4 REST endpoints — grouped (~103)

| Prefix | Endpoints | Notes |
|---|---:|---|
| `/api/runs/*` | 5 | trigger, abort, latest, by-idx, list |
| `/api/memory/*` | 5 | report, search, capture, drain, presets |
| `/api/bridge/*` | 3 | status, approve POST, approve GET (browser link) |
| `/api/crucible/*` | 9 | submit, ask, list, preview, finalize, abandon, config GET/POST, manual-imports, governance |
| `/api/innerloop/*` | 7 | status, reviewer-calibration, gate-suggestions, cost-anomalies, proposed-fixes, federation GET, federation/toggle POST |
| `/api/tempering/*` | 2 | artifact, bug-stub |
| `/api/skills/*` | 5 | list, pending, accept, reject, defer |
| `/api/copilot-instructions/*` | 3 | GET, preview, sync |
| `/api/openclaw/*` | 2 | snapshot, config |
| `/api/notifications/*` | 2 | config GET/POST |
| `/api/audit/*` | 3 | config GET/PUT, drain |
| `/api/secret-scan`, `/api/deps/*`, `/api/env/*` | 4 | LiveGuard scanners |
| `/api/drift/*`, `/api/incidents`, `/api/incident`, `/api/deploy-journal` | 6 | LiveGuard reads + writes |
| `/api/fix/*`, `/api/quorum/*` | 4 | Fix proposals + quorum prompts |
| `/api/tool/:name` (generic dispatch) | 1 | Generic MCP-over-REST |
| `/.well-known/plan-forge.json`, `/api/capabilities` | 2 | Discovery |
| `/api/dashboard-state`, `/api/config`, `/api/secrets`, `/api/version`, `/api/update-status` | 9 | Settings |
| Other (cost, traces, hub, status, replay, plans, workers, extensions, image/generate, etc.) | ~31 | |

### 1.5 SDK exports (`pforge-sdk@0.2.0`)

| Sub-path | Module | What it provides |
|---|---|---|
| `pforge-sdk` | `src/index.mjs` | Main entry — re-exports tools + client |
| `pforge-sdk/tools` | `src/tools.mjs` | Tool wrappers for programmatic invocation |
| `pforge-sdk/client` | `src/client.mjs` | HTTP client for MCP server REST API |
| `pforge-sdk/hallmark` | `src/hallmark.mjs` | `buildProvenance`, `validateProvenance`, `mergeProvenance` + `hallmark/v1` schema |

> **Gap**: Lattice and Anvil are NOT yet exposed as SDK sub-paths despite having stable modules in `pforge-mcp/`. Candidates for `pforge-sdk@0.3.0`.

### 1.6 Dashboard tabs (4 groups, ~36 tabs)

| Group | Tabs |
|---|---|
| **forge** | home, review, progress, crucible, governance, runs, cost, actions, replay, traces, skills, tempering, memory, timeline, innerloop, github-metrics, team-dashboard, anvil-lattice |
| **liveguard** | lg-health, lg-incidents, lg-triage, lg-security, lg-env, watcher, bugregistry |
| **forge-master** | Studio (chat + tool-call trace + prompt gallery) |
| **settings** | settings-general, settings-models, settings-execution, settings-api-keys, settings-updates, settings-memory, settings-bridge, settings-crucible, settings-brain, extensions, settings-copilot |

### 1.7 Lifecycle hooks (8)

```
SessionStart, PreToolUse, PostToolUse, Stop,
PreDeploy, PostSlice, PreAgentHandoff, PreCommit
```

### 1.8 Skills (18 unique IDs across presets)

```
api-doc-gen, audit-loop, azure-sweep, code-review, database-migration,
dependency-audit, forge-execute, forge-quench, forge-troubleshoot,
health-check, infra-deploy, infra-test, onboarding, release-notes,
security-audit, staging-deploy, test-sweep, ui-scaffold
```

### 1.9 Pipeline agents, prompts, instructions

- **Agents (6)**: `executor`, `plan-hardener`, `reviewer-gate`, `shipper`, `specifier`, `audit-classifier-reviewer`
- **Prompts (8)**: `project-profile`, `project-principles`, `step0-specify-feature`, `step1-preflight-check`, `step2-harden-plan`, `step3-execute-slice`, `step4-completeness-sweep`, `step5-review-gate`, `step6-ship`
- **Instructions (8)**: `ai-plan-hardening-runbook`, `architecture-principles`, `context-fuel`, `git-workflow`, `plan-gate-command-rules`, `release-checklist`, `self-repair-reporting`, `status-reporting`

### 1.10 Presets (9) + Extensions (7)

- **Presets**: `azure-iac`, `dotnet`, `go`, `java`, `php`, `python`, `rust`, `swift`, `typescript` (+ `shared` shared assets)
- **Extensions (catalog)**: `saas-multi-tenancy`, `azure-infrastructure`, `plan-forge-memory`, `notify-slack`, `notify-teams`, `notify-email`, `notify-pagerduty`

### 1.11 Manual chapters (61 entries across the book)

| Section | Entries |
|---|---:|
| Front matter (Manual Home, Conventions) | 2 |
| Quickstart (Q1–Q3) | 3 |
| **Act I — Foundations** (Ch 1–5 + Spec Kit) | 6 |
| **Act II — Workshop in Use** (Ch 6–10 + dashboard/forge-master/CLI sub-chapters) | 21 |
| **Act III — Production Hardening** (5 chapters) | 5 |
| **Act IV — Operations & Memory** (Ch 22–25 + memory-system) | 5 |
| **Appendices** (A–F + reference indexes) | 19 |
| **Total** | **61** |

---

## 2. The Documentation (where the system gets named)

| Surface | File | Role |
|---|---|---|
| **README** | [README.md](../README.md) | First-touch overview |
| **AI-discovery** | [llms.txt](../llms.txt), [docs/llms.txt](llms.txt) | LLM-friendly summary |
| **Capabilities reference** | [docs/capabilities.md](capabilities.md), [docs/capabilities.html](capabilities.html) | Tool-by-tool catalog |
| **CLI reference** | [docs/CLI-GUIDE.md](CLI-GUIDE.md) | Every command, every flag |
| **Copilot guide** | [docs/COPILOT-VSCODE-GUIDE.md](COPILOT-VSCODE-GUIDE.md) | VS Code + Copilot integration |
| **Extensions** | [docs/EXTENSIONS.md](EXTENSIONS.md), [docs/extensions.html](extensions.html) | Catalog + publishing |
| **Quickstart** | [docs/QUICKSTART-WALKTHROUGH.md](QUICKSTART-WALKTHROUGH.md) | First-run walkthrough |
| **Memory deep-dive (docs/)** | [docs/MEMORY-ARCHITECTURE.md](MEMORY-ARCHITECTURE.md) | Architecture doc (root-level) |
| **System architecture** | [docs/UNIFIED-SYSTEM-ARCHITECTURE.md](UNIFIED-SYSTEM-ARCHITECTURE.md) | Cross-system diagram |
| **Skill blueprint** | [docs/SKILL-BLUEPRINT.md](SKILL-BLUEPRINT.md) | How to write a skill |
| **Agent setup** | [AGENT-SETUP.md](../AGENT-SETUP.md) | What agents get |
| **Customization** | [CUSTOMIZATION.md](../CUSTOMIZATION.md) | How to extend |
| **Roadmap** | [ROADMAP.md](../ROADMAP.md) | What's next |
| **Changelog** | [CHANGELOG.md](../CHANGELOG.md) | Version history |
| **Landing pages (HTML)** | [docs/index.html](index.html), [docs/docs.html](docs.html), [docs/faq.html](faq.html), [docs/dashboard.html](dashboard.html), [docs/shop-tour.html](shop-tour.html), [docs/problem.html](problem.html), [docs/examples.html](examples.html), [docs/speckit-interop.html](speckit-interop.html) | Public site |
| **Manual** | [docs/manual/](manual/) (61 entries) | Long-form book |

---

## 3. The Matrix — Capability × Documentation Coverage

> Legend: ✅ named + accurately described · ⚠️ named but stale/incomplete · ❌ not mentioned · — N/A for this surface

### 3.1 v3.x memory upgrades

| Capability | README | llms.txt | capabilities.md | capabilities.html | CLI-GUIDE | Manual | AGENT-SETUP | Landing pages |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Hallmark** (`hallmark/v1` envelope) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Ch 25) | ❌ | ⚠️ alt-text only |
| **Anvil** (DLQ + capability handshake, `pforge anvil`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Ch 25) | ❌ | ⚠️ alt-text only |
| **Lattice** (code-graph, 5 MCP tools) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Ch 25) | ❌ | ❌ |
| **`forge_sync_memories`** (Copilot Memory bridge) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ (Ch 25) | ❌ | ❌ |
| **`forge_sync_instructions`** (Copilot instructions sync) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ implied | ❌ | ❌ |
| **L1/L2/L3 architecture** | ⚠️ | ⚠️ | ❌ | ⚠️ | ❌ | ✅ (Ch 24+25) | ❌ | ❌ |
| **Memory dashboard tab** | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ✅ | ❌ | ⚠️ |
| **Anvil & Lattice dashboard tab** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ |

### 3.2 v3.x operations / Forge-Master

| Capability | README | llms.txt | capabilities.md | capabilities.html | Manual | Landing pages |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **`forge_master_ask`** (read-only orchestrator) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| **Forge-Master Studio** (dashboard tab) | ⚠️ | ❌ | ✅ | ✅ | ✅ | ⚠️ |
| **Multi-agent quorum (--quorum=power/speed/auto)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`forge_estimate_quorum`** | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| **`forge_doctor_quorum`** | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| **Inner Loop** (10 opt-in subsystems v2.57/2.58) | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Watcher v2 (forge_watch, forge_watch_live)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Crucible 8 tools (incl. `_import`, `_status`)** | ✅ | ✅ | ⚠️ (lists 6) | ⚠️ (lists 6) | ✅ | ✅ |
| **Tempering drain + classifier-reviewer** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Bug Registry (`forge_bug_*`, `forge_meta_bug_file`)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Self-deterministic loop (L1–L8 + C1–C3)** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **PreDeploy / PostSlice / PreAgentHandoff hooks** | ✅ | ❌ | ⚠️ | ❌ | ⚠️ | ❌ |

### 3.3 v3.x team & github features

| Capability | README | llms.txt | capabilities.md | capabilities.html | Manual | Landing pages |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **`forge_team_dashboard`** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **`forge_team_activity`** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **`forge_github_metrics`** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **`forge_github_status`** | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| **`forge_delegate_review`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`forge_classifier_issue`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`forge_export_plan`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Team dashboard tab** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| **GH Metrics dashboard tab** | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |

### 3.4 v3.x graph / pattern / digest CLI

| Capability | CLI-GUIDE | capabilities.md | capabilities.html | Manual |
|---|:-:|:-:|:-:|:-:|
| **`forge_graph_query`** (knowledge graph) | ⚠️ | ❌ | ❌ | ❌ |
| **`forge_patterns_list`** | ⚠️ | ❌ | ❌ | ❌ |
| **`pforge digest`** | ⚠️ | — | — | ❌ |
| **`pforge plan-from-sarif`** | ⚠️ | — | — | ❌ |
| **`pforge sync-spaces`** (Copilot Spaces) | ⚠️ | ❌ | ❌ | ❌ |
| **`pforge hammer-fm`** | ⚠️ | — | — | ❌ |
| **`pforge fm-session`, `pforge fm-recall`** | ⚠️ | — | — | ❌ |

### 3.5 REST API & SDK

| Capability | README | llms.txt | capabilities.md | capabilities.html | Manual |
|---|:-:|:-:|:-:|:-:|:-:|
| **REST API** (101 endpoints) | ✅ (8 listed) | ✅ (22 listed) | ❌ | ❌ | ⚠️ (partial) |
| **`/api/innerloop/*`** (7 endpoints) | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| **`/api/copilot-instructions/*`** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`/api/openclaw/*`** | ❌ | ❌ | ❌ | ❌ | ⚠️ |
| **WebSocket hub (`/api/hub`)** | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| **`pforge-sdk` (0.2.0)** | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| **`pforge-sdk/hallmark` sub-path** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **`pforge-sdk/tools`, `pforge-sdk/client`** | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 4. Concrete defects to fix

### 4.1 Stale tool counts (immediate fix)

| File | Line(s) | Says | Should say |
|---|---|---|---|
| [AGENT-SETUP.md](../AGENT-SETUP.md) | 7 | `67 MCP tools` | `88 MCP tools` |
| [docs/COPILOT-VSCODE-GUIDE.md](COPILOT-VSCODE-GUIDE.md) | 797 | `all 67 MCP tools` | `all 88 MCP tools` |
| [docs/faq.html](faq.html) | 865 | `All 67 MCP tools` | `All 88 MCP tools` |
| [docs/index.html](index.html) | 19 | `69 MCP tools` (twitter:description) | `88 MCP tools` |
| [docs/index.html](index.html) | 1073 | `69 MCP tools wired via .vscode/mcp.json` | `88 MCP tools wired via .vscode/mcp.json` |
| [docs/index.html](index.html) | 1111 | `69 MCP tools (core + LiveGuard …)` | `88 MCP tools (core + LiveGuard + Watcher + Crucible + Tempering + Bug Registry + Testbed + Forge-Master + Lattice + Sync)` |
| [docs/index.html](index.html) | 1113 | `69 tools (Core · LiveGuard …)` | `88 tools (Core · LiveGuard · Watcher · Crucible · Tempering · Bug Registry · Testbed · Forge-Master · Lattice · Sync)` |
| [docs/index.html](index.html) | 1942 | `17 instruction files, 14 agents, 15 skills, …, 69 MCP tools` | `18 skills, 88 MCP tools` (verify agent/instruction counts before fix) |

### 4.2 Capability ↔ doc gaps (medium priority)

| Gap | Recommended fix |
|---|---|
| **`forge_sync_memories` not in README** | Add to Learn-station row + key-tools list |
| **`forge_team_*` and `forge_github_metrics` undocumented** | Add a "Team Coordination" section to `capabilities.md` and a card on `capabilities.html` |
| **`forge_graph_query` and `forge_patterns_list` undocumented** | Add a "Knowledge Graph" section to `capabilities.md` |
| **REST endpoints missing from `capabilities.md`** | Add a "REST API" section (currently only in `README.md` and `llms.txt`) |
| **SDK barely documented** | `pforge-sdk/README.md` covers Hallmark only — add `tools` and `client` sub-path docs; bump to `0.3.0` and add Lattice/Anvil exports |
| **Inner Loop dashboard tab undocumented** | Add to dashboard manual chapter |
| **Anvil & Lattice dashboard tab undocumented** | Add a screenshot + walkthrough to the dashboard chapter |
| **Settings tabs (11) not catalogued** | Add a "Settings reference" appendix to the manual |
| **`forge_estimate_quorum` underused in docs** | Already enforced in `.github/copilot-instructions.md`; add a how-to in `capabilities.md` |
| **Hallmark/Anvil/Lattice missing from `MEMORY-ARCHITECTURE.md`** (root-level doc) | Either redirect to Ch 25 or backfill |

### 4.3 Structural gaps (lower priority)

- `pforge-sdk@0.2.0` only exports 4 sub-paths despite Lattice + Anvil + Tempering having stable modules. Candidate for `pforge-sdk@0.3.0`.
- `extensions/catalog.json` has not added any `code` category extensions since April 2026 even though Lattice + Hallmark could ship as standalone extensions.
- 19 manual appendices but no "API surface index" — readers have no single place to see every MCP tool + CLI command + REST endpoint + SDK export.

---

## 5. Recommended documentation passes

In dependency order:

1. **Mechanical sweep** — fix the 8 stale tool counts in §4.1 (single commit, no narrative changes).
2. **Capability table refresh** — bring `capabilities.md` and `capabilities.html` to 100% coverage (every MCP tool listed) by adding the 6 currently-missing tools: `forge_team_dashboard`, `forge_team_activity`, `forge_github_metrics`, `forge_delegate_review`, `forge_classifier_issue`, `forge_export_plan`, `forge_graph_query`, `forge_patterns_list`.
3. **REST surface chapter** — add a `docs/REST-API.md` (or expand the `README.md` section) covering all ~103 endpoints organized by prefix.
4. **SDK refresh** — `pforge-sdk@0.3.0` with Lattice + Anvil sub-paths; update `pforge-sdk/README.md`.
5. **Manual completeness** — add a "Settings Reference" appendix, an "Inner Loop deep-dive" chapter (currently only the loop is documented), and a "Dashboard Tab Atlas" that names every tab and what backs it.
6. **Landing-page refresh** — once §1–5 are done, refresh `docs/index.html`, `docs/docs.html`, and `docs/faq.html` to match the v3.5.1 reality.

---

## 6. Surface-area summary card

```
Plan Forge v3.5.1 — at a glance

  88   MCP tools      (35 core / 14 LiveGuard / 8 Crucible / 6 Tempering /
                       5 Lattice / 4 Bug Registry / 3 Review / 3 Testbed /
                       2 Watcher / 2 Memory / 2 Sync / 2 Notify /
                       1 Forge-Master / 1 Doctor)
 ~103  REST endpoints (organized into 15+ prefixes)
  57   CLI commands   (top-level; many with rich subcommand trees)
  36   Dashboard tabs (across 4 groups: forge, liveguard, forge-master, settings)
   4   SDK sub-paths  (.  /tools  /client  /hallmark)
   8   Lifecycle hooks
  18   Skills         (across 9 stack presets + shared)
   8   Pipeline prompts + 8 instructions + 6 agents
   9   Stack presets  + 7 catalog extensions
  61   Manual entries (Front + Quickstart + 4 Acts + 19 Appendices)

Memory architecture (v3.x):
  L1 Hub  ←→  L2 .forge/*.jsonl (Hallmark-stamped)  ←→  L3 OpenBrain (via Anvil)
                        ↑ parallel axis: Lattice (code-graph)
                        ↑ upward sync: forge_sync_memories → Copilot Memory
```

---

**Maintainer note**: This audit is a snapshot. Re-run the inventory commands in §1 against a future commit before publishing v3.6.x release notes — the system grows by 1–2 capabilities per slice.
