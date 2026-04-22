---
lane: full
source: human
status: outline
created: 2026-04-22
author: Claude Opus 4.7 (in-session seed, approved by Scott Nichols)
---

# Phase-33 — Forge-Master over GitHub Copilot (zero-key provider)

> **Target release**: v2.67.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: v2.66.0 shipped (Phase-32 — advisory lane, principles loader, CTO-in-a-box contract)
> **Addresses**: Single blocker preventing `forge_master_ask` from working for the target audience

## Core Problem

Forge-Master's reasoning loop requires a chat-completion + tool-calling API (classify intent → fetch context → call `brain_recall` / `forge_plan_status` → return grounded answer). The loop lives in [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) and dispatches through three provider adapters:

- [pforge-master/src/providers/anthropic-tools.mjs](pforge-master/src/providers/anthropic-tools.mjs)
- [pforge-master/src/providers/openai-tools.mjs](pforge-master/src/providers/openai-tools.mjs)
- [pforge-master/src/providers/xai-tools.mjs](pforge-master/src/providers/xai-tools.mjs)

Every adapter needs a **third-party API key** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`) stored in `.forge/secrets.json` or environment. This is architecturally wrong for Plan Forge's target audience: **VS Code users with a GitHub Copilot subscription**. They already pay for models they can't reach, and `gh copilot` CLI — which the orchestrator spawns for code-writing slices — is fire-and-forget, not a chat-completion endpoint. Tool-calling is impossible through it.

Result: `forge_master_ask` exists, ships with a 10-principle CTO-in-a-box system prompt, and cannot be smoke-tested by any user without a separate paid API key. Phase-32 shipped the capability but not the reachability.

Two paths close the gap, and both should ship in one phase because they serve different runtimes:

1. **GitHub Models API** — `https://models.github.ai/inference` speaks OpenAI-compatible chat completions with tool-calling, authenticates via `GITHUB_TOKEN`, and is free for Copilot subscribers within the per-day rate limits. Works from any runtime (Node CLI, MCP server, dashboard). This is the primary fix — one new provider file cloned from `openai-tools.mjs`, one config entry, zero new keys.
2. **VS Code Language Model API** — `vscode.lm.selectChatModels({ vendor: 'copilot' })` + `model.sendRequest(messages, { tools })` gives tool-calling access with no API key at all, using the user's Copilot entitlement directly. Only works inside the VS Code extension host, not the standalone MCP server. This is the secondary path for when Forge-Master is invoked from the VS Code chat surface.

Both paths keep [.forge/secrets.json](./.forge/secrets.json) as the escape hatch for premium users who want Claude Opus or Grok, but neither path **requires** a key. Architecture-First Principle 6 ("Enterprise Quality Is the Default") says the default configuration must work out of the box for the target audience.

## Candidate Slices

### Slice 1 — GitHub Models provider adapter

**Scope**: new file `pforge-master/src/providers/github-copilot-tools.mjs` (clone of `openai-tools.mjs` with base URL + auth swap), `pforge-master/src/providers/__tests__/github-copilot-tools.test.mjs` (new, fixture-driven, no live calls).

- New provider implements `buildTools(tools)`, `formatMessages(messages)`, `callProvider({ model, messages, tools, ... })`, matching the contract `reasoning.mjs` already consumes from `openai-tools.mjs`.
- Base URL: `https://models.github.ai/inference/chat/completions` (overridable via `.forge.json#forgeMaster.providers.githubCopilot.baseUrl`).
- Auth: `Authorization: Bearer ${token}` where token resolves in order: `process.env.GITHUB_TOKEN` → `.forge/secrets.json#GITHUB_TOKEN` → `gh auth token` subprocess (fallback, cached in-process for session).
- Model routing: accept OpenAI-style names (`gpt-4o`, `gpt-4o-mini`) and Anthropic-style names (`claude-sonnet-4`, `claude-opus-4`) — GitHub Models catalog supports both. Unknown models fall back to `gpt-4o-mini`.
- Rate-limit handling: on HTTP 429, return a structured error `{ error: "rate_limited", retryAfter: <seconds> }` so the reasoning loop can surface "Copilot daily quota exhausted — set OPENAI_API_KEY or wait" rather than crashing.
- Unit tests: fixture-based (recorded request/response JSON under `pforge-master/src/__fixtures__/github-copilot/`), assert request shape, response parsing, tool_calls translation, 429 handling. No live HTTP.

### Slice 2 — Provider selection + zero-key default

**Scope**: [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs), [pforge-master/src/config.mjs](pforge-master/src/config.mjs), [pforge-mcp/secrets.mjs](pforge-mcp/secrets.mjs), tests in `pforge-master/src/__tests__/reasoning-provider-selection.test.mjs` (new or extend).

- `reasoning.mjs` provider-selection order flips to: `githubCopilot` (if `GITHUB_TOKEN` or `gh auth token` resolvable) → `anthropic` → `openai` → `xai`. Today Copilot is absent entirely.
- `config.mjs` adds `forgeMaster.defaultProvider = "githubCopilot"` and `forgeMaster.providers.githubCopilot.model = "gpt-4o-mini"` — cheapest default that supports tool-calling, respects Keep Gates Boring by not requiring flagship routing.
- When no provider resolves (no keys, no `gh`), `forge_master_ask` returns the existing `{ error: "no provider available" }` response. Add a `suggestion` field to that error: `"Install GitHub CLI and run 'gh auth login', or set GITHUB_TOKEN / OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY"`. Architecturally: errors at the system boundary must be actionable.
- Update [pforge-mcp/secrets.mjs](pforge-mcp/secrets.mjs) schema to document `GITHUB_TOKEN` as first-class. Dashboard secrets UI (already in `served-app.js`) gets `{ key: "GITHUB_TOKEN", label: "GitHub (Copilot, recommended)", placeholder: "ghp_..." }` as the first entry.
- Tests assert: (a) selection prefers githubCopilot when `GITHUB_TOKEN` env set, (b) fallback order on missing keys, (c) error response includes the `suggestion` field.

### Slice 3 — VS Code Language Model provider (extension-host path)

**Scope**: new file `pforge-master/src/providers/vscode-lm-tools.mjs`, integration point in `pforge-master/src/index.mjs` gated by `typeof vscode !== "undefined"`, tests at `pforge-master/src/providers/__tests__/vscode-lm-tools.test.mjs` (mocked `vscode.lm` API).

- Adapter detects `vscode.lm` at module load. When absent (MCP server / CLI runtime), module exports a no-op stub and `isAvailable() === false`.
- When present (extension host), `callProvider` translates the generic message format into `vscode.LanguageModelChatMessage[]`, passes `tools` as `LanguageModelChatTool[]`, awaits `model.sendRequest(messages, { tools }, token)`, and streams the response back, collecting tool calls.
- Selection priority (Slice 2) gains a zeroth entry: `vscodeLm` (if available) → `githubCopilot` → `anthropic` → `openai` → `xai`. When running inside the VS Code extension, no token is ever read from disk.
- Tests mock the `vscode.lm` surface with a fixture module, assert message translation, tool-call round-trip, and graceful no-op when `vscode` is undefined.
- **Scope guard**: this slice does NOT ship a VS Code extension. It only adds the adapter so a future extension (or the existing GitHub Copilot Chat participant path in `pforge-vscode` if one exists) can use it. If no extension host is found at runtime, behavior is identical to today.

### Slice 4 — Live smoke test + principle-grounded assertion

**Scope**: new script `scripts/smoke-forge-master.mjs`, npm script `npm run smoke:forge-master`, test at `pforge-mcp/tests/forge-master.smoke.test.mjs` (marked `skipIf(!process.env.FORGE_SMOKE)` so CI without a token passes).

- Script invokes `forge_master_ask` through the in-process path with a known advisory prompt: `"Should I refactor the orchestrator worker spawn logic or ship Phase-34 first?"`
- Asserts response (a) classifies to `advisory` lane, (b) contains at least three of the 10 principles by keyword (`architecture-first`, `slice`, `fresh session`, `triage`, `evidence`, `boring`, etc.), (c) returns within 30 s, (d) emits one telemetry event with `proxied=false` and `tokensOut>0`.
- On CI without `GITHUB_TOKEN`, the test is skipped, not failed. Locally with `gh auth login` done, it runs and produces the first real end-to-end record of CTO-in-a-box actually answering.
- Write output transcript to `.forge/smoke/forge-master-<timestamp>.md` so the next session can see the advisory style in practice.

### Slice 5 — Release v2.67.0

**Scope**: `VERSION`, `CHANGELOG.md`, `ROADMAP.md`, `docs/capabilities.md` (provider list), `pforge-master/README.md` (configuration section), tag `v2.67.0`.

- `pforge version-bump 2.67.0 --strict` (dogfoods Phase-31.1's rebuild).
- CHANGELOG promotes `[Unreleased]` → `[2.67.0] — 2026-04-22` with headline "**Forge-Master now works out of the box for GitHub Copilot subscribers — no API key required.**"
- README configuration section adds "Zero-key setup: `gh auth login` is enough. API keys remain optional for Claude Opus / Grok / GPT-5 escape hatches." as the first bullet.
- `docs/capabilities.md` provider table adds `githubCopilot` and `vscodeLm` rows.
- Release slice runs the smoke test (Slice 4) if `GITHUB_TOKEN` is present locally, pastes transcript into the GitHub release notes. If no token, ships without the transcript but flags it in the release body so the next contributor with a token can capture one.

## Required Decisions Before Step-2 Hardening

1. **Default model on GitHub Models**: `gpt-4o-mini` (fast, cheap, tool-calling OK) vs `gpt-4o` (better advisory quality, higher per-day quota cost). Recommendation: `gpt-4o-mini` as default — advisory answers fit in 500 tokens, speed matters more than flagship reasoning. Users who want flagship set `forgeMaster.providers.githubCopilot.model` in `.forge.json`.
2. **Token resolution order — `gh auth token` subprocess**: acceptable latency? Each Forge-Master turn would spawn `gh` once per session (cached). Alternative: require explicit `GITHUB_TOKEN` env var, no subprocess. Recommendation: cache `gh auth token` once per process, fall back to env. The subprocess tax is <200 ms once.
3. **Slice 3 scope — ship the VS Code LM adapter now, or defer to Phase-33.1?** Slice 3 adds ~150 LOC of mocked-test code that nothing currently consumes. Splitting lets v2.67.0 focus on the GitHub Models path (the one that immediately unblocks users). Recommendation: **defer Slice 3 to a future phase when a VS Code extension is actually built**; v2.67.0 ships 4 slices (1, 2, 4, 5 — renumbered).
4. **Smoke-test as validation gate vs. npm script?** If the gate blocks on no-token environments, CI breaks. If it's only an `npm run` script, nothing enforces it. Recommendation: smoke-test is a `test.skipIf(!process.env.FORGE_SMOKE)` vitest inside `pforge-mcp/tests/` so `npm test` covers it when the env is set, CI skips cleanly. Release slice sets `FORGE_SMOKE=1` locally before cutting the tag.
5. **Dashboard secrets UI reorder**: should `GITHUB_TOKEN` replace or precede the existing `XAI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` entries? Recommendation: **precede**, keep existing entries. Label is "GitHub (Copilot, recommended)" so new users know it's the default, others remain labeled as escape hatches.

## Forbidden Actions

- Do NOT ship a VS Code extension in this phase (Slice 3, if included, is the adapter only).
- Do NOT remove the anthropic/openai/xai adapters — they remain escape hatches for premium models.
- Do NOT make live HTTP calls in unit tests — fixture-driven only. Slice 4's smoke test is a separate skippable vitest, not a unit test.
- Do NOT modify `pforge.ps1` orchestrator worker spawn logic. That uses `gh copilot -p` CLI for code-writing slices and is not in scope.
- Do NOT commit a real `GITHUB_TOKEN` to `.forge/secrets.json` fixtures or logs. Use synthetic tokens in tests.

## Success Criteria

- A fresh Plan Forge checkout with `gh auth login` completed and no other API keys set can invoke `forge_master_ask` successfully and receive a principle-grounded answer.
- Existing users with `ANTHROPIC_API_KEY` or others set continue to route through their configured provider with no regression.
- Smoke test (when `FORGE_SMOKE=1`) completes in under 30 s and asserts advisory-lane classification + principle keyword presence.
- v2.67.0 release notes headline the zero-key experience. No analyzer regression (stays ≥ 85/100).

## Notes

This phase is deliberately narrow. Phase-32 shipped the CTO-in-a-box brain; Phase-33 makes it reachable for the target audience without a tax. The 10th principle (Keep Gates Boring) applies: plain fixture-driven vitest + one skippable smoke test, no nested shell layers, no escaped-quote gymnastics.
