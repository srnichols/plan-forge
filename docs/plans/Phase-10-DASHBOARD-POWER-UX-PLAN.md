# Phase 10: Dashboard Power UX — Interactive GUI & Deep Telemetry

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 10
> **Status**: ✅ Complete
> **Feature Branch**: `feature/v2.8-dashboard-power-ux`
> **Pipeline**: Step 0 ✅ → Step 2 ✅ → Step 3 ✅
> **Version**: 2.8.0
> **Quorum Mode**: Enabled (dogfooding)

---

## Specification (Step 0)

### Problem Statement

The Plan Forge dashboard surfaces only ~37% of available telemetry data. Run rows are not clickable, tables are not sortable, there is no filtering, no cost trending, no run comparison, no quorum visualization, and no drill-down into slice-level failures. Users must leave the dashboard and manually inspect `.forge/runs/` JSON files to understand WHY a run failed or HOW costs are trending. The dashboard is read-only where it should be interactive, and flat where it should provide depth.

### User Scenarios

1. **Run Detail Drill-Down**: User clicks a run row → slide-out drawer shows per-slice cards with status, duration, gate output, errors, tokens. Failed slices show `gateError` + `failedCommand` prominently.
2. **Runs Filtering**: User selects "failed" from status dropdown + "claude-opus" model filter → table instantly filters to matching runs.
3. **Cost Trend**: User opens Cost tab → sees per-run cost line chart with horizontal "average" line → spots a 3x cost spike on Tuesday.
4. **Run Comparison**: User selects two runs → side-by-side panel shows cost diff, duration diff, token diff, model differences.
5. **Quorum Visualization**: After a quorum run, user opens Traces tab → sees per-model leg bars, scores, consensus decision.
6. **Sortable Tables**: User clicks "Duration" column header in Runs table → rows re-sort by duration descending.
7. **Span Attributes**: User clicks a span bar in Traces → sees full attribute table (model, tokens, worker, cost, exit code).
8. **Plan Editor**: User toggles a slice off in the plan browser → runs plan with that slice skipped.
9. **Cost Anomaly Alert**: Dashboard shows banner: "Run #23 cost $0.45 — 5× above your $0.09 average"
10. **Export Report**: User clicks "Export" → gets a JSON/CSV of the current runs table or cost breakdown.
11. **Keyboard Navigation**: User presses `j`/`k` to navigate run rows, `Enter` to open detail, `Esc` to close.
12. **Notifications Persistence**: Notifications survive page refresh via localStorage.
13. **Skill Catalog**: Skills tab shows available slash commands, not just live executions.
14. **Dark/Light Theme**: User toggles theme via header button.
15. **Responsive Layout**: Dashboard usable on tablet/mobile screens.
16. **Trace Span Attributes**: Clicking a span shows full attributes + events in the detail panels.

### Acceptance Criteria

- **MUST**: Run detail drawer with per-slice breakdown (status, gate output, errors, tokens)
- **MUST**: Runs filter bar (plan, status, model, mode, date range)
- **MUST**: Cost trend line chart (per-run cost over time with average line)
- **MUST**: Sortable columns on Runs and Cost model comparison tables
- **MUST**: Run comparison panel (select 2 runs, see side-by-side diff)
- **MUST**: Quorum leg visualization in Traces tab
- **MUST**: Span attribute + event detail in Traces tab
- **MUST**: Cost anomaly banner when run cost > 3× rolling average
- **SHOULD**: Plan slice toggle (enable/disable individual slices before run)
- **SHOULD**: Export runs/cost as JSON or CSV
- **SHOULD**: Keyboard navigation (j/k/Enter/Esc/1-9)
- **SHOULD**: Notification persistence via localStorage
- **SHOULD**: Skill catalog browser (list available slash commands)
- **NICE**: Dark/Light theme toggle
- **NICE**: Responsive/mobile layout
- **MUST**: Updated `docs/dashboard.html` + re-captured screenshots
- **MUST**: `CHANGELOG.md` + version bump to 2.8.0

---

## Scope Contract

### In Scope

- `pforge-mcp/dashboard/index.html` — new sections: run detail drawer, filter bar, comparison panel, quorum vis, plan slice toggles, theme toggle, responsive breakpoints
- `pforge-mcp/dashboard/app.js` — new functions: run detail rendering, filtering/sorting, cost trend chart, comparison logic, quorum rendering, span attribute rendering, export, keyboard nav, theme, notifications persistence, skill catalog
- `pforge-mcp/server.mjs` — new endpoints: `GET /api/runs/:runIdx` (single run detail with slice data), `GET /api/runs/:runIdx/slices` (per-slice JSON), `GET /api/skills` (available slash commands)
- `docs/dashboard.html` — updated sections for all new features
- `docs/assets/dashboard/*.png` — re-captured screenshots
- `CHANGELOG.md` — v2.8.0 entry
- `VERSION` — bump to 2.8.0

### Out of Scope

- New MCP tools (all features use existing data + minimal new API endpoints)
- WebSocket protocol changes (no new event types)
- Server-side persistence for notifications (client-only localStorage)
- Full plan editor (create/rewrite plans) — only slice toggling

### Forbidden Actions

- Do NOT modify preset files (`presets/`)
- Do NOT modify pipeline prompts (`*.prompt.md`, `*.agent.md`)
- Do NOT add npm dependencies (use Chart.js already loaded via CDN)
- Do NOT modify orchestrator cost calculation logic
- Do NOT alter the WebSocket hub protocol or event shapes

---

## Branch Strategy

**Branch**: `feature/v2.8-dashboard-power-ux`
**Merge**: Squash merge to `master` via PR

---

## Execution Slices

### Slice 1: Run Detail API + Drawer UI [scope: pforge-mcp/server.mjs, pforge-mcp/dashboard/**]

**Goal**: Click a run row → slide-out drawer shows per-slice detail cards

**Server — `GET /api/runs/:runIdx`**:
- Read the run directory at index `runIdx` (from sorted runs list)
- Load `summary.json` + all `slice-*.json` files in that directory
- Return `{ summary, slices: [{ number, title, status, duration, exitCode, gateStatus, gateOutput, gateError, failedCommand, tokens, worker, model, attempts }] }`
- 404 if index out of range

**Server — `GET /api/runs/:runIdx/slices`**:
- Same as above but returns only the slices array (for lazy loading)

**Dashboard — Run Detail Drawer**:
- Add a `<div id="run-detail-drawer">` fixed to the right side, 480px wide, off-screen by default
- On run row click: fetch `/api/runs/:runIdx`, populate drawer, slide in from right
- Drawer header: plan name, date, status badge, mode badge, model, total cost, total duration
- Slice cards in scrollable list:
  - Status icon (✅/❌) + slice title + duration right-aligned
  - Worker badge (gh-copilot/claude/codex/api-xai)
  - Token count: `${tokens_in} in / ${tokens_out} out`
  - Cost: `$X.XX`
  - If failed: red box with `gateError` text, `failedCommand` monospace, gate output expandable
  - If passed: green border, gate output collapsible
- Close button (×) + click-outside closes drawer
- ESC key closes drawer

**Validation Gates**:
- [ ] `GET /api/runs/0` returns summary + slices
- [ ] Clicking run row opens drawer with correct data
- [ ] Failed slice shows gateError and failedCommand
- [ ] Drawer closes on × click, outside click, and Esc
- [ ] 404 returned for invalid index

---

### Slice 2: Runs Filter Bar + Sortable Columns [scope: pforge-mcp/dashboard/**]

**Goal**: Add filter controls above the runs table + click-to-sort column headers

**Filter Bar** (above runs table):
- Flex row of filter controls:
  - Plan: `<select>` populated from unique plan names in current data
  - Status: `<select>` options: All | Pass | Fail
  - Model: `<select>` populated from unique model names
  - Mode: `<select>` options: All | auto | assisted | estimate
  - Date: `<input type="date">` for start + end range
  - Clear Filters button
- Filtering is client-side (data already loaded from `/api/runs`)
- Filters compose (AND logic): plan + status + model + mode + date range
- Show result count: "Showing X of Y runs"

**Sortable Columns**:
- All 8 column headers (Date, Plan, Mode, Model, Slices, Status, Cost, Duration) get sort indicators
- Click header → sort ascending; click again → descending; third click → clear sort
- Sort indicator: ▲/▼ arrow appended to header text
- Date sorts chronologically, Cost sorts numerically, Slices sorts by passed/total ratio
- Default sort: Date descending (newest first)

**Validation Gates**:
- [ ] Filter dropdowns populate from run data
- [ ] Selecting filters reduces visible rows
- [ ] Multiple filters compose correctly
- [ ] "Clear Filters" resets all
- [ ] Column headers sort on click with direction indicator
- [ ] "Showing X of Y" count updates

---

### Slice 3: Cost Trend Line + Anomaly Banner [scope: pforge-mcp/dashboard/**]

**Goal**: Add per-run cost trend chart and anomaly detection banner to Cost tab

**Cost Trend Line Chart**:
- Add new Chart.js line chart below the existing Monthly Spend bar chart
- Title: "Cost Per Run"
- X-axis: run date/index (last 50 runs)
- Y-axis: cost in USD
- Line: blue connecting per-run `total_cost_usd`
- Horizontal dashed line: rolling average (mean of all runs)
- Points colored: green if ≤ 2× average, amber if 2-3× average, red if > 3× average
- Tooltip on hover: plan name, cost, delta from average

**Cost Anomaly Banner**:
- If any run in the latest 5 exceeds 3× the rolling average cost:
  - Show a yellow/amber banner at the top of the Cost tab
  - Text: "⚠ Cost Spike: Run '{plan}' on {date} cost ${X} — {N}× above your ${avg} average"
  - Dismissable (click ×)
- If no anomalies: no banner shown

**Validation Gates**:
- [ ] Line chart renders with correct per-run costs
- [ ] Average line is displayed as dashed horizontal
- [ ] Point colors reflect anomaly thresholds
- [ ] Anomaly banner appears when spike detected
- [ ] Banner is dismissable

---

### Slice 4: Run Comparison Panel [scope: pforge-mcp/dashboard/**]

**Goal**: Select 2 runs and see side-by-side comparison

**Comparison Mode**:
- Add "Compare" button in the runs filter bar area
- Clicking "Compare" enters comparison mode:
  - Row selection changes: click selects/deselects rows (checkbox style)
  - Selected rows get highlighted border
  - When exactly 2 rows selected: "Compare Selected" button appears
- On "Compare Selected": show comparison panel (overlay or below table)

**Comparison Panel**:
- Side-by-side cards (Run A vs Run B):
  - Plan name, date, mode, model
  - Slices: passed/total for each
  - Status with icon
  - Cost with delta: `$0.12 ← $0.03 less → $0.15`
  - Duration with delta: `714s ← 201s faster → 1915s`
  - Total tokens with delta
- Delta values color-coded: green = better (less cost, faster), red = worse
- Close comparison button

**Validation Gates**:
- [ ] Compare button toggles comparison mode
- [ ] Exactly 2 rows can be selected
- [ ] Comparison panel shows correct deltas
- [ ] Deltas color-coded correctly
- [ ] Comparison panel closable

---

### Slice 5: Quorum Visualization + Span Attributes [scope: pforge-mcp/dashboard/**]

**Goal**: Render quorum leg data in Traces tab + populate span attribute/event panels

**Quorum Visualization** (in Traces tab):
- When a trace has quorum-related spans (name contains "quorum"):
  - Show "Quorum Analysis" section below the waterfall
  - Per-model cards: model name, duration bar, success/fail badge, token count
  - Overall: score, threshold, consensus result
  - Data from `slice-N-quorum.json` loaded via new server support

**Span Attribute Detail**:
- When user clicks a span bar in the waterfall:
  - Left panel (Span Events): render actual events from `span.events[]`, not just placeholder
    - Each event: timestamp, name, attributes as key-value table
    - Color-code: error events in red, info in blue
  - Right panel (Span Attributes): render `span.attributes` as key-value table
    - Known attributes get formatted labels: `model` → "Model", `tokens_in` → "Input Tokens"
    - Unknown attributes shown as raw key: value
  - If span has `logSummary[]`: show collapsible log section

**Server — quorum data endpoint**:
- Extend `GET /api/traces/:runId` to also include quorum JSON if present
- Look for `slice-*-quorum.json` in the run directory
- Return as `{ trace, quorum: { sliceId: quorumData } }` (optional field)

**Validation Gates**:
- [ ] Clicking span bar shows events and attributes
- [ ] Quorum section renders when quorum data exists
- [ ] Per-model cards show correct durations
- [ ] No quorum section when data absent

---

### Slice 6: Plan Slice Toggle + Skill Catalog [scope: pforge-mcp/dashboard/**, pforge-mcp/server.mjs]

**Goal**: Enable/disable plan slices before running + show available slash commands in Skills tab

**Plan Slice Toggle** (Progress tab — plan browser):
- When user clicks "Estimate" or "Run" on a plan, show expanded panel with slice list
- Each slice has: checkbox (enabled by default), slice number, title
- Unchecked slices are excluded via `--skip-slices 2,5` arg to `run-plan`
- "Run Selected" button shows only enabled slice count
- Collapsed by default, expand on click

**Skill Catalog** (Skills tab):
- Add "Available Skills" section above the real-time execution timeline
- Fetch from `GET /api/skills` (new endpoint)
- Show grid of skill cards: name, description, step count

**Server — `GET /api/skills`**:
- Scan `.github/skills/*/SKILL.md` files in the project directory
- Parse title from first `#` heading, description from first paragraph
- Return `[{ name, description, file }]`
- Fallback: return hardcoded list of built-in forge skills (`/code-review`, `/test-sweep`, `/staging-deploy`, etc.) from the forge's own prompt files

**Validation Gates**:
- [ ] Plan slices shown with toggleable checkboxes
- [ ] Skipped slices passed correctly to run-plan
- [ ] Skills tab shows available skills
- [ ] Skills endpoint returns valid JSON

---

### Slice 7: Export + Keyboard Nav + Notification Persistence [scope: pforge-mcp/dashboard/**]

**Goal**: Add export functionality, keyboard shortcuts, and persistent notifications

**Export** (Runs tab + Cost tab):
- "Export" dropdown button in runs filter bar: JSON | CSV
- JSON: downloads current filtered runs as `plan-forge-runs.json`
- CSV: downloads runs as `plan-forge-runs.csv` (Date, Plan, Mode, Model, Slices Passed, Slices Total, Status, Cost, Duration)
- Cost tab: "Export" button downloads cost summary as `plan-forge-cost-report.json`
- Uses `Blob` + `URL.createObjectURL` + `<a download>` pattern (no server round-trip)

**Keyboard Navigation**:
- `1`-`9`: switch tabs (1=Progress, 2=Runs, etc.)
- On Runs tab:
  - `j`/`k`: move selection highlight down/up through rows
  - `Enter`: open detail drawer for selected row
  - `Esc`: close drawer or exit comparison mode
- Only active when no input/select has focus
- Show keyboard shortcut hint in footer: "Press ? for shortcuts"
- `?` key shows a shortcuts modal

**Notification Persistence**:
- On notification add: save to `localStorage.setItem('pf-notifications', JSON.stringify(notifications))`
- On page load: read from localStorage, render existing notifications
- On clear: remove from localStorage
- Max 50 notifications stored (FIFO)

**Validation Gates**:
- [ ] JSON export downloads valid file with correct data
- [ ] CSV export has correct headers and data
- [ ] Tab switching via number keys works
- [ ] j/k navigates rows with visible highlight
- [ ] Enter opens drawer, Esc closes
- [ ] Notifications survive page refresh
- [ ] ? key shows shortcuts modal

---

### Slice 8: Theme Toggle + Responsive Layout [scope: pforge-mcp/dashboard/**]

**Goal**: Add dark/light theme toggle and responsive breakpoints

**Theme Toggle**:
- Add moon/sun icon button in the header bar (next to connection status)
- Click toggles between dark (current default) and light theme
- Persist preference in `localStorage.setItem('pf-theme', 'light'|'dark')`
- Light theme: white/gray backgrounds, dark text, adjusted chart colors
- Implementation: toggle `class="dark"` on `<html>` element + Tailwind dark: prefix system
- All existing Tailwind classes already use `bg-gray-*` / `text-gray-*` which map well
- Charts: update Chart.js defaults for light mode (darker grid lines, lighter backgrounds)

**Responsive Layout**:
- Below 1024px (tablet):
  - Tab bar wraps to 2 rows or becomes horizontal scroll
  - Runs table columns: hide Mode + Model (show in drawer on row click)
  - Cost charts stack vertically instead of side-by-side
  - Run detail drawer goes full-width instead of 480px
  - Action cards: 2 columns instead of 3
- Below 768px (mobile):
  - Tab bar becomes bottom nav or hamburger
  - Runs table: card layout instead of table (each run = stacked card)
  - Single column for everything
  - Header: collapse WS port info
- Use Tailwind responsive prefixes: `md:`, `lg:`, `xl:`

**Validation Gates**:
- [ ] Theme toggle switches visual appearance
- [ ] Theme preference persists across refresh
- [ ] Charts readable in both themes
- [ ] Layout usable at 1024px width
- [ ] Layout usable at 768px width
- [ ] No horizontal scroll at any breakpoint

---

### Slice 9: Docs + Screenshots + Version Bump [depends: Slice 1-8] [scope: docs/**, VERSION, CHANGELOG.md]

**Goal**: Update all documentation, re-capture screenshots, bump version to 2.8.0

**Dashboard Doc Updates** (`docs/dashboard.html`):
- Progress tab: add plan slice toggle description
- Runs tab: add filter bar, sortable columns, run detail drawer, comparison mode, export
- Cost tab: add trend line chart, anomaly banner, export
- Actions tab: (no changes from v2.7)
- Replay tab: (no changes)
- Extensions tab: (no changes from v2.7)
- Config tab: (no changes from v2.7)
- Traces tab: add quorum visualization, span attribute detail
- Skills tab: add skill catalog browser
- Add "Keyboard Shortcuts" section
- Add "Theme" section
- Update feature count badges
- Update hero description

**Other Docs**:
- `docs/COPILOT-VSCODE-GUIDE.md` — mention dashboard power UX features
- `README.md` — update dashboard feature list

**Screenshots**:
- Sync all dashboard files to testbed
- Start dashboard server in testbed
- Run `capture-screenshots.mjs` to re-capture all 9 tabs
- Verify new features visible: filter bar, trend chart, drawer open state, theme demo

**Version + Changelog**:
- Bump `VERSION` to `2.8.0`
- Add CHANGELOG entry for v2.8.0 listing all 16 features

**Validation Gates**:
- [ ] All 9 screenshots captured successfully
- [ ] dashboard.html updated with all new feature descriptions
- [ ] README.md feature list updated
- [ ] VERSION reads `2.8.0`
- [ ] CHANGELOG has v2.8.0 section with all features listed

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Chart.js CDN version mismatch | Low | Medium | Pin version in HTML script tag |
| Responsive breakpoints break existing layout | Medium | Medium | Test at each breakpoint before merging |
| Run detail drawer performance with large slice counts | Low | Low | Lazy-load slices, cap at 20 visible |
| Theme toggle affects Chart.js colors | Medium | Low | Update chart config on theme change |
| Keyboard shortcuts conflict with browser shortcuts | Low | Medium | Only bind when no input focused; use unambiguous keys |
| localStorage quota for notifications | Very Low | Low | Cap at 50 entries, FIFO eviction |
| Quorum data may not exist in all runs | Expected | Low | Conditional render — hide section when absent |
| Export CSV with special characters | Low | Low | Escape commas and quotes in CSV output |
| Mobile layout for complex tables | Medium | Medium | Card layout fallback for narrow viewports |
