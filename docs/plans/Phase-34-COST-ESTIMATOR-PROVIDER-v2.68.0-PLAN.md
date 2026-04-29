---
phase: 34
version: 2.68.0
crucibleId: imported-meta-bug-120
lane: bug-fix
source: github-issues
linkedBugs: [120]
manualImport: true
manualImportSource: meta-bug-roadmap
manualImportReason: Cost estimator overshoots actual gh-copilot spend by ~250x because estimatePlan() applies token-based API pricing even when the orchestrator routes through a subscription CLI. Behavior-changing fix → minor bump.
model: claude-sonnet-4.6
---

# Phase-34 — Cost Estimator Provider Awareness (v2.68.0)

## Goal

Fix bug #120 — cost estimator is ~250x high when the active backend is a subscription CLI (gh-copilot, claude CLI, codex CLI). Match the runtime cost path: when the resolved worker is a subscription CLI, estimate from premium-request count, not per-token API pricing.

## Forbidden Actions

- Do not change `MODEL_PRICING` rates.
- Do not change `priceSlice` semantics for actual run-time costing — only the **estimate** path needs to learn provider awareness.
- Do not auto-detect by spawning external commands during estimation (must be config / env / pricing-table-based, not a shell probe).
- Do not silently change estimate output shape — keep all existing fields, add new ones.

## Acceptance Criteria

### Criteria for Slice 1 — detectCostModel + subscription pricing branch

- New exported function `detectCostModel({ env, forgeConfig, model })` in `pforge-mcp/cost-service.mjs` returns `{ provider, perRequestUsd, source }` where:
  - `provider` is one of `"gh-copilot" | "claude-cli" | "codex-cli" | "anthropic-api" | "openai-api" | "xai-api" | "unknown"`.
  - `source` describes how it was determined: `"env:PFORGE_COST_MODEL"`, `"forge.json:cost.model"`, `"model-prefix"`, `"default"`.
  - Precedence: `env.PFORGE_COST_MODEL` → `forgeConfig.cost?.model` → model-name heuristic (e.g., `claude-sonnet-4.6` without API key configured ⇒ `"claude-cli"`; `grok-4` ⇒ `"xai-api"`; `gpt-*` ⇒ `"openai-api"`) → `"unknown"`.
  - Returned `perRequestUsd` is `0.01` for the three CLI providers and `0` for `"unknown"`. API providers return `null` (signaling token-based pricing).
- New constant `SUBSCRIPTION_PROVIDERS = new Set(["gh-copilot", "claude-cli", "codex-cli"])` exported alongside.
- Unit test `pforge-mcp/tests/detect-cost-model.test.js` covers all four precedence sources and at least one each of CLI / API / unknown.
- Validation gate: `npx vitest run pforge-mcp/tests/detect-cost-model.test.js --reporter=basic`.

### Criteria for Slice 2 — estimatePlan honors subscription pricing

- `estimatePlan` (in `pforge-mcp/cost-service.mjs`) calls `detectCostModel` once at the top using `process.env`, the loaded `.forge.json`, and the passed `model`.
- When `provider` ∈ `SUBSCRIPTION_PROVIDERS`:
  - `estimatedCost = sliceCount * estimatedPremiumRequestsPerSlice * perRequestUsd`, where `estimatedPremiumRequestsPerSlice` defaults to `1.5` but reads from `.forge/cost-history.json` (mean `premiumRequests` across history when available, clamped `[0.5, 5.0]`).
  - History calibration block runs against premium-request data instead of token data.
  - The returned estimate object adds two new fields: `provider` (string) and `pricingMode` (`"subscription" | "token"`).
- When `provider` is API-based or `"unknown"`, behavior is unchanged (token math, existing calibration).
- Test `pforge-mcp/tests/estimate-plan-provider.test.js` proves: (a) gh-copilot estimate for a 6-slice plan is `< $1`, (b) anthropic-api estimate for the same plan is `> $5` (uses existing token pricing), (c) returned object includes `provider` and `pricingMode`.
- Validation gate: `npx vitest run pforge-mcp/tests/estimate-plan-provider.test.js --reporter=basic`.

### Criteria for Slice 3 — Release v2.68.0

- `pforge-mcp/package.json` and `package.json` versions bumped to `2.68.0`.
- `CHANGELOG.md` has a new `## 2.68.0` section listing `feat(cost): provider-aware estimator (#120) — gh-copilot / claude-cli / codex-cli now estimated from premium-request count instead of token math, eliminating ~250x overestimation`.
- A git tag `v2.68.0` is created on the resulting commit.
- Validation gate: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.68.0'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.68.0')){process.exit(1)}"`.

## Slice Plan

### Slice 1 — detectCostModel + subscription pricing branch

- In `pforge-mcp/cost-service.mjs`, add the `SUBSCRIPTION_PROVIDERS` Set and the `detectCostModel({ env, forgeConfig, model })` function.
- Precedence:
  1. `env.PFORGE_COST_MODEL` → if matches a known provider, use it.
  2. `forgeConfig?.cost?.model` → same.
  3. Model-name heuristic:
     - `model` starting with `gpt-` → `"openai-api"`
     - `model` starting with `grok-` → `"xai-api"`
     - `model` starting with `claude-` and `env.ANTHROPIC_API_KEY` truthy → `"anthropic-api"`
     - `model` starting with `claude-` without API key → `"claude-cli"`
     - `model === "gh-copilot"` or `model?.includes("copilot")` → `"gh-copilot"`
     - else → `"unknown"`
  4. `perRequestUsd` lookup: gh-copilot/claude-cli/codex-cli → `0.01`; unknown → `0`; APIs → `null`.
- Tests in `pforge-mcp/tests/detect-cost-model.test.js`:
  - env override wins over forge.json.
  - forge.json wins over heuristic.
  - heuristic distinguishes claude-cli (no key) vs anthropic-api (key set).
  - unknown model returns provider `"unknown"`.
- Validation: `npx vitest run pforge-mcp/tests/detect-cost-model.test.js --reporter=basic`.

### Slice 2 — estimatePlan honors subscription pricing

- Edit `estimatePlan` (≈ line 162 in `pforge-mcp/cost-service.mjs`).
- Near the top of the function, after `effectiveSlices` is settled, load `.forge.json` (try/catch, default `{}`) and call `const costModel = detectCostModel({ env: process.env, forgeConfig, model });`.
- Branch the cost computation:
  ```
  if (SUBSCRIPTION_PROVIDERS.has(costModel.provider)) {
    // subscription path
    const reqPerSlice = avgPremiumPerSlice || 1.5;
    estimatedCost = sliceCount * reqPerSlice * costModel.perRequestUsd;
    // history calibration uses premiumRequests field
  } else {
    // existing token math (unchanged)
  }
  ```
- `avgPremiumPerSlice` from history: read `.forge/cost-history.json`, compute mean of entries' `total_premium_requests / sliceCount`, clamp to `[0.5, 5.0]`.
- Add `provider: costModel.provider` and `pricingMode: SUBSCRIPTION_PROVIDERS.has(costModel.provider) ? "subscription" : "token"` to the returned object.
- Tests in `pforge-mcp/tests/estimate-plan-provider.test.js`:
  - Build a fake plan with 6 trivial slices, dag.order = [1..6].
  - Case A: env `PFORGE_COST_MODEL=gh-copilot` → `estimate.estimated_cost_usd < 1.0`, `pricingMode === "subscription"`.
  - Case B: env unset, `model = "claude-sonnet-4.6"`, `ANTHROPIC_API_KEY=test` → `estimate.estimated_cost_usd > 5.0`, `pricingMode === "token"`.
  - Case C: returned object contains both `provider` and `pricingMode` keys.
- Validation: `npx vitest run pforge-mcp/tests/estimate-plan-provider.test.js --reporter=basic`.

### Slice 3 — Release v2.68.0

- Bump `pforge-mcp/package.json` and root `package.json` to `2.68.0`.
- Prepend `## 2.68.0` to `CHANGELOG.md`.
- Commit `chore(release): v2.68.0 — provider-aware cost estimator (#120)` and tag `v2.68.0`.
- Validation: `node -e "const p=require('./pforge-mcp/package.json'); if(p.version!=='2.68.0'){process.exit(1)}; const fs=require('fs'); if(!fs.readFileSync('CHANGELOG.md','utf8').includes('## 2.68.0')){process.exit(1)}"`.
