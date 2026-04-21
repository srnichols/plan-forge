---
crucibleId: grandfathered-phase-28.4-openbrain-queue-drain
lane: full
source: human
---

# Phase-28.4 — OpenBrain Queue Drain (v2.62.3)

> **Target release**: v2.62.3
> **Status**: Draft — queued behind Phase-28.3 (do not launch until 28.3 ships v2.62.2)
> **Depends on**: Phase-28.3 tag `v2.62.2` landing on master.
> **Branch strategy**: Direct to `master`. Small, additive changes — wires existing plumbing.
> **Session budget**: 5 slices in **1 session**. ~30 min, budget ≤ $4.
> **Design posture**: Additive feature + one patch release. Reuses 100% of the queue/DLQ/backoff/stats helpers already in `pforge-mcp/memory.mjs`. No schema changes. No changes to `shapeQueueRecord` or any pure helper.

---

## Specification Source

**GitHub Issue**: [#84 — OpenBrain queue: add automatic drain on MCP connect / SessionStart](https://github.com/srnichols/plan-forge/issues/84) (label: `enhancement`, `accepted`)

**External reporter's summary** (verbatim):
> *"The local `.forge/openbrain-queue.jsonl` accumulates pending thoughts (from `forge_tempering_scan`, `forge_tempering_run`, `forge_run_plan`, `forge_bug_validate_fix`, etc.) but nothing automatically drains it when the OpenBrain MCP server becomes available. Users have to manually batch-capture to drain. Example: 19 pending thoughts, oldest from 2026-04-20, newest today, all `_attempts: 0`. I worked around it by calling `mcp_openbrain_capture_thoughts` via the agent, archiving to `.forge/openbrain-queue.archive.jsonl`, and appending a ledger entry to `.forge/openbrain-stats.jsonl`."*

**Reporter offered**: *"Happy to test a fix / help narrow down scope if useful."* — link this plan and the v2.62.3 release back to the issue when shipped.

---

## Feature Specification

### Problem Statement

Plan Forge enqueues OpenBrain-bound thoughts to `.forge/openbrain-queue.jsonl` whenever LiveGuard, tempering, or `forge_run_plan` produce a finding worth remembering. The queue records are correctly shaped (see `shapeQueueRecord` in `pforge-mcp/memory.mjs:1099`) with `_status: pending`, `_attempts: 0`, `_enqueuedAt`, `_nextAttemptAt`. The schema, DLQ, backoff, and stats ledger helpers are all present and tested.

**The drain step never runs.** Comments in `pforge-mcp/memory.mjs:1099` and `pforge-mcp/server.mjs:170` reference a "SessionStart drain hook" — the hook does not exist. Result: silent data loss. The Plan Forge installation accumulates pending entries that never reach OpenBrain, so the long-term memory the rest of the system depends on (Forge-Master, brain_recall, cross-session search) is starved.

### What "drain" means concretely

A drain pass:

1. Reads `.forge/openbrain-queue.jsonl`.
2. Calls `partitionByBackoff(records)` (already exists). `ready` records are eligible right now; `deferred` keep waiting.
3. For each `ready` record, dispatches it to OpenBrain via the **same payload shape** that `/api/memory/capture` already accepts. The dispatcher is **injected** so unit tests can mock the network.
4. On success → mark `_status: "delivered"`, append to `.forge/openbrain-queue.archive.jsonl`.
5. On failure → call `applyDeliveryFailure(record, { error })` (already exists). Result either updates the record's backoff (`action: "retry"`) or moves it to `.forge/openbrain-dlq.jsonl` (`action: "dlq"`).
6. Rewrites the queue file with the survivors (deferred + retrying records). Atomic write: tmp file + rename.
7. Appends one record to `.forge/openbrain-stats.jsonl` via `buildDrainStatsRecord({ attempted, delivered, deferred, dlq, durationMs, source })` (already exists).
8. Broadcasts `openbrain-flush` event on the hub so the dashboard memory row updates.

### Three trigger surfaces

| Surface | Trigger | Blocking? | Auth | Source tag |
|---|---|---|---|---|
| **MCP `initialize` hook** (NEW) | Once per server start, ~3s after `initialize` returns | Non-blocking (fire-and-forget background task) | Implicit (server already running locally) | `"initialize-drain"` |
| **`POST /api/memory/drain`** (NEW) | Manual / CLI / dashboard button | Sync — returns summary | Same `bridge.approvalSecret` as `/api/memory/capture` | `"rest-drain"` |
| **`pforge drain-memory`** (NEW CLI) | User runs from terminal | Sync — prints summary | Reuses REST endpoint via local fetch | `"cli-drain"` |

The dispatcher accepts a per-batch ceiling (default 50) so a 1000-entry queue doesn't try to ship in one call. Larger queues drain across multiple passes; remaining records survive in the queue with `_attempts` incremented only for records actually attempted.

### `forge_smith` warning row

`forge_smith` already shows a `Memory:` block at `server.mjs:4640`. Add a fourth warning line when **either** condition holds:

- pending count > 10, **or**
- oldest pending entry's age > 24 h.

Format:
```
Memory:
  L1 keys:         (session-scoped)
  L2 store size:   N dirs
  L3 queue depth:  N
  L3 last sync:    Xh ago
  ⚠ Drain:         N pending (oldest: 2d). Run 'pforge drain-memory' or restart MCP.
```

The `⚠` line is suppressed when both thresholds are clear. Thresholds configurable via `.forge.json#openbrain.drainWarn = { count: 10, ageHours: 24 }` — defaults preserved if unset.

### User Scenarios

1. **VS Code reconnect**: User restarts VS Code. Plan Forge MCP server initializes, OpenBrain MCP server initializes, plan-forge calls `initialize` → 3 s later background drain fires, processes the 19 pending records, marks 19 delivered, archives, broadcasts `openbrain-flush`. Dashboard memory row updates from `19` → `0`. No user action required.

2. **OpenBrain offline**: Server starts, OpenBrain not configured / not reachable. Initialize hook checks `isOpenBrainConfigured(PROJECT_DIR)` first — returns false → drain skipped silently. No errors, no log spam. Records stay in queue with `_attempts: 0` (never attempted, no backoff applied).

3. **Partial delivery / network flap**: 50 records eligible, dispatcher succeeds on 35, fails on 15 (network blip). Survivors get `applyDeliveryFailure` treatment — 15 records get backoff stamps and stay in queue. Stats ledger appends `{ attempted: 50, delivered: 35, deferred: 0, dlq: 0, durationMs: ~~~ }`. Next drain pass picks up the 15 survivors after their backoff window elapses.

4. **CLI manual drain**: User runs `pforge drain-memory`. CLI POSTs to `localhost:3100/api/memory/drain` with the local approval secret (same path `pforge` already uses for other REST calls). Endpoint runs the drain synchronously, returns `{ ok: true, attempted, delivered, deferred, dlq, durationMs }`. CLI prints a one-line summary.

5. **Smith warning**: User runs `pforge smith` after a long offline period. Memory row shows `⚠ Drain: 47 pending (oldest: 3d). Run 'pforge drain-memory' or restart MCP.`. After running drain → next `pforge smith` shows no warning.

6. **DLQ accumulation**: Records that fail 5 consecutive delivery attempts move to `.forge/openbrain-dlq.jsonl` (existing `applyDeliveryFailure` behavior). Already covered by `partitionByBackoff` ignoring `_status: "failed"`. No new logic needed; verified by test.

### Acceptance Criteria

- **MUST**: New pure function `drainOpenBrainQueue(records, dispatcher, opts) → Promise<{ delivered, deferred, dlq, archive, stats }>` in `pforge-mcp/memory.mjs`. `dispatcher(record) → Promise<{ ok: bool, error?: string }>` is injected. Reuses `partitionByBackoff` + `applyDeliveryFailure` + `buildDrainStatsRecord`. Per-batch ceiling honored via `opts.maxBatch` (default 50). Pure — never reads or writes the filesystem itself.
- **MUST**: New private helper `runDrainPass(cwd, source, hub) → Promise<{ ok, attempted, delivered, deferred, dlq, durationMs }>` in `pforge-mcp/server.mjs` that performs the I/O: read queue, call `drainOpenBrainQueue`, atomic-write survivors, append archive + stats, broadcast hub event. Exported only for tests.
- **MUST**: MCP `initialize` hook in `pforge-mcp/server.mjs` schedules `runDrainPass(PROJECT_DIR, "initialize-drain", activeHub)` via `setTimeout(..., 3000)` once per server start. Skips when `!isOpenBrainConfigured(PROJECT_DIR)`. Wraps in try/catch — never crashes the server. Logs success/skip/failure to stderr with `[drain]` prefix.
- **MUST**: New REST endpoint `POST /api/memory/drain` in `pforge-mcp/server.mjs`. Auth: same `checkApprovalSecret` as `/api/memory/capture`. 503 when OpenBrain not configured. Returns `{ ok, source: "rest-drain", attempted, delivered, deferred, dlq, durationMs }`. Errors return structured `{ ok: false, error }`.
- **MUST**: New CLI command in `pforge.ps1` and `pforge.sh`: `pforge drain-memory`. POSTs to `http://127.0.0.1:3100/api/memory/drain` using the bridge approval secret read from `.forge/bridge-secret` (existing convention used by other CLI commands). Prints a one-line summary. Exit 0 on success, 1 on failure.
- **MUST**: `forge_smith` Memory row gains a `⚠ Drain:` line when pending > threshold or oldest > ageHours threshold. Thresholds configurable via `.forge.json#openbrain.drainWarn`. Existing `Memory:` block stays untouched in shape; only the warning line is additive.
- **MUST**: Unit tests covering: drain happy path, drain with failures (backoff applied), drain with DLQ promotion (5+ attempts), per-batch ceiling, dispatcher rejection handling, `runDrainPass` atomic write rollback on dispatcher exception, smith warning thresholds (suppressed/active), CLI argument parsing.
- **MUST**: `forge_capabilities` lists the new REST endpoint and CLI command.
- **MUST**: Integration test for `runDrainPass` against a tmp `.forge/` with mocked dispatcher — verifies queue file is rewritten, archive grows, stats ledger appends, hub event fires.
- **SHOULD**: Dashboard memory row subscribes to `openbrain-flush` events and refreshes the count without page reload (already does via existing event wiring; verify in slice 5 smoke test).
- **MAY**: `pforge drain-memory --dry-run` flag that reports what would be drained without dispatching. Nice-to-have, low cost.

### Out of Scope

- **No changes to `shapeQueueRecord`, `nextBackoffTimestamp`, `applyDeliveryFailure`, `partitionByBackoff`, `buildDrainStatsRecord`** — they are already correct and tested. Touch them only to add JSDoc cross-references.
- **No new queue schema fields**. The existing `_v: 1` shape is sufficient.
- **No retroactive replay** of records already in `openbrain-dlq.jsonl`. A separate `pforge replay-dlq` could ship later; out of scope here.
- **No OpenBrain proxy.** Plan Forge does not own writes to OpenBrain; the dispatcher forwards to the local OpenClaw/OpenBrain endpoint or MCP client. The capture path mirrors what `/api/memory/capture` does today.
- **No agent prompt changes.** The drain runs in the background; agents do not call it explicitly. (`forge_meta_bug_file` from Phase-28.3 is the explicit-call counterpart for self-repair telemetry.)
- **No Phase-29 Forge-Master Studio scope** — this is a focused patch to make memory reliably persistent. Phase-29 builds on top of a healthy queue.

---

## Executable Slices (5 Slices · 1 Session · ~30 min · Budget ≤ $4)

All slices `[sequential]` — each builds on the previous.

---

#### Slice 1: Pure drain orchestrator [sequential] {#slice-1}

**Goal**: Add `drainOpenBrainQueue(records, dispatcher, opts)` to `pforge-mcp/memory.mjs`. Pure function — composes `partitionByBackoff`, calls injected dispatcher, calls `applyDeliveryFailure` on failures, returns structured result. Zero filesystem.

**Files**:
- `pforge-mcp/memory.mjs` — append after `buildDrainStatsRecord`:
  - `export async function drainOpenBrainQueue(records, dispatcher, opts = {}) → { delivered: Array, deferred: Array, dlq: Array, archive: Array, stats: object }`
    - `opts.maxBatch` (default 50), `opts.maxAttempts` (default 5, threaded into `applyDeliveryFailure`), `opts.now` (default `Date.now()`), `opts.source` (default `"drain"`).
    - Calls `partitionByBackoff(records, opts.now)` → `{ ready, deferred }`.
    - Slices `ready` to `opts.maxBatch`; surplus `ready` records are returned in `deferred` unchanged (their backoff is already in the past, so they pop to the front next pass).
    - For each batched record: `await dispatcher(record)`. On `{ ok: true }` → mark `_status: "delivered"`, `_deliveredAt: ISO`, push to `delivered` and `archive`. On `{ ok: false, error }` → `applyDeliveryFailure(record, { maxAttempts, error, now })`. `action: "retry"` → push to `deferred`. `action: "dlq"` → push to `dlq`.
    - Build `stats` via `buildDrainStatsRecord({ attempted, delivered: delivered.length, deferred: deferred.length, dlq: dlq.length, durationMs, source })`.
    - Returns the four arrays + stats. Caller does the I/O.
- `pforge-mcp/tests/drain-orchestrator.test.mjs` — new:
  1. All-success: 5 records, dispatcher always `{ ok: true }` → `delivered.length === 5`, `archive.length === 5`, `deferred === []`, `dlq === []`, `stats.delivered === 5`.
  2. All-failure under maxAttempts: 3 records (`_attempts: 0`), dispatcher always `{ ok: false, error: "boom" }` → `deferred.length === 3` with incremented `_attempts: 1` and forward `_nextAttemptAt`, `dlq === []`.
  3. DLQ promotion: 1 record with `_attempts: 4`, dispatcher fails → `dlq.length === 1` with `_status: "failed"`, `_failedAt`, `_lastError`.
  4. Mixed: 5 records, dispatcher succeeds on indices 0,2,4 and fails on 1,3 → `delivered.length === 3`, `deferred.length === 2`, `dlq === []`.
  5. Per-batch ceiling: 100 ready records, `maxBatch: 25` → only 25 attempted, remaining 75 returned in `deferred` untouched (no `_attempts` increment).
  6. Skips records with `_status: "delivered"` or `_status: "failed"` (defensive — `partitionByBackoff` already filters them).

**Depends on**: Phase-28.3 `v2.62.2` tag.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/memory.mjs:1130-1230` — `shapeQueueRecord`, `nextBackoffTimestamp`, `applyDeliveryFailure`, `partitionByBackoff` (reuse, do not modify).
- `pforge-mcp/memory.mjs:1240-1265` — `buildDrainStatsRecord` (reuse).

**Traces to**: MUST (drainOpenBrainQueue exists; pure; tests cover happy/failure/DLQ/batch).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/drain-orchestrator.test.mjs"
bash -c "grep -q 'export async function drainOpenBrainQueue' pforge-mcp/memory.mjs"
```

---

#### Slice 2: I/O wrapper + initialize-time hook [sequential] {#slice-2}

**Goal**: Add `runDrainPass(cwd, source, hub)` in `pforge-mcp/server.mjs` that does the filesystem I/O, and wire it into the MCP `initialize` handler as a non-blocking 3-second-deferred background task.

**Files**:
- `pforge-mcp/server.mjs` — add helper after the existing memory utilities (near `/api/memory/capture` definitions, ~line 6510):
  - `async function runDrainPass(cwd, source, hub) → { ok, attempted, delivered, deferred, dlq, durationMs }`:
    - `if (!isOpenBrainConfigured(cwd)) return { ok: false, error: "NOT_CONFIGURED" };`
    - Read `.forge/openbrain-queue.jsonl` via existing `readForgeJsonl` helper. If file missing or empty → return `{ ok: true, attempted: 0, delivered: 0, deferred: 0, dlq: 0, durationMs: 0 }`.
    - Build `dispatcher(record)` that posts the record to the local `/api/memory/capture` endpoint via `fetch("http://127.0.0.1:" + (process.env.PFORGE_DASHBOARD_PORT || 3100) + "/api/memory/capture", { method: "POST", headers: { Authorization: "Bearer " + bridgeSecret, "Content-Type": "application/json" }, body: JSON.stringify({ content: record.content, project: record.project, type: record.type, source: record.source, created_by: record.created_by }) })`. Returns `{ ok: response.ok, error: response.ok ? undefined : "HTTP_" + response.status }`.
    - Calls `drainOpenBrainQueue(records, dispatcher, { source })`.
    - Atomic write: write `survivors` (= `result.deferred`) to `.forge/openbrain-queue.jsonl.tmp`, then `renameSync` over the original. On exception → keep original, rethrow with `{ ok: false, error }`.
    - Append `result.archive` records to `.forge/openbrain-queue.archive.jsonl`.
    - Append `result.dlq` records to `.forge/openbrain-dlq.jsonl`.
    - Append `result.stats` to `.forge/openbrain-stats.jsonl`.
    - Broadcast `{ type: "openbrain-flush", attempted, delivered, deferred, dlq, durationMs, source, timestamp: ISO }` if `hub` provided.
    - Return summary.
- `pforge-mcp/server.mjs` — in the MCP `initialize` request handler, schedule:
  ```js
  setTimeout(() => {
    runDrainPass(PROJECT_DIR, "initialize-drain", activeHub)
      .then(r => console.error(`[drain] initialize-drain: ${JSON.stringify(r)}`))
      .catch(e => console.error(`[drain] initialize-drain failed: ${e.message || e}`));
  }, 3000);
  ```
  Wrap in try/catch — `setTimeout` registration must never throw past `initialize`. Skip silently when `process.env.PFORGE_DRAIN_ON_INIT === "false"` (escape hatch for tests / CI).
- `pforge-mcp/tests/drain-io-wrapper.test.mjs` — new:
  1. `runDrainPass` returns `NOT_CONFIGURED` when OpenBrain not configured.
  2. Empty queue → `{ ok: true, attempted: 0, ... }` and queue file untouched.
  3. Successful drain → queue file rewritten with deferred only, archive file appended with delivered, stats file appended with one record.
  4. Mid-drain dispatcher exception → original queue file preserved (atomic write rollback).
  5. `PFORGE_DRAIN_ON_INIT=false` env var → initialize hook skipped (via separate orchestrator-level test or by exposing a `__shouldDrainOnInit()` helper).

**Depends on**: Slice 1.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs:6512-6560` — `/api/memory/capture` for dispatcher reference.
- `pforge-mcp/server.mjs:160-235` — captureMemory + queue append for shape reference.
- `pforge-mcp/memory.mjs:1540-1610` — existing `_readJsonl` and report builders for read helpers.

**Traces to**: MUST (runDrainPass exists; initialize hook; non-blocking; atomic write; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/drain-io-wrapper.test.mjs"
bash -c "grep -q 'runDrainPass' pforge-mcp/server.mjs"
bash -c "grep -q 'initialize-drain' pforge-mcp/server.mjs"
```

---

#### Slice 3: REST endpoint + CLI command [sequential] {#slice-3}

**Goal**: Expose `runDrainPass` via `POST /api/memory/drain` and ship `pforge drain-memory` for both shells.

**Files**:
- `pforge-mcp/server.mjs` — add endpoint immediately after `/api/memory/capture`:
  ```js
  app.post("/api/memory/drain", async (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    if (!isOpenBrainConfigured(PROJECT_DIR)) {
      return res.status(503).json({ ok: false, error: "OpenBrain is not configured." });
    }
    try {
      const result = await runDrainPass(PROJECT_DIR, "rest-drain", activeHub);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  ```
- `pforge-mcp/capabilities.mjs` — add to the REST endpoints list (around line 2361):
  - `{ method: "POST", path: "/api/memory/drain", description: "Manually drain pending OpenBrain queue records. Auth: bridge.approvalSecret. Returns { ok, attempted, delivered, deferred, dlq, durationMs }." }`
- `pforge-mcp/capabilities.mjs` — add `drain-memory` to the CLI commands list.
- `pforge.ps1` — add `drain-memory` command branch:
  - Reads bridge secret from `.forge/bridge-secret` (file or fallback to `$env:PFORGE_BRIDGE_SECRET`).
  - `Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3100/api/memory/drain" -Headers @{ Authorization = "Bearer $secret" } -ContentType "application/json"` and prints one-liner summary: `Drained: N delivered / N deferred / N dlq (Xms)`.
  - Exit 1 on `ok: false`; exit 0 otherwise.
- `pforge.sh` — symmetric `drain-memory` branch using `curl`.
- `pforge-mcp/tests/drain-rest-endpoint.test.mjs` — new:
  1. POST without auth header → 401 (existing `checkApprovalSecret` behavior).
  2. POST with valid secret + OpenBrain not configured → 503 with `error` field.
  3. POST with valid secret + empty queue → 200 with `{ ok: true, attempted: 0, ... }`.
  4. POST with valid secret + non-empty queue + mocked `runDrainPass` → 200 with summary fields.

**Depends on**: Slice 2.

**Branch**: `master`.

**Context files**:
- `pforge.ps1` — search for an existing branch like `validate` or `smith` for shape reference.
- `pforge.sh` — symmetric reference.
- `pforge-mcp/server.mjs:6516` — `/api/memory/capture` for endpoint shape and `checkApprovalSecret` usage.

**Traces to**: MUST (endpoint exists; CLI exists for both shells; capabilities updated; tests cover).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/drain-rest-endpoint.test.mjs"
bash -c "grep -q '/api/memory/drain' pforge-mcp/server.mjs"
bash -c "grep -q '/api/memory/drain' pforge-mcp/capabilities.mjs"
bash -c "grep -q 'drain-memory' pforge.ps1"
bash -c "grep -q 'drain-memory' pforge.sh"
```

---

#### Slice 4: forge_smith warning row [sequential] {#slice-4}

**Goal**: Surface a non-blocking yellow warning in `forge_smith` output when the queue is unhealthy. Reuses the existing Memory block — only adds one line conditionally.

**Files**:
- `pforge-mcp/server.mjs` — modify the `forge_smith` Memory section (around line 4595–4640). After the existing `L3 last sync` line, compute:
  - Read `.forge.json#openbrain.drainWarn` with defaults `{ count: 10, ageHours: 24 }`.
  - From the queue records already in scope, find oldest `_enqueuedAt` among `_status: pending`.
  - `pendingTooMany = l3QueueDepth > thresholds.count`, `pendingTooOld = oldestAgeHours > thresholds.ageHours`.
  - If either true → append `\n  ⚠ Drain:         ${l3QueueDepth} pending (oldest: ${ageString}). Run 'pforge drain-memory' or restart MCP.` (`ageString` = `"3d"`, `"5h"`, `"45m"` form via existing age-formatter pattern at line 4631).
  - Otherwise → append nothing.
- `pforge-mcp/tests/smith-drain-warning.test.mjs` — new:
  1. Empty queue → no warning line.
  2. 5 pending, all < 24h → no warning.
  3. 11 pending, all < 24h → warning fires (count threshold).
  4. 3 pending, oldest 30h → warning fires (age threshold).
  5. Custom thresholds via `.forge.json#openbrain.drainWarn = { count: 50, ageHours: 168 }` → 11 pending + 30h-old → no warning (now under thresholds).

**Depends on**: Slice 3.

**Branch**: `master`.

**Context files**:
- `pforge-mcp/server.mjs:4595-4640` — existing `forge_smith` Memory block (extend, do not refactor).

**Traces to**: MUST (warning row appears conditionally; tests cover thresholds).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/smith-drain-warning.test.mjs"
bash -c "grep -q 'drainWarn' pforge-mcp/server.mjs"
bash -c "grep -q 'pforge drain-memory' pforge-mcp/server.mjs"
```

---

#### Slice 5: Ship v2.62.3 [sequential] {#slice-5}

**Goal**: CHANGELOG, VERSION bump, tag, post-release bump. Smoke-test the drain end-to-end against a seeded queue before tagging.

**Files**:
- `CHANGELOG.md` — new `## [2.62.3]` section:
  - `### Added` — `drainOpenBrainQueue` orchestrator, `runDrainPass` I/O wrapper, MCP initialize-time drain hook (3 s deferred, non-blocking), `POST /api/memory/drain` REST endpoint, `pforge drain-memory` CLI (PowerShell + bash), `forge_smith` Memory drain warning row.
  - `### Fixed` — Closes [#84](https://github.com/srnichols/plan-forge/issues/84): pending OpenBrain queue records now drain automatically on MCP server start; manual drain available via REST/CLI.
- `VERSION` — `2.62.3` for the tag, then `2.62.4-dev` post-tag.
- `pforge-mcp/package.json` — version `2.62.3`.
- **Smoke test (manual, recorded in slice log)**:
  1. Seed `.forge/openbrain-queue.jsonl` with 3 fake pending records (or use existing accumulated entries).
  2. Run `pforge drain-memory` (with OpenBrain configured but reachable). Verify output.
  3. Confirm `.forge/openbrain-queue.jsonl` shrunk, `.forge/openbrain-queue.archive.jsonl` grew, `.forge/openbrain-stats.jsonl` got one new record.
  4. Run `pforge smith`, confirm Memory row shows `0` pending and no warning.
  5. After tagging: comment on issue #84 with the v2.62.3 release link.

**Depends on**: Slice 4 + full vitest green.

**Branch**: `master`.

**Context files**:
- `/memories/repo/release-procedure.md`
- `CHANGELOG.md` — existing `[2.62.2]` entry for format reference.

**Traces to**: MUST (v2.62.3 tag; CHANGELOG entry; smoke test recorded; issue #84 reference).

**Validation Gate**:
```bash
bash -c "git show v2.62.3:VERSION | grep -q '^2.62.3$'"
bash -c "grep -q '## \\[2.62.3\\]' CHANGELOG.md"
bash -c "grep -q '#84' CHANGELOG.md"
bash -c "cd pforge-mcp && PFORGE_GATE_TIMEOUT_MS=600000 npx vitest run"
```

---

## Forbidden Actions

- **No edits to `shapeQueueRecord`, `nextBackoffTimestamp`, `applyDeliveryFailure`, `partitionByBackoff`, `buildDrainStatsRecord`** — they are correct as-shipped. Add JSDoc cross-references only if useful, no logic changes.
- **No new queue schema fields** (`_v` stays `1`).
- **No proxy writes** to OpenBrain — Plan Forge dispatches via the existing `/api/memory/capture` payload contract.
- **No automatic DLQ replay** — out of scope for this phase. A future `pforge replay-dlq` may revisit.
- **No changes to `captureMemory` enqueue path** in `pforge-mcp/server.mjs:170-235` — the producer side stays exactly as-is. We only add the consumer.
- **No agent prompt or instruction file changes** — drain runs in the background, agents do not need awareness of it.

## Rollback Plan

Before Slice 1, create `pre-phase-28.4` tag at current HEAD. On unrecoverable slice failure: `git reset --hard pre-phase-28.4` and file a narrower hotfix.

If the initialize-time hook causes any startup issue in the wild, the escape hatch is `PFORGE_DRAIN_ON_INIT=false` (env var) — which leaves the REST endpoint and CLI fully functional for users who want manual control.

## Agent Notes

- Slice 1 is pure / synchronous in shape (the `dispatcher` is async but the caller awaits in a loop). Do **not** parallelize the dispatcher loop in Slice 1 — sequential delivery preserves order in the archive file and keeps the per-batch ceiling honest. A future optimization could batch in groups of N, out of scope here.
- Slice 2's atomic write is critical. Pattern: `writeFileSync(queuePath + ".tmp", survivors.map(JSON.stringify).join("\n") + "\n"); renameSync(queuePath + ".tmp", queuePath);`. On Windows `renameSync` over an existing file works under `node:fs`; verified by Phase-19 work on `crucible-store.mjs`.
- Slice 2's initialize hook uses `setTimeout(..., 3000)` to let the OpenBrain MCP server complete its own startup before plan-forge tries to dispatch. Do not lower this below 1500 ms.
- Slice 3's CLI must read the bridge secret from `.forge/bridge-secret` (text file, single line). If the file is missing, fall back to `$env:PFORGE_BRIDGE_SECRET` / `$PFORGE_BRIDGE_SECRET`. Match the existing convention used by other CLI subcommands; grep `pforge.ps1` for `bridge-secret` for the canonical pattern.
- Slice 4's age formatter mirrors the existing `l3LastSync` formatter at `server.mjs:4630-4634`. Do not introduce a new formatter helper; keep the inline ternary chain for consistency.
- Slice 5's smoke test should be run with the **real** OpenBrain configured locally if available; if not, a mocked dispatcher in test mode is acceptable but call it out in the slice log.
- Issue #84 reporter offered to test a fix. After v2.62.3 ships, post a comment with the release link and tag them — they explicitly asked to be looped in.
