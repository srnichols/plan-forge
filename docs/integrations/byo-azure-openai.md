# BYO Azure OpenAI / Microsoft Azure AI Foundry

> **Applies to**: Plan Forge v2.90.12-dev+  
> **Source**: Phase-FOUNDRY-PROVIDER (enterprise-fleet-readiness.md §11.5.A)

This guide walks you through connecting Plan Forge to your own Azure OpenAI Service or Azure AI Foundry endpoint. Plan Forge uses the OpenAI-compatible REST API surface, so no Azure SDK is required.

---

## Prerequisites

- An Azure OpenAI Service resource or Azure AI Foundry project with at least one deployment
- A model deployment name (e.g., `eastus-prod-gpt-4.1`)
- Either an API key **or** a Managed Identity / Service Principal (Entra auth)

---

## Quick Start — API Key Auth

Set three environment variables (or add them to `.forge/secrets.json`):

```bash
export AZURE_OPENAI_API_KEY="your-api-key"
export AZURE_OPENAI_ENDPOINT="https://my-resource.openai.azure.com/"
export AZURE_OPENAI_DEPLOYMENT="eastus-prod-gpt-4.1"   # optional default deployment
```

Then reference your deployment using the `azure/` prefix in any model field:

```bash
pforge run-plan --quorum=power-gov docs/plans/my-plan.md
```

Or in `.forge.json`:

```json
{
  "model": "azure/eastus-prod-gpt-4.1"
}
```

Plan Forge strips the `azure/` prefix before sending the request so the AOAI API receives only the bare deployment name.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Yes (api-key path) | Your AOAI resource API key |
| `AZURE_OPENAI_ENDPOINT` | Yes | Base resource URL, e.g. `https://<resource>.openai.azure.com/` |
| `AZURE_OPENAI_DEPLOYMENT` | No | Default deployment name used when no `azure/` prefix is given |
| `AZURE_OPENAI_API_VERSION` | No | API version; defaults to `2025-01-01-preview`. Ignored on the `/openai/v1` stable route. |
| `AZURE_AUTH_MODE` | No | Set to `entra` or `managed-identity` for Entra/Managed Identity auth (see below) |
| `AZURE_TENANT_ID` | No | Tenant ID for Entra auth (used by `DefaultAzureCredential`) |
| `AZURE_CLIENT_ID` | No | Client ID for service-principal Entra auth |
| `AZURE_OPENAI_DEPLOYMENT_TYPE` | No | Deployment tier: `global` (default), `data-zone`, `regional`, `provisioned`. Affects cost reporting only. |

> **Security**: These env vars are listed in `KNOWN_SECRETS`. The `redactSecrets` utility masks them in logs. Never commit API keys — use `.forge/secrets.json` (gitignored) or your CI secret manager.

---

## Deployment-Name to Model-Key Mapping

Plan Forge resolves your deployment name to a canonical pricing entry for cost reports. The lookup order is:

1. `.forge/foundry-deployments.json` (operator-editable)
2. Literal fallback — the deployment name is used as-is (works when you name deployments after model families, e.g. `gpt-4.1`)

Create `.forge/foundry-deployments.json` to map custom names:

```json
{
  "eastus-prod-gpt-4.1": "gpt-4.1",
  "westus-dev-gpt-5-mini": "gpt-5-mini",
  "my-o3-mini-deployment": "o3-mini"
}
```

When a deployment name is not in the map, Plan Forge logs a warning and falls back to the literal name.

---

## Entra / Managed Identity Auth

For passwordless auth via Azure Managed Identity or Service Principal:

1. Install the optional `@azure/identity` package:
   ```bash
   cd pforge-mcp && npm install @azure/identity
   ```

2. Set `AZURE_AUTH_MODE`:
   ```bash
   export AZURE_AUTH_MODE=entra
   export AZURE_OPENAI_ENDPOINT="https://my-resource.openai.azure.com/"
   # No AZURE_OPENAI_API_KEY needed — DefaultAzureCredential handles auth
   ```

Plan Forge uses `DefaultAzureCredential` which automatically picks up:
- Environment credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`)
- Workload Identity (AKS)
- Managed Identity
- Azure CLI credentials (local dev)

> If `@azure/identity` is not installed when `AZURE_AUTH_MODE=entra`, Plan Forge returns a clear error and exits the slice — no crash.

---

## Azure Government Cloud

Plan Forge detects Government cloud automatically by checking whether `AZURE_OPENAI_ENDPOINT` ends with `.azure.us`:

```bash
export AZURE_OPENAI_ENDPOINT="https://my-resource.openai.azure.us/"
export AZURE_AUTH_MODE=entra
```

On detection, the Entra token scope switches from `https://cognitiveservices.azure.com/.default` to `https://cognitiveservices.azure.us/.default`. This is logged once at startup.

---

## `power-gov` Quorum Preset

For Azure Government environments, use the `power-gov` preset — a curated model list from the Azure Gov catalog:

```bash
pforge run-plan --quorum=power-gov docs/plans/my-plan.md
```

Models: `gpt-5.1`, `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`, `gpt-4o`. Threshold: 5 (same as `power`).

---

## AOAI Deployment-Type Cost Uplift

Azure bills Data Zone and Regional deployments at a 10% uplift over Global. Set `AZURE_OPENAI_DEPLOYMENT_TYPE` to have cost reports reflect the actual billing:

```bash
export AZURE_OPENAI_DEPLOYMENT_TYPE=data-zone   # or: regional, provisioned, global (default)
```

This affects `priceSlice()` only — the API call itself is unaffected.

---

## Known Friction Points

> From `enterprise-fleet-readiness.md` §11.8

- **Cost de-duplication**: If the same underlying model is reachable via multiple providers, cost reports show spend rolled up per-provider (no cross-provider dedup). A future `cost-attribution-rework` phase will address this.
- **Deployment-type uplift by region**: The 1.1× Data Zone / Regional multiplier is the published Microsoft rate. If Microsoft changes rates for a specific region, update `AZURE_OPENAI_DEPLOYMENT_TYPE` or edit `MODEL_PRICING` locally.
- **Azure Gov catalog churn**: The `power-gov` preset is a starting template. Override it via `.forge.json` `quorum.models` if Microsoft adds or removes models from the Gov catalog.

---

## See Also

- [`docs/integrations/foundry-toolbox-mcp.md`](foundry-toolbox-mcp.md) — Foundry Toolbox MCP server integration
- [`docs/observability/foundry-app-insights.md`](../observability/foundry-app-insights.md) — Exporting telemetry to App Insights
- [`docs/observability/otel-schema.md`](../observability/otel-schema.md) — Full OTel span schema
