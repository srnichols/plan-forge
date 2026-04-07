# Phase 20: v2.13.1 — Doc Refresh + Dashboard Capabilities

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 3 hours (4 execution slices)  
> **Risk Level**: Low (docs + dashboard UI only)  
> **Branch**: `fix/v2.13.1-docs-dashboard`  
> **Quorum**: Auto

---

## Overview

Fix stale version references, add missing feature mentions to all public docs, and add dashboard panels for bridge status, approval gates, escalation indicators, and model performance visualization.

## Acceptance Criteria

- **MUST**: All public docs reference v2.13 (not v2.11 or v2.12)
- **MUST**: README, capabilities.md/html, index.html mention auto-escalation, model-performance, auto-update, dual-publish, escalationChain
- **MUST**: Dashboard shows bridge status panel (connected channels, notification stats)
- **MUST**: Dashboard shows approval gate UI (approve/reject pending approvals)
- **MUST**: Dashboard shows escalation indicator on slice cards when model was promoted
- **MUST**: Dashboard shows model performance chart (success rate per model)
- **SHOULD**: Dashboard links to Web UI (/ui) plan browser
- **SHOULD**: Dashboard shows agent-per-slice routing recommendation vs actual

---

## Scope Contract

### In Scope
- `pforge-mcp/dashboard/app.js` — new panels: bridge status, approval UI, escalation indicator, model perf chart
- `pforge-mcp/dashboard/index.html` — HTML structure for new panels
- `README.md` — version bump, feature mentions
- `docs/index.html` — version badge, feature highlights
- `docs/capabilities.md` — add v2.12-v2.13 features
- `docs/capabilities.html` — sync
- `docs/faq.html` — new entries for escalation, model routing, Web UI
- `CHANGELOG.md` — v2.13.1 entry
- `VERSION` — 2.13.1

### Out of Scope
- MCP server code changes
- Orchestrator changes
- New presets or skills

### Forbidden Actions
- Do NOT modify pforge-mcp/orchestrator.mjs
- Do NOT modify pforge-mcp/server.mjs
- Do NOT modify pforge-mcp/bridge.mjs
- Do NOT modify setup scripts

---

## Execution Slices

### Slice 1: Dashboard — Bridge Status + Approval Gate UI [sequential]

**Goal**: Add bridge status panel and approval gate UI to the dashboard.

**Tasks**:
1. In `dashboard/index.html`, add a "Bridge" section in the Config tab:
   - Connected channels list (fetched from `GET /api/bridge/status`)
   - Notification level per channel
   - Pending approvals count
2. In `dashboard/app.js`:
   - Fetch `/api/bridge/status` every 10s when Config tab is active
   - Render channel cards with type icon (Telegram/Slack/Discord/Generic)
   - Render pending approval cards with Approve/Reject buttons
   - Approve button calls `POST /api/bridge/approve/:runId` with `{ action: "approve" }`
   - Show notification count badge on Config tab when approvals pending
3. Add escalation indicator to slice cards in Progress/Runs tabs:
   - If slice result has `escalated: true` or model differs from original, show "⬆️ Escalated" badge
4. Link to Web UI: add "Plan Browser →" link in the Plans tab header pointing to `/ui`

**Build Command**: `echo PASS`
**Test Command**: `echo PASS`

**Depends On**: None

---

### Slice 2: Dashboard — Model Performance Visualization [sequential]

**Goal**: Add model performance chart to the Cost tab.

**Tasks**:
1. In `dashboard/app.js`, add a "Model Performance" section in the Cost tab:
   - Fetch `/api/cost` which includes model stats
   - Bar chart showing success rate per model (green >80%, amber 60-80%, red <60%)
   - Table: Model | Slices Run | Success Rate | Avg Duration | Avg Cost
   - Recommendation line: "Best value: {model} (95% success, $0.01/slice)"
2. In `dashboard/index.html`, add container elements for the chart and table
3. Show routing indicator on run detail: "Recommended: claude-sonnet → Used: claude-opus (escalated)"

**Build Command**: `echo PASS`
**Test Command**: `echo PASS`

**Depends On**: Slice 1

---

### Slice 3: Doc Refresh — All Public Files [sequential]

**Goal**: Fix all stale version references and add missing feature mentions.

**Tasks**:
1. `README.md`: Fix `v2.11` → `v2.13`, add auto-escalation, model-performance, auto-update, dual-publish, escalationChain to feature list
2. `docs/index.html`: Verify version badge says v2.13, add features to highlights
3. `docs/capabilities.md`: Add auto-escalation, agent-per-slice routing, CI/CD hook, model performance, auto-update, Web UI, dual-publish sections
4. `docs/capabilities.html`: Sync with capabilities.md
5. `docs/faq.html`: Add entries for: "What is auto-escalation?", "How does model routing work?", "What is the Web UI?"

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Select-String 'v2.13' README.md).Count -gt 0 -and (Select-String 'auto-escalation' docs/capabilities.md).Count -gt 0) { 'PASS' } else { 'FAIL' }"`

**Depends On**: None (parallel-safe with Slices 1-2)

---

### Slice 4: Version Bump + Changelog [sequential]

**Goal**: Bump to v2.13.1 and update changelog.

**Tasks**:
1. `VERSION` → 2.13.1
2. `pforge-mcp/package.json` → 2.13.1
3. `CHANGELOG.md` — v2.13.1 entry documenting dashboard additions + doc refresh
4. `docs/index.html` — update version badge to v2.13.1

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Get-Content VERSION -Raw).Trim() -eq '2.13.1') { 'PASS' } else { 'FAIL' }"`

**Depends On**: Slices 1-3
