# Phase 3: WebSocket Hub — Real-Time Inter-Session Communication

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 3
> **Status**: ✅ Complete
> **Feature Branch**: `feature/v2.0-websocket-hub`
> **Depends On**: Phase 1 (Orchestrator) ✅
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Step 3 ✅ (executed)
> **Review Findings Applied**: C5 (single process), M3 (port fallback), M4 (event versioning)

---

## Specification (Step 0)

### Problem Statement
Phase 1's orchestrator writes results to files — there's no way to monitor progress in real-time or for multiple sessions to communicate. This phase adds a WebSocket hub that enables live progress streaming and lays the foundation for the dashboard (Phase 4-5).

### Acceptance Criteria
- **MUST**: WebSocket server embedded in `mcp/server.mjs` (same process, same port range)
- **MUST**: Orchestrator publishes events per slice: `slice-started`, `slice-completed`, `slice-failed`, `run-completed`
- **MUST**: `forge_plan_status` returns real-time status (not just file-based)
- **MUST**: Event schema is documented and stable (dashboard depends on it)
- **SHOULD**: Session registry tracks connected clients with labels
- **SHOULD**: Heartbeat/keepalive so stale connections are cleaned up
- **MAY**: Event history buffer (last 100 events) for clients that connect mid-run

---

## Scope Contract

### In Scope
- `mcp/hub.mjs` — WebSocket server + event bus (new)
- `mcp/server.mjs` — integrate hub, start WS on server init
- `mcp/orchestrator.mjs` — publish events during execution
- `mcp/package.json` — add `ws` dependency
- Event schema documentation

### Out of Scope
- Dashboard UI (Phase 4-5)
- Parallel execution (Phase 6)
- External client connections (OpenClaw — v2.3)

### Forbidden Actions
- Do NOT expose WebSocket to external networks (localhost only by default)
- Do NOT break existing MCP stdio transport
- Do NOT add authentication (local-only for now)

---

## Execution Slices

### Slice 1: WebSocket Server (60 min — Claude)
**Goal**: `mcp/hub.mjs` with WS server embedded in MCP process

- Create `hub.mjs`: `createHub(port)` → starts WebSocket server
- Client connection tracking (id, label, connected_at)
- Broadcast function: `hub.broadcast(event)` → sends to all connected clients
- Heartbeat every 30s, clean up stale connections
- Default port: 3101 (MCP stdio + WS coexist)

**Validation Gates**:
- [ ] WS server starts alongside MCP server
- [ ] Test client can connect and receive events

### Slice 2: Event Schema + Bus (45 min — Codex/Auto)
**Goal**: Define event types and wire orchestrator → hub

- Event types: `run-started`, `slice-started`, `slice-completed`, `slice-failed`, `run-completed`, `run-aborted`
- Payload schema: `{ type, timestamp, run_id, slice_number, slice_total, status, duration, model, details }`
- `run-completed` includes: total score, sweep results, cost summary
- Event history buffer: last 100 events in memory

**Validation Gates**:
- [ ] All event types documented
- [ ] Orchestrator publishes events during execution

### Slice 3: Session Registry (30 min — Codex/Auto)
**Goal**: Track connected clients and expose via MCP

- Registry: `{ client_id, label, connected_at, last_heartbeat }`
- `forge_plan_status` enhanced: returns live status from hub (not just files)
- List connected clients via internal API

**Validation Gates**:
- [ ] `forge_plan_status` returns real-time data when hub is running
- [ ] Falls back to file-based when hub is not running

### Slice 4: Integration + Documentation (45 min — Claude)
**Goal**: Wire hub into server startup, document event schema

- `mcp/server.mjs` imports hub, starts on init
- Environment variable `PLAN_FORGE_WS_PORT` for custom port
- Document event schema in `mcp/EVENTS.md`
- Update CLI-GUIDE, README with WebSocket info

**Validation Gates**:
- [ ] Hub starts automatically with MCP server
- [ ] Event schema documented
- [ ] Docs updated

---

## Definition of Done
- [ ] WebSocket server runs alongside MCP server
- [ ] Orchestrator publishes events for all slice lifecycle stages
- [ ] `forge_plan_status` returns real-time status
- [ ] Event schema documented and stable

## Stop Conditions
- If `ws` package conflicts with MCP SDK → evaluate alternative (Socket.IO, raw HTTP SSE)
