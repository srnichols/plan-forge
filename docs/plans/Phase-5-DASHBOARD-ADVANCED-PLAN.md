# Phase 5: Dashboard Advanced — Diff Viewer, Replay, Marketplace, Notifications, Config

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 5
> **Status**: 📋 Planned
> **Feature Branch**: `feature/v2.0-autonomous-execution`
> **Depends On**: Phase 4 (Dashboard Core)
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Execution pending

---

## Specification (Step 0)

### Problem Statement
The core dashboard (Phase 4) covers monitoring and project overview. This phase adds power-user features: plan-vs-code traceability, session replay for debugging, visual extension browsing, persistent notifications, and visual config editing.

### Acceptance Criteria
- **MUST**: Diff viewer showing requirement → code → test traceability
- **MUST**: Session replay for debugging failed slices
- **MUST**: Extension marketplace UI from catalog.json
- **MUST**: Notification center persisting across page reloads
- **SHOULD**: Config editor for `.forge.json` (visual, no file editing)
- **MAY**: Keyboard shortcuts for quick actions

---

## Scope Contract

### In Scope
- `mcp/dashboard/` — add 5 new views/panels
- `mcp/server.mjs` — add REST endpoints for session logs and config read/write
- `.forge/runs/*/slice-N-log.txt` — agent session logs (captured during execution)
- LocalStorage for notification persistence

### Out of Scope
- Team activity feed (Phase 6)
- Authentication
- External notification channels (that's OpenClaw v2.3)

### Forbidden Actions
- Do NOT add a build step (keep vanilla JS)
- Do NOT write secrets to localStorage
- Do NOT modify `.forge.json` without user confirmation in the UI

---

## Execution Slices

### Slice 1: Diff Viewer — Plan vs Code Traceability (90 min — Claude)
**Goal**: Visual mapping from requirements → implementing files → tests

- Read `pforge analyze` output for traceability data
- Render: requirement text → linked source file → linked test file
- Color: green (traced), yellow (partial), red (missing)
- Click requirement → open file in VS Code (via `vscode://file/` URI)

**Validation Gates**:
- [ ] Requirements display with traceability links
- [ ] Color coding matches trace status

### Slice 2: Session Replay (60 min — Claude)
**Goal**: Replay what the agent did during a slice execution

- Orchestrator captures agent stdout/stderr to `.forge/runs/*/slice-N-log.txt`
- Dashboard reads log, renders as timestamped event stream
- Show: files read, files created, commands run, decisions made
- Filterable: show only errors, only file changes, or full log

**Validation Gates**:
- [ ] Replay renders from log file
- [ ] Filters work

### Slice 3: Extension Marketplace UI (45 min — Codex/Auto)
**Goal**: Visual catalog browser with install buttons

- Fetch `extensions/catalog.json` (same as `pforge ext search`)
- Render as cards: name, description, author, category, tags
- Install button calls `forge_ext_info` then triggers install flow
- Show installed vs available state
- Search/filter by category and keyword

**Validation Gates**:
- [ ] Catalog loads and displays as cards
- [ ] Search filters work

### Slice 4: Notification Center (45 min — Codex/Auto)
**Goal**: Bell icon with persistent notifications

- Subscribe to WebSocket events: run-completed, slice-failed, sweep-warning
- Store in localStorage (persist across reloads)
- Bell icon with unread count badge
- Click → dropdown with notification list
- Mark read / clear all

**Validation Gates**:
- [ ] Notifications persist across page reload
- [ ] Unread count badge updates

### Slice 5: Config Editor (60 min — Claude)
**Goal**: Visual editor for `.forge.json`

- Read `.forge.json` via REST endpoint on MCP server
- Display: project name, preset, agents, model routing, extensions
- Toggle agents (checkboxes), change model routing (dropdowns)
- Save button writes back via REST endpoint
- Confirmation dialog before saving

**Validation Gates**:
- [ ] Config loads and displays correctly
- [ ] Changes save to `.forge.json`
- [ ] Confirmation dialog prevents accidental writes

### Slice 6: Documentation (30 min — Codex/Auto)
**Goal**: Update docs for advanced dashboard features

- CLI-GUIDE: document advanced features
- CHANGELOG: add Phase 5 features
- FAQ: "Can I debug a failed slice?" → session replay

**Validation Gates**:
- [ ] Docs updated
- [ ] FAQ entry added

---

## Definition of Done
- [ ] All 5 dashboard features functional
- [ ] All work on mobile
- [ ] No build step required
- [ ] Documentation complete
