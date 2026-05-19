# Phase AUDITOR-AUTOMATION — Tier the sense-making layer (Watcher / Forge-Master observer / Auditor)

> **Status**: **DRAFT — pending Step-2 harden**. Do NOT execute. Sign-off needed on §"Scope Contract" + §"Resolved Decisions" before running `step2-harden-plan.prompt.md`.
> **Source**: [docs/research/gh-aw-agent-factory-comparison.md](../research/gh-aw-agent-factory-comparison.md) §3 A4 (meta-agent) + carryover from Phase-WORKER-GUARDRAILS retro.
> **Tracks**: `pforge-mcp/orchestrator.mjs` (end-of-run hook + watcher cross-run mode), `pforge-master/` (new observer tool + budget + prompt), `.github/agents/plan-health-auditor.agent.md` (data-source widening), `.forge.json` schema (3 new opt-in blocks), CLI surface (`pforge master observe`), docs sweep.
> **Estimated cost**: medium. Most work is wiring on existing infra. Cluster C is the only LLM-cost-additive slice and is gated behind opt-in + per-day budget cap.
> **Pipeline**: Specify ✅ → Harden ⏳ → HOLD → Execute → S9 QA → S10 docs → S11 retro.
> **Recommended starting cluster**: **Cluster A — Auditor auto-invoke** (S0 → S1 → S2) because it validates that the A4 auditor produces useful output before we invest in Clusters B and C.
> **Session budget**: 12 slices. Recommended break points: **commit + new session after S2** (end of Cluster A — gives time to evaluate auditor signal quality before B/C build on it) and **after S6** (end of Cluster C infra slices, before reasoning prompt work).

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] No competing in-flight plan is modifying `pforge-mcp/orchestrator.mjs`, `pforge-master/server.mjs`, `pforge-master/src/reasoning.mjs`, `pforge-master/src/config.mjs`, or `.github/agents/plan-health-auditor.agent.md` (this phase touches all five)
- [ ] At least one `pforge run-plan` run has completed since Phase-WORKER-GUARDRAILS shipped, so A4 has real run data to consume (S1 needs evidence the auditor produces useful output)
- [ ] `master` is clean
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time
- [ ] OpenBrain is configured (`brain_recall` works) — auditor's data sources depend on it for cross-session memory

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-AUDITOR-AUTOMATION-PLAN.md`.

---

## Why this phase exists

Today the three sense-making roles are partially built:

| Role | Component | Today | Gap |
|---|---|---|---|
| **Sensor** (cheap, rule-based, live) | Watcher (`runWatch`, `runWatchLive`) | Per-run only | No cross-run aggregation |
| **Live sense-maker** (LLM, narrative, push) | — | does not exist | Forge-Master is pull-only |
| **Retrospective sense-maker** (LLM, narrative, batch) | A4 Plan Health Auditor | Manual invocation only | No auto-trigger; can't see watcher's cross-run signal |

This phase closes those three gaps as cleanly-separated tiers — *cheap → expensive*, *live → historical*, *structured → narrative* — so no component duplicates another's role:

- **Watcher** stays a pure observer (no LLM). It gains aggregation but never gains reasoning.
- **Forge-Master observer mode** adds the LLM narrative layer for live events (rate-limited, budgeted, mute-by-default).
- **A4 Auditor** stays retrospective but starts being auto-invoked and starts consuming the watcher's cross-run output.

Each piece is opt-in. No existing plan, hook, or config needs editing for the phase to ship.

---

## Scope Contract

### In Scope

**Cluster A — Auditor auto-invocation (Option 1)**:
- `pforge-mcp/orchestrator.mjs` — end-of-run hook reads `.forge.json` `hooks.postRun.invokeAuditor`; spawns Forge-Master with `@plan-health-auditor` message on failure or every Nth completed run
- `.forge/auditor-state.json` (new, gitignored) — persists `runsSinceLastAudit` counter
- `templates/.forge.json` + `.forge.json` schema — `hooks.postRun.invokeAuditor: { onFailure: boolean, everyNRuns: number|null }` (defaults: `{ onFailure: false, everyNRuns: null }` → today's behavior)

**Cluster B — Watcher cross-run mode (Option 2)**:
- `pforge-mcp/orchestrator.mjs` — extend `runWatch()` with `mode: "cross-run"`; new `buildCrossRunSnapshot(.forge/runs/*, { window: 14d })` aggregates run summaries; reuses existing `detectWatchAnomalies()` + `recommendFromAnomalies()` against the aggregate
- New anomaly codes: `cross-run.recurring-gate-failure`, `cross-run.retry-rate-spike`, `cross-run.cost-anomaly-trend`, `cross-run.slice-timeout-cluster`
- `.github/agents/plan-health-auditor.agent.md` — add `forge_watch (mode: "cross-run")` to the agent's tool allowlist; add it to §"Data Sources" table so the auditor uses pre-computed anomalies instead of re-scanning logs by hand

**Cluster C — Forge-Master observer mode (Option 3)**:
- `pforge-master/server.mjs` — register new `forge_master_observe` tool (sibling of `forge_master_ask`); subscribes to the hub WebSocket using the same `.forge/server-ports.json` discovery path `runWatchLive` uses
- `pforge-master/src/observer-loop.mjs` (new) — event-batch buffer (window: 60 s default), narration dispatch, rate limiter
- `pforge-master/src/observer-budget.mjs` (new) — daily $ cap + hourly narration cap, both enforced before any LLM call
- `pforge-master/src/observer-prompt.mjs` (new) — "narrate notable patterns" system prompt distinct from `runTurn()`'s Q&A prompt
- `pforge-master/src/config.mjs` — extend `getForgeMasterConfig()` with `observer: { enabled: false, batchWindowMs: 60_000, maxNarrationsPerHour: 6, maxUsdPerDay: 0.50, brainCapture: true, dashboardCard: false, modelTier: null }` AND `auditor: { modelTier: null }` (both `null` defaults mean "inherit ask mode")
- `pforge-master/src/model-resolver.mjs` (new) — resolves capability tier (`"flagship" | "mid" | "fast" | null`) to concrete provider/model via existing model registry; `null` → inherit ask mode. Vendor model IDs live in the registry, NEVER in observer/auditor code.
- `pforge-master/src/allowlist.mjs` — register `forge_master_observe` description for the tool catalog
- `pforge.ps1` + `pforge.sh` — `pforge master observe --start | --stop | --status` subcommand wrapping the MCP tool

**Tests** (every slice + S9):
- `pforge-mcp/tests/auditor-auto-invoke.test.mjs` (new — covers S1 + S2)
- `pforge-mcp/tests/watcher-cross-run-mode.test.mjs` (new — covers S3 + S4)
- `pforge-master/tests/observer-loop.test.mjs` (new — S5)
- `pforge-master/tests/observer-budget.test.mjs` (new — S6, includes budget-exceeded-blocks-LLM-call case)
- `pforge-master/tests/observer-reasoning.test.mjs` (new — S7)
- `pforge-master/tests/observer-cli.test.mjs` (new — S8)
- Updates to any existing test that asserts the old "Forge-Master has 1 tool only" invariant (search.test.mjs, self-test, etc.)

**Docs sweep** (S10):
- `docs/capabilities.md` + `pforge-mcp/capabilities.mjs` `TOOL_METADATA` — register `forge_master_observe`; document watcher `mode: "cross-run"`
- `docs/llms.txt` + root `llms.txt` — auto-discovery payload
- `docs/manual/customization.html` — Lifecycle Hooks section (`hooks.postRun.invokeAuditor` block)
- `docs/manual/forge-json-reference.html` — new `hooks.postRun.invokeAuditor` + `forgeMaster.observer` + `forgeMaster.auditor` config blocks (including `modelTier` knob with capability-tier guidance: `flagship` for quality, `mid` for balance, `fast` for high-volume cheap narration, `null` to inherit ask mode)
- `docs/manual/environment-variables-reference.html` — `PFORGE_FORGE_MASTER_OBSERVE_DISABLE=1` (kill switch)
- `docs/manual/errors-and-exit-codes.html` — new `observer-budget-exceeded`, `auditor-spawn-failed` codes
- `docs/manual/glossary.html` — "Forge-Master Observer", "Cross-Run Watcher", "Auditor Auto-Invoke"
- `docs/manual/book-index.html` — index entries
- `docs/COPILOT-VSCODE-GUIDE.md` — note the new `pforge master observe` workflow
- `docs/CLI-GUIDE.md` — `master observe` subcommand
- `CHANGELOG.md` — one entry per cluster; group under a single MINOR bump (multiple `feat:` commits → MINOR)

### Out of Scope

- **Anything not listed in §"In Scope"**. This is not a refactor pass.
- Flipping `observer.enabled` to `true` by default (this phase ships it off — flip is a later decision after we see real cost data)
- Watcher gaining LLM-based reasoning (deliberate separation — keep Watcher cheap)
- Forge-Master observer writing to git, calling write tools, or creating PRs (read-only; budget enforcement happens before any side effect)
- Dashboard card UI for observer narrations (config schema reserves `dashboardCard: false`; actual UI is a follow-up phase)
- A4 auditor opening PRs with proposed patches (still read-only per its `readonly: true` frontmatter; PR-opening is a separate later decision per the original Idea 3 deferral)
- Replacing or deprecating `forge_master_ask` — observer is a sibling, not a successor
- Changing the **default** model Forge-Master uses for reasoning — defaults inherit ask mode. (`modelTier` knob lets operators override, but the shipped default does not change current behavior.)
- Adding new entries to the model registry — `modelTier` resolves against whatever models the existing registry already exposes
- **Dashboard settings form fields** for the new `forgeMaster.observer.*` and `forgeMaster.auditor.*` knobs (CLI + `.forge.json` only this phase; dashboard surface is the explicit scope of the follow-up [docs/plans/Phase-AUDITOR-AUTOMATION-UI-PLAN.md](Phase-AUDITOR-AUTOMATION-UI-PLAN.md))
- **Dashboard cards** for observer narrations, cross-run watcher anomalies, or auditor latest report (also deferred to the UI follow-up phase)
- Migrating any existing plan or `.forge.json` to use the new opt-in blocks
- Touching `pforge-sdk/`, `extensions/`, `presets/`, `pforge-mcp/cost-service.mjs` (universal tripwire)
- Cross-machine observer aggregation (single-machine only this phase)

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected — universal tripwire)
- **Do NOT** make `observer.enabled` default to `true`. It MUST default to `false`. Mute-by-default is a hard requirement.
- **Do NOT** allow the observer to skip the budget check on any code path. Every LLM call MUST first consult `checkBudget()` and fail closed (block, never spend) on exceed.
- **Do NOT** ship a cap of `null` or `Infinity` for `maxUsdPerDay`. Cap must be a finite positive number. `0` is allowed (effectively disables observer LLM calls).
- **Do NOT** wire the observer to invoke any write tool, even via Forge-Master's existing approval-card path. Observer mode is strictly read-only; approvals only make sense in interactive `ask` mode.
- **Do NOT** auto-invoke the A4 auditor on **every** successful run by default. The default for `everyNRuns` MUST be `null` (off). Reasonable opt-in values are 5–25.
- **Do NOT** call the A4 auditor through the worker's model billing. Spawn it as its own Forge-Master process so its tokens land in `forge_cost_report` under `forge-master` source, not the parent run's cost.
- **Do NOT** introduce a new top-level CLI verb other than `pforge master observe`. All other behavior reaches users via `.forge.json` config blocks.
- **Do NOT** modify `forge_master_ask`'s signature, tool list, or system prompt — observer is additive, never subtractive.
- **Do NOT** bundle slices into one commit. Each slice = one commit. S0 / S9 / S10 / S11 also each = one commit.
- **Do NOT** edit `/memories/repo/*.md` files as part of this phase — auditor reads them; this phase does not curate them.
- **Do NOT** add a `postinstall` script or implicit observer auto-start. Observer starts only when user runs `pforge master observe --start` or sets `observer.enabled: true` in `.forge.json`.
- **Do NOT** change `pforge-master/`'s startup banner from "1 tool: forge_master_ask" without updating the corresponding self-test (`--self-test` path at `pforge-master/server.mjs:183-186`).
- **Do NOT** hardcode any specific vendor model identifier (e.g., `"claude-opus-4.7"`, `"gpt-5"`, `"grok-4"`) in `observer-*.mjs`, `model-resolver.mjs`, the auditor agent file, or the system prompts. Model selection MUST flow through `modelTier` → registry resolution. Vendor IDs age out; capability tiers don't.
- **Do NOT** make `modelTier` default to anything other than `null` (inherit). Picking a non-inherit default would change Forge-Master's effective model behind the user's back.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Three-tier scoping** — Watcher = sensor (no LLM, rule-based). Forge-Master observer = live sense-maker (LLM, batched, budgeted, push). A4 Auditor = retrospective sense-maker (LLM, batch, pull or auto-invoked). No tier duplicates another's role.
2. **Mute by default for observer** — `observer.enabled: false` in shipped `.forge.json`. Users opt in explicitly. No surprise costs.
3. **Budget caps are mandatory, finite, and fail-closed** — `maxUsdPerDay` and `maxNarrationsPerHour` are required schema fields, not optional. Code path that checks budget MUST run before any LLM call. Exceed → block, never spend.
4. **Auditor auto-invoke defaults to off** — `onFailure: false`, `everyNRuns: null`. Users opt in. (Sub-decision: when both `onFailure` and `everyNRuns` fire on the same run, run auditor once, not twice.)
5. **Watcher cross-run reuses existing infra** — `mode: "cross-run"` extends `runWatch()`; reuses `detectWatchAnomalies()` + `recommendFromAnomalies()` against an aggregate snapshot. No new anomaly classifier; only new anomaly codes.
6. **Observer hub discovery mirrors Watcher** — same `.forge/server-ports.json` lookup, same `ws://127.0.0.1:<port>` connect, same `ws` lib dependency. Symmetric infra means a single failure mode for both.
7. **Observer output channels** — primary: write narration as a Brain thought (capture into `/memories/repo/` if `brainCapture: true`). Secondary (deferred): dashboard card. CLI status command shows last N narrations from Brain.
8. **A4 auditor data-source widening only** — Cluster B does NOT change the auditor's report format. It only changes where the "Top Failure Modes" section gets its data (pre-computed cross-run anomalies instead of raw log scan).
9. **Auditor spawn isolation** — auto-invoked auditor runs in a child Forge-Master process so its token usage attributes to `forge-master` in `forge_cost_report`, not to the parent `pforge run-plan` invocation's cost.
10. **`pforge master observe --start` is foreground-by-default** — like `forge_run_plan`, `--start` blocks until Ctrl+C; `--start --detach` for daemon mode. `--status` and `--stop` work against either.
11. **No new write paths** — observer cannot call write-capable MCP tools. Bridge filter (A8 from prior phase) is the enforcement mechanism — observer's tool session declares `tools.deny: ["forge_run_plan", "forge_*_register", "forge_*_update_*", ...]` (full list resolved at Step-2 harden time).
12. **Naming** — tool is `forge_master_observe` (verb-final, mirrors `forge_master_ask`). CLI is `pforge master observe`. Config block is `forgeMaster.observer`. Internal modules are `observer-*.mjs` under `pforge-master/src/`.
13. **Configurable model per role, sensible inherit-default** — observer and auditor each expose a `modelTier` knob (`"flagship" | "mid" | "fast" | null`) under `forgeMaster.observer.modelTier` and `forgeMaster.auditor.modelTier`. Default for both is `null` = inherit ask mode's model — so out-of-the-box behavior is unchanged. Operators who care can dial each role independently: observer often wants `mid` or `fast` (high frequency, batch latency budget), auditor often wants `flagship` (infrequent, deep retrospective synthesis). Knob exists for both roles even though only observer is built this phase, because auditor benefits from the same plumbing and adding it later would require schema churn.
14. **Capability tier, not vendor model ID** — `modelTier` is `"flagship" | "mid" | "fast" | null`, NOT `"claude-opus-4.7"` or `"gpt-5"`. The existing model registry resolves tiers to concrete vendor models. Rationale: vendor IDs (Opus 4.7, GPT-5, Grok-4) age out in months; capability tiers are stable. Operators who need vendor-specific selection still have it via the existing provider/model fields elsewhere in the registry — this knob is the *role-scoped* layer on top.

---

## Slice Decomposition

### S0 — Baseline test harness

**Captures today's behavior** of:
- `runWatch(targetPath)` snapshot output (golden file)
- `runWatchLive(targetPath, onEvent)` event stream shape (golden file)
- `forge_master_ask({ message })` happy-path response shape
- `runPlan()` end-of-run path (no auditor invoke today)
- `.forge.json` schema rejects unknown `hooks.postRun.*` keys today (will pass after S1)
- `pforge-master/server.mjs` exposes exactly 1 tool today (will be 2 after S5)

**Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/auditor-automation-baseline.test.mjs"` returns 0; all baseline assertions pass.

### Cluster A — Auditor auto-invocation

**S1 — `hooks.postRun.invokeAuditor.onFailure`**
- Read `.forge.json` `hooks.postRun.invokeAuditor` block in orchestrator end-of-run path
- On `summary.status === "failed"` AND `onFailure: true`, spawn child Forge-Master process with message `@plan-health-auditor analyze last 14 days`
- Spawn is best-effort: failure to spawn logs a warning but never bubbles up to the parent run
- Attach auditor receipt (process id, exit code, generated report path) to `summary._auditor`
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/auditor-auto-invoke.test.mjs -t 'onFailure'"` returns 0

**S2 — `hooks.postRun.invokeAuditor.everyNRuns`**
- Persist `runsSinceLastAudit` counter to `.forge/auditor-state.json` (gitignored, atomic write)
- Increment on every completed run (pass or fail); when counter ≥ `everyNRuns`, invoke auditor and reset counter
- Counter starts at `everyNRuns` so first run after enabling triggers
- If both `onFailure` (and run failed) and `everyNRuns` would fire on the same run, invoke once and reset
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/auditor-auto-invoke.test.mjs -t 'everyNRuns'"` returns 0

### Cluster B — Watcher cross-run mode

**S3 — `runWatch(mode: "cross-run")`**
- New `buildCrossRunSnapshot(rootDir, { window: "14d" })` reads `.forge/runs/*/summary.json` filtered by `startTime` within window
- Aggregates: total runs, pass/fail counts, slice retry rates, per-slice failure-mode buckets, cost trend
- Feeds aggregate through existing `detectWatchAnomalies()` (extend with cross-run anomaly codes — new codes only, no signature change)
- Returns same `{ ok, anomalies, recommendations, snapshot }` shape — no breaking change to `forge_watch` callers
- **Gate**: `bash -c "cd pforge-mcp && npx vitest run tests/watcher-cross-run-mode.test.mjs"` returns 0

**S4 — Wire cross-run watcher into A4 auditor**
- Update `.github/agents/plan-health-auditor.agent.md`:
  - Add `forge_watch` to `tools:` list with `mode: "cross-run"` usage note
  - Update §"Data Sources" table: replace "`.forge/runs/*/slices/*/run.log` — Slice outcomes: exit codes, retry counts, gate failures" with cross-run watcher invocation
  - Add §"Recommended Invocation" guidance pointing to cross-run mode
- Behavior gate: invoke `forge_master_ask({ message: "@plan-health-auditor weekly report" })` against the current repo; verify report's §"Top Failure Modes" cites cross-run watcher output (presence of cross-run anomaly codes in the report)
- **Gate**: `bash -c "grep -q 'mode: \"cross-run\"' .github/agents/plan-health-auditor.agent.md && grep -q 'forge_watch' .github/agents/plan-health-auditor.agent.md"` returns 0

### Cluster C — Forge-Master observer mode

**S5 — Observer infra: hub subscription + event-batch buffer**
- New `pforge-master/src/observer-loop.mjs`:
  - `startObserver({ batchWindowMs, onBatch })` connects to hub via `.forge/server-ports.json` (mirrors `runWatchLive` discovery)
  - Buffers events in memory; flushes to `onBatch(events[])` every `batchWindowMs`
  - Handles WebSocket disconnect with bounded backoff (3 retries, then surface error)
  - Reserves an outbound hub-publish channel for `observer:narration` events (actual emission wired in S7 once narrations exist; reserving here keeps the publish path under one module's ownership)
- New `forge_master_observe` tool in `pforge-master/server.mjs` with input schema `{ action: "start" | "stop" | "status", sessionId?, detach? }`
- Tool currently echoes batches back (no LLM yet — S7 wires that)
- Self-test path updated: now expects 2 tools (`forge_master_ask`, `forge_master_observe`)
- **Gate**: `bash -c "cd pforge-master && npx vitest run tests/observer-loop.test.mjs"` returns 0

**S6 — Budget caps**
- New `pforge-master/src/observer-budget.mjs`:
  - `checkBudget(state, { maxUsdPerDay, maxNarrationsPerHour })` — pure function; returns `{ ok, reason? }`
  - `recordSpend(state, { usd, timestamp })` — pure function; returns updated state
  - State persists to `.forge/forge-master-observer-state.json` (atomic write, gitignored)
- Wire budget check **before** any LLM call site (none exist yet — S7 will be the first; this slice asserts the wiring is impossible to forget)
- Test: state-machine table covers (under-cap → ok), (over-narration-cap → block), (over-usd-cap → block), (day-rollover → reset), (hour-rollover → reset), (concurrent spend → atomic)
- **Gate**: `bash -c "cd pforge-master && npx vitest run tests/observer-budget.test.mjs"` returns 0

**S7 — Reasoning loop: narrate notable patterns**
- New `pforge-master/src/observer-prompt.mjs` — system prompt distinct from `runTurn()`'s Q&A prompt
- Extend `pforge-master/src/reasoning.mjs` with `runObserverTurn(batch, { config, brain })`:
  - Calls `checkBudget()` first; if not ok, log + skip (no LLM call)
  - Calls existing model surface with observer prompt; receives narration
  - If `brainCapture: true`, writes narration as a Brain thought (existing `brain_capture` plumbing)
  - Calls `recordSpend()` with actual usage from model response
  - **Emits `observer:narration` event on the hub** with payload `{ timestamp, batchEventCount, narration, usd, modelTier }` — enables downstream UI surfaces (the AUDITOR-AUTOMATION-UI follow-up phase consumes this) and any future subscriber without coupling them to Brain queries
- Observer loop's `onBatch` callback now calls `runObserverTurn`
- **Gate**: `bash -c "cd pforge-master && npx vitest run tests/observer-reasoning.test.mjs"` returns 0

**S8 — CLI surface: `pforge master observe`**
- `pforge.ps1` + `pforge.sh` — `master observe --start | --stop | --status [--detach]`
- `--start` (no `--detach`): blocks foreground until Ctrl+C; pretty-prints each narration
- `--start --detach`: forks observer process; writes pid to `.forge/forge-master-observer.pid`
- `--stop`: reads pid file, signals SIGTERM, waits for graceful shutdown
- `--status`: prints budget state, running/stopped, last N narrations from Brain
- **Gate**: `bash -c "cd pforge-master && npx vitest run tests/observer-cli.test.mjs"` returns 0

### S9 — Full QA sweep

Run ALL new test suites together; verify they don't regress each other or existing suites:
- `pforge-mcp/tests/auditor-auto-invoke.test.mjs`
- `pforge-mcp/tests/watcher-cross-run-mode.test.mjs`
- `pforge-master/tests/observer-loop.test.mjs`
- `pforge-master/tests/observer-budget.test.mjs`
- `pforge-master/tests/observer-reasoning.test.mjs`
- `pforge-master/tests/observer-cli.test.mjs`
- Plus the pre-existing full `pforge-mcp` and `pforge-master` test suites

**Gate**: `bash -c "cd pforge-mcp && npx vitest run && cd ../pforge-master && npx vitest run"` returns 0; **zero** failed tests across both workspaces.

### S10 — Docs sweep + auto-discovery

Per the §"Docs sweep" list in Scope Contract. Plus regenerate `forge_capabilities` output and verify all new tools/flags/configs appear.

**Gate**: `bash -c "node pforge-mcp/capabilities.mjs --check && grep -q 'forge_master_observe' docs/capabilities.md && grep -q 'hooks.postRun.invokeAuditor' docs/manual/forge-json-reference.html"` returns 0.

### S11 — Retro

Append §"What actually shipped" to this plan file:
- Final commit SHAs per slice
- Any deviations from the draft (sliced added/removed/reordered, scope drift)
- Known gotchas surfaced during execution
- Carryover for next phase (e.g., dashboard card UI for observer, A4 auto-PR mode, observer cross-machine aggregation)

**Gate**: `bash -c "grep -q '## What actually shipped' docs/plans/Phase-AUDITOR-AUTOMATION-PLAN.md"` returns 0.

---

## Acceptance Criteria (DRAFT — to be sharpened by Step-2)

### MUST

1. After Cluster A: a failed `pforge run-plan` with `hooks.postRun.invokeAuditor.onFailure: true` MUST write `.forge/health/latest.md` within 60 s of run end without manual intervention.
2. After Cluster A: with `everyNRuns: 5`, exactly one auditor invocation MUST occur per 5 completed runs (no double-fire, no skips).
3. After Cluster B: `forge_watch({ mode: "cross-run", targetPath: <repo> })` MUST return at least one `cross-run.*` anomaly when given a `.forge/runs/` directory containing ≥2 historical failures of the same slice across different runs.
4. After Cluster C: with `observer.enabled: false` (default), `forge_master_observe` MUST refuse to start and return a clear "observer disabled" error. No LLM call may occur.
5. After Cluster C: with `observer.enabled: true` and a `maxUsdPerDay: 0.01` budget exhausted in the current day, the observer MUST skip narration generation and log a budget-block event. No LLM call may occur.
6. After Cluster C: `pforge-master/server.mjs --self-test` MUST report exactly 2 tools (`forge_master_ask`, `forge_master_observe`) and exit 0.
7. Across the whole phase: every test from S0 through S9 MUST pass. Existing suites MUST NOT regress.

### SHOULD

1. Observer's batch narration latency SHOULD be ≤ 5 s p95 from batch flush to Brain capture (excluding LLM call duration).
2. Cross-run watcher SHOULD scan ≤ 100 ms p95 against a `.forge/runs/` directory of ≤ 100 runs.
3. Auditor auto-invoke SHOULD reuse the existing Forge-Master process if one is already running (avoid duplicate spawn on rapid successive runs).
4. Observer SHOULD batch low-signal events (e.g., heartbeat pings) into a single "N similar events" line in the narration prompt rather than echoing each one.

---

## Definition of Done

- [ ] All 12 slices' gates green; S9 full QA green; S10 docs gate green
- [ ] Reviewer-Gate sign-off (Session 3): no Scope Contract drift, no Forbidden Action triggered, all MUST criteria met
- [ ] Postmortem written; cost ≤ projected band; analyze score ≥ 90
- [ ] Auto-discovery (`forge_capabilities`) lists new tool, new config blocks, new anomaly codes
- [ ] `CHANGELOG.md` entry promoted from `[Unreleased]` → `[<next-MINOR>] — YYYY-MM-DD — Auditor Automation (Observer + Cross-Run Watcher)` per the release checklist (this phase = MINOR, multiple `feat:` commits)

---

## Stop Conditions

Halt execution and request human review if any of these fire:

- S6 budget tests fail in a way that suggests the check-then-spend race is not atomic (correctness > speed; do not paper over with retries)
- S7 observer LLM call is observed bypassing `checkBudget()` on any code path (this is a Forbidden Action — escalate, do not patch around)
- Cross-run watcher returns anomalies that contradict the auditor's findings on the same data (means rule classifier and LLM disagree — needs human triage before continuing)
- Auditor auto-invoke creates an infinite loop (auditor's own LLM call triggers a "completed run" event that re-triggers auditor) — must add re-entrancy guard before proceeding
- Hub WebSocket disconnect rate >5% during S5 testing — symptoms of port contention; needs investigation before observer can be relied on

---

## Commit Convention

- Each slice = one commit
- S0: `test(auditor-automation): S0 — baseline test harness`
- S1: `feat(orchestrator): auditor auto-invoke on run failure`
- S2: `feat(orchestrator): auditor auto-invoke every N runs`
- S3: `feat(watcher): cross-run mode`
- S4: `feat(agents): plan-health-auditor consumes cross-run watcher`
- S5: `feat(forge-master): observer mode infra — hub subscription + event batching`
- S6: `feat(forge-master): observer budget caps + fail-closed enforcement`
- S7: `feat(forge-master): observer reasoning loop with budgeted LLM call`
- S8: `feat(cli): pforge master observe subcommand`
- S9: `test(auditor-automation): S9 — full QA sweep across both workspaces`
- S10: `docs(auditor-automation): S10 — docs sweep + auto-discovery`
- S11: `docs(plans): S11 — retro for Phase-AUDITOR-AUTOMATION`

All commits land on `master`. PreCommit chain (shipped in WORKER-GUARDRAILS A3) runs on each.

---

## Hardening Audit Trail

| Date | Action | By |
|---|---|---|
| 2026-05-18 | Draft created from Phase-WORKER-GUARDRAILS retro carryover (Option 1 + Option 2 + Option 3 under user's three-tier scoping: Watcher = sensor, Forge-Master observer = live sense-maker, A4 Auditor = retrospective sense-maker) | Copilot session |
| _pending_ | Step-2 harden: lockHash, tightened acceptance criteria, resolved `tools.deny` list for observer session | _pending_ |
| _pending_ | Execution Hold lifted | _pending_ |

---

## Carryover (explicitly out of this phase)

- **Dashboard UI follow-up** — [docs/plans/Phase-AUDITOR-AUTOMATION-UI-PLAN.md](Phase-AUDITOR-AUTOMATION-UI-PLAN.md) covers: settings tab for Forge-Master roles (`tab-settings-forgemaster` with `observer.*` and `auditor.*` `cfg-*` fields), observer narrations live card, cross-run watcher anomalies card, auditor latest-report card. Drafted but explicitly gated on this phase shipping first — the UI surfaces depend on the config fields and capabilities this phase creates.
- A4 auditor opening PRs with proposed patches (auditor stays read-only this phase)
- Cross-machine observer aggregation (single-machine only this phase)
- Watcher → auditor real-time escalation (when watcher fires a critical anomaly mid-run, auto-invoke auditor with that anomaly as a hint — needs Cluster A + Cluster B to ship first to evaluate signal quality)
- Auto-tuning `everyNRuns` based on observed failure rate (constant default this phase; learning is a separate concern)
