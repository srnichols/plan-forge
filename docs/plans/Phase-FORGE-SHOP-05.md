---
crucibleId: 4e8a1f23-6c75-4d89-bf42-a3e6c9d1b5f8
source: self-hosted
status: draft
phase: FORGE-SHOP-05
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-05: Unified timeline — `forge_timeline` MCP + Timeline tab

> **Status**: 📝 DRAFT — ready for Session 2 execution
> **Estimated Effort**: 2 slices
> **Risk Level**: Low (read-only merge over existing L2 records;
> correlationId group-by is the only new algorithm)
> **Target Version**: v2.52.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)
Prior phase: [Phase-FORGE-SHOP-04.md](Phase-FORGE-SHOP-04.md)

---

## Why

FORGE-SHOP-04 shipped global search — operators can find any record
by text/tag. But the arc's **G11 pain point** (the arc doc §"Pain
points") is still open: *"Debugging 'what happened Tuesday at 3pm?'
needs 5 separate file greps."* Search answers "where is X?";
timeline answers "what happened during window Y?".

FORGE-SHOP-05 delivers a **merged chronological view** across 7 L2
event sources, with a correlationId group-by toggle that threads
runs, hub events, tempering, and memories around a single workstream.
No new writers, no new events — this phase **reads** the history the
system already writes.

## Scope Contract

### In-scope

**Slice 05.1 — `forge_timeline` core + MCP tool + correlationId grouping**

- `pforge-mcp/timeline/` — **new directory**, 2 files:
  - `core.mjs` — time-window filter, source merger, correlationId
    grouper (~200 LOC)
  - `sources.mjs` — L2 source registry mapping each file to
    `{ ts, source, event, correlationId, payload }` tuples (~160 LOC)
- L2 sources (all read-only, all existing files):
  - `.forge/hub-events.jsonl` → `{ source: "hub-event", event: type,
    ts, correlationId, payload }`
  - `.forge/runs/<runId>/events.log` → `{ source: "run", event:
    "slice-started"|"slice-completed"|..., ts, correlationId: runId }`
    (slice events, gates, failures)
  - `.forge/liveguard-memories.jsonl` → `{ source: "memory", event:
    "memory-captured", ts, correlationId, payload: { tags, summary } }`
  - `.forge/openbrain-queue.jsonl` → `{ source: "openbrain", event:
    "queued"|"synced"|"failed", ts, correlationId }`
  - `.forge/watch-history.jsonl` → `{ source: "watch", event:
    anomalyName, ts, correlationId }`
  - `.forge/tempering/<runId>.json` → unroll `runSteps[]` into
    `{ source: "tempering", event: "step-started"|"step-passed"|
    "step-failed", ts, correlationId: runId }`
  - `.forge/bugs/<bugId>.json` → `{ source: "bug", event:
    "bug-registered"|"bug-resolved", ts, correlationId: bugId }`
  - `.forge/incidents/*.json` → `{ source: "incident", event:
    "incident-opened"|"incident-resolved", ts, correlationId: id }`
- Query shape:
  - `from?: string` — ISO timestamp or relative (`"24h"`, `"7d"`,
    `"30m"`). Default: `now - 24h`
  - `to?: string` — ISO timestamp or relative. Default: `now`
  - `correlationId?: string` — filter to matching thread only
  - `sources?: string[]` — limit to source types (default: all 7)
  - `events?: string[]` — filter by event type (e.g., `["slice-*",
    "tempering-*"]` — glob supported)
  - `groupBy?: "time" | "correlation"` — default `"time"` returns
    flat chronological list; `"correlation"` returns array of threads
    `[{ correlationId, events: [...] }]` sorted by most-recent-event
  - `limit?: number` — default 500, max 2000
- Merge algorithm (`core.mjs`):
  - Read each enabled source in parallel via `Promise.all`
  - Filter each by `from`/`to`/`events`/`correlationId` **before**
    the merge (cheaper than filter-after-sort)
  - Concat + sort by `ts` ascending
  - If `groupBy: "correlation"`, bucket by `correlationId` after the
    sort, preserving within-thread order
  - Truncate to `limit` (flat mode) or `limit` threads (correlation
    mode)
- **Performance budget**: p95 < 400 ms for `from: "7d"` across 10k
  hub events + 1k memories + 500 run-events + 100 tempering-runs.
  Per-file cache keyed by `filePath + mtime + (from, to, events)`;
  60-second LRU, max 100 entries. Streaming JSONL reader for
  `hub-events.jsonl` and `liveguard-memories.jsonl` (do not load full
  files into memory)
- MCP tool:
  - **`forge_timeline`** — input matches query shape above. Output
    (flat): `{ events: [{ ts, source, event, correlationId, payload,
    recordRef }], total, truncated, durationMs, windowFrom, windowTo,
    sourcesQueried }`. Output (grouped): `{ threads: [{ correlationId,
    events: [...], firstTs, lastTs, sources: [...] }], total,
    truncated, durationMs, ... }`. `writesFiles: false`,
    `network: false`, `risk: "low"`
- TOOL_METADATA entry in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.52.0"`; full contract
- Hub events: **none** — timeline is pure read
- Telemetry: OTEL span per `timeline()` with duration, event count,
  window size, source counts
- Tests in `pforge-mcp/tests/timeline-core.test.mjs` (~32 tests):
  - Each source mapper (7 sources × 2 fixtures)
  - Time window: ISO, relative (`24h`, `7d`, `30m`), edge-case empty
    window
  - `events` glob matching (`slice-*`, `tempering-*`)
  - `correlationId` exact-match filter
  - `groupBy: "time"` vs `groupBy: "correlation"` output shapes
  - Sort stability: events with identical `ts` preserve source order
  - Limit + truncation semantics for both flat and grouped modes
  - Streaming reader: assert 10k-line JSONL doesn't exceed 50 MB
    heap during read (approximate via `process.memoryUsage`)
  - Cache invalidation on mtime change
  - Performance guard: 10k-event fixture returns under 400 ms
    (skippable with `CI_SKIP_PERF=1`)

**Slice 05.2 — Dashboard Timeline tab + correlationId filter UI**

- `pforge-mcp/dashboard/index.html` — new **Timeline** tab:
  - Top bar: time-window selector (preset chips: `15m`, `1h`, `6h`,
    `24h`, `7d`, `30d`; custom datetime-range inputs)
  - Filters: source toggles (multi-select chip set), event-type
    search input (prefix-match), correlationId input (with clear
    button and "copy from URL" button)
  - View toggle: **Flat** (chronological stream) vs **Threaded**
    (correlationId group-by)
  - Flat view: vertical scrollable list; each row shows `ts` (local
    time + relative), source icon, event name, short payload
    summary. Click → expand JSON payload
  - Threaded view: accordion; each thread header shows correlationId
    (truncated 8 chars), span `firstTs → lastTs`, source chip row,
    event count. Expanding renders the flat list within
  - Auto-refresh toggle: 10-second polling when enabled; off by
    default. Pause-on-scroll
  - Deep-link target: `#timeline?correlationId=<id>&from=<iso>`
    honored on load — search result clicks from SHOP-04 land here
    with pre-filled state
- `pforge-mcp/dashboard/app.js` — new module `timeline.js` (~280 LOC):
  - `renderTimelineTab()` — initial paint from deep-link state or
    default 24h window
  - `fetchTimeline(params)` — calls `forge_timeline` MCP, normalizes
    relative times to ISO before send
  - `renderFlatStream(events)` — virtualized list (render only
    visible ± 50 rows); assume up to 500 events displayed
  - `renderThreadedView(threads)` — accordion with lazy-expand
  - `bindCorrelationIdChips()` — clicking a correlationId in any
    event row filters the whole view to that thread
  - URL state sync: `from`, `to`, `correlationId`, `sources`, `groupBy`
    reflected in hash router so refresh preserves view
- Timeline-tab landing stub from SHOP-04 **replaced** — "coming soon"
  message removed; deep-links now render actual timeline
- Home-tab activity feed link "See full timeline →" → deep-links to
  Timeline tab with same 24h window
- `forge_smith` panel: new "Timeline:" row showing `last 24h events /
  sources active / oldest unresolved thread (correlationId + age)`
- `capabilities.mjs` updates for Timeline row in smith output
- Tests in `pforge-mcp/tests/timeline-ui.test.mjs` (jsdom, ~22 tests):
  - Time-window preset chips update query params
  - Custom datetime range validates `from < to` with clear error
  - Source toggle removes/adds filters
  - View toggle switches between flat and threaded renders
  - Correlation ID chip click filters to that thread
  - URL hash sync on filter change + deep-link load
  - Auto-refresh polls every 10s; pauses during user scroll
  - Empty-state rendering with tip: "Try widening the window
    or removing filters"
  - XSS: payload summary rendering escapes HTML
- Tests in `pforge-mcp/tests/timeline-smoke.test.mjs` (~8 tests):
  - End-to-end: seed 3 L2 sources, call tool with `groupBy:
    correlation`, assert threads ordered by most-recent, assert
    each thread sorted internally by `ts`
  - Deep-link payload `#timeline?correlationId=X` → UI renders
    single thread view

### Out of scope (later)

- Sub-second event ordering — merge uses ms-precision timestamps;
  ties preserve source insertion order
- Real-time streaming over WebSocket — `forge_watch_live` already
  exists; timeline is a query surface, not a stream. Polling every
  10s is sufficient
- Cross-project timelines — single-project scope
- Event editing / annotation — read-only view of what happened
- Export to CSV / PDF — not in this phase; copy-as-JSON from payload
  modal is acceptable
- Rendering agent transcripts in-line — transcript files are large
  and structured differently; view them via existing Runs tab
- Custom saved views — URL hash is the persistent view. Browser
  bookmarks cover this need
- Heatmap / density visualization — list view only this phase

### Forbidden actions

- Do NOT create new persistent stores — timeline is read-only over
  existing L2 files
- Do NOT re-load source files within the 60-second cache window
  unless mtime has changed
- Do NOT pull the full contents of `hub-events.jsonl` into memory —
  stream line-by-line, filter inline, drop non-matching lines before
  JSON.parse
- Do NOT block the hub while building a response — async `Promise.all`
  over sources; no sync fs calls on the hot path
- Do NOT render unescaped HTML in event payload summaries or
  expanded JSON — escape before DOM injection
- Do NOT add new hub events — timeline reads, it does not emit
- Do NOT let payload truncation hide critical fields —
  `correlationId`, `ts`, `severity`, `adapter`, and `errorCode`
  always shown in the summary row even if payload is large;
  everything else goes in the expandable JSON modal
- Do NOT exceed 2000 events in a single response — hard cap on
  `limit` input; return `truncated: true` with the highest `ts`
  cursor for the caller to page

## Slices

### Slice 05.1 — `forge_timeline` core + MCP tool + correlationId grouping

**Files touched:**
- `pforge-mcp/timeline/core.mjs` — **new**, ~200 LOC
- `pforge-mcp/timeline/sources.mjs` — **new**, ~160 LOC
- `pforge-mcp/server.mjs` — 1 tool handler (~60 LOC)
- `pforge-mcp/capabilities.mjs` — 1 TOOL_METADATA entry
- `pforge-mcp/tools.json` — auto-regenerated
- `pforge-mcp/tests/timeline-core.test.mjs` — **new**, ~32 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **59 tools** registered (was 58).

### Slice 05.2 — Dashboard Timeline tab + correlationId filter UI

**Files touched:**
- `pforge-mcp/dashboard/index.html` — Timeline tab markup, filters,
  view toggle
- `pforge-mcp/dashboard/app.js` — `timeline.js` module, hash router
  integration (~280 LOC)
- `pforge-mcp/dashboard/app.js` — Home-tab "See full timeline" link
  update (~10 LOC)
- `pforge-mcp/orchestrator.mjs` — `forge_smith` Timeline row metrics
- `pforge-mcp/capabilities.mjs` — smith output formatting
- `pforge-mcp/tests/timeline-ui.test.mjs` — **new**, ~22 tests
- `pforge-mcp/tests/timeline-smoke.test.mjs` — **new**, ~8 tests

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test
in PR body: load dashboard, navigate to Timeline tab, switch to
`6h` window, toggle threaded view, click a correlationId chip,
confirm URL hash updates and single-thread view renders.

## Success Criteria

- 1 new MCP tool registered (tool count 58 → 59)
- Timeline tab present and selectable in dashboard shell
- 7 L2 sources merged chronologically (run, hub-event, memory,
  openbrain, watch, tempering, bug, incident — 8 if counting bugs
  and incidents separately; the test fixture validates all)
- Flat and threaded (correlationId group-by) views work
- Deep-links from SHOP-04 search results land on pre-filtered view
- Time-window presets + custom range both work
- p95 timeline < 400 ms on 10k-event fixture (perf test passes
  locally, skippable on CI)
- Streaming JSONL reader verified under heap pressure
- URL hash sync preserves state across refresh
- Auto-refresh 10s polling with pause-on-scroll
- Zero XSS in payload rendering (escape test present)
- Zero new TODO/FIXME/stub markers on touched files
- Test count +62
- CHANGELOG entry under `[Unreleased]` targeting v2.52.0
- `Phase-FORGE-SHOP-05.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- FORGE-SHOP-01 ✅ — dashboard shell hosts the Timeline tab
- FORGE-SHOP-03 ✅ — `notification-sent`, `notification-send-failed`,
  `notification-rate-limited` events are timeline-visible
- FORGE-SHOP-04 ✅ — search deep-links land on Timeline tab; the
  "coming soon" stub is replaced in Slice 05.2
- Existing `.forge/hub-events.jsonl` writer (v2.1+) — already captures
  every hub event with correlationId
- Existing `.forge/runs/<id>/events.log` writer (v2.0+) — already
  captures slice lifecycle

**On later phases:**
- FORGE-SHOP-06 ask-bus — correlationId-threaded replies land on
  timeline as `ask-*` events (emitted by SHOP-06); timeline tolerates
  unknown event types in payload
- FORGE-SHOP-07 Brain facade — `memory-captured` events migrate to
  Brain facade; timeline keeps reading `liveguard-memories.jsonl`
  directly until the facade exposes a read API

## Notes for the executing agent

- The **streaming JSONL reader** is non-negotiable for perf. Use
  Node's `readline` over a `fs.createReadStream`; call `JSON.parse`
  per line inside the stream handler, not after `readFile()`. Write
  a heap-size test that proves it
- The **relative time parser** (`24h`, `7d`, `30m`) must match the
  SHOP-04 implementation exactly. Factor into a shared util if it
  isn't already. If SHOP-04 shipped one, reuse it; do not duplicate
- The **correlationId group-by** is cheap after sort. Do NOT sort
  inside buckets — iterate the already-sorted flat list, append to
  bucket[correlationId]. Thread order is preserved for free
- The **virtualized list** in the UI is the difference between a
  smooth 500-row render and a 3-second paint. Use a simple
  "render rows [scrollTop/rowHeight ± 50]" scheme; no external
  virtualization library
- **URL hash router** reuses whatever SHOP-01/SHOP-02 established;
  do not invent a new one. If none exists, add a 20-line hash
  parser to `app.js` and reuse it for Timeline + any future tab
- The **Timeline-tab landing stub** from SHOP-04 must be **replaced**
  (not merely hidden). Delete the "coming soon" panel code path;
  do not leave dead branches
- Auto-refresh polling uses `setInterval(10_000)` with a **pause**
  during scroll (track `scrollend` or debounce `scroll` to reset
  a 2-second timeout). Do not poll while the user is actively
  navigating
- Payload rendering: summary row shows max 80 chars; expand to
  `<pre><code>` for full JSON. Escape via `escapeHtml()` from the
  shared dashboard util
- The **payload summary field allowlist** (`correlationId`, `ts`,
  `severity`, `adapter`, `errorCode`) is the minimum always-shown
  set. Prefer these over arbitrary payload keys when building
  the summary
