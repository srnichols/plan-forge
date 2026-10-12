# Phase-TRAJECTORY-SCHEMA-HARDENING: Explicit `source` and `security_risk` on Events (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/orchestrator.mjs`, `pforge-mcp/EVENTS.md`) + Tests + Docs
> **Estimated cost**: $1.00–$2.50 (6 slices, all small code + tests, schema-only change with backward-compat read path)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.5 (OpenHands pattern) + §9 Week 4 + §14 Priority C
> **Position in chain**: 1 of 4 — must land first because every downstream phase (OTel, audit-export) consumes the event-record shape this phase modifies. Conflict point with Phase-OTEL-AUDIT-EXPORT eliminated by sequencing.

---

## Scope Contract

### In Scope

- `pforge-mcp/orchestrator.mjs:292` — events.log writer (the canonical site where new fields are stamped)
- `pforge-mcp/orchestrator.mjs:8869-8922` — events.log parser (read-side, must surface new fields)
- `pforge-mcp/EVENTS.md` — Common Fields section + per-event examples updated for the new fields
- `pforge-mcp/tests/orchestrator.test.mjs` — extend existing event-shape tests
- New file `pforge-mcp/tests/event-schema-hardening.test.mjs` — focused tests for the new fields
- `CHANGELOG.md` — `[Unreleased]` entry

### Out of Scope

- `pforge-mcp/hub.mjs` event replay (lines 30, 215, 269-300) — pass-through only, no code changes; new fields ride on the existing `data` object
- `pforge-mcp/server.mjs` event watcher (154, 348-420) — same pass-through; no code changes
- `pforge-mcp/telemetry.mjs` — Phase-OTEL-AUDIT-EXPORT will consume the new fields; no changes here
- `forge_search`, `forge_timeline`, `forge_watch`, `forge_watch_live` — they read `data` opaquely; new fields surface automatically. No tool-surface changes
- Migration / backfill of historical `events.log` files — old records remain unchanged; new records get the new fields. Reader treats absent fields as `null`
- Confirmation-policy enforcement based on `security_risk` — this phase only **records** the field; downstream phases (gating, hooks) use it
- Renaming any existing field — purely additive
- Any change to `slice-N.json` artifact shape (separate from `events.log`)

### Forbidden Actions

- **Do NOT rename, remove, or change the type of any existing event field.** Purely additive — all prior shape contracts must continue to hold.
- **Do NOT change the `[ISO-timestamp] event-type: {json}` line format.** Downstream parsers (`forge_search`, `forge_timeline`, hub replay) depend on it byte-for-byte.
- **Do NOT add `source` or `security_risk` at the top of the event line.** They go inside the `data` JSON object so the line-format invariant holds.
- **Do NOT block writes when `source` cannot be determined.** Default to `"orchestrator"` and log debug-level when defaulting.
- **Do NOT touch `costForLeg()` or `priceSlice()` in `cost-service.mjs`.** Cost path is orthogonal.
- **Do NOT modify `worker-capabilities.json` or worker schemas.** Workers do not emit events directly; they emit through orchestrator dispatch.
- **Do NOT publish a release in this phase.** Release happens only after the full Priority-C chain lands or as a discrete decision.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | `source` enum values | RESOLVED | `"orchestrator" \| "worker" \| "user" \| "hook" \| "environment"`. Mirrors OpenHands' three-source model plus Plan Forge's `hook` and `user` (CLI input) discriminators. |
| 2 | `security_risk` enum values | RESOLVED | `"none" \| "low" \| "medium" \| "high" \| "critical"`. Aligns with `forge_secret_scan` severity levels for downstream gating. |
| 3 | Which event types get `security_risk` populated | RESOLVED | Only **action-equivalent** events: `slice-started`, `slice-completed`, `slice-failed`, `skill-step-started`, `skill-step-completed`, `tool-call`, `bridge-edit-blocked`, `bridge-edit-approved`. Telemetry/state events default to `"none"`. |
| 4 | Default for missing `source` on legacy reads | RESOLVED | `null` (not `"orchestrator"`). `null` distinguishes "field absent" from "explicitly orchestrator". Reader returns `null`; new writes always set a real value. |
| 5 | Where the value is computed | RESOLVED | At the `appendEvent` call site, not inside the writer. Each `appendEvent(type, data)` caller passes `source`/`security_risk` (or omits, defaulting to `"orchestrator"` / `"none"` respectively). |
| 6 | EVENTS.md format change | RESOLVED | Add a "Common Fields" subsection at the top of the doc enumerating `source` and `security_risk`. Update 4 representative event examples (slice-started, tool-call, bridge-edit-blocked, run-completed) to show the fields. Do NOT update every per-event example — overkill. |
| 7 | Test approach | RESOLVED | Snapshot tests on the wire format (one for each enum value × event-type combination that matters), plus a regression test asserting legacy events.log lines parse without throwing. |

---

## Acceptance Criteria

### Schema

- **MUST**: Every new event written via `appendEvent()` includes `source` and `security_risk` inside the `data` JSON object. Defaults applied when caller omits.
- **MUST**: `parseEventLine()` (orchestrator.mjs:8869-8922 region) returns `source` and `security_risk` on the parsed object; both default to `null` when absent on disk.
- **MUST**: Action-equivalent event types emit non-default `security_risk` (`slice-started` = `"low"` baseline, escalated by hooks; `bridge-edit-blocked` = `"high"`; `bridge-edit-approved` = whatever the request was tagged with; `tool-call` = `"none"` baseline).
- **MUST**: Backward-compat — every existing test in `pforge-mcp/tests/orchestrator.test.mjs` continues to pass without modification (writes with new fields parse cleanly; reads of old events.log lines succeed).

### Tests

- **MUST**: New test file `pforge-mcp/tests/event-schema-hardening.test.mjs` covers:
  1. `appendEvent('slice-started', {...})` produces a line whose `data` JSON contains both `source` and `security_risk`
  2. `appendEvent` with explicit `source: 'worker'` overrides the default
  3. `parseEventLine` on a legacy line (no `source`, no `security_risk`) returns `{ source: null, security_risk: null }` — does not throw
  4. `parseEventLine` on a new line round-trips both fields
  5. `bridge-edit-blocked` event always has `security_risk: 'high'` regardless of caller default
  6. Snapshot test: a slice-completed event with all five `source` values produces matching parse output

- **MUST**: Existing test files pass:
  - `pforge-mcp/tests/orchestrator.test.mjs`
  - `pforge-mcp/tests/hub.test.mjs`
  - `pforge-mcp/tests/search-smoke.test.mjs`
  - `pforge-mcp/tests/timeline-smoke.test.mjs`
  - `pforge-mcp/tests/g2-files.test.mjs`

### Documentation

- **MUST**: `pforge-mcp/EVENTS.md` Common Fields section lists `source` and `security_risk` with enum values and defaults. Four representative examples updated to show the fields.
- **MUST**: `CHANGELOG.md` `[Unreleased]` entry under "### Phase-TRAJECTORY-SCHEMA-HARDENING — Explicit source and security_risk on events" documenting the additive change and backward-compat guarantee.

---

## Execution Slices

6 slices, all small, sequential.

### Slice 1: Add Common Fields to EVENTS.md and define enums in code [sequential]

**Goal**: Document the new fields and define the source/risk enum constants in one place.

**Files**:
- `pforge-mcp/EVENTS.md`
- `pforge-mcp/orchestrator.mjs` (add `EVENT_SOURCE` and `SECURITY_RISK` const objects near the top of the file, alongside other module-level constants)

**Validation Gate**:
```bash
bash -c "grep -q 'source' pforge-mcp/EVENTS.md && grep -q 'security_risk' pforge-mcp/EVENTS.md && grep -q 'EVENT_SOURCE' pforge-mcp/orchestrator.mjs && grep -q 'SECURITY_RISK' pforge-mcp/orchestrator.mjs && echo ok"
```

---

### Slice 2: Stamp `source` and `security_risk` in `appendEvent()` [sequential]

**Goal**: Modify the single writer at `orchestrator.mjs:292` region so every event gets both fields. Defaults applied when caller omits.

**Files**:
- `pforge-mcp/orchestrator.mjs` (writer site only — preserve byte-format `[ISO] type: {json}`)

**Depends On**: Slice 1

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs --reporter=dot 2>&1 | tail -5 | grep -q 'Test Files' && echo ok"
```

---

### Slice 3: Surface fields in `parseEventLine()` [sequential]

**Goal**: Read-side change — parser returns `source` and `security_risk` on the parsed object, defaulting to `null` when absent.

**Files**:
- `pforge-mcp/orchestrator.mjs` (parser at lines ~8869-8922)

**Depends On**: Slice 2

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs tests/search-smoke.test.mjs tests/timeline-smoke.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 4: Tag specific event types with non-default `security_risk` [sequential]

**Goal**: At the call sites for `slice-started`, `slice-completed`, `slice-failed`, `tool-call`, `bridge-edit-blocked`, `bridge-edit-approved`, pass the appropriate `security_risk` value.

**Files**:
- `pforge-mcp/orchestrator.mjs` (call sites)
- `pforge-mcp/bridge.mjs` (the two `bridge-edit-*` call sites only — purely passing the value, no auth changes)

**Depends On**: Slice 3

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs tests/hub.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 5: New test file — event-schema-hardening.test.mjs [sequential]

**Goal**: Six targeted tests per Acceptance Criteria.

**Files**:
- `pforge-mcp/tests/event-schema-hardening.test.mjs` (new)

**Depends On**: Slice 4

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/event-schema-hardening.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*1 passed' && echo ok"
```

---

### Slice 6: CHANGELOG entry [sequential]

**Goal**: `[Unreleased]` entry capturing the additive schema change and backward-compat guarantee. Mirror the format of prior entries.

**Files**:
- `CHANGELOG.md`

**Depends On**: Slice 5

**Validation Gate**:
```bash
bash -c "grep -q 'Phase-TRAJECTORY-SCHEMA-HARDENING' CHANGELOG.md && echo ok"
```

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
| `pforge-mcp/EVENTS.md` | 1 |
| `pforge-mcp/orchestrator.mjs` | 1, 2, 3, 4 |
| `pforge-mcp/bridge.mjs` | 4 |
| `pforge-mcp/tests/event-schema-hardening.test.mjs` | 5 (new file) |
| `CHANGELOG.md` | 6 |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| New fields break `forge_search` / `forge_timeline` | They read `data` opaquely; additive fields are invisible. Verified via Slice 3 gate. |
| Hub replay rejects new shape | Hub passes `data` through unchanged. Verified via existing hub tests in Slice 3 gate. |
| Old events.log files become unreadable | Reader defaults missing fields to `null`; tested in Slice 5 case 3. |
| `bridge-edit-*` security_risk drifts from `forge_secret_scan` severity scale | Both use the same enum; documented as the single canonical scale. |
