---
crucibleId: e4a1c782-9358-4b1e-82d9-615a47cf9e04
source: self-hosted
status: draft
phase: FORGE-SHOP-06
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-06: Ask-bus — request/reply RPC over the hub

> **Status**: 📝 DRAFT — drafted mid-arc; executes AFTER FORGE-SHOP-05
> (unified timeline) so the bus adoption has maximum coverage
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (new transport semantic on a live
> subsystem; must be strictly additive — existing push-only
> subscribers cannot regress)
> **Target Version**: v2.53.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)
Depends on: all prior FORGE-SHOP phases merged
Paired with: [Phase-FORGE-SHOP-07.md](Phase-FORGE-SHOP-07.md) (Brain
facade) — SHOP-07 ships first; this phase uses its API surface

---

## Why

Today's hub (`pforge-mcp/hub.mjs`) is **push-only**. Any subsystem
that needs an answer — "should I block on any open reviews?", "is
drift within budget?", "is there a security finding for this
correlationId?" — has to read L2 files directly and re-implement the
semantic each time.

This couples every caller to every reader's file layout, and forces
**polling at gates** in the executor instead of clean blocking
primitives. The real gap is not a bus — it's **request/reply
semantics** on the bus we already have.

FORGE-SHOP-06 adds `hub.ask()` — a request-with-timeout RPC pattern
that rides on top of the existing WebSocket hub. Its target workloads:

- **Executor gate checks** between slices: "brain, is the shop clear
  enough to proceed?" with a 5s timeout → fall back to the existing
  validation gate on timeout
- **Watcher anomaly enrichment**: "tell me the correlationId thread
  for this run so I can tag the anomaly properly"
- **Agent delegation (TEMPER-07)** synchronous mode: "here's a bug,
  please analyze now, I'm waiting"
- **Cross-subsystem queries from FORGE-SHOP-04 search** without
  reading every L2 store directly

## Scope Contract

### In-scope

**Slice 06.1 — `hub.ask()` transport + `hub.respond()` handler**

- `pforge-mcp/hub.mjs` gets two additive exports:
  - `ask(topic, payload, { timeoutMs = 5000, correlationId }) → Promise<response>`
    — sends an `ask` frame with a new `requestId`, awaits matching
    `respond` frame, rejects on timeout with `ErrAskTimeout`
  - `onAsk(topic, handler)` — registers a handler;
    `handler(payload, meta)` returns a value that the hub auto-wraps
    into a `respond` frame
- Frame shapes (**new**):

  ```jsonc
  // ask
  { "kind": "ask", "requestId": "req-...", "topic": "brain.gate-check",
    "correlationId": "...", "payload": {...}, "ts": "..." }

  // respond (success)
  { "kind": "respond", "requestId": "req-...", "ok": true,
    "payload": {...}, "ts": "..." }

  // respond (error)
  { "kind": "respond", "requestId": "req-...", "ok": false,
    "error": { "code": "...", "message": "..." }, "ts": "..." }
  ```

- **Backwards-compat**: existing `kind: "event"` frames unchanged;
  existing subscribers ignore `ask`/`respond` frames they didn't
  register for
- **Single-responder enforcement**: `onAsk(topic, handler)` throws
  if a handler is already registered for that topic. Prevents
  racing responders.
- **Timeout behavior**: on timeout, the pending request slot is
  evicted; a late-arriving `respond` is dropped with a `warn` log.
  **Never** resolves a stale promise.
- **No retries at transport layer** — callers retry with a new
  `correlationId` if they want
- Telemetry: every `ask` + `respond` pair emits an OTEL span with
  `topic` + `requestId` + `correlationId` + `durationMs` + `ok`

**Slice 06.2 — First responders + executor gate wire-in**

Three initial `onAsk` responders, each small:

1. **`brain.gate-check`** (responder lives in `orchestrator.mjs`):
   - Input: `{ sliceId, correlationId }`
   - Output: `{ proceed: boolean, reason, openBlockingReviews: number, driftScore, openIncidents }`
   - Logic: reads via the Brain facade (SHOP-07). `proceed = false`
     iff any `blocker`-severity review is open for this
     `correlationId` OR any open `critical` incident exists OR drift
     score dropped below the configured threshold in the last hour
   - Pure read; no writes

2. **`brain.correlation-thread`** (responder lives in
   `orchestrator.mjs`):
   - Input: `{ correlationId, limit? }`
   - Output: `{ events: [...], count }` — all hub events bearing the
     correlationId, newest-first, bounded
   - Backed by `.forge/hub-events.jsonl` scan (cheap at current
     volumes; FORGE-SHOP-05 timeline code can be reused)

3. **`tempering.delegate-sync`** (responder lives in
   `pforge-mcp/tempering/agent-router.mjs`):
   - Input: `{ bugId, timeoutMs? }`
   - Output: the would-be analyst prompt (same shape as
     `forge_delegate_to_agent mode=analyst`) — but delivered over the
     bus so the caller doesn't need to poll a file
   - Requires TEMPER-07 shipped

Executor wire-in (`pforge-mcp/orchestrator.mjs` `runPlan()`):
- After each `slice-completed` event AND before `slice-started` for
  the next slice, execute `hub.ask('brain.gate-check', {...},
  { timeoutMs: 5000 })`
- On `proceed: false`: emit `gate-blocked` hub event + log blocking
  reason to run events.log + pause the run (existing pause
  machinery) with status `awaiting-review`
- On timeout OR responder error: treat as `proceed: true` (fail
  open — do NOT silently fail closed and stall every run on a
  hub hiccup)
- Config-guard: `.forge.json > runtime.gateCheck.enabled`
  (default: `false` — existing v2.52 behavior preserved)

Dashboard additions:
- Run-details panel shows the per-slice gate-check result + reason
- Home tab activity feed colors `gate-blocked` events amber
- Watcher chip: show `gateChecks: passed/blocked/timedOut` counters
  for the latest run

### Out of scope (later)

- Priority queues / fairness between callers — single-responder rule
  makes this unnecessary for now
- Persistent ask-log replay (use existing `.forge/hub-events.jsonl`
  tail if you need post-hoc inspection)
- Multi-responder fan-in/fan-out (YAGNI until a real use case)
- Cross-process ask between two separate MCP server instances

### Forbidden actions

- Do NOT change existing event frames — additive kinds only
- Do NOT block the hub's event loop on a responder — wrap handler
  invocations in `Promise.resolve().then(handler)`
- Do NOT let an ask without a responder hang forever — hub MUST send
  a `respond` with `ok: false, error: { code: "no-responder" }` on
  arrival if no handler matches
- Do NOT let the gate-check **fail closed** on transport errors —
  fail-open is an explicit design decision; document it in the code
  comment next to the catch block
- Do NOT introduce a broker / middleman / separate MQ process
- Do NOT retry at the transport layer — retries are caller-owned
- Do NOT let `brain.gate-check` mutate any state; it is strictly a
  read-only consultative gate

## Slices

### Slice 06.1 — Hub ask/respond transport

**Files touched:**
- `pforge-mcp/hub.mjs` — `ask`, `onAsk`, frame handling, timeout
  eviction, telemetry (~240 LOC)
- `pforge-mcp/hub.test.mjs` (or `pforge-mcp/tests/hub-ask.test.mjs`)
  — ~22 tests (timeout, no-responder, double-respond-dropped,
  single-responder rule, frame-ignore by unrelated subscribers,
  telemetry span emitted, large payload, late respond dropped)

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. No new MCP tools yet.

### Slice 06.2 — 3 responders + executor gate wire-in + dashboard

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `brain.gate-check` responder,
  `brain.correlation-thread` responder, executor wire-in
  (~160 LOC)
- `pforge-mcp/tempering/agent-router.mjs` — `tempering.delegate-sync`
  responder (~40 LOC)
- `pforge-mcp/dashboard/app.js` — gate-check UI, activity-feed color,
  watcher chip counters (~70 LOC)
- `pforge-mcp/tests/gate-check.test.mjs` — **new**, ~14 tests
- `pforge-mcp/tests/correlation-thread.test.mjs` — **new**, ~8 tests
- `pforge-mcp/tests/delegate-sync.test.mjs` — **new**, ~10 tests
- `pforge-mcp/tests/executor-gate-wire.test.mjs` — **new**, ~12 tests
  (fail-open on timeout, pause on blocker review, resume on resolved)

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test:
start a run with `runtime.gateCheck.enabled = true`, add a blocker
review mid-run, observe the run pauses at the next slice boundary.

## Success Criteria

- `hub.ask()` available with documented timeout + fail-open
  semantics
- Three responders shipped and discoverable via a new
  `hub.listResponders()` helper (for debugging)
- Executor gate-check is config-guarded OFF by default; turning ON
  introduces no test regression
- No change to existing `event` subscribers' behavior
- Telemetry spans visible in `.forge/runs/<id>/trace.json`
- Test count +66
- CHANGELOG entry under `[Unreleased]` targeting v2.53.0
- `Phase-FORGE-SHOP-06.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- FORGE-SHOP-02 merged — review queue records drive gate-check
- FORGE-SHOP-05 merged — timeline-merge code reused by
  `brain.correlation-thread`
- FORGE-SHOP-07 merged — gate-check uses `brain.recall(...)` (not
  raw L2 readers)
- TEMPER-07 merged — `tempering.delegate-sync` responder needs it

**On later phases:**
- A future "incident auto-triage" phase can add a
  `brain.recommend-fix` responder without touching 06.1 code

## Notes for the executing agent

- Fail-open at the gate is a **deliberate** design decision. Write
  it in a code comment next to the catch block; write it into the
  test that proves it. An operator who sees a gate timeout expects
  the run to continue, not stall
- The hub is a process-local WebSocket loop — `ask/respond` latencies
  should be sub-millisecond. If a test runs > 50ms for an ask, the
  test fixture is wrong, not the transport
- `hub.listResponders()` is debugging infrastructure; keep it out of
  TOOL_METADATA (it's internal, not a public tool)
- **Backpressure**: if a responder throws, the hub must still deliver
  a `respond` with `ok: false`. Test this explicitly
