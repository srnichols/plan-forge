# Exporting Plan Forge Telemetry to Azure Application Insights

> **Applies to**: Plan Forge v2.90.12-dev+  
> **Source**: Phase-FOUNDRY-PROVIDER (enterprise-fleet-readiness.md §11.5.C) + Phase-OTEL-AUDIT-EXPORT

Plan Forge emits OpenTelemetry spans and metrics via its OTel exporter (see [`otel-schema.md`](otel-schema.md)). This guide shows how to route that telemetry to your Azure AI Foundry project's attached Application Insights resource using the OTLP/HTTP endpoint that App Insights exposes.

No new code is required — the OTel exporter already supports any OTLP endpoint. App Insights is a configuration example.

---

## Architecture

```
Plan Forge (OTel SDK)
  └─► OTLP/HTTP exporter
        └─► Azure Monitor OpenTelemetry Distro endpoint
              └─► Application Insights resource
                    └─► Azure AI Foundry Monitoring panel
```

---

## Prerequisites

- Plan Forge with OTel enabled (`PFORGE_OTEL=true`)
- An Application Insights resource in the same subscription as your Azure AI Foundry project
- The App Insights **Connection String** (from the portal → Overview → Connection String)

---

## Configuration

### Option 1 — OTLP/HTTP via Azure Monitor OTLP Endpoint (recommended)

App Insights provides an OTLP/HTTP ingestion endpoint on the same connection string. Set:

```bash
export PFORGE_OTEL=true
export OTEL_EXPORTER_OTLP_ENDPOINT="https://eastus-3.in.applicationinsights.azure.com/v2.1/track"
export OTEL_EXPORTER_OTLP_HEADERS="x-ms-appinsights-key=<your-instrumentation-key>"
```

> Replace `eastus-3` with your App Insights region and `<your-instrumentation-key>` with the instrumentation key from the Connection String (the `InstrumentationKey=...` segment).

### Option 2 — Azure Monitor OpenTelemetry Distro (Node.js)

If you're running Plan Forge in a Node.js environment with the `@azure/monitor-opentelemetry` package available:

```bash
npm install @azure/monitor-opentelemetry
```

Set the connection string:

```bash
export APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=<key>;IngestionEndpoint=https://eastus-3.in.applicationinsights.azure.com/;..."
export PFORGE_OTEL=true
```

The Azure Monitor distro auto-discovers the connection string from the env var and configures the OTLP pipeline.

---

## What Plan Forge Sends

All five span types defined in [`otel-schema.md`](otel-schema.md) flow through to App Insights:

| App Insights Table | Plan Forge Span |
|---|---|
| `dependencies` | `gen_ai.chat` (LLM API calls) |
| `dependencies` | `execute_tool`, `invoke_agent`, `invoke_workflow` |
| `customEvents` | `pforge.gate` (gate pass/fail) |
| `performanceCounters` | `gen_ai.client.token.usage` histogram |

### Querying in App Insights

```kql
// LLM call count by model (last 24h)
dependencies
| where timestamp > ago(24h)
| where name == "gen_ai.chat"
| summarize count() by tostring(customDimensions["gen_ai.request.model"])
| render barchart

// Gate failures
customEvents
| where name == "pforge.gate"
| where customDimensions["pforge.gate.status"] == "failed"
| project timestamp, gate=customDimensions["pforge.gate.id"], plan=customDimensions["pforge.run.plan"]
```

---

## Multi-Agent OTel Semantic Conventions

Microsoft (Azure AI Foundry) and Cisco Outshift are developing joint OTel semantic conventions for multi-agent systems, including:

- `execute_task` — agent task execution span
- `agent_to_agent_interaction` — handoff between agents

Plan Forge's existing `invoke_agent` and `invoke_workflow` span types align with this emerging convention. When the spec stabilizes, Plan Forge will emit both the existing `pforge.*` names and the new `execute_task` / `agent_to_agent_interaction` names in parallel for a deprecation window.

---

## Content Capture (PII Warning)

Plan Forge supports opt-in prompt/response capture via `pforge.telemetry.captureContent: true` in `.forge.json`. **Do not enable this when exporting to App Insights in production** — prompt text may contain PII, customer data, or credentials. App Insights retains data for up to 90 days by default.

See the `pforge.telemetry.captureContent` section in [`otel-schema.md`](otel-schema.md) for full details.

---

## Foundry Monitoring Panel

Once telemetry flows into the App Insights resource attached to your Foundry project, the **Foundry Monitoring** panel auto-populates with:

- LLM call rates and latency by model
- Token usage trends
- Cost attribution (via `pforge.cost.usd` attribute — note: no `gen_ai.cost` attribute exists in the current OTel spec)
- Gate outcome timeline

No additional configuration is needed in the Foundry portal.

---

## See Also

- [`docs/observability/otel-schema.md`](otel-schema.md) — Full OTel span + attribute schema
- [`docs/observability/audit-log-spec.md`](audit-log-spec.md) — `pforge audit export` for batch compliance export
- [`docs/integrations/byo-azure-openai.md`](../integrations/byo-azure-openai.md) — BYO Azure OpenAI provider setup
