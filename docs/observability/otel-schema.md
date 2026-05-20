# Plan Forge — OpenTelemetry Schema Reference

> **Spec version**: Phase-OTEL-AUDIT-EXPORT  
> **OTel conventions**: `gen_ai.*` experimental (Development) — opt-in via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`  
> **Activation gate**: set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_ENABLED=true`) to enable all span emission. When unset, the OTel path is a complete no-op.

---

## Resource Attributes

Set once at SDK initialization. Applied to every span and metric from this process.

| Attribute | Value |
|---|---|
| `service.name` | `"pforge-mcp"` |
| `service.version` | Contents of `VERSION` file (e.g. `"2.90.12"`) |
| `service.namespace` | `"plan-forge"` |
| `host.name` | `os.hostname()` |
| `os.type` | `os.type()` |

---

## Span Types

### 1. LLM Call Span — `gen_ai.chat` (CLIENT)

Emitted for every LLM completion request made by the orchestrator.

**Span name**: `"chat {model}"` — e.g. `"chat claude-sonnet-4.6"`

| Attribute | Type | Notes |
|---|---|---|
| `gen_ai.operation.name` | string | Always `"chat"` |
| `gen_ai.provider.name` | string | `"anthropic"` \| `"openai"` \| `"x_ai"` \| `"azure.ai.openai"` \| `"github"` |
| `gen_ai.request.model` | string | Requested model identifier |
| `gen_ai.response.model` | string | Actual model used (from response) |
| `gen_ai.usage.input_tokens` | int | Total input tokens including cache reads |
| `gen_ai.usage.output_tokens` | int | Output tokens |
| `gen_ai.usage.reasoning.output_tokens` | int | Reasoning tokens when applicable |
| `gen_ai.usage.cache_read.input_tokens` | int | Subset of input tokens served from cache |
| `gen_ai.usage.cache_creation.input_tokens` | int | Tokens written to cache |
| `gen_ai.response.id` | string | Provider response ID |
| `gen_ai.response.finish_reasons` | string[] | Stop reasons (e.g. `["end_turn"]`) |
| `pforge.cost.usd` | double | Computed cost in USD (vendor-namespace; no `gen_ai.cost` exists in spec) |
| `pforge.slice.number` | int | Current slice number (correlation) |
| `pforge.run.id` | string | Run UUID (correlation) |
| `pforge.actor.source` | string | From event field: `"orchestrator"` \| `"worker"` \| `"user"` \| `"hook"` \| `"environment"` |
| `pforge.action.security_risk` | string | From event field: `"none"` \| `"low"` \| `"medium"` \| `"high"` \| `"critical"` |
| `error.type` | string | Exception class name when span status is ERROR |

**Events (opt-in)**:  
Gated by `pforge.telemetry.captureContent: true` in `.forge.json` (default `false` — PII guard).  
When enabled: `gen_ai.client.inference.operation.details` event carrying `gen_ai.prompt` and `gen_ai.completion`.

---

### 2. Tool Call Span — `execute_tool` (INTERNAL)

Emitted for every MCP tool dispatch (Plan Forge tools and user-defined extensions).

**Span name**: `"execute_tool {tool_name}"` — e.g. `"execute_tool forge_run_plan"`

| Attribute | Type | Notes |
|---|---|---|
| `gen_ai.operation.name` | string | Always `"execute_tool"` |
| `gen_ai.tool.name` | string | Tool identifier (e.g. `"forge_run_plan"`) |
| `gen_ai.tool.type` | string | Always `"function"` |
| `gen_ai.tool.call.id` | string | Correlates to `tool_call_id` in LLM messages |
| `pforge.run.id` | string | Run UUID |
| `pforge.slice.number` | int | Current slice number |

---

### 3. Slice Span — `invoke_agent` (INTERNAL)

Emitted for each slice execution within a plan run.

**Span name**: `"invoke_agent slice-{n}"` — e.g. `"invoke_agent slice-3"`

| Attribute | Type | Notes |
|---|---|---|
| `gen_ai.operation.name` | string | Always `"invoke_agent"` |
| `gen_ai.agent.name` | string | Slice identifier (e.g. `"slice-3"`) |
| `gen_ai.agent.version` | string | Plan commit SHA |
| `pforge.plan.name` | string | Plan name (e.g. `"Phase-28.2"`) |
| `pforge.slice.number` | string | Slice number |
| `pforge.run.id` | string | Run UUID |

---

### 4. Plan Run Span — `invoke_workflow` (INTERNAL)

Emitted once per `pforge run-plan` invocation. Parent span for all slice spans.

**Span name**: `"invoke_workflow {plan-name}"` — e.g. `"invoke_workflow Phase-28.2"`

| Attribute | Type | Notes |
|---|---|---|
| `gen_ai.operation.name` | string | Always `"invoke_workflow"` |
| `gen_ai.workflow.name` | string | Plan name |
| `pforge.plan.path` | string | Relative path to plan file |
| `pforge.plan.commit_sha` | string | Git SHA of plan file at execution time |
| `pforge.quorum.mode` | string | `"auto"` \| `"power"` \| `"speed"` \| `"false"` |
| `pforge.quorum.threshold` | int | Quorum threshold value |
| `pforge.run.id` | string | Run UUID |

---

### 5. Validation Gate Span — `pforge.gate` (INTERNAL)

Emitted for each validation gate execution. No `gen_ai.*` attributes — gates are Plan Forge constructs, not AI operations.

**Span name**: `"pforge.gate {gate_name}"` — e.g. `"pforge.gate tests-pass"`

| Attribute | Type | Notes |
|---|---|---|
| `pforge.gate.name` | string | Human-readable gate identifier |
| `pforge.gate.result` | string | `"pass"` \| `"fail"` \| `"blocked"` |
| `pforge.slice.number` | int | Slice that ran this gate |
| `pforge.run.id` | string | Run UUID |

---

## Metrics

Two histogram instruments emit on every LLM call. Exported every 60 seconds.

| Instrument | Unit | Description | Key attributes |
|---|---|---|---|
| `gen_ai.client.operation.duration` | `s` | End-to-end LLM call latency | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` |
| `gen_ai.client.token.usage` | `{token}` | Token count per call, one observation per token class | `gen_ai.token.type` (`"input"` \| `"output"` \| `"cache_read"` \| `"cache_creation"` \| `"reasoning"`) |

---

## Opt-in Events

| Event name | Gate | Payload |
|---|---|---|
| `gen_ai.client.inference.operation.details` | `pforge.telemetry.captureContent: true` | `gen_ai.prompt`, `gen_ai.completion` |
| `gen_ai.evaluation.result` | Always emitted on `forge_analyze` / quorum synthesis | Score, model, pass/fail |

---

## Configuration

### Environment variables

| Variable | Purpose |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Activates OTel emission. Point to your collector (e.g. `http://localhost:4318`). When unset, OTel is completely disabled. |
| `OTEL_ENABLED` | Alternative activation gate. Set to `true` or `1`. |
| `OTEL_SERVICE_NAME` | Override `service.name` (default: `pforge-mcp`). |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth headers for your OTLP collector (e.g. `Authorization=Bearer <token>`). Operator-managed. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | Set to `gen_ai_latest_experimental` to enable `gen_ai.*` semantic conventions. |

### `.forge.json` settings

```json
{
  "telemetry": {
    "captureContent": false
  }
}
```

| Key | Default | Notes |
|---|---|---|
| `telemetry.captureContent` | `false` | When `true`, prompt and completion text are included in `gen_ai.client.inference.operation.details` span events. **PII risk** — enable only in controlled environments. |

---

## Span Parent-Child Hierarchy

```
invoke_workflow Phase-28.2          (root, CLIENT)
├── invoke_agent slice-1            (INTERNAL)
│   ├── chat claude-sonnet-4.6      (INTERNAL, CLIENT for LLM)
│   ├── execute_tool forge_analyze  (INTERNAL)
│   └── pforge.gate tests-pass     (INTERNAL)
├── invoke_agent slice-2            (INTERNAL)
│   └── ...
└── ...
```

---

## Implementation Notes

- All `@opentelemetry/*` packages are `optionalDependencies`. Loaded via dynamic `import()` with try/catch. The server starts cleanly whether or not they are installed.
- The existing `trace.json` / `manifest.json` / `index.jsonl` sink in `telemetry.mjs` is **unchanged**. OTel is a sibling output — both coexist.
- Audit export (`pforge audit export`) reads the same files; it does not depend on OTel being enabled.
- `pforge.cost.usd` uses the same computed value as `priceSlice()` in `cost-service.mjs`. The cost math is not duplicated — the span attribute is set by reading the already-computed value.

---

## See Also

- [`audit-log-spec.md`](./audit-log-spec.md) — Event types, fields, and `pforge audit export` format
- [`sample-dashboards/`](./sample-dashboards/) — Grafana, Datadog, and Splunk starter dashboards
- [`docs/plans/archive/Phase-OTEL-AUDIT-EXPORT-PLAN.md`](../plans/archive/Phase-OTEL-AUDIT-EXPORT-PLAN.md) — Implementation plan
- [`docs/research/enterprise-fleet-readiness.md`](../research/enterprise-fleet-readiness.md) §8.6 — Original spec
