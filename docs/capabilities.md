# Plan Forge — Capabilities Reference

> **Tools**: 91 MCP (35 core + 14 LiveGuard + 2 Watcher + 8 Crucible + 6 Tempering + 4 Bug Registry + 3 Testbed + 3 Review + 2 Notify + 5 Lattice + 2 Memory + 2 Sync + 2 Forge-Master + 1 Doctor + 1 Worker Guardrails + 4 Auditor/Observer) | **CLI-only families**: Hallmark (`pforge hallmark show|verify`), Anvil (`pforge anvil stat|clear|rebuild|dlq`) | **CLI**: 48+ commands | **Presets**: 9 | **Agents**: 20 | **Skills**: 14
>
> Machine-readable version: call `forge_capabilities` MCP tool, `GET https://planforge.software/.well-known/plan-forge.json`, or read `pforge-mcp/tools.json` (auto-generated on every MCP server start).

---

## MCP Tools (91)

| Tool | Intent | Cost | Description |
|------|--------|------|-------------|
| `forge_abort` | stop | low | Abort the currently running plan execution. The abort takes effect between slices — the current slice will finish first. |
| `forge_alert_triage` | triage-alerts | low | Triage open alerts — read incidents and drift violations, rank by priority (severity × recency), and return a prioritized list. Read-only: does not modify any data store. Tiebreak: more recent alerts rank higher when priority scores are equal. |
| `forge_analyze` | analyze | low | Cross-artifact analysis — validates requirement traceability, test coverage, scope compliance, and validation gates. Returns a consistency score (0-100) with detailed breakdown. With quorum=true, dispatches to multiple AI models (including API providers like xAI Grok) for multi-model consensus analysis. |
| `forge_brain_replay` | replay | medium | Bulk-load records into OpenBrain via capture_thought from a local source. Source can be (a) a queue jsonl file like .forge/openbrain-queue.archive.jsonl, (b) a single markdown file (split per H2 heading), or (c) a directory of markdown files. Returns counts + small samples; full per-record receipt log is written to .forge/openbrain-replay-<ts>.jsonl. USE FOR: rebuilding L3 memory after a database wipe, importing curated notes, or replaying a queue that never drained. Pass dryRun=true to validate normalization without writing. |
| `forge_brain_test` | test | low | Round-trip test against OpenBrain (L3 memory). Captures a unique marker thought via capture_thought, then immediately searches for it via search_thoughts. Returns { ok, marker, hit, durationMs }. USE FOR: confirming the SSE endpoint is reachable, auth key is valid, and capture+search are wired end-to-end — before running bulk replays or after restoring an OpenBrain database. Requires OpenBrain to be configured as an SSE server in .vscode/mcp.json or .claude/mcp.json and a valid OPENBRAIN_KEY env var (or query-form key in the URL). |
| `forge_bug_list` | tempering | low | List bugs from the registry with optional filters. Returns all bugs matching the given criteria from .forge/bugs/. |
| `forge_bug_register` | tempering | low | Register a bug discovered by a tempering scanner. Classifies real-bug vs infra and writes .forge/bugs/<bugId>.json for real bugs. Infra-classified failures are not written to disk — they are only tracked in the run record. |
| `forge_bug_update_status` | tempering | low | Transition a bug's status (open → in-fix → fixed, or open → wont-fix/duplicate) with transition validation. Terminal states (fixed, wont-fix, duplicate) cannot be changed. Accepts either 'newStatus' or 'status' as the field name (#116). |
| `forge_bug_validate_fix` | validate-fix | medium | Re-run the scanner(s) that discovered a bug to verify the fix. On pass: marks bug as 'fixed', dispatches commentValidatedFix to bug-adapter, broadcasts tempering-bug-validated-fixed event. On fail: appends attempt to bug.validationAttempts[], status unchanged. |
| `forge_capabilities` | discover | low | Machine-readable API surface — returns all MCP tools with semantic metadata (intent, prerequisites, errors, cost), CLI commands, workflow graphs, config schema, dashboard info, and installed extensions. Agents call this once on session start for full discoverability. |
| `forge_classifier_issue` |  | low | File a GitHub issue proposing a classifier rule update when a tempering finding routes to the 'classifier' lane (infra noise). Deduplicates by finding class + reason hash — repeated occurrences comment on the existing issue instead of creating a duplicate. USE FOR: closing the audit loop when routeFinding returns lane='classifier', tracking recurring noise patterns in GitHub. DO NOT USE FOR: product bugs (use forge_bug_register), spec gaps (submit to Crucible), self-repair defects (use forge_meta_bug_file). |
| `forge_cost_report` | read | low | Cost tracking report — shows total spend, per-model breakdown, and monthly aggregation from .forge/cost-history.json. Includes token counts, run history, and forge_model_stats (success rate per model from model-performance.json). |
| `forge_crucible_abandon` | crucible | low | Abandon a smelt — marks it status=abandoned and releases any phase-number claim it held. Idempotent: re-abandoning a smelt is a no-op. USE FOR: discarding a smelt that was started by mistake or superseded by another idea. |
| `forge_crucible_ask` | crucible | low | Advance the Crucible interview — supply an answer and get the next question, or mark the smelt ready for preview/finalize when the interview is complete. Call without `answer` to fetch the current question. USE FOR: the interactive Q&A loop that turns a raw idea into a hardened spec. |
| `forge_crucible_finalize` | crucible | low | Finalize a smelt — atomically claim the next phase number, write docs/plans/Phase-NN.md with a `crucibleId:` frontmatter stamp, and mark the smelt finalized. Refuses to overwrite an existing plan unless `overwrite:true` is passed (Issue #137). Returns the chosen phase name and the plan path. USE FOR: closing the idea→spec workflow when the interview is done. |
| `forge_crucible_import` | crucible | low | Import a Spec Kit project into a Plan Forge Crucible smelt — deterministic, LLM-free field mapping. Returns a smelt id, generated plan path, mapped fields, and any missing-field warnings. USE FOR: importing Spec Kit specs into Plan Forge from Cursor/Claude Code/Codex (no Copilot Chat required), CI pipelines, or any non-Copilot agent. Supports dry-run mode for validation without writing files. |
| `forge_crucible_list` | crucible | low | List Crucible smelts, newest-first, optionally filtered by status. USE FOR: dashboard smelt-list panel, resuming in-progress smelts across sessions, auditing recently finalized smelts. |
| `forge_crucible_preview` | crucible | low | Render the current draft of a smelt as a Markdown plan. Returns the draft, the tentative phase name (null until finalized), and a list of unresolved fields (slots still awaiting an answer). USE FOR: reviewing before finalize, or for the dashboard's live-preview pane. |
| `forge_crucible_status` | crucible | low | List Crucible smelts by source and status, or inspect a single smelt. Omit smeltId to list all smelts under .forge/crucible/ (id, source, status, created). Supply smeltId for full smelt detail. USE FOR: auditing imported smelts, checking import results, browsing the smelt archive. |
| `forge_crucible_submit` | crucible | low | Submit a raw idea to the Crucible — starts a new smelt (idea → spec workflow). Returns a smelt id, a recommended lane (tweak / feature / full), and the first interview question. USE FOR: kicking off Crucible from an AI agent or CLI with a one-line description of a change, bug, or feature. Agent-submitted smelts are subject to the recursion guardrail (default depth=1, set source='agent'). |
| `forge_delegate_review` | review | low | Delegate code review for the current branch's PR to the Copilot Coding Agent. Finds the open PR, creates a GitHub issue assigned to @copilot with structured review criteria, and returns the issue URL. The agent reviews the diff and posts findings. USE FOR: trigger AI code review, delegate PR review to Copilot, agentic review. DO NOT USE FOR: viewing review status (check the created issue), creating PRs (use gh pr create). |
| `forge_delegate_to_agent` | delegate | low | Route a tempering bug to the appropriate agent/skill for read-only analysis. |
| `forge_dep_watch` | dep-scan | low | Scan project dependencies for known vulnerabilities using npm audit. Compares against previous snapshot in .forge/deps-snapshot.json to detect new and resolved CVEs. Fires a bridge notification when new vulnerabilities are found. Non-npm projects degrade gracefully. |
| `forge_deploy_journal` | record-deploy | low | Record a deployment — log version, deployer, optional notes, and optional slice reference. Appends to .forge/deploy-journal.jsonl. Used by forge_incident_capture to correlate incidents with the most recent deploy. |
| `forge_diagnose` | analyze | medium | Multi-model bug investigation — dispatches independent bug analysis to multiple AI models (including API providers like xAI Grok), then synthesizes root cause analysis with fix recommendations. Each model examines code paths, failure modes, edge cases, and race conditions independently. |
| `forge_diff` | compare | low | Compare changed files against a plan's Scope Contract — detect drift, forbidden file edits, and unplanned changes. |
| `forge_diff_classify` | diff-classify | low | Classify staged git diff against 6 safety categories: leaked-secret (critical), prompt-injection-echo (high), license-incompatible-paste (high), eval-exec-introduced (medium), unexpected-network-call (low), large-binary-dump (medium). Returns { severity, findings[], totalAdded, truncated }. Blocking threshold: severity >= high. USE FOR: PreCommit chain gate, post-worker diff review, CI gate. DO NOT USE FOR: static analysis (use a linter), deep code review (use forge_delegate_review). |
| `forge_doctor_quorum` | quorum viability | low | Preflight quorum viability check — probes all models in a preset against the current runtime and reports availability, synthesis viability, and fallback recommendations. |
| `forge_drift_report` | drift-detect | low | Score the codebase against architecture guardrail rules. Tracks drift over time in .forge/drift-history.jsonl. Fires a bridge notification when score drops below threshold. With autoIncident, auto-captures incidents and generates fix proposals for high/critical violations. |
| `forge_env_diff` | env-diff | low | Compare environment variable keys across .env files — detect missing keys between baseline and target environments. Compares key names only (never values). Caches results in .forge/env-diff-cache.json. Integrates with forge_runbook to surface environment key gaps. |
| `forge_estimate_quorum` | estimate | low | Returns projected cost of a plan under all four quorum modes (auto / power / speed / false) in a single call. Agents MUST call this tool before presenting any dollar amount for a plan — hand-computed quorum costs drift by an order of magnitude. Backed by cost-service.mjs, the same code path that powers `pforge run-plan --estimate`. |
| `forge_estimate_slice` | estimate | low | Returns projected cost for a single slice under a chosen quorum mode. Cheaper than forge_estimate_quorum (which estimates the whole plan). Backed by cost-service.mjs estimateSlice(). Un-calibrated — no run-level historical correction factor applied. |
| `forge_export_plan` |  | low | Convert a loose Copilot cloud agent session plan (numbered or bulleted steps) into a hardened Plan Forge Phase-X-PLAN.md. Parses steps, extracts file paths, generates per-slice validation gates, and outputs a complete plan with scope contract, forbidden actions template, and acceptance criteria. |
| `forge_ext_info` | read | low | Show detailed information about a specific extension from the community catalog — author, version, category, provides, tags, and install command. |
| `forge_ext_search` | search | low | Search the Plan Forge community extension catalog. Returns matching extensions with names, descriptions, categories, and install commands. |
| `forge_fix_proposal` | fix-proposal | low | Generate a 1-3 slice fix plan from regression, drift, incident, secret-scan, Crucible (stalled/orphan), or tempering-bug failure. Writes to docs/plans/auto/LIVEGUARD-FIX-<id>.md. Capped at one proposal per id. |
| `forge_generate_image` | create | medium | Generate an image using AI image models (xAI Grok Aurora or OpenAI DALL-E). Provide a text description and get a generated image saved to disk. Supports format conversion — request WebP, PNG, AVIF, or JPEG regardless of what the API returns. Useful for creating logos, diagrams, UI mockups, icons, and illustrations during plan execution. Requires XAI_API_KEY (Grok) or OPENAI_API_KEY (DALL-E). |
| `forge_github_metrics` |  | low | Fetch live GitHub repository metrics via the gh CLI — stars, forks, open issues, PR counts, and commit activity. Requires gh CLI authenticated. USE FOR: project health dashboards, sprint retrospectives, answering 'how active is this repo?'. Returns null fields gracefully when gh is unavailable. |
| `forge_github_status` |  | low | Inspect the GitHub-native AI surface a project has wired up — .github/copilot-instructions.md, AGENTS.md, .github/instructions/, .github/prompts/, .vscode/mcp.json (Plan-Forge entry), .github/workflows/, github.com remote, gh CLI. Read-only; no network calls. USE FOR: diagnosing missing GitHub Copilot / GHAS / MCP wiring; building a readiness report; in-IDE chat answering 'what GitHub primitives am I missing?'. |
| `forge_graph_query` | graph | low | Query the Plan Forge knowledge graph. Returns subgraph of nodes and edges matching the query. Supports phase, file, recent-changes, and neighbor traversal queries. |
| `forge_health_trend` | health | low | Health trend analysis — aggregates drift scores, cost history, incident frequency, and model performance over a configurable time window. Returns per-metric summaries, an overall health score (0–100), and trend direction. Data sourced from .forge/ operational files. |
| `forge_home_snapshot` | shop-floor-overview | low | Read-only aggregated snapshot of the four shop-floor subsystems (Crucible, active runs, LiveGuard, Tempering) plus a trimmed activity feed. Use as a one-call health overview. Pass `drill` to fetch only one quadrant for a smaller payload, or `activityCursor` to paginate older activity entries. |
| `forge_hotspot` | churn-analysis | low | Identify git churn hotspots — files that change most frequently. Helps prioritize refactoring, testing, and review effort. Caches results in .forge/hotspot-cache.json (24h TTL). Accepts --top N and --since filters. |
| `forge_incident_capture` | capture-incident | low | Capture an incident — record description, severity, affected files, and optional resolution timestamp for MTTR tracking. Appends to .forge/incidents.jsonl. Dispatches a bridge notification to the onCall target configured in .forge.json when an incident is captured. |
| `forge_lattice_blast` | lattice | low | BFS traversal of the Lattice call graph — expands callees, callers, or both from a seed chunk up to a given depth. USE FOR: deep impact analysis, understanding call chains, finding all transitive dependencies. DO NOT USE FOR: simple symbol lookup (use forge_lattice_query). |
| `forge_lattice_callers` | lattice | low | Find all chunks that reference (call) a given symbol name. USE FOR: impact analysis — who depends on this function? DO NOT USE FOR: deep call-graph traversal (use forge_lattice_blast). |
| `forge_lattice_index` | lattice | medium | Build or update the Lattice code-graph index — walks tracked source files, chunks them, and persists JSONL to .forge/lattice/. USE FOR: initial index build, re-indexing after large changes, warming the Anvil cache for fast re-runs. DO NOT USE FOR: reading index data (use forge_lattice_query, forge_lattice_callers, or forge_lattice_blast). |
| `forge_lattice_query` | lattice | low | Search the Lattice chunk index by name, language, kind, or file path. Filters are ANDed. USE FOR: finding function/class declarations, locating code by language or file path. DO NOT USE FOR: call-graph traversal (use forge_lattice_blast). |
| `forge_lattice_stat` | lattice | low | Return a bounded summary of the Lattice index — chunk count, edge count, language distribution, Anvil hit rate, and index byte size. Read-only. USE FOR: confirming index health before querying, dashboards. DO NOT USE FOR: full index reads. |
| `forge_liveguard_run` | liveguard-run | medium | Run all applicable LiveGuard checks in a single call and return a unified health report. Executes: drift, sweep, secret-scan, regression-guard, dep-watch, alert-triage, and health-trend. Optionally runs diff if a plan is specified. NOTE: May take 2-3 minutes for .NET projects (dep-watch runs `dotnet list package --vulnerable`). Set client timeout to at least 300 seconds. |
| `forge_master_ask` | ask | high | Ask Forge-Master to reason about Plan Forge workflows — ideate features via Crucible, troubleshoot failures, query run status, or get operational guidance. Classifies intent, fetches memory context, and orchestrates read-only tool calls. Returns reply text, tool call history, token counts, and session ID for conversation continuity. |
| `forge_memory_capture` | capture | low | Capture a thought, decision, or lesson into OpenBrain persistent memory. USE FOR: recording architecture decisions, patterns chosen, gotchas discovered, conventions established, or any cross-session knowledge that future AI sessions should know. Requires OpenBrain to be configured in .vscode/mcp.json or .claude/mcp.json. |
| `forge_memory_report` | memory-report | low | GX.3 (v2.36): aggregate the health of every memory surface — L2 jsonl files (record counts, schema _v distribution), OpenBrain queue state (pending/delivered/failed/deferred/DLQ), drain stats trend, capture telemetry (per-tool/per-type volume + dedup rate), search cache health, and orphans under .forge/. Read-only — never mutates files. |
| `forge_meta_bug_file` | self-repair | low | File a self-repair meta-bug against Plan Forge itself. Creates (or deduplicates) a GitHub issue for plan, orchestrator, or prompt defects discovered during execution. Auto-attaches trajectory context when slice reference is provided. |
| `forge_new_phase` | create | low | Create a new phase plan file and add it to the deployment roadmap. Returns the created file path and roadmap entry. |
| `forge_notify_send` | notify | low | Send a notification directly via a named adapter, bypassing routing rules. Use for ad-hoc agent dispatches. |
| `forge_notify_test` | notify | low | Test notification adapter configuration. Validates config and optionally sends a test payload. |
| `forge_org_rules` | generate | low | Export org custom instructions — consolidate .github/instructions/*.instructions.md files into a single block for GitHub org-level Copilot custom instructions (Layer 1 of the two-layer model). Strips per-file frontmatter since org instructions apply universally. USE FOR: export org rules, generate org-level Copilot instructions, consolidate coding standards, org governance, GitHub org custom instructions. |
| `forge_patterns_list` |  | low | List recurring patterns detected across plan runs. Returns gate-failure recurrences, model failure rates, slice flap patterns, and cost anomalies. Advisory only — never injected into plan hardener or executor. |
| `forge_plan_status` | read | low | Get the status of the latest plan execution run. Shows per-slice results, token usage, duration, and overall status from .forge/runs/. |
| `forge_quorum_analyze` | quorum-analyze | low | Assemble a structured 3-section quorum prompt from any LiveGuard data source. No LLM calls — returns the prompt for multi-model dispatch. Supports customQuestion freeform override (max 500 chars) and analysisGoal presets. |
| `forge_regression_guard` | regression-check | medium | Run regression guard — extract validation gate commands from plan files, execute them against the current codebase, and report passed/failed/blocked results. Guards against regressions when files change. Accepts a list of changed files and an optional plan to scope the check. Falls back to testCommand slice fields when no bash-block gates are present. |
| `forge_review_add` | review | low | Add an item to the review queue. Used by producers (crucible/tempering/bug classifier) when human judgment is required. |
| `forge_review_list` | review | low | List review queue items with optional filters and pagination. |
| `forge_review_resolve` | review | low | Resolve an open review queue item (approve/reject/defer). Emits hub event and captures L3 memory. |
| `forge_run_plan` | execute | high | Execute a hardened plan — spawn CLI workers for each slice, validate at every boundary, track tokens. Supports Full Auto (gh copilot CLI) and Assisted (human + automated gates) modes. Use --estimate for cost prediction without executing. |
| `forge_run_skill` | execute | medium | Execute a skill programmatically — parse the SKILL.md, run steps with validation gates, emit events to the hub, return structured results. Use for automated skill execution with progress tracking. |
| `forge_runbook` | generate-runbook | low | Generate a human-readable operational runbook from a hardened plan file. Parses slices, scope contract, build/test commands, and validation gates into a structured Markdown document. Optionally appends recent incidents from .forge/incidents.jsonl for operational context. Saves to .forge/runbooks/<plan-name>-runbook.md and returns the output path. |
| `forge_search` | search | low | Search across forge artifacts — runs, bugs, incidents, tempering, hub events, review queue, memories, and plans. Reads existing L2 files and optional L3 OpenBrain index. Returns ranked results with snippets. |
| `forge_secret_scan` | secret-scan | low | Post-commit entropy analysis — scan git diff output for high-entropy strings that may be leaked secrets. Uses Shannon entropy with key-name heuristics. Never logs actual secret values — only file paths, line numbers, entropy scores, and <REDACTED> placeholders. Caches results in .forge/secret-scan-cache.json. Annotates deploy journal sidecar when last deploy matches HEAD. |
| `forge_skill_status` | read | low | Get recent skill execution events from the WebSocket hub history. Shows which skills were run, per-step results, and timing. |
| `forge_smith` | diagnose | low | Inspect the forge — diagnose environment, VS Code config, setup health, version currency, and common problems. Returns structured results with pass/fail/warning counts. |
| `forge_status` | read | low | Show all phases from DEPLOYMENT-ROADMAP.md with their current status (planned, in-progress, complete, paused). |
| `forge_sweep` | scan | low | Run completeness sweep — scan code files for TODO, FIXME, HACK, stub, placeholder, and mock data markers. Returns locations of all deferred-work markers. |
| `forge_sync_instructions` | sync | low | Generate .github/copilot-instructions.md from forge project context (project profile, project principles, .forge.json config). GitHub Copilot reads this file automatically. Completes the Copilot integration trilogy: sync-memories → sync-instructions. USE FOR: populate Copilot with project-specific instructions, regenerate instructions after adding project profile or principles, export project context to Copilot. DO NOT USE FOR: uploading to Copilot Spaces (use forge_sync_spaces), reading memory hints (use forge_sync_memories). |
| `forge_sync_memories` | sync | low | Generate .github/copilot-memory-hints.md from forge decisions (trajectory notes, auto-skills, brain L2 entries). Copilot Memory auto-discovers this file as a project knowledge source. Soft-sync approach — no API calls required. USE FOR: populate Copilot Memory with project decisions, regenerate memory hints after plan runs, export trajectory notes, sync brain decisions to Copilot. DO NOT USE FOR: uploading to Copilot Spaces (use forge_sync_spaces), reading individual trajectories. |
| `forge_team_activity` | read | low | Read recent Plan Forge run summaries from the team activity feed (.forge/team-activity.jsonl). Shows who ran what plan, when, and at what cost — across all developers sharing the same repo. USE FOR: see recent team plan runs, check what plans are in flight, review team plan cost. DO NOT USE FOR: individual slice details (use forge_plan_status), cost breakdown (use forge_cost_report). |
| `forge_team_dashboard` |  | low | Show the multi-developer plan coordination dashboard — aggregates team-activity.jsonl by operator and returns per-developer stats (runs, success rate, cost) plus a conflict-risk assessment for teams where multiple developers are active concurrently. USE FOR: team coordination view, who is running what plan, concurrent developer risk. DO NOT USE FOR: individual run details (use forge_plan_status), raw activity feed (use forge_team_activity), cost breakdown (use forge_cost_report). |
| `forge_tempering_approve_baseline` | approve | low | Promote the current screenshot for a URL to the visual-diff baseline. Copies the latest screenshot to .forge/tempering/baselines/ and writes a JSON sidecar with promotion metadata. Idempotent — re-promoting overwrites. USE FOR: accepting intentional visual changes after a visual regression is flagged by forge_tempering_run. |
| `forge_tempering_drain` | tempering | high | Tempering drain loop — wraps forge_tempering_run in a round-loop that re-probes until convergence or max-rounds cap fires. Writes per-round deltas to .forge/tempering/drain-history.jsonl and a final audit artifact to .forge/audits/dev-<ts>.json. USE FOR: recursive audit loops, post-plan convergence checks, drain-until-clean semantics. DO NOT USE FOR: single-shot tempering runs (use forge_tempering_run), editing source, creating bugs directly. |
| `forge_tempering_run` | tempering | medium | Tempering execution harness — runs the enabled test scanners (unit, integration, UI/Playwright, and API contract/OpenAPI/GraphQL) through each stack's preset adapter (typescript/dotnet/python/go/java/rust; php/swift/azure-iac stub until extension). Enforces config.runtimeBudgets with SIGTERM→SIGKILL, writes .forge/tempering/run-<ts>.json and .forge/tempering/artifacts/<runId>/contract/report.json, emits tempering-run-started / tempering-run-scanner-started / tempering-run-scanner-completed / tempering-run-completed hub events. USE FOR: post-slice verification, pre-deploy gates, CI adapters. Forbidden: does NOT edit source, does NOT create bugs (that lands in TEMPER-06), does NOT recurse into plan-forge itself. |
| `forge_tempering_scan` | tempering | low | Tempering (read-only) — scan an existing coverage report (lcov.info / coverage-final.json / cobertura.xml / jacoco.xml / go cover.out / tarpaulin JSON) and report per-layer coverage vs. configured minima. On first run, seeds .forge/tempering/config.json with enterprise defaults. Does NOT execute any tests. USE FOR: diagnosing coverage gaps, pre-deploy readiness checks, dashboard feeds. Writes .forge/tempering/scan-<ts>.json. |
| `forge_tempering_status` | tempering | low | Return the latest N Tempering scan summaries — used by the dashboard feed and `forge_smith` panel. Read-only; never triggers a scan. USE FOR: checking freshness, listing recent coverage status, wiring Tempering into other tools. |
| `forge_testbed_findings` | query | low | Query testbed defect-log findings. Returns findings filtered by status, severity, or date. Read-only — does not modify any files. |
| `forge_testbed_happypath` | test | high | Run all happy-path testbed scenarios sequentially. Returns aggregated pass/fail results with per-scenario details. Use dryRun to validate without executing. |
| `forge_testbed_run` | test | high | Run a testbed scenario against an external testbed repository. Executes preflight checks, setup, execution steps, and assertions, then writes defect findings. Use dryRun to validate without executing. |
| `forge_timeline` | timeline | low | Unified chronological view across all forge event sources with correlationId grouping. Merges hub-events, runs, memories, openbrain, watch, tempering, bugs, incidents, and forge-master sessions into a single timeline. |
| `forge_triage_route` | tempering | low | Triage a single tempering finding into one of three lanes: 'bug' (product defect), 'spec' (feature/spec gap), or 'classifier' (noise). Pure routing — no side effects. Fail-safe: unknown classifier output always routes to 'bug' with low confidence. USE FOR: per-finding triage after a tempering run, building custom drain loops. DO NOT USE FOR: batch triage (use forge_tempering_drain), registering bugs (use forge_bug_register after triage). |
| `forge_validate` | validate | low | Validate Plan Forge setup — check that all required files exist, file counts match preset expectations, and no unresolved placeholders remain. |
| `forge_watch` | observe | low | WATCHER (v2.34) — read-only observer that tails another project's pforge run. Run this from a SECOND VS Code Copilot session with Plan-Forge as the workspace, pointing targetPath at the project being executed. Returns snapshot of current run state (slices passed/failed/in-progress, token counts, gate errors) plus heuristic anomaly detection. Mode 'analyze' additionally invokes a frontier model (default: claude-opus-4.7) for narrative advice. The watcher CANNOT modify any files in the target project. |
| `forge_watch_live` | observe | low | WATCHER LIVE TAIL (v2.35) — stream events from another project's pforge run for a fixed duration. Connects to the target's WebSocket hub if running (`.forge/server-ports.json`); falls back to file polling otherwise. Read-only by design — only subscribes, never sends commands. Returns aggregate stats and the captured event stream. By default events are projected to a lite shape `{ ts, type, correlationId }` to keep payloads small; pass `verbose: true` for full event objects. |

## CLI-Only Families

Anvil and Hallmark expose CLI commands (and SDK exports) instead of MCP tools — they are local-file utilities that don't benefit from MCP overhead. Capability metadata for them lives in `pforge-mcp/capabilities.mjs` so the agent can still discover and reason about them.

| Command | Purpose | Backing Module |
|---------|---------|----------------|
| `pforge hallmark show [<id>]` | **v2.95+** — Read a `hallmark/v1` provenance record (schema version, tool name, captured timestamp, content hash). Omit id to list all. | `pforge-sdk/hallmark` |
| `pforge hallmark verify <id>` | **v2.95+** — Drift detection — compare stored Hallmark provenance against current file hash; flags modifications since capture. | `pforge-sdk/hallmark` |
| `pforge anvil stat` | **v2.95+** — Anvil memoization cache stats (entries, total bytes, per-tool breakdown). | `pforge-mcp/anvil.mjs` |
| `pforge anvil clear [--tool <name>] [--olderThanMs <n>]` | **v2.95+** — Delete cache entries with at least one filter. | `pforge-mcp/anvil.mjs` |
| `pforge anvil rebuild --since <git-sha>` | **v2.95+** — Selective invalidation of cache entries whose source files changed since the given SHA. | `pforge-mcp/anvil.mjs` |
| `pforge anvil dlq list\|drain` | **v2.95+** — List or re-drive Anvil dead-letter queue records. | `pforge-mcp/anvil.mjs` |
| `pforge sync-memories` | **v2.99+** — CLI alias for `forge_sync_memories` MCP tool. | `pforge-mcp/sync-memories.mjs` |
| `pforge sync-instructions` | **v2.99+** — CLI alias for `forge_sync_instructions` MCP tool. | `pforge-mcp/sync-instructions.mjs` |
| `pforge lattice <subcommand>` | **v2.95+** — CLI mirror of the 5 `forge_lattice_*` MCP tools. | `pforge-mcp/lattice.mjs` |

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

Discover at runtime via `forge_capabilities` → `innerLoop`. Configure via Dashboard → Config tab, Dashboard → Inner Loop tab (v2.58+), or Dashboard → main view (Observer Narrations / Cross-Run Anomalies / Auditor Report cards), or `.forge.json`.

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

## CLI Commands (57)

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
forge_tempering_run --objective "node scripts/measure-coverage.mjs" --accept-if greater # Accept only if the numeric metric improves
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

## GitHub Copilot Integration

Plan Forge has first-class integration with GitHub Copilot, GitHub Models, and GitHub Actions for cloud-based execution and security-driven plan generation.

### forge_github_status

`forge_github_status` — Check GitHub API connectivity, Copilot subscription status, and GitHub Models API availability. Returns auth state, rate limits, and per-service health.

| Field | Description |
|-------|-------------|
| `githubAuth` | Authentication state (`authenticated` / `unauthenticated`) |
| `copilotPlan` | Copilot subscription plan (`individual` / `business` / `enterprise` / `none`) |
| `modelsApiAvailable` | `true` when `models.github.ai/inference` is reachable |
| `rateLimitRemaining` | Remaining GitHub API requests for the hour |

CLI: `pforge github-status`

### GitHub Models

GitHub Models (`models.github.ai/inference`) is the recommended API provider for Plan Forge. It is the default inference endpoint when `GITHUB_TOKEN` (or `gh auth login`) is configured. Supported models: `gpt-4o-mini` *(default)*, `gpt-4o`, `claude-sonnet-4`, `claude-opus-4`.

### Copilot Coding Agent Worker

Dispatch slice execution to the Copilot coding agent instead of the local CLI:

```
pforge run-plan <plan> --worker copilot-coding-agent
```

The `--worker copilot-coding-agent` flag routes each slice to a Copilot cloud agent session. Requires `copilot-setup-steps.yml` in `.github/` and an active Copilot for Business or Enterprise subscription. Guardrails and MCP tools are available inside the cloud agent environment; the dashboard receives live slice events via WebSocket.

| Flag | Description |
|------|-------------|
| `--worker copilot-coding-agent` | Route slice execution to Copilot coding agent |
| `--worker local` | Run locally (default) |

### plan-from-sarif

Generate a remediation plan from a GitHub Code Scanning SARIF report:

```
pforge plan-from-sarif <sarif-file> [--severity high,critical] [--output docs/plans/]
```

Reads SARIF findings, groups by CWE / rule ID, and emits a hardened Plan Forge plan where each slice targets a specific vulnerability class. Integrates with `forge_secret_scan` and `forge_bug_register` — high-severity findings are auto-registered as bugs. Gate: `pforge run-plan docs/plans/<sarif-plan>.md`.

### github-metrics

Pull GitHub repository metrics (PR velocity, code frequency, contributor cadence) into the LiveGuard health context:

```
pforge github-metrics [--repo <owner/repo>] [--window 30d]
```

Metrics are written to `.forge/github-metrics.json` and surfaced on the Dashboard **GitHub** tab. `forge_health_trend` incorporates PR cycle time as a signal when the file is present. Requires `GITHUB_TOKEN` with `repo` scope.

## REST API

> **Full reference**: [docs/REST-API.md](REST-API.md) — all 103 endpoints organized by domain (runs, memory, crucible, liveguard, inner-loop, copilot integration, github coordination, etc.).

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
| **PreCommit chain** | `git commit` during `pforge run-plan` | Runs all entries listed in `hooks.preCommit.chain[]` in order. The built-in chain starts with `master-branch-reject` and `diff-classify`; any chain member can exit non-zero to abort the commit. | Yes (any chain member can block) |

Config (`.forge.json`):
```json
{
  "hooks": {
    "preDeploy":       { "enabled": true, "blockOnSecrets": true, "warnOnEnvGaps": true, "scanSince": "HEAD~1" },
    "postSlice":       { "enabled": true, "silentDeltaThreshold": 5, "warnDeltaThreshold": 10, "scoreFloor": 70 },
    "preAgentHandoff": { "enabled": true, "injectContext": true, "runRegressionGuard": true, "cacheMaxAgeMinutes": 30, "minAlertSeverity": "medium" },
    "preCommit": {
      "chain": [
        { "name": "master-branch-reject", "command": "node .github/hooks/PreCommit.mjs master-branch-reject" },
        { "name": "diff-classify", "command": "node .github/hooks/PreCommit.mjs diff-classify" }
      ]
    }
  },
  "network": { "allowed": ["models.github.ai", "api.x.ai", "api.openai.com", "api.anthropic.com"] },
  "tools": { "deny": [] },
  "openclaw": { "endpoint": "https://your-openclaw-instance", "apiKey": "see .forge/secrets.json" }
}
```

Worker Guardrails configuration reference (v3.6.3):

| Key | Purpose |
|-----|---------|
| `network.allowed` | Domain allowlist for outbound connections. Current mode is log-only (`PFORGE_NETWORK_LOG_ONLY=1`), so hosts are recorded per slice without blocking. |
| `tools.deny` | Tool denylist — MCP tool names the orchestrator strips from the worker session (`tool-denied` if a denied tool is attempted). |
| `hooks.preCommit.chain` | Ordered check chain before every commit during `pforge run-plan`. Built-ins begin with `master-branch-reject` and `diff-classify`; first non-zero exit aborts the chain. |

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

Plan frontmatter keys:

| Key | Meaning |
|-----|---------|
| `network.allowed` | Outbound host allowlist for a slice. When present, the orchestrator starts the network proxy in log-only mode (`PFORGE_NETWORK_LOG_ONLY=1`) and records contacted hostnames per slice. |
| `lockHash` | SHA-256 of the plan file at the time it was hardened. Mismatches (`lock-hash-mismatch`) abort execution to prevent running a stale plan against changed code. |
| `tools.deny` | MCP tool denylist applied at worker-session init. Denied tools are removed from the worker's visible tool list and attempted use surfaces `tool-denied`. |

## Guardrails (16-18 per preset)

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

## Agents (~12 per install: 5 pipeline + 6-7 stack-specific + audit-classifier-reviewer)

**Stack-specific (6)**: architecture-reviewer, database-reviewer, deploy-helper, performance-analyzer, security-reviewer, test-runner

**Cross-stack (8)**: accessibility-reviewer, api-contract-reviewer, cicd-reviewer, compliance-reviewer, dependency-reviewer, error-handling-reviewer, multi-tenancy-reviewer, observability-reviewer

**Pipeline (6)**: specifier → preflight → plan-hardener → executor → reviewer-gate → shipper

**Health (1)**: plan-health-auditor — read-only agent that analyzes plan health: slice sizing, gate coverage, missing forbidden actions, scope contract completeness. Invoked via `forge_delegate_to_agent` or directly from the Dashboard Agents tab.

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

## Skills (18 unique IDs — 10-11 per preset + 6 shared)

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

**Dashboard sections after v2.35.0 (26 tabs total)**:

| Section | Tabs | Active Color |
|---------|---------|--------------|
| FORGE | Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces, Skills, **Watcher**, **GitHub** | Blue (`#3b82f6`) |
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
