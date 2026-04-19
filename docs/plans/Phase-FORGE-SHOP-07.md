---
crucibleId: 2a8c45f1-7b63-4e92-9af4-d1ed87f02736
source: self-hosted
status: draft
phase: FORGE-SHOP-07
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-07: Brain facade — unified L1/L2/L3 recall/remember API

> **Status**: 📝 DRAFT — ships AFTER FORGE-SHOP-05, BEFORE
> FORGE-SHOP-06 (ask-bus depends on this API)
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium-high (touches memory layer used by every
> subsystem; must ship with **migration-free backwards compat** —
> existing readers continue to work unchanged)
> **Target Version**: v2.52.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)

---

## Why

Plan Forge's operational memory is organized into three tiers:

| Tier | Storage | Examples |
|------|---------|----------|
| **L1 — session** | `.forge/runs/<id>/state.json`, in-process state | Current slice, run-scoped state |
| **L2 — durable** | `.forge/{runs,bugs,incidents,tempering,review-queue,hub-events,openbrain-queue}` | Hardened records, audit trail |
| **L3 — semantic** | OpenBrain (remote) + `.forge/openbrain-queue.jsonl` | Cross-run memory, fuzzy recall |

Today **every subsystem picks its own tier**. `readTemperingState`
hits L2 directly. `captureMemory` writes L3. Run state lives in L1.
Each subsystem re-implements freshness, fallback, and outage handling.
When OpenBrain is down, each caller separately decides whether to
queue or skip.

This is a classic **leaky abstraction** — subsystems should say *what*
they want to know, not *where* it's stored. FORGE-SHOP-07 ships a thin
facade that routes `recall()` / `remember()` / `forget()` to the
right tier(s) based on simple metadata.

**What this is NOT**: a smart "brain" that understands queries. It's a
**dumb router** with tier-selection rules. Smarts live in agents and
skills. This phase is about **reducing coupling**, not adding
intelligence.

## Scope Contract

### In-scope

**Slice 07.1 — Facade module + tier routing**

- `pforge-mcp/brain.mjs` — **new file**, ~260 LOC
- Exports:
  - `recall(key, opts?) → value | null`
    - `opts: { scope?: "session"|"project"|"cross-project", freshnessMs?, fallback?: "l2"|"l3"|"none" }`
    - Default routing rule:
      - `scope: "session"` → L1 only
      - `scope: "project"` → L2 first, L3 fallback if not found AND
        `opts.fallback !== "none"`
      - `scope: "cross-project"` → L3 only
    - `freshnessMs`: if L2 result's mtime > `freshnessMs` ago, fall
      through to L3 (when `fallback="l3"`)
    - Returns primitives-only records (no raw buffers, no file
      handles)
  - `remember(key, value, opts?) → { ok, tier, ref }`
    - `opts: { scope, tags?, ttlMs? }`
    - Routes to one tier **by default**; writes to multiple only if
      `opts.scope === "project-durable"` (L2 + L3 async dual-write)
    - Returns the canonical storage reference (file path for L2,
      OpenBrain id for L3)
    - **Never** blocks on L3 — dual-writes queue via existing
      `.forge/openbrain-queue.jsonl`
  - `forget(key, opts?) → { ok, removed: [...] }`
    - Removes from the specified tier(s). L1/L2 are immediate. L3
      "forget" queues an OpenBrain delete request
  - `describeKey(key) → { layout, examples }` — introspection helper
    for debugging & tests
- Key shape:
  - Dotted path with scope prefix:
    `session.run.<runId>.slice.<sliceId>`,
    `project.bug.<bugId>`,
    `project.review.<itemId>`,
    `project.run.<runId>`,
    `cross.pattern.<tag>`
  - Key validator rejects spaces, path traversal, and unknown scope
    prefixes
- Tier implementations:
  - L1 backend: in-process `Map<runId, Map<key, value>>` plus
    `.forge/runs/<id>/state.json` mirror (atomic write on change)
  - L2 backend: route to existing readers:
    `readTemperingState`, `readBug`, `readReviewItem`,
    `readLiveguardState`, `findLatestRun`, `readHubEvents`, etc.
    (the facade does **not** re-implement any file I/O — it composes)
  - L3 backend: existing `captureMemory` / `searchMemory` /
    `.forge/openbrain-queue.jsonl`
- Observability:
  - Every `recall/remember/forget` emits an OTEL span with
    `key`, `tier-attempted`, `tier-served`, `cache-hit` (for future
    L1 caching), `durationMs`
  - Counter metrics: `brain.recall.served_from_<l1|l2|l3>`
  - Warning metric: `brain.l3.dual_write_queued` when L3 was down
    and the write queued
- **Backwards compat**: existing direct-reader calls continue to work
  — do NOT remove or deprecate `readTemperingState`, `readBug`, etc.
  in this phase. The facade wraps them. Deprecation is a later
  "coupling reduction" phase, not this one.

**Slice 07.2 — Strategic adoption + tests**

Migrate **four high-value call sites** to the facade (not all of them
— the rest migrate opportunistically over future phases):

1. `forge_home_snapshot` (FORGE-SHOP-01) — replace the 4 direct
   reader calls with 4 `brain.recall()` calls. Same contract to
   callers; facade just in between
2. `readHomeSnapshot.activeRuns.openReviews` (FORGE-SHOP-02) —
   `brain.recall('project.review.counts.open')` (new synthetic key
   composed server-side)
3. `forge_liveguard_run` — use `brain.recall('project.liveguard.state')`
   with `freshnessMs: 60_000` so stale cache triggers rescan
4. The TEMPER-05 perf-budget scanner's history lookup — use
   `brain.recall('project.tempering.perf-history', { fallback: 'none' })`
   instead of reading `.forge/tempering/perf-history.jsonl` directly

For each migration: a **behavior-preservation test** — same input
produces same output before and after the facade.

Dashboard additions:
- A new "Brain" subtab of Config: shows per-tier counters from the
  observability metrics, recent recall misses (dev-only), and the
  top 10 keys by hit rate. Purely observational — no config actions
  in this phase
- `forge_smith` output: add a "Memory:" row with `L1 keys / L2 store
  size / L3 queue depth / L3 last sync age`

### Out of scope (later)

- L1 caching layer (promotion of hot L2 keys to an in-process cache)
  — separate phase; measure first
- Auto-expiry / TTL eviction — L2 files never expire; L3 TTL is
  OpenBrain-side
- Schema validation of values — stays at caller boundary
- Rewriting any subsystem writer to use `remember()` — adoption is
  strategic, not wholesale. Writers that already work correctly
  continue using their existing paths
- Making L3 mandatory — OpenBrain must stay optional

### Forbidden actions

- Do NOT delete or deprecate existing readers (`readTemperingState`,
  `readBug`, …) in this phase — facade wraps, does not replace
- Do NOT route writes across tiers by default — single-tier writes
  are the common case; dual-write is opt-in
- Do NOT block on L3 calls — L3 is best-effort with queue fallback
- Do NOT allow `key` values to escape the `.forge/` directory (path
  traversal in L2 backend). Test this explicitly
- Do NOT return raw L2 file handles or buffers from `recall()` —
  only parsed JSON objects
- Do NOT add any UI control that writes memory — Brain subtab is
  read-only in this phase
- Do NOT change OpenBrain's wire protocol

## Slices

### Slice 07.1 — Facade module + tier backends

**Files touched:**
- `pforge-mcp/brain.mjs` — **new**, ~260 LOC
- `pforge-mcp/tests/brain-recall.test.mjs` — **new**, ~22 tests
  (every scope, freshness fallback, fallback=none, L3 outage,
  key validation, path-traversal guards, scope prefix rejection)
- `pforge-mcp/tests/brain-remember.test.mjs` — **new**, ~14 tests
  (single-tier, project-durable dual-write, L3 queue on outage)
- `pforge-mcp/tests/brain-forget.test.mjs` — **new**, ~10 tests
  (L1 immediate, L2 immediate, L3 queued delete)
- `pforge-mcp/tests/brain-telemetry.test.mjs` — **new**, ~6 tests

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass.

### Slice 07.2 — Strategic adoption + Brain subtab

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `readHomeSnapshot` rewired via
  facade (~40 LOC)
- `pforge-mcp/liveguard/liveguard-run.mjs` (or wherever it lives) —
  facade wire-in (~25 LOC)
- `pforge-mcp/tempering/scanners/perf-budget.mjs` — facade wire-in
  (~20 LOC)
- `pforge-mcp/server.mjs` — `forge_smith` Memory row (~25 LOC)
- `pforge-mcp/dashboard/index.html` + `app.js` — Brain subtab under
  Config (~80 LOC)
- `pforge-mcp/tests/home-snapshot-behavior.test.mjs` — **new**,
  behavior-preservation tests (~10 tests)
- `pforge-mcp/tests/brain-adoption.test.mjs` — **new**, ~12 tests
  (each of the 4 migrations produces identical output)

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual dashboard
smoke-test: Brain subtab renders counters.

## Success Criteria

- `brain.recall/remember/forget` available with documented routing
  rules
- Four strategic call-sites migrated with behavior-preservation
  tests
- Zero deletion of existing readers — backwards-compat intact
- OpenBrain outage: `remember` still returns `ok: true` with
  `tier: "l2"` and queued L3 write; `recall` falls back cleanly
- Test count +74
- Tool count unchanged (no new MCP tools — this is infra, not a
  surface)
- CHANGELOG entry under `[Unreleased]` targeting v2.52.0
- `Phase-FORGE-SHOP-07.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- FORGE-SHOP-01 — home-snapshot is one of the 4 migration targets
- FORGE-SHOP-02 — review queue counts are a migration target
- TEMPER-05 — perf-budget scanner is a migration target
- Existing LiveGuard `forge_liveguard_run`

**On later phases:**
- FORGE-SHOP-06 ask-bus — `brain.gate-check` responder calls
  `brain.recall()` exclusively (no direct readers). **06 must not
  merge before 07**
- Future "deprecate direct readers" phase can use adoption metrics
  from the Brain subtab to decide which readers are safe to remove

## Notes for the executing agent

- This is a **facade**. It MUST NOT add features to memory — it only
  routes calls. Every test that exercises the facade should have a
  counterpart test that exercises the underlying reader directly and
  gets the same answer
- The dual-write (L2 + L3) is the **only** place where the facade
  does more than one thing per call. Write tests that prove L2
  success + L3 outage produces `ok: true, tier: "l2", queued: true`
- Path-traversal in L2 keys is a security-critical test — fail the
  whole adoption if that test is weak
- Resist the urge to add an "intelligent" recall that chooses L1
  based on access patterns. Hot-path caching is a **separate**
  phase, not a refinement of this one. Dumb routing first;
  measurement-driven optimization second
- When in doubt, read the Temper Guard section of
  `architecture-principles.instructions.md` — this phase is a prime
  candidate for scope creep
