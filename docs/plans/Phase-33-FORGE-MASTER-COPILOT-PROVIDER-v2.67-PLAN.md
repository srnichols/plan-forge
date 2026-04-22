---
lane: full
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session harden from Scott Nichols' approved recommendations)
hardened_at: 2026-04-22
---

# Phase-33 — Forge-Master over GitHub Copilot (zero-key provider)

> **Target release**: v2.67.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-32 shipped (v2.66.0 tagged; CTO-in-a-box advisory lane live; 10-principle `UNIVERSAL_BASELINE` in `principles.mjs`; `forge_master_ask` advisory contract in `capabilities.mjs` and `tools.json`)
> **Branch strategy**: Direct to `master`. All changes are additive — new provider adapter, new default selection, new skippable smoke test. Existing provider adapters (anthropic, openai, xai) unchanged and remain escape hatches for premium users.
> **Session budget**: 1 session, 4 slices. Natural session-break after Slice 2 if needed.

---

## Specification Source

- **Field input 1 — reachability gap**: After shipping v2.66.0, Scott flagged that `forge_master_ask` cannot be smoke-tested by any user without a third-party API key. The in-process reasoning loop at [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) requires chat-completion + tool-calling, and the three existing provider adapters (`providers/anthropic-tools.mjs`, `providers/openai-tools.mjs`, `providers/xai-tools.mjs`) all require `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY` respectively. Target audience is VS Code users with GitHub Copilot subscriptions, who pay for model access they cannot reach through Plan Forge.
- **Field input 2 — `gh copilot` is the wrong surface**: The orchestrator at `pforge.ps1` spawns `gh copilot -p <prompt>` per slice for code-writing. That CLI is fire-and-forget — prompt in, file edits out. It does not expose a `tools[]` / `tool_calls` roundtrip, so the reasoning loop cannot use it. Confirmed by reading the existing provider adapter contract: `callProvider({ model, messages, tools })` returns `{ content, toolCalls, stopReason }`.
- **Field input 3 — GitHub Models is the right surface**: `https://models.github.ai/inference/chat/completions` speaks OpenAI-compatible chat completions with function calling, authenticates via `GITHUB_TOKEN`, and is included in Copilot subscriptions within per-day rate limits. This means a ~150 LOC clone of `openai-tools.mjs` with the base URL and auth header swapped unblocks every target user with zero new keys.
- **Field input 4 — approved recommendations from Required Decisions**: (1) default model `gpt-4o-mini` (fast/cheap/tool-calling OK, flagship unneeded for advisory answers), (2) cache `gh auth token` once per process with env override, (3) defer VS Code LM adapter to a future phase (no consumer today; 4 slices keeps this tight), (4) smoke test as `vitest.skipIf(!process.env.FORGE_SMOKE)` so CI without token passes cleanly, (5) `GITHUB_TOKEN` precedes existing keys in the dashboard secrets UI labeled "GitHub (Copilot, recommended)".
- **Architecture anchor**: Principle 6 (Enterprise Quality Is the Default) — default configuration must work for the target audience without manual setup beyond `gh auth login`. Principle 1 (Architecture-First) — don't bolt the GitHub path onto existing adapters; give it its own provider file with the same contract. Principle 10 (Keep Gates Boring) — fixture-driven unit tests, one skippable smoke test, no nested shell gymnastics.
- **Prior postmortems**: Meta-bugs [#91](https://github.com/srnichols/plan-forge/issues/91) (closed by v2.65.1), [#92](https://github.com/srnichols/plan-forge/issues/92) (closed by Phase-31.1 gate simplification), [#93](https://github.com/srnichols/plan-forge/issues/93) (closed by Phase-32 gate fix). All three earned Principle 10. Phase-33 gates inherit that discipline.

---

## Scope Contract

### In scope

- [pforge-master/src/providers/github-copilot-tools.mjs](pforge-master/src/providers/github-copilot-tools.mjs) — NEW provider adapter
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs) — provider-selection order flip
- [pforge-master/src/config.mjs](pforge-master/src/config.mjs) — `defaultProvider` + `providers.githubCopilot` config keys
- [pforge-mcp/secrets.mjs](pforge-mcp/secrets.mjs) — `GITHUB_TOKEN` documented as first-class secret
- [pforge-mcp/dashboard/served-app.js](pforge-mcp/dashboard/served-app.js) — secrets UI reorder (GITHUB_TOKEN first, labeled "GitHub (Copilot, recommended)")
- `pforge-master/src/providers/__tests__/github-copilot-tools.test.mjs` — NEW fixture-driven unit tests
- `pforge-master/src/__fixtures__/github-copilot/` — NEW fixture directory with recorded request/response JSON
- `pforge-master/src/__tests__/reasoning-provider-selection.test.mjs` — NEW or extended selection-order tests
- `pforge-mcp/tests/forge-master.smoke.test.mjs` — NEW skippable end-to-end smoke test
- `scripts/smoke-forge-master.mjs` — NEW invocation script for manual/CI smoke runs
- `.forge/smoke/` — NEW directory for smoke transcripts (gitignored by pattern; add `.forge/smoke/` to `.gitignore` if not already covered by `.forge/` exclusion)
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — release metadata at Slice 4
- `docs/capabilities.md` — provider table row addition
- `pforge-master/README.md` — configuration section headline

### Out of scope

- Any change to existing `providers/anthropic-tools.mjs`, `providers/openai-tools.mjs`, `providers/xai-tools.mjs` adapters (they remain escape hatches for premium users)
- Any change to `pforge.ps1` orchestrator worker spawn logic — `gh copilot -p` CLI path for code-writing slices is not in scope
- Any VS Code extension scaffolding or `vscode.lm` adapter (deferred per Required Decision #3; re-open when a consumer exists)
- Any change to `forge_master_ask` schema, `tools.json` advisory metadata, or the 10-principle `UNIVERSAL_BASELINE` — all shipped in Phase-32 and stable
- Any live HTTP calls in unit tests (fixture-driven only; live calls confined to the skippable smoke vitest)
- Any change to the intent router's `advisory` lane keyword rules or system-prompt.md principles block
- Any telemetry schema change — reuse existing `emitToolTelemetry("forge_master_ask", ...)` event shape
- Any rate-limit persistence across process restarts — in-process cache only

### Forbidden actions

- Do NOT commit any real `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `XAI_API_KEY` value to fixtures, tests, logs, transcripts, or dashboard seed data. Use the synthetic token `ghp_SMOKETEST_NOT_A_REAL_TOKEN` in tests.
- Do NOT make live HTTP calls in any file under `**/__tests__/` or `pforge-mcp/tests/` except the single smoke test, which MUST be guarded by `test.skipIf(!process.env.FORGE_SMOKE)`.
- Do NOT remove or disable any existing provider adapter. Adding `github-copilot-tools.mjs` is additive.
- Do NOT change `pforge.ps1` or `pforge.sh` orchestrator logic.
- Do NOT introduce a `vscode` import anywhere (the VS Code LM adapter is deferred; any reference would fail in the MCP server runtime).
- Do NOT use nested pwsh-in-bash gates or escaped-quote gate patterns. All gates are plain `npx vitest run` or plain `grep -q` against a file path (Principle 10).

---

## Acceptance Criteria

### Criteria for Slice 1 (provider adapter)

- **MUST**: `pforge-master/src/providers/github-copilot-tools.mjs` exists and exports `buildTools`, `formatMessages`, `callProvider`, `isAvailable`, matching the contract consumed by `reasoning.mjs` from `openai-tools.mjs`.
- **MUST**: `callProvider` targets `https://models.github.ai/inference/chat/completions` by default; base URL is overridable via a `baseUrl` option.
- **MUST**: `callProvider` sets the `Authorization: Bearer <token>` header where `<token>` is resolved by `resolveGitHubToken()` in order: (a) `options.token` passed in, (b) `process.env.GITHUB_TOKEN`, (c) `.forge/secrets.json#GITHUB_TOKEN` via `pforge-mcp/secrets.mjs`, (d) cached result of `gh auth token` subprocess (cached in module scope on first successful call).
- **MUST**: `isAvailable()` returns `true` when any of the four token sources resolves to a non-empty string; returns `false` otherwise. `isAvailable` does not make HTTP calls.
- **MUST**: The adapter normalizes model names: OpenAI-style (`gpt-4o`, `gpt-4o-mini`) and Anthropic-style (`claude-sonnet-4`, `claude-opus-4`) pass through unchanged. Unknown names fall back to `gpt-4o-mini`.
- **MUST**: On HTTP 429, `callProvider` returns `{ error: "rate_limited", retryAfter: <seconds from Retry-After header or 60>, raw: <body> }` rather than throwing.
- **MUST**: On HTTP >= 500, `callProvider` throws an Error with message `"GitHub Models ${status}: ${statusText}"` so the reasoning loop surfaces the failure.
- **MUST**: `pforge-master/src/providers/__tests__/github-copilot-tools.test.mjs` contains at least 8 fixture-driven unit tests covering: (a) `buildTools` shape, (b) `formatMessages` assistant + tool_result round-trip, (c) `callProvider` happy path with `fetch` mocked, (d) tool_calls response parsing, (e) 429 handling returns structured error, (f) 500 throws, (g) model fallback to `gpt-4o-mini`, (h) `isAvailable` returns true when `GITHUB_TOKEN` env set and false when all sources empty.
- **MUST**: Fixture JSON files under `pforge-master/src/__fixtures__/github-copilot/` contain: `request-simple.json`, `response-tool-call.json`, `response-rate-limit.json`, `response-500.json`.

### Criteria for Slice 2 (provider selection)

- **MUST**: `pforge-master/src/reasoning.mjs` provider-selection helper iterates in order: `githubCopilot` -> `anthropic` -> `openai` -> `xai`, selecting the first provider whose `isAvailable()` returns `true`.
- **MUST**: `pforge-master/src/config.mjs` adds keys `forgeMaster.defaultProvider` (default `"githubCopilot"`) and `forgeMaster.providers.githubCopilot.model` (default `"gpt-4o-mini"`). Override precedence is env var -> `.forge.json` -> default.
- **MUST**: When no provider is available, `runTurn` returns a response object whose `error` field equals `"no provider available"` and whose `suggestion` field equals `"Install GitHub CLI and run 'gh auth login', or set GITHUB_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY"`.
- **MUST**: `pforge-mcp/secrets.mjs` `KNOWN_SECRETS` (or equivalent registry) lists `GITHUB_TOKEN` with label `"GitHub (Copilot, recommended)"` and placeholder `"ghp_..."` as the first entry.
- **MUST**: `pforge-mcp/dashboard/served-app.js` secrets UI renders `GITHUB_TOKEN` as the first row with the label `"GitHub (Copilot, recommended)"`. Existing keys (`XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCLAW_API_KEY`) remain in their current relative order below.
- **MUST**: `pforge-master/src/__tests__/reasoning-provider-selection.test.mjs` contains at least 4 tests asserting: (a) `githubCopilot` selected when only `GITHUB_TOKEN` is set, (b) fallback to `anthropic` when `githubCopilot.isAvailable() === false` and `ANTHROPIC_API_KEY` set, (c) `no provider available` error + `suggestion` field when all absent, (d) explicit `forgeMaster.defaultProvider` in config overrides the order.

### Criteria for Slice 3 (skippable smoke test)

- **MUST**: `pforge-mcp/tests/forge-master.smoke.test.mjs` uses `test.skipIf(!process.env.FORGE_SMOKE)` (or equivalent vitest skipIf pattern) at the test or describe level.
- **MUST**: When `FORGE_SMOKE=1` and `GITHUB_TOKEN` resolvable, the smoke test invokes `runTurn` with the prompt `"Should I refactor the orchestrator worker spawn logic or ship Phase-34 first?"` and asserts: (a) response lane is `advisory`, (b) response text contains at least three of `architecture`, `slice`, `fresh session`, `triage`, `evidence`, `boring`, `principle`, `forbidden` (case-insensitive), (c) `tokensOut > 0`, (d) completes within 30 seconds.
- **MUST**: `scripts/smoke-forge-master.mjs` is a Node script that invokes the same prompt through `runTurn`, prints the full response to stdout, and writes a timestamped transcript to `.forge/smoke/forge-master-<ISO>.md`. Script exits 0 on success, 1 on any provider error.
- **MUST**: `package.json` gains a script `"smoke:forge-master"` that sets `FORGE_SMOKE=1` and runs the smoke script (use cross-platform syntax or document Windows alternative in the script header).

### Criteria for Slice 4 (release)

- **MUST**: `VERSION` contains `2.67.0` (per Phase-31.1's `Overwrite` strategy).
- **MUST**: `CHANGELOG.md` has `[2.67.0] - 2026-04-22` section promoted from `[Unreleased]`, headlined with the phrase `"no API key required"` or `"zero-key"`.
- **MUST**: `ROADMAP.md` reflects v2.67.0 as shipped and Phase-33 as complete.
- **MUST**: `pforge-master/README.md` configuration section first bullet mentions zero-key setup and `gh auth login`.
- **MUST**: `docs/capabilities.md` provider table includes a row for `githubCopilot`.
- **MUST**: Git tag `v2.67.0` exists on the Slice 4 release commit.

### Quality bar

- **SHOULD**: `github-copilot-tools.mjs` code coverage >= 80% by line from the fixture-driven unit tests (vitest coverage report, informational — do not gate on it).
- **SHOULD**: Smoke transcript written to `.forge/smoke/` uses markdown with the response block fenced and includes the prompt, lane classification, model used, token counts, and full response text.
- **SHOULD**: `pforge.ps1 version-bump 2.67.0 --strict` exits 0 with `Updated 5/5` (dogfoods Phase-31.1's rebuilt strict-mode version-bump; auditable in the release commit).
- **SHOULD**: Release commit message uses format `chore(release): v2.67.0 — zero-key Forge-Master via GitHub Models`.

---

## Execution Slices

### Slice 1 — GitHub Copilot provider adapter

**Complexity**: 4 (new file + fixture-driven unit tests + 4 fixture JSON files + subprocess fallback for `gh auth token`).

**Files to create**:
- `pforge-master/src/providers/github-copilot-tools.mjs`
- `pforge-master/src/providers/__tests__/github-copilot-tools.test.mjs`
- `pforge-master/src/__fixtures__/github-copilot/request-simple.json`
- `pforge-master/src/__fixtures__/github-copilot/response-tool-call.json`
- `pforge-master/src/__fixtures__/github-copilot/response-rate-limit.json`
- `pforge-master/src/__fixtures__/github-copilot/response-500.json`

**Files to read (not modify)**: `pforge-master/src/providers/openai-tools.mjs` (template — copy structure), `pforge-mcp/secrets.mjs` (token resolution helper shape).

**Steps**:
1. Read `openai-tools.mjs` end to end. Copy to `github-copilot-tools.mjs`. Rename exports and the JSDoc header.
2. Swap `DEFAULT_BASE_URL` to `"https://models.github.ai/inference"`. Swap `Authorization: Bearer <OPENAI_API_KEY>` to `Authorization: Bearer <resolved token>`.
3. Implement `resolveGitHubToken({ token, useSubprocess = true } = {})` with the 4-tier resolution order (passed → env → secrets.json → `gh auth token`). Cache the subprocess result at module scope. Use `execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })` with try/catch.
4. Implement `isAvailable()` that returns `Boolean(resolveGitHubToken({ useSubprocess: true }))` — it is allowed to spawn `gh` once for the cache warm-up, but any subsequent call is cache-only. MUST NOT hit HTTP.
5. Add model-normalization: define `KNOWN_MODELS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "claude-opus-4"]` and fallback to `"gpt-4o-mini"` when model not listed (log a `console.warn` once).
6. Add response-status branching: 429 → return structured error; ≥ 500 → throw; 2xx → parse as OpenAI-compatible response.
7. Write fixtures: `request-simple.json` (one user message, one tool), `response-tool-call.json` (tool_calls present), `response-rate-limit.json` (the OpenAI-compatible 429 envelope), `response-500.json` (`{ error: "internal" }`). Keep fixtures ≤ 40 lines each.
8. Write 8 tests in `github-copilot-tools.test.mjs`. Use `vi.stubGlobal("fetch", ...)` with fixture-backed responses. Each test ≤ 20 lines.

**Validation gate**:
```bash
cd pforge-master && npx vitest run src/providers/__tests__/github-copilot-tools.test.mjs --reporter=default
```
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

**Commit**: `feat(forge-master): Slice 1 — GitHub Copilot provider adapter`

---

### Slice 2 — Provider selection + zero-key default

**Complexity**: 3 (wire selection order, config keys, secrets UI reorder, extend selection test).

**Files to create or extend**:
- Extend `pforge-master/src/reasoning.mjs` (or wherever provider selection lives — identify during step 1)
- Extend `pforge-master/src/config.mjs`
- Extend `pforge-mcp/secrets.mjs`
- Extend `pforge-mcp/dashboard/served-app.js` (secrets UI)
- `pforge-master/src/__tests__/reasoning-provider-selection.test.mjs` (NEW or extend existing)

**Steps**:
1. Read `reasoning.mjs`. Locate the provider-selection function. If it does not exist as a discrete function, extract one: `selectProvider(config, env)` returning the adapter module or `null`.
2. Import `githubCopilotProvider` from `./providers/github-copilot-tools.mjs` at the top of `reasoning.mjs` (alongside existing imports).
3. Change the selection loop to iterate `["githubCopilot", "anthropic", "openai", "xai"]`, checking each adapter's `isAvailable()` and returning the first match.
4. Update `runTurn`'s no-provider error path to include a `suggestion` field with the exact string in criterion 12.
5. In `config.mjs`, add `defaultProvider: "githubCopilot"` under `forgeMaster`, and `providers.githubCopilot: { model: "gpt-4o-mini" }`. Maintain backward compatibility: existing `providers.openai.model` etc. continue to work.
6. In `pforge-mcp/secrets.mjs`, add `GITHUB_TOKEN` to the `KNOWN_SECRETS` array (or equivalent) with label and placeholder per criterion 13. Put it first.
7. In `pforge-mcp/dashboard/served-app.js`, locate the secrets-UI array (search for `XAI_API_KEY` — it was around line 2598 in the sweep output). Prepend the `GITHUB_TOKEN` entry. Do not reorder existing entries.
8. Write 4 tests in `reasoning-provider-selection.test.mjs`: stub each provider's `isAvailable`, assert selection per criterion 15.

**Validation gate**:
```bash
cd pforge-master && npx vitest run src/__tests__/reasoning-provider-selection.test.mjs --reporter=default
```
Expected: `Tests  4 passed (4)` (or more if existing tests in the file).

**Commit**: `feat(forge-master): Slice 2 — zero-key default via GitHub Models`

---

### Slice 3 — Skippable smoke test

**Complexity**: 2 (one vitest file, one script, one npm entry).

**Files to create**:
- `pforge-mcp/tests/forge-master.smoke.test.mjs`
- `scripts/smoke-forge-master.mjs`

**Files to extend**:
- `package.json` (root — add `smoke:forge-master` script)
- `.gitignore` — add `.forge/smoke/` only if `.forge/` is not already covered (check first)

**Steps**:
1. Write the smoke vitest with `describe.skipIf(!process.env.FORGE_SMOKE)(...)`. Import `runTurn` from `pforge-master/src/reasoning.mjs`. Invoke with the prompt in criterion 17. Assert lane, keyword presence, token count, 30 s timeout.
2. Write `scripts/smoke-forge-master.mjs` as a standalone Node entry. Use `import { runTurn }`. On success, write the transcript to `.forge/smoke/forge-master-${new Date().toISOString().replace(/[:.]/g, "-")}.md` with the exact markdown structure in criterion 27. On error, print to stderr and `process.exit(1)`.
3. Add `package.json` script. Use `cross-env` only if already a dep; otherwise document Windows usage (`set FORGE_SMOKE=1 && node scripts/smoke-forge-master.mjs`) in the script's header comment.
4. Confirm `.gitignore` already covers `.forge/` (it does per repo history). No edit needed.

**Validation gate**:
```bash
cd pforge-mcp && npx vitest run tests/forge-master.smoke.test.mjs --reporter=default
```
Expected: `Tests  0 passed | 1 skipped` (skipped because `FORGE_SMOKE` is unset in gate env). This proves the skipIf guard works; actual execution happens via `npm run smoke:forge-master` locally.

**Commit**: `feat(forge-master): Slice 3 — skippable end-to-end smoke test`

---

### Slice 4 — Release v2.67.0

**Complexity**: 3 (docs + version-bump dogfood + tag).

**Files to modify**:
- `VERSION`
- `CHANGELOG.md`
- `ROADMAP.md`
- `pforge-master/README.md`
- `docs/capabilities.md`

**Steps**:
1. Run `.\pforge.ps1 version-bump 2.67.0 --dry-run` and review the diff. Verify it matches expectations (dogfoods Phase-31.1's rebuild).
2. Run `.\pforge.ps1 version-bump 2.67.0 --strict`. Require `Updated 5/5`.
3. Promote `[Unreleased]` to `[2.67.0] — 2026-04-22` in CHANGELOG. Headline: `"**Forge-Master now works out of the box for GitHub Copilot subscribers — no API key required.**"` followed by bullets for Slice 1–3 deliverables.
4. Update ROADMAP.md: mark Phase-33 shipped; bump current version.
5. Add configuration section to `pforge-master/README.md` (or update existing): first bullet mentions zero-key setup via `gh auth login`, API keys as optional escape hatches.
6. Add provider table row for `githubCopilot` in `docs/capabilities.md` (table likely exists; if not, add minimal entry).
7. Commit as `chore(release): v2.67.0 — zero-key Forge-Master via GitHub Models`.
8. Tag: `git tag v2.67.0 && git push origin v2.67.0`.

**Validation gate**:
```bash
test -f VERSION && grep -q '^2.67.0' VERSION && grep -q '\[2.67.0\]' CHANGELOG.md && grep -q 'no API key required\|zero-key' CHANGELOG.md
```
Expected: exit 0.

**Commit**: `chore(release): v2.67.0 — zero-key Forge-Master via GitHub Models`

---

## Execution Order

1 → 2 → 3 → 4. No parallelism. Slice 2 depends on Slice 1's adapter; Slice 3 depends on Slice 2's selection wiring; Slice 4 depends on everything.

## Risks and Mitigations

- **Risk**: GitHub Models API envelope drifts from OpenAI-compatible. *Mitigation*: fixture-driven tests catch schema drift on the next fixture refresh; the live smoke test catches it immediately when run locally.
- **Risk**: `gh auth token` subprocess fails on systems without GitHub CLI. *Mitigation*: caught in `resolveGitHubToken`'s try/catch; falls through to other sources; `isAvailable()` returns false cleanly.
- **Risk**: Rate-limit error surfaces confusingly to end users. *Mitigation*: structured `{ error: "rate_limited", retryAfter }` is returned by the provider; the reasoning loop is expected to surface this as a user-readable message in a future phase. For now, it does not crash.
- **Risk**: Secrets UI reorder breaks existing dashboard state. *Mitigation*: the UI reads from a plain array; reordering entries changes render order only, not persistence keys. No migration needed.
- **Risk**: Smoke test flakiness when GitHub Models is slow. *Mitigation*: 30 s timeout is generous for `gpt-4o-mini`; skipIf guard keeps CI green.

## Session Break Points

- After Slice 2: provider path works end-to-end; smoke test and release can happen in a second session if needed.
- After Slice 3: everything functional; release can defer.

## Agent-handoff Status Template

On completion of each slice, emit (per `status-reporting.instructions.md`):

```
## Phase-33 — Slice N — <title>
Status: passed | failed
Duration: <mm:ss>
Gate: <one-line gate output>
Files changed: <count>
Next: Slice N+1 | complete
```
