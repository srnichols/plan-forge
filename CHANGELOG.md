# Changelog

All notable changes to Plan Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
