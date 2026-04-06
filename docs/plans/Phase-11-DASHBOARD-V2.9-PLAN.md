# Phase 11: Dashboard v2.9 — Full Capability Surface + Memory UX

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 1 day (8 execution slices)  
> **Risk Level**: Low (UI changes + bug fixes, no schema or protocol changes)  
> **Branch**: `feature/v2.9-dashboard-power-ux`  
> **Quorum**: Auto

---

## Overview

Surface all remaining backend capabilities in the dashboard, fix 5 identified bugs, redesign Memory Search with presets/auto-populate for usability, and add power features (run launch, DAG visualizer, event log, tab badges). This phase makes the dashboard a complete management surface for every Plan Forge capability.

---

## Prerequisites

- [x] v2.8 Power UX merged to master (`1988b08`)
- [x] Master clean at `038e5d0`
- [x] Self-tests passing (69/69)
- [x] Gap analysis complete (22 enhancements + 5 bugs identified)

## Acceptance Criteria

- [ ] All 5 bugs (B1-B5) fixed
- [ ] Memory Search returns useful results with preset queries and auto-populated suggestions
- [ ] Hub client count shown in header
- [ ] Runs table auto-refreshes on WebSocket events
- [ ] Version displayed in footer
- [ ] Plan scope contract visible in Plan Browser
- [ ] Slice tasks/commands visible in Run Detail Drawer
- [ ] Config tab exposes quorum, parallelism, retries settings
- [ ] Run Launch Panel allows starting plans from dashboard
- [ ] DAG dependency view in Plan Browser
- [ ] Tab badge counts for runs/cost/skills
- [ ] Cost + Duration charts with CSV export
- [ ] Event history log visible
- [ ] Self-tests passing (69/69)

---

## Scope Contract

### In Scope
- `pforge-mcp/dashboard/app.js` — all client-side enhancements
- `pforge-mcp/dashboard/index.html` — HTML structure additions
- `pforge-mcp/server.mjs` — version fix, memory search improvements, new endpoints
- `VERSION` — bump to 2.9.0
- `CHANGELOG.md` — v2.9.0 entry

### Out of Scope
- Orchestrator logic changes
- WebSocket protocol changes
- New MCP tools
- CLI script changes (pforge.ps1/pforge.sh)
- Test framework changes
- Documentation site (docs/*.html)

### Forbidden Actions
- Modifying `orchestrator.mjs` execution logic
- Changing hub.mjs broadcast protocol
- Adding npm dependencies
- Changing REST API response schemas (additive only)

---

## Required Decisions

| Decision | Resolution |
|----------|------------|
| Memory search approach | Use categorized presets + free-text, show helpful prompts when empty |
| Version source | Read from `/api/capabilities` (already has version) |
| Run launch confirmation | Require confirm dialog before starting a plan run |
| DAG rendering | CSS-based text tree (no external lib) |

---

## Execution Slices

### Slice 11.1 — Bug Fixes (B1-B5) [sequential]
**Validation**: Self-tests pass, manual verification of each fix

**Tasks**:
1. **B1**: Fix notification monkey-patch — replace incomplete `window._origHandleEvent` approach with proper event hook in WebSocket `onmessage` handler
2. **B2**: Fix cost export menu positioning — add `relative` class to parent container
3. **B3**: Fix keyboard j/k edge case — guard `selectedRunIdx` against empty rows
4. **B4**: Fix MCP server version — update `server.mjs` Server version from `"2.6.0"` to match VERSION file
5. **B5**: Fix memory search placeholder — replace stub response with categorized preset system

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/server.mjs`

**Stop Condition**: If any fix introduces a regression in self-tests → STOP.

---

### Slice 11.2 — Quick Wins: Hub Badge, Runs Refresh, Version Footer [sequential]
**Validation**: Dashboard loads, shows client count, version footer visible, runs refresh on event

**Tasks**:
1. **#1 Hub Client Monitor**: Add client count badge next to connection badge in header — poll `GET /api/hub` every 10s when connected
2. **#3 Runs Auto-Refresh**: In `handleEvent`, call `loadRuns()` on `run-completed` and `run-started` events
3. **#6 Version Footer**: Fetch version from `GET /api/capabilities` on init, display in footer

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`

**Stop Condition**: If hub polling causes performance issues → reduce to 30s interval.

---

### Slice 11.3 — Memory Search Redesign [sequential]
**Validation**: Memory search panel shows presets, clicking preset populates input, results render

**Tasks**:
1. Add preset query categories with example searches:
   - "Architecture" → `architecture decisions`, `design patterns`, `layer structure`
   - "Bugs & Issues" → `known bugs`, `error handling`, `edge cases`
   - "Configuration" → `environment setup`, `config options`, `model routing`
   - "Testing" → `test strategy`, `coverage`, `test patterns`
   - "Performance" → `optimization`, `caching`, `bottlenecks`
2. Render preset chips below search input — clicking auto-populates and submits
3. Show "Try searching for..." placeholder suggestions when results are empty
4. Add new server endpoint `GET /api/memory/presets` that returns forge-specific preset queries based on project context (reads .forge.json for project name, preset, installed extensions)
5. Display results in formatted cards with relevance indicators instead of raw output

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/server.mjs`

**Stop Condition**: If OpenBrain is not configured, show clear "not configured" state with setup instructions.

---

### Slice 11.4 — Plan Scope Contract + Slice Task Detail [sequential]
**Validation**: Plan Browser shows expandable scope contract, Run Drawer shows per-slice tasks

**Tasks**:
1. **#4 Plan Scope Contract**: Extend `GET /api/plans` response to include `scopeContract` (inScope, outOfScope, forbidden arrays). Render as expandable accordion in Plan Browser cards.
2. **#5 Slice Task Detail**: In `openRunDrawer()`, show per-slice `tasks[]`, `buildCommand`, `testCommand`, and `validationGate` data when available from the plan parse or slice JSON.

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/server.mjs`

**Stop Condition**: If parsePlan doesn't return scope contract for a plan → show "No scope contract defined" gracefully.

---

### Slice 11.5 — Config Advanced Settings + Resume UI [sequential]
**Validation**: Config tab shows quorum/parallelism/retries, Resume button appears on failed runs

**Tasks**:
1. **#10 Config Advanced**: Add editable fields for `maxParallelism`, `maxRetries`, `maxRunHistory`, `quorum.enabled`, `quorum.threshold`, `quorum.models[]` to Config tab. Save via existing `POST /api/config`.
2. **#7 Resume-From-Slice**: In Run Detail Drawer, when a run has failed slices, show "Resume from Slice N" button. Clicking triggers `POST /api/tool/run-plan` with `resumeFrom` arg.

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`

**Stop Condition**: If config save fails validation → show error, don't save.

---

### Slice 11.6 — Run Launch Panel + Worker Detection [sequential]
**Validation**: Actions tab has "Launch Plan" button, shows available workers/models

**Tasks**:
1. **#13 Run Launch Panel**: Add a "Launch Plan" action card. Clicking opens a modal with: plan picker (from /api/plans), mode dropdown (auto/assisted), model selector, quorum toggle, estimate checkbox. Submit calls the tool API.
2. **#14 Worker Detection**: Add `GET /api/workers` endpoint to server.mjs that calls `detectWorkers()` and returns available CLI workers + API providers. Display in Run Launch modal and Config tab.

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/server.mjs`

**Stop Condition**: If no workers detected → show warning in launch panel, disable submit.

---

### Slice 11.7 — Duration Chart, Cost CSV, Event History, Trace Search [sequential]
**Validation**: Duration chart renders, cost CSV exports, event log scrollable, trace search works

**Tasks**:
1. **#18 Duration Chart**: Add "Duration Per Run" chart in Cost tab using existing run summary duration data.
2. **#11 Cost CSV Export**: Add CSV option to cost export menu.
3. **#15 Event History**: Add event log panel below Progress tab — scrollable list of all hub events with timestamps, auto-tailing during active runs.
4. **#12 Trace Span Search**: Add text search input in Traces tab that filters spans by name, attributes, or logSummary content.

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`

**Stop Condition**: If Chart.js rendering fails → check canvas element exists before creating chart.

---

### Slice 11.8 — DAG Visualizer, Tab Badges, Auto-Scroll, Notification Sound, Polish [sequential]
**Validation**: DAG tree renders in Plan Browser, tab badges update, auto-scroll works during runs

**Tasks**:
1. **#8 DAG Visualizer**: In Plan Browser, render slice dependency tree showing `depends` relationships and `[P]` parallel tags as indented text tree with connector lines.
2. **#20 Tab Badges**: Add small dot/count badges to tab buttons — Runs (new run count since last view), Cost (anomaly indicator), Skills (active execution count).
3. **#22 Auto-Scroll**: During active execution, auto-scroll Progress tab to keep the currently-executing slice card visible.
4. **#19 Notification Sound**: Add optional audio cue on `run-completed` and `slice-failed` (respect user preference in localStorage).
5. **#17 Slice Progress**: Show elapsed time on executing slice cards.
6. **#21 Diff Formatting**: Improve diff output rendering with proper +/- line coloring.

**Context Files**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`

**Stop Condition**: If audio playback blocked by browser → fail silently, no error shown.

---

## Definition of Done

- [ ] All 5 bugs fixed and verified
- [ ] All 22 enhancements implemented
- [ ] Memory search usable with presets and helpful empty states
- [ ] Self-tests: 69/69 passing
- [ ] VERSION bumped to 2.9.0
- [ ] CHANGELOG.md updated
- [ ] Committed and pushed to feature branch
- [ ] Ready for squash-merge to master

---

## Post-Mortem Template

| Question | Answer |
|----------|--------|
| Slices completed | /8 |
| Scope drift incidents | |
| What worked well | |
| What to improve | |
| New guardrails needed | |
