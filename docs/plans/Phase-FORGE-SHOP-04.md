---
crucibleId: 7a2f4c91-b845-4d6e-8c23-f1d84a2b6c09
source: self-hosted
status: complete
phase: FORGE-SHOP-04
arc: FORGE-SHOP
---

# Phase FORGE-SHOP-04: Global search — `forge_search` MCP + dashboard header bar

> **Status**: ✅ COMPLETE — shipped 2026-04-19 (commits d72d90b, 722ea08)
> **Estimated Effort**: 2 slices
> **Risk Level**: Low-medium (read-only over existing L2/L3 records;
> ranking is the only new algorithm)
> **Target Version**: v2.51.0

See arc overview: [Phase-FORGE-SHOP-ARC.md](Phase-FORGE-SHOP-ARC.md)
Prior phase: [Phase-FORGE-SHOP-03.md](Phase-FORGE-SHOP-03.md)

---

## Why

FORGE-SHOP-01/02/03 shipped the Home tab, Review queue, and
Notification layer — operators can now *see* what needs attention and
get *pinged* when it matters. The surface is still navigation-heavy
though: **G7** from the arc doc ("Find me that bug / smelt / incident /
run" requires knowing which tab). The operator has ~9 tabs and ~15
artifact stores (runs, bugs, incidents, tempering, hub events,
notifications, review queue, memories, openbrain queue, …) and no
cross-cutting query.

FORGE-SHOP-04 adds **one tool** (`forge_search`) plus **one UI affordance**
(header search bar with `/` hotkey). Both read from existing L2
records and the L3 OpenBrain index — **no new writers, no new stores**.
Ranking is deterministic: recency-decayed tag-match score with a
correlationId exact-match boost.

## Scope Contract

### In-scope

**Slice 04.1 — `forge_search` core + MCP tool + L2/L3 merge**

- `pforge-mcp/search/` — **new directory**, 2 files:
  - `core.mjs` — query parser, L2 scanner, L3 merger, ranker (~260
    LOC)
  - `sources.mjs` — L2 source registry (which files to scan + how to
    map records) (~140 LOC)
- L2 sources (all read-only, all existing files):
  - `.forge/runs/<id>/events.log` (JSON lines) → `{ source: "run",
    recordRef: "<runId>", text: slice titles + event types }`
  - `.forge/bugs/<bugId>.json` → `{ source: "bug", recordRef: bugId,
    text: title + description + tags }`
  - `.forge/incidents/*.json` → `{ source: "incident", recordRef: id,
    text: title + severity + summary }`
  - `.forge/tempering/<runId>.json` → `{ source: "tempering",
    recordRef: runId, text: failingRules + offendingPaths }`
  - `.forge/hub-events.jsonl` → `{ source: "hub-event",
    recordRef: eventId, text: type + correlationId }` (cap last 5000
    for perf)
  - `.forge/review-queue.json` → `{ source: "review",
    recordRef: itemId, text: title + tags }`
  - `.forge/liveguard-memories.jsonl` → `{ source: "memory",
    recordRef: id, text: tags + summary }`
  - Plan files `docs/plans/Phase-*.md` → `{ source: "plan",
    recordRef: phaseId, text: title + frontmatter }`
- L3 source: OpenBrain `searchMemory({ query, tags, since })` — **only
  called when OpenBrain is configured** (`openbrain.endpoint` in
  `.forge.json`). Results merged with L2 hits; dedupe by correlationId
- Query shape:
  - `query: string` — free-text, tokenized on whitespace, case-insensitive
  - `tags?: string[]` — filter: hit must have ALL listed tags
  - `since?: string` — ISO timestamp or relative (`"24h"`, `"7d"`)
  - `correlationId?: string` — filter AND +10.0 score boost on exact
    match
  - `sources?: string[]` — limit to source types (default: all)
  - `limit?: number` — default 50, max 200
- Ranking (deterministic, documented in `core.mjs` header):
  - Base score: token-overlap count / max(query tokens, 1)
  - Recency decay: multiply by `exp(-ageHours / 168)` (1-week
    half-life)
  - Tag match bonus: +0.5 per matching tag
  - Source-type weight: `bug` 1.2, `incident` 1.3, `run` 1.0,
    `memory` 0.9, `hub-event` 0.7, `plan` 1.1, `tempering` 1.0,
    `review` 1.1
  - correlationId exact match: +10.0 (overrides all)
- **Performance budget**: p95 < 250 ms for a cold query over a project
  with 5000 hub events + 500 runs + 100 bugs + 50 incidents. Cache
  parsed JSON in a 60-second LRU (max 200 entries) inside `core.mjs`.
  Cache invalidated by file mtime check
- MCP tool:
  - **`forge_search`** — input matches query shape above. Output:
    `{ hits: [{ source, recordRef, snippet, score, correlationId,
    timestamp }], total, truncated, durationMs }`. `writesFiles:
    false`, `network: false`, `risk: "low"`
- TOOL_METADATA entry in `capabilities.mjs` + regenerated
  `tools.json`; `addedIn: "2.51.0"`; full contract
- Hub events: **none** — search is pure read
- Telemetry: OTEL span per `search()` with duration, hit count,
  source counts
- Tests in `pforge-mcp/tests/search-core.test.mjs`:
  - Token matching (case-insensitive, whitespace split)
  - Each L2 source mapper (8 sources × 2 fixtures each)
  - Ranker: recency decay, tag bonus, source weight,
    correlationId boost
  - Limit + truncation semantics
  - Since-filter with ISO and relative ("24h", "7d") inputs
  - Cache invalidation on mtime change
  - OpenBrain disabled → L2-only results
  - OpenBrain mocked → L2 + L3 merged and deduped
  - Performance guard: fixture of 5000 hub events returns under 250 ms
    (skipped on CI with env `CI_SKIP_PERF=1`)

**Slice 04.2 — Dashboard header search bar + keyboard shortcut + results surface**

- `pforge-mcp/dashboard/index.html` — header search bar (always
  visible in shell, above tabs). Structure:
  - `<input type="search" id="global-search" placeholder="Search runs, bugs, incidents… (press /)" />`
  - `<kbd class="search-hint">/</kbd>`
  - Results dropdown (`<div id="search-results" role="listbox">`)
    with grouped sections by `source`
- `pforge-mcp/dashboard/app.js` — new module `search.js` (~220 LOC):
  - `bindGlobalSearch()` — wires `/` hotkey (ignore when focus in
    input/textarea), Escape to close, Arrow Up/Down to navigate,
    Enter to activate
  - Debounced input (150 ms) → `forge_search` MCP call
  - Result item click → deep-link: `run` → Runs tab with filter,
    `bug` → Bugs tab with selection, `incident` → Incidents tab with
    selection, `review` → Review tab, `plan` → opens file in new
    window via GitHub blob URL, `memory` / `hub-event` / `tempering`
    → Timeline tab (FORGE-SHOP-05 stub route — link works but lands
    on a "coming soon" panel until SHOP-05 ships)
  - Highlight matched tokens in snippets (safe HTML escape)
  - Empty-result state with tip: "Try `tags:blocker` or
    `since:24h`"
- Query-syntax sugar parsed client-side before calling tool:
  - `tags:a,b` → `{ tags: ['a', 'b'] }`
  - `since:24h` → `{ since: '24h' }`
  - `source:bug` → `{ sources: ['bug'] }`
  - `correlation:<id>` → `{ correlationId: id }`
  - Everything else joins into `query` string
- Search bar state:
  - Last 5 queries cached in `localStorage` under
    `pforge.search.history` — shown as suggestions on empty focus
  - Loading spinner while tool call in flight
  - Error banner if `forge_search` returns non-200
- `forge_smith` panel: new "Search:" row showing
  `sources indexed / avg query ms (last hour) / last query timestamp`
- `capabilities.mjs` updates for Search row in smith output
- Tests in `pforge-mcp/tests/search-ui.test.mjs` (jsdom, ~18 tests):
  - `/` hotkey focuses search (and ignores it inside `<input>`)
  - Escape clears and blurs
  - Arrow keys navigate result list
  - Debounce: 150 ms between keystroke and tool call
  - Query-syntax parser (5 sugars + plain text)
  - Deep-link mappings per source type
  - localStorage history capped at 5 entries, dedupe on re-query
  - Snippet escape (no XSS from matched tokens)
- Tests in `pforge-mcp/tests/search-smoke.test.mjs` (~6 tests):
  - End-to-end: call tool with fixtures across 3 L2 sources, assert
    hits ordered by score, assert deep-link URLs well-formed

### Out of scope (later)

- Full-text indexing (Lucene / MiniSearch) — token scan over L2 is
  sufficient for current data volumes; revisit if p95 exceeds budget
- Fuzzy matching / typo tolerance — exact token match only for now;
  add if user feedback demands it
- Saved searches — history caching only this phase
- Search-as-you-type previews in result snippets — static snippets
  around first matched token only
- Search over agent transcripts — transcripts live in `.forge/runs/`
  but are large; phase skips for perf. Add as a new source in a
  later phase if requested
- Cross-project search — single-project scope; multi-project federation
  is a future concern

### Forbidden actions

- Do NOT create new persistent stores — search is read-only over
  existing L2 files + L3 OpenBrain index
- Do NOT block the hub while searching — all file reads are async;
  no sync fs calls on hot path
- Do NOT re-read a file within the 60-second cache window unless
  mtime has changed
- Do NOT leak raw file paths in snippets — sanitize to relative
  `.forge/...` form
- Do NOT render unescaped HTML in result snippets — pass through
  `escapeHtml()` before injecting into the DOM
- Do NOT index agent transcript bodies from `.forge/runs/<id>/` —
  file sizes make it a perf hazard; transcripts are out of scope
- Do NOT add new hub events — search is pure query; nothing to emit
- Do NOT call OpenBrain if `openbrain.endpoint` is unset or endpoint
  returned 4xx/5xx in the last 5 minutes (cached failure sentinel)
- Do NOT break FORGE-SHOP-05 stub route — Timeline tab link must
  resolve to an existing route even if the tab isn't rendered yet
  (landing panel with "Timeline tab ships in SHOP-05" message is
  acceptable; 404 is not)

## Slices

### Slice 04.1 — `forge_search` core + MCP tool + L2/L3 merge

**Files touched:**
- `pforge-mcp/search/core.mjs` — **new**, ~260 LOC
- `pforge-mcp/search/sources.mjs` — **new**, ~140 LOC
- `pforge-mcp/server.mjs` — 1 tool handler (~60 LOC)
- `pforge-mcp/capabilities.mjs` — 1 TOOL_METADATA entry
- `pforge-mcp/tools.json` — auto-regenerated
- `pforge-mcp/tests/search-core.test.mjs` — **new**, ~32 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass, **58 tools** registered (was 57).

### Slice 04.2 — Dashboard header search bar + keyboard shortcut + results surface

**Files touched:**
- `pforge-mcp/dashboard/index.html` — header bar + results dropdown
- `pforge-mcp/dashboard/app.js` — `bindGlobalSearch`, deep-link
  router, query-syntax parser (~220 LOC)
- `pforge-mcp/orchestrator.mjs` — `forge_smith` Search row metrics
- `pforge-mcp/capabilities.mjs` — smith output formatting
- `pforge-mcp/tests/search-ui.test.mjs` — **new**, ~18 tests
- `pforge-mcp/tests/search-smoke.test.mjs` — **new**, ~6 tests

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test
in PR body: load dashboard, press `/`, type "blocker tags:review",
confirm result dropdown renders with review-queue items; click one,
confirm deep-link to Review tab with item selected.

## Success Criteria

- 1 new MCP tool registered (tool count 57 → 58)
- Header search bar present on every dashboard tab
- `/` hotkey focuses search; Escape closes; Arrow keys navigate;
  Enter activates
- 8 L2 sources searchable (run, bug, incident, tempering, hub-event,
  review, memory, plan)
- L3 OpenBrain merge works when configured; gracefully skipped when
  not
- p95 search < 250 ms on 5000-event fixture (perf test passes locally,
  skippable on CI)
- Query-syntax sugars parsed: `tags:`, `since:`, `source:`,
  `correlation:`
- Deep-links work for every source type
- Last 5 queries persisted per browser session
- Zero XSS in snippet rendering (escape test present)
- Zero new TODO/FIXME/stub markers on touched files
- Test count +56
- CHANGELOG entry under `[Unreleased]` targeting v2.51.0
- `Phase-FORGE-SHOP-04.md` `status: draft` → `in_progress` → `complete`

## Dependencies

**From prior phases:**
- FORGE-SHOP-01 ✅ — dashboard shell hosts the header bar
- FORGE-SHOP-02 ✅ — `.forge/review-queue.json` is one of the 8
  L2 sources
- FORGE-SHOP-03 ✅ — notification-* hub events are searchable via
  the `hub-event` source

**On later phases:**
- FORGE-SHOP-05 unified timeline — search deep-links to Timeline tab
  for `memory` / `hub-event` / `tempering` results. Stub landing
  panel acceptable until SHOP-05 lands
- FORGE-SHOP-06 ask-bus — search results hit correlationId matches;
  ask-bus consumes the same correlationId for thread recall
- FORGE-SHOP-07 Brain facade — `searchMemory` call will go through
  the Brain facade once SHOP-07 ships (migration, no contract change)

## Notes for the executing agent

- The **60-second LRU cache** is a perf lever — set small max size
  (200 entries) to keep memory predictable. Key by `filePath + mtime`.
  Invalidation is automatic: mtime check on every scan
- The **`since:` relative parser** is a known gotcha — support
  `Nh`, `Nd`, `Nm` (minutes), `Nw` (weeks). Reject other units with
  `ERR_BAD_SINCE`. Write tests for every unit
- The **correlationId +10.0 boost** must dominate. Write a test
  where a run with correlation match scores above a bug with 100%
  token overlap but no correlation match
- The **perf test** uses a generated fixture, not real `.forge/`.
  Keep generator deterministic (seeded RNG) so results are stable
- The **OpenBrain failure sentinel** prevents repeated 5-second
  timeouts when the endpoint is down. Cache `{ lastFailureTs }` in
  module scope; skip if now - lastFailureTs < 300_000
- The **`/` hotkey** must ignore keypresses when focus is already
  inside a text input, textarea, or contenteditable element. Test it
- Snippet generation: slice ~80 chars around the first matched
  token, prefix/suffix with `…` when truncated
- Deep-link routing uses the existing tab-switching mechanism from
  SHOP-01 dashboard shell; do not invent a new router
- The `source:` sugar and `sources` input are the same filter;
  normalize client-side before calling the tool
