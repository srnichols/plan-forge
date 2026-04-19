---
crucibleId: 7a3c2e18-5b91-4f27-a6d4-e82fc91a0d45
source: self-hosted
status: complete
phase: FORGE-SHOP-01
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-01: Home tab — unified shop-floor view

> **Status**: ✅ COMPLETE — Slice 01.1 + Slice 01.2 shipped via PR #68 (v2.48.0 in-flight)
> **Estimated Effort**: 2 slices
> **Risk Level**: Low (purely additive aggregation — reads from existing
> L2 readers only; no writers touched)
> **Target Version**: v2.48.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)

---

## Why

After the TEMPER arc shipped (v2.47.0), Plan Forge exposes **51 MCP
tools** and **13 dashboard tabs** across five subsystems (Crucible,
Forge-execution, LiveGuard, Tempering, preset/extension layer). Each
workbench is well-designed in isolation. The *whole* is not — an
operator asking "what is the state of my shop right now?" must click
through 4+ tabs to assemble the answer.

FORGE-SHOP-01 ships the **foreman's desk**: a single Home tab that
aggregates the four subsystem readers into a 4-quadrant view plus a
unified activity feed. This is the Crucible-01 of the unification arc
— unglamorous but load-bearing. Every later FORGE-SHOP phase (Review,
Notifications, Search, Timeline) drills back into surfaces first shown
here.

## Scope Contract

### In-scope

**Slice 01.1 — MCP readers + aggregated state**

- New `readHomeSnapshot(targetPath)` helper in `orchestrator.mjs` —
  pure aggregator, **read-only**, returns the 4-quadrant payload plus
  a trimmed activity feed slice. Shape:

  ```jsonc
  {
    "ok": true,
    "targetPath": "...",
    "generatedAt": "2026-04-19T...",
    "quadrants": {
      "crucible": {        // from readCrucibleState(targetPath)
        "total": 42, "finalized": 37, "stalled": 2,
        "lastActivity": "2026-04-19T..."
      },
      "activeRuns": {      // from findLatestRun + recent runs scan
        "inFlight": 1, "lastSliceOutcome": "passed",
        "lastRunId": "...", "lastRunAgeMs": 120_000
      },
      "liveguard": {       // from readLiveguardState(targetPath)
        "driftScore": 87, "openIncidents": 0, "openFixProposals": 2,
        "lastDriftAgeMs": 3_600_000
      },
      "tempering": {       // from readTemperingState(targetPath)
        "coverageStatus": "ok", "openBugs": 1,
        "lastScanAgeMs": 1_800_000
      }
    },
    "activityFeed": [ /* last 25 hub events, newest first,
                         primitives-only payloads, no raw logs */ ]
  }
  ```

  - Returns `{ ok: false, error, targetPath }` only on IO failure; any
    subsystem that is uninitialized contributes `null` for its
    quadrant (Home tab renders an empty-state card).
  - **Never** re-scans source files. Only calls existing readers:
    `readCrucibleState`, `findLatestRun`, `readLiveguardState`,
    `readTemperingState`, plus `readHubEvents` (tail).
  - Budget: must complete in ≤ 250ms on a project with 1 000 L2
    records (enforced in test `forge-shop-home.perf.test.mjs`).

- New MCP tool `forge_home_snapshot`:
  - **Read-only**. Returns the exact shape above.
  - Accepts optional `{ targetPath, activityTail }` (default
    `activityTail` = 25, capped at 200).
  - TOOL_METADATA in `capabilities.mjs` + regenerated `tools.json`
    with `addedIn: "2.48.0"`, full `consumes`/`produces`/`errors`.
  - Registered in `server.mjs` with the existing
    `registerReadOnlyTool` pattern.

- **L3 capture is NOT performed** for this tool (read-only aggregator
  — nothing to remember; callers are cheap and idempotent).
- Telemetry via existing `emitToolTelemetry`.

**Slice 01.2 — Dashboard Home tab + activity feed**

- New **Home tab** in the dashboard, **promoted to first position**
  (leftmost, default on load):
  - 4 quadrants per arc-doc layout contract (§"Home tab layout")
  - Each quadrant: label + 3–5 primitive stats + "Drill through →"
    button that switches to the owning tab with a filter pre-applied
    (via existing `switchTab` + new `applyFilter` query-string hook)
  - Footer: **Unified activity feed** — scrolling list of the last 25
    hub events, newest first, with a `correlationId` group-by toggle
    (when toggled: events with the same `correlationId` collapse into
    a single expandable row)
  - Empty-state per quadrant when the reader returns `null`: shows
    "Subsystem not initialized — see [Docs link]" card
- Dashboard app.js additions:
  - `renderHomePanel(snapshot)` — pure DOM builder from
    `forge_home_snapshot` payload
  - `applyFilter(tab, filterKey, filterValue)` — URL-param-based
    drill-through (existing tab-switcher unchanged)
  - `renderActivityFeed(events, { groupByCorrelation })` — reuses
    existing `formatHubEvent` helpers
  - 30-second refresh when the tab is active (via existing
    `startPanelRefresh` helper); paused on tab blur
- Home tab is **first tab on the strip**; existing 13 tabs shift right
  but remain in the same relative order. No existing tab removed.
- `data-testid` selectors on every quadrant + feed item for UI tests.
- **Accessibility**: 4 quadrants use `role="region"` + `aria-labelledby`.
  Feed uses `role="log"` + `aria-live="polite"`. Keyboard navigation:
  Tab order goes quadrants → feed → other tabs.
- Watcher-tab chip row gets a new leftmost chip:
  `Home: <inFlight runs> / <open incidents> / <open bugs>` —
  primitives only; hidden if all three are `null`.

### Out of scope (for this phase — later arc phases)

- Review queue (FORGE-SHOP-02)
- Notification adapters (FORGE-SHOP-03)
- Global search bar (FORGE-SHOP-04)
- Unified timeline tab (FORGE-SHOP-05)
- Any new writer — this phase reads only
- Any change to existing subsystem readers (`readCrucibleState`,
  `readTemperingState`, `readLiveguardState`, `findLatestRun`)
- Any change to the hub event schema

### Forbidden actions

- Do NOT duplicate any reader — `readHomeSnapshot` only **composes**
  existing readers
- Do NOT create new hub events in this phase (`review-queue-*` lands
  in FORGE-SHOP-02; `notification-*` in FORGE-SHOP-03)
- Do NOT create new correlationIds — activity-feed group-by uses
  whatever is already on the event
- Do NOT add a new L2 record family
- Do NOT modify `pforge-mcp/tools.json` by hand — it regenerates from
  `capabilities.mjs` via the existing build step
- Do NOT call any reader more than once per `forge_home_snapshot`
  invocation (budget guard)
- Do NOT emit notifications or send any network traffic from this phase
- Do NOT run any test framework directly — this phase stays read-only
  in spirit, even though CI runs the vitest suite

## Slices

### Slice 01.1 — `readHomeSnapshot` + `forge_home_snapshot` MCP tool

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `readHomeSnapshot` export (~120 LOC)
- `pforge-mcp/server.mjs` — `forge_home_snapshot` handler (~40 LOC)
- `pforge-mcp/capabilities.mjs` — TOOL_METADATA entry
- `pforge-mcp/tools.json` — auto-regenerated (do not hand-edit)
- `pforge-mcp/tests/forge-shop-home.test.mjs` — **new**, ~18 tests
- `pforge-mcp/tests/forge-shop-home.perf.test.mjs` — **new**, 1 perf
  test enforcing the 250ms budget on a fixture with 1 000 L2 records

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **52 tools** registered (was 51).

**Self-check before commit:**
- `forge_home_snapshot` on this repo returns all four quadrants
  populated (we have Crucible, runs, LiveGuard, Tempering state)
- `forge_home_snapshot` on a brand-new project scaffold returns all
  four quadrants as `null` without throwing
- Perf test passes (< 250ms for 1 000 events)

### Slice 01.2 — Home tab UI + watcher chip

**Files touched:**
- `pforge-mcp/dashboard/index.html` — Home tab pane, 4 quadrant
  containers, activity-feed container, correlationId group-by toggle
- `pforge-mcp/dashboard/app.js` — `renderHomePanel`, `applyFilter`,
  `renderActivityFeed`, Watcher chip, refresh wiring (~180 LOC)
- `pforge-mcp/dashboard/styles.css` (if present) — 4-quadrant grid
  layout (otherwise inline in index.html)
- `pforge-mcp/orchestrator.mjs` — Watcher chip row extension in
  `buildWatchSnapshot` (~15 LOC additive)
- `pforge-mcp/tests/forge-shop-home-ui.test.mjs` — **new**, ~12 tests
  (jsdom-based DOM assertions)
- `pforge-mcp/tests/forge-shop-home-watcher.test.mjs` — **new**, ~8
  tests for the new chip in `buildWatchSnapshot`

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual dashboard
smoke-test (documented in PR body): open
`localhost:3100/dashboard`, Home tab is first and loads without
errors on both a populated repo (this one) and an empty project.

**Self-check before commit:**
- All four quadrants render with either data or empty-state cards
- Drill-through buttons switch to the owning tab and apply a filter
  (URL contains `?filter=...` after click)
- Activity feed shows the last 25 hub events from this repo
- CorrelationId group-by toggle visually collapses rows with matching
  IDs
- Tab keyboard order is correct: Home → Crucible → … (use Tab key)

## Success Criteria

- `forge_home_snapshot` returns the contracted shape, or `{ ok: false,
  error }` only on IO failure
- Home tab is the default tab on dashboard load
- All four quadrants populate from existing readers without adding any
  new L2 writer
- Watcher chip row carries the Home chip (or `null` when appropriate)
- Perf budget: `readHomeSnapshot` ≤ 250ms on 1 000 L2 records
- Zero new TODO/FIXME/stub markers (`forge_sweep` clean on touched
  files)
- All existing tests continue to pass; new test count +35–40
- Total tool count goes 51 → 52 (only `forge_home_snapshot` added)
- CHANGELOG entry under `[Unreleased]` targeting v2.48.0
- `Phase-FORGE-SHOP-01.md` moves `status: draft` → `status: in_progress`
  at start, → `status: complete` on merge

## Dependencies on later phases

**None.** This phase is standalone. If FORGE-SHOP-02–05 never ship,
FORGE-SHOP-01 still delivers a useful one-screen shop overview.

## Dependencies from prior phases

- TEMPER-06 merged (✅ shipped in v2.47.0) — `readTemperingState`
  includes `openBugs` count
- LiveGuard IV merged (✅ shipped in v2.30.0) — `readLiveguardState`
  returns drift + incidents + fix proposals

## Notes for the executing agent

- The Home tab must be **first** in the tab strip. Look at how the
  Crucible tab was inserted during its rollout (`index.html`: the
  `tab-strip` list) and mirror that pattern with the opposite
  direction (prepend, not append).
- `applyFilter` is URL-param based: do NOT invent a new state bus —
  each owning tab already reads `window.location.search` on activate.
  Extend the existing parsers on the drill-through target tabs
  minimally (one `if` per tab).
- The perf budget is real — `readHomeSnapshot` is called on 30s
  refresh cycles. If it slips past 250ms on 1 000 events the watcher
  will appear frozen.
- For `correlationId` group-by: events without a correlationId do not
  group — they render as individual rows always.
