# Phase-FOUNDRY-PROVIDER: BYO Azure OpenAI / Microsoft Foundry Provider (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/secrets.mjs`, `pforge-mcp/orchestrator.mjs`, `pforge-mcp/cost-service.mjs`, `pforge-mcp/crucible-config.mjs`) + Tests + Docs
> **Estimated cost**: $2.50–$5.00 (8 slices, mostly small code + tests)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: `docs/research/enterprise-fleet-readiness.md` §11.5.A (BYO Foundry spec, lines 600-621), §11.5.B (Toolbox MCP), §11.5.C (App Insights sink), §11.8 (friction points), §14 Priority C + Priority D
> **Position in chain**: 3 of 4 — independent of Phases 1-2 in file footprint, but sequenced after to avoid git working-tree contention.

---

## Scope Contract

### In Scope

- `pforge-mcp/secrets.mjs` — `KNOWN_SECRETS` array, add `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` (Entra path).
- `pforge-mcp/orchestrator.mjs` — provider dispatch table at lines ~1925-2000. Add `microsoft-foundry` as a first-class provider with two auth paths (api-key, entra).
- `pforge-mcp/cost-service.mjs` — deployment-name → model-name normalization in `priceSlice()` so Foundry deployments map cleanly to existing `MODEL_PRICING` entries. Also add `power-gov` quorum preset entries.
- `pforge-mcp/crucible-config.mjs` (or wherever quorum presets are registered) — new `power-gov` preset enumerating Azure Government catalog models (gpt-5.1, gpt-4.1 family, o3-mini, gpt-4o).
- `pforge-mcp/tests/foundry-provider.test.mjs` — new test file.
- `docs/observability/foundry-app-insights.md` — new doc, optional sink for Phase-OTEL-AUDIT-EXPORT (Phase 2) using customer's Foundry-attached App Insights connection string.
- `docs/integrations/foundry-toolbox-mcp.md` — new doc, `.vscode/mcp.json` example pointing at a Foundry Toolbox endpoint.
- `docs/integrations/byo-azure-openai.md` — new doc, the canonical BYO config guide for MS-shop enterprises.
- `CHANGELOG.md` — `[Unreleased]` entry.

### Out of Scope

- Foundry quota preflight (read customer's TPM/PTU via Cognitive Services control-plane API and warn) — surfaced as Priority D backlog. Defer to a follow-on phase. This phase only adds the provider.
- Foundry Agent Service deployment of Plan Forge slices — explicitly NOT a fit per §11.5.D ("Plan Forge sitting on top of Foundry Agent Service — awkward, don't force it"). Out of scope forever in this shape.
- Wrap of `azure-ai-projects` SDK — Plan Forge stays `fetch()`-based. Foundry endpoint is OpenAI-compatible (per §11.1).
- AOAI deployment-type uplift (+10% for Data Zone / Regional vs. Global) — surfaced in Phase-COST-TOKEN-COVERAGE notes (deferred to this phase). **Now in scope as Slice 6.**
- Multi-region / multi-deployment failover within Foundry — operator concern.
- Removing or refactoring existing providers (Anthropic, OpenAI, xAI, copilot-subscription).
- New CLI commands (`pforge audit export` lives in Phase 2).
- Adding Microsoft Agent Framework (MAF) as a worker runtime.

### Forbidden Actions

- **Do NOT make `azure-ai-projects` or `@azure/identity` required dependencies.** `@azure/identity` may go in `optionalDependencies` for the Entra path; loaded via dynamic import with try/catch when `AZURE_AUTH_MODE=entra`.
- **Do NOT touch `costForLeg()` (cost-service.mjs:309-318).** v2.83.0 invariant — subscription-CLI cost path is untouched.
- **Do NOT change `priceSlice()` positional signature.** Foundry deployment-name handling is additive — when `provider === 'microsoft-foundry'`, normalize the model key before the existing `getPricing()` lookup.
- **Do NOT log `AZURE_OPENAI_API_KEY` or any secret value.** Use the existing `redactSecrets` pattern from `secrets.mjs`.
- **Do NOT default to Entra auth.** API-key path is the simpler default; Entra is opt-in via `AZURE_AUTH_MODE=entra`.
- **Do NOT hard-code Azure Government endpoint domain.** Read from `AZURE_OPENAI_ENDPOINT` — operators in Azure Gov set it to `https://<resource>.openai.azure.us/`. Detect Gov by domain suffix and pick `.us` token authority for Entra.
- **Do NOT remove or rename existing quorum presets** (`auto`, `power`, `speed`, `false`). `power-gov` is additive.
- **Do NOT modify `MODEL_PRICING` rates.** Phase-COST-TOKEN-COVERAGE locked them. This phase adds deployment-name normalization, not new prices.
- **Do NOT publish a release in this phase.**

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Provider name string | RESOLVED | `microsoft-foundry`. Matches the §11.5.A spec and the canonical brand. |
| 2 | Auth modes | RESOLVED | Two: `api-key` (default — `AZURE_OPENAI_API_KEY`), `entra` (opt-in via `AZURE_AUTH_MODE=entra`, uses `DefaultAzureCredential` from `@azure/identity` optional dep, requests bearer for `https://ai.azure.com/.default`). |
| 3 | Endpoint URL convention | RESOLVED | `AZURE_OPENAI_ENDPOINT` is the base resource URL (e.g., `https://my-resource.openai.azure.com`). Plan Forge composes the full URL using the new stable `/openai/v1/` route per §11.1. |
| 4 | Deployment-name vs model-name | RESOLVED | Operator sets `AZURE_OPENAI_DEPLOYMENT` (e.g., `eastus-prod-gpt-5-mini`). Plan Forge maps via a config table `.forge/foundry-deployments.json` (operator-editable) of `{ deployment: model }` pairs to look up `MODEL_PRICING`. Default fallback: try the deployment name as a literal model key (works when operator names deployments after model families). |
| 5 | API version | RESOLVED | Default to `2025-01-01-preview` for the legacy route; prefer the new stable `/openai/v1/` route which doesn't require `?api-version=`. Configurable via `AZURE_OPENAI_API_VERSION`. |
| 6 | `power-gov` model list | RESOLVED | `gpt-5.1`, `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`, `gpt-4o`. Threshold 5. Per §11.8 friction point #6 — reduced Azure Gov catalog. |
| 7 | Government cloud detection | RESOLVED | Heuristic: `AZURE_OPENAI_ENDPOINT` ending in `.azure.us` → Gov. Logged at startup; affects Entra token authority only. |
| 8 | AOAI deployment-type uplift | RESOLVED | New optional `MODEL_PRICING` field `aoai_deployment_type_multiplier: { 'global': 1.0, 'data-zone': 1.1, 'regional': 1.1, 'provisioned': 1.0 }`. Operator sets `AZURE_OPENAI_DEPLOYMENT_TYPE` (default `global`). Multiplier applied in `priceSlice()` only when `provider === 'microsoft-foundry'`. |
| 9 | Cost de-duplication when same model reachable via multiple providers | RESOLVED | Out of scope for this phase. Surface as a known friction point in `byo-azure-openai.md` doc per §11.8 #1 — operators see the cost rolled up per-provider. Future phase (cost-attribution-rework) handles dedup. |
| 10 | Documentation home for the App Insights sink | RESOLVED | `docs/observability/foundry-app-insights.md` — sibling to Phase 2's `docs/observability/otel-schema.md`. Pure docs slice; the OTel exporter from Phase 2 already supports any OTLP endpoint, so App Insights is a config example, not new code. |
| 11 | Where Toolbox MCP integration is documented | RESOLVED | `docs/integrations/foundry-toolbox-mcp.md` — config-only walkthrough showing `.vscode/mcp.json` `servers` block with a Foundry Toolbox `server_url` + Bearer-token Custom Keys connection. No code change. |

---

## Acceptance Criteria

### Provider integration

- **MUST**: `pforge-mcp/secrets.mjs` `KNOWN_SECRETS` includes the six new Azure entries. `redactSecrets` covers each.
- **MUST**: When `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` are set, `microsoft-foundry` appears in the provider availability list and is selectable as a worker.
- **MUST**: API-key auth — request adds `api-key: <key>` header (NOT `Authorization: Bearer <key>` — AOAI convention).
- **MUST**: Entra auth (when `AZURE_AUTH_MODE=entra`) — request adds `Authorization: Bearer <token>` from `DefaultAzureCredential`. Optional dep `@azure/identity` loaded via dynamic import; missing dep produces a clear error message instructing operator to install.
- **MUST**: Government cloud detection — endpoint ending in `.azure.us` switches Entra token scope to `https://cognitiveservices.azure.us/.default`. Logged once at startup.

### Cost service

- **MUST**: `priceSlice({ ..., provider: 'microsoft-foundry', deployment: 'eastus-prod-gpt-5-mini' })` reads `.forge/foundry-deployments.json` (or falls back to literal deployment name) to resolve the model key, then calls `getPricing(model)` as today.
- **MUST**: When `MODEL_PRICING[model]` exists with `aoai_deployment_type_multiplier` and `AZURE_OPENAI_DEPLOYMENT_TYPE` is set, the resolved cost is multiplied accordingly. Default `global` = 1.0× (no change). `data-zone` and `regional` = 1.1× per Microsoft published rate.
- **MUST**: `costForLeg()` is byte-identical to pre-execution. Verified by snapshot of the function body before/after.

### Quorum preset

- **MUST**: `power-gov` preset defined in the quorum-config registry. Threshold 5. Models: `gpt-5.1`, `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`, `gpt-4o`.
- **MUST**: `pforge run-plan --estimate --quorum=power-gov <plan>` succeeds without "unknown preset" error.
- **MUST**: Existing `auto`, `power`, `speed`, `false` presets are unchanged. Verified by a snapshot of their config blocks.

### Tests

- **MUST**: `pforge-mcp/tests/foundry-provider.test.mjs` covers:
  1. `KNOWN_SECRETS` includes the six new Azure entries
  2. Provider activation when `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` set
  3. API-key request shape (`api-key` header, NOT `Authorization`)
  4. Entra request shape — mocked `DefaultAzureCredential`, asserts `Authorization: Bearer` header
  5. Missing `@azure/identity` when `AZURE_AUTH_MODE=entra` produces a clear error message (no crash)
  6. `priceSlice` deployment-name normalization — known mapping resolves to canonical model key
  7. `priceSlice` literal-fallback when deployment is unknown — uses deployment name as model key
  8. `priceSlice` AOAI deployment-type multiplier — `data-zone` returns 1.1× cost vs. `global`
  9. `power-gov` preset shape
  10. Government cloud detection — `.azure.us` endpoint switches Entra scope
- **MUST**: Subscription-CLI regression — `priceSlice({ model: 'gh-copilot', premiumRequests: 5 })` produces $0.05 (unchanged).
- **MUST**: Existing tests pass: `tests/cost-service.test.mjs`, `tests/cost-service-token-coverage.test.mjs`, `tests/orchestrator.test.mjs`.

### Documentation

- **MUST**: `docs/integrations/byo-azure-openai.md` — config walkthrough: env vars, deployment-mapping file, API-key vs Entra, Government-cloud notes, link to `power-gov` preset.
- **MUST**: `docs/integrations/foundry-toolbox-mcp.md` — `.vscode/mcp.json` example with Foundry Toolbox `server_url` + Custom Keys Bearer token. Notes the per-call MCP approval friction (§11.8 #4).
- **MUST**: `docs/observability/foundry-app-insights.md` — config example for Phase 2's OTel exporter pointing at customer's App Insights connection string. Notes that Microsoft + Cisco Outshift's multi-agent OTel semantic conventions (`execute_task`, `agent_to_agent_interaction`) align with Plan Forge's existing emission per §11.5.C.
- **MUST**: `CHANGELOG.md` `[Unreleased]` entry under "### Phase-FOUNDRY-PROVIDER — Microsoft Foundry / Azure OpenAI provider".

---

## Execution Slices

8 slices, sequential.

### Slice 1: Add Azure secrets to KNOWN_SECRETS [sequential]

**Goal**: Six new entries in `KNOWN_SECRETS` array. `redactSecrets` automatically covers them via the array iteration.

**Files**:
- `pforge-mcp/secrets.mjs`

**Validation Gate**:
```bash
bash -c "grep -q 'AZURE_OPENAI_API_KEY' pforge-mcp/secrets.mjs && grep -q 'AZURE_OPENAI_ENDPOINT' pforge-mcp/secrets.mjs && grep -q 'AZURE_OPENAI_DEPLOYMENT' pforge-mcp/secrets.mjs && grep -q 'AZURE_TENANT_ID' pforge-mcp/secrets.mjs && grep -q 'AZURE_CLIENT_ID' pforge-mcp/secrets.mjs && grep -q 'AZURE_OPENAI_API_VERSION' pforge-mcp/secrets.mjs && echo ok"
```

---

### Slice 2: Add `microsoft-foundry` provider entry to dispatch table [sequential]

**Goal**: New provider entry alongside existing Anthropic/OpenAI/xAI in `orchestrator.mjs:1925-2000`. Two auth modes; URL composition.

**Files**:
- `pforge-mcp/orchestrator.mjs` (provider dispatch only)

**Depends On**: Slice 1

**Validation Gate**:
```bash
bash -c "grep -q 'microsoft-foundry' pforge-mcp/orchestrator.mjs && echo ok"
```

---

### Slice 3: Entra auth path with optional `@azure/identity` dep [sequential]

**Goal**: When `AZURE_AUTH_MODE=entra`, dynamic-import `@azure/identity`, build `DefaultAzureCredential`, fetch bearer token. Government-cloud heuristic on endpoint domain.

**Files**:
- `pforge-mcp/orchestrator.mjs` (auth helper alongside provider dispatch)
- `pforge-mcp/package.json` (add `@azure/identity` to `optionalDependencies`)

**Depends On**: Slice 2

**Validation Gate**:
```bash
bash -c "grep -q '@azure/identity' pforge-mcp/package.json && grep -q 'AZURE_AUTH_MODE' pforge-mcp/orchestrator.mjs && echo ok"
```

---

### Slice 4: Deployment-name normalization in `priceSlice()` [sequential]

**Goal**: When `provider === 'microsoft-foundry'`, resolve `deployment` to canonical model key via `.forge/foundry-deployments.json` (or literal fallback), then call `getPricing(model)` as today.

**Files**:
- `pforge-mcp/cost-service.mjs` (priceSlice only — no rate changes)

**Depends On**: Slice 3

**Validation Gate**:
```bash
bash -c "grep -q 'microsoft-foundry' pforge-mcp/cost-service.mjs && grep -q 'foundry-deployments.json' pforge-mcp/cost-service.mjs && echo ok"
```

---

### Slice 5: AOAI deployment-type multiplier in MODEL_PRICING + priceSlice [sequential]

**Goal**: New optional field `aoai_deployment_type_multiplier` on entries operators care about (default global = 1.0×). `priceSlice()` reads `AZURE_OPENAI_DEPLOYMENT_TYPE` env var; applies multiplier.

**Files**:
- `pforge-mcp/cost-service.mjs` (MODEL_PRICING entries for the AOAI-relevant models + priceSlice multiplier application)

**Depends On**: Slice 4

**Validation Gate**:
```bash
bash -c "grep -q 'aoai_deployment_type_multiplier' pforge-mcp/cost-service.mjs && grep -q 'AZURE_OPENAI_DEPLOYMENT_TYPE' pforge-mcp/cost-service.mjs && echo ok"
```

---

### Slice 6: `power-gov` quorum preset [sequential]

**Goal**: Register `power-gov` preset in the quorum-config registry. Threshold 5; Azure Gov catalog.

**Files**:
- `pforge-mcp/crucible-config.mjs` (or whichever file holds the quorum-preset registry — Slice 6 includes a small `grep` in execution to locate the exact file if not at the obvious path)

**Depends On**: Slice 5

**Validation Gate**:
```bash
bash -c "grep -rq 'power-gov' pforge-mcp/ --include='*.mjs' && echo ok"
```

---

### Slice 7: New test file foundry-provider.test.mjs [sequential]

**Goal**: Ten test cases per Acceptance Criteria.

**Files**:
- `pforge-mcp/tests/foundry-provider.test.mjs` (new)

**Depends On**: Slice 6

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/foundry-provider.test.mjs --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*1 passed' && echo ok"
```

---

### Slice 8: Three docs + CHANGELOG [sequential]

**Goal**: Three new docs under `docs/integrations/` and `docs/observability/`, plus CHANGELOG entry.

**Files**:
- `docs/integrations/byo-azure-openai.md` (new)
- `docs/integrations/foundry-toolbox-mcp.md` (new)
- `docs/observability/foundry-app-insights.md` (new)
- `CHANGELOG.md`

**Depends On**: Slice 7

**Validation Gate**:
```bash
bash -c "test -f docs/integrations/byo-azure-openai.md && test -f docs/integrations/foundry-toolbox-mcp.md && test -f docs/observability/foundry-app-insights.md && grep -q 'Phase-FOUNDRY-PROVIDER' CHANGELOG.md && echo ok"
```

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
| `pforge-mcp/secrets.mjs` | 1 |
| `pforge-mcp/orchestrator.mjs` | 2, 3 |
| `pforge-mcp/package.json` | 3 |
| `pforge-mcp/cost-service.mjs` | 4, 5 |
| `pforge-mcp/crucible-config.mjs` (or quorum-preset registry) | 6 |
| `pforge-mcp/tests/foundry-provider.test.mjs` | 7 (new) |
| `docs/integrations/byo-azure-openai.md` | 8 (new) |
| `docs/integrations/foundry-toolbox-mcp.md` | 8 (new) |
| `docs/observability/foundry-app-insights.md` | 8 (new) |
| `CHANGELOG.md` | 8 |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `@azure/identity` adds significant install size | Optional dep — only loaded when `AZURE_AUTH_MODE=entra`. Default API-key path doesn't pull it. |
| Operator's deployment name doesn't match any `MODEL_PRICING` key | Literal-fallback in Slice 4 + `.forge/foundry-deployments.json` mapping override. Logged warning when fallback fires. |
| `power-gov` model list changes as MS updates Azure Gov catalog | Treat preset as a starting template; document in `byo-azure-openai.md` that operators can override via local config. Lower-frequency than catalog churn anyway. |
| Government cloud detection misfires on hybrid endpoints | Heuristic is opt-out via explicit `AZURE_AUTH_AUTHORITY` env var override. |
| Cost reports double-count when same model reachable via multiple providers | Documented as a known friction point per §11.8 #1; future phase (cost-attribution-rework) handles dedup. Out of scope here. |
| AOAI deployment-type multiplier wrong for a region | Multiplier is per-vendor-published rate; default global 1.0× means no surprise for the common case. Operator opts in via env var. |
| Foundry Agent Service approval-loop friction (§11.8 #4) | Documented in `foundry-toolbox-mcp.md`; not a code change. |
