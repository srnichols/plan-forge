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

## Skill Events

### `skill-started`
Emitted when a skill begins execution via `forge_run_skill`.

```json
{
  "type": "skill-started",
  "version": "1.0",
  "skillName": "test-sweep",
  "stepCount": 5,
  "args": "unit tests only",
  "timestamp": "..."
}
```

### `skill-step-started`
Emitted when a skill step begins.

```json
{
  "type": "skill-step-started",
  "version": "1.0",
  "skillName": "test-sweep",
  "stepNumber": 1,
  "stepName": "Unit Tests",
  "timestamp": "..."
}
```

### `skill-step-completed`
Emitted when a skill step finishes (pass or fail).

```json
{
  "type": "skill-step-completed",
  "version": "1.0",
  "skillName": "test-sweep",
  "stepNumber": 1,
  "stepName": "Unit Tests",
  "status": "passed",
  "duration": 12000,
  "timestamp": "..."
}
```

### `skill-completed`
Emitted when all skill steps finish.

```json
{
  "type": "skill-completed",
  "version": "1.0",
  "skillName": "test-sweep",
  "status": "completed",
  "stepsPassed": 4,
  "stepsFailed": 1,
  "totalDuration": 45000,
  "timestamp": "..."
}
```

---

## Bridge Events

### `approval-requested`
Emitted when the bridge pauses execution and requests external approval.

```json
{
  "type": "approval-requested",
  "version": "1.0",
  "runId": "Phase-1-AUTH-20260406T093000",
  "plan": "docs/plans/Phase-1-AUTH-PLAN.md",
  "channels": ["telegram", "slack"],
  "timeoutMinutes": 30,
  "timestamp": "..."
}
```

### `approval-received`
Emitted when an external approval callback is received.

```json
{
  "type": "approval-received",
  "version": "1.0",
  "runId": "Phase-1-AUTH-20260406T093000",
  "action": "approve",
  "approver": "srnichols",
  "timestamp": "..."
}
```

### `bridge-notification-sent`
Emitted after a webhook notification is successfully dispatched to a channel.

```json
{
  "type": "bridge-notification-sent",
  "version": "1.0",
  "channel": "telegram",
  "platform": "telegram",
  "eventType": "run-completed",
  "status": "sent",
  "timestamp": "..."
}
```

### `bridge-notification-failed`
Emitted when a webhook dispatch fails (network error, bad status, etc.).

```json
{
  "type": "bridge-notification-failed",
  "version": "1.0",
  "channel": "slack",
  "error": "HTTP 403 Forbidden",
  "timestamp": "..."
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
