# Phase 16: OpenClaw Bridge — External Notifications & Approval Gates

> **Status**: ✅ COMPLETE — All 5 slices executed  
> **Estimated Effort**: 4 hours (5 execution slices)  
> **Risk Level**: Medium (new module with external webhook calls, approval state machine)  
> **Branch**: `feature/openclaw-bridge`  
> **Quorum**: Auto (all slices score ≥7 — webhook security + state machine complexity)

---

## Overview

Add the OpenClaw Bridge — a notification and approval system that connects Plan Forge's autonomous execution to external messaging platforms (Telegram, Slack, Discord, generic webhooks). The bridge subscribes to WebSocket hub events and pushes formatted notifications. For critical events (run-completed, all-slices-passed), it can pause execution and wait for external approval via a webhook callback.

This is v2.6 per the roadmap. It does NOT require an OpenClaw server — it uses direct webhook integration that works standalone. If OpenClaw is deployed later, this bridge becomes its Plan Forge integration point.

---

## Prerequisites

- [x] WebSocket hub (pforge-mcp/hub.mjs) broadcasting events
- [x] Event schema defined (EVENTS.md)
- [x] Orchestrator emits run-started, slice-completed, slice-failed, run-completed events
- [x] Dashboard consuming events at localhost:3100/dashboard

## Acceptance Criteria

- **MUST**: New `pforge-mcp/bridge.mjs` module subscribes to hub events and dispatches notifications
- **MUST**: Webhook notifications for: run-started, slice-completed, slice-failed, run-completed
- **MUST**: Support Telegram Bot API webhook format (chat_id + formatted text)
- **MUST**: Support Slack Incoming Webhook format (blocks + text)
- **MUST**: Support Discord Webhook format (embeds)
- **MUST**: Support generic webhook (POST JSON with event payload)
- **MUST**: Configuration via `.forge.json` bridge section (webhook URLs, enabled channels, notification level)
- **MUST**: Approval gate — pause execution on configurable events, POST approval request, resume on callback
- **SHOULD**: `GET /api/bridge/status` endpoint showing connected channels and pending approvals
- **SHOULD**: Notification level filtering (all, important, critical-only)
- **SHOULD**: Rate limiting — max 1 notification per 5 seconds per channel (prevent spam during parallel slices)

---

## Scope Contract

### In Scope
- `pforge-mcp/bridge.mjs` — new module: event subscriber, webhook dispatcher, approval state machine
- `pforge-mcp/server.mjs` — import bridge, add `/api/bridge/*` REST endpoints, wire to hub
- `pforge-mcp/orchestrator.mjs` — add approval gate hook (pause/resume on bridge signal)
- `.forge.json` schema (documentation only — the bridge reads config, doesn't modify schema)
- `pforge-mcp/EVENTS.md` — add bridge events (approval-requested, approval-received)
- `CHANGELOG.md` — entry for v2.10.0

### Out of Scope
- OpenClaw server (separate project)
- OpenBrain memory integration (future)
- Frontend UI for bridge configuration (use .forge.json)
- Two-way chat (sending commands FROM Telegram/Slack back to Plan Forge)
- pforge.ps1/pforge.sh changes (bridge is server-side only)

### Forbidden Actions
- Do NOT modify `pforge-mcp/hub.mjs` (bridge is a hub client, not a hub modification)
- Do NOT modify `pforge-mcp/dashboard/` (bridge has its own API endpoints)
- Do NOT modify `setup.ps1` or `setup.sh`
- Do NOT add new npm dependencies (use Node.js built-in `fetch` for webhook calls)

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | HTTP client for webhooks | ✅ Resolved | Node.js built-in `fetch` (Node 18+, no new deps) |
| 2 | Approval callback mechanism | ✅ Resolved | Bridge exposes `POST /api/bridge/approve/:runId` endpoint. Messaging platforms send approval via bot command that calls this endpoint. |
| 3 | Config format | ✅ Resolved | `.forge.json` `bridge` section with `channels[]` array, each with `type`, `url`, `level`, `approvalRequired` |
| 4 | Message formatting | ✅ Resolved | Per-platform formatters: Telegram (Markdown), Slack (Block Kit JSON), Discord (Embed JSON), Generic (raw event JSON) |

---

## Execution Slices

### Slice 1: Bridge Core — Event Subscriber + Webhook Dispatcher [sequential]

**Goal**: Create `pforge-mcp/bridge.mjs` with event subscription and webhook dispatch for all 4 platforms.

**Tasks**:
1. Create `pforge-mcp/bridge.mjs` with:
   - `BridgeManager` class that connects to the WS hub as a client
   - Event handler that filters by notification level (all/important/critical)
   - Platform formatters: `formatTelegram()`, `formatSlack()`, `formatDiscord()`, `formatGeneric()`
   - `dispatchToChannel(channel, event)` — POST to webhook URL with platform-specific payload
   - Rate limiter: max 1 notification per 5s per channel
   - Error handling: log failures, don't crash on webhook errors
   - Config reader: loads `.forge.json` bridge section on init

2. Bridge config schema (in `.forge.json`):
```json
{
  "bridge": {
    "enabled": true,
    "channels": [
      {
        "type": "telegram",
        "url": "https://api.telegram.org/bot<TOKEN>/sendMessage",
        "chatId": "-1001234567890",
        "level": "important",
        "approvalRequired": false
      },
      {
        "type": "slack",
        "url": "https://hooks.slack.com/services/T00/B00/xxx",
        "level": "all"
      },
      {
        "type": "discord",
        "url": "https://discord.com/api/webhooks/123/abc",
        "level": "critical"
      },
      {
        "type": "generic",
        "url": "https://your-server.com/webhook",
        "level": "all"
      }
    ]
  }
}
```

**Context Files**:
- `pforge-mcp/hub.mjs` (WS client connection pattern)
- `pforge-mcp/EVENTS.md` (event types to subscribe to)
- `pforge-mcp/orchestrator.mjs` (event shapes)

**Build Command**: `node -c pforge-mcp/bridge.mjs`
**Test Command**: `node -e "import('./pforge-mcp/bridge.mjs').then(m => { console.log('bridge module loaded:', Object.keys(m).join(', ')); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })"`

**Depends On**: None

---

### Slice 2: Platform Message Formatters [parallel-safe, Group A]

**Goal**: Implement rich message formatting for each platform.

**Tasks**:
1. **Telegram** — Markdown v2 with emoji status indicators:
   - run-started: "🚀 *Plan Forge* — Executing `Phase-1-AUTH` (8 slices, auto mode)"
   - slice-completed: "✅ Slice 3/8 passed (45s, $0.12)"
   - slice-failed: "❌ Slice 3/8 FAILED — `dotnet build` exit code 1"
   - run-completed: "🏁 *Plan Forge* — Phase-1-AUTH complete! 8/8 passed. Score: 91. Cost: $1.24"

2. **Slack** — Block Kit with sections, dividers, and context:
   - Rich blocks with plan name, progress bar, cost, model info
   - Action buttons for approval gates (if approvalRequired)

3. **Discord** — Embed with color-coded sidebar (green=pass, red=fail, blue=info):
   - Embed fields: Plan, Slice, Status, Duration, Cost
   - Footer with model + timestamp

4. **Generic** — Clean JSON envelope with event type, payload, metadata

**Build Command**: `node -c pforge-mcp/bridge.mjs`
**Test Command**: `echo PASS`

**Depends On**: Slice 1

---

### Slice 3: Approval Gate State Machine [sequential]

**Goal**: Add approval gate to the bridge — pause execution, request approval via webhook, resume on callback.

**Tasks**:
1. Add `ApprovalGate` class to bridge.mjs:
   - `requestApproval(runId, event)` — sends approval request to channels with `approvalRequired: true`
   - Tracks pending approvals in memory: `Map<runId, { status, requestedAt, event }>`
   - `receiveApproval(runId, approved, approver)` — resolves the pending approval
   - Timeout: auto-reject after configurable period (default 30 min)

2. Add to orchestrator.mjs:
   - After all slices pass and before writing summary, check if bridge has approval channels
   - If so, call `bridge.requestApproval(runId, 'run-completed')` and await resolution
   - If approved → proceed with summary + completion
   - If rejected → mark run as "approval-rejected" in summary

3. Telegram approval message includes inline keyboard:
   ```
   Phase-1-AUTH complete! 8/8 passed. Score: 91.
   [✅ Approve] [❌ Reject]
   ```
   Buttons link to: `GET /api/bridge/approve/<runId>?action=approve`

**Build Command**: `node -c pforge-mcp/bridge.mjs && node -c pforge-mcp/orchestrator.mjs`
**Test Command**: `node -e "import('./pforge-mcp/bridge.mjs').then(m => { const g = new m.ApprovalGate(); console.log('ApprovalGate loaded'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })"`

**Depends On**: Slice 1

---

### Slice 4: Server Integration — REST Endpoints + Bridge Wiring [sequential]

**Goal**: Wire bridge into server.mjs with REST endpoints for status and approval callbacks.

**Tasks**:
1. In `pforge-mcp/server.mjs`:
   - Import bridge module
   - Initialize BridgeManager on server startup (if bridge config exists)
   - Add `GET /api/bridge/status` — returns connected channels, pending approvals, notification stats
   - Add `POST /api/bridge/approve/:runId` — receives approval callback, body: `{ action: "approve"|"reject", approver: "username" }`
   - Add `GET /api/bridge/approve/:runId` — browser-friendly approval (for Telegram inline buttons)

2. Security:
   - Approval endpoints validate runId exists in pending approvals
   - Optional secret token in bridge config for webhook authentication
   - Rate limit approval endpoints (1 per runId)

**Build Command**: `node -c pforge-mcp/server.mjs`
**Test Command**: `echo PASS`

**Depends On**: Slices 1, 3

---

### Slice 5: Event Schema + Changelog + Documentation [sequential]

**Goal**: Update EVENTS.md with new bridge events, update CHANGELOG, bump VERSION.

**Tasks**:
1. Add to `pforge-mcp/EVENTS.md`:
   - `approval-requested` event (type, runId, plan, channels)
   - `approval-received` event (type, runId, action, approver, timestamp)
   - `bridge-notification-sent` event (type, channel, platform, status)
   - `bridge-notification-failed` event (type, channel, error)

2. Update `CHANGELOG.md` with v2.10.0 entry
3. Bump `VERSION` to 2.10.0
4. Update `pforge-mcp/package.json` version to 2.10.0

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Get-Content VERSION -Raw).Trim() -eq '2.10.0') { 'PASS' } else { 'FAIL' }"`

**Depends On**: Slices 1, 2, 3, 4

---

## Parallel Merge Checkpoint (after Group A — Slices 1+2)

After Slices 1 and 2 complete:
- Verify bridge.mjs exports BridgeManager with all 4 formatters
- Verify `node -c pforge-mcp/bridge.mjs` passes

---

## Definition of Done

- [x] `bridge.mjs` created with BridgeManager, 4 platform formatters, approval gate
- [x] `server.mjs` wires bridge with 3 REST endpoints
- [x] `orchestrator.mjs` supports approval gate hook
- [x] EVENTS.md documents 4 new event types
- [x] Configuration via `.forge.json` bridge section
- [x] CHANGELOG.md and VERSION updated
- [x] All validation gates passed
- [ ] Reviewer Gate passed (zero 🔴 Critical)

---

## Stop Conditions

- ❌ Build failure in any MCP module (syntax error in .mjs)
- ❌ Hub.mjs modified (bridge connects as client, doesn't modify hub)
- ❌ Dashboard files modified (bridge has its own API)
- ❌ New npm dependencies added (use built-in fetch)
- ❌ Secret/token values hardcoded in source
- ❌ Webhook URLs logged without masking
