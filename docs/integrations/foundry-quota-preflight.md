# Foundry Quota Preflight

> **Applies to**: Plan Forge v2.92.1-dev+  
> **Source**: Phase-FOUNDRY-QUOTA-PREFLIGHT (enterprise-fleet-readiness.md §11.6)

Before Plan Forge sends tokens to your Azure OpenAI / Azure AI Foundry deployment it can
check the deployment's TPM capacity and compare it against the slice token estimate. This
**quota preflight** keeps plan execution from hitting a rate-limit wall mid-run.

---

## How It Works

1. `forge_run_plan` calls `getDeploymentQuota()` at the start of each slice (before the
   worker is dispatched).
2. The result is passed to `compareSliceEstimate()`, which classifies headroom as
   **safe / warning / critical / unknown**.
3. A `[foundry-quota]` annotation is injected into the slice log. If the status is
   `critical`, the orchestrator emits a `quota-warning` event and, when
   `PFORGE_FOUNDRY_QUOTA_PREFLIGHT=block` is set, halts execution with an actionable error.

```
[foundry-quota] safe — 68.3% headroom (eastus-prod-gpt-4.1).
Cap=100,000 tpm, used=0 tpm, slice est=31,700 tokens.
```

---

## Prerequisites

- An Azure OpenAI Service or Azure AI Foundry deployment already configured per
  `docs/integrations/byo-azure-openai.md`.
- A credential that satisfies `credential.getToken("https://management.azure.com/.default")`:
  - **Entra / Managed Identity** — set `AZURE_AUTH_MODE=entra` (requires `@azure/identity`).
  - **Service Principal** — `AZURE_AUTH_MODE=managed-identity` with env vars
    `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

> **Required Azure RBAC role**: The identity used must hold the  
> **Cognitive Services Usages Reader** role (built-in) on the Azure OpenAI account or its
> resource group. This role grants read-only access to the control-plane quota endpoint
> (`Microsoft.CognitiveServices/accounts/deployments/read`) without allowing any data-plane
> or model-serving operations.

---

## Activation

### Warn-only mode (default)

Set the feature flag — quota checks run, headroom is logged, but execution never blocks:

```bash
export PFORGE_FOUNDRY_QUOTA_PREFLIGHT=warn   # or just set the var with any non-empty value
```

Or in `.forge/secrets.json`:

```json
{
  "PFORGE_FOUNDRY_QUOTA_PREFLIGHT": "warn"
}
```

### Block mode

Stop the run before a slice that would exceed quota:

```bash
export PFORGE_FOUNDRY_QUOTA_PREFLIGHT=block
```

With `block` mode, execution halts on `critical` status and the following structured error
is returned:

```json
{
  "ok": false,
  "reason": "quota_preflight_critical",
  "message": "[foundry-quota] critical — -3.2% headroom …",
  "deployment": "eastus-prod-gpt-4.1"
}
```

### Disable

```bash
unset PFORGE_FOUNDRY_QUOTA_PREFLIGHT   # or set to empty string / "false" / "off"
```

---

## Threshold Reference

| Status | Headroom after subtracting current usage + slice estimate |
|---|---|
| `safe` | ≥ 30 % |
| `warning` | 10 – 30 % |
| `critical` | < 10 % (including negative — over-budget) |
| `unknown` | Quota unavailable (fail-open; execution continues) |

**Fail-open guarantee**: any error fetching quota (`timeout`, `rate_limited`, `forbidden`,
`network_error`, etc.) returns `status: "unknown"` and never blocks execution, regardless of
the `PFORGE_FOUNDRY_QUOTA_PREFLIGHT` mode.

---

## Cache Behaviour

Quota values are cached in-process for **5 minutes** (configurable via the `ttlMs`
parameter in `foundry-quota.mjs`). This means:

- A plan with 10 slices hitting the same deployment makes **at most 1** control-plane call
  per 5-minute window, not 10.
- If you resize a deployment mid-run, the new capacity is reflected within 5 minutes.

---

## Required Azure Permissions

| Action | Required role |
|---|---|
| Read deployment quota (`GET /deployments/{name}`) | **Cognitive Services Usages Reader** |
| Acquire token for `management.azure.com` | Any Entra identity / service principal |

The `Cognitive Services Usages Reader` role is a built-in Azure role that grants
`Microsoft.CognitiveServices/*/read` without any write or data-plane permissions. Assign it
at the **resource-group** or **subscription** level to cover all AOAI accounts in scope.

```bash
az role assignment create \
  --assignee "<service-principal-client-id>" \
  --role "Cognitive Services Usages Reader" \
  --scope "/subscriptions/<sub-id>/resourceGroups/<rg-name>"
```

---

## Quota Response Shape

`getDeploymentQuota()` returns either a success object or a fail-open error:

```ts
// Success
{
  ok: true,
  deploymentName: string,
  model: string,          // e.g. "gpt-4.1"
  tpmCapacity: number | null,  // tokens-per-minute capacity from control plane
  tpmUsage: number | null,     // current usage (null = not reported by this endpoint)
  ptuCapacity: number | null,  // provisioned throughput capacity (future)
  ptuUsage: number | null,
  sku: string | null,
  fetchedAt: string,      // ISO 8601 timestamp
}

// Fail-open
{
  ok: false,
  reason: "missing_required_params" | "no_credential" | "no_token" | "token_error"
        | "rate_limited" | "forbidden" | "service_unavailable" | "timeout"
        | "network_error" | "http_<code>",
}
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `reason: "no_credential"` | `credential` not provided | Set `AZURE_AUTH_MODE=entra` or `managed-identity` |
| `reason: "forbidden"` | Missing RBAC role | Assign **Cognitive Services Usages Reader** to the identity |
| `reason: "rate_limited"` | Too many control-plane calls | Cache TTL is already 5 min; check for multiple concurrent workers |
| `reason: "timeout"` | Control-plane slow or unreachable | Check network connectivity to `management.azure.com`; quota check fails open |
| `status: "unknown"` on every slice | Any of the above | Execution continues; review the `[foundry-quota]` log annotation for the `reason` field |
| `tpmCapacity: null` | Deployment uses PTU (provisioned) | PTU capacity is not reported on the same endpoint; status will be `unknown` |

---

## Related Docs

- `docs/integrations/byo-azure-openai.md` — BYO AOAI / Foundry provider setup
- `docs/integrations/foundry-toolbox-mcp.md` — Foundry Toolbox MCP server wiring
- `pforge-mcp/foundry-quota.mjs` — Implementation (`getDeploymentQuota`, `compareSliceEstimate`, cache)
- `pforge-mcp/tests/foundry-quota.test.mjs` — 20 unit tests covering all error codes and threshold boundaries
