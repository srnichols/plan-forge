# Phase 2: Token Tracking + Cost Estimation

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 2
> **Status**: ✅ Complete
> **Feature Branch**: `feature/v2.0-cost-tracking`
> **Depends On**: Phase 1 (Orchestrator) ✅
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ (hardened) → Step 3 ✅ (executed)
> **Review Finding M1 Applied**: Slice 1 merged into Phase 1; Phase 2 starts at Slice 2

---

## Specification (Step 0)

### Problem Statement
Phase 1 logs token counts per slice, but the data is raw numbers in JSON files. Teams need to understand cost trends, predict future spend, and justify AI token budgets. This phase adds structured cost tracking, historical comparison, and pre-run estimation.

### Acceptance Criteria
- **MUST**: Token usage logged per slice with model name and cost calculation
- **MUST**: `summary.json` includes total cost breakdown by model
- **MUST**: `--estimate` uses historical data (if available) or heuristics for prediction
- **SHOULD**: Cost per model per month aggregated across runs
- **SHOULD**: `forge_cost_report` MCP tool returns cost summary for a project
- **MAY**: Integration with OpenBrain for cross-project cost trends

---

## Scope Contract

### In Scope
- `mcp/orchestrator.mjs` — enhance token capture from CLI output
- `.forge/runs/*/slice-N.json` — add `tokens_in`, `tokens_out`, `model`, `cost_usd`
- `.forge/runs/*/summary.json` — add cost breakdown section
- `.forge/cost-history.json` — aggregate cost data across runs
- `mcp/server.mjs` — add `forge_cost_report` MCP tool
- Cost calculation per model (known pricing tables)

### Out of Scope
- Dashboard visualization (Phase 4)
- Real-time cost streaming during execution
- Billing integration with cloud providers

### Forbidden Actions
- Do NOT modify Phase 1 orchestration flow
- Do NOT add external API calls for pricing (embed lookup table)

---

## Execution Slices

### Slice 1: Enhanced Token Capture (60 min — Claude)
**Goal**: Parse CLI worker output for token usage data

- Parse Copilot CLI / Claude CLI stderr for token counts
- Handle "unknown" gracefully when CLI doesn't report tokens
- Store in `slice-N.json`: `{ tokens_in, tokens_out, model, raw_output_bytes }`

**Validation Gates**:
- [ ] Token data captured from at least one CLI tool
- [ ] "Unknown" fallback works without errors

### Slice 2: Cost Calculation Engine (45 min — Codex/Auto)
**Goal**: Convert token counts to USD using embedded pricing table

- Pricing table: `{ "claude-opus-4.6": { in: 0.015, out: 0.075 }, "codex": { in: 0.003, out: 0.012 }, ... }`
- Calculate per-slice cost from tokens × rate
- Summary: total cost, cost by model, cost by slice
- Update `summary.json` with cost breakdown

**Validation Gates**:
- [ ] Cost calculation matches manual verification
- [ ] Summary JSON has cost breakdown

### Slice 3: Cost History Aggregation (45 min — Codex/Auto)
**Goal**: `.forge/cost-history.json` tracks costs across runs

- After each run: append entry to cost history
- Schema: `{ date, plan, slices, total_tokens, total_cost, by_model }`
- `forge_cost_report` MCP tool reads history and returns formatted summary
- Monthly aggregation for budget reporting

**Validation Gates**:
- [ ] History file grows across multiple runs
- [ ] MCP tool returns readable cost report

### Slice 4: Pre-Run Estimation Enhancement (30 min — Codex/Auto)
**Goal**: Use historical data for better `--estimate` predictions

- If cost history exists: estimate from avg tokens per slice per model
- If no history: heuristic from plan character count × multiplier
- Show confidence: "Estimated ~180K tokens (~$0.85) based on 3 prior runs"

**Validation Gates**:
- [ ] Estimation uses historical data when available
- [ ] Falls back to heuristic cleanly

### Slice 5: Documentation (30 min — Claude)
**Goal**: Update docs for cost tracking features

- CLI-GUIDE: document `--estimate` improvements
- README: mention cost tracking in MCP section
- CHANGELOG: add cost tracking entry

**Validation Gates**:
- [ ] All docs updated
- [ ] No orphaned references

---

## Definition of Done
- [ ] Token usage captured per slice with cost calculation
- [ ] Cost history aggregates across runs
- [ ] `forge_cost_report` MCP tool works
- [ ] Pre-run estimation uses historical data

## Stop Conditions
- If no CLI tool reports token counts → log raw output bytes as proxy, document limitation
