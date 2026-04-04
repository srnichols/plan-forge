# Phase 4: Dashboard Core — Real-Time Monitoring UI

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 4
> **Status**: ✅ Complete
> **Feature Branch**: `feature/v2.0-dashboard-core`
> **Depends On**: Phase 3 (WebSocket Hub) ✅
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Step 3 ✅ (executed)
> **Review Findings Applied**: C5 (Express), C6 (REST API), M5 (project discovery)

---

## Specification (Step 0)

### Problem Statement
The orchestrator runs in a terminal. You can't see progress without watching stdout. Teams need a visual interface — especially for demos, multi-project tracking, and mobile monitoring. This phase builds the core dashboard served from the existing MCP server.

### Acceptance Criteria
- **MUST**: Static HTML+JS+CSS app at `localhost:3100/dashboard`
- **MUST**: Served from same Node.js process as MCP server (Express static)
- **MUST**: Real-time slice progress via WebSocket (from Phase 3 hub)
- **MUST**: Works on phone/tablet via Tailscale or local network
- **SHOULD**: Multi-project overview from `.forge.json` discovery
- **SHOULD**: Phase timeline (Gantt-style) from `DEPLOYMENT-ROADMAP.md`
- **SHOULD**: Quick actions panel (calls MCP tools via REST/WS)
- **SHOULD**: Cost tracker visualization
- **SHOULD**: Run history + trend charts
- **SHOULD**: OpenBrain memory explorer

---

## Scope Contract

### In Scope
- `mcp/dashboard/` — static web app (HTML, JS, CSS)
- `mcp/dashboard/index.html` — single-page app shell
- `mcp/dashboard/app.js` — WebSocket client + UI logic
- `mcp/dashboard/style.css` — minimal Tailwind or custom styling
- `mcp/server.mjs` — add Express static route for `/dashboard`
- `mcp/package.json` — add `express` dependency

### Out of Scope
- Advanced dashboard features (Phase 5)
- Team activity feed (Phase 6)
- Authentication / multi-user (future)
- Server-side rendering (static only)

### Forbidden Actions
- Do NOT use React, Vue, or heavy frameworks (vanilla JS + Tailwind CDN)
- Do NOT require a build step (no webpack, no bundler)
- Do NOT store sensitive data in the dashboard (no tokens, no secrets)

---

## Execution Slices

### Slice 1: Dashboard Shell + Express Route (45 min — Codex/Auto)
**Goal**: Serve static `mcp/dashboard/` at `localhost:3100/dashboard`

- Add Express to MCP server: `app.use('/dashboard', express.static('mcp/dashboard'))`
- Create `index.html` — app shell with navigation, header, content area
- Use Tailwind CDN for styling (matches Plan Forge site aesthetic)
- Responsive: works on desktop + mobile

**Validation Gates**:
- [ ] `http://localhost:3100/dashboard` serves the page
- [ ] Page loads on mobile browser

### Slice 2: Real-Time Slice Progress (60 min — Claude)
**Goal**: Live slice cards that update via WebSocket

- Connect to WS hub from Phase 3
- Render slice cards: pending → executing (spinner) → pass ✅ / fail ❌
- Show per-slice: number, goal, model, duration, status
- Auto-scroll to current slice
- Run summary bar: "Slice 4 of 8 executing — 62% complete"

**Validation Gates**:
- [ ] Slice cards update in real-time during a run
- [ ] Completed slices show duration and status

### Slice 3: Multi-Project Overview (45 min — Codex/Auto)
**Goal**: Card view of all Plan Forge projects

- Scan configurable project directories for `.forge.json` files
- Display per project: name, preset, current phase, last score, status
- Click project → navigate to that project's run view
- Config: `PLAN_FORGE_PROJECTS` env var or `~/.planforge/projects.json`

**Validation Gates**:
- [ ] Multiple projects displayed as cards
- [ ] Click-through navigation works

### Slice 4: Phase Timeline (60 min — Claude)
**Goal**: Gantt-style timeline from DEPLOYMENT-ROADMAP.md

- Parse roadmap Markdown for phase entries (name, status, dates)
- Render horizontal timeline: completed (solid), in-progress (striped), planned (outline)
- Click phase → show plan details
- Responsive: collapses to vertical on mobile

**Validation Gates**:
- [ ] Timeline renders from roadmap data
- [ ] Status colors match (green/yellow/gray)

### Slice 5: Quick Actions Panel (45 min — Codex/Auto)
**Goal**: One-click buttons for common forge operations

- Buttons: Smith, Analyze, Sweep, New Phase, Ext Search
- Each calls the MCP tool via WebSocket message to server
- Show result in a modal or inline panel
- "Run Plan" button with plan file selector

**Validation Gates**:
- [ ] Smith button returns diagnostics in UI
- [ ] Sweep button shows marker count

### Slice 6: Cost Tracker View (45 min — Codex/Auto)
**Goal**: Visualize cost data from `.forge/cost-history.json`

- Bar chart: cost per run (last 10 runs)
- Breakdown: tokens by model (pie/donut chart)
- Monthly total with trend arrow
- Use Chart.js CDN (lightweight, no build step)

**Validation Gates**:
- [ ] Charts render from cost history data
- [ ] Empty state handles gracefully (no runs yet)

### Slice 7: Run History + Trends (45 min — Codex/Auto)
**Goal**: Table of past runs with trend sparklines

- List: date, plan name, slices, score, cost, duration
- Sort by date (newest first)
- Sparkline chart: score trend across runs
- Click run → show detailed slice breakdown

**Validation Gates**:
- [ ] Run history populates from `.forge/runs/`
- [ ] Score trend visible

### Slice 8: OpenBrain Memory Explorer (60 min — Claude)
**Goal**: Browse and search captured decisions

- Search input: query OpenBrain via MCP tool (`search_thoughts`)
- Display results: thought text, project, phase, type, date
- "Most referenced" sidebar showing frequently retrieved decisions
- Only visible when OpenBrain MCP is configured (graceful hide)

**Validation Gates**:
- [ ] Search returns results from OpenBrain
- [ ] Graceful degradation when OpenBrain not configured

### Slice 9: Documentation (30 min — Codex/Auto)
**Goal**: Document the dashboard

- CLI-GUIDE: "Dashboard" section with URL and features
- README: mention dashboard in MCP section
- CHANGELOG: v2.1 dashboard entry
- index.html: update feature card

**Validation Gates**:
- [ ] All docs reference dashboard
- [ ] URL documented

---

## Definition of Done
- [ ] Dashboard serves at `localhost:3100/dashboard`
- [ ] Real-time slice progress works during orchestrator runs
- [ ] Multi-project overview, timeline, actions, cost, history, memory explorer all functional
- [ ] Works on mobile browser
- [ ] No build step required (vanilla JS + CDN)
- [ ] Documentation complete

## Stop Conditions
- If Express conflicts with MCP stdio transport → serve on separate port (3101)
- If Chart.js CDN is too heavy → use inline SVG sparklines instead
