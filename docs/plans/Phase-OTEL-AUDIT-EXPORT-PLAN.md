# Phase-OTEL-AUDIT-EXPORT: OpenTelemetry `gen_ai.*` Spans + `pforge audit export` (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/telemetry.mjs`, `pforge-mcp/orchestrator.mjs`, `pforge-mcp/cost-service.mjs`, `pforge.ps1`, `pforge.sh`) + Tests + Docs + Sample dashboards
> **Estimated cost**: $4.00–$8.00 (12 slices, mostly small code + tests, one larger CLI slice)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.6 (full implementation spec lines 411-504) + §9 Week 2 + §14 Priority C
> **Position in chain**: 2 of 4 — depends on Phase-TRAJECTORY-SCHEMA-HARDENING (`source` and `security_risk` fields land first so OTel can map them to span attributes without rework).

---

## Scope Contract

### In Scope

- `pforge-mcp/telemetry.mjs` — extend `createTraceContext`, `startRootSpan`, `startSpan`, `endSpan`, `addEvent`, `createTelemetryHandler` with `gen_ai.*` semantic-convention emission. Add OTLP HTTP exporter init that activates when `OTEL_EXPORTER_OTLP_ENDPOINT` env var is set.
- `pforge-mcp/orchestrator.mjs` — wrap LLM call sites and slice execution with span emission via the existing `createTelemetryHandler` consumer of the events bus (no double-write — one event consumer, one OTel exporter).
- `pforge-mcp/cost-service.mjs` — emit `pforge.cost.usd` attribute on chat spans (computed cost surfaces in trace data).
- `pforge.ps1` and `pforge.sh` — new `pforge audit export --since <date> --format json|csv [--output <path>]` CLI subcommand.
- `pforge-mcp/audit-export.mjs` — new module that reads `.forge/runs/<id>/events.log`, `index.jsonl`, `manifest.json`, `trace.json` and emits a unified audit stream filtered by `--since`.
- `pforge-mcp/tests/otel-emission.test.mjs` — new file, OTel span emission tests.
- `pforge-mcp/tests/audit-export.test.mjs` — new file, CLI export tests.
- New optional npm deps: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`. Loaded via dynamic `import()` only when OTLP endpoint is set — graceful no-op when deps absent or env unset.
- `docs/observability/` — new docs folder with three files: `otel-schema.md` (the published `gen_ai.*` + `pforge.*` schema), `audit-log-spec.md` (event types, fields, format, export), `sample-dashboards/` (Grafana JSON, Datadog JSON, Splunk SPL).
- `CHANGELOG.md` — `[Unreleased]` entry.

### Out of Scope

- **`source` and `security_risk` event fields** — Phase-TRAJECTORY-SCHEMA-HARDENING owns these. This phase MAPS them to OTel span attributes (`gen_ai.actor.source`, `gen_ai.action.security_risk`) but does not add the fields to events.
- Auth on the OTel endpoint itself — operator's OTLP collector handles auth. Plan Forge sends to the configured endpoint with optional `OTEL_EXPORTER_OTLP_HEADERS` env var.
- OTel logs signal emission — only traces + metrics this phase. Logs deferred.
- OTel resource detector for cloud providers (`@opentelemetry/resource-detector-aws` etc.) — operator can add if needed; not bundled.
- Rewriting `telemetry.mjs` internal trace.json format — additive; both sinks coexist.
- Real-time SIEM streaming via syslog/CEF — file-based export only this phase.
- Per-engineer cost attribution in the export — Plan Forge already lacks per-engineer attribution generally; out of scope.
- Audit log retention / archival policy — operator concern; we document recommended patterns only.
- Replacing `forge_cost_report` MCP tool — orthogonal.

### Forbidden Actions

- **Do NOT make `@opentelemetry/*` packages required dependencies.** They go in `optionalDependencies` in `pforge-mcp/package.json` and are loaded via dynamic `import()` with try/catch.
- **Do NOT emit OTel spans when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.** Module init must be a complete no-op in that case (no SDK initialization, no resource detection cost).
- **Do NOT modify `trace.json`, `manifest.json`, or `index.jsonl` schemas.** Existing telemetry sink is unchanged. OTel is a sibling output sink.
- **Do NOT couple `audit-export.mjs` to the OTel exporter.** Audit export reads from the same files telemetry already writes; it must work whether or not OTel is enabled.
- **Do NOT change the `[ISO] type: {json}` events.log line format.** Phase-TRAJECTORY-SCHEMA-HARDENING locked this; audit export reads it.
- **Do NOT add `gen_ai.cost` as an attribute name.** OTel spec does not have it. Use `pforge.cost.usd` per §8.6 spec note "no `gen_ai.cost` attribute exists in the spec".
- **Do NOT include prompt or completion content in spans by default.** Add `pforge.telemetry.captureContent` config flag (default `false`) per §8.6 events guidance — PII implications.
- **Do NOT touch `costForLeg()` or `priceSlice()` math.** Read-only consumer.
- **Do NOT publish a release in this phase.**

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Span schema | RESOLVED | §8.6 lines 425-475 — five span types: chat (CLIENT), tool (INTERNAL), agent/slice (INTERNAL), workflow/plan (INTERNAL), gate (INTERNAL). Attributes pre-defined per type. |
| 2 | Required vs optional OTel deps | RESOLVED | All `@opentelemetry/*` packages in `optionalDependencies`. Dynamic import. No-op when unavailable. |
| 3 | Activation gate | RESOLVED | Single env var: `OTEL_EXPORTER_OTLP_ENDPOINT`. When unset, OTel path is dead code. |
| 4 | Cost attribute name | RESOLVED | `pforge.cost.usd` (vendor namespace per §8.6). Avoids non-existent `gen_ai.cost`. |
| 5 | Content capture | RESOLVED | Off by default. Opt-in via `pforge.telemetry.captureContent: true` in `.forge.json`. PII guard. |
| 6 | Audit export format set | RESOLVED | `json` (one record per line, JSONL — easy to pipe into Splunk HEC) and `csv` (flat, aggregate-friendly). Default `json`. |
| 7 | Audit export filter granularity | RESOLVED | `--since <ISO-date>`, `--until <ISO-date>` (optional), `--type <event-type>` (optional, repeatable), `--run <run-id>` (optional). Default reads all runs in `.forge/runs/`. |
| 8 | Sample dashboards format | RESOLVED | Grafana JSON dashboard model v8+, Datadog dashboard JSON v3, Splunk SPL strings (no full app, just SPL queries operators can paste). All three live in `docs/observability/sample-dashboards/`. |
| 9 | OTel resource attributes | RESOLVED | §8.6 spec exact: `service.name="pforge-mcp"`, `service.version=<VERSION file>`, `service.namespace="plan-forge"`. Plus `host.name`, `os.type` from existing telemetry.mjs `createTraceContext`. |
| 10 | Trace exporter protocol | RESOLVED | OTLP HTTP (not gRPC). Better firewall traversal, simpler dep tree. Operators with gRPC collectors can use a sidecar. |
| 11 | Metric instruments | RESOLVED | §8.6: two histograms — `gen_ai.client.operation.duration` (seconds) and `gen_ai.client.token.usage` (count). Periodic export every 60s. |
| 12 | Mapping of Phase-1 fields to span attributes | RESOLVED | `source` → `pforge.actor.source` (e.g., `"orchestrator"`, `"worker"`); `security_risk` → `pforge.action.security_risk` (e.g., `"high"`). Vendor namespace, parallel to `gen_ai.*`. |

---

## Acceptance Criteria

### OTel emission

- **MUST**: When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, `node -e "import('./pforge-mcp/telemetry.mjs')"` completes without loading any `@opentelemetry/*` package and without emitting any spans. Verified by stubbing `import` and asserting it is never called.
- **MUST**: When `OTEL_EXPORTER_OTLP_ENDPOINT` is set to a test collector URL, every LLM call site in `orchestrator.mjs` produces a `gen_ai.chat <model>` span with the §8.6-spec attributes (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `pforge.cost.usd`, `pforge.slice.number`, `pforge.run.id`).
- **MUST**: Each MCP tool dispatch in `pforge-mcp/server.mjs` (or wherever tool handlers run) produces an `execute_tool <tool_name>` span with `gen_ai.tool.name`, `gen_ai.tool.type="function"`, `gen_ai.tool.call.id`, `pforge.run.id`, `pforge.slice.number`.
- **MUST**: Each slice execution produces an `invoke_agent slice-N` span with `gen_ai.agent.name`, `gen_ai.agent.version` (= plan commit SHA), `pforge.plan.name`, `pforge.slice.number`, `pforge.run.id`.
- **MUST**: Each plan run produces an `invoke_workflow <plan>` span with `gen_ai.workflow.name`, `pforge.plan.path`, `pforge.plan.commit_sha`, `pforge.quorum.mode`, `pforge.quorum.threshold`, `pforge.run.id`.
- **MUST**: Each validation gate produces a `pforge.gate <gate_name>` span (no `gen_ai.*` attrs) with `pforge.gate.name`, `pforge.gate.result` (`"pass"|"fail"|"blocked"`), `pforge.slice.number`, `pforge.run.id`.
- **MUST**: Two metric histograms emit on every LLM call: `gen_ai.client.operation.duration` (unit `s`) and `gen_ai.client.token.usage` (unit `{token}`, one observation per token-class with `gen_ai.token.type` attr). Periodic export every 60s.
- **MUST**: When Phase-TRAJECTORY-SCHEMA-HARDENING fields are present on the source event, spans carry them as `pforge.actor.source` and `pforge.action.security_risk` attributes.

### Audit export CLI

- **MUST**: `pforge audit export --since 2026-05-01 --format json` writes JSONL to stdout (one record per line) covering `slice-started`, `slice-completed`, `slice-failed`, `bridge-edit-blocked`, `bridge-edit-approved`, `tool-call`, `run-started`, `run-completed`, `run-aborted` events from all runs in `.forge/runs/` whose start time is on/after the date.
- **MUST**: `pforge audit export --since 2026-05-01 --format csv --output audit.csv` writes a flat CSV with header row including `timestamp, run_id, plan, slice_id, event_type, source, security_risk, gate_result, cost_usd, tokens_in, tokens_out, model, worker`. Missing fields render as empty cells.
- **MUST**: `pforge audit export --since 2026-05-01 --type slice-failed --type bridge-edit-blocked` filters to only the named event types.
- **MUST**: `pforge audit export --run <run-id>` scopes to a single run.
- **MUST**: Streaming reader — does not load all events into memory at once. Verified with a 100K-event synthetic fixture (test only, not committed) parses with peak RSS < 100 MB.
- **MUST**: When `.forge/runs/` is empty or missing, command exits 0 and writes nothing (graceful), not an error.

### Tests

- **MUST**: `pforge-mcp/tests/otel-emission.test.mjs` covers:
  1. No-op when `OTEL_EXPORTER_OTLP_ENDPOINT` unset (assert no `@opentelemetry/*` import)
  2. Chat span shape on a synthetic LLM call event
  3. Tool span shape on a synthetic tool dispatch
  4. Agent (slice) span shape with parent-child relation to workflow span
  5. Workflow span on plan start/end
  6. Gate span shape with pass/fail/blocked
  7. Metric histogram observations on LLM call
  8. `pforge.actor.source` and `pforge.action.security_risk` attributes propagate from event data
  9. `captureContent: false` (default) — no `gen_ai.input.messages` or `gen_ai.output.messages` attributes emitted
  10. `captureContent: true` — content attributes present

- **MUST**: `pforge-mcp/tests/audit-export.test.mjs` covers:
  1. JSON format output shape
  2. CSV format output shape with header row
  3. `--since` filter excludes older runs
  4. `--type` filter scopes to named events
  5. `--run` filter scopes to one run
  6. Empty `.forge/runs/` exits 0 cleanly
  7. Streaming on a large synthetic fixture (1K events) completes without error

- **MUST**: Existing tests pass: `tests/orchestrator.test.mjs`, `tests/hub.test.mjs`, `tests/cost-service.test.mjs`, `tests/event-schema-hardening.test.mjs` (from Phase 1).

### Documentation

- **MUST**: `docs/observability/otel-schema.md` documents the published span + attribute schema (resource attrs, all five span types with attribute lists, both metrics, both events). Versioned (`schema_version: 1`).
- **MUST**: `docs/observability/audit-log-spec.md` documents the audit export CLI, the supported event types, the JSON/CSV record shapes, and recommended retention patterns.
- **MUST**: `docs/observability/sample-dashboards/` contains `grafana-pforge-overview.json`, `datadog-pforge-overview.json`, `splunk-pforge-queries.spl`. Each shows: runs per hour, p50/p95 slice duration, cost per plan, gate fail rate, top failing slices.
- **MUST**: `CHANGELOG.md` `[Unreleased]` entry under "### Phase-OTEL-AUDIT-EXPORT — OpenTelemetry gen_ai spans + audit export CLI".

---

## Execution Slices

12 slices, sequential. Slice ordering minimizes regression surface — schema and dep registration first, then emitters, then CLI, then docs.

### Slice 1: Add optional OpenTelemetry deps + activation gate skeleton [sequential]

**Goal**: Add `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http` to `pforge-mcp/package.json` `optionalDependencies`. Add `pforge-mcp/otel-init.mjs` that exports `initOtel()` returning `null` when `OTEL_EXPORTER_OTLP_ENDPOINT` unset and a configured tracer/meter pair when set. Use dynamic `import()` with try/catch.

**Files**:
- `pforge-mcp/package.json` (optionalDependencies only)
- `pforge-mcp/otel-init.mjs` (new)

**Validation Gate**:
```bash
bash -c "node -e \"import('./pforge-mcp/otel-init.mjs').then(m=>{const r=m.initOtel();if(r!==null)process.exit(1);console.log('ok')})\""
```

---

### Slice 2: OTel chat span emitter wired into createTelemetryHandler [sequential]

**Goal**: In `telemetry.mjs` `createTelemetryHandler`, after the existing `slice-completed` and `quorum-leg-completed` handling, emit a `gen_ai.chat <model>` span with §8.6-spec attributes when `initOtel()` returns non-null.

**Files**:
- `pforge-mcp/telemetry.mjs`

**Depends On**: Slice 1

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node -e \"const t=require('./telemetry.mjs');console.log('ok')\" 2>&1 | tail -1 | grep -q ok"
```

---

### Slice 3: OTel tool span emitter [sequential]

**Goal**: Emit `execute_tool <tool_name>` span on each MCP tool invocation. Hook into the tool dispatcher in `server.mjs` or wherever tool handlers run.

**Files**:
- `pforge-mcp/telemetry.mjs` (emitter helper)
- `pforge-mcp/server.mjs` (one wrap point at the tool dispatch site — minimal touch)

**Depends On**: Slice 2

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 4: OTel agent (slice) + workflow (plan) span emitters [sequential]

**Goal**: Emit `invoke_agent slice-N` and `invoke_workflow <plan>` spans via the `createTelemetryHandler` switch.

**Files**:
- `pforge-mcp/telemetry.mjs`

**Depends On**: Slice 3

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/hub.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok"
```

---

### Slice 5: OTel gate span emitter [sequential]

**Goal**: Emit `pforge.gate <gate_name>` span on every gate result.

**Files**:
- `pforge-mcp/telemetry.mjs` (gate-result event handler)

**Depends On**: Slice 4

**Validation Gate**:
```bash
bash -c "grep -q 'pforge.gate' pforge-mcp/telemetry.mjs && echo ok"
```

---

### Slice 6: OTel metrics — operation duration + token usage histograms [sequential]

**Goal**: Two histogram instruments wired in `otel-init.mjs`, observations recorded in the chat span emitter. Periodic export every 60s.

**Files**:
- `pforge-mcp/otel-init.mjs`
- `pforge-mcp/telemetry.mjs`

**Depends On**: Slice 5

**Validation Gate**:
```bash
bash -c "grep -q 'gen_ai.client.operation.duration' pforge-mcp/telemetry.mjs && grep -q 'gen_ai.client.token.usage' pforge-mcp/telemetry.mjs && echo ok"
```

---

### Slice 7: Map Phase-1 source/security_risk to span attributes [sequential]

**Goal**: When `source` and `security_risk` are present on the source event (Phase 1 added them), stamp them as `pforge.actor.source` and `pforge.action.security_risk` on the relevant span.

**Files**:
- `pforge-mcp/telemetry.mjs`

**Depends On**: Slice 6 (and Phase-TRAJECTORY-SCHEMA-HARDENING already on master)

**Validation Gate**:
```bash
bash -c "grep -q 'pforge.actor.source' pforge-mcp/telemetry.mjs && grep -q 'pforge.action.security_risk' pforge-mcp/telemetry.mjs && echo ok"
```

---

### Slice 8: New module pforge-mcp/audit-export.mjs (streaming reader) [sequential]

**Goal**: Pure function `exportAudit(opts)` that streams from `.forge/runs/<id>/events.log`, applies `--since/--until/--type/--run` filters, yields JSON or CSV records.

**Files**:
- `pforge-mcp/audit-export.mjs` (new)

**Depends On**: Slice 7

**Validation Gate**:
```bash
bash -c "node -e \"import('./pforge-mcp/audit-export.mjs').then(m=>{if(typeof m.exportAudit!=='function')process.exit(1);console.log('ok')})\""
```

---

### Slice 9: CLI dispatch — `pforge audit export` in pforge.ps1 [sequential]

**Goal**: New `pforge audit export` subcommand wired into the PowerShell command switch.

**Files**:
- `pforge.ps1`

**Depends On**: Slice 8

**Validation Gate**:
```bash
bash -c "pwsh -Command \"& ./pforge.ps1 audit export --help\" 2>&1 | grep -q 'since' && echo ok"
```

---

### Slice 10: CLI dispatch — `pforge audit export` in pforge.sh [sequential]

**Goal**: Mirror the PowerShell command in bash so Linux/macOS consumers get parity.

**Files**:
- `pforge.sh`

**Depends On**: Slice 9

**Validation Gate**:
```bash
bash -c "./pforge.sh audit export --help 2>&1 | grep -q 'since' && echo ok"
```

---

### Slice 11: Tests — otel-emission + audit-export [sequential]

**Goal**: Two new test files covering all Acceptance Criteria test cases.

**Files**:
- `pforge-mcp/tests/otel-emission.test.mjs` (new)
- `pforge-mcp/tests/audit-export.test.mjs` (new)

**Depends On**: Slice 10

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/otel-emission.test.mjs tests/audit-export.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*2 passed' && echo ok"
```

---

### Slice 12: Docs — otel-schema.md + audit-log-spec.md + sample-dashboards/ + CHANGELOG [sequential]

**Goal**: Three new docs files plus three sample-dashboard files plus CHANGELOG entry.

**Files**:
- `docs/observability/otel-schema.md` (new)
- `docs/observability/audit-log-spec.md` (new)
- `docs/observability/sample-dashboards/grafana-pforge-overview.json` (new)
- `docs/observability/sample-dashboards/datadog-pforge-overview.json` (new)
- `docs/observability/sample-dashboards/splunk-pforge-queries.spl` (new)
- `CHANGELOG.md`

**Depends On**: Slice 11

**Validation Gate**:
```bash
bash -c "test -f docs/observability/otel-schema.md && test -f docs/observability/audit-log-spec.md && test -f docs/observability/sample-dashboards/grafana-pforge-overview.json && test -f docs/observability/sample-dashboards/datadog-pforge-overview.json && test -f docs/observability/sample-dashboards/splunk-pforge-queries.spl && grep -q 'Phase-OTEL-AUDIT-EXPORT' CHANGELOG.md && echo ok"
```

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
| `pforge-mcp/package.json` | 1 |
| `pforge-mcp/otel-init.mjs` | 1, 6 (new) |
| `pforge-mcp/telemetry.mjs` | 2, 3, 4, 5, 6, 7 |
| `pforge-mcp/server.mjs` | 3 |
| `pforge-mcp/audit-export.mjs` | 8 (new) |
| `pforge.ps1` | 9 |
| `pforge.sh` | 10 |
| `pforge-mcp/tests/otel-emission.test.mjs` | 11 (new) |
| `pforge-mcp/tests/audit-export.test.mjs` | 11 (new) |
| `docs/observability/otel-schema.md` | 12 (new) |
| `docs/observability/audit-log-spec.md` | 12 (new) |
| `docs/observability/sample-dashboards/grafana-pforge-overview.json` | 12 (new) |
| `docs/observability/sample-dashboards/datadog-pforge-overview.json` | 12 (new) |
| `docs/observability/sample-dashboards/splunk-pforge-queries.spl` | 12 (new) |
| `CHANGELOG.md` | 12 |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| OTel init slows MCP startup when endpoint set | Dynamic import + lazy resource detector; measured init < 100ms in Slice 1 acceptance |
| Optional deps missing on consumer install | Try/catch around dynamic import; degrade to no-op with warn-once log |
| CLI arg parser drift between ps1 and sh | Slice 9 and 10 use the same arg names + `--help` text; gate verifies both surfaces match |
| CSV format breaks on values containing commas | Use quoted-field CSV with embedded-quote escaping; tested in Slice 11 case 2 |
| Audit export OOMs on huge runs | Streaming reader (Slice 8); peak-RSS test in Slice 11 case 7 |
| Trace JSON file already on disk gets corrupted | OTel exporter is a separate sink; trace.json writer is untouched |
