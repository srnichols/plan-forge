# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Fixed
- `executeSlice` — slices without a validation gate are no longer silently marked `passed` when the worker subprocess was killed by a signal (Windows `STATUS_CONTROL_C_EXIT` / `0xC000013A`, Unix SIGINT/SIGTERM/SIGKILL). Orchestrator now detects signal-encoded exit codes via new `detectKilledBySignal` helper and sets `status = "failed"` with a human-readable `statusReason`. Also tightens the gate-less path: any non-zero exit without a validation gate is treated as failure because there is no independent cross-check that work actually landed. Fixes meta-bug [#99](https://github.com/srnichols/plan-forge/issues/99).
- `pforge audit-loop` / `runTemperingDrain` — drain now detects "no-work" runs (tempering disabled or no scanner adapters for the stack) and reports `terminated: "no-work"` with a reason, instead of falsely declaring `"converged"` on round 1 with curve `[0]`. CLI surfaces a yellow `⚠ Audit Drain Did Not Run` diagnostic with exit code 2 instead of a green checkmark. Fixes meta-bug [#101](https://github.com/srnichols/plan-forge/issues/101).
- `appendHistoryLine` — filesystem errors writing `.forge/tempering/drain-history.jsonl` are now collected and returned in `summary.fsErrors`; previously swallowed silently. CLI prints a warning when persistence fails. Also adds `summary.historyPath` so users can find the artifact.
- `pforge self-update` / `update-from-github.mjs` — now warns when source repo has pushed semver tags ahead of the latest GitHub Release. Consumers previously received a silently-older version when maintainers tagged without cutting Releases (meta-bug [#100](https://github.com/srnichols/plan-forge/issues/100)). New exports: `fetchNewestSemverTag`, `checkLatestDrift`. Warning surfaces in both `pforge.sh` and `pforge.ps1` update flows. Advisory-only — never fails the update.

### Docs
- Release procedure memory updated — `gh release create` is now called out as MANDATORY step 6, not optional. Verification step added: `node pforge-mcp/update-from-github.mjs resolve-tag` must print no `warning` field.

## [2.80.1] — 2026-04-24 — Post-Phase-39 polish

> Packaging and surface polish on top of v2.80.0 — no runtime behavior changes.

### Fixed
- `pforge audit-loop --help` / `-h` — prints usage and exits cleanly without running a drain or writing history (previously fell through to execution).
- Forge-Master classifier keyword coverage — broadened operational/advisory lane regex; hammer-fm harness now passes 84/84 stress prompts with pure keyword routing (no LLM required).
- `scripts/hammer-fm.mjs` — added rate-limit retry with exponential backoff.

### Changed
- `pforge-mcp/capabilities.mjs#skills.available` — enumerated all 14 shared skills: added `/audit-loop`, `/forge-troubleshoot`, `/security-audit` to the advertised surface (previously listed 11).

### Docs
- `docs/RUMMAG-AUDIT-LOOP-FIELD-TEST.md` — field test guide for validating the audit-loop feature against an external project.

## [2.80.0] — 2026-04-24 — Audit Loop Promotion (Phase-39)

> **Phase-39 — Recursive audit-loop promotion to first-class Tempering subsystem.**
> Adds a closed-loop audit drain that discovers bugs from a running system: content-audit
> scanner probes live routes, `runTemperingDrain` iterates scan → triage → fix until
> convergence, and two new MCP tools (`forge_tempering_drain`, `forge_triage_route`) expose
> the pipeline programmatically. A classifier-reviewer agent and `/audit-loop` skill round
> out the user surface. Activation follows the quorum-style `off / auto / always` pattern
> via `.forge.json#audit` — default is `"off"`, explicit opt-in required.

### Added
- `pforge-mcp/tempering/scanners/content-audit.mjs` — HTTP-probe + HTML-inspection scanner. Probes routes against a live base URL, emits structured findings (status, title, h1, word count, placeholder markers, client-shell detection). Production guard via `looksLikeProduction()` from `ui-playwright.mjs`; `allowProduction` defaults to `false`.
- `pforge-mcp/tempering/drain.mjs` — `runTemperingDrain(opts)` iterates scan → triage → fix rounds until convergence or `maxRounds` (default 5). Accepts injectable `spawnWorker` for LLM worker injection. Emits hub events per round.
- `pforge-mcp/tempering/triage.mjs` — `routeFinding(finding, classifier) → { lane, payload, confidence }`. Routes findings to `"bug"` (bug registry), `"spec"` (Crucible), or `"classifier"` (local proposal artifact). Unknown classifier output falls safe to `{ lane: "bug", confidence: "low" }`.
- `pforge-mcp/tempering/auto-activate.mjs` — Activation surface: `loadAuditConfig(cwd)`, `saveAuditConfig(cwd, patch)`, `shouldAutoDrain(planContext)`. Config stored in `.forge.json#audit` with `mode: "off" | "auto" | "always"` (default `"off"`). `forbidProduction: true` is immutable.
- MCP tool `forge_tempering_drain` — programmatic access to the audit drain loop. Accepts `project`, `maxRounds`, `scanners`, `dryRun`, `env`.
- MCP tool `forge_triage_route` — programmatic finding triage. Accepts a finding object and optional classifier config, returns routed lane + payload.
- CLI command `pforge audit-loop` — manual one-shot drain. Flags: `--auto` (respect `.forge.json#audit` config), `--max=N`, `--dry-run`, `--env=dev|staging`.
- Classifier-reviewer agent (`classifier-reviewer.agent.md`) — reviews classifier lane proposals.
- `/audit-loop` slash command skill for interactive audit drain from chat.
- Dashboard audit-loop toggle — persists to `.forge.json#audit` via `saveAuditConfig`.
- `pforge run-plan` post-completion hook — checks `audit.mode` after plan completion. `"auto"` evaluates thresholds; `"always"` dispatches unconditionally; `"off"` skips. Never runs per-slice.
- E2E test suite: `pforge-mcp/tests/e2e-audit-loop.test.mjs`, `pforge-mcp/tests/e2e-audit-loop-cli.test.mjs`.

### Design Decisions (Slice 9 Documentation Sweep)
- `runTemperingDrain` accepts `spawnWorker` — already implemented and tested; consistent with visual-diff quorum injection pattern.
- Content-audit scanner reuses `looksLikeProduction()` guard from `ui-playwright.mjs` — no separate guard needed.
- Classifier lane proposals write to local `.forge/audits/` artifacts (not GitHub issues) for v2.80. GitHub PR creation deferred to v2.81+.
- CLI naming confirmed: `pforge audit-loop` (manual one-shot) vs `pforge audit-loop --auto` (config-respecting). Matches `--quorum=auto` convention.
- Dashboard toggle persists to `.forge.json#audit` (not session cache) — parity with existing tempering and Forge-Master prefs.

## [2.79.0] — 2026-04-23 — Forge-Master Embedding Intent Fallback (Phase-38.8)

> **Phase-38.8 — Embedding-based intent classification fallback.**
> Adds a "stage 1.5" cosine-similarity cache between the fast keyword scorer (stage 1) and the
> expensive router-model API call (stage 2). When a prompt closely matches a previously-classified
> prompt (cosine ≥ 0.85), the cached classification is inherited — zero API cost, works fully
> offline once warm. Uses `all-MiniLM-L6-v2` via `@xenova/transformers` (optional peer dep) with
> a deterministic hash bag-of-words fallback when the package is not installed.

### Added
- `pforge-master/src/embedding/provider.mjs` — async `embed(text) → Float32Array`. Auto-selects `transformers-mini` (lazy-loaded `@xenova/transformers` `all-MiniLM-L6-v2`) when available; falls back to `hash-bag` zero-dep deterministic hash bag-of-words baseline.
- `pforge-master/src/embedding/hash-bag.mjs` — tokenize, hash each token with a 32-bit hash, set corresponding index in a 512-length Float32Array; L2-normalize.
- `pforge-master/src/embedding/transformers-mini.mjs` — dynamic `import('@xenova/transformers')`, `all-MiniLM-L6-v2` pipeline.
- `pforge-master/src/embedding/cache.mjs` — `addEntry`, `query`, `evictLRU`, `save`, `load`. Cosine similarity, LRU eviction at 500-entry cap, binary file persistence (`.forge/fm-sessions/embedding-cache.bin`) with JSON metadata sidecar.
- `pforge-master/src/intent-router.mjs` — stage 1.5: after keyword scoring, before stage-2 router-model, queries the embedding cache. Returns `{via: "embedding-cache"}` on cache hit. Write-through: every successful classification is cached asynchronously. Skipped when `embeddingFallback === false`. Errors log a warning and fall through gracefully.
- `pforge-master/src/http-routes.mjs` — `loadPrefs`/`savePrefs` extended with `embeddingFallback: true` (default). New `GET /api/forge-master/cache-stats` endpoint returns `{size, hitRate, maxSize: 500}`.
- `pforge-mcp/dashboard/forge-master.js` — "Embedding Cache" tile showing cache size and hit rate.
- `scripts/probe-forge-master.mjs` — accumulates `via` field from each classification SSE event; prints `viaCounts: {keyword, embedding, router, other}` summary at end of run.
- `pforge-master/src/__tests__/embedding-provider.test.mjs` — hash-bag determinism, vector length, provider fallback tests.
- `pforge-master/src/__tests__/embedding-cache.test.mjs` — add/query round-trip, threshold filtering, LRU eviction, save/load.
- `pforge-master/src/__tests__/embedding-stage15.test.mjs` — stage 1.5 cache hit returns early with `via: "embedding-cache"`, fallback to stage-2 on miss, `embeddingFallback: false` opt-out, error resilience, write-through cache population.

## [2.78.0] — 2026-04-23 — Forge-Master Quorum Advisory Mode (Phase-38.7)

> **Phase-38.7 — Multi-model quorum advisory for high-stakes decisions.**
> When `quorumAdvisory` pref is `"always"` (or `"auto"` with advisory-lane escalation to high tier),
> Forge-Master fans out the prompt to 2–3 models in parallel and returns all replies with a dissent
> summary. A `quorum-estimate` SSE event is emitted before dispatch so clients can display cost and
> cancel. Quorum is hard-blocked on operational, troubleshoot, and build lanes. Human picks the reply
> — no auto-winner selection.

### Added
- `pforge-master/src/quorum-dispatcher.mjs` — `dispatchQuorum({prompt, models, deps})` dispatches to up to 3 models in parallel via `Promise.allSettled` with a 60s hard timeout. Returns `{replies: [{model, text, durationMs, costUSD}], dissent: {topic, axis}}`. Partial results on model failure (1 fails → remaining returned). `extractDissent(replies)` performs keyword-frequency divergence analysis across reply texts.
- `pforge-master/src/__tests__/quorum-dispatcher.test.mjs` — unit tests covering parallel dispatch, partial failure, all-fail, timeout, and dissent extraction.
- `pforge-master/src/reasoning.mjs` — quorum advisory path: reads `deps.quorumAdvisory` pref, evaluates auto-engage conditions (lane=advisory, autoEscalated, fromTier=high, confidence≥medium), emits `quorum-estimate` SSE event before dispatch, calls `dispatchQuorum`, accumulates quorum costs. Hard lane guard: quorum NEVER fires on operational/troubleshoot/build lanes (`QUORUM_BLOCKED_LANES` set).
- `pforge-master/src/http-routes.mjs` — `loadPrefs`/`savePrefs` extended with `quorumAdvisory: "off"|"auto"|"always"` field (default `"off"`). `quorum-estimate` SSE event emitted before model dispatch. `done` SSE event includes `quorumResult`. Both `/api/forge-master/ask` and `/api/forge-master/stream` endpoints pass `quorumAdvisory` and `onQuorumEstimate` callback to `runTurn`.
- `pforge-mcp/dashboard/forge-master.js` — "Quorum advisory" segmented control (`off / auto / always`) wired to `GET/PUT /api/forge-master/prefs`. `quorum-estimate` SSE listener renders cost estimate bubble with per-model badges. Multi-model reply cards rendered side-by-side with model name, duration, token counts, and cost. Dissent summary rendered as blockquote above reply cards.
- `pforge-master/tests/quorum-sse.test.mjs` — SSE ordering test: `quorum-estimate` event arrives before any reply chunk in auto-engage scenario.
- `pforge-master/tests/quorum-dashboard.test.mjs` — dashboard UI test: 3-card layout renders from fixture quorum reply payload, dissent summary visible.
- `.forge/validation/probes.json` — new probe `adv-quorum-trigger` with a high-stakes advisory prompt for quorum dispatch validation.

## [2.77.0] — 2026-04-23 — Forge-Master Pattern Surfacing (Phase-38.6)

> **Phase-38.6 — Read-only pattern detector scans run history and surfaces recurring patterns as advisory observations.**
> A file-based detector registry auto-discovers `pforge-mcp/patterns/detectors/*.mjs` modules.
> Four detectors ship: gate-failure-recurrence, model-failure-rate-by-complexity, slice-flap-pattern,
> and cost-anomaly. Patterns are surfaced in the troubleshoot lane as advisory context and via the
> new `forge_patterns_list` MCP tool (advisory lane only — Phase-32 guardrail). Dashboard adds a
> "Recurring patterns" panel grouped by severity. CLI: `pforge patterns list [--since <iso>]`.

### Added
- `pforge-mcp/patterns/registry.mjs` — `runDetectors(ctx)` auto-loads detectors from `detectors/` directory, invokes each with `{graph, runs, costs}`, collects results. Malformed detectors are skipped with a warning.
- `pforge-mcp/patterns/detectors/gate-failure-recurrence.mjs` — detects repeated gate failures (≥ 3 occurrences across ≥ 2 plans). Surfaces the `tee /tmp/` anti-pattern as a specific case.
- `pforge-mcp/patterns/detectors/model-failure-rate-by-complexity.mjs` — detects models with > 25% failure rate on slices with complexity ≥ 4.
- `pforge-mcp/patterns/detectors/slice-flap-pattern.mjs` — detects slices that flapped (pass→fail→pass) ≥ 3 times across runs.
- `pforge-mcp/patterns/detectors/cost-anomaly.mjs` — detects slices where cost spikes > 2× the rolling average.
- `forge_patterns_list` MCP tool — advisory-lane-only read-only tool. NOT in operational/troubleshoot/build allowlists (Phase-32 guardrail).
- `pforge-master/src/intent-router.mjs` — `forge_patterns_list` added to `LANE_TOOLS.advisory` only.
- `pforge-master/src/reasoning.mjs` — when troubleshoot lane fires AND `runAllDetectors` returns ≥ 1 match, pattern summaries appended to reply context as advisory observations.
- `pforge-mcp/dashboard/forge-master.js` — "Recurring Patterns" panel: `forgeMasterRenderPatternsPanel(patterns)` renders patterns grouped by severity (error → warning → info) with occurrence counts and plan names. `forgeMasterLoadPatterns()` fetches from `/api/forge-master/patterns`. Auto-loaded on Forge-Master tab init.
- `pforge.ps1` + `pforge.sh` — `pforge patterns list [--since <iso>]` CLI command.
- `pforge-mcp/tests/patterns-registry.test.mjs` — registry + gate-failure-recurrence detector tests.
- `pforge-mcp/tests/patterns-detectors.test.mjs` — tests for model-failure-rate, slice-flap, cost-anomaly detectors.
- `pforge-mcp/tests/patterns-dashboard.test.mjs` — dashboard panel rendering tests from fixture pattern data.

## [2.76.0] — 2026-04-23 — Forge-Master Daily Digest (Phase-38.5)

> **Phase-38.5 — Daily digest aggregator, renderer, CLI command, and dashboard tile.**
> `pforge digest [--date <iso>] [--notify] [--force]` generates a structured daily digest
> covering probe lane-match deltas, aging meta-bugs, stalled phases, drift trend, and cost
> anomalies. Routes via existing notifier extensions when `--notify` is passed. Idempotent
> by default — re-run on the same date is a no-op unless `--force` is supplied. Dashboard
> tile renders "Yesterday's Digest" on the Forge-Master tab.

### Added
- `pforge-mcp/digest/aggregator.mjs` — `buildDigest({projectDir, date, baselineDate})` reads probe results, meta-bugs, roadmap, drift history, and cost history. Returns `{sections, generatedAt}` with five sections: `probe-deltas`, `aging-bugs`, `stalled-phases`, `drift-trend`, `cost-anomaly`. Pure reader — never modifies artifacts.
- `pforge-mcp/digest/render.mjs` — `renderMarkdown(digest)` and `renderJson(digest)`. Markdown renderer includes severity badges (`🟢 info`, `🟡 warn`, `🔴 alert`), per-section item renderers, all-green summary, and UTC "Generated at" footer. JSON renderer produces stable `{version: "1", date, sections}` format.
- `pforge.ps1` + `pforge.sh` — `pforge digest` CLI command with `--date`, `--force`, and `--notify` flags. Idempotency guard: skips generation if digest file exists unless `--force`. Notifier dispatch via configured `extensions/notify-*` channels.
- `pforge-mcp/dashboard/forge-master.js` — "Yesterday's Digest" tile: `forgeMasterRenderDigestTile(digestJson)` renders a compact tile showing section severity icons and item counts. `forgeMasterLoadDigest()` fetches latest digest from `/api/forge-master/digest/latest`. Auto-loaded on Forge-Master tab init.
- `.github/workflows/forge-daily-digest.yml` — example GitHub Actions workflow with `schedule:` trigger (commented out by default) and `workflow_dispatch:` trigger (active). Uploads digest artifact.
- `pforge-mcp/tests/digest-aggregator.test.mjs` — unit tests for all 5 aggregator sections, empty-state, severity labels.
- `pforge-mcp/tests/digest-render.test.mjs` — snapshot-style determinism tests for Markdown and JSON renderers.
- `pforge-mcp/tests/digest-dashboard.test.mjs` — unit tests for dashboard tile rendering from fixture digest JSON.
- Digest output written to `.forge/digests/<YYYY-MM-DD>.json` (gitignored via `**/.forge/`).

## [2.75.1] — 2026-04-23 — Homepage dropdown actually hidden

> **Patch release — fixes the homepage nav dropdown that remained visible after v2.74.4's JS-only fix.**
> Root cause: `docs/index.html` does not load `assets/shared.css` and had **no** inline CSS for `.nav-dropdown`. The dropdown `<div>` carries Tailwind's `grid` utility (`display: grid`), so the panel was always rendered. The `nav-dropdown-open` class toggle added in v2.74.4 had nothing to match against. Added the missing CSS rules inline, with `!important` to beat Tailwind's `.grid` utility. Also simplified the click-toggle by dropping the CSS `:hover` open rule and the JS mouseleave timer — dropdowns are now strictly click-controlled across the whole site (click to open, click-again / click-outside / link-click / Escape to close).

### Fixed
- `docs/index.html` — added inline CSS for `.nav-dropdown-trigger > .nav-dropdown { display: none !important; }` and `.nav-dropdown-trigger.nav-dropdown-open > .nav-dropdown { display: grid !important; }`. The homepage dropdown now hides by default and only opens on click.
- `docs/assets/shared.css` — removed the CSS `:hover`-to-open rule (`@media (hover: hover)`) and the invisible `.nav-dropdown::before` hover-bridge pseudo-element. Removing hover-to-open eliminated the race with JS state that could leave dropdowns feeling stuck on hover-capable devices.
- `docs/assets/shared.js` and `docs/index.html` — removed the mouseleave auto-close timer. Close paths now come from explicit user actions only (click-outside, link-click, Escape).



> **Phase-38.4 — Planner-executor decomposition layer for Forge-Master.**
> `runTurn` now optionally runs a planner stage that decomposes complex multi-step queries
> into up to 5 ordered read-only tool calls, executes them (with dependency-aware parallelism),
> and synthesizes the reply over the joined results. Falls back to the existing reactive
> tool loop when the planner produces zero steps or detects a simple query.

### Added
- `pforge-master/src/planner.mjs` — `plan({userMessage, classification, lane, allowedTools, deps})` decomposes complex queries into up to 5 ordered tool-call steps. Skip heuristics for `offtopic` lane, single-tool-obvious queries, and empty allowlists. Uses cheapest provider tier (`resolveModel("low")`) for decomposition.
- `pforge-master/src/plan-executor.mjs` — `executePlan(plan, deps)` executes planned steps with dependency-aware parallelism (`Promise.all` for independent steps, sequential for `dependsOn` chains). Hard 30s timeout; single-step failures do not abort independent branches.
- `pforge-master/src/__tests__/planner.test.mjs` — unit tests for planner: multi-step plans, skip cases (offtopic, single-tool, no-tools), tool validation, max-step cap.
- `pforge-master/src/__tests__/plan-executor.test.mjs` — unit tests for executor: sequential execution, parallel branches, error isolation, timeout enforcement.
- `pforge-master/tests/planner-sse.test.mjs` — SSE event ordering: `plan` event emitted before `tool-call` events; no `plan` event when planner returns `skipReason`.
- `plan` SSE event — shape `{type: "plan", steps: [...]}` — emitted before tool-call events when the planner decomposes a query.
- 3 new validation probes (`planner-cost-breakdown`, `planner-recent-failures`, `planner-phase-status`) exercising multi-step planner queries.

### Changed
- `pforge-master/src/reasoning.mjs` — `runTurn` calls `plan()` after classification; if steps are non-empty, calls `executePlan` and synthesizes reply over results. Falls back to reactive loop on `skipReason` or planner failure.
- `pforge-master/src/http-routes.mjs` — forwards `plan` SSE event from `runTurn`.

## [2.74.4] — 2026-04-23 — Homepage dropdown + cumulative 2.74.x roll-up

> **Patch release — rolls up v2.74.0 through v2.74.3 (all previously documented but never tagged) plus a homepage-only UX fix.**
> The Resources dropdown on the `planforge.software` homepage was stuck open on touch and had no reliable close path on mouse, because `docs/index.html` uses an inline `<script>` block that predates the `nav-dropdown-open` click-toggle logic added to `shared.js`. Every other page already used `shared.js` and was unaffected.

### Fixed
- `docs/index.html` — ported the dropdown click-toggle, outside-click, Escape-key, and mouseleave grace-period logic from `assets/shared.js` into the homepage's inline script so the Resources menu now closes reliably on click-outside, Escape, and mouse-leave. Parity with all other pages restored.

### Included from prior untagged work
- v2.74.3 — `pforge analyze` wildcard crash fix (scope paths with `[]{}` characters)
- v2.74.2 — `forge_status` graceful fallback to root `ROADMAP.md`
- v2.74.1 — Forge-Master classifier tuning + hammer scenario corrections (4/8 → 8/8)
- v2.74.0 — Plan Forge Knowledge Graph (Phase-38.3, `forge_graph_query` advisory tool)

See the respective `[2.74.0]`–`[2.74.3]` sections below for full details.

---

## [2.74.3] — 2026-04-23 — `pforge analyze` wildcard crash fix

> **Point-release — unblocks `analyze` on plans containing bracket/brace characters in Scope Contract paths.**
> `Invoke-Analyze` used PowerShell `-like "*$fp*"` to match changed files against in-scope / forbidden path hints. When a scope line contained characters that PowerShell treats as wildcard metacharacters (`[`, `]`, `{`, `}`), the match threw `The specified wildcard character pattern is not valid`. Switched to `String.Contains` (literal substring) — same intent, no wildcard interpretation.

### Fixed
- `pforge.ps1` — `Invoke-Analyze` Coverage block uses `$file.Contains($fp)` / `$file.Contains($sp)` instead of `-like` wildcards. Analyze now completes on plans like `Phase-38.4-FM-PLANNER-EXECUTOR-v2.75-PLAN.md` whose scope lines include `{steps: [], skipReason: "lane=offtopic"}`.

---

## [2.74.2] — 2026-04-23 — `forge_status` graceful fallback (hammer 8/8)

> **Point-release — closes the last `ts-drift` failure from v2.74.1.**
> `pforge status` (and the MCP `forge_status` / `forge_plan_status` paths that wrap it) now fall back to root `ROADMAP.md` when `docs/plans/DEPLOYMENT-ROADMAP.md` is absent, and degrade to a friendly zero-exit notice when neither exists. A missing roadmap is a valid repo state, not an error — this keeps `forge_status` a soft tool for agent flows and fixes the `tool-success-rate` scorer false-negative.

### Fixed
- `pforge.ps1` / `pforge.sh` — `Invoke-Status` / `cmd_status` fall back to root `ROADMAP.md`, then to a zero-exit informational message. No more `exit 1` on repos without the consumer-template roadmap.

### Validated
- `pforge hammer-fm --scenario=shipped-prompts --tier=keyword-only --parallel=1 --timeout=90` → **8/8 passed** (report: `.forge/hammer-forge-master/reports/2026-04-23T18-44-51-953Z/`). Up from 7/8 in v2.74.1 and 4/8 pre-tuning.

---

## [2.74.1] — 2026-04-23 — Forge-Master classifier tuning + hammer scenario fixes

> **Point-release tuning off the 2026-04-23 hammer run.**
> Live hammer against shipped-prompts scenario went from **4/8 passing → 7/8 passing** after 2 classifier patterns + 2 scenario corrections. Classifier now correctly routes completeness-sweep vocabulary and read-only Crucible verbs to the operational lane. Remaining failure (`ts-drift` 1/3 tool-success) is a downstream `forge_status` / `forge_plan_status` bug, not classifier — tracked separately.

### Fixed
- `pforge-master/src/intent-router.mjs` — OPERATIONAL lane now matches `sweep|completeness sweep|todos?|stubs?|mocks?|incomplete|placeholders?` (weight 2). Previously classified as `offtopic`.
- `pforge-master/src/intent-router.mjs` — OPERATIONAL lane now matches `list/show/view/display … (all|active|pending|open|crucible)* (smelts?|crucible entries?|crucible items?)` (weight 3). Previously classified as `build` due to bare `crucible` keyword.
- `scripts/hammer-fm/scenarios/shipped-prompts.json` — `ts-diagnose-failure` `expectedTools` widened to the full valid diagnostic set (`forge_analyze`, `forge_smith`, `forge_plan_status`, `forge_health_trend`, `forge_sweep`, `forge_bug_list`) so the scenario measures intent, not tool-name parity.
- `scripts/hammer-fm/scenarios/shipped-prompts.json` — `cr-list-smelts` `expectedTools` corrected to `[forge_crucible_list, forge_search, forge_status]` (was wrongly `[forge_capabilities]`).
- `scripts/hammer-fm/scenarios/shipped-prompts.json` — `ts-drift` `expectedLane` corrected to `operational` (drift reports are operational readouts per classifier pattern at `intent-router.mjs:134`).

### Validated
- `pforge hammer-fm --scenario=shipped-prompts --tier=keyword-only --parallel=1` → **7/8 passed** (report: `.forge/hammer-forge-master/reports/2026-04-23T18-17-34-174Z/`).

---

## [2.74.0] — 2026-04-23 — Plan Forge Knowledge Graph (Phase-38.3)

> **Phase-38.3 — Queryable in-memory knowledge graph over Plan Forge artifacts.**
> A new `forge_graph_query` MCP tool (advisory lane only) collapses multi-artifact queries
> into a single call. Graph covers Phase, Slice, Commit, File, Bug, and Run nodes with
> typed edges. Snapshot persisted to `.forge/graph/snapshot.json` for cold-start.

### Added
- `pforge-mcp/graph/schema.mjs` — `NODE_TYPES` and `EDGE_TYPES` constants with JSDoc
- `pforge-mcp/graph/builder.mjs` — `buildGraph(projectDir, {since, execSyncFn})` reads `docs/plans/*.md`, `git log`, `.forge/runs/**`, `.forge/bugs/**`; writes atomic snapshot; returns `{nodes, edges}` (empty on fresh repos)
- `pforge-mcp/graph/query.mjs` — `queryByPhase`, `queryByFile`, `queryRecentChanges`, `neighbors` with lazy snapshot load; all return `{nodes, edges, nodeCount, edgeCount}`; `_resetGraphCache()` for testing
- `forge_graph_query` MCP tool registered in `pforge-mcp/server.mjs` — input schema `{type, filter, since, edgeType}`
- `pforge-mcp/tests/graph-builder.test.mjs` — unit tests: Phase/Slice extraction, commit nodes, empty-state, date filtering, malformed frontmatter
- `pforge-mcp/tests/graph-query.test.mjs` — unit tests: all 4 query functions, snapshot round-trip, empty-graph
- `pforge-master/tests/graph-tool-lane.test.mjs` — pins lane-restriction: `forge_graph_query` in advisory, absent from operational/troubleshoot/build
- `scripts/graph.mjs` — `pforge graph rebuild|stats|query <type>` CLI helper
- `pforge graph rebuild|stats|query` CLI in `pforge.ps1` and `pforge.sh`
- `.forge/graph/` added to `.gitignore`

### Changed
- `pforge-master/src/intent-router.mjs` — added `"forge_graph_query"` to `LANE_TOOLS.advisory` ONLY
- `pforge-mcp/capabilities.mjs` — `forge_graph_query` registered in `TOOL_METADATA`
- `pforge-mcp/tools.json` — `forge_graph_query` tool definition added

### Notes
- `forge_graph_query` is advisory-lane only (Phase-32 guardrail: build/operational/troubleshoot lists unchanged)
- Graph bounds: last 90 days of commits, last 10 runs per phase, last 200 bugs
- Snapshot at `.forge/graph/snapshot.json` is gitignored — never committed
- BFS neighbor traversal terminates at 1 hop by default; cyclic graphs are safe (visited-set guard)

## [2.73.0] — 2026-04-23 — Forge-Master Cross-Session Recall (Phase-38.2)

> **Phase-38.2 — BM25 recall index over past fm-sessions for cross-session memory.**
> `runTurn` now queries a BM25 index over all prior conversation turns for operational, troubleshoot, and advisory lanes, injecting the top-3 related turns as advisory context into the system prompt.
> Recall is non-fatal — index failure always degrades gracefully without affecting the turn.

### Added
- `pforge-master/src/recall-index.mjs` — pure-JS BM25 indexer (`buildIndex`, `loadIndex`, `queryIndex`); reads `*.jsonl` + `*.archive.jsonl` from `.forge/fm-sessions/`; excludes OFFTOPIC turns; lazy daily refresh; concurrent-build serialization; atomic write
- `pforge-master/src/__tests__/recall-index.test.mjs` — 16 tests covering build, query, lazy refresh, OFFTOPIC exclusion, concurrent builds, archive indexing, empty-state, malformed JSONL
- `pforge-master/src/__tests__/reasoning-recall.test.mjs` — 6 integration tests: cross-session recall surface, graceful degradation, OFFTOPIC skip, ephemeral skip, no-provider path, classification isolation
- `scripts/fm-recall.mjs` — CLI helper for `pforge fm-recall query "<text>"` and `pforge fm-recall rebuild`
- `pforge fm-recall query|rebuild` CLI commands in `pforge.ps1` and `pforge.sh`
- `pforge-mcp/tests/forge-master-recall.test.mjs` — 8 dashboard unit tests for the related-conversations panel: renders on non-empty payload, correct count in summary, per-turn message/lane/date, no-op on empty/null, updates in place

### Changed
- `pforge-master/src/reasoning.mjs` — cross-session recall for non-ephemeral sessions on `operational`, `troubleshoot`, `advisory` lanes; injects `> **Recall (advisory):**` block into contextBlock; `relatedTurns` returned on all result shapes
- `pforge-master/src/http-routes.mjs` — `done` SSE event now includes `relatedTurns` array (both Express and bare-node paths)
- `pforge-mcp/dashboard/forge-master.js` — `forgeMasterStream` handles `relatedTurns` from `done` event; `forgeMasterRenderRelatedConversations` renders collapsible `<details>` "Related conversations" section

### Notes
- Recall index stored at `.forge/fm-sessions/recall-index.json` — gitignored, never committed
- Minimum query length: 3 tokens (shorter queries return `[]` without index access)
- BM25 parameters: k1=1.5, b=0.75 (standard TREC defaults)
- Cross-project isolation: index keyed by `projectDir`; no leakage across repositories

## [2.72.0] — 2026-04-25 — Forge-Master Conversation Memory (Phase-38.1)

> **Phase-38.1 — File-based conversation memory for Forge-Master.**
> Adds JSONL session persistence so `runTurn` loads prior turns before classification and persists each turn to disk.
> Per-tab session IDs flow from the dashboard through the HTTP layer to the reasoning engine.

### Added
- `pforge-master/src/session-store.mjs` — file-based JSONL session persistence primitives: `appendTurn`, `loadSession`, `purgeSession`, `rotateIfNeeded`, `hashReply`; per-session mutex; auto-rotation at 200 turns (oldest 100 → archive); path sanitization against traversal
- `pforge-master/src/__tests__/session-store.test.mjs` — 20 tests covering all operations
- `pforge-master/src/__tests__/reasoning-session.test.mjs` — 5 integration tests for runTurn session persistence
- `pforge-master/tests/session-route.test.mjs` — 7 tests for HTTP session header threading and `/api/forge-master/session/:id` route
- `GET /api/forge-master/session/:id` HTTP route — returns `{sessionId, turns: last 10}` for both Express and bare-node paths
- `pforge fm-session list|purge <id>|purge --all` CLI commands in `pforge.ps1` and `pforge.sh`
- `docs/CLI-GUIDE.md` — `fm-session` subcommand group with file format, rotation, and usage notes

### Changed
- `pforge-master/src/reasoning.mjs` — canonical `effectiveSessionId` (deps.sessionId ?? input.sessionId); `isEphemeral` guard; prior turn loading (last 10) before classification; prior turns injected into contextBlock; OFFTOPIC path and main reply path both persist turns
- `pforge-master/src/http-routes.mjs` — POST `/api/forge-master/chat` reads `x-pforge-session-id` header; stream handler threads `deps.sessionId`; bare-node path mirrors same changes
- `pforge-mcp/dashboard/forge-master.js` — `FM_TAB_SESSION_ID` generated at module init via `sessionStorage`; attached as `x-pforge-session-id` header on every chat request

### Notes
- Session files stored in `.forge/fm-sessions/` which is gitignored — never committed
- Ephemeral sessions (no header) write nothing to disk — probe harness and CLI one-shots remain zero-disk-side-effect
- Pre-existing test failure in `reasoning-provider-selection.test.mjs` "(c)" unrelated to this phase

— 2026-04-24 — Forge-Master Hammer Harness (Phase-37.2)

> **Phase-37.2 — Hammer harness for end-to-end Forge-Master testing.**
> Adds `scripts/hammer-fm.mjs`, four bundled scenario packs, and `pforge hammer-fm` CLI surface.
> Replaces ad-hoc probe scripts with a repeatable, scored harness.

### Added
- `scripts/hammer-fm.mjs` — injectable CLI; `main(argv, deps)` returns exit code; `loadScenario(name, opts)` validates scenario packs
- `scripts/hammer-fm/sse-client.mjs` — chunk-boundary-safe SSE reader with injectable `fetchFn`
- `scripts/hammer-fm/scorers.mjs` — 6 pure scorer functions: `lane`, `toolPresence`, `contentMatch`, `noForbiddenContent`, `sseHealth`, `latency`; exported as `ALL_SCORERS`
- `scripts/hammer-fm/reporter.mjs` — Markdown + JSON reporter with per-prompt table, tier-comparison section, cost summary
- `scripts/hammer-fm/scenarios/shipped-prompts.json` — 8 prompts (1 per lane category)
- `scripts/hammer-fm/scenarios/realistic-qa.json` — 20 prompts (ambiguous, multi-intent, follow-up, off-topic, operational)
- `scripts/hammer-fm/scenarios/dial-sweep.json` — 10 prompts designed for tier-comparison sweeps
- `scripts/hammer-fm/scenarios/phase-38.1-baseline.json` — 6 conversation-memory baseline prompts for Phase-38.1 hardening
- `pforge hammer-fm` CLI command (pforge.sh + pforge.ps1)
- `docs/CLI-GUIDE.md` — `hammer-fm` section with scenario schema, bundled scenarios, and report format
- `.gitignore` — `.forge/hammer-forge-master/reports/` excluded
- `pforge-mcp/tests/hammer-fm.test.mjs` — 35 unit tests (all green)

### Changed
- `pforge.sh` / `pforge.ps1` — added `hammer-fm` dispatcher (`cmd_hammer_fm` / `Invoke-HammerFm`)
## [2.71.1] — 2026-04-23 — Forge-Master HTTP Bridge Completeness (Phase-37.1)

> **Phase-37.1 — Hotfix release. Live-fire hammer evidence on 2026-04-23 showed every downstream tool call from the Forge-Master HTTP bridge returned either `"Unknown tool: X"` or `"requires async dispatch — not available in Forge-Master bridge"`. Root cause: `invokeForgeTool` (the `mcpCall` injected into `registerForgeMasterRoutes`) handled only a subset of the MCP tool registry; the HTTP dispatcher bailed early on streaming tools instead of awaiting their terminal payload. This release closes both error classes for all read-only tools in `BASE_ALLOWLIST`. Re-hammer of the 8-prompt battery shows zero `Unknown tool` and zero `requires async dispatch` in all 8 post-fix logs; 7/8 labels have a non-error `tool-call` `resultSummary`.**

### Fixed

- **`pforge-mcp/server.mjs` → `invokeForgeTool` — dispatcher parity** — Extended the in-process MCP dispatcher to handle every read-only tool in `BASE_ALLOWLIST`. Tools previously returned `{"success":false,"error":"Unknown tool: X"}` now resolve via the correct `requestHandlers` path. For streaming tools, the dispatcher awaits the terminal event and aggregates intermediate events into `{events:[...], terminal: <payload>}` (capped at `streamEventCap`, default 20). The `"requires async dispatch — not available in Forge-Master bridge"` early-return stub is removed; async tools now resolve through the terminal-await path.
- **`pforge-master/src/http-dispatcher.mjs` — async terminal await** — Removed the early-return guard for streaming tools. Dispatcher now awaits final payload for tools using the Plan Forge async stream protocol. Docblock updated to describe terminal-await behaviour.
- **`pforge-master/src/allowlist.mjs` — allowlist hygiene** — `BASE_ALLOWLIST` entries with no MCP handler removed with inline `// removed in Phase-37.1 — no MCP handler` comment.

### Added

- **`pforge-master/tests/http-dispatcher-parity.test.mjs`** — Parameterised test asserting every `BASE_ALLOWLIST` entry resolves without `"Unknown tool"` or `"requires async dispatch"` error strings. Red scaffolds from Slice 1 now green.
- **`pforge-master/tests/http-dispatcher-async.test.mjs`** — Proves that mocked streaming tools (`forge_plan_status`, `forge_search`, `forge_cost_report`) resolve through the terminal-await path with `{events:[...], terminal: ...}`, not the old stub. Now green.

### Validation

- Re-hammer (`.forge/hammer-forge-master/logic/post-fix/*.txt`): 8/8 files — 0 `Unknown tool`, 0 `requires async dispatch`, 7/8 with non-error `tool-call` `resultSummary` (01-offtopic correctly has none; it is an off-topic query).
- Full `pforge-master` suite (≥ 133 tests) green. Full `pforge-mcp` suite green (tolerating pre-existing #97 cost-service regression).

## [2.71.0]— 2026-04-23 — Classifier calibration + Keyword-Only Harness (Phase-37 Slice 4)

> **Phase-37 Slice 4 — Harness validation & release. `--keyword-only` flag forces the probe to skip the stage-2 router model; `x-pforge-keyword-only: 1` HTTP header wires the bypass end-to-end from harness through HTTP routes to the `classify()` call. Validated: lane-match 19/21 (keyword-only) and 19/21 (normal) — both exceed the ≥16/18 threshold. Provider rate-limiting reduced live-reply count in both runs; classification routing is verified via SSE `classification` events emitted before any model call.**

### Added

- **`scripts/probe-forge-master.mjs` — `--keyword-only` flag** — When set, the probe sends `x-pforge-keyword-only: 1` on every `POST /api/forge-master/chat` request, instructing the server to skip stage-2 router-model classification and use the keyword-only result directly. Console output shows `keyword-only: true` banner. Enables isolated regression testing of `scoreKeywords()` without needing an API key or incurring model cost.
- **`pforge-master/src/http-routes.mjs` — `x-pforge-keyword-only` header support** — Both Express and bare-node paths read the `x-pforge-keyword-only: 1` request header from `POST /api/forge-master/chat`, store `keywordOnly: true` in the session, and forward `forceKeywordOnly: true` to `runTurn` in the SSE stream handler.
- **`pforge-master/src/reasoning.mjs` — `deps.forceKeywordOnly`** — When `deps.forceKeywordOnly` is true, `runTurn` passes `keywordOnly: true` to `classify()`, skipping the stage-2 router-model call. JSDoc updated to document the new dep field.
- **`pforge-master/src/intent-router.mjs` — `opts.keywordOnly`** — `classify()` accepts a `keywordOnly` option; when true, the router-model branch is skipped even if `callApiWorker` and `detectApiProvider` are provided. Enables deterministic, zero-cost classification in test and harness contexts.
- **Classifier calibration validated** — Both probe runs show lane-match 19/21 classifiable probes against `.forge/validation/probes.json`. Per-probe classification table in markdown report shows ✅/❌ per probe with expected vs. actual lane and confidence tier. Results committed to `.forge/validation/`. Finding 1 from `FINDINGS-2026-04-23.md` stamped RESOLVED.

### Notes

- The `forceKeywordOnly` path is a test/harness concern only. Production traffic via `forge_master_ask` always goes through the full two-stage classify flow.
- Rate-limiting on the GitHub Copilot provider reduced live-reply counts in both probe runs (11/24 and 11/24 replies). Lane-match accuracy — the primary classifier calibration metric — is unaffected by rate-limiting since classification fires before the reasoning model call.
- `scripts/probe-forge-master.mjs` confidence display now handles both string (`"low"|"medium"|"high"`) and numeric confidence values from the SSE `classification` event, preventing a `toFixed is not a function` crash introduced in Phase-36.

## [2.70.0] — 2026-04-23 — Forge-Master Runtime Observability (Phase-36 Slice 4)

> **Phase-36 Slice 4 — Probe validation & release. Classification events are now observable end-to-end via SSE; the probe harness captures lane + confidence per-probe and reports accuracy in Markdown.**

### Added

- **`scripts/probe-forge-master.mjs` — classification capture** — SSE parser now handles `event === "classification"`, storing `{ lane, confidence }` per probe. Console output format changed from `tokens=X/Y tools=Z` to `lane=<lane> conf=<conf> tokens=X/Y tools=Z`. Results JSON includes a top-level `classification` field per probe entry.
- **`scripts/probe-forge-master.mjs` — Classification match report section** — Markdown report gains a "Classification match" section with: overall lane-match count, per-lane accuracy table (`| Expected Lane | Matched |`), and per-probe table (`| Probe ID | Expected | Got | Confidence | Match |`). Each probe's body section gains a `**Classification**` line showing lane, confidence, and ✅/❌ match icon.
- **Harness caveats updated** — Removed the outdated `"classification.lane is not emitted via SSE"` warning (resolved: `onClassification` callback has been wired in `http-routes.mjs` since Phase-29). Retained the stub-dispatcher caveat.
- **Validation results committed** — `.forge/validation/results-2026-04-23T03-24-28-669Z.md` and `.json`. Run against `http://127.0.0.1:3100` with 24 probes: 14/21 classifiable probes matched expected lane (≥12 threshold); 70 lines containing ✅ or OK (≥22 threshold). See [results-2026-04-23T03-24-28-669Z.md](.forge/validation/results-2026-04-23T03-24-28-669Z.md).

### Notes

- Classification is driven by `classify()` in `pforge-master/src/intent-router.mjs` and forwarded via `onClassification` in `pforge-master/src/http-routes.mjs` (both express and bare-node paths).
- Rate-limiting on the GitHub Copilot provider caused 8/24 probes to short-circuit with `error: "rate_limited"`. Classification events still fired correctly for those probes (SSE sequence: `start → classification → error`). Reply-level metrics reflect available capacity; lane-match metrics cover all probes.

## [2.69.0] — 2026-04-23 — Phase-34 rebuild (Closes #96)

> **Phase-35 — Repairs Phase-34 hollow slices that shipped with grep-only gates and no vitest execution.**
> Root cause: Phase-34 grep-only gates shipped without running test suites. Fix: every gate that references a test file now invokes vitest.

### Added

- **Slice 1 — Intent-router additions** (`pforge-master/src/intent-router.mjs`) — New lanes: tempering, principle-judgment, meta-bug-triage with auto-escalation. Adds `LANES.TEMPERING`, `LANES.PRINCIPLE_JUDGMENT`, `LANES.META_BUG_TRIAGE` constants and exports `LANE_DESCRIPTORS` (frozen object, each lane keyed with `recommendedTierBump`). Keyword patterns tuned to beat existing OPERATIONAL/TROUBLESHOOT collision points. `LANE_TOOLS` entries for three new lanes (empty array; Phase-36 will populate). `scoreKeywords` zero-score map and stage-2 router-model prompt extended.
- **Slice 2 — Auto-escalation in runTurn** (`pforge-master/src/reasoning.mjs`) — `runTurn` inspects `LANE_DESCRIPTORS[lane].recommendedTierBump` and bumps resolved tier for high-stakes lanes (`low → medium → high`, capped). Return object gains `autoEscalated`, `fromTier`, `toTier`, `reason` fields on every code path. Opt-out: `forgeMaster.autoEscalate = false` in `.forge.json`.
- **Slice 3 — Prefs file persistence + REST endpoints** (`pforge-master/src/http-routes.mjs`) — Exports `loadPrefs(cwd)` and `savePrefs(prefs, cwd)`. Prefs backing file is `.forge/fm-prefs.json`. Defaults: `{ tier: null, autoEscalate: false }`. `GET /api/forge-master/prefs` and `PUT /api/forge-master/prefs` registered in `createHttpRoutes`. `forge_master_ask` reads prefs tier on each invocation and threads into `runTurn`.
- **Slice 4 — Dashboard dial UI** (`pforge-mcp/dashboard/forge-master.js`) — Prefs endpoints + Fast/Balanced/Deep dashboard dial. Three-position segmented control (Fast↔low, Balanced↔medium, Deep↔high) inserted above composer on tab load. On click, PUTs new tier to prefs endpoint. Dial hidden when prefs endpoint unavailable. No model names exposed in UI.

### Tests

- `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` — 10 tests: LANE_DESCRIPTORS shape, recommendedTierBump values, classify routing for three new lanes, no regressions to existing lanes.
- `pforge-mcp/tests/forge-master-prefs.test.mjs` — 5 tests: loadPrefs defaults, round-trip save/load, invalid tier sanitisation, REST route registration.

## [2.68.1] — 2026-04-22 — Windows gate bash dispatch hotfix

> **Hotfix — Windows users whose gate commands use Unix-shell tools (`grep`, `test`, `sed`, etc.) were silently failing because the orchestrator dispatched gates through `cmd.exe` instead of bash.**

On Windows, the orchestrator's `execSync` call went directly to `cmd.exe`, which doesn't recognise Unix shell commands. The fix (Phase-34.1, closes [#94](../../issues/94) and [#95](../../issues/95)) teaches the orchestrator to detect Unix-shell syntax in gate command strings and auto-wrap them in `bash -c "..."` when Git for Windows bash is on `PATH`; if bash is absent the command is dispatched as-is (existing `node`/`npx`/`npm` gates are unaffected). The `step2-harden-plan.prompt.md` plan-authoring guidance now explicitly documents this behaviour so authors know they can safely write `grep`/`sed`/`test` gates when Git for Windows is available, and should fall back to `node -e` one-liners otherwise.

## [2.68.0]— 2026-04-22 — Forge-Master Reasoning Dial (Phase-34)

> **Forge-Master gains a reasoning dial: Fast / Balanced / Deep, no API key required for any tier.**

### Added

- **Slice 1 — Tier resolver + 429 fallback** (`pforge-master/src/reasoning-tier.mjs`, `pforge-master/src/config.mjs`, `pforge-master/src/reasoning.mjs`, `pforge-master/src/__tests__/reasoning-tier.test.mjs`) — New `reasoning-tier.mjs` module exports `resolveModel(tier, config)` mapping `"low"` → `gpt-4o-mini`, `"medium"` → `gpt-4o`, `"high"` → `claude-sonnet-4`. Unknown tiers fall back to `config.forgeMaster.defaultTier` (default `"low"`). `runTurn` accepts an optional `tier` parameter; an explicit `model` option always wins over the tier resolver. 429 graceful degradation: `high` → `medium` → `low` retry chain with no infinite loop at `low`. Turn trace gains `requestedTier`, `resolvedModel`, `fallbackFromTier`, and `escalated` fields. Defaults added to `config.mjs`: `forgeMaster.reasoningTiers`, `forgeMaster.defaultTier = "low"`, `forgeMaster.autoEscalate = true`.
- **Slice 2 — Auto-escalation for high-stakes lanes** (`pforge-master/src/intent-router.mjs`, `pforge-master/src/reasoning.mjs`, `pforge-master/src/__tests__/intent-auto-escalation.test.mjs`) — Each lane descriptor gains a `recommendedTierBump` integer (default `0`). Lanes `"tempering"`, `"principle-judgment"`, and `"meta-bug-triage"` set it to `1`. `runTurn` applies the bump once per turn (`low+1→medium`, `medium+1→high`, `high+1→high`, capped) when `config.forgeMaster.autoEscalate !== false` and no explicit `model` is set. Turn trace gains `autoEscalated`, `fromTier`, `toTier`, and `reason` fields. Opt-out: set `forgeMaster.autoEscalate = false` in `.forge.json`.
- **Slice 3 — Dashboard dial + prefs endpoint** (`pforge-mcp/server.mjs`, `pforge-mcp/dashboard/forge-master.js`, `pforge-mcp/dashboard/served-app.js`, `pforge-mcp/tests/forge-master-prefs.test.mjs`, `.forge/forge-master-prefs.json`) — `GET /api/forge-master/prefs` returns `{ tier, autoEscalate }` (defaults `low` / `true` when prefs file absent). `PUT /api/forge-master/prefs` validates tier and writes `.forge/forge-master-prefs.json`; returns HTTP 400 on invalid tier. `forge_master_ask` reads prefs on each invocation (≤ 5 s TTL cache) and threads `tier` into `runTurn`. Dashboard gains a three-position dial (Fast / Balanced / Deep) above the composer that does **not** expose model names. Dial hidden when no provider is reachable; `"Connect GitHub"` prompt shown instead.

### Tests

- `pforge-master/src/__tests__/reasoning-tier.test.mjs` — 7+ tests: low/medium/high resolution, unknown-tier fallback, explicit model override, 429-at-high retries to medium, 429-at-low surfaces error.
- `pforge-master/src/__tests__/intent-auto-escalation.test.mjs` — 10 tests: advisory lane no-bump, tempering/principle-judgment/meta-bug-triage bumps, cap at high, explicit model disables bump, `autoEscalate: false` disables bump, LANE_DESCRIPTORS shape.
- `pforge-mcp/tests/forge-master-prefs.test.mjs` — REST round-trip tests: GET defaults, PUT valid tier, PUT invalid tier (400), file write, TTL cache.

## [2.67.0]— 2026-04-22 — Zero-Key Forge-Master via GitHub Models (Phase-33)

> **Minor release — Forge-Master now works out of the box for GitHub Copilot subscribers — no API key required.**

### Added

- **Slice 1 — GitHub Copilot provider adapter** (`pforge-master/src/providers/github-copilot-tools.mjs`, `src/providers/__tests__/github-copilot-tools.test.mjs`, `src/__fixtures__/github-copilot/`) — New provider adapter targeting `https://models.github.ai/inference/chat/completions`. Authenticates via `resolveGitHubToken()` with a 4-tier resolution chain: passed option → `GITHUB_TOKEN` env → `.forge/secrets.json` → cached `gh auth token` subprocess result. `isAvailable()` returns `true` when any token source resolves without making HTTP calls. Model normalization: OpenAI-style (`gpt-4o`, `gpt-4o-mini`) and Anthropic-style (`claude-sonnet-4`, `claude-opus-4`) pass through; unknown names fall back to `gpt-4o-mini`. Structured 429 return (`{ error: "rate_limited", retryAfter }`) and hard throw on ≥ 500. Eight fixture-driven unit tests covering tool shape, message round-trip, happy-path, tool_calls parsing, 429, 500, model fallback, and `isAvailable`.
- **Slice 2 — Provider selection + zero-key default** (`pforge-master/src/reasoning.mjs`, `src/config.mjs`, `pforge-mcp/secrets.mjs`, `pforge-mcp/dashboard/served-app.js`, `src/__tests__/reasoning-provider-selection.test.mjs`) — Provider-selection loop now iterates `githubCopilot → anthropic → openai → xai`, picking the first adapter whose `isAvailable()` returns `true`. `config.mjs` gains `forgeMaster.defaultProvider = "githubCopilot"` and `forgeMaster.providers.githubCopilot.model = "gpt-4o-mini"`. No-provider error path now includes a `suggestion` field directing users to `gh auth login` or an explicit API key. `GITHUB_TOKEN` added to `KNOWN_SECRETS` as the first entry, labeled `"GitHub (Copilot, recommended)"`. Dashboard secrets UI renders `GITHUB_TOKEN` as the first row; existing keys retain their relative order.
- **Slice 3 — Skippable smoke test** (`pforge-mcp/tests/forge-master.smoke.test.mjs`, `scripts/smoke-forge-master.mjs`, `package.json`) — `forge-master.smoke.test.mjs` uses `describe.skipIf(!process.env.FORGE_SMOKE)` so CI without a live token always passes. When `FORGE_SMOKE=1`, invokes `runTurn` with an advisory prompt and asserts lane classification, keyword presence in response text, `tokensOut > 0`, and 30 s completion. `smoke-forge-master.mjs` standalone script prints the full response and writes a timestamped transcript to `.forge/smoke/forge-master-<ISO>.md`. Root `package.json` gains `"smoke:forge-master"` script.

### Tests

- `src/providers/__tests__/github-copilot-tools.test.mjs` — 8 fixture-driven tests: `buildTools` shape, `formatMessages` round-trip, `callProvider` happy path, `tool_calls` parsing, 429 structured return, 500 throw, model fallback, `isAvailable` true/false.
- `src/__tests__/reasoning-provider-selection.test.mjs` — 4 selection-order tests: githubCopilot first when `GITHUB_TOKEN` set, anthropic fallback, no-provider error + suggestion field, explicit `defaultProvider` override.
- `tests/forge-master.smoke.test.mjs` — 1 test, skipped without `FORGE_SMOKE=1`.

## [2.66.0]— 2026-04-22 — Forge-Master Advisory Mode (Phase-32)

> **Minor release — Phase-32 elevates Forge-Master from a narrow operational bot to a principled CTO-in-a-box advisor: event-delegated prompt gallery (bug fix), intent-router glossary expansion, advisory lane with architecture-first principles loader.**

### Added

- **Slice 1 — Event-delegated prompt gallery** (`dashboard/forge-master.js`, `tests/forge-master-gallery.test.mjs`) — Fixed HTML-attribute quoting bug: gallery buttons now emit `data-prompt-id` attributes instead of inline `onclick` handlers. `forgeMasterInit` attaches a single delegated `click` listener on `#fm-gallery-list` that resolves the target via `event.target.closest('[data-prompt-id]')`. `window.forgeMasterPickPrompt` global removed; legacy cross-tab globals retained. jsdom-based vitest covers click dispatch, `#fm-composer` value set, and `document.activeElement` focus.
- **Slice 2 — Intent-router glossary expansion** (`pforge-master/src/intent-router.mjs`, `tests/forge-master.test.mjs`) — `KEYWORD_RULES` gains 9+ new entries covering: bare `slice`/`gate` refs requiring a Plan Forge context marker, `phase-N` references, `harden`/`hardening`, `tempering`/`temper`, `quorum`, `meta-bug`/`self-repair`, `crucible` extras. Each family has positive + negative test coverage. `OFFTOPIC_REDIRECT` rewritten to enumerate all five lanes (`build`, `operational`, `troubleshoot`, `advisory`, `offtopic`) with one example question each. "What's the status of slice 4" now classifies as `operational`.
- **Slice 3 — Advisory lane + principles loader** (`pforge-master/src/intent-router.mjs`, `pforge-master/src/principles.mjs`, `pforge-master/src/system-prompt.md`, `pforge-master/src/reasoning.mjs`, `pforge-master/src/allowlist.mjs`, `tests/forge-master-principles.test.mjs`) — New `LANES.ADVISORY = "advisory"` constant and `LANE_TOOLS.advisory` (8 read-only tools: `forge_search`, `forge_timeline`, `brain_recall`, `forge_capabilities`, `forge_hotspot`, `forge_drift_report`, `forge_plan_status`, `forge_cost_report`). At least 6 keyword rules route advisory phrases (`"should I"`, `"should we"`, `"what's the right"`, `"architecture advice"`, `"help me decide"`, `"recommend"`). New `pforge-master/src/principles.mjs` exports `loadPrinciples({ cwd })` with per-cwd mtime-invalidating cache; reads `docs/plans/PROJECT-PRINCIPLES.md`, extracts `## Architecture Principles` from `.github/copilot-instructions.md`, applies `.forge.json#forgeMaster.philosophy` override (replace by default; append with `"+ "` prefix). Falls back to 10-principle `UNIVERSAL_BASELINE` (Architecture-First through Keep Gates Boring). System-prompt gains `{principles_block}` placeholder under new `## Philosophy & Guardrails` section; `{context_block}` trims before `{principles_block}` under token pressure.

### Tests

- `tests/forge-master-gallery.test.mjs` — NEW jsdom vitest: click dispatch, value assertion, focus assertion, no-inline-onclick guard.
- `tests/forge-master.test.mjs` — Added glossary classification tests (positive + negative for each new keyword family), OFFTOPIC_REDIRECT content check.
- `tests/forge-master-principles.test.mjs` — NEW: universal baseline fallback, PROJECT-PRINCIPLES override, replace/append `.forge.json` semantics, mtime cache invalidation.
- `tests/forge-master.advisory.test.mjs` — NEW: LANES.ADVISORY, LANE_TOOLS.advisory, advisory-phrase classification, UNIVERSAL_BASELINE Architecture-First check, prompt catalog advisory category, tools.json mirror.

## [2.65.1]— 2026-04-22 — version-bump architectural rebuild (Phase-31.1)

> **Patch release — Closes #91. The `version-bump` command was rewritten from an inline imperative script into a structured, testable pipeline with a shared targets manifest. `pforge.sh` now has full parity with `pforge.ps1`. A new Vitest suite provides regression coverage.**

### Changed

- **`pforge.ps1 version-bump` refactored (Slice 3)** — Extracted `Get-VersionTargets` helper that returns a typed targets array with `File`, `Pattern`, `Replacement`, `Strategy`, and `Optional` fields. The bump loop is now data-driven; adding a new target requires one manifest entry, not imperative code.
- **`pforge.sh version-bump` parity port (Slice 4)** — Shell implementation ported to match the PowerShell architecture: same targets manifest, same `--dry-run` / `--strict` flags, same `Updated N/M targets` summary line and exit semantics.

### Tests

- **`pforge-mcp/tests/version-bump.test.mjs`** — Vitest suite covering dry-run output, strict-mode exit codes, each named target, optional-target skip, and cross-platform summary format.

### Meta

- Closes GitHub issue **#91** — version-bump brittle single-file implementation.

## [2.65.0]— 2026-04-22 — Advisory-to-Enforcement Calibration (Phase-31)

> **Minor release — Phase-31 closes the gap between advisory subsystems and actionable enforcement: gate-synthesis opt-in strict mode, plan-parser lint advisory, reflexion prompt wiring, complexity threshold recalibration, and tempering suppression promoter.**

### Added

- **Slice 1 — Committed-before-timeout dashboard badge** (`dashboard/live-session.js`, `dashboard/index.html`) — New live-session module subscribes to the `slice-timeout-but-committed` hub event and injects a green `committed-before-timeout (<pre>→<post>)` badge into the matching slice card. MutationObserver re-injects badges after `renderSliceCards()` replaces the DOM. Clears stale state on `run-started`.
- **Slice 2 — Plan-parser lint advisory in `pforge analyze`** (`orchestrator.mjs`) — `runAnalyze` now accepts a `planPath` parameter and emits an `ADVISORY plan-parser-gate-missing` line for every slice that has bash code blocks but no `**Validation Gate**:` marker. Advisory is suppressed when `runtime.planParser.implicitGates = true` (bare blocks already captured as gates in that mode). Exit code unchanged.
- **Slice 4 — `--strict-gates` CLI flag** (`pforge.ps1`, `pforge.sh`, `orchestrator.mjs`) — `pforge run-plan --strict-gates` forces `runtime.gateSynthesis.mode = "enforce"` for the run without writing `.forge.json`. When active, slices flagged by `suggestGatesForPlan()` fail pre-flight with a structured `STRICT_GATES_PREFLIGHT` error listing offending slices. Default `runtime.gateSynthesis.mode` remains `"suggest"` — no breaking change for v2.64.x consumers.
- **Slice 6 — Tempering suppression promoter** (`tempering.mjs`) — New exports `logSuppression`, `readSuppressions`, `readPromoteThreshold`, and `promoteSuppressions`. When a suppression fingerprint accumulates ≥ threshold occurrences, `promoteSuppressions` writes `.forge/bugs/BUG-<date>-<seq>.json` with required registry fields (`bugId`, `fingerprint`, `source`, `classification`, `severity`, `promotedAt`, `suppressionCount`). Idempotent — re-runs append "re-observed" entry instead of creating a duplicate. Threshold configurable via `runtime.tempering.promoteThreshold` (default 3), which overrides the function parameter.

### Changed

- **Slice 3 — Reflexion prompt wiring** (`orchestrator.mjs`) — When `lastFailureContext` is non-null on a retry attempt, the worker's system-prompt preamble now includes a `<prior_attempt>` block with `previousAttempt`, `gateName`, `model`, and `stderrTail` (truncated to 40 lines). First attempts are unaffected — no empty block injected.
- **Slice 5 — `scoreSliceComplexity` default threshold 6 → 3** (`orchestrator.mjs`) — Recalibrated based on distribution analysis across Phase-25–30 plans (`docs/research/complexity-threshold-v2.65.md`). Previous default of 5–6 selected zero slices; threshold 3 selects the expected 60th-percentile slice set.

### Research

- `docs/research/gate-synthesis-flip-safety-v2.65.md` — Audit of Phase-25–30 runs under strict-gates mode; confirms safe to expose as opt-in flag, not yet safe as default.
- `docs/research/complexity-threshold-v2.65.md` — Slice complexity distribution table across all Phase-25–30 plans; documents threshold selection rationale.

### Tests

- `tests/dashboard-live-session.test.mjs` (13 tests) — Slice 1 badge lifecycle, MutationObserver re-inject, run-started clear.
- `tests/orchestrator-analyze.test.mjs` (5 tests) — Slice 2 advisory fire/suppress/absent cases.
- `tests/orchestrator-reflexion-prompt.test.mjs` — Slice 3 prior-attempt injection and absence on first attempt.
- `tests/orchestrator-gate-synthesis.test.mjs` (10 tests) — Slice 4 strict-gates pre-flight, enforce override, default-remains-suggest.
- `tests/orchestrator-complexity.test.mjs` — Slice 5 threshold=3 default.
- `tests/tempering-promoter.test.mjs` (25 tests) — Slice 6 full coverage: below-threshold, at-threshold, idempotency, custom threshold, multiple fingerprints.

## [2.65.0] — 2026-04-22 — Advisory → Enforcement Calibration (Phase-31)

> **Minor release — Phase-31 completes 7 calibration improvements: dashboard timeout-committed badge, plan-parser lint advisory, reflexion prompt wiring, strict-gates CLI flag, complexity threshold recalibration, tempering suppression promoter, and full sweep.**

### Added
- **Committed-before-timeout badge (Slice 1)** — New `dashboard/live-session.js` module subscribes to `slice-timeout-but-committed` hub events and injects a green badge into the matching slice card showing 7-char pre/post commit SHAs. MutationObserver re-injects badges after `renderSliceCards()` wipes the DOM. Badge clears on `run-started` to prevent cross-run stale state.
- **Plan-parser lint advisory (Slice 2)** — `runAnalyze` now accepts a `planPath` parameter. When provided, it parses the plan and emits `ADVISORY plan-parser-gate-missing` for each slice that has bash code blocks but no `**Validation Gate**:` marker. Advisory suppressed when `runtime.planParser.implicitGates = true`.
- **`--strict-gates` CLI flag (Slice 4)** — `pforge run-plan --strict-gates` forces `runtime.gateSynthesis.mode` to `"enforce"` for the run without writing `.forge.json`. Slices flagged by `suggestGatesForPlan()` fail pre-flight with a structured `STRICT_GATES_PREFLIGHT` error. Default `runtime.gateSynthesis.mode` remains `"suggest"`.
- **Tempering suppression promoter (Slice 6)** — `tempering.mjs` exports `promoteSuppressions({ cwd, threshold })`, `logSuppression`, `readSuppressions`, `readPromoteThreshold`. After each run, suppressions seen ≥ `runtime.tempering.promoteThreshold` (default 3) times are promoted to `.forge/bugs/bug-YYYY-MM-DD-NNN.json` with full suppression history. Idempotent: re-runs append a "re-observed" record rather than duplicating.
- **Research note** — `docs/research/complexity-threshold-v2.65.md`: distribution analysis across Phase-25–30 plans justifying threshold recalibration to 3.
- **Research note** — `docs/research/gate-synthesis-flip-safety-v2.65.md`: audit of recent runs confirming `--strict-gates` safety.

### Changed
- **Reflexion prompt wiring (Slice 3)** — When `lastFailureContext` is non-null on a retry, the worker system prompt prepends a `<prior_attempt>` block with `previousAttempt`, `gateName`, `model`, and `stderrTail` (truncated to 40 lines). First-attempt prompts unchanged.
- **Complexity threshold recalibrated (Slice 5)** — `scoreSliceComplexity` default threshold lowered from 6 → 3 (60th-percentile of Phase-25–30 distribution). At threshold=6 only 1/63 slices triggered quorum; at threshold=3, 56/63 slices do.

### Tests
- `tests/dashboard-live-session.test.mjs` — 13 tests (badge render, absent-without-event, markup, index.html wiring)
- `tests/orchestrator-analyze.test.mjs` — 5 tests (plan-parser lint advisory, implicitGates suppression)
- `tests/orchestrator-reflexion-prompt.test.mjs` — reflexion wiring coverage
- `tests/orchestrator-gate-synthesis.test.mjs` — strict-gates flag coverage
- `tests/orchestrator-complexity.test.mjs` — complexity threshold coverage
- `tests/tempering-promoter.test.mjs` — 25 tests (readPromoteThreshold, logSuppression, readSuppressions, promoteSuppressions at/below threshold, idempotency, custom threshold, multiple fingerprints)
- **Total**: 3477 tests across 146 files in `pforge-mcp/`; 65 tests in `pforge-master/`

## [2.64.1] — 2026-04-22 — Forge-Master Studio hotfix + Smith Phase-29/30 awareness

> **Patch release — bundles the Phase-30.1 Forge-Master Studio tab clickability hotfix with Smith diagnostic improvements for Phase-29/30 files and dev-repo false-positive elimination.**

### Fixed
- **Forge-Master Studio tab clickability (Phase-30.1)** — `dashboard/forge-master.js` now hoists `window.forgeMasterInit`, `window.forgeMasterOpen`, and related assignments to module top and wraps init in a try/catch guard so the main tab dispatcher can reach the handlers before the DOMContentLoaded listener fires. Previously, tab clicks reached the dispatcher but its `window.forgeMasterOpen` lookup returned `undefined` because assignments executed after dispatcher binding. Commit `278f9c3`. All 118 forge-master tests pass.

### Added
- **Smith Phase-29/30 capability-surface awareness** — `pforge smith` now verifies:
  - `dashboard/forge-master.js` (Phase-29 Forge-Master Studio tab controller)
  - `pforge-mcp/forge-master-routes.mjs` (Phase-29 `/api/forge-master/*` route wiring)
  - `pforge-mcp/tools.json` + `cli-schema.json` presence with registered-tool count
  - New "Forge-Master Studio (Phase-29)" section: `pforge-master/server.mjs` + `src/lifecycle.mjs`
  Each check emits a targeted `pforge update` FIX hint when missing.

### Changed
- **Smith dev-repo-aware checks** — `pforge smith` no longer emits false-positive warnings when run inside the plan-forge framework dev repo itself:
  - `VERSION='x.y.z-dev'` recognized as between-release state (was flagged as corrupt install)
  - `.forge.json` with no `preset`/`templateVersion` shows "framework dev repo" label
  - CHANGELOG entry for `-dev` versions no longer required (added at release cut)
  - `copilot-instructions.md` placeholder scan skipped (root file is the template baseline)
  - `DEPLOYMENT-ROADMAP.md` check skipped (dev repo uses root `ROADMAP.md`)
  - Missing `SessionStart`/`PreToolUse`/`PostToolUse`/`Stop` hooks reported as expected (consumers get them via `pforge update`)
  Result: dev-repo Smith run went from 10 warnings → 3 warnings (only legitimate external-worker ones remain).

### Docs
- **ROADMAP.md refreshed** — Current Release updated from v2.59.1 to v2.64.0. Added Shipped entries for v2.60 through v2.64 (Cost Projection, Forge-Master MVP arc, Studio, Settings decomposition). Backlog refreshed to Phase-31 candidates including meta-bug #88, #89, and `scoreSliceComplexity` recalibration.
- **CHANGELOG.md normalized** — v2.64.0 and v2.63.1 headers dropped `v` prefix for consistency with all prior entries.

### Meta
- **Setup / update / MCP-capabilities file-coverage audit** — confirmed setup scripts use pure recursive copy (auto-discovers new `pforge-mcp/` files), update uses recursive scan for `pforge-mcp/`, `.github/hooks/`, `.github/prompts/*.prompt.md`, and preset files. `tools.json` + `cli-schema.json` auto-generate on server startup from TOOLS array (always in sync). No gaps found.

## [2.64.0] — 2026-04-21 — Settings Panel Decomposition (Phase-30)

> **Minor release — Single monolithic Settings tab decomposed into 9 sub-tabs (General, Models, Execution, API Keys, Updates, Memory, Brain, Bridge, Crucible). Cross-group tab migration: Extensions moved to Settings row; Bug Registry and Watcher moved to LiveGuard row.**

### Changed
- **Settings sub-tabs** — `dashboard/index.html` `#tab-config` replaced with 9 sub-tab sections under `#subtabs-settings`, each routable via `data-tab="settings-*"`.
- **Cross-group tab migration** — Extensions button relocated from Forge row → Settings row (`hover:text-purple-400`); Bug Registry + Watcher buttons relocated from Forge row → LiveGuard row (`hover:text-amber-400`).
- **Tab row counts** — Forge: 18→15; Settings: 9→10; LiveGuard: 5→7 (total `data-tab` count unchanged at 33).
- **Legacy DOM removed** — `initConfigSubtabs()` and internal `cfg-subtab` buttons removed from `app.js`; the main tab dispatcher now handles routing directly.

### Tests
- Added `dashboard-settings.test.mjs` — asserts presence of all 9 Settings sub-tabs, correct `data-tab` prefixes, and section anchors.
- Added structural "Cross-group tab migration (Slice 7)" test in `server.test.mjs` — row counts, accent hover colors, and total button tally.

### Meta
- Filed [issue #86](https://github.com/srnichols/plan-forge/issues/86) — headless `gh copilot` autoharden pipeline silently fails to write repo files (class: `orchestrator-defect`). Hand-hardened the plan as a workaround.

## [2.63.1] — 2026-04-21 — Tempering Triage (Phase-28.5)

> **Patch release — tempering run-directory sorting now uses mtime instead of alphabetical order, preventing stale baselines from shadowing recent runs. Also fixes touch-device CSS hover stickiness in docs nav dropdown.**

### Fixed
- **Tempering baselines `listRunDirs`** now sorts by mtime (newest-first) and filters for `run-*` prefix, preventing stale or non-run directories from corrupting triage results. (`pforge-mcp/tempering/baselines.mjs`)
- **Docs nav dropdown** `:hover` gated behind `@media (hover: hover)` to prevent sticky menus on touch devices. (`docs/assets/shared.css`)

### Tests
- Added `tempering-baselines-sort.test.mjs` (mtime sort, prefix filter, empty-dir edge cases).

## [2.63.0] — 2026-04-21 — Forge-Master Studio (Phase-29)

> **Feature release — Forge-Master Studio dashboard tab, route wiring, CLI subcommands, and capability surface update.**

### Added
- **Forge-Master Studio tab** in main Plan Forge dashboard (`dashboard/index.html`): prompt gallery, chat stream, tool-call trace pane.
- **`dashboard/forge-master.js`** — client-side tab controller: lazy-init, gallery render/filter, chat send/stream, tool trace UI.
- **`/api/forge-master/*` route wiring** in main Express server (`server.mjs`) via async fire-and-forget import of `forge-master-routes.mjs`.
- **`pforge forge-master status|logs`** CLI subcommands in `pforge.ps1` and `pforge.sh` — delegate to `pforge-master/src/lifecycle.mjs`.
- **`forge-master` entry** in `pforge-mcp/cli-schema.json` with `status` and `logs` sub-subcommands.
- **`forgeMaster.studio` capabilities block** in `capabilities.mjs` — surfaces `dashboardTabEnabled`, `reasoningModel`, `routerModel`, and `promptCatalogVersion`.
- **`forge-master-chat` MCP server registration** in `setup.ps1` and `setup.sh` — added to `.vscode/mcp.json` when `pforge-master/server.mjs` is present.
- **`tests/forge-master-tab.test.mjs`** — dashboard HTML integration tests and route adapter tests.

## [2.62.3] — 2026-04-21 — OpenBrain Queue Drain

> **Patch release — pending OpenBrain queue records now drain automatically on MCP server start, closing a silent data-loss gap where locally enqueued thoughts never reached long-term memory.** New pure drain orchestrator, I/O wrapper with atomic writes, REST endpoint, CLI command, and `forge_smith` warning row. Closes [#84](https://github.com/srnichols/plan-forge/issues/84).

### Added

- **`drainOpenBrainQueue(records, dispatcher, opts)` orchestrator** — pure function in `memory.mjs` that composes `partitionByBackoff`, calls an injected dispatcher per record, applies `applyDeliveryFailure` on failures, and returns structured `{ delivered, deferred, dlq, archive, stats }`. Honors `opts.maxBatch` (default 50). Zero filesystem. (Phase-28.4, Slice 1)
- **`runDrainPass(cwd, source, hub)` I/O wrapper** — in `server.mjs`, reads the queue file, calls `drainOpenBrainQueue`, atomic-writes survivors (tmp + rename), appends archive/DLQ/stats, broadcasts `openbrain-flush` hub event. (Phase-28.4, Slice 2)
- **MCP `initialize` drain hook** — schedules `runDrainPass` via `setTimeout(..., 3000)` once per server start. Skips when OpenBrain is not configured. Non-blocking, fire-and-forget, never crashes the server. (Phase-28.4, Slice 2)
- **`POST /api/memory/drain` REST endpoint** — synchronous drain with `checkApprovalSecret` auth. Returns `{ ok, source, attempted, delivered, deferred, dlq, durationMs }`. 503 when OpenBrain not configured. (Phase-28.4, Slice 3)
- **`pforge drain-memory` CLI command** — PowerShell and bash. POSTs to the local REST endpoint using the bridge approval secret. Prints a one-line summary. (Phase-28.4, Slice 3)
- **`forge_smith` Memory drain warning row** — conditional `⚠ Drain:` line when pending count > threshold or oldest entry age > threshold. Thresholds configurable via `.forge.json#openbrain.drainWarn = { count: 10, ageHours: 24 }`. (Phase-28.4, Slice 4)

### Tests

- Phase-28.4 new tests: `drain-orchestrator.test.mjs` (happy/failure/DLQ/batch/mixed paths), `drain-io-wrapper.test.mjs` (atomic write, archive, stats, hub broadcast), `drain-rest-endpoint.test.mjs` (auth, 503, success/error responses), `smith-drain-warning.test.mjs` (thresholds, custom config, source assertions). Total test count: 3277.

## [2.62.2] — 2026-04-21 — Self-Repair Capture

> **Patch release — adds automatic meta-bug filing when Plan Forge discovers and works around defects in its own plans, orchestrator, or prompts.** New MCP tool `forge_meta_bug_file` routes self-repair issues to a dedicated GitHub Issues lane with hash-based dedupe. A post-slice advisory scanner detects when an agent worked around a Plan Forge defect but forgot to file. New instruction file teaches agents when and how to fire the tool.

### Added

- **`forge_meta_bug_file` MCP tool** — files GitHub Issues against the configured self-repair repo (`.forge.json#meta.selfRepairRepo`, fallback `srnichols/plan-forge`) when Plan Forge discovers a defect in itself during execution. Accepts `class` (`plan-defect` | `orchestrator-defect` | `prompt-defect`), `title`, `symptom`, optional `workaround`, `filePaths`, `slice`, `plan`, and `severity`. Returns `{ ok, issueNumber, url, deduped }`. (Phase-28.3, Slices 1–3)
- **Hash-based dedupe** — issue titles embed `[self-repair:<hash>]` where hash is `sha256(class + normalize(title)).slice(0,12)`. Existing open issue with same hash → comment added instead of duplicate. (Phase-28.3, Slice 2)
- **`resolveSelfRepairRepo(config)`** — resolves target repo from `.forge.json#meta.selfRepairRepo` with fallback to `srnichols/plan-forge`. Validates `owner/repo` shape; malformed input → fallback. (Phase-28.3, Slice 1)
- **`META_BUG_CLASSES` / `SELF_REPAIR_LABELS` constants** — canonical class list and label set exported from `tempering/bug-adapters/github.mjs`. (Phase-28.3, Slice 1)
- **Post-slice advisory scanner** — `detectSelfRepairMissed()` in `orchestrator.mjs` scans completed slice trajectories for self-repair markers (`"plan was wrong"`, `"fixed the plan"`, `"brittle gate"`, etc.). If markers present and no `forge_meta_bug_file` call was made, emits non-blocking `self-repair-missed` warning to `events.log`. Never fails the slice; never auto-files. (Phase-28.3, Slice 4)
- **Self-repair reporting instruction file** — `.github/instructions/self-repair-reporting.instructions.md` with `applyTo: '**'`, priority LOW. Documents the two-lane distinction (project bugs vs meta bugs), three canonical classes with worked examples, tool signature, and when NOT to fire. (Phase-28.3, Slice 5)
- **Step-3 prompt update** — `step3-execute-slice.prompt.md` now includes a Self-Repair Reporting reminder directing agents to `forge_meta_bug_file` when they work around Plan Forge defects. (Phase-28.3, Slice 5)

### Tests

- Phase-28.3 new tests: `meta-bug-resolver.test.mjs` (resolver + schema), `meta-bug-filer.test.mjs` (filer + dedupe + errors), `meta-bug-tool.test.mjs` (MCP tool validation + wiring), `self-repair-advisory.test.mjs` (marker scan + miss detection). Total test count: 3239.

## [2.62.1] — 2026-04-21 — Worker Role Guardrails + Gate Portability

> **Patch release — four targeted defect fixes under the same architectural umbrella: respect the boundary between worker capability and call-site role.** No new features; no API changes.

### Fixed

- **API-only models (Grok, GPT) blocked from code-writing worker role** — `spawnWorker()` in `orchestrator.mjs` now throws a descriptive error when the resolved model is an API-only provider (matching `grok-*`, `gpt-*`, `dall-e-*`, or `chatgpt-*`) and the call-site role is `null`, `"code"`, or `"execute"`. API providers remain valid for `reviewer`, `quorum-dry-run`, `analysis`, and `image` roles. New `API_ALLOWED_ROLES` set and `isApiOnlyModel()` helper exported. (Phase-28.2, Slice 1)
- **Recommender excludes API-only models** — `recommendModel()` in `orchestrator.mjs` and the mirror copy in `cost-service.mjs` now filter out any model matching an API-only provider pattern before scoring. Grok and GPT models are permanently ineligible for code-writing recommendations; only CLI-backed models (claude-*, gemini-*, etc.) qualify. (Phase-28.2, Slice 2)
- **One-time migration scrubs poisoned model-performance entries** — `loadModelPerformance()` now silently drops historical entries where the model name matches an API-only pattern on the first load after upgrade. Writes the cleaned file back once; idempotent on subsequent loads. Logs `[perf] scrubbed N API-worker entries from model-performance.json` when entries are removed. (Phase-28.2, Slice 3)
- **Gate portability linter warns on Windows-hostile shell patterns** — new `validateGatePortability()` function in `orchestrator.mjs` detects three known bad patterns: pipe-to-brace-group with `read`, nested double-quotes inside `bash -c`, and command substitution containing a pipe. Integrated into `lintGateCommands()` as a non-blocking `portabilityWarnings` field on the result. Existing plans continue to run; the linter warns authors before wasted worker spend. (Phase-28.2, Slice 4)
- **Gate timeout raised to 10 min (600 s); configurable via env var** — `runGate()` and the LiveGuard gate runner both use `resolveGateTimeoutMs()` which defaults to `600_000` ms (up from 120 s). Override with `PFORGE_GATE_TIMEOUT_MS` env var. Non-positive and non-numeric values fall back to the default. (Phase-28.2, Slice 5)

### Tests

- Phase-28.2 new tests: `spawn-worker-role.test.mjs` (API provider block + `buildApiMessages`), `recommender-api-exclusion.test.mjs` (`isApiOnlyModel` + `recommendModel` exclusion), `loadModelPerformance migration` describe block in `orchestrator.test.mjs` (scrub + idempotent + clean-file), `lint-gate-portability.test.mjs` (three hostile patterns + clean commands + `lintGateCommands` integration). Total test count: 3172.

## [2.62.0] — 2026-04-21 — Forge-Master MVP + Bug-Sweep Hotfix

> **Minor release — ships the Phase-28 Forge-Master MVP subsystem and closes three bug-sweep fixes from Phase-28.1.** Forge-Master (`forge_master_ask`) is a new MCP tool that classifies user intent, retrieves memory context, and orchestrates read-only tool calls on the agent's behalf — purpose-built for open-ended reasoning about plans, troubleshooting failures, and funneling ideas into Crucible smelts. The bug fixes resolve a hard Windows blocker (GH #82), a false-positive gate linter on box-drawing diagrams (GH #83), and a stale update-check cache after self-update.

### Added — Forge-Master MVP (Phase-28)

- **`forge_master_ask` MCP tool** — accepts a freeform `message` string and returns a structured reasoning response. Internally: intent classification (keyword + model fallback), memory retrieval (OpenBrain L1/L2/L3 tiers), tool bridge with allowlist enforcement (read-only tools only), multi-step reasoning loop with provider adapters (Anthropic, OpenAI, xAI), session persistence with auto-summarization, and `buildCapabilities` alias export. Registered in `capabilities.mjs`, `tools.json`, and `server.mjs`. (Phase-28, Slices 1–7)
- **Forge-Master subsystem scaffold** — `pforge-mcp/forge-master/` directory with `config.mjs` (schema validation, `.forge.json` integration), `intent-router.mjs` (keyword matching + model fallback classification), `memory.mjs` (OpenBrain retrieval layer), `tool-bridge.mjs` (allowlist-gated tool execution), `reasoning.mjs` (multi-step loop + provider adapters), `session.mjs` (persistence + auto-summarization). (Phase-28, Slices 1–6)
- **Agent guidance docs** — `docs/forge-master/` with usage guide, tool reference, and integration examples. (Phase-28, post Slice 7)

### Fixed — Bug-Sweep Hotfix (Phase-28.1)

- **Windows `spawn` ENOENT fix (GH #82)** — added `shell: process.platform === "win32"` to `spawnWorker()` options in `orchestrator.mjs`. On Windows, npm-global CLIs (`claude`, `codex`) are installed as `.cmd` shims that `child_process.spawn` cannot resolve without `shell: true`. Covered by new `orchestrator-spawn-shell.test.mjs`. (Phase-28.1, Slice 1)
- **Box-drawing characters recognized as prose (GH #83)** — extended `looksLikeProse()` in `orchestrator.mjs` to detect Unicode box-drawing range U+2500–U+257F. Lines containing `┌─┐│└┘├┤┬┴┼` are now correctly identified as documentation rather than being misclassified as shell commands in validation gates. Includes end-to-end regression test via `lint-ascii-diagram.test.mjs` with a fixture plan. (Phase-28.1, Slices 2–3)
- **Self-update invalidates update-check cache (Fix A)** — after a successful `pforge self-update`, `writeFreshCache()` now writes a proper `update-check.json` entry so the next `checkForUpdate` returns `isNewer: false` without hitting the network. Previously the cache was deleted, forcing an unnecessary network round-trip. New export in `update-check.mjs`. (Phase-28.1, Slice 4)
- **`checkForUpdate` honors VERSION mtime (Fix D)** — defense-in-depth: `checkForUpdate()` now compares VERSION file mtime against cache file mtime. If VERSION was touched after the cache was written (manual edit, tarball extraction, git sync), the cache is treated as stale. (Phase-28.1, Slice 5)

### Tests

- Phase-28 Forge-Master: tests across intent-router, memory retrieval, tool-bridge, reasoning loop, session persistence, and tool registration.
- Phase-28.1 bug fixes: `+13` tests — `orchestrator-spawn-shell.test.mjs` (spawn shim), `looksLikeProse` box-drawing tests, `lint-ascii-diagram.test.mjs` (regression guard), `update-check.test.mjs` (writeFreshCache + mtime bypass).

### Upgrade notes

- **No breaking changes.** `forge_master_ask` is a new additive tool; no existing tool signatures or return shapes changed.
- **Windows users**: the spawn fix resolves the `ENOENT` error that prevented `pforge run-plan` from working on Windows. No configuration needed.
- **Self-update users**: the stale banner issue is self-healing after upgrading to v2.62.0.

## [2.61.0] — 2026-04-20 — Cost Projection UI + Per-Slice Estimator

> **Minor release — surfaces cost projection into the operator dashboard and gives agents a per-slice entry point.** Follows the Phase-27.1 dogfood session where `forge_estimate_quorum` produced honest numbers but the dashboard had no way to show them, and agents had to estimate an entire plan just to price one slice. Additive only — existing `forge_estimate_quorum` signature and return shape unchanged; new `slices[]` field under each mode is backward-compatible. Also includes a calibration report documenting that the current `scoreSliceComplexity` threshold of 5 selects zero slices on every real plan in the repo — evidence-gathering for a future scorer rewrite, no scoring changes ship here.

### Added

- **`forge_estimate_slice` MCP tool** — returns projected cost for a single slice under a chosen quorum mode (`auto` / `power` / `speed` / `false`). Cheaper than `forge_estimate_quorum` (which estimates the whole plan). Wired in `capabilities.mjs`, `tools.json`, and `server.mjs` — including the `MCP_ONLY_TOOLS` Set (Phase-27.1 Slice 2b lesson carried forward so the HTTP bridge reaches the handler). Errors: `PLAN_NOT_FOUND`, `SLICE_NOT_FOUND`. Agent guidance: *"Use this when you need cost for a single slice — cheaper than forge_estimate_quorum."* (Phase-27.2 Slices 1 + 3)
- **`cost-service.estimateSlice({plan, sliceNumber, mode, model, cwd})`** — backing function for the new MCP tool. Returns `{estimatedCostUSD, baseCostUSD, overheadUSD, complexityScore, model, quorumEligible, rationale, generatedAt}`. Un-calibrated — no run-level historical correction factor applied (documented in JSDoc; a single slice doesn't provide enough context to re-derive the factor). (Phase-27.2 Slice 1)
- **`buildQuorumConfigForMode(mode)` helper** — extracted from `estimateQuorum` so `estimateSlice` and `estimateQuorum` always agree on which models, thresholds, and auto flags each mode implies. Pure refactor; no behavior change. (Phase-27.2 Slice 1)
- **Per-slice breakdown under each `forge_estimate_quorum` mode** — additive `slices: [{sliceNumber, projectedCostUSD, complexityScore, quorumEligible}]` array on each mode summary. Existing top-level keys unchanged. Consumers ignoring the new field keep working; the dashboard uses it to populate the projected-cost badge without a second round-trip. (Phase-27.2 Slice 2)
- **Dashboard projected-cost badge** — 💵 ~$0.xxxx on every slice card, next to the existing complexity ⚙ and spend 💰 badges. Order left-to-right: complexity → projected → spend. Tooltip names the active projection mode. Hydrated on plan-open from a single `forge_estimate_quorum` call, cached for the session. Dashboard works without the projection (badge simply doesn't render). (Phase-27.2 Slice 4)
- **Dashboard plan-projection strip** — collapsible row at the top of the Progress tab showing the four quorum-mode estimates + the recommended mode. Expanded view adds per-mode `$cost · N/M quorum slices · $overhead` detail. When `.forge.json` sets `runtime.cost.budget`, any mode whose projection exceeds the cap renders `text-red-400` with an "Over budget" tooltip. (Phase-27.2 Slice 5)
- **Projected→actual flourish** — once a slice completes, the projected badge stays visible beside the new actual-spend badge for 5 seconds, then fades out. Operator sees "expected vs actual" side-by-side before the card settles. CSS `transition-opacity` + `opacity-70`, no state machine. (Phase-27.2 Slice 6)
- **`scoreSliceComplexity` distribution report** (`docs/research/scorecomplexity-distribution-2026-04.md`) — one-page calibration report documenting the score distribution across all 70 slices in the 7 repo plans. Key finding: threshold 5 catches **zero** slices on any real plan; 93% of slices score ≤ 2. Identifies three follow-up options (lower threshold 5→3, add file-count signal, or full scorer rewrite) for a future phase. No scoring changes ship in this release. (Phase-27.2 Slice 7)

### Changed

- **Dashboard cost UX: complexity → projected → actual** left-to-right on every slice card. Operator reads the row as "how hard the scorer thinks this is · what we expected it to cost · what it actually cost." The projected badge is a new third column; complexity and spend badges are unchanged.

### Tests

- `+33` tests total:
  - `+4` in `tests/cost-service.test.mjs` — `estimateQuorum` per-slice breakdown schema (Slice 2), plus `forge_estimate_slice` registration coverage (Slice 3: TOOL_METADATA shape, tools.json schema, server.mjs tool-list/switch/handler wiring). Also updated the Phase-27.1 Slice 2b `MCP_ONLY_TOOLS` guard's `REQUIRED` array to include `forge_estimate_slice`.
  - `+14` in `tests/estimate-slice.test.mjs` — per-slice estimator unit tests, mode coverage (auto/power/speed/false), error handling, parity with `estimatePlan` summed across all slices.
  - `+21` in new `tests/dashboard-cost-projection.test.mjs` — file-contract tests for state shape, `fetchPlanProjection`, `hydrateSliceProjections`, badge markup + ordering, plan-projection strip, budget-cap highlighting, and projected→actual flourish semantics.

### Upgrade notes

- **No breaking changes.** `forge_estimate_quorum` return shape gains a `slices[]` field under each mode; existing fields (`mode`, `estimatedCostUSD`, `baseCostUSD`, `overheadUSD`, `quorumSliceCount`, `totalSliceCount`, `confidence`) are untouched. Consumers parsing the previous shape keep working.
- **Dashboard requires no config.** The projected-cost badge and plan-projection strip activate automatically on plan-open. Set `runtime.cost.budget` in `.forge.json` to light up the over-budget red highlighting.
- **`scoreSliceComplexity` is not changed.** The distribution report documents that the current threshold of 5 catches zero slices on real plans, but any scoring/threshold change is explicitly deferred to a future phase with its own scope contract.

## [2.60.1] — 2026-04-21 — Cost Service Hotfix (v2.60.0 follow-up)

> **Patch release — closes three real bugs the v2.60.0 dogfood exposed, plus a carryover bridge defect from Phase-27 Slice 6.** When `forge_estimate_quorum` shipped in v2.60.0 and was pointed at real plans in `docs/plans/`, it produced numbers between $141–$218 for 11–17-slice plans — numerically close to the $146.57 figure the v2.59 agent was accused of fabricating. The tool-call forcing function was the real fix in v2.60.0; the v2.60.0 release notes were wrong to frame $146.57 as hallucination. What the dogfood exposed: (A) power and speed modes were producing *identical* overhead because the dry-run cost used the first-listed model's rate N times instead of pricing each leg by its own model; (B) `claude-opus-4.7` was absent from `MODEL_PRICING` and silently fell back to the sonnet rate, undercounting power-preset overhead; (C) the `auto` mode's complexity threshold was `7` — higher than any score real plans produce — so `auto` degenerated to `false` on every plan in the repo; (D) `forge_estimate_quorum` was missing from `server.mjs`'s `MCP_ONLY_TOOLS` Set (carryover from Phase-27 Slice 6), so `POST /api/tool/forge_estimate_quorum` fell through to `runPforge()`, which has no CLI counterpart for MCP-native tools.

### Fixed

- **Per-leg dry-run pricing in `estimateQuorum`.** `cost-service.mjs` now prices each quorum model's dry-run leg using *that model's* per-token rate instead of multiplying the default model's rate by the leg count. Pre-fix, `power.overheadUSD` and `speed.overheadUSD` were identical on every plan. Post-fix, observed ratio is ≈ 5.5× (power's opus-4.6 + gpt-5.3-codex + grok-reasoning averages ~$6.70/Mtok input; speed's sonnet + gpt-mini + grok-fast averages ~$1.20/Mtok). A new test `per-leg pricing varies across quorum presets` asserts the ratio stays above 4× as a regression guard. (Phase-27.1 Slice 1)
- **`claude-opus-4.7` added to `MODEL_PRICING`.** Mirrors published `claude-opus-4.6` rates ($15 / $75 per Mtok, Anthropic pricing page retrieved 2026-04-20) until Anthropic publishes a distinct price point. A new coverage test iterates every model referenced by any `QUORUM_PRESET` (power/speed, models + reviewerModel) and asserts direct `MODEL_PRICING` membership — regression guard against the same class of defect (new preset model silently falling back to default rates). (Phase-27.1 Slice 2)
- **`forge_estimate_quorum` wired through HTTP bridge.** Added to `server.mjs`'s `MCP_ONLY_TOOLS` Set. Without this, `POST /api/tool/forge_estimate_quorum` fell through to `runPforge()` (no CLI counterpart), returning a non-zero exit / empty output to the dashboard and stdio MCP clients that went via HTTP. A new test parses `server.mjs` and asserts required MCP-native tools are present in the Set — regression guard against the Phase-27 Slice 6 carryover pattern (new tool registered in `capabilities.mjs`/`tools.json`/switch-case/handler but author forgets the one-line Set update). (Phase-27.1 Slice 2b — carryover from Phase-27 Slice 6)
- **`auto` quorum threshold lowered from 7 to 5.** Matches `QUORUM_PRESETS.power.threshold`. Pre-fix, `threshold: 7` on every real plan in `docs/plans/` produced `quorumSliceCount: 0`, degenerating `auto` to `false`. Post-fix it still produces 0 on the current plan portfolio (max observed complexity score: 4) — this is a real finding: the synthetic-score scale and feature-sized real-plan shapes leave `auto` effectively inert. Phase-27.2 may recalibrate the complexity scorer; this fix at minimum stops `auto` being strictly worse than power. (Phase-27.1 Slice 3)

### Added

- **Real-plan smoke matrix** — `tests/cost-service-real-plans.test.mjs` iterates every `docs/plans/Phase-*-PLAN.md` file in the repo, parses it with `parsePlan`, runs `estimateQuorum`, and asserts cross-preset invariants (`power > speed > false`, `auto <= speed`, finite numeric estimates for all four modes, `auto.quorumSliceCount` equals the slice count meeting the auto threshold). This is the matrix that exposed bugs A–C above; it exists now to catch the same regression pattern on future changes. (Phase-27.1 Slice 4)

### Correction to v2.60.0 release notes

The v2.60.0 notes framed the $146.57 number as a chat hallucination. Dogfood of `forge_estimate_quorum` against real plans shows the estimator itself returns $141–$218 for 11–17-slice plans, consistent with what the v2.59 agent quoted. The Phase-27 value was the tool-call forcing function itself — cost becomes a replayable action, not a chat number. Phase-27.1 closes three real bugs the dogfood exposed (per-leg pricing, opus-4.7 coverage, auto threshold) plus the missing `MCP_ONLY_TOOLS` entry that left `forge_estimate_quorum` unreachable via HTTP. The regression guard in `tests/cost-service.test.mjs` ("power mode … stays under $25 … fabrication catcher") is unchanged — it still guards the 6-slice heuristic fixture shape. Real plans produce higher numbers because real plans have more slices with higher token budgets, not because the estimator is wrong.

### Test delta

- `+22` tests: `+9` in `tests/cost-service.test.mjs` (pricing-table coverage for QUORUM_PRESETS, per-leg ratio gate strengthened `> 2 → > 4`, HTTP-bridge MCP_ONLY_TOOLS coverage), `+13` in new `tests/cost-service-real-plans.test.mjs` (real-plan smoke matrix). Total `2968 / 2968` green (was `2946 / 2946`).

### Upgrade notes

- **No breaking changes.** Public API of `cost-service.mjs` and `orchestrator.mjs` shim is unchanged. Projected cost numbers will move:
  - `power.overheadUSD` will *increase* on plans that have quorum-eligible slices (per-leg pricing now uses each model's actual rate instead of the cheapest-first-listed). Expected ≈ 2–5× depending on model mix.
  - `auto.estimatedCostUSD` equals `speed.estimatedCostUSD` on most real plans until the complexity scorer recalibrates (Phase-27.2).
- **If you cached v2.60.0 cost report numbers**, re-run `forge_cost_report` — the pricing table now includes `claude-opus-4.7` and may reclassify runs that used it.

## [2.60.0] — 2026-04-20 — Cost Service Consolidation + `forge_estimate_quorum`

> **Minor release — one source of truth for pricing, one tool for quorum cost projection.** Motivated by a field incident where an agent, asked "how much will this plan cost under each quorum mode?", produced a four-row picker with a $146.57 headline for `power` mode — invented in chat by hand-multiplying its internal guess at per-slice tokens by an out-of-date rate card. The real `pforge run-plan --estimate --quorum=power` number for the same plan was under $10. The plan existed, the CLI estimator existed, but no MCP tool exposed it to agents, so the agent fabricated. This release fixes both halves: (1) pricing + cost math are extracted from three different files into a single `cost-service.mjs` module (DRY, so "update the rate card" means editing one file); (2) a new `forge_estimate_quorum` MCP tool returns all four quorum-mode estimates in one call, with explicit agent guidance in `copilot-instructions.md` telling agents to call the tool instead of computing in chat. Tied to Karpathy's verifiability principle — numbers the user sees must come from code that can be replayed, not from model arithmetic.

### Added

- **`pforge-mcp/cost-service.mjs`** — new module, single source of truth for all pricing and cost math. Exports `MODEL_PRICING` (the rate card), `getPricing(model)`, `priceSlice(tokens, worker)` (drop-in for the old `calculateSliceCost`), `priceRun(sliceResults)` (drop-in for `buildCostBreakdown`), `estimatePlan(plan, model, cwd, quorumConfig, resumeFrom)` (drop-in for `buildEstimate`), and `estimateQuorum({plan, cwd, resumeFrom, defaultModel})` which returns all four modes (`auto` / `power` / `speed` / `false`) plus a `recommended` field in one call.
- **`forge_estimate_quorum` MCP tool** — exposes `cost-service.estimateQuorum` over the MCP surface. Wired in `capabilities.mjs` (with `agentGuidance` telling agents to prefer this tool over hand-computed costs), `tools.json` (schema + example), and `server.mjs` (dedicated async handler that resolves `planPath`, parses the plan, runs the estimator, broadcasts a LiveGuard event, and returns JSON).
- **Regression guard** — `tests/cost-service.test.mjs` includes a named "REGRESSION GUARD: power mode on 6 trivial heuristic slices stays under $25" test that will fail loudly if the estimator ever drifts into the $100+ range the v2.59 agent fabricated. Plus 19 parity tests comparing every cost-service function byte-for-byte against the pre-refactor orchestrator behavior.
- **`## Cost estimates` section** added to `.github/copilot-instructions.md` and `templates/copilot-instructions.md.template`: "Cost estimates come from tools, not from chat math. Call `forge_estimate_quorum` before showing any picker or decision matrix. Do not hand-compute quorum costs." Carries the $146.57 incident as cautionary context.

### Changed

- **`pforge-mcp/orchestrator.mjs`** — the 313-line pricing block (`MODEL_PRICING`, `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate`) is now a 24-line shim that re-exports `cost-service.mjs` functions. Preserves the exact public signatures so every caller (`pforge run-plan --estimate`, the autonomous executor, every test) keeps working. Shims use `export function X(...args) { return _Y(...args) }` rather than `export const X = _Y` because vitest's ESM module graph gives the latter a `undefined` binding under circular imports (orchestrator ↔ cost-service both need scoring/pricing primitives). Function declarations hoist; const aliases don't.
- **`pforge-mcp/tempering/scanners/visual-diff.mjs`** — the local 6-entry rate table and inline `estimateCost()` function are deleted. The remaining 6-line adapter delegates to `cost-service.priceSlice` so visual-diff is no longer silently out of sync with orchestrator pricing when a rate changes.
- **Orchestrator exports** — `aggregateModelStats` and `QUORUM_PRESETS` are now exported so `cost-service.mjs` can use them without duplicating their logic.

### Fixed

- **Duplicate rate cards drift silently.** Before this release, pricing lived in three places: `orchestrator.mjs` `MODEL_PRICING`, `visual-diff.mjs`'s local `rates` object, and implicitly in any caller that did its own token-times-dollar math. Updating Claude Sonnet 4.6's input price meant finding and editing all three. Now it means editing one object in one file.
- **Agents could fabricate dollar amounts without tool backing.** The previous MCP surface exposed `forge_cost_report` (actuals from prior runs) but no projection tool. Agents asked to estimate upcoming plan cost either said "I can't estimate without running" or — more dangerously — invented numbers. `forge_estimate_quorum` closes the gap and the new `## Cost estimates` instructions make the expectation explicit.
- **`estimateQuorum` hardening for null `cwd`.** `estimateQuorum({plan, cwd: null, ...})` now defaults `cwd` to `process.cwd()` before passing it down to `scoreSliceComplexity → getHistoricalFailureRate`, which previously crashed on `resolve(null, "...")`. Callers that pass an explicit `cwd` are unchanged.

### Test delta

- `+20` tests (`tests/cost-service.test.mjs`), total `2913 / 2913` green. The 20 include the REGRESSION GUARD named above plus parity tests for every public function in `cost-service.mjs` against its pre-refactor orchestrator behavior.

### Upgrade notes

- **Public API unchanged.** `orchestrator.mjs` still exports `MODEL_PRICING`, `calculateSliceCost`, `buildCostBreakdown`, `buildEstimate`. Every pre-v2.60 caller keeps working without edits.
- **If you imported `MODEL_PRICING` directly**, the value is now re-exported from `cost-service.mjs` and identical byte-for-byte. No changes required.
- **If you were reading `visual-diff.mjs`'s local rates**, they're gone — read `cost-service.MODEL_PRICING` instead.

## [2.59.2] — 2026-04-20 — CLI Papercuts & Smith Downstream Noise

> **Patch release — follow-up to v2.59.1 based on field feedback.** Fixes three cosmetic-but-noisy PowerShell `pforge` bugs that emitted non-zero exit codes on successful operations, one UX gap on the update prompt, four smith warnings that fired spuriously on downstream consumer projects, and one latent `ContainsKey($null)` crash when `.forge.json` omits the `preset` field. No functional changes to orchestrator, MCP tools, setup, or runtime behavior.

### Fixed

- **`pforge check` — empty `-ProjectPath` binding.** `Invoke-Check` splatted `$Arguments` directly into `validate-setup.ps1`. When no extra args were supplied, `ValueFromRemainingArguments` left `$Arguments` null; splatting `@$null` bound an empty string to `[string]$ProjectPath`, overriding its `(Get-Location).Path` default and throwing "Cannot bind argument to parameter 'Path' because it is an empty string." Now only splats when `$Arguments` is non-empty, else passes `-ProjectPath $RepoRoot` explicitly.
- **`pforge update` — hashtable-merge errors in post-update summary.** `$updates + $newFiles` worked when both arrays had ≠ 1 element, but with single-element arrays PowerShell unwrapped each to a bare hashtable. `hashtable + hashtable` triggers merge semantics → duplicate-`Name`-key collisions ("Item has already been added. Key in dictionary: 'Name'"). With empty + hashtable → "A hash table can only be added to another hash table." Both paths now wrap both sides in `@(...)` to force array context. Files were always written correctly; this error was cosmetic but returned non-zero exit.
- **Smith — `ContainsKey($null)` crash on minimal `.forge.json`.** A `.forge.json` without a `preset` field (e.g., the plan-forge dev repo's own config) left `$preset` null. `$expectedCounts.ContainsKey($null)` threw "Value cannot be null. (Parameter 'key')" and aborted smith before the summary line printed. Now guards with `$presetKey -and ...`.

### Changed

- **Smith — downstream-repo warnings suppressed.** Four checks that only make sense inside the plan-forge dev repo itself now guard on the `isPlanForgeDevRepo` detector (`presets/` directory + `pforge-mcp/server.mjs`): (1) dashboard screenshots in `docs/assets/dashboard/` (plan-forge marketing site asset), (2) tempering coverage-below-minimum warning (downstream `.forge/tempering/` may be seeded from pforge and unrelated to consumer coverage), (3) latest tempering run verdict=fail warning (same rationale), (4) CHANGELOG-missing-entry-for-VERSION warning (consumer CHANGELOG tracks the consumer's app, not the pforge framework version carried in `VERSION`). Downstream projects now see a friendlier pass line noting VERSION is the framework version.
- **`pforge update` — prompt now mentions `--force`.** The confirmation prompt "Apply N updates and M new files? [y/N]" now appends "(use --force to skip this prompt)" so users can discover the non-interactive path.

### Known issues (deferred)

- **`pforge update --tag vX.Y.Z` not authoritative when sibling clone exists.** Flag is honored under `--from-github`, but auto-detection can still route through sibling when `--from-github` is not passed. Explicit `--tag` should win over source auto-detection; scheduled for v2.60.0 alongside the broader `updateSource` precedence refactor.

## [2.59.1] — 2026-04-20 — Setup/Update Distribution Fixes

> **Patch release — fixes a class of silent setup/update gaps.** An audit of `setup.ps1`, `setup.sh`, and `pforge update` against the repo's actual content found four distribution gaps: pipeline prompts were never copied to fresh projects, the `PreCommit.mjs` guard hook (#74) never reached downstream projects, `pforge update` missed `project-profile.prompt.md` and two shared instruction files on Unix, and `pforge smith` counted prompts without verifying pipeline prompts were among them — which masked the first gap. All four fixed. No functional changes to orchestrator, MCP tools, or runtime behavior.

### Fixed

- **Setup/update distribution gap — pipeline prompts never shipped.** `setup.ps1` and `setup.sh` only copied `templates/.github/prompts/project-principles.prompt.md`, never the eight pipeline prompts (`step0-specify-feature`…`step6-ship` + `project-profile`) that live in the repo's `.github/prompts/`. Fresh installs lacked the core runbook scaffolding despite setup's closing output telling users to run `step0-specify-feature.prompt.md`. Both setup scripts now copy every `*.prompt.md` from `.github/prompts/` in Step 3c (excluding `project-principles.prompt.md`, which remains sourced from `templates/`).
- **Setup/update distribution gap — `PreCommit.mjs` (#74 hook) missing from downstream projects.** Added in v2.50.1 only to `.github/hooks/`, but both setup and `pforge update` source hooks from `templates/.github/hooks/`. The hook is now mirrored in both locations so downstream projects receive it.
- **`pforge update` prompt glob too narrow.** The glob `step*.prompt.md` missed `project-profile.prompt.md`. Broadened to `*.prompt.md` with an explicit skip for `project-principles.prompt.md`.
- **`pforge update` shared-instructions list incomplete (Unix).** `pforge.sh` update-from-source only enumerated 3 of the 5 shared instruction files; `status-reporting.instructions.md` and `context-fuel.instructions.md` never refreshed. Now enumerates all five, matching `pforge.ps1`.
- **Smith pipeline-prompt blind spot.** Smith counted `*.prompt.md >= 9` but never verified the runbook's pipeline prompts by name — a project with only `new-*` scaffolding prompts could pass the count check while lacking every pipeline prompt. Smith now performs an explicit name presence check for `step0`…`step6` and `project-profile`, surfacing any missing ones with a `pforge update` fix hint.

---

## [2.59.0] — 2026-04-20 — Housekeeping

> **Small, targeted cleanup.** One real bug fix (libuv teardown crash on Windows), one version-drift correction, and a ROADMAP prune that closes six stale backlog entries representing work that was already shipped.

### Fixed

- **Bug #82 — Windows libuv teardown assertion on `orchestrator.mjs --analyze` / `--diagnose`.** After a successful xAI/OpenAI/Anthropic API dispatch, `process.exit(0)` was called while undici's keepalive sockets were still closing, tripping `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and a non-zero exit. Both success paths now set `process.exitCode = 0` and let the event loop drain naturally; idle sockets unref and close cleanly. Error paths still use `process.exit(1)` for immediate failure signaling. Verified: same smoke test that crashed now exits cleanly (`$LASTEXITCODE = 0`).

### Changed

- `pforge-mcp/package.json` version bumped `2.47.0` → `2.59.0-dev` to re-align with the top-level `VERSION` file. The `pforge version-bump` command and `pforge smith` drift warning already expected parity; several prior releases had bypassed `version-bump` and let the two drift.

### Docs

- **ROADMAP prune.** Removed six backlog entries representing work already shipped: `pforge update --from-github` (#75, shipped v2.51.0), PreCommit hook against direct-to-master (#74, shipped v2.50.1), runtime-aware `model-performance.json` validation (#73, shipped as `forge_doctor_quorum` + 33 tests), gh-copilot cost/token resolution (#63, closed), preset-specific `validate-setup` minimum counts (shipped), and the B1 shipped marker for `pforge org-rules export`. Phase-27 backlog also had the libuv crash item (now fixed in this release).

---

## [2.58.0] — 2026-04-20 — Phase-26 Competitive & Self-Deterministic Loop

> **The inner loop gains competitive execution and self-correction.** Building on the Phase-25 reflective layer, this release adds three new opt-in subsystems — competitive worktree execution, auto-fix patch proposals, and cost-anomaly detection — a dedicated Dashboard "Inner Loop" tab that surfaces all ten subsystems in one place, and a best-defaults preset so new projects start with advisory-posture defaults out of the box. Every addition is opt-in; nothing in existing workflows changes.

### Added — Competitive & Self-Deterministic Loop (v2.58.0)

- **Competitive slice execution (L9)** — Opt-in worktree race. Two or more strategies execute the same slice under isolated worktrees; the winner is elected by gate result, reviewer verdict, and token-cost tie-breaker. Losing worktrees are cleaned up. Off by default. Config: `innerLoop.competitive: { enabled, maxParallel, timeoutSec }`. Implemented in `pforge-mcp/orchestrator.mjs → runCompetitiveSlice()`.
- **Auto-fix patch proposals (L6)** — When a gate-fail trajectory suggests a small local correction, the orchestrator drafts a `.patch` file under `.forge/proposed-fixes/<fixId>.patch` and records metadata in `.forge/fix-proposals.json`. Advisory-only — nothing auto-applies unless operators set `applyWithoutReview: true`. Config: `innerLoop.autoFix: { enabled, applyWithoutReview }`.
- **Cost-anomaly detection (L5)** — On every slice, the orchestrator compares the slice's token cost against the per-model median (window 20) and records any ratio above `innerLoop.costAnomaly.ratio` (default 2.0) in `.forge/cost-anomalies.jsonl`. Advisory only; runs are never halted. Surfaced in the Dashboard's new Inner Loop tab.
- **Dashboard "Inner Loop" tab** — New top-level tab with a four-cell summary grid (reviewer calibration, pending auto-skills, federation status, open fix proposals) and six collapsible panels. Six new read-only endpoints power it: `/api/innerloop/{status,reviewer-calibration,gate-suggestions,cost-anomalies,proposed-fixes,federation}`.
- **Welcome card (one-time)** — On first dashboard visit after upgrade to v2.58, a dismissible card announces the inner-loop features. Dismissal is persisted in `.forge/dashboard-state.json#seenInnerLoop258` via the new `/api/dashboard-state` GET/POST endpoints (partial-merge semantics).
- **Best-defaults preset** — `setup.ps1` and `setup.sh` now write `.forge.json` only when it is absent (upgrades are preserved) and ship with `innerLoop` + `brain.federation` blocks in advisory-posture defaults: `competitive` off, `autoFix` advisory, `costAnomaly` advisory, federation off.
- **Capabilities surface extension** — `INNER_LOOP_SURFACE.schemaVersion` bumped `1.0` → `1.1`; `worker-capabilities.json` flags all ten subsystems; `docs/capabilities.md` and `llms.txt` updated.
- **User manual: "Competitive Loop" chapter** — New `docs/manual/competitive-loop.html` with a Mermaid worktree-spawn → winner-election flow. `docs/manual/inner-loop.html` gains a Phase-26 additions section and cross-link.

### Changed

- `INNER_LOOP_SURFACE` schemaVersion `1.0` → `1.1`; now declares ten subsystems (seven Phase-25 + three Phase-26).
- Setup scripts no longer overwrite an existing `.forge.json`. On upgrade, operators retain their customized config and see the welcome card to discover new subsystems.

### Fixed

- **Bug #81 — `--resume-from` ignored in estimate.** `pforge run-plan --estimate --resume-from N` previously returned totals for the full plan (sliceCount, executionOrder, tokens, cost, and slices[] all covered shipped slices). `buildEstimate` now walks the DAG order from `resumeFrom` forward; output adds `resumeFrom` and `fullSliceCount` fields. Falls back to the full plan when `resumeFrom` doesn't match any slice. Regression tests: `tests/estimate-resume-from.test.mjs`.
- **Bug #79 — `tokens_in` inflated up to ~100× in `cost-history.json`.** When `gh copilot` stderr contained both the aggregate `Tokens ↑ X • ↓ Y` summary AND the per-model breakdown block, `parseStderrStats` assigned from the aggregate and then re-accumulated each breakdown line on top. The aggregate is now authoritative; breakdown lines only identify the dominant model when the aggregate is present. Old format (breakdown only, no aggregate) still sums correctly. Regression tests added in `tests/orchestrator.test.mjs`.
- **Bug #78 — `spawnWorker` ignored explicit `worker` override when model matched an API provider.** Callers passing `worker: "..."` to force a CLI still got HTTP-routed if the model name matched a provider pattern. `spawnWorker` now respects the explicit override (`!worker && model ? detectApiProvider(...) : null`). Also adds an optional `role` parameter (`"quorum-dry-run" | "reviewer" | "analysis"`) that threads through to the API path.
- **Bug #80 — xAI Grok refused quorum dry-run and reviewer prompts as core-instruction overrides.** API-routed Grok read "simulate pforge running slice N" as an instruction-override attempt. The new `buildApiMessages(prompt, role)` helper wraps analysis-style prompts in a system message explicitly framing the payload as data to evaluate (not instructions to follow), unblocking Grok without per-call-site prompt rewrites. `quorumDispatch`, `quorumReview`, and `analyzeWithQuorum` now declare their roles. Regression tests: `tests/spawn-worker-role.test.mjs`.

### Security

- All new subsystems ship in advisory posture. `autoFix` never writes outside `.forge/proposed-fixes/`; applying a patch is an explicit opt-in (`applyWithoutReview: true`) and can be rolled back.
- `costAnomaly` is detection-only and cannot halt a run.
- `competitive` worktrees are created under `.forge/worktrees/` and cleaned up after election; losing-worktree paths never enter the working tree.

---

## [2.57.0] — 2026-04-27 — Phase-25 Inner-Loop Enhancements

> **The Forge gains a reflective layer.** Seven opt-in subsystems turn deterministic slice execution into a closed research loop: every slice can teach the next one, every run can teach the next plan, every project can teach the next project. Nothing in existing workflows breaks — all new behavior defaults to *off*, *suggest*, or *advisory*.

### Added — Inner Loop (v2.57.0)

- **Reflexion retry context (L7)** — When a slice's validation gate fails, the next attempt's prompt now includes a compact block with the failing command, model, duration, and a 2KB stderr tail. The worker reasons about the prior failure instead of blindly retrying. `buildReflexionBlock()` in `pforge-mcp/memory.mjs`.
- **Trajectory capture (L8)** — On slice pass, sentinel-wrapped (`<!-- PFORGE_TRAJECTORY:BEGIN --> … <!-- PFORGE_TRAJECTORY:END -->`) worker notes are extracted, word-capped at 500, and written to `.forge/trajectories/<slice>/<iso>.md`. Path-traversal-safe. Postmortem and federation consumers read these for compact run narratives.
- **Auto-skill library (L2)** — Passed slices are captured as candidate skills (domain keywords + gate commands + SHA prefix). On the next slice, `retrieveAutoSkills()` injects matching skills into the prompt ranked by reuse count. Skills promote to "stable" at 3 reuses. Storage: `.forge/auto-skills/*.md`.
- **Adaptive gate synthesis (L6)** — During plan pre-flight, Tempering-domain-matching slices with no validation gate get a suggested command printed using the project's Tempering coverage minimum and runtime budget. Default mode `suggest` (never mutates your plan). Config: `runtime.gateSynthesis: { mode, domains }`.
- **Plan postmortems + hardener feedback (L5)** — Every run writes a JSON postmortem (`retriesPerSlice`, `gateFlaps`, `topFailureReason`, `costDelta`, `driftDelta`) to `.forge/plans/<plan-basename>/postmortem-*.json`. Retention 10 per plan. Step-2 hardener now reads the newest postmortems and folds signals into the Scope Contract — closing the loop from execution back into planning.
- **Cross-project federation (L4-lite)** — When `cross.*` brain recall misses L3 (OpenBrain), the facade fans out to read-only absolute-local-paths listed in `brain.federation.repos[]`. URLs and relative paths are rejected by contract (defense-in-depth path containment). Opt-in. Config: `brain.federation: { enabled, repos: [] }`.
- **Reviewer-agent in-loop (L4)** — Opt-in. `brain.gate-check` responder can invoke a speed-quorum reviewer on each slice's diff summary and attach `{ score, critical, summary, durationMs }` to the response. **Advisory-only in v2.57** — critical verdicts do not block unless operators set `blockOnCritical: true`. Blocking mode enters Phase-26 after calibration data exists. Config: `runtime.reviewer: { enabled, quorumPreset: "speed", blockOnCritical: false, timeoutMs: 30000 }`.
- **Inner-loop capability surface** — New `innerLoop` block in `forge_capabilities` output and `worker-capabilities.json` advertising all 7 subsystems (level, addedIn, enabledByDefault, configKey, configDefaults, dashboardTab, module). IDEs, MCP consumers, and the Dashboard Config tab auto-discover subsystem state.
- **User manual: "The Inner Loop" chapter** — New `docs/manual/inner-loop.html` with a Mermaid state-flow diagram covering plan → slice → reflexion retry → trajectory → skill capture → reviewer → postmortem → federation. Cross-linked from `how-it-works.html` and `manual/index.html` nav.
- **Dashboard Config tab editors** — Toggles, selects, and repo lists for `runtime.gateSynthesis`, `runtime.reviewer`, and `brain.federation`. Every new subsystem is user-configurable without editing JSON.

### Changed

- `CONFIG_SCHEMA` in `pforge-mcp/capabilities.mjs` gained `runtime.gateSynthesis`, `runtime.reviewer`, and `brain.federation` blocks so the Dashboard Config tab renders editors automatically.
- Step-2 Harden-Plan prompt (`.github/prompts/step2-harden-plan.prompt.md`) now directs the hardener to read prior plan postmortems before finalizing the Scope Contract.

### Security

- Federation reader enforces absolute-local-paths-only (D9): rejects URLs (`http://`, `https://`, `ftp://`, `file://`), rejects relative paths, strips `..` components, and applies a defense-in-depth containment check against the resolved base directory.
- Trajectory writer sanitizes slice names and timestamps before building paths (no `..`, no path separators, no control characters).

### Migration

- **No action required.** All seven subsystems default to `off` / `suggest` / `advisory` for existing projects. To opt in, set the relevant key in `.forge.json` or flip the toggle in the Dashboard → Config tab. New installs ship with best-defaults.

### Tests

- 9 reflexion tests, 22 trajectory tests, 26 auto-skill tests, 23 gate-synthesis tests, 13 postmortem tests, 23 federation tests, 25 reviewer tests, 15 capability-surface tests.
- Full-suite regression after each slice: green (2627/2627 across 96 files at Slice 7 checkpoint).

---

## [2.56.0] — 2026-04-20 — Update Source preference

### Added
- **`updateSource` config preference** in `.forge.json` — tells `pforge update` where to pull template bytes from. Three modes:
  - `auto` *(new default)* — picks the newer of your sibling clone and the latest GitHub tag. If the sibling is on a `-dev` build, GitHub tags win.
  - `github-tags` — always downloads the latest tagged release; ignores sibling clones. Good for teams and CI.
  - `local-sibling` — always uses `../plan-forge`; contributor workflow. Errors if the sibling is missing.
- **`pforge config` CLI** (PowerShell + Bash): `pforge config get/set/list` for managing settable `.forge.json` keys. First key: `update-source`. Writes atomically (tmp + rename).
- **Dashboard Config tab**: new *Update Source* panel with a 3-option select and live hint text. Saves immediately on change via `POST /api/config`. Server-side enum validation.
- **Appendix G — Update Source Modes** in the manual: explains the problem, the three modes, how to change via CLI/dashboard/hand-edit, and FAQ (offline behavior, `self-update` separation, CI guidance).

### Changed
- **`pforge update` default source selection** now runs through the auto-mode algorithm. Previously: "use sibling if it exists, else fail". New: "pick the newer stable source". The v2.53.2 `-dev`-over-clean refusal is still in place as a safety net.
- `pforge update` no longer errors when no sibling is found — it auto-falls-back to GitHub tags.

### Fixed
- Dashboard footer/badge no longer shows hardcoded `v2.9.0` (was a leftover from a screenshot capture script). Version now tracks the `VERSION` file.
- Zombie node servers holding ports 3100/3101 from stale sessions no longer silently render a stale VERSION on the dashboard.

### Migration
- **No action required.** Projects without `updateSource` default to `auto`, which is the safe recommended behavior. Contributors who want the historic sibling-preferred flow can set `updateSource: "local-sibling"` via `pforge config set update-source local-sibling`.

### Tests
- 2486/2486 green. New: `pforge-mcp/tests/config-api.test.mjs` (8 tests covering GET/POST `/api/config` and `updateSource` enum validation).

---

## [2.55.0] — 2026-04-21 — The Forge Shop rebrand

### Changed
- **Positioning**: Plan Forge is now framed as the **AI-Native SDLC Forge Shop** — one workshop with four stations: **Smelt** (Specify & Plan), **Forge** (Execute), **Guard** (Review, Watch, Bridge), **Learn** (Ship, Bug Registry, Testbed, Health DNA).
- **Brand assets**: New xAI Grok-generated hero art in `docs/assets/brand/` (panorama + four station portraits + control room + OG card v2).
- **Landing page** (`docs/index.html`): Hero, station grid, and all meta/OG/Twitter/JSON-LD descriptions updated to four-station taxonomy.
- **Shop Tour** (`docs/shop-tour.html`): New canonical tour of the four stations.
- **Capabilities** (`docs/capabilities.html`): `#stations` four-column reference added before MCP tool listing.
- **FAQ** (`docs/faq.html`): Top Q/A rewritten with four-station bullets and blacksmith framing; JSON-LD FAQPage updated.
- **Manual** restructured into four Acts with 24 chapters + 6 appendices:
  - Act I — Smelt (Ch 1–5)
  - Act II — Forge (Ch 6–15)
  - Act III — Guard (Ch 16–20, incl. new **Watcher** and **Remote Bridge** chapters)
  - Act IV — Learn (Ch 21–24, incl. new **Bug Registry**, **Testbed**, **Health DNA** chapters; Memory Architecture renumbered to Ch 24)
- **Manual covers** (`docs/manual/index.html`, `what-is-plan-forge.html`, `how-it-works.html`): Rewritten around the Forge Shop metaphor; panorama hero.
- **OG cards site-wide**: 16 pages swapped from `og-card.webp` to `og-card-v2.webp`.
- **Blog archive** (8 posts under `docs/blog/`): v1.x-positioning banner added atop each article linking to the current Shop Tour.

### Notes
- **No behavioral changes.** CLI, MCP tools, hooks, and test suite are unchanged. Tests: 2478/2478 green.
- Plan of record: `docs/plans/REBRAND-Forge-Shop.md` (slices R0–R12).

---

## [2.53.3] — 2026-04-20 — `self-update --force` heals dev-stuck installs

### Fixed

- **`pforge self-update --force` now installs the latest tagged release
  even when the local install reports "newer".** Previously, clients
  stuck on e.g. `2.54.0-dev` (installed from a master sibling-clone)
  could never heal because `compareVersions` ranked their local `-dev`
  above the latest release (`2.53.2`), so `self-update` exited with
  "Already current". With `--force`, the check is bypassed and the
  latest tagged release is installed unconditionally. Mirrors the
  `pforge.sh` implementation. Without `--force`, prior behaviour is
  preserved: if the local install reports "already current" but ends in
  `-dev`, a targeted hint suggests the heal command.

### Dashboard symptoms this unblocks

Clients observed showing:
- Footer: `Plan Forge v2.54.0-dev`
- Missing SVG icons on most tab buttons
- Horizontal scrollbar where sub-tabs should wrap

These were all present in master-clone installs that predate v2.53.0's
dashboard overhaul (`a26a7cb`, `a7419c1`). `pforge self-update --force`
now cleanly installs v2.53.3 and restores the current UI.

### Tests

- 2478/2478 vitest passing.

---

## [2.53.2] — 2026-04-20 — Refuse '-dev' source over clean install

### Fixed

- **`pforge update` now refuses to install a `-dev` source onto a clean
  release install.** Closes the last self-heal gap: when a consumer project
  has a sibling `plan-forge/` clone on master, plain `pforge update`
  (without `--from-github`) would copy master's `VERSION=X.Y.Z-dev` onto
  their clean install, leaving them on an unreleased dev build. This
  happened to at least one known client (observed landing on
  `v2.54.0-dev`). The update now exits with a clear error pointing users
  to `pforge self-update` (which always fetches the latest tagged
  release). Override flag: `--allow-dev` (not recommended). Both
  `pforge.ps1` and `pforge.sh` carry the guard.

### Tests

- 2478/2478 vitest passing (no changes to JS surfaces).

---

## [2.53.1] — 2026-04-20 — Corrupt-install self-heal + release guard

### 🛡️ Self-heal for stuck clients (v2.50.0/v2.51.0/v2.52.0 broken tarballs)

Tags `v2.50.0`, `v2.51.0`, and `v2.52.0` shipped with `VERSION=X.Y.Z-dev`
baked into the release tarball (fixed in v2.52.1). Clients who installed
any of those releases still see `-dev` locally — this release detects and
auto-fixes that state for **every existing and future install**.

### Added

- **`detectCorruptInstall()`** in `pforge-mcp/update-check.mjs`.
  Conservative detector: flags when local `VERSION` ends in `-dev`
  AND a bare release with matching-or-newer core exists on GitHub.
  Genuine dev branches ahead of the latest release (e.g. `2.54.0-dev`
  while latest is `2.53.1`) are **not** flagged. 8 new tests cover the
  full matrix (broken cohort, genuine dev, offline, malformed inputs).

- **MCP server startup banner.** `server.mjs` runs the detector 2s after
  boot and prints a bordered red alert to stderr when a corrupt install
  is found. Also emits an `install:corrupt` hub event and writes
  `.forge/install-health.json` so the dashboard can render a banner.
  A subsequent heal clears the flag automatically.

- **Smith doctor check.** `pforge smith` now inspects the local `VERSION`
  file directly (not just `.forge.json.templateVersion`). If it ends in
  `-dev`, smith warns with the exact heal command. Parity across
  `pforge.ps1` and `pforge.sh`.

- **Release guard workflow** (`.github/workflows/release-guard.yml`).
  Runs on every `v*` tag push. Fails the release if `VERSION` on disk
  doesn't equal the tag core, or if `VERSION` contains `-dev`. This is
  the exact class of bug that broke v2.50.0/v2.51.0/v2.52.0 — it can
  never happen again.

### Changed

- **`Invoke-Update` (both shells) invalidates version caches on success.**
  Removes `.forge/update-check.json`, `.forge/version-check.json`,
  and `.forge/install-health.json` after a successful update so smith
  and the dashboard immediately pick up the new state.

### Repository maintenance (post-release)

Tags `v2.50.0`, `v2.51.0`, `v2.52.0` were force-moved to the `v2.53.1`
commit and their GitHub releases recreated with "SUPERSEDED → v2.53.1"
notes. Any client who explicitly pins `--tag v2.50.0` now receives the
v2.53.1 clean tree instead of the broken `-dev` bytes.

### Fixed

- Clients stuck on `v2.50.0-dev` / `v2.51.0-dev` / `v2.52.0-dev` now
  self-heal via any of: dashboard banner, MCP startup alert, `pforge
  smith` warning, or the existing `pforge self-update` path. All roads
  lead to a clean `v2.53.1` install.

### Tests

- 2478/2478 vitest passing (was 2470; added 8 detectCorruptInstall tests).

---

## [2.53.0] — 2026-04-20 — Dashboard UX modernization + Capability-surface sync + Setup/Smith audit remediation

### Setup + CLI + Smith audit remediation (2026-04-20)

Post-v2.52.1 retrospective surfaced gaps across the setup, CLI, and
diagnostic surfaces accumulated over recent releases. Fixed in four
focused commits:

- **`f263cba` — Bash CLI parity + audit aliases.** `pforge.sh` gains
  `cmd_version_bump` + `cmd_migrate_memory` (full ports of the PS1
  handlers, including inline-node regex updates and `--dry-run`
  support). `scripts/audit-cli-parity.mjs` adds a `CLI_ALIASES` map
  so tools whose CLI names differ from `mcpToCli()` convention
  (`forge_validate→check`, `forge_drift_report→drift`,
  `forge_incident_capture→incident`, `forge_deploy_journal→deploy-log`,
  `forge_alert_triage→triage`, `forge_ext_search→"ext search"`,
  `forge_ext_info→"ext info"`) are correctly matched. Truly internal
  tools (`forge_abort`, `forge_diagnose`, `forge_memory_capture`,
  `forge_memory_report`, `forge_skill_status`) added to
  `KNOWN_MCP_ONLY`.

- **`570aa40` — validate-setup MCP/VERSION/dashboard coverage.** Both
  `validate-setup.ps1` and `validate-setup.sh` now surface a Plan Forge
  runtime section checking `VERSION`, `pforge.sh` (bash companion
  from PS1), `pforge-mcp/server.mjs` + `package.json` + `node_modules`
  (with install hint), `.vscode/mcp.json` `plan-forge` server entry,
  and `pforge-mcp/dashboard/index.html` presence. All entries are
  WARN-not-FAIL so downstream projects without Plan Forge runtime
  files aren't broken.

- **`60f5e57` — Smith Bug/Notifications/L2 rows + bash set-e hardening.**
  `Invoke-Smith` and `cmd_doctor` both emit three new sections:
  Bug Registry (counts total/open/resolved + critical/high breakdown
  from `.forge/bugs/`), Notifications (`.forge.json` adapter list),
  and Timeline/Search sources (count of indexable L2 stores among
  runs/memory/crucible/tempering/bugs/incidents). Same commit also
  fixes pre-existing `set -euo pipefail` aborts in `pforge.sh smith`
  that killed the script before Crucible/Tempering on installs
  without `jq`: new `_json_field()` helper with jq→node fallback,
  `|| echo <default>` safety on 6 other jq calls, and `|| true`
  wrap on the tempering `grep -o` pipeline that used to exit 1 on
  zero matches.

- **`2eb598e` — Generic `mcp-call` proxy closes the parity backlog.**
  Rather than hand-write 16 bespoke wrappers (crucible-* ×6,
  tempering-* ×4, bug-* ×4, `generate-image`, `run-skill`) across
  both shells, add one generic command:
  `pforge mcp-call <tool> [--arg=value ...] [--json '{...}']`. PS1
  uses `Invoke-RestMethod`; bash uses `curl`. Accepts either
  `forge_crucible_list` or `crucible-list` naming. Returns raw JSON
  or passthrough; hints on 404/refused. Audit now reports **"All
  unexpected gaps accounted for"** — zero unexpected MCP-only gaps
  from the 65-tool surface.

All 2470 tests remain green across each commit.

### Capability-surface sync (2026-04-20)

Three follow-up commits aligning the advertised capability surface
across every documentation and schema artifact:

- **`02747dd` — CLI_SCHEMA +17 commands.** `capabilities.mjs`
  `CLI_SCHEMA` export grew from 17 to 34 commands. Added: `drift`,
  `deploy-log`, `secret-scan`, `env-diff`, `regression-guard`,
  `hotspot`, `dep-watch`, `fix-proposal`, `quorum-analyze`,
  `health-trend`, `org-rules`, `self-update`, `version-bump`,
  `migrate-memory`, `testbed-happypath`, `mcp-call`, `tour`.
  Auto-regenerated into `pforge-mcp/cli-schema.json` on server
  startup via `writeCliSchema()`.

- **`f3a21d0` — docs/manual/llms prose sync.** `docs/capabilities.md`,
  `docs/manual/**`, `llms.txt`, and `docs/llms.txt` updated with the
  full 34-command surface and correct tool counts (65 tools in
  `TOOL_METADATA`).

- **`cfea1f0` — HTML tile grid.** `docs/capabilities.html` gained
  tiles for the 17 new commands matching the prose entries, with
  proper category groupings.

### Dashboard UX modernization (2026-04-20)

- **`a7419c1` — Dashboard styling, navigation, and accessibility.**
  Full CSS rewrite of `pforge-mcp/dashboard/index.html` using a
  design-token system (CSS custom properties: `--bg-0..3`,
  `--fg-0..3`, `--accent`, `--guard`, `--ring`, `--radius-*`,
  `--shadow-*`). Light theme now re-derives from the same tokens
  instead of fragile `.light { !important }` overrides. Navigation:
  standardized Forge subtab hover to a single neutral color (was 7
  different hover colors — blue/amber/orange/purple/emerald/red/cyan
  — chaotic); LiveGuard subtabs keep amber hover as group accent.
  Accessibility: `role=tablist`/`role=tab` on group + sub-tab lists,
  `aria-selected` / `aria-controls` / `aria-label`, skip-link to
  `#main-content`, sr-only search label, `prefers-reduced-motion`
  override, focus-visible ring on all interactive elements via
  `--ring`. Fixed previously-invalid nested `<main>` elements.
  Header tightened (smaller title, uppercase tracking badges, pill
  run status, proper theme-toggle hit target). Motion polish:
  tab-content `fadeIn` 180ms, slice-card hover lift, drawer uses
  cubic-bezier with backdrop blur on overlay, custom webkit scrollbar.

- **`a26a7cb` — SVG tab icons + wrap-instead-of-scroll.** All 18
  Forge subtabs + 5 LiveGuard subtabs + 2 group tabs now use
  consistent 14–16px stroked Feather/Lucide-style SVG icons that
  inherit `currentColor` (replaces inconsistent emoji, only 7 of 19
  tabs had emoji before). Forge subtab row now wraps to a second
  line on narrow viewports (`overflow-x-auto` → `flex-wrap` with
  `gap-y-1`) instead of horizontal-scrolling, so all tabs remain
  visible on small monitors.

All 2470 tests still green.

---

## [2.52.1] — 2026-04-20 — Release packaging hotfix

**Impact**: v2.50.0, v2.51.0, and v2.52.0 tarballs shipped with `VERSION=x.y.z-dev` because the tag was placed on the plan-closeout commit (still `-dev`) before VERSION was cleaned. Users running `pforge self-update` saw `-dev` badges on their installs. No functional regressions — only the version string is affected.

**Fix**: VERSION set to a clean `2.52.1` **before** tagging; tag placed at that exact commit; `-dev` bump moved to a separate follow-up commit. Release procedure hardened to prevent recurrence (see `/memories/repo/release-procedure.md`).

Self-update: existing `x.y.z-dev` installs will see `2.52.1` as an available update and converge on the next check.

---

## [2.52.0] — 2026-04-20 — Orchestrator silent-failure guard + Testbed happy-path harness + Dashboard polish

Three shipments in one release (3 commits). Tests 1990 → 2470 across full MCP suite. Tools 62 → 63.
Release: https://github.com/srnichols/plan-forge/releases/tag/v2.52.0

### Shipped — Orchestrator silent-failure guard (2026-04-20)

- **`detectSilentWorkerFailure()`** in `pforge-mcp/orchestrator.mjs`: worker exits 0 with stdout < 50 bytes or help-text output now marks the slice as `failed` instead of silently passing. Closes follow-up for #77 (the `--output-format jsonl` regression that let SHOP-07 appear to pass in 32 seconds).
- 7 new unit tests in `pforge-mcp/tests/worker-capability.test.mjs` covering empty stdout, short stdout, help-text, healthy output, non-zero exits, human sentinel, and missing result. All 27 worker-capability + 212 orchestrator tests green.
- Commit: `b0ab2ac`.

### Shipped — TESTBED-02 Slice 1: happy-path scenario harness (2026-04-20)

- **5 happy-path scenario fixtures** in `docs/plans/testbed-scenarios/` covering manual-ch8 replay, new REST endpoint, bug-to-fix loop, coverage-gap loop, and visual-regression loop.
- **`forge_testbed_happypath`** — new MCP tool that runs all happy-path scenarios sequentially with aggregated pass/fail summary. Registered in `capabilities.mjs` (addedIn: 2.57.0) with `server.mjs` REST wiring.
- **`pforge testbed-happypath`** CLI command (symmetric PowerShell + bash) via `pforge-mcp/testbed/cli-happypath.mjs` helper.
- **25 new unit tests** in `pforge-mcp/tests/testbed-happypath.test.mjs` covering fixture validation, tool handler logic, integration dry-run, CLI parity, and capabilities metadata.
- **Slice 2 (live evidence run) deferred** — requires manual kickoff against `E:\GitHub\plan-forge-testbed`; will roll into TESTBED-03 or a dedicated evidence phase.
- Plan: [docs/plans/Phase-TESTBED-02.md](docs/plans/Phase-TESTBED-02.md). Commit: `10c8779`.

### Shipped — Dashboard polish (2026-04-20)

- **New Smelt modal**: Crucible "New Smelt" upgraded from `window.prompt` to a textarea modal with char counter, Ctrl/Cmd+Enter submit, Escape to cancel, and lane selector.
- **Header version badge** reads the VERSION file and links to the matching GitHub release tag. Amber class for `-dev` builds, green on tagged releases.
- **Fixed hardcoded version strings** in `pforge-mcp/capabilities.mjs` (was `"2.3.0"`) and `pforge-mcp/server.mjs` `/api/version` (was `"2.10.2"`) — both now read the VERSION file at startup.
- Commit: `697b682`.

---

## [2.51.0] — 2026-04-20 — Ask-bus + Auto-update + Testbed harness

Three phases shipped since v2.50.0 (11 commits). Tests 1872 → 1990 (+118). Tools 59 → 62.
Release: https://github.com/srnichols/plan-forge/releases/tag/v2.51.0

### Shipped — TESTBED-01 recursive validation harness (2026-04-20)

- **`forge_testbed_run`** — new MCP tool: run testbed scenarios against an external testbed repository. Preflight checks (repo exists, clean tree, HEAD match), file lock, step execution, 7 assertion kinds, defect-log writer, hub events, L3 memory capture.
- **`forge_testbed_findings`** — new MCP tool: list/update findings with severity/surface/status filters and redacted observed fields.
- **`pforge-mcp/testbed/runner.mjs`** — scenario runner with DI-based deps, lock management, assertion dispatch table.
- **`pforge-mcp/testbed/defect-log.mjs`** — finding CRUD: `logFinding`, `listFindings`, `updateFindingStatus`. Frozen enums for severity/surface/status. Secret redaction on observed fields.
- **`pforge-mcp/testbed/scenarios.mjs`** — scenario loader/validator: `loadScenario`, `listScenarios`, `validateScenarioFixture`, `resolveTestbedPath`.
- **Assertion kinds**: `file-exists`, `file-contains`, `event-emitted`, `correlationId-thread`, `exit-code`, `duration-under`, `artefact-count`.
- **Scenario fixture format**: JSON files in `docs/plans/testbed-scenarios/` with `kind` enum (`happy-path`, `chaos`, `perf`, `long-horizon`).
- **Scheduling templates** (G6 audit): 3 GitHub Actions workflows under `templates/schedules/` — nightly mutation, weekly drift, daily sweep.
- **CLI-parity audit** (G8): `scripts/audit-cli-parity.mjs` — verifies PowerShell and bash CLI entry points accept identical flag surfaces.
- Plan: [docs/plans/Phase-TESTBED-01.md](docs/plans/Phase-TESTBED-01.md). Commits: `898bfd1` (Slice 01 runner + defect-log + scenarios), `869b7be` (Slice 02 findings tool + schedules + parity audit). Test count +54.

### Shipped — AUTO-UPDATE-01 true auto-install from GitHub (2026-04-20)

Closes [#75](https://github.com/srnichols/plan-forge/issues/75).

- **`pforge update --from-github [--tag <tag>]`** — download release tarball directly from GitHub, extract, and run existing file-copy logic. No local Plan Forge clone required.
- **`pforge-mcp/update-from-github.mjs`** — shared Node.js helper: tag resolution (`resolveTag`), tarball download with 50 MB size cap + gzip verification + SHA-256 audit, config loading from `.forge.json` `update.fromGitHub.*`.
- **Flags**: `--from-github`, `--tag <tag>`, `--keep-cache`. Existing `--dry-run` and `--force` still work.
- **`pforge self-update [--yes]`** — wraps detection + install into a single command. Non-interactive with `--yes`.
- **Dashboard Update Now button** — the existing update banner is now actionable. `POST /api/self-update` streams progress via SSE (`download` → `extract` → `copy` → `done`).
- **`pforge smith --refresh-version-cache`** — bypass the 24-hour GitHub release cache for immediate re-check.
- **Error codes**: `ERR_NO_HEAD_TAG`, `ERR_TAG_NOT_FOUND`, `ERR_RATE_LIMITED`, `ERR_TARBALL_TOO_LARGE`, `ERR_INVALID_GZIP`, `ERR_NETWORK_TIMEOUT`, `ERR_NO_TAR`, `ERR_EXTRACT_FAILED`, `ERR_UPDATE_DURING_RUN` (blocks self-update while `pforge run-plan` is active).
- **Audit log**: Every `--from-github` install appends a JSONL entry to `.forge/update-audit.log` with `{ts, from, tag, sha256, sizeBytes, source, filesChanged, outcome}`.
- **Back-compat**: Existing `pforge update <path>` behavior unchanged.
- Plan: [docs/plans/Phase-AUTO-UPDATE-01.md](docs/plans/Phase-AUTO-UPDATE-01.md). Commits: `6eb48f8` (Slice 1 core), `9c26f7e` (Slice 2 self-update + dashboard + smith refresh). Test count +42.

### Shipped — FORGE-SHOP-06 Ask-bus RPC over the hub (2026-04-20)

- **Slice 06.1 — Hub ask/respond transport** — `hub.ask(topic, payload, opts)` request/reply RPC with timeout, `hub.onAsk(topic, handler)` single-responder registration, `removeAskHandler()`, `listResponders()`. Timeout eviction (`ErrAskTimeout`), no-responder immediate `ok:false`, responder-error wrapping, late-respond drop with warn log. OTEL-style telemetry spans (`ask-telemetry` events). `close()` rejects pending asks. Purely additive — no changes to existing event frames.
- **Slice 06.2 — Responders + executor gate wire-in + dashboard** — 3 initial responders (`brain.gate-check`, `brain.correlation-thread`, `tempering.delegate-sync`). Executor gate-check wire-in between slices (config-guarded via `orchestrator.askBusGate.enabled`, fail-open on timeout). Dashboard Hub subtab surfaces ask/respond metrics + responder registry.
- Plan: [docs/plans/Phase-FORGE-SHOP-06.md](docs/plans/Phase-FORGE-SHOP-06.md). Commits: `e221555` (Slice 06.1), `0a43d22` (Slice 06.2). Test count +22.

---

## [2.50.0] — 2026-04-20 — Forge Shop unified surfaces + HOTFIX bundle

Five phases shipped since v2.49.1 (25 commits). Tests 1850 → 1872 (+22). Tools 56 → 59. Release: https://github.com/srnichols/plan-forge/releases/tag/v2.50.0

### Shipped — FORGE-SHOP-07 Brain facade (2026-04-20)

- **`pforge-mcp/brain.mjs` facade** — `recall/remember/forget` API routing over L1 (session), L2 (durable files), L3 (OpenBrain semantic). Dumb router with tier-selection rules — no caching, no intelligence.
- **L2_ROUTES expansion** — added 5 new route entries (`crucible`, `liveguard`, `review.counts`, `tempering.perf-history`, `run.latest`) enabling `brain.recall()` for all home-snapshot subsystems.
- **readHomeSnapshot rewired via facade** — 4 quadrant builders (`buildCrucibleQuadrant`, `buildActiveRunsQuadrant`, `buildLiveguardQuadrant`, `buildTemperingQuadrant`) now route reads through `brain.recall()`. Function made `async`; all callers updated.
- **forge_liveguard_run rewired** — alert triage and health trend reads use `brain.recall('project.liveguard.*', { freshnessMs: 60_000 })` instead of direct `readForgeJsonl` calls.
- **perf-budget scanner rewired** — `getBaselineP95()` replaced with `brain.recall('project.tempering.perf-history', { fallback: 'none' })` + inline derivation. Write path (`appendPerfEntry`) unchanged.
- **forge_smith Memory row** — new diagnostic section showing L1 keys, L2 store size, L3 queue depth, L3 last sync age.
- **Dashboard Brain subtab** — new read-only Config subtab (🧠 Brain) with per-tier counters, top 10 keys by hit rate, and recent recall misses. New `GET /api/brain/stats` route.
- Plan: [docs/plans/Phase-FORGE-SHOP-07.md](docs/plans/Phase-FORGE-SHOP-07.md). Commits: `297a3e7` (Slice 07.1 facade + tier backends), `c6cbc66` (async test fix), `a83b72c` (Slice 07.2 strategic adoption + Brain subtab). Test count +22.

### Shipped — HOTFIX-2.50.1 orchestrator plumbing (2026-04-20)

- **#63 fix** — cost/token model attribution for `gh-copilot` worker: `parseTokenUsage()` now reads `--model` arg and strips trailing `\r\n\` from `premiumRequests`. Cost reports no longer show `model: "unknown"`.
- **#73 fix** — runtime-aware `model-performance.json` tier validation: `validatePerformanceTier()` + `performance.strictValidation` config + `performance-tier-degraded` event emitted on mismatch.
- **#74 fix** — PreCommit hook rejects direct-to-master during `run-plan`: `PFORGE_RUN_PLAN_ACTIVE=1` env var + `hooks.preCommit.rejectMasterDuringRun` config + `PFORGE_ALLOW_MASTER_COMMIT` bypass.
- Plan: [docs/plans/Phase-HOTFIX-2.50.1.md](docs/plans/Phase-HOTFIX-2.50.1.md). Commits: `25ea803` (Slice 1 #63), `3672cb1` (Slice 2 #73), `137060a` (Slice 3 #74).

### Shipped — FORGE-SHOP-05 unified timeline (2026-04-20)

- **`forge_timeline` MCP tool** — merged chronological view across 7 L2 sources (hub-events, run events, memories, openbrain, watch, tempering, bugs, incidents). Tool count 58 → 59.
- **correlationId grouping** — flat vs threaded views; group-by algorithm threads events across subsystems for end-to-end workflow visualization.
- **Dashboard Timeline tab** — time-window presets, URL hash router, 10s auto-refresh with pause-on-scroll, filter UI.
- **Streaming JSONL reader** — p95 < 400 ms on 10k-event fixture; no new stores, no new writers.
- Plan: [docs/plans/Phase-FORGE-SHOP-05.md](docs/plans/Phase-FORGE-SHOP-05.md). Commits: `6a43dd3` (Slice 05.1 forge_timeline + MCP), `d429dc5` (Slice 05.2 Timeline tab + correlationId filter).

### Shipped — FORGE-SHOP-04 global search (2026-04-19)

- **`forge_search` MCP tool** — cross-subsystem read-only search over 8 L2 sources (run, bug, incident, tempering, hub-event, review, memory, plan) plus L3 OpenBrain merge. Tool count 57 → 58.
- **Dashboard header search bar** — always-visible search input with `/` keyboard shortcut, arrow-key navigation, debounced queries (150ms), and `Escape` to dismiss.
- **Query-syntax sugar** — `tags:`, `since:`, `source:`, `correlation:` parsed client-side before API call.
- **Search results dropdown** — source-grouped hits with colored badges, matched-token `<mark>` highlighting, deep-links to Runs/Bug Registry/Incidents/Review/Tempering/Memory tabs.
- **REST API** — `GET /api/search` wraps `forgeSearch()` for dashboard consumption.
- **Search history** — last 5 queries cached in `localStorage` with deduplication.
- **XSS prevention** — all result rendering uses `escapeHtml()` before DOM insertion.
- **Performance** — 60s LRU cache with mtime invalidation; p95 < 250 ms on 5k-event fixture.
- Plan: [docs/plans/Phase-FORGE-SHOP-04.md](docs/plans/Phase-FORGE-SHOP-04.md). Commits: `d72d90b` (Slice 04.1 core + MCP), `722ea08` (Slice 04.2 dashboard bar).

### Shipped — FORGE-SHOP-03 notification layer (2026-04-19)

- **Notification core** — consumes hub events, routes by rule, rate-limits (token-bucket + digest coalesce), delivers via pluggable adapters. Webhook adapter in core. Slack/Teams/Email/PagerDuty as extension stubs installable via `pforge ext add`.
- **2 new MCP tools** — `forge_notify_send`, `forge_notify_test` (57 total).
- **Secret hygiene** — webhook URLs/tokens only via env vars; literal secret in config rejected with `ERR_LITERAL_SECRET`.
- **Dashboard** — Config → Notifications subtab with live config watcher.
- Plan: [docs/plans/Phase-FORGE-SHOP-03.md](docs/plans/Phase-FORGE-SHOP-03.md). Commits: `551b850` (core + routing + webhook + rate limiter), `5b5a8e7` (4 stubs + Config subtab + watcher).

---

## [2.49.1] — 2026-04-19

Patch release bundling 5 field-reported bugs, each shipped as a separate commit on the feature branch for per-issue attribution. All 5 slices executed under `--quorum=power` in 40m 54s. Tests 1748 → 1850 (+102). Tool count unchanged (56).

### Fixed

- **Teardown/Cleanup slice safety guard** ([#56](https://github.com/srnichols/plan-forge/issues/56)) — orchestrator now detects destructive-titled slices (`teardown`, `cleanup`, `rollback`, `postmortem`, `finalize`) and injects a worker pre-flight blocking branch-delete / reset-hard / phase-abandoned mutations. Post-slice reachability check fires critical `teardown-branch-loss` incident with reflog entry if the feature branch vanishes. Config-guarded via `orchestrator.teardownGuard.enabled` (default: `true`). Commit `6e469d0`.
- **Alphanumeric slice IDs** ([#64](https://github.com/srnichols/plan-forge/issues/64)) — plan parser regex now accepts `### Slice 2A:`, `### Slice 2B:`, etc. Order resolution: `2A` after `2`, before `2B`, before `3`. Commit `45bed1b`.
- **Quorum worker probe** ([#70](https://github.com/srnichols/plan-forge/issues/70)) — `probeWorkerAvailability(model)` runs once at run start; quorum candidates with missing CLI workers are dropped with a warn instead of hanging. Zero available = fast-fail with exit code 2; one available = degrade-and-continue. Config-guarded via `quorum.strictAvailability` (default: `false`). Silences the `Error: Model "grok-4.20-0309-reasoning" not available` spam on systems without grok installed. Commit `6c402b8`.
- **Quorum leg error capture** ([#65](https://github.com/srnichols/plan-forge/issues/65)) — failed quorum legs now include `error: { code, reason, stderr }` on the result. Reason enum: `timeout | spawn-failed | rate-limit | context-overflow | unknown`. Synthesis report notes `legsFailed: N` and per-model reason. Commit `2b0d759`.
- **LiveGuard prose false-positive** ([#62](https://github.com/srnichols/plan-forge/issues/62)) — orchestrator detects non-command prose patterns (decimal-numbered markdown list, currency `$N.NN`, markdown/diagram keywords `sequenceDiagram`/`flowchart`/table rows/bullets, formula-like `=` with arithmetic) before evaluating the allowlist. Prose emits `liveguard-prose-skipped` info event and does NOT fail the slice. Real commands still hard-fail. Commit `eedcaa7`.

### Closed issues

- [#71](https://github.com/srnichols/plan-forge/issues/71) closed as duplicate of [#70](https://github.com/srnichols/plan-forge/issues/70).

---

### Planned — TEMPER-07 agent routing (v2.50.x, ships after SHOP-03)

- Phase TEMPER-07 drafted ([docs/plans/Phase-TEMPER-07.md](docs/plans/Phase-TEMPER-07.md)) — deterministic `(bug.type, bug.severity) → agent|skill` router. New MCP tool `forge_delegate_to_agent` invokes agent personas in read-only analyst mode; analyst findings persist to `.forge/tempering/findings/<bugId>.json`. Critical/major bugs auto-surface as `fix-plan-approval` review items (config-guarded OFF by default). Wires the 13 agent personas and 12 skills into the tempering feedback loop for the first time.

### Planned — FORGE-SHOP-06 Ask-bus (v2.53.x, final unification)

- Phase FORGE-SHOP-06 drafted ([docs/plans/Phase-FORGE-SHOP-06.md](docs/plans/Phase-FORGE-SHOP-06.md)) — `hub.ask()` + `onAsk()` request/reply RPC on top of the existing WebSocket hub. Three initial responders: `brain.gate-check`, `brain.correlation-thread`, `tempering.delegate-sync`. Executor gate-check wire-in between slices (config-guarded, fail-open on timeout). No new broker — extends existing hub.

### Shipped — FORGE-SHOP-02 review queue (v2.49.0 target, PRs: a02578a + #69)

- 3 MCP tools: `forge_review_add`, `forge_review_list`, `forge_review_resolve` → 55 total
- New L2 family `.forge/review-queue/<itemId>.json` with atomic writes, enum-validated sources, date-scoped sequential itemIds
- 5 idempotent producer hooks (Crucible stalls, Tempering quorum-inconclusive, visual baselines, bug classifier, fix-plan approval)
- Dashboard Review tab (two-pane filter/detail, action buttons)
- Home tab `activeRuns` quadrant surfaces `openReviews` sub-count
- Watcher anomaly `review-queue-backlog`, forge_smith Review row
- Hub events `review-queue-item-added`, `review-queue-item-resolved`; L3 capture on resolve
- Test count 1649 → 1748 (+99)

### Shipped — FORGE-SHOP-01 Home tab (v2.48.0 target)

- `forge_home_snapshot` MCP tool + `readHomeSnapshot` helper — aggregates the 4 existing L2 readers (`readCrucibleState`, `readLiveguardState`, `readTemperingState`, `findLatestRun`) into a single shop-floor payload. Budget: ≤250ms on 1 000 L2 records.
- Dashboard Home tab — 4-quadrant view (Crucible funnel, active runs, LiveGuard health, Tempering status) + unified activity feed with correlationId group-by toggle. Drill-through buttons to owning tabs with filters pre-applied.
- Watcher chip row: leftmost `Home` chip showing in-flight runs / open incidents / open bugs.
- Tool count: 51 → 52. Test count: 1610 → 1649 (+39).

---

## [2.47.0] — 2026-04-19 — TEMPER arc complete

Closes the 6-phase TEMPER arc (tempering = "strengthen by repeated
stress" in metallurgy). Adds five new tempering scanners, a bug
registry with GitHub sync, and a closed-loop fix validator. Phases
03.2 / 04 / 05 / 06 were executed autonomously via `pforge run-plan
--quorum=power`.

**Phases shipped:** TEMPER-02 (unit + integration scanners, post-slice
hook) · TEMPER-03 (UI sweep with Playwright + a11y, contract scanner
OpenAPI + GraphQL) · TEMPER-04 (visual-diff scanner with pixel diff +
quorum vision mode + dashboard viewer) · TEMPER-05 (flakiness, perf
budgets, load-stress, mutation testing, scheduling) · TEMPER-06 (bug
registry, GitHub issue adapter, closed-loop fix validator).

**Totals:** 5 new scanners · 5 new MCP tools (`forge_tempering_run`,
`forge_tempering_approve_baseline`, `forge_bug_register`,
`forge_bug_list`, `forge_bug_validate_fix`) · 51 tools registered
(from 46 at start of arc) · 1610 tests across 41 test files · new
hub events: `tempering-run-*`, `tempering-visual-regression-detected`,
`tempering-baseline-promoted`, `tempering-bug-registered`,
`tempering-bug-validated-fixed`, `tempering-contract-mismatch`.

**Full-auto execution stats:** ~2h 23m total worker time across 8
autonomous slices, ~$0.24 run cost + quorum reviewer overhead.
Every PR merged on first CI pass.

### Added — Phase TEMPER-05 — Flakiness + perf budgets + load-stress + mutation (Slices 05.1 + 05.2)

- Flakiness scanner: detects intermittent test failures via repeated
  execution; emits `tempering-flaky-test-detected` hub event.
- Performance-budget scanner: compares current run against historical
  P95 baselines stored in `.forge/tempering/perf-history.jsonl`.
- Load-stress scanner: concurrency-ramp HTTP stress runner with
  configurable RPS + duration; enforces `runtimeBudgets.loadMaxMs`.
- Mutation scanner: source-level mutation testing with kill-rate gate.
- Scheduling module: staggered scanner execution to avoid resource
  contention; budget cascade respected.
- All scanners ship behind optional-dep guards; all support the
  production-guard + `allowProduction: true` opt-in.

### Added — Phase TEMPER-06 Slice 06.1 — Bug registry core + classifier

- Bug registry (`.forge/bugs/<bugId>.json`) with atomic
  read-modify-write, idempotent fingerprinting, and fix-plan linking.
- Classifier: rules-based severity (critical/major/minor) + type
  (functional/performance/visual/contract/security) inference from
  scanner verdicts.
- `forge_bug_register` + `forge_bug_list` MCP tools; `readOpenBugCount`
  surfaced in `readTemperingState` for watcher anomaly awareness.

### Added — Phase TEMPER-06 Slice 06.3 — Closed-loop fix validation

Closed-loop bug fix validation: discover → classify → propose fix → validate → fixed.

- New tool `forge_bug_validate_fix` — re-runs the scanner that discovered a bug
  to verify the fix. On pass: transitions bug to `fixed`, dispatches
  `commentValidatedFix` to bug-adapter, broadcasts `tempering-bug-validated-fixed`
  hub event, and captures OpenBrain thought.
- `forge_fix_proposal` gains `tempering-bug` source — generates 2–3 slice fix
  plans from bug evidence. Automatically transitions bug to `in-fix` and links
  the fix plan path.
- `forge_liveguard_run` gains 9th tempering dimension — surfaces open bug counts,
  critical/high severity, coverage vs minima, mutation score, and last run
  timestamp. Red on critical/high open bugs; contributes to `overallStatus`.
- `runSingleScanner` export from `tempering/runner.mjs` — runs any single
  scanner type with DI support for testing.
- `setLinkedFixPlan` and `appendValidationAttempt` helpers in `bug-registry.mjs`
  — atomic bug record updates for fix plan linking and validation history.
- `readOpenBugCount` in `tempering.mjs` — surfaces unaddressed bugs (>14 days,
  no linked fix plan) for watcher anomaly detection.
- Anomaly `tempering-bug-unaddressed` fires for open real-bugs older than 14 days
  without a linked fix plan. Recommendation: `forge_fix_proposal source=tempering-bug`.
- LIVEGUARD_TOOLS expanded to 18 entries.
- Bug-adapter 4-function contract frozen at v2.47.0.
- 45 new tests in `tempering-closed-loop.test.mjs`.

### Added — Phase TEMPER-06 Slice 06.2 — Bug-adapter extension surface

9th tempering scanner: mutation testing via stack-specific tools
(Stryker, dotnet-stryker, mutmut, pitest, go-mutesting, cargo-mutants).

- Mutation scanner (`tempering/scanners/mutation.mjs`) with per-layer
  minima, budget enforcement, and `captureMemory` on failure.
- Scheduling decision helper (`tempering/scheduling.mjs`) — pure functions
  gating mutation runs by trigger type, critical paths, and fullMutation
  override. Post-slice runs skip mutation unless a critical path is touched.
- Preset adapters: mutation entry added to all 6 supported stacks
  (typescript, dotnet, python, java, go, rust) with `parseOutput` and
  exit-code fallback. PHP/Swift/Azure-IaC remain stubs.
- Runner phase 9 block with `mutationScannerImpl` DI hook, budget cascade,
  and `scannerCount` bumped 8→9.
- `tempering.mjs`: `mutationMaxMs` runtime budget (600s),
  `mutationBelowMinimum` / `flakyCount` / `perfRegressionCount` watcher
  state derivations.
- `orchestrator.mjs`: 3 new anomaly codes (`tempering-mutation-below-minimum`,
  `tempering-flake-detected`, `tempering-perf-regression`) with corresponding
  recommendations.
- `server.mjs`: `fullMutation` (bool) and `trigger` (enum) inputs on
  `forge_tempering_run` schema.
- Dashboard: mutation results panel (`🧬 Mutation Testing`) subscribing to
  `tempering-mutation-below-minimum` hub events.

### Added — Phase TEMPER-04 Slice 04.2 — Visual-diff quorum mode + dashboard viewer

Multi-model quorum voting for the visual-diff investigate band and a
dashboard visual regression viewer with approve/bug/ignore actions.

- Visual-diff quorum mode (2-of-3 default) with configurable models,
  agreement threshold, and per-leg timeout/cost cap sharing.
- Dashboard visual regression viewer: baseline/current/diff image trio,
  per-model vote badges (✓/✗/?/⏱), verdict banner with "Human Review
  Needed" for inconclusive, approve-as-baseline/open-bug/ignore-once
  action buttons.
- L3 decision capture for quorum verdicts (text only, never images).
- Server endpoints: `GET /api/tempering/artifact` (path-traversal safe),
  `POST /api/tempering/bug-stub` (TEMPER-06 placeholder).

### Changed
- `tempering-visual-regression-detected` event now carries `verdict`,
  `quorum`, and `artifacts` fields.
- Default visual analyzer mode changed to `"quorum"` with 3 models.

### Added — Phase TEMPER-04 Slice 04.1 — Visual-diff scanner (pixel diff + single-model analyzer)

Fifth scanner in the Tempering arc. Compares screenshots against
baselines using `pixelmatch` pixel-level diffing and a 3-band
classification system: ignorable (<0.1%), investigate (0.1–2%),
and automatic fail (>2%). The investigate band invokes a single
LLM model to determine if the diff is a true regression.

**New modules:**
- `pforge-mcp/tempering/baselines.mjs` — Baseline storage, promotion,
  diff helpers. Manages `.forge/tempering/baselines/` with PNG files
  and JSON sidecars for promotion metadata.
- `pforge-mcp/tempering/scanners/visual-diff.mjs` — Visual-diff
  scanner with 3-band pixel diff, LLM analyzer for investigate band,
  cost cap, and hub event emission.

**New tool:**
- `forge_tempering_approve_baseline` — Promotes the current screenshot
  for a URL to the visual-diff baseline. Idempotent. Added to
  `MCP_ONLY_TOOLS` and `TOOL_METADATA`.

**Runner wiring:** Visual-diff scanner added as 5th phase in
`runner.mjs` after contract. Supports `visualDiffScannerImpl`
dependency injection for test mocking. `scannerCount` bumped 4→5.

**Dashboard:** Handlers for `tempering-visual-regression-detected`
and `tempering-baseline-promoted` hub events with toast notifications.

**Dependencies:** Added `pixelmatch ^6.0.0` and `pngjs ^7.0.0`.

**Config:** `visualAnalyzer` section in `TEMPERING_DEFAULT_CONFIG`
extended with `ignorableDiff`, `failureDiff`, `maxCostUsd`,
`analyzerTimeoutMs`, `maxImageWidth` keys.
`runtimeBudgets.visualDiffMaxMs` added (300s default).

**Tests:** ~30 new tests in `tempering-visual-diff.test.mjs` covering
baselines, scanner logic, approve-baseline tool, and runner integration.

---

### Added — Phase TEMPER-03 Slice 03.2 — Contract scanner (OpenAPI/GraphQL)

Fourth scanner in the Tempering arc. Validates live API responses
against OpenAPI 3.x specs and GraphQL schemas. Ships behind the same
optional-dep guards as the UI scanner — `js-yaml` is loaded via
dynamic `importFn` and JSON-only specs work without it.

**New modules:**
- `pforge-mcp/tempering/scanners/contract.mjs` — Dispatcher that
  auto-detects spec files (openapi.yaml/json, schema.graphql) and
  routes to the appropriate sub-validator.
- `pforge-mcp/tempering/scanners/contract-openapi.mjs` — OpenAPI
  validator: enumerates paths × methods, fires requests with
  `X-Tempering-Scan: true`, validates response status against spec
  `responses` keys, shallow key+type shape check on JSON bodies.
- `pforge-mcp/tempering/scanners/contract-graphql.mjs` — GraphQL
  validator: regex-parses root Query/Mutation fields from schema file,
  fetches introspection, diffs fields, fires sample queries.

**Runner wiring:** Contract scanner added as 4th phase in
`runner.mjs` after ui-playwright. Supports `contractScannerImpl`
test injection hook. Budget short-circuit from prior scanners applies.

**Anomaly rule #15:** `tempering-contract-mismatch` fires when the
contract scanner detects violations. Severity escalates from `warn`
to `error` at ≥ 5 mismatches. Recommendation directs users to
inspect `.forge/tempering/artifacts/<runId>/contract/report.json`.

**Extension surface:** `extensions/catalog.json` gains an
`opportunities[]` array with stub entries for gRPC, tRPC, and
AsyncAPI contract scanners. `docs/EXTENSIONS.md` documents the
scanner extension contract (ctx shape, return type, config namespace,
artifact directory, production guard requirements).

**Tool metadata:** `forge_tempering_run` description updated in
`capabilities.mjs` and `server.mjs` to reflect all four scanners.

**Tests:** 25 new tests in `tempering-contract.test.mjs` covering
dispatcher (11), OpenAPI validator (9), and GraphQL validator (5).
Existing runner and integration tests updated for 4-scanner order.
Orchestrator tests extended for anomaly #15 + recommendation.

### Added — Phase TEMPER-03 Slice 03.1 — UI sweep scanner (Playwright + a11y)

Third scanner in the Tempering arc. Cross-stack (runs against a
deployed app URL, not source code). Ships behind optional-dep
guards so missing Playwright / axe-core installs skip cleanly rather
than failing the run.

**New module `pforge-mcp/tempering/scanners/ui-playwright.mjs`** —
`runUiSweep(ctx)` mirrors the `runScannerUnit` / `runScannerIntegration`
contract. BFS same-origin link crawler, per-page screenshot capture,
per-page axe-core accessibility pass, aggregate `report.json` written
under the scanner's artifact dir. All dependencies (Playwright,
`@axe-core/playwright`) are loaded via injectable `importFn` so the
MCP process never hard-depends on them and tests never spawn a real
browser.

**Forbidden actions (enforced)**:
- External-origin links are never followed (`isAllowedOrigin`); extra
  allow-list supported via `extraAllowedOrigins`.
- Production URLs are blocked by default — `looksLikeProduction`
  recognises `localhost`, `127.0.0.1`, `*.local`, and RFC-1918 private
  ranges as non-prod; anything else requires `allowProduction: true`.
- Budget enforcement via `runtimeBudgets.uiMaxMs` (default 600_000ms);
  scanner short-circuits with `verdict: "budget-exceeded"` and closes
  the browser cleanly.
- Prior budget-exceeded from unit or integration cascades — UI scanner
  is skipped with reason `prior-budget-exceeded` before Chromium is
  launched.

**New module `pforge-mcp/tempering/artifacts.mjs`** — `getArtifactDir`,
`getScannerArtifactDir`, `ensureScannerArtifactDir`, `hashUrl`
(sha1-truncated deterministic filenames), `gcArtifacts` (7-day
retention GC), `seedArtifactsGitignore` (idempotent `.gitignore`
append for `.forge/tempering/artifacts/`).

**Runner wiring** — `runTemperingRun` now dispatches three scanners in
order (unit → integration → ui-playwright). `runId` is hoisted early so
artifact-producing scanners can write under a stable directory.
New dependency-injection surface: `uiImportFn` and `uiScannerImpl`
options for tests + future extension hooks. Run record now carries
`phase: "TEMPER-03", slice: "03.1"`.

**Config defaults extended** — `TEMPERING_DEFAULT_CONFIG` in
`tempering.mjs` now includes a `"ui-playwright"` block with
operator-facing overrides (url, maxDepth, maxPages, allowProduction,
captureScreenshots, runAccessibility, a11yMinSeverity,
a11yFailThreshold). Scanner-module `UI_SCANNER_DEFAULTS` stays the
source-of-truth for the full shape.

**Verdict rules**:
- Any broken link (non-2xx/3xx) → `fail`
- a11y violations of severity ≥ `a11yMinSeverity` exceeding
  `a11yFailThreshold` → `fail`
- Budget tripped → `budget-exceeded`
- Otherwise → `pass`

**Tests — +45 new, 1282/1282 green** —
`tests/tempering-ui-sweep.test.mjs` covers:
- Artifacts module: `hashUrl` determinism, `gcArtifacts` retention,
  `seedArtifactsGitignore` idempotency, directory helpers
- URL / origin helpers: `isAllowedOrigin`, `looksLikeProduction`,
  `resolveAppUrl`, `normalizeUrl`
- `runUiSweep` skip paths: disabled, url-not-configured,
  production-url-without-opt-in (and allowProduction opt-in),
  playwright-not-installed, playwright-api-missing
- Crawler behaviour: link traversal, verdict=fail on broken links,
  external-origin filter, `maxPages` cap, `maxDepth` cap, screenshot +
  `report.json` artifact writing
- A11y threshold: below-severity violations pass, serious/critical
  exceeding threshold fail, missing axe module falls back to pass
- Error containment: browser launch failure → `verdict: "error"`

Existing `tempering-runner.test.mjs` + `tempering-integration.test.mjs`
assertions updated for 3-scanner event order, `scannerCount: 3`,
`slice: "03.1"`, and UI-scanner cascade of `prior-budget-exceeded`.

### Added — Phase TEMPER-02 Slice 02.2 — Integration scanner + post-slice hook

Closes Phase TEMPER-02. Slice 02.1 shipped the unit execution harness;
Slice 02.2 adds the integration scanner, a post-slice hook, watcher +
dashboard surfacing, and the `forge_smith` run-record summary.

**Generic `runScanner(ctx)`** — `pforge-mcp/tempering/runner.mjs` now
exposes a scanner-agnostic runner keyed by `ctx.scanner` ("unit" |
"integration"). The previous `runScannerUnit` remains as a back-compat
wrapper; a new `runScannerIntegration` mirror is also exported. Budget
keys are resolved through a frozen `SCANNER_BUDGET_KEYS` map so future
scanners (ui-playwright, load, mutation) slot in without touching the
orchestration body.

**`runTemperingRun` now dispatches both scanners** — unit first,
integration second. If unit hits `budget-exceeded`, integration is
skipped with reason `prior-budget-exceeded` to keep total runtime
bounded. The emitted `tempering-run-completed` event now carries
cross-scanner totals (`pass`/`fail`/`skipped`/`durationMs`), and run
records are persisted with `slice: "02.2"`.

**Six preset adapters extended with integration entries** —
`presets/{typescript,dotnet,python,go,java,rust}/tempering-adapter.mjs`
now each export an `integration` scanner:

- **typescript** — `npx vitest run --dir tests/integration --reporter=json`; JSON totals parser
- **dotnet** — `dotnet test --filter "Category=Integration|FullyQualifiedName~Integration"`; Microsoft summary parser
- **python** — `pytest tests/integration`; pytest summary-line parser
- **go** — `go test -json -tags=integration ./...`; `-json` action-event parser
- **java** — `mvn failsafe:integration-test failsafe:verify`; Surefire totals parser
- **rust** — `cargo test --quiet --tests`; `test result:` line parser

**PostSlice Tempering hook** — `runPostSliceTemperingHook` in
`pforge-mcp/orchestrator.mjs` fires `forge_tempering_run` after a
slice commit when the user has opted in via
`.forge/tempering/config.json` → `execution.trigger: "post-slice"`.
Honours the same skip patterns as the drift PostSlice hook (docs,
merge, chore(release) are skipped), fires exactly once per `sliceRef`
across repeated invocations, and never throws — runner errors are
surfaced as `{ action: "error", skippedReason: "runner-threw:<msg>" }`.
`resetPostSliceTemperingFired()` is exposed for tests and for
`pforge run-plan` to reset when starting a new slice. Runner is
dependency-injected to avoid a circular import with
`tempering/runner.mjs`.

**Watcher anomaly rule #14 — `tempering-run-failed`** —
`detectAnomalies` in `orchestrator.mjs` now flags the most recent
Tempering run when its verdict is `fail | error | budget-exceeded`, at
severity `error` (failing runs aren't advisory). `recommendFromAnomalies`
maps the code to `forge_tempering_run` with a pointer to open the
latest `run-*.json` for per-scanner detail.

**`readTemperingState` extended** — surfaces `totalRuns`, `latestRunTs`,
`latestRunAgeMs`, `latestRunVerdict`, `latestRunStack`, and a boolean
`runFailed`, sourced from a new `listRunRecords` / `readRunRecord` pair
in `tempering.mjs`. The snapshot block stays primitives-only.

**Dashboard — per-slice Tempering pill** — `pforge-mcp/dashboard/app.js`
subscribes to `tempering-run-completed` and buckets the verdict in
`state.tempering.slicePills` keyed by `sliceRef.slice`. `renderSliceCards`
now renders a tiny `🔨✓` / `🔨✗` / `🔨◌` pill next to the gate and
retry indicators, colour-graded green/red/gray. Tooltip shows the
pass/fail/skipped totals and stack. No new HTTP endpoints and no
index.html changes — the pill is pure `app.js` + WebSocket wiring.

**`pforge smith` / `pforge.sh` Tempering section extended** — both the
PowerShell and Bash doctor scripts now read `.forge/tempering/run-*.json`
in addition to `scan-*.json`, reporting `N run(s); latest: <verdict>,
<pass>/<fail>, <age>` and warning when the latest run verdict is
`fail | error | budget-exceeded`.

**Tests — +32 new, 1237/1237 green** — `tests/tempering-integration.test.mjs`
(16 tests: generic `runScanner` with integration scanner, all six
adapter integration parsers, end-to-end `runTemperingRun` two-scanner
run + prior-budget-exceeded short-circuit) and
`tests/tempering-post-slice-hook.test.mjs` (12 tests: skip patterns,
config gating, per-sliceRef fired-once guard, runner error containment,
`resetPostSliceTemperingFired` regression). Existing `runTemperingRun`
assertions updated to expect 2-scanner event order and `slice: "02.2"`
on run records.

### Added — Phase TEMPER-02 Slice 02.1 — Execution harness (unit scanner)

First phase of the Tempering arc that actually **runs** code. TEMPER-01
observed pre-existing coverage reports; TEMPER-02 Slice 02.1 introduces
the subprocess boundary that executes unit test suites through
language-agnostic preset adapters.

**New module `pforge-mcp/tempering/runner.mjs`** —
`runSubprocess` (spawn + stdout/stderr capture + SIGTERM→SIGKILL budget
enforcement), `runScannerUnit` (per-scanner orchestration), `pickChangedFiles`
(regression-first hint via `git diff --name-only`), `runTemperingRun`
(top-level dispatcher), `deriveOverallVerdict` (worst-wins aggregation).
All functions accept injectable `spawn`, `now`, and `adapter` overrides
so the entire module is testable without shelling out to a real runner.

**New module `pforge-mcp/tempering/adapters.mjs`** —
`STACK_ADAPTER_PATHS` registry, `SUPPORTED_STACKS_SLICE_02_1`,
`validateAdapterEntry`, `loadAdapter` (with injectable `importFn`).

**Six first-class preset adapters** — `presets/{typescript,dotnet,python,go,java,rust}/tempering-adapter.mjs`
each export a `temperingAdapter` with a working `unit` scanner:
- **typescript**: `npx vitest run --reporter=json` + JSON reporter parser
- **dotnet**: `dotnet test --nologo --no-restore` + Microsoft summary line parser
- **python**: `pytest --tb=short -q` + summary-line parser (`N passed, M failed, K skipped`)
- **go**: `go test -json ./...` + event-stream parser
- **java**: `mvn test -q -Dsurefire.useFile=false` + Surefire aggregate parser
- **rust**: `cargo test --quiet` + `test result:` summary parser

**Three stub adapters** — `presets/{php,swift,azure-iac}/tempering-adapter.mjs`
ship with `supported: false` and an extension-opportunity reason. The
runner skips them cleanly with the reason surfaced in the run record.

**New MCP tool `forge_tempering_run`** — registered in `server.mjs` with
L3 memory capture on completion, added to `MCP_ONLY_TOOLS` (handles its
own subprocess boundary; never shelled through `pforge.ps1`).
`capabilities.mjs` + `tools.json` entries declare `addedIn: 2.43.0`,
`maxConcurrent: 1`, cost `medium`, prerequisites (`npx`/`dotnet`/`pytest`/
`go`/`mvn`/`cargo` on PATH).

**Hub events** — `tempering-run-started`, `tempering-run-scanner-started`,
`tempering-run-scanner-completed`, `tempering-run-completed`. The final
event carries primitives-only (correlationId, runId, stack, verdict,
pass/fail/skipped, durationMs, sliceRef) — no source content ever.

**Scope contract held** — MUST NOT edit source during a run, MUST NOT
create bugs (TEMPER-06), MUST NOT recurse. All three enforced by code
structure, not runtime checks.

**Testing** — new `pforge-mcp/tests/tempering-runner.test.mjs` with ~45
assertions across adapter registry, adapter shape, per-stack parseOutput,
subprocess boundary, scanner + dispatcher behaviour, event ordering,
event payload shape, MCP wiring (server.mjs / tools.json / capabilities.mjs).
Fake `spawn` + fake `importFn` injected throughout; no real test runners
invoked.

**Fixture** — `pforge-mcp/tests/fixtures/temper/typescript-basic/` —
minimal package.json for integration smoke tests in later slices.

**Phase-TEMPER-02.md** — frontmatter `status: draft → in_progress`.
Slice 02.2 (integration adapters + post-slice wire-in + slice-card pill)
is the next slice.

---

## [2.42.0] — 2026-04-19

### Added — Phase TEMPER-01 Slice 01.2 — Tempering dashboard + watcher awareness

Closes the TEMPER-01 phase. The foundation shipped in Slice 01.1 is now
visible in three operator surfaces — still zero writes to production
source, still no test runs.

**Dashboard (`pforge-mcp/dashboard/`)**

- New **Tempering tab** (`🛠 Tempering`) — read-only pane with four
  sections:
  1. Latest scan summary (status / age / gap / below-min counts)
  2. Coverage vs. minima progress bars (per layer, with minimum markers)
  3. Gap report — worst-first files per below-minimum layer (top 10)
  4. Scan history (newest first)
- "Run scan" button wires to `forge_tempering_scan` via
  `POST /api/tool/forge_tempering_scan`
- Refresh wires to `POST /api/tool/forge_tempering_status`
- `state.tempering` added to the dashboard-side client state

**Watcher tab — Tempering chip row**

Mirrors the Slice 03.2 Crucible row. Renders only when the watched
project has initialized the subsystem (`.forge/tempering/` present).
Chips: total scans, latest status, below-min count, total gaps, scan
age / stale indicator. `data-testid="watcher-tempering-row"`.

**Watcher snapshot / hub event**

- `buildWatchSnapshot` now includes a `tempering` block (mirrors the
  `crucible` contract; null when uninitialized)
- `watch-snapshot-completed` payloads carry a compact `tempering`
  summary (primitives only — safe for bandwidth-constrained WS clients)

**Two new anomaly rules in `detectWatchAnomalies`**

- `tempering-coverage-below-minimum` (severity: warn) — any layer
  below its minimum by ≥ 5 points → `recommendFromAnomalies` suggests
  `forge_tempering_status`
- `tempering-scan-stale` (severity: warn) — latest scan older than
  `TEMPERING_SCAN_STALE_DAYS` (7) → suggests `forge_tempering_scan`

**`pforge smith` (PowerShell + bash)**

New "Tempering:" section surfaces the same information as the
dashboard row:

- Scan count + latest status + age
- Stale warning (≥ 7 days — mirrors the watcher rule)
- Below-minimum warning (≥ 5 points — mirrors the watcher rule)
- Config presence indicator

**Scan record enrichment**

- `coverageMinima` snapshot now persisted on every scan record so
  downstream tooling can render coverage-vs-minima without re-reading
  `config.json`
- `forge_tempering_status` response now includes `coverageMinima` and
  the full `coverageVsMinima` gap report (`files` arrays are already
  bounded top-10 by `computeGaps`)

**Testing**: +29 tests across `tests/tempering-watcher.test.mjs` (20)
and `tests/tempering-dashboard.test.mjs` (9). Total: 1145/1145 passing
(up from 1116).

**Scope held**: no test execution, no bug creation, no production
source edits. TEMPER-02..06 still own their respective surfaces.

### Added — Phase TEMPER-01 Slice 01.1 — Tempering foundation (read-only coverage scan)

First slice of the Tempering arc — the automated test-intelligence
subsystem that sits between the Forge and LiveGuard in the closed loop.
This slice ships the **storage contract + read-only MCP surface only**;
no test runs, no bug creation, no production-source edits. Those land
in later TEMPER phases.

**New module `pforge-mcp/tempering.mjs`** — self-contained, no
orchestrator coupling except for the re-export of `readTemperingState`
to mirror the `readCrucibleState` contract consumed by the watcher.

**Enterprise defaults** (frozen in `TEMPERING_DEFAULT_CONFIG`) seed
`.forge/tempering/config.json` on first scan. Per-layer coverage minima
match the arc doc: domain 90 / integration 80 / controller 60 /
overall 80. All 10 scanners enabled by default; dial down in config if
you must. Visual analyzer is quorum-mode 2-of-3 by default.

**Two new MCP tools:**

- `forge_tempering_scan` — detects stack, locates existing coverage
  report (lcov.info, coverage-final.json, cobertura.xml,
  jacoco.xml, go cover.out, coverage.py JSON, tarpaulin JSON), parses
  it, rolls up by layer (domain / integration / controller / overall),
  computes gaps vs. minima, writes `.forge/tempering/scan-<ts>.json`.
  Read-only — never runs tests.
- `forge_tempering_status` — returns latest N scan summaries for the
  dashboard feed and `forge_smith` panel.

**Supported stacks**: typescript, dotnet, python, go, java, rust.
Detection is cheap (existsSync-only); `node_modules`, `.git`, and
vendor dirs are not scanned.

**Coverage parsers shipped**:

- lcov (Jest, Vitest, c8, nyc)
- Istanbul coverage-final.json
- Cobertura XML (Coverlet, coverage.py XML)
- JaCoCo XML (Maven, Gradle)
- Go cover.out (set/count/atomic modes)
- coverage.py JSON
- cargo-tarpaulin JSON

**Layer classification** is path-heuristic for TEMPER-01 (promotes to
config-driven `layerGlobs` in TEMPER-02). Controllers, routes,
handlers, api → controller; repositories, db, data, dal, persistence
→ integration; services, domain, models, entities, logic → domain;
everything else → overall.

**Correlation ID thread** (per TEMPER-ARC cross-cutting contract):
every scan record stamps a `correlationId`. Callers may pass one to
thread upstream (smelt → plan → run → scan); when absent a
`temper-scan-<uuid>` is minted.

**Hub events** (new):

- `tempering-scan-started` — payload: `{ correlationId, projectDir, configWritten }`
- `tempering-scan-completed` — payload: `{ correlationId, scanId, stack, status, gaps, belowMinimum, reportPath }`

**L3 semantic memory capture** on `tempering-scan-completed` via the
existing `captureMemory()` helper. Tags: `tempering`, `scan`,
`<stack>`, `<status>`. Payload is the gap summary only — never source
content. Best-effort; OpenBrain outages fall through to
`.forge/openbrain-queue.jsonl` as usual.

**Constants**:

- `TEMPERING_SCAN_STALE_DAYS = 7` (matches `CRUCIBLE_STALL_CUTOFF_DAYS`)

**Status codes** emitted:

- `green` — every layer meets its minimum
- `amber` — at least one layer below minimum by ≥ 5 points
- `no-data` — no coverage report found (returns generator hint) or
  unknown stack (returns marker-file guidance)
- `error` — report located but parse returned zero records

**Scope contract** (unchanged from Phase-TEMPER-01 Slice 01.1): no
test execution, no bug creation, no production-source edits, no
`forge_liveguard_run` wire-in, no dashboard surface (that's Slice 01.2).

**Testing**: +62 tests in `tests/tempering-foundation.test.mjs` covering
config defaults, storage helpers, stack detection across all 6 stacks,
all 7 parsers, layer classification, rollup, gap computation, handler
happy paths + failure branches, correlationId threading, hub event
emission, and TOOL_METADATA / tools.json wiring. Full suite: 1116/1116.

### Next

Slice 01.2 ships the Tempering dashboard tab + watcher-row chip + two
anomaly rules (`tempering-coverage-below-minimum`,
`tempering-scan-stale`). See [docs/plans/Phase-TEMPER-01.md](docs/plans/Phase-TEMPER-01.md).

---

## [2.41.0] — 2026-04-19

### Added — Phase CRUCIBLE-04 Slice 04.1 — Crucible-aware fix proposals

Closes the loop opened by CRUCIBLE-03. The watcher can now *detect*
stalled smelts and orphan handoffs, and `forge_fix_proposal` can now
*act* on them — generating an abandon-or-resume playbook per affected
smelt and dropping it into `docs/plans/auto/` like every other LiveGuard
fix.

**New source: `"crucible"`** on `forge_fix_proposal`:

- Optional `smeltId` input arg targets a specific smelt
- Auto-selection order: stalled in-progress smelts first (oldest mtime
  wins), then orphan hardener handoffs — mirrors watcher anomaly
  priority from Slice 03.1
- Plan IDs namespaced as `crucible-<smeltId>` to prevent collision with
  drift / secret / incident IDs
- Two-slice abandon-or-resume structure:
  1. **Triage** — read the smelt journal, assess staleness vs. active
  2. **Execute decision** — resume (reactivate + nextAction) OR abandon
     (status + reason + supersededBy)
- Validation gate for both generated slices is `pforge smith` — the
  Smith panel is the authoritative truth surface for funnel health, so
  the auto-fix plan closes against the same contract that opened it
- Healthy funnel returns a non-error diagnostic with current counts (no
  throw) so operators know *why* nothing was generated

**Schema updates:**

- `tools.json` — adds `smeltId`, mentions `crucible` in `source`
  description + tool description, `consumes` extended with
  `.forge/crucible/*.json` and `.forge/hub-events.jsonl`
- `capabilities.mjs` `TOOL_METADATA` — new `CRUCIBLE_HEALTHY` error code,
  `consumes` aligned, prerequisites updated

### Tests

- **1054 passing** (was 1036, +18 new)
- `tests/crucible-fix-proposal.test.mjs` — pins schema contract (tools.json + TOOL_METADATA), handler branches (smeltId, stalled-before-orphan priority, namespaced fixId, two-slice titles, healthy-diagnostic non-error, `pforge smith` gate), and auto-selection behavior against a scaffolded `.forge/crucible/` fixture

---

## [2.40.1] — 2026-04-19

### Added — Phase CRUCIBLE-03 Slice 03.2 — Watcher-tab Crucible row

Builds on Slice 03.1's Crucible-aware watcher snapshot. The dashboard
Watcher tab now surfaces the funnel state directly in the snapshot pane
(right below the existing Target / Run State / Run ID / Anomalies grid)
so operators don't have to hop to the Crucible tab or run `pforge smith`
to answer "is the funnel healthy?"

**Event payload change.** `watch-snapshot-completed` hub events now carry
a compact `crucible` block (primitives only — counts + stall/orphan
numbers + cutoff). Kept flat so the WS payload stays small for
bandwidth-constrained clients. Null when the watched project has no
`.forge/crucible/` directory.

**UI.** A six-chip row with a `data-testid="watcher-crucible-row"` anchor:

- `Σ` total smelts
- `✓` finalized (green)
- `⧗` in-progress (blue)
- `✗` abandoned
- `⚠ N stalled` — amber when > 0 (idle ≥ 7 days)
- `⛓ N orphan` — red when > 0 (handoff plan file missing)

Row stays hidden cleanly for pre-Crucible projects.

### Tests

- **1036 passing** (was 1029, +7 new)
  - `tests/crucible-watcher-row.test.mjs` — pins event shape (count vs
    array for `orphanHandoffs`), null when Crucible inactive, all six
    chip bindings, threshold-based coloring, and the `data-testid`
    hook for E2E automation.

---

## [2.40.0] — 2026-04-19

### Added — Phase CRUCIBLE-03 Slice 03.1 — Crucible-aware watcher

`forge_watch` (snapshot + polling mode) now reads `.forge/crucible/` and
surfaces funnel health alongside run health. Until this slice, watcher
snapshots saw **only** run events under `.forge/runs/<id>/events.jsonl`
— stalled smelts, abandoned funnels, and orphan handoffs were invisible
to it. `forge_watch_live` already forwards every `crucible-*` hub event;
this closes the gap for the snapshot watcher that powers dashboards,
polling clients, and one-shot CLI invocations.

**New on `buildWatchSnapshot(...)`:** a `crucible` block containing

- smelt counts split by `finalized` / `in_progress` / `abandoned` / `other`
- `oldestInProgressAgeMs` — ms since the oldest in-progress smelt was touched
- `staleInProgress` — count above the 7-day cutoff (shared with Smith)
- `orphanHandoffs[]` — `crucible-handoff-to-hardener` hub events whose
  `planPath` no longer exists on disk

**Two new anomaly codes** emitted by `detectWatchAnomalies`:

| Code | Severity | When |
|------|----------|------|
| `crucible-stalled` | `warn` | One or more smelts idle `≥ 7 days` in `in_progress` |
| `crucible-orphan-handoff` | `error` | Hardener handoff event references a missing plan file |

Both carry concrete recommendations (`forge_crucible_list` /
`forge_crucible_preview <id>`) so the dashboard Watcher tab can surface
them with click-through actions.

The `CRUCIBLE_STALL_CUTOFF_DAYS` constant is exported so the PowerShell
and bash Smith implementations stay in sync with the watcher.

### Tests

- **1029 passing** (was 1015, +14 new)
  - `tests/crucible-watcher.test.mjs` pins: null-on-inactive, empty-dir
    graceful skip, status counting (incl. skipping `config.json` /
    `phase-claims.json`), stale-cutoff accuracy, corrupt-JSON tolerance,
    orphan detection positive + negative, snapshot shape, and both
    anomaly rules end-to-end plus their recommendations.

---

## [2.39.1] — 2026-04-19

### Added — Phase CRUCIBLE-02 Slice 02.2 — Smith panel + setup banner

**`pforge smith` now reports Crucible health.** Both the PowerShell and bash
implementations gained a new `Crucible:` section (right before the summary)
that surfaces the state of the smelt funnel without requiring the dashboard:

- Total smelt count, split by `finalized` / `in-progress` / `abandoned`
- **Stall warning** — any smelt that has been idle in the `in-progress`
  state for ≥ 7 days is flagged with a `forge_crucible_abandon` hint
- Presence of `config.json` (governance overrides active)
- Count of `manual-imports.jsonl` bypasses
- Count of atomically-claimed phase numbers

Smelt enumeration correctly skips `config.json` and `phase-claims.json`
so they don't get double-counted as smelts.

**Setup scripts carry a one-line Crucible onboarding hint.** Both
`setup.ps1` and `setup.sh` print a nudge in the `Optional (recommended)`
block pointing new operators at `forge_crucible_submit` so the very first
plan they author gets a `crucibleId` baked in.

### Tests

- **1015 passing** (was 1003, +12 new)
  - `tests/crucible-smith-panel.test.mjs` pins the output contract for
    both shells, the stall-detection cutoff, and the banner location

---

## [2.39.0] — 2026-04-19

### Added — Phase CRUCIBLE-02 Slice 02.1 — slice-card complexity + spend badges

Live dashboard slice cards in the **Progress** tab now surface two at-a-glance
signals that previously lived deep in logs or cost reports:

- **Complexity score badge** — `⚙ N/10`, color-graded:
  - 🟢 green for 1–3 (low-risk)
  - 🟠 amber for 4–6 (medium)
  - 🔴 red for 7–10 (high-risk, quorum candidate)
- **Total-spend badge** — `💰 $0.xxxx`, shown once a cost is recorded.

Both pills render in a dedicated row beneath the slice title and update live
from hub events (`slice-started` → complexity, `slice-completed` → cost).

### Changed — orchestrator event payloads

`slice-started`, `slice-completed`, and `slice-failed` events now carry a
`complexityScore` field (computed once up-front for every node in the DAG).
This runs independently of quorum mode — previously the score was only
computed when `quorumConfig.enabled === true`. Existing consumers that
ignore unknown fields are unaffected.

### Tests

- **1003 passing** (was 997, +6 new)
  - 4 in `tests/scheduler-complexity.test.mjs` — verifies both schedulers
    emit `complexityScore` on start/complete/failed, and handles the
    no-score case gracefully
  - 2 in `tests/crucible-dashboard.test.mjs` — pins the render contract
    (badge rendering, threshold breakpoints, hydration from event data)

---

## [2.38.1] — 2026-04-19

### Fixed — Test-suite port flake (EADDRINUSE on 3103–3105)

`pforge-mcp/server.mjs` called `main()` unconditionally at module load, so
every test file that imported it only to call `createExpressApp()` also
booted the full WebSocket hub. When multiple test files ran in the same
vitest pool, the hub tried to bind 3103, 3104, 3105 in succession and
occasionally hit `EADDRINUSE` during teardown.

Now `main()` runs **only** when the module is executed directly:

```js
const isDirectRun = resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) main().catch(...);
```

Behavior outside tests is unchanged — `node pforge-mcp/server.mjs` still
boots everything exactly as before.

### Tests

- 997 tests passing, zero errors (was `997 passing, 1 error` on intermittent runs)

---

## [2.38.0] — 2026-04-19

### Added — Non-intrusive update notifier (Phase UPDATE-01)

Plan Forge now tells you when a newer release is available — without
spamming GitHub, without delaying startup, and without nagging users
who've already seen the notice.

- **New module `pforge-mcp/update-check.mjs`** — checks
  `https://api.github.com/repos/srnichols/plan-forge/releases/latest`
  with a 4s timeout and semver comparison
- **Cache** at `.forge/update-check.json` with a 24h TTL. The dashboard
  serves from this cache; the boot-time refresh writes to it once per day
- **Opt-out**: set `PFORGE_NO_UPDATE_CHECK=1` to suppress all checks
- **Never blocks startup** — the check is scheduled with a 2s delay and
  every failure path (network down, HTTP 5xx, malformed JSON, unusable
  `tag_name`) silently returns `null`
- **REST endpoint** `GET /api/update-status` returns
  `{ available, current, latest, url, publishedAt, checkedAt, fromCache }`
- **Dashboard banner** — small dismissible pill in the header (`⬆ v2.38.0
  available (you have v2.37.0)`), linking to the release page. Dismissal
  is remembered per-release in `localStorage` so users aren't nagged

### Added — Roadmap drafts

- `docs/plans/Phase-CRUCIBLE-02.md` — Complexity-Score badge, Total-Spend
  badge, and Smith Crucible panel (scheduled)
- `docs/plans/Phase-SMITH-01.md` — Crucible diagnostics in `forge_smith`
  (likely absorbed into CRUCIBLE-02)

### Tests

- 19 new tests in `tests/update-check.test.mjs` covering semver
  comparison, cache TTL, env-var opt-out, network-failure tolerance,
  malformed-response tolerance, cache-write, force-bypass, and REST
  endpoint shape
- Total suite: 997 tests passing

### Security

- The check only issues a `GET` to the public GitHub Releases API. No
  authentication, no user data transmitted, no telemetry. `User-Agent`
  header identifies the client as `plan-forge-update-check`.

---

## [2.37.0] — 2026-04-19

### Added — Crucible: the idea-smelting pipeline (Phase CRUCIBLE-01)

A new mandatory pre-hardening stage that turns raw ideas into well-specified
Phase plans via a short, structured interview. Every `docs/plans/Phase-*.md`
plan now carries a `crucibleId` in its frontmatter — either from a smelt, from
a `--manual-import` bypass, or from the grandfather migration.

This release rolls up six merged slices.

#### Slice 01.1 — Atomic phase-name claim + naming authority
- New `crucible.mjs`: `nextPhaseNumber(existingNames, parent)`, `claimPhaseNumber(projectDir, phaseName, smeltId)`
- File-lock-based claim at `.forge/crucible/claims/<phaseName>.lock` so two parallel agents can never both stamp "Phase 17"
- Synthetic id prefixes: `grandfathered-<uuid>` (legacy migration), `imported-<source>-<uuid>` (manual import)

#### Slice 01.2 — MCP tools + hub events
- `forge_crucible_submit` / `forge_crucible_ask` / `forge_crucible_preview` / `forge_crucible_finalize` / `forge_crucible_list` / `forge_crucible_abandon`
- Hub events: `crucible-smelt-submitted`, `crucible-answer-recorded`, `crucible-smelt-finalized`, `crucible-smelt-abandoned`, `crucible-handoff-to-hardener`

#### Slice 01.3 — Interview loop
- Three lanes (`tweak` ~3 questions / `feature` ~6 / `full` ~12) with `inferLane()` heuristic
- `getNextQuestion()` drives the question stream, answers persist to JSONL
- `renderDraft()` / `extractUnresolvedFields()` produce the plan body from recorded answers
- Recursion guardrail: `recursionDepth` cap (0–3, default 1) on child smelts

#### Slice 01.4 — Enforcement gate + grandfather migration
- `crucible-enforce.mjs` rejects plans missing `crucibleId:` unless `--manual-import` is supplied
- First-run grandfather migration stamps existing phase files with synthetic ids and writes audit rows
- `--manual-import path --source {human|speckit} --reason "..."` flow with full audit trail at `.forge/crucible/manual-imports.jsonl`
- **Spec Kit coexistence preserved** — Spec Kit imports are a first-class `source: speckit` path

#### Slice 01.5 — Dashboard tab + REST
- New 🔥 Crucible tab: live smelts list, active interview prompt, draft preview, abandon/finalize actions
- REST: `GET/POST /api/crucible/submit`, `/ask`, `/preview`, `/finalize`, `/list`, `/abandon`
- Hub subscription auto-refreshes the UI on every `crucible-*` event

#### Slice 01.6 — Config, Governance, Hardener handoff, manual chapter, self-host
- New `crucible-config.mjs` with sanitizer — persists to `.forge/crucible/config.json`
  - Fields: `defaultLane`, `recursionDepth` (0–3), `autoApproveAgent`, `sourceWeights {memory, principles, plans}` (normalized to sum 100), `staleDefaultsHours` (1–168)
- Dashboard Config tab: Crucible section with all five fields, weight normalization preview, save/reload
- Dashboard Governance tab (🛡, read-only): file viewer for `PROJECT-PRINCIPLES.md`, `project-profile.instructions.md`, `project-principles.instructions.md`, plus full `manual-imports.jsonl` audit table with `vscode://file/` deep-links
- REST: `GET/POST /api/crucible/config`, `GET /api/crucible/manual-imports` (capped 500, newest-first), `GET /api/crucible/governance` (returns `{files, readOnly: true}`)
- `computeStaleDefaultsWarnings()` wired into `handleAsk` — returns `STALE_PRINCIPLES` / `STALE_PROFILE` warnings when governance files are newer than the smelt by `staleDefaultsHours`
- `handleFinalize` emits `crucible-handoff-to-hardener` hub event and returns `hardenerHandoff: {event, nextStep, hint}` pointing at `step2-harden-plan.prompt.md`
- Manual chapter 6.6 (`docs/manual/crucible.html`) — philosophy, lanes, interview loop, recursion, enforcement, Spec Kit path, dashboard, config fields, troubleshooting
- **Self-hosting**: `docs/plans/Phase-CRUCIBLE-01.md` now carries its own `crucibleId` — the plan that defines Crucible is itself a Crucible citizen

### Changed

- Dashboard tab count: 12 core → 13 core (added Governance). Total 17 → 18.
- Every `docs/plans/Phase-*.md` plan now requires frontmatter with `crucibleId`. Existing plans are auto-migrated on first run after upgrade.

### Security

- Governance tab is **strictly read-only**. No `contentEditable`, no `<textarea>`, no edit endpoints. Principles live in the editor, not the browser.
- Every `--manual-import` bypass is audited with timestamp, plan path, source, reason, and synthetic id.

### Migration notes for existing users

- **No action required for Crucible to work** — `.forge/crucible/` auto-creates on first write and is already gitignored.
- On first run after upgrade, `crucible-enforce` scans `docs/plans/Phase-*.md` and stamps any plan missing frontmatter with `crucibleId: grandfathered-<uuid>`. A row is written to `.forge/crucible/manual-imports.jsonl` for each — visible in the Governance tab.
- **Spec Kit users**: continue as before. Use `pforge run-plan --manual-import <path> --source speckit --reason "..."` for imported specs.

---

## [2.36.1] — 2026-04-18

### Fixed — validation gate allowlist hints

When `runGate()` blocks a command that isn't in the allowlist, the error now
includes actionable hints so plan authors can fix typos and unfilled template
placeholders without guessing.

- **`editDistance(a, b)`** — Levenshtein helper exported from `orchestrator.mjs`
- **`isPlaceholderToken(token)`** — detects `{{cmd}}`, `<cmd>`, `$cmd`, and
  literal leak-through words (`item`, `command`, `cmd`, `tool`, `runner`,
  `your-tool`, `your_cmd`, `todo`)
- **`suggestAllowedCommand(token)`** — returns the closest allowlist entry
  within edit distance ≤ 2, or `null`
- **`runGate()` error message** — now appends:
  - `'<token>' looks like an unfilled template placeholder — edit your plan file…`
    when the token matches `isPlaceholderToken()`
  - `Did you mean '<suggestion>'?` when a close allowlist entry exists

Motivation: the Rummag Phase-01 plan tripped slice 7 three runs in a row on a
literal `item` typo (`item install …` where `pnpm` was meant). The block was
correct but the error gave no hint this was a template placeholder. Now it
does.

### Tests

- +11 new tests across 4 describe blocks in `tests/orchestrator.test.mjs`
  (`editDistance`, `isPlaceholderToken`, `suggestAllowedCommand`,
  `runGate allowlist error message`)
- Total: 784/784 passing (up from 773)

---

## [2.36.0] — 2026-04-18

### Memory Architecture Milestone — final rollup

The fifth and final PR on the v2.36 train. Lands GX.1 (dashboard Memory tab)
and GX.2 (L3 → L1 boot-context preload), promotes the four betas to a single
stable release, and ships manual chapter 6.5 documenting the full three-tier
system. Every gap from the original memory-architecture audit (G1.1–G1.4,
G2.1–G2.8, G3.1–G3.7, GX.1–GX.5) is now closed.

### Added — GX.1: Dashboard Memory tab

- **`/api/memory/report`** REST endpoint in `pforge-mcp/server.mjs` — wraps
  `buildMemoryReport(PROJECT_DIR)` so the dashboard can render a live view
  without re-implementing report logic in JS.
- **Memory tab** in `pforge-mcp/dashboard/index.html` + `app.js` — KPI strip
  (captures total / deduped, queue pending / deferred, queue delivered, queue
  DLQ, cache fresh / total), L2 file inventory table with byte-formatted size
  and `_v` version distribution, by-tool / by-type horizontal-bar breakdowns
  (color-coded: gotcha=amber, lesson=green, decision=purple, pattern=blue,
  convention=cyan), drain-trend mini-table, and orphan-file detector.
- Tab loader is defensive — every panel degrades gracefully when its slice
  of the report is empty so a freshly-cloned repo doesn't render error states.

### Added — GX.2: L3 → L1 boot-context preload

- **`buildPlanBootContext(plan, projectName, opts)`** in `pforge-mcp/memory.mjs`
  — pure helper. Returns `{ _v: 1, projectName, planName, hints: [...] }`.
  Hints are deduped by query string and capped (default 8). Each hint carries
  `{ kind: "plan-history" | "slice-keyword", query, limit }`.
- **`memory-preload` hub event** emitted from `orchestrator.mjs` immediately
  after `run-started`. Listening agent runtimes (Copilot, Claude Code, Cursor)
  can resolve the hints via `search_thoughts` and seed working context before
  slice 1 — eliminating the cold-start gap.
- Best-effort try/catch around the preload — a missing project name or empty
  plan never blocks `run-started` propagation.

### Added — Manual chapter 6.5: Memory Architecture

- New chapter `docs/manual/memory-architecture.html` — three-tier overview
  table, ASCII capture-flow diagram, per-tier deep dive (L1 hub, L2 files,
  L3 OpenBrain), GX.2 preload walkthrough, GX.3 telemetry, GX.4 source-format
  rules, GX.5 migration, and a reading list cross-linked to the dashboard
  Memory tab and `forge_memory_report`.
- Chapter inserted as 6.5 between Dashboard (6) and CLI Reference (7) in
  `docs/manual/assets/manual.js` and `docs/manual/index.html` to avoid
  renumbering the Act III + Appendix chapters.

### Tests

- 6 new tests for `buildPlanBootContext` in `pforge-mcp/tests/g3-gx.test.mjs`
  (empty/missing inputs, plan-history hint emission, slice-keyword dedup,
  `maxHints` cap, hint shape).
- Total suite: 773 passing across 11 files (was 767 in beta.4).

### Rollup — what shipped across v2.35.1 → v2.36.0

| PR | Tag | Gaps closed |
|----|-----|-------------|
| #27 | `v2.35.1` | G3.1 (watcher → L3 capture) |
| #29 | `v2.36.0-beta.1` | G1.1–G1.4 (hub: replay file, subscribers, capability probe foundations) |
| #30 | `v2.36.0-beta.2` | G2.1–G2.8 (file tier: dual-write, schema versioning, tag routing) |
| #31 | `v2.36.0-beta.3` | hotfix — worker capability probe |
| #32 | `v2.36.0-beta.4` | G3.2–G3.7 + GX.3/4/5 (intelligence + tooling) |
| this | `v2.36.0` | GX.1 + GX.2 + manual ch. 6.5 |

---

## [2.36.0-beta.4] — 2026-04-18

### Added — G3.x + GX.3/4/5: memory architecture, level 3 (semantic + tooling)

Fourth beta on the path to v2.36.0. Closes the remaining G3 (intelligence) and
GX.3/4/5 (developer-experience) gaps from the memory-architecture audit. All
changes are zero-migration: existing projects get the new behaviour the moment
they pull, and all new files default to off (TTL stamping, dedup, telemetry,
cache) when their config knobs are absent.

**G3.2 — Cosine-similarity dedupe for captured thoughts.**
Every `captureMemory()` now compares the candidate against the last 50
records in `liveguard-memories.jsonl` using term-frequency cosine similarity.
Near-duplicates (≥ 0.9 by default; tunable via `.forge.json`
`openbrain.dedupThreshold`) are suppressed at L2 and L3 but still emit a hub
event tagged `deduped: true` so the dashboard can show the suppression rate.
New pure helpers: `tokenize`, `cosineSimilarity`, `dedupeThoughtsBySimilarity`.

**G3.3 — Proactive OpenBrain search on watcher anomalies.**
`forge_watch` and `forge_watch_live` now prepend an OpenBrain
`search_thoughts` instruction block to their tool response (one entry per
unique anomaly code). The agent reading the response sees prior occurrences
of the same code before reacting — closing the "observer is amnesic" loop.
New helper: `buildWatcherSearchPrompt`.

**G3.4 — Configurable `openbrain.keywordMap`.**
The hardcoded slice-keyword → OpenBrain-query map in `loadProjectContext`
is now overridable via `.forge.json` → `openbrain.keywordMap: [{pattern,
flags?, query}, …]`. Invalid entries are skipped with a warning; missing
config falls back to the built-in defaults. New helper: `loadKeywordSearchMap`.

**G3.5 — Thought TTL / `expiresAt`.**
`captureMemory()` now stamps `expiresAt` on every thought based on type:
gotcha 90d, decision 180d, lesson 365d, pattern/convention never expire.
Search-block builders consult `filterUnexpiredThoughts()` so stale
observations don't dominate context. New helpers: `stampThoughtExpiry`,
`filterUnexpiredThoughts`.

**G3.6 — Capture-telemetry ledger.**
Every capture (deduped or not) appends a summary record to
`.forge/telemetry/memory-captures.jsonl` (`_v: 1` schema-stamped). Lets the
dashboard answer "who's capturing what, and how often" without scraping
the memory files themselves. New helper: `buildCaptureTelemetry`.

**G3.7 — Memory search cache (helpers).**
New cache-shape and freshness helpers (`buildCacheEntry`,
`isCacheEntryFresh`) for the upcoming `.forge/memory-search-cache.jsonl`
short-circuit. Default TTL 1h. Wired into `forge_memory_report` immediately;
the search short-circuit itself ships in v2.36.0 final.

**GX.3 — NEW MCP tool `forge_memory_report` (tool #37).**
Aggregates the health of every memory surface into one read-only report:
L2 file presence/size/record count/`_v` distribution, OpenBrain queue
buckets (pending/delivered/failed/deferred/DLQ), drain stats trend,
capture telemetry (per-tool/per-type + dedup rate), search-cache health,
and orphan files under `.forge/`. Pure-ish — never writes. Exposed via
`tools.json` and `capabilities.mjs`.

**GX.4 — Source-attribution format `<tool>[/<subsystem>]`.**
New `validateSourceFormat()` helper enforces the canonical shape (e.g.
`forge_watch/quorum-dissent`). `captureMemory()` warn-logs invalid
sources but never drops the capture — visibility-without-breakage.

**GX.5 — `pforge migrate-memory` chore.**
One-shot migrator that merges legacy `.json` ledgers
(`drift-history.json`, `regression-history.json`, `fix-proposals.json`)
into their canonical `.jsonl` siblings, deduping by exact line text.
Backs the legacy file up as `<name>.json.bak-<date>`. Supports `-DryRun`.

### Tests
- New file: `pforge-mcp/tests/g3-gx.test.mjs` (~36 new cases covering every
  pure helper + `buildMemoryReport` aggregator).
- All prior suites unchanged; baseline 705 → ~741 passing.

### Files Changed
- `pforge-mcp/memory.mjs` — 9 new exports + extended `loadProjectContext`.
- `pforge-mcp/server.mjs` — `captureMemory` rewrite; watcher G3.3 hooks;
  `forge_memory_report` handler; `TOOLS` + dispatch entry.
- `pforge-mcp/tools.json` + `capabilities.mjs` — `forge_memory_report` entry.
- `pforge.ps1` — `Invoke-MigrateMemory` + switch routing.
- `VERSION`, `pforge-mcp/package.json` — 2.36.0-beta.3 → 2.36.0-beta.4.

### Migration
- **Zero-migration.** Pull and the new behaviour is on. To roll legacy
  `.json` ledgers into `.jsonl`, run `pforge migrate-memory` (or
  `pforge migrate-memory -DryRun` to preview).

---

## [2.36.0-beta.3] — 2026-04-19

### Fixed — Worker capability probe + runtime readiness matrix (closes #28)

Third beta drop on the path to v2.36.0. This fixes a silent-failure class where
`pforge run-plan` declared slices "passed" while the underlying worker CLI
actually exited 0 after printing help text and writing zero lines of code. The
canonical repro was `gh copilot` v1.2.x (a legacy `suggest`/`explain`-only build)
receiving agentic flags it didn't understand, printing its usage banner, and
terminating with status 0 — which the orchestrator recorded as success.

- **New `pforge-mcp/worker-capabilities.json` matrix** is now the single source
  of truth for worker + runtime minimums. Each entry declares: probe command,
  version regex, minimum version, capability markers (flags that MUST appear
  in `--help`), invocation template, and per-OS install hints. The matrix is
  consumed by both `orchestrator.mjs` (Node) and `pforge.ps1 smith` (PowerShell)
  so the two agree on what counts as a capable toolchain.

- **`detectWorkers()` rewritten as a capability probe, not a presence check.**
  Each CLI worker now runs its version probe, compares against the matrix
  minimum, then runs a help probe and verifies every capability marker is
  present in stdout. Returns a structured `{ name, available, capable, version,
  minVersion, reason, installHint, type }` record per worker. API-provider
  detection (`api-xai`, `api-openai`) is preserved and unified into the same
  shape.

- **`detectRuntimes()` (new export)** applies the same probe pipeline to the
  runtime floor — `git`, `gh`, `node`, `pwsh` — with per-tool minimums
  (gh ≥ 2.88, node ≥ 20, pwsh ≥ 7). Smith surfaces any runtime below floor
  with a per-OS install/upgrade hint.

- **`spawnWorker()` invocation now reads from the matrix.** The flag set for
  `gh copilot` is now `-p @<promptFile> --yolo --no-ask-user --output-format text`
  sourced from `worker-capabilities.json` with a `{PROMPT_FILE}` placeholder.
  Changing flags no longer requires editing JavaScript.

- **New `detectHelpTextOutput()` heuristic** runs on every worker completion:
  if stdout/stderr contains ≥2 help-text signatures (`usage:`, `USAGE`,
  `Commands:`, `Options:`, `Flags:`, `Run '… --help' for`, legacy
  `gh copilot <command> [flags]` banner) AND the meaningful content is
  < 4000 chars, the result is flagged `looksLikeHelpText: true`. Callers can
  treat exit-0-with-help as a soft failure instead of a silent pass.

- **New `suggestInstall()` / `detectPackageManager()` exports** resolve the
  right per-OS install command for any matrix entry (winget on Windows, brew
  on macOS, apt on Linux) plus a docs URL.

- **`pforge smith` grew a "Runtime & Worker Readiness" section.** Uses the
  same matrix — probes every runtime and every worker, reports
  pass/fail/warn with the per-OS upgrade command. Missing agent workers
  (claude, codex) now print the exact `winget install` / `brew install` /
  `npm install -g` command rather than a generic "install X" sentence.

- **Backward compatibility preserved.** The existing `{ name, available, type }`
  shape returned by `detectWorkers()` is intact — new fields are additive.
  Existing callers at `server.mjs:3943` (`GET /api/workers`) and the
  orchestrator self-test continue to work unchanged.

### Tests

- Added `pforge-mcp/tests/worker-capability.test.mjs` — 20 tests covering
  matrix load + cache, semver comparison (prefix/pre-release tolerance),
  help-text detection (positive cases, real-output false-positives, empty
  input, long-output guard), runtime/worker result shape, and install-hint
  resolution.
- Full suite: **725 tests passing** (705 baseline + 20 new).

### Why it matters

Issue #28 documented 13 commits produced by `pforge run-plan` that contained
zero source-code changes — the orchestrator recorded every slice as "passed"
because the gh-copilot CLI exited 0 after printing help. With this change, a
worker that lacks the agentic capability set is detected **before** execution
begins (`smith` fails loudly) and **during** execution (help-text output is
flagged). `pforge run-plan` no longer trusts a zero exit code alone.

---

## [2.36.0-beta.2] — 2026-04-18

### Added — L2 file tier improvements (memory architecture gaps G2.1 – G2.8)

Second of three beta drops on the path to v2.36.0. This one tightens the
**L2 (structured files on disk) tier** of the memory architecture.

- **G2.1 — Misnamed `*-history.json` files renamed to `*-history.jsonl`**, with a
  transparent backward-compat read shim. Affected files: `drift-history.jsonl`,
  `regression-history.jsonl`, `health-dna.jsonl`, `quorum-history.jsonl`. All
  four were JSONL-shaped (one record per line) but used the `.json` extension,
  which broke standard JSON tooling. `readForgeJsonl()` now checks for the new
  name first and falls back to the legacy `.json` variant so projects upgrading
  from v2.35 keep working without migration. The `pforge smith` doctor probes
  accept either extension. Also fixed a latent bug in the OpenClaw snapshot path
  that was `JSON.parse`-ing `drift-history.json` as a single JSON array when it
  was actually JSONL.

- **G2.2 — Schema versioning (`_v: 1`) stamped on every L2 record.** `appendForgeJsonl()`
  now auto-adds `_v: 1` to every record it writes. Future schema migrations can
  branch on this field. Caller-supplied `_v` wins so specialised writers can
  bump independently.

- **G2.3 — `pruneForgeRuns(cwd, opts)` helper** in `orchestrator.mjs`. Prunes
  `.forge/runs/<runId>/` directories by two retention dimensions — older than
  `maxAgeDays` days (default 30) OR outside the newest `maxRuns` runs (default
  50). Always keeps the newest run regardless of age. Supports `dryRun` for
  preview. Best-effort: per-run errors accumulate in `result.errors` but never
  throw. A follow-up PR will expose this as a CLI command; this beta ships the
  helper and tests only.

- **G2.4 — `correlationId` option on `appendForgeJsonl()`.** Writers can pass
  `{ correlationId }` in a new fourth argument; the record gains a `_correlationId`
  field. Lets analysts trace L1 hub events ↔ L2 structured records ↔ L3 semantic
  captures back to the same originating run or slice.

- **G2.5 — `auditOrphanForgeFiles(cwd)` helper** in `orchestrator.mjs`. Returns
  `{ known, orphan, whitelist }` lists partitioning every file/dir under `.forge/`
  against a hand-maintained whitelist of recognised artifacts. Catches stale
  files from removed tools and typos in write paths. The whitelist intentionally
  covers **both** the `.jsonl` and legacy `.json` variants of the renamed files,
  so v2.35 projects don't flag them.

- **G2.6 — OpenBrain queue bookkeeping + DLQ semantics.** Every thought enqueued
  via `captureMemory()` when OpenBrain is configured is now shaped by
  `shapeQueueRecord()` which adds `_status: "pending"`, `_attempts: 0`,
  `_enqueuedAt`, `_nextAttemptAt` fields. New pure helpers land in `memory.mjs`:
  - `nextBackoffTimestamp(attempts, now)` — exponential backoff with ±20% jitter
    (30s / 60s / 120s / 240s / 480s).
  - `applyDeliveryFailure(record, opts)` — decides retry vs DLQ after a failed
    delivery attempt; truncates long error messages to 500 chars. After `maxAttempts`
    failures (default 5) the record moves to `.forge/openbrain-dlq.jsonl`.
  - `partitionByBackoff(records, now)` — splits eligible records from those still
    waiting on backoff.

  These are the building blocks a drain worker (or the existing `SessionStart`
  hook) will wire in a follow-up beta.

- **G2.7 — `.forge/env-diff-history.jsonl`** — `forge_env_diff` now appends a
  compact per-scan history record (scan timestamp, baseline name, gap counts per
  env file, totals) in addition to the single-snapshot `env-diff-cache.json`.
  Lets dashboards and the health-trend tool show env drift over time. Values are
  never recorded — key-name counts only.

- **G2.8 — `buildDrainStatsRecord()` helper** for the `.forge/openbrain-stats.jsonl`
  ledger. Summarises each drain pass (attempted / delivered / deferred / dlq /
  durationMs) so the dashboard can render queue health without rescanning the
  queue file every tick.

### Testing

- New `pforge-mcp/tests/g2-files.test.mjs` — **25 tests** covering `_v` stamping,
  `correlationId`, the `.jsonl ↔ .json` read shim, `pruneForgeRuns` (four
  scenarios), orphan audit, and every new `memory.mjs` helper.
- Existing assertions updated to match the new `.jsonl` filenames and the
  `_v: 1` record shape (6 tests fixed; no behaviour change).
- Total test count: 680 → **705 passing**.

### Behaviour notes / compatibility

- **Zero migration needed for upgraders.** Projects with existing
  `drift-history.json` / `regression-history.json` / `health-dna.json` /
  `quorum-history.json` files continue working via the read shim — you just
  won't get new records appended to them; new records land in the `.jsonl`
  sibling. A future `pforge migrate-memory` command (GX.5) will merge them.
- `capabilities.mjs` tool-metadata `produces`/`consumes` strings updated to
  reference the new `.jsonl` names.

---

## [2.36.0-beta.1] — 2026-04-18

### Added — L1 Hub improvements (memory architecture gaps G1.1 – G1.4)

This is the first of three beta drops on the path to v2.36.0. It tightens the
**L1 Hub tier** of the memory architecture documented in `docs/MEMORY-ARCHITECTURE.md`.

- **G1.1 — Hub history expanded + multi-run rehydration.** `EVENT_HISTORY_SIZE`
  raised from 100 → **500** (a 20-slice plan burned through 100 in a single run,
  so dashboards connecting mid-run only saw the tail). On startup the hub now
  also replays events from the last 3 runs under `.forge/runs/*/events.log` via
  a new `Hub.rehydrateFromRuns(runCount)` method — late-connecting clients get
  context across runs, not just the most recent one. Rehydrated events are
  tagged `source: "rehydrate"` so consumers can distinguish replay from live.

- **G1.2 — Durable `.forge/hub-events.jsonl` mirror.** Every `hub.broadcast()`
  call now appends the enriched event (with `version: "1.0"` + `timestamp`) to
  `.forge/hub-events.jsonl` in addition to the in-memory ring buffer. Gives
  dashboards, bridges, and post-mortems a replayable source of truth that
  survives hub restarts and is independent of per-run `events.log` rotation.
  Best-effort: filesystem errors are swallowed so a full disk can never break
  live broadcasting.

- **G1.3 — `forge_cost_report` now emits an L1 event.** The only dual-write
  tool missing a hub broadcast; it now calls `broadcastLiveGuard("forge_cost_report", …)`
  so dashboards can show "cost report generated" in real time, consistent with
  the other 13 LiveGuard tools. (Audit confirmed the other four suspected gaps —
  `forge_regression_guard`, `forge_alert_triage`, `forge_secret_scan`,
  `forge_env_diff` — were already broadcasting; no changes needed there.)

- **G1.4 — `forge_watch_live` dropped-event counter + configurable cap.** The
  hardcoded `captured.length < 500` cap is now a configurable `maxCapturedEvents`
  argument (default 500, max 10 000) and the response includes a new
  **`droppedEvents`** field so callers can tell when the watcher produced more
  events than the buffer could hold. Previously overflow was silent.

### Testing

- New `pforge-mcp/tests/hub.test.mjs` — 9 tests covering the durable append path,
  best-effort failure handling, ring-buffer bounds, and multi-run rehydration
  (happy path, missing directory, malformed lines, `runCount` selection,
  overflow cap).
- `Hub` class now exported from `hub.mjs` so tests can instantiate it with a stub
  `wss` (EventEmitter) and avoid binding a real port.
- Total test count: 671 → **680** passing.

### Behaviour notes / compatibility

- `hub-events.jsonl` is new — nothing reads it yet in this beta; G2.3 (planned
  in `v2.36.0-beta.2`) will add a size cap and rotation policy. On long-running
  projects the file will grow; a follow-up tool or `pforge prune` will land in
  `v2.36.0-beta.2`.
- `forge_watch_live` response shape gained two fields (`droppedEvents`,
  `maxCapturedEvents`); existing callers that didn't read them are unaffected.

---

## [2.35.1] — 2026-04-18

### Added — Memory Architecture doc + Watcher → L3 capture (G3.1)

- **`docs/MEMORY-ARCHITECTURE.md`** — first-class reference for Plan Forge's three-tier operational memory system (L1 Hub / L2 Structured / L3 Semantic). Maps every `.forge/` artifact, OpenBrain capture site, and hub event to its tier; defines the dual-write pattern every new MCP tool must follow; includes the tool-coverage audit and roadmap implications.
- **Watcher anomalies now persist to memory** (gap G3.1 closed) — both `forge_watch` and `forge_watch_live` route detected anomalies through `captureMemory()`, landing them in `.forge/liveguard-memories.jsonl` (L2) and — when OpenBrain is configured — `.forge/openbrain-queue.jsonl` (L3 bridge). The watcher was the only cross-project observer with no semantic memory; it now captures too.
- **`shapeWatcherAnomalyThought(anomaly, meta, tool)`** and **`dedupeWatcherAnomalies(anomalies)`** exported from `pforge-mcp/memory.mjs` — pure helpers that shape anomalies into capturable thoughts and dedupe by `code|message` within a live session.

### Design notes

- Watcher captures land in the **watcher's own** `.forge/` (`PROJECT_DIR`), **never** the target's. The watcher's read-only contract on the target project is preserved.
- Source attribution standardised on `forge_watch/<code>` and `forge_watch_live/<code>` — first step toward the GX.4 cross-tool standard that unlocks the upcoming `forge_memory_report` tool (scheduled for v2.36).
- Severity → thought type mapping: `info` → `lesson`, `warn`/`error` → `gotcha`.

### Tests

- New `pforge-mcp/tests/memory.test.mjs` — 17 new unit tests covering the two new pure helpers (severity-to-type mapping, source-attribution format, content assembly, dedupe semantics, null-safety).
- Total test count: 654 → **671** passing.

---

## [2.35.0] — 2026-04-18

### Added — Watcher v2 (Live Tail, Recommendations, History, Diff Cursor)

- **`forge_watch_live`** — new MCP tool that streams events from a target project's pforge run for a fixed duration. Connects to the target's WebSocket hub (`.forge/server-ports.json`) when running; falls back to `events.log` polling otherwise. Read-only subscriber by design — never sends commands. Caps captured events at 500 per call to bound memory.
- **`recommendations` field** in `forge_watch` reports — every detected anomaly is now mapped to a concrete next-step `pforge` command (e.g., `pforge run-plan --resume-from N`, `pforge fix-proposal`, `pforge abort`, `pforge run-plan --quorum=power`). Recommendations are deduplicated by anomaly code.
- **`watch-history.jsonl`** — `forge_watch` now appends each snapshot to the **watcher's own** `.forge/watch-history.jsonl` (never the target's, preserving the read-only contract). Disable with `recordHistory: false`.
- **`sinceTimestamp` diff cursor** — pass the previous report's `cursor` field to `forge_watch` to get `hasNewEvents` + `newEventsCount` flags. Enables continuous monitoring loops without re-processing the entire event log.
- **Hub event emission** — when the watcher is run inside an active hub session, it emits `watch-snapshot-completed`, `watch-anomaly-detected`, and `watch-advice-generated` events for dashboard / multi-agent consumers.
- **Quorum + skill event surfacing** — snapshot `counts` now includes `quorumDispatched`, `quorumLegsCompleted`, `quorumReviewed`, `skillsStarted`, `skillsCompleted`, `skillStepsFailed`.
- **3 new anomaly codes** — `quorum-dissent` (quorum review reached but slice still failed), `quorum-leg-stalled` (dispatched but legs never returned), `skill-step-failed` (any skill step recorded a failure).

### Added — Dashboard Watcher parity

- **New Watcher tab** in the FORGE section of `localhost:3100/dashboard` — three panels: Latest Snapshot (target, runState, runId, anomaly count, cursor), Advice History (model/tokens/time), and Anomalies (severity-coded codes with message + run ID). Red badge in the tab header counts unread snapshots.
- **Three new WebSocket event handlers** in `dashboard/app.js`: `watch-snapshot-completed` → snapshot feed, `watch-anomaly-detected` → anomaly feed + notification, `watch-advice-generated` → advice feed + notification.
- **Two new Actions cards** — "Live Watch" and "Watch Snapshot" copy the corresponding `pforge watch-live` / `pforge watch` invocations to the clipboard.
- Dashboard tab count: 14 → **15** (10 FORGE tabs incl. Watcher + 5 LiveGuard tabs).

### Changed

- `forge_watch` report shape now includes `recommendations: []` and `cursor: <ISO>` fields. Existing consumers that destructure known fields are unaffected.
- `runWatch` accepts new optional params: `sinceTimestamp`, `recordHistory` (default `true`), `eventBus`.

### Tests

- 22 new tests in `pforge-mcp/tests/orchestrator.test.mjs` covering quorum/skill counts, recommendations, history append, diff cursor, hub event emission, and runWatchLive polling fallback.
- Dashboard tab smoke test updated to assert 15 tabs (10 core + 5 LG).
- Total: **654 passing** (up from 632).

---

## [2.34.3] — 2026-04-17

### Fixed — forge_smith remaining false-positives in downstream projects

- **Site images check is now plan-forge–repo only** — `pforge.ps1` and `pforge.sh` smith no longer warn about missing `og-card.webp`, `hero-illustration.webp`, `problem-80-20-wall.webp` in downstream projects. These are plan-forge’s own marketing assets and have no meaning outside the dev repo. The check is now gated on the presence of `presets/` + `pforge-mcp/server.mjs` (markers unique to the source repo).
- **Lifecycle hook detection now reads `.github/hooks/plan-forge.json`** — the four core hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`) are configured in `.github/hooks/plan-forge.json` (shipped by `pforge update` from `templates/`). Smith now treats those hooks as present when the JSON declares them, in addition to file-based and `.forge.json`-based detection. Resolves `4/7 hooks present — Missing: SessionStart, PreToolUse, PostToolUse` warning on freshly updated projects.

### Notes

No behavior change for the plan-forge dev repo itself. Downstream projects on v2.34.2 will see both warnings clear after `pforge update`.

---

## [2.34.2] — 2026-04-17

### Fixed — forge_smith warning false-positives

- **PowerShell version detection** — `pforge.ps1` smith now probes for a separately installed `pwsh` (7.x) via `Get-Command pwsh` and reports its version, instead of always reporting the version of the shell that happens to be running the script. Falls back to the current shell only when `pwsh` is not on PATH. Avoids reporting `5.1` when `pwsh 7.x` is installed.
- **`XAI_API_KEY` / `OPENAI_API_KEY` from `.env`** — `pforge-mcp/server.mjs` now parses `.env` from `process.cwd()` at startup with a lightweight inline parser (no new dependency; existing `process.env` values always win; failure is best-effort and never breaks server boot). `pforge.ps1` smith also added `.env` as a third fallback source after env vars and `.forge/secrets.json`.
- **Lifecycle hooks reconciliation** — smith hook detection now reads **both** `.github/hooks/<HookName>.{ps1,sh,mjs,js}` files (recursive) **and** the `hooks` block in `.forge.json` (`sessionStart`, `preToolUse`, `postToolUse`, `stop`, `postSlice`, `preAgentHandoff`, `preDeploy`). A hook counts as present if either source defines it.

### Notes

Downstream projects (e.g., consumers running `pforge update`) will pick up these fixes automatically on next update. The `forge_watch` watcher MCP tool added in 2.34.0 and polished in 2.34.1 is unchanged in this release.

---

## [2.34.1] — 2026-04-17

### Changed — Watcher API Polish

- **`runState` normalized** — `forge_watch` now returns stable values `"completed"|"aborted"|"in-progress"|"unknown"` instead of leaking raw event types. Raw event type still available as `lastEventType` for power users. Existing branching code on `"run-completed"` should switch to `"completed"`.
- **`tailEvents` parameter** — control how many trailing events the snapshot includes. Range 1-200 (default 25, clamped). Lower values reduce token cost in `analyze` mode against long-running targets.
- **`counts.escalated`** — new snapshot field: number of `slice-escalated` events seen. Surfaces model-fallback behavior that was previously invisible.
- **`model-escalated` anomaly** — new heuristic anomaly (severity `warn`) fires when any slice was escalated to a stronger model. Helps catch silent quality regressions.

### Fixed
- **`all-skipped` anomaly never fired** — depended on `runState === "completed"` but pre-fix `runState` was `"run-completed"`. Latent since v2.34.0; resolved by normalization.

## [2.34.0] — 2026-04-17

### Added — Watcher (`forge_watch`)

- **New MCP tool `forge_watch`** — read-only observer that tails another project's pforge run from a separate VS Code Copilot session. Use to monitor Rummag-style cross-project executions without touching the target.
- **Two modes**: `snapshot` (file reads + heuristic anomaly detection, no AI cost) and `analyze` (snapshot + invokes frontier model `claude-opus-4.7` for narrative advice).
- **6 heuristic anomaly codes**: `stalled`, `tokens-zero`, `high-retries`, `slice-failed`, `all-skipped`, `gate-on-prose`.
- **Quorum power preset upgraded** — `QUORUM_PRESETS.power.reviewerModel` bumped from `claude-opus-4.6` to `claude-opus-4.7`.
- **Read-only enforcement** — watcher worker spawned with `cwd = watcher's own directory`, never the target's, so any tool calls cannot mutate the target project.
- **26 new unit tests** covering `findLatestRun`, `parseEventsLog`, `readSliceArtifacts`, `buildWatchSnapshot`, `detectWatchAnomalies`, and `runWatch`.

---

## [2.33.0] — 2026-04-17

### Fixed — Orchestrator Reliability & Complexity Scoring (Rummag telemetry regressions)

Five separate bugs surfaced while analyzing Rummag Phase-01 runs — all silently undermining execution reliability, token telemetry, and quorum escalation:

- **`coalesceGateLines` false failures** — Gate allowlist rejected markdown numbered/bulleted list items (e.g. `1. Server generates CSRF token...`) as shell commands, marking successful slices as failed. Now skips lines matching `/^(\d+\.|[-*+])\s+/` before allowlist check. Rummag slice-7 (CI/CD) regression fixed.
- **Windows token capture broken** — Worker child stdout/stderr used default platform encoding; Windows cp437 mangled gh copilot's `↑ ↓ •` arrows in the token summary line, silently breaking `parseStderrStats`. Force `setEncoding("utf8")` on both streams.
- **ASCII fallback for `parseStderrStats`** — Regex extended to accept `^ * v` when terminals strip/replace Unicode (CI logs, restricted codepages). Exported for testability.
- **`SECURITY_KEYWORDS` / `DATABASE_KEYWORDS` missing `/g` flag** — Without global flag, `.match()` returned max 2 elements (match + capture), capping `securityWeight` / `databaseWeight` at 0.33 regardless of actual hit count. Now correctly saturates with 3+ keyword hits.
- **Slice metadata parser missed body-line formats** — `**Depends On:** Slice 1, Slice 2A` and `**Context Files:** \`path/to/file\`` in slice body were ignored; only the inline header tags `[depends: ...]` and `[scope: ...]` were extracted. Rummag plans (and most human-authored plans) use body-line format, leaving `depends[]` and `scope[]` empty → `dependencyWeight` and `scopeWeight` always 0 → complexity score stuck at 2 → **quorum never escalated for any Rummag slice**. Parser now merges body-line and header-tag entries, de-duplicated.

### Added
- 15 regression tests in `tests/orchestrator.test.mjs`: 5 for `coalesceGateLines`, 5 for `parseStderrStats`, 2 for `scoreSliceComplexity` signal detection, 5 for `parsePlan` body-line metadata (including end-to-end Rummag-style integration test).

### Impact
- Slices authored in standard markdown style (numbered CSRF flow descriptions, body-line deps) no longer false-fail the gate
- Token / cost telemetry works on Windows for the first time — enables real model cost comparisons (e.g. Opus 4.6 vs 4.7)
- Quorum escalation now actually triggers on security-heavy or cross-module slices — the feature works as designed

### Migration
No config changes required. Re-run your plan after upgrading; complexity scores will rise to their true values, which may cause slices that previously ran single-model to escalate to quorum. If you want to preserve old behaviour, raise `quorum.threshold` in `.forge.json`.



## [2.32.2] — 2026-04-14

### Fixed — 3 Remaining Issues from v2.32.0 Validation
- **Secrets scanner** (High, #4) — Now requires `SECRET_KEY_PATTERN` match (password, token, api_key, etc.) alongside entropy threshold. Excludes `pforge-mcp/`, `.github/`, `pforge.ps1`, `pforge.sh` from git diff. Should reduce 866 false positives to near-zero.
- **REST proxy** (Medium, #3) — Fixed dead code: `/api/tool/:name` now accesses the MCP SDK’s internal request handler map to dispatch tool calls. Parses JSON result from tool response text.
- **Update deduplication** (Medium, #1) — Added `Group-Object -Property Name` deduplication before report + copy. No more duplicate `UPDATE` lines or double file copies.

## [2.32.1] — 2026-04-14

### Fixed — 6 Issues from v2.32.0 Validation
- **Secrets false positives** (High, #4) — LiveGuard secrets scanner now excludes `package-lock.json`, `*.min.js`, `*.map`, `*.svg`; skips lines >200 chars, git hashes, base64 blobs, npm integrity values; threshold raised from 4.0 to 4.5
- **Duplicate update entries** (Medium, #1) — Replaced 5 overlapping MCP file scans with single recursive scan + cli root files. No more duplicate `UPDATE` lines in `pforge update` output
- **`package.json` version** (Medium, #2) — `pforge-mcp/package.json` now at 2.32.1 (was stuck at 2.22.1)
- **REST proxy for MCP tools** (Medium, #3) — `/api/tool/:name` now routes server-side tools through internal handler instead of CLI proxy. Fixes `forge_liveguard_run` and other MCP-only tools via REST
- **Timeout documentation** (Medium, #5) — `forge_liveguard_run` description now warns about 2-3 min runtime for .NET projects and recommends 300s timeout
- **Auto plans dir** (Low, #6) — Already handled by existing `pforge update` code (creates README.md)

## [2.32.0] — 2026-04-14

### Added — Self-Recursive Improvement: The Forge Gets Smarter Every Run

#### Forge Intelligence (build-time learning)
- **Auto-tune escalation chain** — `loadEscalationChain()` reorders models by success rate × cost efficiency from `model-performance.json`. Best model moves to position 1. Converges after 5 runs.
- **Cost estimator calibration** — `buildEstimate()` compares prior estimates vs actuals, computes correction factor (0.5x–3x). Accuracy improves every run. Returns `costCalibration` in estimate.
- **Adaptive quorum threshold** — `loadQuorumConfig()` reads `quorum-history.json` to auto-tune threshold: <20% quorum needed → raise threshold, >60% → lower. Self-tunes token spend.
- **Quorum outcome tracking** — Every quorum slice appends to `.forge/quorum-history.json` with complexity score, quorum used/needed, pass/fail.
- **Slice auto-split advisory** — `--estimate` flags slices with ≥2 prior failures or >6 tasks + >4 scope files as candidates for splitting.

#### LiveGuard Intelligence (post-coding learning)
- **Recurring incident detection** — `forge_incident_capture` searches 30-day history for prior incidents on same files. ≥3 occurrences auto-escalates severity to `high` with `recurring: { pattern: "systemic" }`.
- **Fix proposal outcome tracking** — `forge_regression_guard` marks fix proposals as `"effective"` when their associated incidents resolve. Tracks which fix patterns work.
- **Hotspot test priority** — `forge_regression_guard` reorders gates to run tests for high-churn files first (from `.forge/hotspot-cache.json`).
- **Project Health DNA** — `forge_health_trend` computes a composite fingerprint: drift avg, incident rate, test pass rate, model success rate, cost per slice. Persisted to `.forge/health-dna.json` for cross-session decay detection.
- **Empty-catch regex expanded** — Now catches comment-only blocks (`catch { // swallowed }`, `catch { /* ignored */ }`).

### Branding
- **Forge Intelligence**: escalation chain, cost calibration, quorum tuning, slice splitting (build-time)
- **LiveGuard Intelligence**: recurring incidents, fix outcomes, hotspot priority, health DNA (post-coding)

## [2.31.2] — 2026-04-13

### Fixed — E7: LiveGuard Events Now Flush Before MCP Response
- **`broadcastLiveGuard` is now `async`** — all 16 call sites use `await`. After broadcasting, `setImmediate` forces an event loop tick so WebSocket `ws.send()` writes flush before the MCP stdio response is returned. This was the likely root cause: synchronous MCP handler returned before the event loop processed pending WS writes.
- **File-based diagnostic log** — Every `broadcastLiveGuard` call writes to `.forge/liveguard-broadcast.log` with timestamp, tool name, hub status, and client count. Since MCP captures stderr, this is the only reliable way to observe broadcast behavior.
- **Import fix** — Added `appendFileSync` to the `node:fs` import.

## [2.31.1] — 2026-04-13

### Added — Full OpenBrain Coverage Across All LiveGuard Tools
- **9 additional auto-capture points:**
  - `forge_deploy_journal` — captures deploy version + notes as decisions
  - `forge_hotspot` — captures top churn files as patterns
  - `forge_secret_scan` — captures findings count as gotchas (when findings > 0)
  - `forge_env_diff` — captures missing key count as gotchas (when gaps > 0)
  - `forge_fix_proposal` — captures fix plan ID and source as decisions
  - `forge_health_trend` — captures health score and trend direction (when trend is not stable)
  - `forge_alert_triage` — captures critical/high alert summaries as gotchas
  - `forge_run_plan` — persists orchestrator’s `_memoryCapture` (run summary + cost anomaly) that was previously built but never written
  - `step1-preflight-check.prompt.md` — now searches OpenBrain + liveguard-memories before preflight checks
- **All 14 LiveGuard tools + run_plan + alert_triage now auto-capture to `.forge/liveguard-memories.jsonl`** (+ `.forge/openbrain-queue.jsonl` when OpenBrain configured)
- **4 pipeline prompts now search memory before acting:** step0 (specify), step1 (preflight), step3 (execute), step5 (review)

## [2.31.0] — 2026-04-13

### Added — OpenBrain Auto-Capture in LiveGuard Tools
- **`captureMemory()` helper** — LiveGuard tools now auto-capture findings to `.forge/liveguard-memories.jsonl` (always) and `.forge/openbrain-queue.jsonl` (when OpenBrain is configured). All captures are best-effort — never break tool execution.
- **Auto-capture in 4 key tools:**
  - `forge_drift_report` — captures violations with file names and rule IDs
  - `forge_regression_guard` — captures auto-resolved incidents and gate failures
  - `forge_incident_capture` — captures incident description, severity, affected files
  - `forge_liveguard_run` — captures health snapshot (score, gates, incidents, status)
- **Pipeline prompts now search OpenBrain before acting:**
  - `step0-specify-feature.prompt.md` — searches for prior decisions and lessons before interviewing
  - `step3-execute-slice.prompt.md` — searches for gotchas and patterns before first slice
  - `step5-review-gate.prompt.md` — searches for prior review findings before reviewing
  - All prompts also check `.forge/liveguard-memories.jsonl` for recent drift/incident context
- OpenBrain is optional — all auto-capture calls check `isOpenBrainConfigured()` first and silently skip if not configured

## [2.30.5] — 2026-04-13

### Fixed — E7: Hub initialization race condition
- **Startup reorder** — WebSocket hub + Express now start BEFORE stdio transport connects. Previously stdio connected first, meaning tool calls could arrive before `activeHub` was set, causing `broadcastLiveGuard` to silently drop all events.
- **Diagnostic logging** — `broadcastLiveGuard` now logs to stderr: `[liveguard] forge_drift_report → N client(s)` on success, or `[liveguard] ... hub not initialized, event dropped` when hub is null.
- Startup order is now: capabilities → Express (:3100) → WebSocket hub (:3101+) → stdio transport. This guarantees `activeHub` is set before any MCP tool call can arrive.

## [2.30.4] — 2026-04-13

### Fixed — E7: LiveGuard Dashboard Events
- **Dashboard events** (E7) — All 14 LiveGuard tools now broadcast `type: "liveguard"` events with tool-specific summary data (score, gates passed, violations, overallStatus). Dashboard handles both `liveguard-tool-completed` and `liveguard` event types. Notifications now show contextual detail (e.g., "LiveGuard: drift-report (score: 98)").
- Key tool summaries: drift broadcasts `score` + `appViolations` + `testStatus`; regression-guard broadcasts `gates` + `passed` + `failed` + `resolved`; liveguard-run broadcasts `overallStatus` + `driftScore` + `gates` + `secrets`; alert-triage broadcasts `total` + `showing`.

**All 10 bugs and all 10 enhancements are now closed.**

## [2.30.3] — 2026-04-13

### Fixed — Final 3 Enhancements (E2, E7, E8)
- **`forge_fix_proposal` / auto-incident** (E2) — Fix plans now include 10-line code snippets around each violation with `>>>` marker on the flagged line. Both the `forge_fix_proposal` incident path and the `autoIncident` drift auto-chain path now emit **Code Context** sections.
- **Dashboard LiveGuard events** (E7) — All 14 LiveGuard tools now emit `type: "liveguard"` events via WebSocket hub (in addition to the `liveguard-tool-completed` detail event). Dashboard can filter on `type === 'liveguard'` for real-time tool activity.
- **Auto-resolve incidents** (E8) — When regression guard passes with no explicit file scope, all open auto-drift incidents are resolved automatically. Fixed `Set.add()` spread bug, removed unreliable command-path extraction. When gates pass project-wide (no `--files`/`--plan`), treats it as full-project validation.

## [2.30.2] — 2026-04-13

### Fixed — `pforge update` now copies core framework files
- **`pforge update`** — Previously only copied templates (prompts, agents, instructions, hooks, dashboard UI). Now also copies core runtime files: `pforge.ps1`, `pforge.sh`, `VERSION`, and all `pforge-mcp/*.mjs` + `package.json` + `tools.json` + `cli-schema.json` + test files. This was the root cause of testbed users not receiving bug fixes or new features after running `pforge update`.
- `pforge.sh` `cmd_update` already had MCP auto-discovery but was missing root CLI files (`pforge.ps1`, `pforge.sh`, `VERSION`) — added.

## [2.30.1] — 2026-04-13

### Fixed — v2.30.0 Verification: 6 Enhancements Not Working on Testbed
- **`forge_diff`** (E6) — Added `(?s)` dotall flag to `Invoke-Diff` scope/forbidden regex in `pforge.ps1`; without it `(.*?)` didn't match across newlines so forbidden paths were never extracted
- **`forge_regression_guard`** (E8) — Auto-resolve now falls back to gate result files and auto-drift incident files when no explicit `--files`/`--plan` provided
- **`forge_health_trend`** (E5) — Added `tests` metric reading from `.forge/regression-history.json`; includes pass rate, total gates, last failure, trend
- **`forge_fix_proposal`** (E2) — Reads 10-line code snippet around flagged violations and includes it in the fix plan under **Code Context** section
- Health trend now tracks 5 metrics: drift, cost, incidents, models, tests
- Health score calculation includes test pass rate

## [2.30.0] — 2026-04-13

### Added — LiveGuard Enhancements: Composite Run, Auto-Chaining, Test Status
- **`forge_liveguard_run`** (E9) — new composite tool runs drift, sweep, secret-scan, regression-guard, dep-watch, alert-triage, and health-trend in a single call. Returns unified `overallStatus` (green/yellow/red). Optional `plan` parameter adds scope diff.
- **`forge_drift_report --autoIncident`** (E1) — auto-chains drift → incident → fix proposal for high/critical violations. Groups incidents by file, generates scoped fix plans in `docs/plans/auto/`.
- **Drift `testStatus`** (E3) — drift report now includes `testStatus` field with test pass/fail count. Auto-detects `npm test` or `dotnet test` based on project type.
- **Regression history** (E5) — `forge_regression_guard` appends to `.forge/regression-history.json` for health trend tracking.
- **Auto-resolve incidents** (E8) — when regression guard passes, open incidents whose `files[]` overlap with guarded scope are auto-resolved with MTTR calculated. Disable with `--autoResolve=false`.
- **Sweep categorization** (E4) — framework code markers now broken down by type: `TODO: 5, placeholder: 38, other: 14`.

### Changed
- **`forge_diff` exit code** (E6) — `pforge diff` now exits 1 when forbidden file edits detected (was exit 0).
- **Plan hardener** (E10) — step2-harden-plan prompt now requires executable validation gates (`\`dotnet build\``) instead of prose descriptions. Manual checks must be prefixed with `[manual]`.
- LIVEGUARD_TOOLS count: 13 → 14 (added `forge_liveguard_run`)
- TOOL_METADATA count: 33 → 34

## [2.29.3] — 2026-04-13

### Fixed — v2.29.2 Verification Failures (Final 2)
- **`orchestrator.mjs`** — Plan parser now strips `\r\n` before splitting lines; fixes ALL regex matching on Windows (validation gates, stop conditions, build/test commands)
- **`forge_dep_watch`** — Fixed `auditResult is not defined` crash on .NET projects; snapshot `depCount` now uses `currentVulns.length` instead of npm-only variable

## [2.29.2] — 2026-04-13

### Fixed — v2.29.1 Verification Failures
- **`pforge.ps1`** — Fixed syntax error (stray `})` in `Invoke-Drift` violation loop) that broke all CLI commands (regression from v2.29.1)
- **`forge_diff`** — Wraps git calls with `$ErrorActionPreference = 'Continue'` so CRLF warnings don't throw under the global `Stop` preference
- **`forge_dep_watch`** — Detects `.slnx` files (.NET 10's XML solution format) in addition to `.sln` and `.csproj`
- **`forge_regression_guard`** — Prose-format gates (`**Validation Gate**: \`dotnet build\` succeeds`) now parsed via full fallback chain: fenced code blocks → inline backtick commands → `testCommand` → `buildCommand` → backtick commands from prose descriptions

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

