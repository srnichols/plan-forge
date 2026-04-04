# Plan Forge Event Schema — v1.0

> **Used by**: Phase 3 (WebSocket Hub), Phase 4-5 (Dashboard)
> **Transport**: WebSocket (localhost:3101)
> **Format**: JSON, one message per event
> **Versioned**: All events include `version: "1.0"` (M4)

---

## Common Fields

Every event includes:

```json
{
  "version": "1.0",
  "type": "event-type",
  "timestamp": "2026-04-04T09:30:00.000Z"
}
```

---

## Event Types

### `connected`
Sent to client on connection. Includes event history replay.

```json
{
  "type": "connected",
  "version": "1.0",
  "clientId": "uuid",
  "label": "dashboard",
  "historySize": 42,
  "timestamp": "..."
}
```

### `run-started`
Emitted when `runPlan()` begins execution.

```json
{
  "type": "run-started",
  "plan": "docs/plans/Phase-1.md",
  "mode": "auto",
  "model": "claude-sonnet-4.6",
  "sliceCount": 8,
  "executionOrder": ["1", "2", "3"]
}
```

### `slice-started`
Emitted when a slice begins execution.

```json
{
  "type": "slice-started",
  "sliceId": "1",
  "title": "Database Migration"
}
```

### `slice-completed`
Emitted when a slice passes all validation gates.

```json
{
  "type": "slice-completed",
  "sliceId": "1",
  "status": "passed",
  "duration": 45000,
  "tokens": { "tokens_out": 4200, "model": "claude-sonnet-4.6" },
  "cost_usd": 0.12
}
```

### `slice-failed`
Emitted when a slice or its validation gate fails.

```json
{
  "type": "slice-failed",
  "sliceId": "1",
  "status": "failed",
  "error": "Build failed: ...",
  "failedCommand": "dotnet build"
}
```

### `run-completed`
Emitted when all slices finish (pass or fail).

```json
{
  "type": "run-completed",
  "status": "completed",
  "results": { "passed": 8, "failed": 0 },
  "totalDuration": 2700000,
  "cost": { "total_cost_usd": 1.23 },
  "sweep": { "clean": true },
  "analyze": { "score": 91 },
  "report": "All slices: 8 passed, 0 failed. Cost: $1.23. Sweep: clean. Score: 91/100."
}
```

### `run-aborted`
Emitted when execution is aborted via `forge_abort`.

```json
{
  "type": "run-aborted",
  "sliceId": "3",
  "reason": "User abort"
}
```

---

## Client → Server Messages

### `set-label`
Update the client's label in the session registry.

```json
{
  "type": "set-label",
  "label": "my-dashboard"
}
```

---

## Connection

```
ws://127.0.0.1:3101?label=dashboard
```

Port may differ if 3101 was unavailable — check `.forge/server-ports.json`:

```json
{
  "ws": 3101,
  "pid": 12345,
  "startedAt": "2026-04-04T09:30:00.000Z"
}
```
