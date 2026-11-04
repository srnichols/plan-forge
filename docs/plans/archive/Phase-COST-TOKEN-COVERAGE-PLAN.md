# Phase-COST-TOKEN-COVERAGE: Cache, Reasoning, Service-Tier, and Stale-Rate Coverage (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code (`pforge-mcp/cost-service.mjs`, `pforge-master/src/providers/*.mjs`, `pforge-mcp/orchestrator.mjs`) + Tests + Docs
> **Estimated cost**: $1.50–$3.50 (10 slices, mostly small code + tests, no docs-heavy work)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: Surfaced by enterprise-fleet-readiness research §12 (audit by Explore subagent, 2026-05-06). Hardening sourced from two parallel audits on 2026-05-06: (1) authoritative vendor pricing research across Anthropic, OpenAI, xAI, and Azure OpenAI; (2) codebase file:line audit.
> **Hardener notes**: Original spec assumed a single OpenAI cache multiplier and did not distinguish base-rate staleness from token-class coverage. Vendor research revealed both: per-model cache multipliers AND substantial stale base rates (Opus 4.7 currently overpriced 3×, GPT-5.4 overpriced 2× on input). Plan expanded from 7 to 10 slices to cover both defects together; otherwise we'd ship the cache fix and immediately need a follow-up phase. Slice 10 documentation also clarifies which of Plan Forge's three cost paths (subscription CLI / direct API keys / Azure OpenAI) this fix actually touches — only paths 2 and 3; path 1 is unchanged.

---

## Scope Contract

### In Scope

- `pforge-mcp/cost-service.mjs` — `MODEL_PRICING` schema, `getPricing()`, `priceSlice()`, and the price-table data (no other exported functions touched)
- `pforge-master/src/providers/anthropic-tools.mjs` — `parseResponse()` only (extract cache + creation fields)
- `pforge-master/src/providers/openai-tools.mjs` — `parseResponse()` only (extract cached + reasoning + service_tier fields)
- `pforge-master/src/providers/xai-tools.mjs` — `parseResponse()` only (extract cached + reasoning + `cost_in_usd_ticks`)
- `pforge-mcp/orchestrator.mjs` — `extractTokens()` at line 2485 only (graceful no-op for CLI workers)
- `pforge-mcp/tests/cost-service.test.mjs` — extend with new test cases
- `pforge-mcp/tests/cost-service-token-coverage.test.mjs` — new file (token-class coverage tests)
- `pforge-mcp/tests/parseResponse-cache-fields.test.mjs` — new file (provider parseResponse extraction tests)
- `CHANGELOG.md` — new entry under next version
- `docs/research/enterprise-fleet-readiness.md` §12.5 — append fix-landed status block

### Out of Scope

- `costForLeg()` helper at `cost-service.mjs:309-318` — **explicitly forbidden**. This is the v2.83.0 quorum-cost-fix (~250× over-estimate fix for subscription users). Different defect class, orthogonal solution. Do not touch.
- `priceRun()` (cost-service.mjs:212), `estimatePlan()` (260), `buildQuorumConfigForMode()` (450), `estimateSlice()` (502), `estimateQuorum()` (598) — these consume `priceSlice()`'s output. They will benefit from the new `cost_breakdown` field automatically without code changes.
- `forge_cost_report` MCP tool handler (`pforge-mcp/server.mjs:2073`) — defer surfacing the breakdown to a follow-on phase; this phase's scope is the math, not the UI surface
- `getCostReport()` aggregation (`orchestrator.mjs:5083`) — same reason
- Embedding model pricing — separate concern
- Image / audio / video token pricing (DALL-E, Sora, Whisper) — separate model class
- Multi-tenant cost chargeback / per-engineer attribution — roadmap item
- Cost anomaly alerting / threshold enforcement — `forge_alert_triage` exists, integration with new breakdown is follow-on
- Vendor pricing API auto-refresh — keep manual; rates change rarely
- Backporting fix to historical `cost-history.json` entries — out of scope
- Streaming response token-counting audit — defer (not exercised heavily today)
- Azure OpenAI deployment-type uplift (+10% for Data Zone / Regional) — deferred to BYO-Azure-OpenAI phase per `docs/research/enterprise-fleet-readiness.md §11.5.A`. This phase prices direct OpenAI; AOAI deployment-name handling is the BYO-AOAI phase's concern.
- xAI per-model cached-rate table — xAI does not publish this. Approximate at 0.25× and trust `cost_in_usd_ticks` on reconciliation. Recording authoritative `cost_in_usd_ticks` is in scope; building a static xAI cache table is not.

### Forbidden Actions

- **Do NOT modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`.** The v2.83.0 fix protects subscription-CLI users from a ~250× over-estimate. Touching it risks regressing that path. Verified locked by audit.
- **Do NOT change the positional signature `priceSlice(tokens, worker)`.** New fields are additive members of the `tokens` object. Existing callers that construct `{ tokens_in, tokens_out, model, premiumRequests }` must continue to work without modification.
- **Do NOT add `reasoning_tokens` separately to billable output.** Per OpenAI and xAI docs, `reasoning_tokens` is **already counted inside** `output_tokens` / `completion_tokens`. Billing it on top double-counts. The field is informational only.
- **Do NOT subtract `cache_read_tokens` from Anthropic `input_tokens`.** Per Anthropic spec, `input_tokens` is "tokens after the last cache breakpoint" — it already excludes cached tokens. Subtracting double-counts in the cached direction.
- **DO subtract `cached_tokens` from OpenAI/xAI `prompt_tokens`** before billing the uncached portion. Per OpenAI and xAI specs, `prompt_tokens` INCLUDES `cached_tokens`. The two vendor conventions are mirror-opposite — getting this wrong ships a regression.
- **Do NOT add network calls to `priceSlice()` or `getPricing()`.** Pricing data stays in the static `MODEL_PRICING` table. Vendor SDK / fetch calls happen in provider modules.
- **Do NOT introduce a hard dependency on `@anthropic-ai/sdk` or `openai` npm packages.** Plan Forge uses `fetch()` to OpenAI-compatible endpoints; this stays.
- **Do NOT edit historical `.forge/cost-history.json` files.** New entries get the breakdown; old entries stay.
- **Do NOT publish a new release before all 10 slices pass + the existing `cost-service.test.mjs` regression guard is clean.**

---

## Required Decisions

All TBDs from the original spec are resolved below from the 2026-05-06 vendor research. Each row is now firm.

| # | Decision | Status | Resolution (with source) |
|---|---|---|---|
| 1 | Per-model cache multipliers | RESOLVED | OpenAI: per-family table — GPT-5.x = 0.10, GPT-4.1 / o3 / o4-mini = 0.25, o1 / o1-mini / GPT-4o = 0.50. Anthropic: 0.10 universal. xAI: ~0.25 placeholder, document that authoritative comes from `cost_in_usd_ticks`. ([OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Anthropic prompt caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching), [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)) |
| 2 | OpenAI flex multiplier | RESOLVED | 0.5× input AND 0.5× output, symmetric. Models supported: `gpt-5.5`, `gpt-5.4`. ([OpenAI flex processing](https://developers.openai.com/api/docs/guides/flex-processing)) |
| 3 | OpenAI priority multiplier | RESOLVED | 2.0× input, 1.5× output (asymmetric). Schema must store separately. (OpenAI pricing page) |
| 4 | Anthropic 5m vs 1h cache write distinction | RESOLVED | **Distinguishable from response.** `usage.cache_creation.ephemeral_5m_input_tokens` = 5min (× 1.25), `usage.cache_creation.ephemeral_1h_input_tokens` = 1hr (× 2.0). Bill each bucket at its own multiplier. (Anthropic prompt caching docs) |
| 5 | `prompt_tokens` semantics per vendor | RESOLVED | Anthropic: `input_tokens` EXCLUDES cached + creation. OpenAI: `prompt_tokens` INCLUDES `cached_tokens`. xAI: `prompt_tokens` and `text_tokens` INCLUDE `cached_tokens`. Code MUST handle both directions. |
| 6 | OpenAI cache write cost | RESOLVED | **Free.** Per [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) FAQ #4. No `cache_write_multiplier` field needed for OpenAI entries. |
| 7 | "Should we warn loudly when a model supports cache but the response lacks the field?" | RESOLVED — NO | Defer. Risk of noise outweighs benefit. Logged-INFO message only when `PFORGE_LOG_LEVEL=debug`. |
| 8 | Cost-report breakdown surfacing in `forge_cost_report` MCP tool | DEFERRED | Out of scope this phase. The `cost_breakdown` field flows through to `cost-history.json` entries; surfacing it in the MCP tool output is a UI concern for a follow-on phase. |
| 9 | Streaming response audit | DEFERRED | Not exercised heavily in current Plan Forge code paths. Address when streaming becomes default. |
| 10 | Stale base rates discovered in audit | NEW — RESOLVED | Vendor research found Opus 4.7 priced at $15/$75 in Plan Forge but published at $5/$25 (3× overestimate). GPT-5.4 priced at $5/$15 in Plan Forge but published at $2.50/$15 (2× overestimate on input). New Slice 2 added to refresh stale base rates against current vendor catalogs. |
| 11 | xAI May-15-2026 model retirement | NEW — RESOLVED | `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-4-0709`, `grok-code-fast-1`, `grok-3` retiring May 15, 2026. Add `grok-4.3` (current flagship). Mark retired entries with `_retiredAfter: "2026-05-15"` for a future cleanup phase. |
| 12 | Test command on Windows | RESOLVED | `bash -c "cd pforge-mcp && npx vitest run"` per Gate Portability Rules — `npx vitest` from project root picks up the wrong workspace. |

---

## Acceptance Criteria

Original spec's MUST/SHOULD/MAY restated with hardener-confirmed scope, plus new criteria for the stale-base-rate refresh discovered during hardening.

### Schema and pricing data

- **MUST**: `MODEL_PRICING` schema upgraded to support optional cache and tier multipliers. New entry shape:
  ```js
  {
    input: number,                          // base input rate per token, USD
    output: number,                         // base output rate per token, USD
    cache_read_multiplier?: number,         // default 1.0 if absent
    cache_write_5m_multiplier?: number,     // Anthropic: default 1.25; OpenAI/xAI: omit (writes free or unknown)
    cache_write_1h_multiplier?: number,     // Anthropic: default 2.0; others: omit
    flex_input_multiplier?: number,         // OpenAI: 0.5; default omit
    flex_output_multiplier?: number,        // OpenAI: 0.5; default omit
    priority_input_multiplier?: number,     // OpenAI: 2.0; default omit
    priority_output_multiplier?: number,    // OpenAI: 1.5; default omit
    _retiredAfter?: string,                 // ISO date for retiring models (informational)
    _source?: string,                       // doc URL of vendor pricing page
  }
  ```
  Existing `{ input, output }`-only entries continue to work via defaulting in `getPricing()`.

- **MUST**: `getPricing(model)` returns the full pricing object with multiplier defaults applied (1.0 for cache_read, 1.0 for cache_write, 1.0 for tier multipliers when omitted) so callers never receive an undefined.

- **MUST**: New model entries added to `MODEL_PRICING`:
  - `gpt-5.5` ($5 / $0.50 cached / $30, flex 0.5/0.5, priority 2.0/1.5)
  - `gpt-5.4` — **CORRECTED to $2.50 / $0.25 cached / $15** (was $5/$15, audit found 2× overestimate)
  - `gpt-5.4-mini` — corrected to $0.75 / $0.075 cached / $4.50 (was $0.40/$1.60)
  - `gpt-5.4-nano` ($0.20 / $0.02 cached / $1.25)
  - `gpt-5` ($1.25 / $0.125 cached / $10)
  - `gpt-5-mini` — corrected to $0.25 / $0.025 cached / $2 (was $0.40/$1.60)
  - `gpt-5-nano` ($0.05 / $0.005 cached / $0.40)
  - `gpt-5.3-codex` corrected to $1.75 / $0.175 cached / $14 (was $3/$12)
  - `gpt-5.2` corrected to $1.75 / $0.175 cached / $14 (was $2/$8)
  - `gpt-5.1` ($1.25 / $0.125 cached / $10)
  - `gpt-4.1` keeps $2 / $0.50 cached / $8 — verified correct
  - `o1` ($15 / $7.50 cached / $60)
  - `o1-mini` ($1.10 / $0.55 cached / $4.40)
  - `o3` ($2 / $0.50 cached / $8)
  - `o3-mini` ($1.10 / $0.55 cached / $4.40)
  - `o4-mini` ($1.10 / $0.275 cached / $4.40)
  - `gpt-4o` ($2.50 / $1.25 cached / $10)
  - `gpt-4o-mini` ($0.15 / $0.075 cached / $0.60)

- **MUST**: Anthropic models updated:
  - `claude-opus-4.7` — **CORRECTED to $5 / $25** (was $15/$75 — 3× overestimate). Add cache_read 0.10, cache_write_5m 1.25, cache_write_1h 2.0.
  - `claude-opus-4.6` — corrected to $5 / $25 (was $15/$75)
  - `claude-opus-4.5` — corrected to $5 / $25 (was $15/$75)
  - `claude-sonnet-4.6` — keeps $3 / $15. Add cache multipliers.
  - `claude-sonnet-4.5` — keeps $3 / $15. Add cache multipliers.
  - `claude-haiku-4.5` — corrected to $1 / $5 (was $0.80/$4). Add cache multipliers.

- **MUST**: xAI models updated:
  - Add `grok-4.3` ($1.25 / $2.50, cache_read_multiplier 0.25 placeholder)
  - Mark `grok-3`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `grok-4-0709` with `_retiredAfter: "2026-05-15"` for future cleanup
  - Add `cache_read_multiplier: 0.25` (approximate) to all current Grok entries with `_source` link to xAI prompt caching doc

- **MUST**: Each entry includes `_source` field with the vendor pricing URL (for future re-verification audits).

### Math (`priceSlice()`)

- **MUST**: `priceSlice(tokens, worker)` accepts new optional fields without breaking positional callers. New optional members of `tokens`:
  ```js
  {
    tokens_in: number,
    tokens_out: number,
    model: string,
    premiumRequests?: number,
    cache_read_tokens?: number,                    // NEW
    cache_creation_5m_tokens?: number,             // NEW (Anthropic 5m cache write)
    cache_creation_1h_tokens?: number,             // NEW (Anthropic 1h cache write)
    cache_creation_input_tokens?: number,          // NEW (Anthropic combined; if 5m+1h not split)
    reasoning_tokens?: number,                     // NEW (informational; already counted in tokens_out)
    service_tier?: 'standard'|'flex'|'priority'|'default'|null,  // NEW (OpenAI)
    cost_in_usd_ticks?: number,                    // NEW (xAI authoritative; if present, override computed cost)
    vendor?: 'anthropic'|'openai'|'xai'|'azure-openai'|'unknown', // NEW (disambiguates prompt_tokens semantics)
  }
  ```

- **MUST**: `priceSlice()` correctly applies multipliers per vendor convention:
  - **Anthropic** (`vendor === 'anthropic'`): `tokens_in` is uncached input. Bill: `tokens_in * input_rate + cache_read_tokens * input_rate * cache_read_multiplier + cache_creation_5m_tokens * input_rate * 1.25 + cache_creation_1h_tokens * input_rate * 2.0 + tokens_out * output_rate`. If `cache_creation_input_tokens` is set but the 5m/1h split is not, default the entire amount to 5m rate (1.25) and emit a debug log line.
  - **OpenAI** (`vendor === 'openai'`): `tokens_in` INCLUDES `cache_read_tokens`. Bill: `(tokens_in - cache_read_tokens) * input_rate * tier_input_multiplier + cache_read_tokens * input_rate * cache_read_multiplier * tier_input_multiplier + tokens_out * output_rate * tier_output_multiplier`. `tier_*_multiplier` derived from `service_tier`.
  - **xAI** (`vendor === 'xai'`): If `cost_in_usd_ticks` is present, use it directly: `cost_usd = cost_in_usd_ticks * 1e-10`, skip computed math entirely. Otherwise: same as OpenAI (subtract cached from input, apply ~0.25 multiplier).
  - **Unknown / legacy** (`vendor` absent): Existing behavior — `tokens_in * input_rate + tokens_out * output_rate`. Backward-compatible no-op for callers that haven't been updated.

- **MUST**: `priceSlice()` does NOT add `reasoning_tokens` separately to output. `tokens_out` already includes them per vendor spec. `reasoning_tokens` is captured for the breakdown only.

- **MUST**: `priceSlice()` returns the existing shape PLUS a new `cost_breakdown` field:
  ```js
  {
    cost_usd: number,                    // unchanged — sum of all components
    model: string,                       // unchanged
    tokens_in: number,                   // unchanged (vendor-original value, not adjusted)
    tokens_out: number,                  // unchanged
    cost_breakdown: {                    // NEW
      input_uncached: number,            // USD billable for uncached input
      input_cache_read: number,          // USD billable for cache reads
      input_cache_write_5m: number,      // USD billable for 5m cache writes (Anthropic)
      input_cache_write_1h: number,      // USD billable for 1h cache writes (Anthropic)
      output_total: number,              // USD billable for all output (visible + reasoning)
      reasoning_tokens: number,          // informational; subset of tokens_out
      tier_adjustment: number,           // delta vs. standard tier (negative for flex savings, positive for priority)
      authoritative_source?: 'cost_in_usd_ticks',  // present when xAI cost was used directly
    }
  }
  ```
  Sum of all `cost_breakdown` USD fields equals `cost_usd` (within rounding to 6 decimal places).

- **MUST**: All cost values rounded to 6 decimal places (matches existing convention at `cost-service.mjs:200`).

### Provider extraction (parseResponse)

- **MUST**: `pforge-master/src/providers/anthropic-tools.mjs` `parseResponse()` extracts:
  - `usage.input_tokens` → `tokensIn` (existing)
  - `usage.output_tokens` → `tokensOut` (existing)
  - `usage.cache_read_input_tokens` → new field `cacheReadTokens` (default 0 if absent)
  - `usage.cache_creation_input_tokens` → new field `cacheCreationInputTokens` (default 0)
  - `usage.cache_creation.ephemeral_5m_input_tokens` → new field `cacheCreation5mTokens` (default 0)
  - `usage.cache_creation.ephemeral_1h_input_tokens` → new field `cacheCreation1hTokens` (default 0)
  - Sets `vendor: 'anthropic'` on the returned object

- **MUST**: `pforge-master/src/providers/openai-tools.mjs` `parseResponse()` extracts:
  - `usage.prompt_tokens` → `tokensIn` (existing)
  - `usage.completion_tokens` → `tokensOut` (existing)
  - `usage.prompt_tokens_details.cached_tokens` (Chat Completions) OR `usage.input_tokens_details.cached_tokens` (Responses API) → `cacheReadTokens` (default 0)
  - `usage.completion_tokens_details.reasoning_tokens` (Chat Completions) OR `usage.output_tokens_details.reasoning_tokens` (Responses API) → `reasoningTokens` (default 0)
  - `data.service_tier` → `serviceTier` (default null)
  - Sets `vendor: 'openai'` on the returned object

- **MUST**: `pforge-master/src/providers/xai-tools.mjs` `parseResponse()` extracts:
  - All OpenAI fields above (same shape, xAI is OpenAI-compatible)
  - `usage.cost_in_usd_ticks` (when present) → `costInUsdTicks` (authoritative billed amount, 1 tick = 1e-10 USD)
  - Sets `vendor: 'xai'` on the returned object

- **MUST**: All three `parseResponse()` functions remain backward-compatible: existing callers reading `tokensIn`, `tokensOut`, `content`, `toolCalls`, `type` see no behavior change. New fields are additive.

- **MUST**: `pforge-mcp/orchestrator.mjs` `extractTokens()` at line 2485 — graceful no-op for CLI workers. CLI workers (`gh-copilot`, `claude-cli`, `codex-cli`) do not surface cache or reasoning tokens. The function returns existing fields plus `vendor: 'unknown'` so `priceSlice()` falls through to legacy math.

### Tests

- **MUST**: New test file `pforge-mcp/tests/cost-service-token-coverage.test.mjs` covers all four token classes with at least these 12 cases:
  1. **Anthropic Opus with `cache_read_tokens` only** — verify 0.10× rate, breakdown `input_cache_read` populated
  2. **Anthropic Opus with `cache_creation_5m_tokens` only** — verify 1.25× rate, breakdown `input_cache_write_5m` populated
  3. **Anthropic Opus with `cache_creation_1h_tokens` only** — verify 2.0× rate, breakdown `input_cache_write_1h` populated
  4. **Anthropic Opus with `cache_creation_input_tokens` (combined)** — verify defaults to 5m rate, debug log emitted
  5. **Anthropic Opus combined**: cache_read + cache_creation_5m + tokens_out — verify breakdown sums to `cost_usd`
  6. **OpenAI o3 with `reasoning_tokens`** — verify reasoning is in `cost_breakdown.reasoning_tokens` informational; `output_total` billed at output rate using `tokens_out` only (NOT double-counted)
  7. **OpenAI gpt-5.5 with `cache_read_tokens`** — verify 0.10× rate (per-model multiplier from table), AND verify `tokens_in - cache_read_tokens` for the uncached portion (mirror-opposite of Anthropic)
  8. **OpenAI o1 with `cache_read_tokens`** — verify 0.50× rate (different from gpt-5.5)
  9. **OpenAI gpt-5.4 with `service_tier='flex'`** — verify 0.5× input AND 0.5× output applied
  10. **OpenAI gpt-5.4 with `service_tier='priority'`** — verify 2.0× input, 1.5× output (asymmetric)
  11. **xAI grok-4.3 with `cost_in_usd_ticks`** — verify computed cost is bypassed; `cost_usd = ticks * 1e-10`; breakdown carries `authoritative_source: 'cost_in_usd_ticks'`
  12. **xAI grok-4.3 without `cost_in_usd_ticks`** — verify falls back to multiplier math (0.25× cache approximation)

- **MUST**: New test file `pforge-mcp/tests/parseResponse-cache-fields.test.mjs` covers the three provider `parseResponse()` extractions. Use representative API response fixtures from each vendor (drawn from the vendor docs cited in §Required Decisions). At minimum:
  1. Anthropic response with `cache_creation.ephemeral_5m_input_tokens` and `cache_read_input_tokens` present
  2. Anthropic response with only `cache_creation_input_tokens` (no breakdown)
  3. OpenAI Chat Completions response with `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`
  4. OpenAI Responses API response with `input_tokens_details.cached_tokens`
  5. OpenAI response with `service_tier: 'flex'`
  6. xAI response with `cost_in_usd_ticks`

- **MUST**: Subscription-CLI worker regression test — `priceSlice({ model: 'gh-copilot', premiumRequests: 5, vendor: undefined })` produces identical cost to today (5 × $0.01 = $0.05). NO regression on the v2.83.0 fix audience.

- **MUST**: Backward compatibility test — `priceSlice({ tokens_in: 1000, tokens_out: 500, model: 'claude-sonnet-4.6' })` (no `vendor`, no new fields) produces a `cost_usd` that uses **the corrected pricing table** (Slice 2 changes apply globally). The numeric value will differ from the current behavior because base rates were stale. This is intended behavior; test asserts the new correct value.

- **MUST**: Test file `pforge-mcp/tests/cost-service-token-coverage.test.mjs` achieves ≥ 90% line coverage of changed paths in `priceSlice()` and `getPricing()`.

- **MUST**: Existing test file `pforge-mcp/tests/cost-service.test.mjs` continues to pass after Slices 2–4. Some existing tests will need rate-adjustment to match the corrected `MODEL_PRICING` table — see Slice 2 for explicit guidance.

- **MUST**: Existing test file `pforge-mcp/tests/cost-service-real-plans.test.mjs` continues to pass (smoke matrix across all `Phase-*-PLAN.md` files for all four quorum modes).

### Documentation

- **MUST**: `CHANGELOG.md` gains a new entry under the next version (Hardener defers exact version bump to release time per `version.instructions.md`):
  ```
  ## [X.Y.Z] — 2026-MM-DD — Cost-Service Token Coverage

  ### Fixed
  - Added accounting for cache_read, cache_creation (5m + 1h split for Anthropic), reasoning_tokens, and service_tier (flex/priority).
    Resolves 30–80% cost underestimate on Anthropic + OpenAI workloads with prompt caching or extended thinking.
    See docs/research/enterprise-fleet-readiness.md §12 for the audit.
  - Refreshed stale base rates in MODEL_PRICING:
    * Claude Opus 4.5/4.6/4.7 corrected from $15/$75 to $5/$25 (3× overestimate)
    * GPT-5.4 input corrected from $5 to $2.50 (2× overestimate)
    * GPT-5.4-mini, GPT-5.3-codex, GPT-5.2, Claude Haiku 4.5 corrected to current vendor-published rates
  - Added missing models: gpt-5.5, gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.4-nano, gpt-5.1, o1, o1-mini, o3, o3-mini, o4-mini, gpt-4o, gpt-4o-mini, grok-4.3
  - Marked grok-3, grok-4-0709, grok-4-1-fast-* with _retiredAfter: 2026-05-15 (xAI retirement notice)

  ### Added
  - Per-vendor token-class breakdown in priceSlice() return shape (cost_breakdown field)
  - parseResponse() in anthropic-tools, openai-tools, xai-tools now extracts cache + reasoning + service_tier + cost_in_usd_ticks

  ### Notes
  Plan Forge bills via three distinct paths depending on the worker configuration:
    1. **Subscription CLI workers** (gh-copilot, claude-cli, codex-cli) bill via the v2.83.0
       premium-request path (CLI_PER_REQUEST_USD × premiumRequests). This fix does NOT affect
       this path — GitHub Copilot, Claude Code, and Codex CLI users see no cost-report change.
    2. **Direct vendor API keys** (ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY in
       .forge/secrets.json or env) bill per-token at vendor rates. This fix corrects both the
       missing token classes AND the stale base rates for this path.
    3. **Azure OpenAI in customer tenant** bills per-token via AOAI rates. This fix applies the
       cache + reasoning fields uniformly; the AOAI deployment-type uplift (+10% for Data Zone /
       Regional vs. Global) is deferred to the BYO-Azure-OpenAI phase.
  ```

- **MUST**: `docs/research/enterprise-fleet-readiness.md` §12 gains a "FIX LANDED" status block (append, do not edit prior text). Format:
  ```
  ### 12.6 Status: FIXED in Phase-COST-TOKEN-COVERAGE (commit <SHA>, 2026-MM-DD)

  Defect resolved. Audit re-run: priceSlice() now correctly accounts for all four token classes.
  See docs/plans/Phase-COST-TOKEN-COVERAGE-PLAN.md for the executed plan.
  Hardening also surfaced and corrected stale base rates (Opus 3× overestimate, GPT-5.4 2× overestimate);
  combined effect: cost reports for Anthropic-Opus + OpenAI-with-caching workloads now match vendor invoices within ~5%.

  **Scope clarification by cost path:**
  - Subscription CLI workers (gh-copilot, claude-cli, codex-cli): unchanged. These bill via the
    v2.83.0 premium-request path; this fix does not touch that code path.
  - Direct vendor API keys (Anthropic, OpenAI, xAI): full benefit from both the missing token
    classes and the stale-base-rate corrections.
  - Azure OpenAI: cache + reasoning + service_tier fields apply; AOAI deployment-type uplift
    (+10% for Data Zone / Regional) deferred to the BYO-Azure-OpenAI phase per §11.5.A.
  ```

- **SHOULD**: `pforge-mcp/scripts/cost-coverage-bench.mjs` exists. Reads `.forge/cost-history.json`, recomputes cost under new pricing + token coverage, prints "old cost vs. new cost" delta. Useful for the changelog narrative and for users who want to back-calculate historical underspend. Not required for fix correctness.

### MAY (defer if Hardener cuts during execution)

- **MAY**: `forge_cost_report` MCP tool gains `--detailed` flag surfacing the breakdown — moved to OUT OF SCOPE; defer to UI follow-on
- **MAY**: `forge_cost_report --reconcile <vendor-invoice.json>` mode — defer to follow-on
- **MAY**: Streaming response audit — defer

---

## Execution Slices

10 slices, all small. Sequencing optimized to minimize regression surface.

### Slice 1: Schema upgrade in MODEL_PRICING + getPricing() defaulting [sequential]

**Goal**: Land the `MODEL_PRICING` schema with optional cache + tier multiplier fields, plus default-application in `getPricing()`. Backward-compatible: existing `{ input, output }`-only entries continue to work.

**Files**:
- `pforge-mcp/cost-service.mjs` (lines 21–79 only)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**What changes**:
- Update JSDoc on `MODEL_PRICING` to describe the new optional fields
- Modify `getPricing()` to spread defaults: `{ cache_read_multiplier: 1.0, cache_write_5m_multiplier: 1.0, cache_write_1h_multiplier: 1.0, flex_input_multiplier: 1.0, flex_output_multiplier: 1.0, priority_input_multiplier: 1.0, priority_output_multiplier: 1.0, ...MODEL_PRICING[model] || MODEL_PRICING.default }`
- Do NOT touch any pricing values in this slice — that's Slice 2

**Validation Gate**:
```bash
node -e "import('./pforge-mcp/cost-service.mjs').then(m=>{const p=m.getPricing('claude-sonnet-4.6');if(typeof p.cache_read_multiplier!=='number')process.exit(1);if(p.cache_read_multiplier!==1.0)process.exit(2);if(typeof p.flex_input_multiplier!=='number')process.exit(3);console.log('ok')})"
```

---

### Slice 2: Refresh stale base rates + add missing models + cache multipliers [sequential]

**Goal**: Update `MODEL_PRICING` table with current vendor-published rates and per-model cache multipliers. This is the slice where the 3× Opus overestimate and 2× GPT-5.4 overestimate get corrected.

**Files**:
- `pforge-mcp/cost-service.mjs` (lines 21–72: `MODEL_PRICING` table only)

**Depends On**: Slice 1

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- (vendor URLs cited inline in `_source` fields)

**What changes**:
- Replace existing Anthropic entries with corrected rates + cache multipliers (per Required Decision 1 and Acceptance Criterion §Schema)
- Replace existing OpenAI entries with corrected rates + per-model cache multipliers + flex/priority multipliers (where supported)
- Add all new model entries (gpt-5.5, gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.4-nano, gpt-5.1, o1, o1-mini, o3, o3-mini, o4-mini, gpt-4o, gpt-4o-mini)
- Add `grok-4.3`; mark retired Grok models with `_retiredAfter`
- Add `_source` field to every entry pointing at the vendor pricing URL

**Note for executor**: Some existing tests in `cost-service.test.mjs` assert specific dollar amounts using the OLD (stale) rates. Those tests will fail and MUST be updated to the new rates as part of this slice (not as a workaround — as a deliberate correction). When updating, prefer assertions on relative amounts (e.g., "power mode > speed mode") over absolute dollar values where possible. Where absolute values are necessary, recompute against the corrected `MODEL_PRICING`.

**Validation Gate**:
```bash
node -e "import('./pforge-mcp/cost-service.mjs').then(m=>{const opus=m.getPricing('claude-opus-4.7');if(opus.input!==5/1000000)process.exit(1);if(opus.output!==25/1000000)process.exit(2);if(opus.cache_read_multiplier!==0.1)process.exit(3);const gpt55=m.getPricing('gpt-5.5');if(gpt55.input!==5/1000000)process.exit(4);if(gpt55.cache_read_multiplier!==0.1)process.exit(5);const o1=m.getPricing('o1');if(o1.cache_read_multiplier!==0.5)process.exit(6);console.log('ok')})"
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

### Slice 3: priceSlice() extension with vendor-aware math and cost_breakdown [sequential]

**Goal**: Core math change. `priceSlice()` accepts new optional fields, applies vendor-specific math correctly (mirror-opposite Anthropic vs OpenAI conventions), returns the new `cost_breakdown` structure.

**Files**:
- `pforge-mcp/cost-service.mjs` (lines 180–204: `priceSlice()` only)

**Depends On**: Slices 1, 2

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`
- (Acceptance Criterion §Math has the per-vendor billing rules — most-relevant context)

**What changes**:
- Extend `priceSlice()` to read new `tokens` fields with safe defaults
- Branch on `tokens.vendor`: `'anthropic'`, `'openai'`, `'xai'`, or `unknown` (legacy)
- Apply vendor-correct math per Acceptance Criterion §Math
- xAI path checks for `cost_in_usd_ticks` first; if present, skip computed math
- Reasoning tokens go into `cost_breakdown.reasoning_tokens` informationally; NOT added to billable output
- Build and return the `cost_breakdown` object
- Sum check: `cost_usd === sum(cost_breakdown.usd_fields)` within rounding tolerance

**Forbidden in this slice**: Do not modify `priceRun()`, `estimatePlan()`, or any other function. They consume `priceSlice()`'s output and pick up the breakdown automatically (the existing `cost_usd` field they read is unchanged).

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

### Slice 4: New test suite cost-service-token-coverage.test.mjs [parallel-safe Group A]

**Goal**: Comprehensive test coverage for all four token classes per Acceptance Criterion §Tests (12 cases enumerated).

**Files**:
- `pforge-mcp/tests/cost-service-token-coverage.test.mjs` (NEW file)

**Depends On**: Slice 3

**Context Files**:
- `.github/instructions/testing.instructions.md`
- `pforge-mcp/tests/cost-service.test.mjs` (read-only, for fixture-builder pattern reuse)

**What changes**:
- Create new test file
- Implement all 12 test cases enumerated in Acceptance Criterion §Tests
- Reuse fixture pattern from existing `cost-service.test.mjs` where applicable
- Each test case includes: setup (build `tokens` object), action (call `priceSlice()`), assertion (cost_usd value AND cost_breakdown shape)
- Include the subscription-CLI regression test (Anthropic-OpenAI mirror-opposite is the key correctness invariant; this guards backward compatibility)

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/cost-service-token-coverage.test.mjs"
```

---

### Slice 5: Anthropic parseResponse extraction [parallel-safe Group A]

**Goal**: Extract Anthropic cache + creation fields in `parseResponse()`. Backward-compatible: existing callers see no change.

**Files**:
- `pforge-master/src/providers/anthropic-tools.mjs` (lines 95–107: `parseResponse()` only)

**Depends On**: (none — independent of cost-service work; can run parallel to Slice 4)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**What changes**:
- Extend `parseResponse()` to read: `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_creation.ephemeral_5m_input_tokens`, `usage.cache_creation.ephemeral_1h_input_tokens`
- Add fields `cacheReadTokens`, `cacheCreationInputTokens`, `cacheCreation5mTokens`, `cacheCreation1hTokens`, `vendor: 'anthropic'` to the returned object
- All defaults to 0 when fields are absent

**Validation Gate**:
```bash
node -e "import('./pforge-master/src/providers/anthropic-tools.mjs').then(m=>{const r=m.parseResponse({usage:{input_tokens:50,output_tokens:100,cache_read_input_tokens:1000,cache_creation:{ephemeral_5m_input_tokens:200,ephemeral_1h_input_tokens:50}},content:[{type:'text',text:'hi'}]});if(r.cacheReadTokens!==1000)process.exit(1);if(r.cacheCreation5mTokens!==200)process.exit(2);if(r.cacheCreation1hTokens!==50)process.exit(3);if(r.vendor!=='anthropic')process.exit(4);console.log('ok')})"
```

---

### Slice 6: OpenAI parseResponse extraction [parallel-safe Group A]

**Goal**: Extract OpenAI cached + reasoning + service_tier fields. Handle both Chat Completions and Responses API field shapes.

**Files**:
- `pforge-master/src/providers/openai-tools.mjs` (lines 77–103: `parseResponse()` only)

**Depends On**: (none — independent; parallel to Slices 4, 5)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**What changes**:
- Extend `parseResponse()` to read both API shapes:
  - Chat Completions: `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens_details.reasoning_tokens`
  - Responses API: `usage.input_tokens_details.cached_tokens`, `usage.output_tokens_details.reasoning_tokens`
- Read top-level `data.service_tier` (default null)
- Add fields `cacheReadTokens`, `reasoningTokens`, `serviceTier`, `vendor: 'openai'` to the returned object

**Validation Gate**:
```bash
node -e "import('./pforge-master/src/providers/openai-tools.mjs').then(m=>{const r=m.parseResponse({usage:{prompt_tokens:2000,completion_tokens:500,prompt_tokens_details:{cached_tokens:1500},completion_tokens_details:{reasoning_tokens:300}},service_tier:'flex',choices:[{message:{content:'hi'}}]});if(r.cacheReadTokens!==1500)process.exit(1);if(r.reasoningTokens!==300)process.exit(2);if(r.serviceTier!=='flex')process.exit(3);if(r.vendor!=='openai')process.exit(4);console.log('ok')})"
```

---

### Slice 7: xAI parseResponse extraction [parallel-safe Group A]

**Goal**: Extract xAI cached + reasoning + `cost_in_usd_ticks` fields. xAI is OpenAI-compatible at the wire, so largely mirrors Slice 6 with the addition of `cost_in_usd_ticks`.

**Files**:
- `pforge-master/src/providers/xai-tools.mjs` (`parseResponse()` only — Hardener: locate exact line range during execution; structure parallels openai-tools.mjs)

**Depends On**: (none — independent; parallel to Slices 4–6)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/testing.instructions.md`

**What changes**:
- Extend `parseResponse()` to read same fields as OpenAI Slice 6
- Additionally read `usage.cost_in_usd_ticks` (default null)
- Add fields `cacheReadTokens`, `reasoningTokens`, `costInUsdTicks`, `vendor: 'xai'` to the returned object

**Validation Gate**:
```bash
node -e "import('./pforge-master/src/providers/xai-tools.mjs').then(m=>{const r=m.parseResponse({usage:{prompt_tokens:1000,completion_tokens:500,prompt_tokens_details:{cached_tokens:200},completion_tokens_details:{reasoning_tokens:100},cost_in_usd_ticks:12345},choices:[{message:{content:'hi'}}]});if(r.cacheReadTokens!==200)process.exit(1);if(r.costInUsdTicks!==12345)process.exit(2);if(r.vendor!=='xai')process.exit(3);console.log('ok')})"
```

---

### Parallel Merge Checkpoint after Group A (Slices 4–7)

After Slices 4, 5, 6, and 7 complete in parallel:
- All four files should be edited
- Run the full test suite once to confirm no cross-slice regression
- Verify no shared file collisions occurred

**Checkpoint Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run"
```

---

### Slice 8: New test suite parseResponse-cache-fields.test.mjs [sequential]

**Goal**: Cover the three provider `parseResponse()` extractions with vendor-representative response fixtures.

**Files**:
- `pforge-mcp/tests/parseResponse-cache-fields.test.mjs` (NEW file)

**Depends On**: Slices 5, 6, 7

**Context Files**:
- `.github/instructions/testing.instructions.md`

**What changes**:
- Create new test file
- Implement the 6 test cases enumerated in Acceptance Criterion §Tests (parseResponse coverage)
- Use fixtures drawn from the vendor docs cited in §Required Decisions (Anthropic 5m+1h split example, OpenAI Chat Completions example, OpenAI Responses API example, xAI cost_in_usd_ticks example)

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/parseResponse-cache-fields.test.mjs"
```

---

### Slice 9: extractTokens() graceful no-op and vendor field [sequential]

**Goal**: Ensure CLI extraction path returns the new `vendor` field (set to `'unknown'`) so `priceSlice()` falls through to legacy backward-compatible math. Zero regression on subscription-CLI users.

**Files**:
- `pforge-mcp/orchestrator.mjs` (line 2485: `extractTokens()` only)

**Depends On**: Slice 3

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Add `vendor: 'unknown'` to the object returned by `extractTokens()`
- No other behavior change. CLI workers (`gh-copilot`, `claude-cli`, `codex-cli`) continue to bill via the subscription-CLI path

**Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs"
```

---

### Slice 10: Documentation closure [sequential]

**Goal**: Update CHANGELOG and research doc §12.5 to reflect the landed fix. Ship the optional benchmark script if time allows.

**Files**:
- `CHANGELOG.md` (new entry under next version)
- `docs/research/enterprise-fleet-readiness.md` (append §12.6 status block; do not edit prior text)
- `pforge-mcp/scripts/cost-coverage-bench.mjs` (NEW, optional per SHOULD)

**Depends On**: All prior slices

**Context Files**:
- `.github/instructions/version.instructions.md`
- `.github/instructions/git-workflow.instructions.md`

**What changes**:
- Add CHANGELOG entry per Acceptance Criterion §Documentation. **Include the three-cost-paths clarification under `### Notes`** so users understand which path this fix touches.
- Append §12.6 status block to research doc per Acceptance Criterion §Documentation. **Include the per-cost-path scope clarification** so the bug-fix narrative is unambiguous about who benefits and who is unaffected.
- (Optional) Create `pforge-mcp/scripts/cost-coverage-bench.mjs` per SHOULD criterion

**Validation Gate**:
```bash
node -e "const c=require('fs').readFileSync('CHANGELOG.md','utf8');if(!c.includes('Cost-Service Token Coverage'))process.exit(1);if(!c.includes('Phase-COST-TOKEN-COVERAGE') && !c.includes('cache_read'))process.exit(2);if(!c.includes('Subscription CLI workers'))process.exit(3);console.log('ok')"
node -e "const c=require('fs').readFileSync('docs/research/enterprise-fleet-readiness.md','utf8');if(!c.includes('12.6'))process.exit(1);if(!c.includes('FIXED in Phase-COST-TOKEN-COVERAGE'))process.exit(2);if(!c.includes('Scope clarification by cost path'))process.exit(3);console.log('ok')"
```

---

## Re-anchor Checkpoints

After every 3 slices, re-anchor against the plan:
- **After Slice 3**: Confirm `priceSlice()` math is correct on at least one Anthropic case and one OpenAI case before opening parallel Group A. Manual `node -e` smoke test of `priceSlice({ vendor: 'anthropic', ... })` and `priceSlice({ vendor: 'openai', ... })` produces sane numbers.
- **After Group A (Parallel Merge Checkpoint)**: Confirm no test regressions across the full vitest suite before proceeding to Slice 8.
- **After Slice 9**: Confirm CLI subscription-cost path is unchanged via `bash -c "cd pforge-mcp && npx vitest run tests/cost-service.test.mjs --reporter=verbose"`. Look specifically for tests that exercise the gh-copilot path; they should still pass with identical numeric results.

---

## Definition of Done

- [ ] All 10 Execution Slices passed their validation gates
- [ ] All Acceptance Criteria with `**MUST**:` prefix satisfied
- [ ] `pforge-mcp/tests/cost-service.test.mjs` passes (existing regression guard)
- [ ] `pforge-mcp/tests/cost-service-real-plans.test.mjs` passes (smoke matrix)
- [ ] `pforge-mcp/tests/cost-service-token-coverage.test.mjs` passes (new — ≥ 90% coverage of changed paths)
- [ ] `pforge-mcp/tests/parseResponse-cache-fields.test.mjs` passes (new)
- [ ] `pforge-mcp/tests/cost-service.test.mjs` updated rates match new `MODEL_PRICING` (per Slice 2 note)
- [ ] No file outside the In-Scope list was modified (verify with `git diff --stat`)
- [ ] `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` is byte-identical to pre-execution (verify with `git diff pforge-mcp/cost-service.mjs | grep -A 10 "costForLeg"` returning no changes in that function)
- [ ] CHANGELOG entry added
- [ ] Research doc §12.6 status block appended
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**
- [ ] `pforge diff Phase-COST-TOKEN-COVERAGE-PLAN.md` reports clean (drift score ≥ 90)
- [ ] `pforge sweep` reports zero TODO / FIXME / stub markers introduced

---

## Stop Conditions

If any of the following occurs during execution, STOP and escalate:

1. **Build / module load failure** — any `node -e "import('./pforge-mcp/cost-service.mjs')"` invocation fails after a slice. Roll back the slice; do not proceed.
2. **Test failure NOT caused by intended rate update** — if a test in `cost-service.test.mjs` fails with a mismatch that isn't traceable to the Slice 2 rate refresh, investigate. Do not blanket-update test expectations.
3. **Scope violation** — `git diff --stat` shows changes to files outside the In-Scope list. Revert those changes; complete the slice within scope only.
4. **`costForLeg()` modification** — any change appears in `pforge-mcp/cost-service.mjs` lines 309–318. **CRITICAL**: revert immediately. The v2.83.0 fix lives there; touching it risks subscription-CLI regression.
5. **Subscription-CLI regression** — `priceSlice({ model: 'gh-copilot', premiumRequests: 5, vendor: undefined })` returns anything other than `0.05` USD. Stop and investigate the legacy backward-compatibility path.
6. **Mirror-opposite math bug** — if Anthropic and OpenAI tests both pass for cache_read but produce dollar values that suggest the same code path was used (instead of mirror-opposite), the vendor branching is wrong. Stop and re-read Forbidden Action #4 and #5 plus the Required Decision row 5 on `prompt_tokens` semantics.
7. **Security breach** — secret material appears in any test fixture, log output, or committed file. Stop, sanitize, and report.

---

## Reference: Research provenance

- Original defect surfaced by [docs/research/enterprise-fleet-readiness.md §12](../research/enterprise-fleet-readiness.md#section-12--bug-surfaced-by-audit-cost-service-token-coverage-critical) (audit 2026-05-06)
- Vendor pricing verified by parallel research agent on 2026-05-06; all source URLs cited inline in `MODEL_PRICING._source` fields after Slice 2
- Codebase file:line references verified by Explore subagent on 2026-05-06
- Aligned with OpenTelemetry GenAI semantic conventions (`gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, `gen_ai.usage.reasoning.output_tokens`) per [docs/research/enterprise-fleet-readiness.md §8.6](../research/enterprise-fleet-readiness.md). When the OTel exporter lands (Week 2 of enterprise hardening track), the same fields surfaced here populate the standard OTel attributes without further extraction work.

---

## Plan Quality Self-Check (executed during hardening)

1. ✅ Every Execution Slice has at least one validation gate with an exact command
2. ✅ Every [parallel-safe] slice (Group A: Slices 4, 5, 6, 7) touches a different file (cost-service-token-coverage.test.mjs / anthropic-tools.mjs / openai-tools.mjs / xai-tools.mjs — all independent)
3. ✅ All REQUIRED DECISIONS resolved (12 rows, no TBD)
4. ✅ Definition of Done includes "Reviewer Gate passed (zero 🔴 Critical)"
5. ✅ Stop Conditions cover: build failure (#1), test failure (#2), scope violation (#3), security breach (#7), plus three domain-specific stops
6. ✅ Each slice lists only relevant instruction files (architecture-principles + testing for code slices; version + git-workflow for the doc slice)
7. ✅ Every MUST acceptance criterion is traceable to at least one slice (verified during slice-design pass)
8. ✅ Validation gates pass Gate Portability Rules: all use `node -e` for filesystem checks, `bash -c "cd pforge-mcp && npx vitest run ..."` for tests, no Unix-only commands without bash wrap, no `pforge analyze` (orchestrator runs that automatically), no nested escaped quotes (avoided by single-quote use inside `node -e` strings)

---

## Session Budget Check

- **10 slices total.** Slices 1–3 are sequential and sized at 30–60 min each. Slices 4–7 are parallel-safe and sized at 30–45 min each. Slices 8–10 are sequential and sized at 20–45 min each.
- **Recommended session break point**: after Slice 3 (priceSlice() math is the highest-risk slice; commit and verify before opening parallel Group A in a fresh session).
- No single slice has more than 3 Context Files.
- Total estimated wall-clock for full run: 5–7 hours including checkpoints.

---

## TBD Summary

| # | Decision | Status | Resolution |
|---|---|---|---|
| All 12 | (see Required Decisions above) | RESOLVED | Vendor research + audit completed during hardening |

**Plan hardened ✅ — proceed to Step 3 (Execute Slices)**
