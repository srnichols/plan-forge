# Plan Forge — Audit Log Specification

> **Spec version**: Phase-OTEL-AUDIT-EXPORT  
> **Format**: Line-oriented (`[ISO timestamp] event-type: {json}`) — defined by Phase-TRAJECTORY-SCHEMA-HARDENING  
> **Export tool**: `pforge audit export` — streams filtered records without loading all events into memory

---

## Overview

Every Plan Forge run writes an `events.log` file to `.forge/runs/<run-id>/events.log`. Each line records a discrete orchestration event in the format:

```
[2026-05-07T18:00:00.000Z] slice-started: {"sliceNumber":3,"plan":"Phase-28.2","runId":"abc123"}
```

The audit export command reads these files and emits a filtered, normalized stream suitable for SIEM ingestion, compliance review, or cost audits.

---

## Event Line Format

```
[<ISO-8601-timestamp>] <event-type>: <JSON-payload>
```

- **Timestamp**: UTC ISO 8601, millisecond precision
- **Event type**: kebab-case identifier (see [Event Types](#event-types) below)
- **Payload**: JSON object; fields vary by event type

### Common Fields (all events)

These fields appear on every event payload since Phase-TRAJECTORY-SCHEMA-HARDENING:

| Field | Type | Values | Default |
|---|---|---|---|
| `source` | string | `"orchestrator"` \| `"worker"` \| `"user"` \| `"hook"` \| `"environment"` | `"orchestrator"` |
| `security_risk` | string | `"none"` \| `"low"` \| `"medium"` \| `"high"` \| `"critical"` | `"none"` |

Legacy records predating Phase-TRAJECTORY-SCHEMA-HARDENING omit these fields. Export normalizes absent values to `null` — intentionally distinct from `"orchestrator"` / `"none"`.

---

## Event Types

### Run lifecycle

| Event type | Description | Key payload fields |
|---|---|---|
| `run-started` | Plan execution begins | `runId`, `plan`, `mode`, `quorumMode`, `quorumThreshold` |
| `run-completed` | Plan completed all slices | `runId`, `plan`, `sliceCount`, `durationMs`, `costUsd` |
| `run-aborted` | Plan aborted (gate failure, user interrupt, or fatal error) | `runId`, `plan`, `reason`, `failedSlice`, `exitCode` |

### Slice lifecycle

| Event type | Description | Key payload fields |
|---|---|---|
| `slice-started` | A slice begins execution | `runId`, `plan`, `sliceNumber`, `sliceTitle`, `source`, `security_risk` (always `"low"`) |
| `slice-completed` | A slice finished successfully | `runId`, `plan`, `sliceNumber`, `durationMs`, `costUsd` |
| `slice-failed` | A slice finished with a non-zero exit or gate failure | `runId`, `plan`, `sliceNumber`, `reason`, `gateResult` |

### Gate events

| Event type | Description | Key payload fields |
|---|---|---|
| `gate-passed` | A validation gate returned exit 0 | `runId`, `sliceNumber`, `gateName`, `durationMs` |
| `gate-failed` | A validation gate returned non-zero exit | `runId`, `sliceNumber`, `gateName`, `output`, `exitCode` |
| `gate-blocked` | A gate was skipped due to a prior failure | `runId`, `sliceNumber`, `gateName` |

### Tool events

| Event type | Description | Key payload fields |
|---|---|---|
| `tool-call` | An MCP tool was invoked | `runId`, `sliceNumber`, `tool`, `callId`, `durationMs` |

### Bridge / edit guard events

| Event type | Description | Key payload fields |
|---|---|---|
| `bridge-edit-blocked` | An edit was blocked by the bridge guard | `runId`, `sliceNumber`, `path`, `reason`, `source`, `security_risk` (always `"high"`) |
| `bridge-edit-approved` | An edit was approved after review | `runId`, `sliceNumber`, `path`, `reviewer`, `security_risk` |

---

## Run Directory Layout

```
.forge/
└── runs/
    └── <run-id>/
        ├── events.log      # Line-by-line event stream (primary audit source)
        ├── index.jsonl     # One JSONL record per slice (summary)
        ├── manifest.json   # Run metadata: plan, mode, start/end time, cost
        └── trace.json      # Internal OTLP-compatible span capture
```

`pforge audit export` reads `events.log` as its primary source. It falls back to `manifest.json` for run-level metadata (plan name, run ID). `trace.json` is not read by the export command.

---

## Export Command

### Usage

```bash
pforge audit export --since <date> [options]
```

### Options

| Option | Description |
|---|---|
| `--since <ISO-date>` | Required. Only include runs whose start time is on or after this date (e.g. `2026-05-01`). |
| `--until <ISO-date>` | Optional. Only include runs whose start time is before this date. |
| `--type <event-type>` | Optional, repeatable. Filter to specific event types (e.g. `--type slice-failed --type bridge-edit-blocked`). |
| `--run <run-id>` | Optional. Scope to a single run by ID. |
| `--format json\|csv` | Output format. Default: `json` (JSONL). |
| `--output <path>` | Write to file instead of stdout. |

### Output formats

#### JSON (JSONL — default)

One JSON record per line. Records contain the normalized flat structure:

```json
{"timestamp":"2026-05-07T18:00:00.000Z","run_id":"abc123","plan":"Phase-28.2","slice_id":"3","event_type":"slice-started","source":"orchestrator","security_risk":"low","gate_result":null,"cost_usd":null,"tokens_in":null,"tokens_out":null,"model":null,"worker":null}
```

#### CSV

Flat CSV with a header row. One record per event. Empty cells for fields not applicable to the event type.

```
timestamp,run_id,plan,slice_id,event_type,source,security_risk,gate_result,cost_usd,tokens_in,tokens_out,model,worker
2026-05-07T18:00:00.000Z,abc123,Phase-28.2,3,slice-started,orchestrator,low,,,,,,
```

### Examples

```bash
# All events since May 1, output as JSONL to stdout
pforge audit export --since 2026-05-01

# Security events only, to a file
pforge audit export --since 2026-05-01 \
  --type bridge-edit-blocked \
  --type bridge-edit-approved \
  --output security-audit.jsonl

# CSV cost report
pforge audit export --since 2026-04-01 --format csv --output cost-report.csv

# Single run inspection
pforge audit export --run abc123 --format json
```

### Behavior notes

- **Streaming**: the reader processes `events.log` line-by-line via `readline`. It never loads all events into memory. Verified with 100K-event synthetic fixtures at peak RSS < 100 MB.
- **Graceful on missing data**: when `.forge/runs/` is empty or missing, the command exits 0 and writes no output. Not an error.
- **Decoupled from OTel**: audit export works whether or not `OTEL_EXPORTER_OTLP_ENDPOINT` is set. It reads the same files that `telemetry.mjs` writes.
- **Exit codes**: 0 on success (including no-data case), 1 on parse error.

---

## CSV Column Reference

| Column | Source | Notes |
|---|---|---|
| `timestamp` | Event line timestamp | UTC ISO 8601 |
| `run_id` | `manifest.json` or event payload | UUID |
| `plan` | `manifest.json` or `data.plan` | Plan name |
| `slice_id` | `data.sliceId` \| `data.slice` \| `data.sliceNumber` | Slice number as string |
| `event_type` | Event line type field | See [Event Types](#event-types) |
| `source` | `data.source` | `null` for pre-Phase-TRAJECTORY-SCHEMA-HARDENING records |
| `security_risk` | `data.security_risk` | `null` for legacy records |
| `gate_result` | `data.gateResult` | `"pass"` \| `"fail"` \| `"blocked"` or empty |
| `cost_usd` | `data.costUsd` \| `data.cost` | Floating-point USD or empty |
| `tokens_in` | `data.tokensIn` \| `data.inputTokens` | Integer or empty |
| `tokens_out` | `data.tokensOut` \| `data.outputTokens` | Integer or empty |
| `model` | `data.model` | Model identifier or empty |
| `worker` | `data.worker` \| `data.workerName` | Worker label or empty |

---

## Compliance and Retention Notes

- Plan Forge does not implement retention policy. Operators should configure periodic rotation of `.forge/runs/` contents appropriate for their compliance requirements.
- Prompt and completion content are **never** written to `events.log`. Event payloads contain token counts, costs, and metadata only. This is a hard design constraint — not configurable.
- `bridge-edit-blocked` events carry `security_risk: "high"` and are designed to be filterable by SIEM tools for privileged action review.
- For GDPR/data-residency compliance: all data remains local to the machine running `pforge run-plan`. No event data is sent to external services unless the operator configures `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

## See Also

- [`otel-schema.md`](./otel-schema.md) — OpenTelemetry span and metric schema
- [`sample-dashboards/`](./sample-dashboards/) — Grafana, Datadog, and Splunk starter dashboards
- [`docs/plans/Phase-OTEL-AUDIT-EXPORT-PLAN.md`](../plans/Phase-OTEL-AUDIT-EXPORT-PLAN.md) — Implementation plan
