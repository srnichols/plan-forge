# Phase 9: Dashboard Enhancement — Low-Hanging Fruit GUI Tools

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 9
> **Status**: 📋 Planned
> **Feature Branch**: `feature/v2.7-dashboard-enhancement`
> **Pipeline**: Step 0 ✅ → Step 2 (hardening)
> **Version**: 2.6.0 → 2.7.0

---

## Specification (Step 0)

### Problem Statement
The Plan Forge dashboard exposes ~70% of system capabilities. Five CLI-only commands (branch, commit, diff, phase-status, new-phase) have no GUI. Rich data in `.forge/runs/` (model performance, slice details) is not visualized. Users cannot browse available plans, launch runs, or preview estimates from the dashboard.

### User Scenarios
1. **Plan Browser**: User opens dashboard → Plans tab → sees all plan files with slice counts and status → clicks "Estimate" → sees projected cost → clicks "Run" → watches live progress
2. **Git Operations**: After a slice passes, user clicks "Branch" or "Auto-Commit" in Actions tab → confirms in modal → git operation executes
3. **Diff Detection**: User clicks "Diff" in Actions tab → selects plan → sees color-coded file list (in-scope = green, out-of-scope = yellow, forbidden = red)
4. **Sweep Table**: User runs Sweep → results display as a sortable/filterable table instead of raw text
5. **Model Comparison**: User opens Cost tab → scrolls to Model Comparison → sees per-model pass rate, avg duration, avg cost
6. **Phase Status Editor**: User views Status results → clicks a phase dropdown → changes status from "planned" to "in-progress" → roadmap updates

### Acceptance Criteria
- **MUST**: Plan browser with list of `docs/plans/*.md` files, slice count, and status
- **MUST**: "Estimate" and "Run" buttons per plan (uses existing `forge_run_plan`)
- **MUST**: Branch, Commit, and Diff action buttons wired to existing CLI commands
- **MUST**: Sweep results rendered as structured table with type filters
- **MUST**: Model comparison table in Cost tab (pass rate, avg duration, avg cost per model)
- **SHOULD**: Phase status inline editor (dropdown → calls `pforge phase-status`)
- **SHOULD**: Estimate preview modal before run confirmation
- **MUST**: All new features work through existing `/api/tool/:name` proxy (no new server endpoints for CLI commands)
- **MUST**: New `/api/plans` endpoint returning parsed plan metadata
- **MUST**: Updated screenshots and dashboard.html documentation

---

## Scope Contract

### In Scope
- `pforge-mcp/dashboard/index.html` — new UI sections (Plans panel, action buttons, sweep table, model comparison, phase editor)
- `pforge-mcp/dashboard/app.js` — new functions for plan browser, sweep parsing, model stats, git modals
- `pforge-mcp/server.mjs` — new `/api/plans` endpoint (uses parsePlan from orchestrator)
- `docs/dashboard.html` — updated documentation with new feature descriptions
- `docs/assets/dashboard/*.png` — re-captured screenshots
- `CHANGELOG.md` — v2.7.0 entry
- `VERSION` — bump to 2.7.0

### Out of Scope
- Parallel execution (Phase 6)
- New MCP tools (all features use existing tools via `/api/tool/:name`)
- Memory browser/search UI (future phase)
- Extension install/uninstall from dashboard (future)
- Modifying orchestrator, capabilities, or skill-runner logic

### Forbidden Actions
- Do NOT modify `pforge-mcp/orchestrator.mjs` logic (only import parsePlan)
- Do NOT modify `pforge-mcp/capabilities.mjs`
- Do NOT modify `pforge-mcp/skill-runner.mjs`
- Do NOT modify preset files (`presets/`)
- Do NOT modify pipeline prompts (`*.prompt.md`, `*.agent.md`)
- Do NOT add npm dependencies

---

## Branch Strategy
**Branch**: `feature/v2.7-dashboard-enhancement`
**Merge**: Squash merge to `master` via PR

---

## Execution Slices

### Slice 1: Plans API Endpoint + Plan Browser Panel [scope: pforge-mcp/server.mjs, pforge-mcp/dashboard/**]

**Goal**: Add `/api/plans` endpoint and a plan browser UI in the Progress tab

**Server — `GET /api/plans`**:
- Import `parsePlan` from `orchestrator.mjs`
- Scan `docs/plans/Phase-*-PLAN.md` files in project directory
- For each plan: parse with `parsePlan()`, extract title, status, slice count, branch strategy
- Return JSON array: `[{ file, title, status, sliceCount, branch }]`
- Catch parse errors gracefully — skip malformed plans

**Dashboard — Plan Browser Panel**:
- Add collapsible "Available Plans" panel above slice cards in Progress tab
- List each plan as a row: title, status badge (📋/🚧/✅/⏸️), slice count
- Per-plan buttons: **Estimate** (calls `/api/tool/run-plan` with `--estimate`) and **Run** (calls `/api/tool/run-plan`)
- Estimate results display inline below the plan row (token count, projected cost)
- Run button shows confirmation dialog: "Run {planName} with {sliceCount} slices?"
- Loading spinner while estimate/run is in progress

**Validation Gates**:
- [ ] `GET /api/plans` returns valid JSON array
- [ ] Plan browser shows plans with correct metadata
- [ ] Estimate button returns projected cost without executing
- [ ] Run button triggers execution (visible in Progress tab)

---

### Slice 2: Git Operations — Branch + Commit + Diff Action Buttons [depends: Slice 1] [scope: pforge-mcp/dashboard/**]

**Goal**: Add Branch, Commit, and Diff action cards to the Actions tab

**Branch Button**:
- Action card with 🌿 icon: "Create Branch"
- On click: prompt for plan file path (could pre-fill from plan browser selection)
- Calls `/api/tool/branch` with plan path
- Shows branch name in result panel
- Success notification: "Branch {name} created"

**Commit Button**:
- Action card with 💾 icon: "Auto-Commit"
- On click: prompt for plan file and slice number
- Calls `/api/tool/commit` with `<plan> <slice-number>`
- Shows generated commit message in result panel
- Success notification: "Committed: {message}"

**Diff Button**:
- Action card with 📝 icon: "Diff"
- On click: prompt for plan file path
- Calls `/api/tool/diff` with plan path
- Parse output to identify in-scope, out-of-scope, forbidden files
- Render as color-coded list: green rows (in-scope), yellow rows (out-of-scope), red rows (forbidden)
- If no drift detected: show "✓ All changes within scope"

**Validation Gates**:
- [ ] All 3 buttons appear in Actions tab (total: 11 action cards)
- [ ] Branch button calls pforge CLI correctly
- [ ] Commit button calls pforge CLI with plan + slice args
- [ ] Diff output is parsed and color-coded

---

### Slice 3: Sweep Table Rendering [scope: pforge-mcp/dashboard/app.js]

**Goal**: Parse sweep output into a structured, filterable table

**Enhanced Sweep Display**:
- After `runAction('sweep')` returns, detect if output contains file:line patterns
- Parse each match: `{ file, line, type (TODO/FIXME/HACK/stub), text }`
- Render as HTML table: File | Line | Type | Text
- Type column uses colored badges: TODO (blue), FIXME (amber), HACK (red), stub (gray)
- Add filter buttons above table: All | TODO | FIXME | HACK
- Clicking a filter shows/hides matching rows
- If no markers found: show "✓ Clean — no TODO/FIXME markers"
- Falls back to raw pre-formatted text if parse fails

**Validation Gates**:
- [ ] Sweep output parsed into table rows
- [ ] Filter buttons toggle row visibility
- [ ] Raw text fallback works for unexpected formats

---

### Slice 4: Model Comparison Table in Cost Tab [scope: pforge-mcp/dashboard/**]

**Goal**: Show per-model performance comparison below existing cost charts

**Model Comparison Section**:
- Add `<div id="model-comparison">` after the monthly spend chart
- Header: "Model Performance Comparison"
- Table columns: Model | Runs | Pass Rate | Avg Duration | Avg Cost | Total Tokens
- Data source: existing `/api/cost` response (by_model breakdown) + `/api/runs` (for pass/fail per model)
- Calculate stats:
  - Pass Rate = (passed slices / total slices) × 100% per model
  - Avg Duration = total duration / runs per model
  - Avg Cost = total cost / runs per model
- Color-code pass rates: ≥90% green, 70-89% amber, <70% red
- Sort by total runs descending (most used model first)
- If no data: show "No run data available yet"

**Validation Gates**:
- [ ] Table populates from cost/run data
- [ ] Pass rate calculation is correct
- [ ] Color coding applies to pass rate column
- [ ] Empty state handled gracefully

---

### Slice 5: Phase Status Editor [depends: Slice 1] [scope: pforge-mcp/dashboard/**]

**Goal**: Make phase status editable from the Status action results

**Inline Status Editor**:
- After `runAction('status')` returns, parse the phase list output
- For each phase row, replace static status text with a `<select>` dropdown
- Options: planned | in-progress | complete | paused
- Pre-select current status
- On change: call `/api/tool/phase-status` with `<plan-file> <new-status>`
- Show success/error notification
- Re-load status display after update

**Validation Gates**:
- [ ] Status output parsed into editable rows
- [ ] Dropdown defaults to current status
- [ ] Status change calls CLI correctly
- [ ] Status display refreshes after update

---

### Slice 6: Documentation + Screenshots + Version Bump [depends: Slice 1, Slice 2, Slice 3, Slice 4, Slice 5] [scope: docs/**, VERSION, CHANGELOG.md]

**Goal**: Update dashboard.html documentation, re-capture all screenshots, bump version

**Dashboard Doc Updates** (`docs/dashboard.html`):
- Update Config tab description (it now has OpenBrain)
- Add Plan Browser description to Progress tab section
- Add Branch/Commit/Diff to Actions tab description
- Add Sweep table view to Actions tab description
- Add Model Comparison to Cost tab description
- Add Phase Status Editor to Actions tab description
- Update feature badge count in hero section
- Update alt text on all screenshots

**Screenshots**:
- Sync all dashboard files to testbed
- Start dashboard server in testbed
- Run `capture-screenshots.mjs` to re-capture all 9 tabs
- Verify new features visible in Progress (plan browser), Actions (new buttons), Cost (model table)

**Version + Changelog**:
- Bump `VERSION` to `2.7.0`
- Add CHANGELOG entry for v2.7.0 with all new features listed

**Validation Gates**:
- [ ] All 9 screenshots captured successfully
- [ ] dashboard.html has descriptions for all new features
- [ ] VERSION reads `2.7.0`
- [ ] CHANGELOG has v2.7.0 section

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| parsePlan import issues in server.mjs | Low | Medium | Already imported for other features; test at endpoint level |
| Sweep output format changes | Low | Low | Fallback to raw text display |
| Plan browser performance with many plans | Low | Low | Limit to Phase-*-PLAN.md glob pattern |
| Git operations require clean working tree | Medium | Low | Show error message if git state is dirty |

---

## Definition of Done
- [ ] All 6 slices pass their validation gates
- [ ] Plan browser lists plans and allows estimate/run
- [ ] Branch, Commit, Diff buttons work in Actions tab
- [ ] Sweep renders as filtered table
- [ ] Model comparison table shows in Cost tab
- [ ] Phase status is editable inline
- [ ] Screenshots updated, dashboard.html documentation complete
- [ ] Version bumped to 2.7.0, CHANGELOG updated
- [ ] Feature branch squash-merged to master
