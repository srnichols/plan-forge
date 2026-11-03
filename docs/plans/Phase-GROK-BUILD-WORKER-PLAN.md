---
phase: GROK-BUILD-WORKER
title: Grok Build CLI as a first-class worker backend
status: hardened
risk: medium
estimatedSlices: 7
lockHash: 819772a252b2264e41ffc0e865d91f9c8f4585523d2a778d60154017063f7c5c
---

# Phase GROK-BUILD-WORKER: Grok Build CLI as a first-class worker backend

> **Status**: 🟢 HARDENED — ready for Step 3 (execute slices)
> **Estimated Effort**: ~2.5 days (7 execution slices)
> **Risk Level**: Medium — new subprocess backend + cost path; fully additive and opt-in
> **Session budget**: 7 slices. Recommended break after **Slice 5** (worker backend complete); resume Slices 6–7 (config + surface) in a fresh session.

---

## Overview

Add **Grok Build** (xAI's terminal coding agent, binary `grok`) as a first-class CLI
worker backend alongside `gh-copilot`, `claude`, and `codex`. Today `grok-*` models
route only through the xAI **direct-API** path (single-shot completion, metered
per-token). Grok Build is *agentic* — it edits files, runs builds/tests, supports
`AGENTS.md`, hooks, MCP servers, and worktree subagents — so it belongs in the
CLI-worker slot where it can execute a whole slice autonomously and, on a SuperGrok /
X Premium+ subscription, bill at a flat rate.

This is **additive and opt-in**: GitHub Copilot CLI stays the default. Grok Build
becomes a selectable worker for `grok-*` / `grok-build-*` models and a diversity
member for quorum and competitive-worktree execution.

### Target operator workflow (the DX this phase must deliver)

The canonical operator keeps **GHCP + GHCP CLI as the everyday default** and wants
Grok reachable with *one* flag/toggle — never a hand-edit of the model list:

| Intent | Command / config | Behavior |
|--------|------------------|----------|
| **Default run** (unchanged) | `pforge run-plan <plan>` | gh-copilot CLI, single model — no Grok, no config |
| **Add Grok to *this* quorum run** (API, metered) | `pforge run-plan <plan> --quorum --with-grok` | Keeps the active quorum members and **appends** the flagship Grok (`grok-4.5`) via the xAI **API** (metered, needs `XAI_API_KEY`) — this is how Grok works today; no-op + note if no credential |
| **… but ride my Grok subscription instead** (CLI, flat) | `pforge run-plan <plan> --quorum --with-grok-cli` | Same additive member, but routed through the **Grok Build CLI** worker (flat subscription billing when logged in) |
| **Always add Grok to quorum** | `.forge.json → "quorum": { "includeGrok": "api" }` (or `"cli"`, or `true` = `"api"`) | Same additive behavior on every quorum run; still GHCP-first for solo runs |
| **Kick off a full run *through* Grok Build** | `pforge run-plan <plan> --worker grok` (opt. `--model grok-4.5`) | Whole plan executes via the `grok` CLI worker instead of gh-copilot |

`--worker grok` reuses the **existing** `--worker` flag (same mechanism as
`--worker copilot-coding-agent`) — it just needs the `grok` backend from Slices 1–5.
`--with-grok` / `--with-grok-cli` and `quorum.includeGrok` are the **new, additive**
ergonomics built in Slice 7. Defaults mirror today's behavior: the appended member is
the **flagship `grok-4.5` via API (metered)** unless you pick the `-cli` variant.
Nothing here changes the default (GHCP) behavior.

### Research facts (verified 2026-07-14 — do not re-research)

| Aspect | Finding | Source |
|--------|---------|--------|
| Binary | `grok` | docs.x.ai/build/overview |
| Install (PowerShell) | `irm https://x.ai/cli/install.ps1 \| iex` | x.ai/cli |
| Install (bash/WSL/mac) | `curl -fsSL https://x.ai/cli/install.sh \| bash` | docs.x.ai/build/overview |
| Headless invocation | `grok -p "<prompt>" --output-format streaming-json` | docs.x.ai/build/overview |
| Model select | `-m <model>` (e.g. `-m grok-4.5`); TUI `/model <name>` | docs.x.ai/build/overview |
| Auth (subscription) | browser OAuth on first launch (SuperGrok / X Premium+) → flat-rate | x.ai/news/grok-build-cli |
| Auth (headless/CI) | `export XAI_API_KEY="xai-..."` → metered per-token | docs.x.ai/build/overview |
| Config file | `~/.grok/config.toml` (Windows `%USERPROFILE%\.grok\config.toml`) | docs.x.ai/build/overview |
| Inspect | `grok inspect` (shows config, instructions, skills, plugins, hooks, MCP) | docs.x.ai/build/overview |
| Also supports | ACP (Agent Client Protocol), deep worktree subagents, plan mode | x.ai/cli |
| Pricing — `grok-build-0.1` | $1.00 in / $2.00 out per 1M, 256k ctx (Code API) | docs.x.ai/docs/models |
| Pricing — `grok-4.5` (powers CLI) | $2.00 in / $6.00 out per 1M, 500k ctx | docs.x.ai/docs/models |

> Pricing is already correct in `cost-service.mjs` MODEL_PRICING and
> `pforge-master/src/cost.mjs` TURN_PRICING as of the v3.23.0 model refresh.

### Billing model — one CLI, two auth modes (do not conflate)

Grok Build is a **single product** (the `grok` CLI). How you authenticate it decides
how it bills. `grok-cli` below is only Plan Forge's *internal provider label* for the
flat path — it is **not** a separate xAI product.

| Auth mode | How | Billing | Plan Forge cost path |
|-----------|-----|---------|---------------------|
| **Subscription** | `grok` browser login (SuperGrok / X Premium+) | **Flat** — bundled in the monthly subscription, *not* per-token | `SUBSCRIPTION_PROVIDERS` (flat per-request, like `gh-copilot`) |
| **API key** | `export XAI_API_KEY="xai-..."` | **Metered** — per-token, billed to xAI API credits | token path via `MODEL_PRICING` (same surface as today's direct-API `grok-*`) |

> ⚠️ `XAI_API_KEY` is the **metered** path, NOT flat. The flat rate comes from the
> **subscription browser login**. Note the naming trap: **`grok-build-0.1`** is a
> *model* on the xAI Code API (metered $1/$2), while **Grok Build** is the *CLI agent*
> (default model `grok-4.5`, `-m` overridable). Model name and billing surface are decoupled.

---

## Scope Contract

### In scope

- New `grok` worker entry in `pforge-mcp/worker-capabilities.json`.
- Routing so `grok-*` / `grok-build-*` prefer the `grok` CLI **when installed**, else fall back to the existing xAI direct-API path (mirrors the `gpt-*` gh-copilot-vs-OpenAI host-aware pattern).
- Parser for `--output-format streaming-json` → tokens + final result.
- Cost path: **subscription auth → flat** `grok-cli` provider (`SUBSCRIPTION_PROVIDERS`); **`XAI_API_KEY` auth → metered** token path via `MODEL_PRICING`.
- Preflight auth detection for the `grok` worker.
- Config ergonomics: `--with-grok` / `--with-grok-cli` flags + `quorum.includeGrok` (`api`/`cli`) additive quorum member (`grok-4.5` default).
- Capability-surface + doc + dashboard exposure; regenerate `tools.json` + golden.

### Out of scope

- ACP-server integration (separate future phase).
- Grok Build plugins/skills/hooks marketplace interop.
- Changing any existing default model or quorum preset (v3.23.0 already refreshed those).
- TUI/interactive mode — Plan Forge only ever invokes `grok -p` headless.

### Forbidden Actions (PreToolUse-enforced — do NOT touch)

- **Do NOT** alter the existing subscription-CLI cost path for `gh-copilot` / `claude-cli` / `codex-cli`. `costForLeg()` must stay byte-identical (v2.83.0 invariant / Forbidden Action #1).
- **Do NOT** change the current `grok-*` direct-API behavior when the `grok` CLI is absent — API-first users must see zero regression.
- **Do NOT** change any existing default model, quorum preset, or reviewer (v3.23.0 owns those).
- **Do NOT** use `exec(string)` / `execSync(string-with-input)` / `Invoke-Expression` on any user-influenced value — `spawn(cmd, [args])` only (security.instructions.md Rule 1).
- **Do NOT** let the `grok` worker run with `cwd` pointing at the operator's real repo — it must run in an isolated `cwd` with its own `.git` (worker-spawn.mjs cwd caveat).
- **Do NOT** make `--with-grok` / `includeGrok` remove, reorder, or displace an operator-declared quorum member — append-only.
- **Do NOT** edit files outside the change manifest below without updating the manifest.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Default worker when both `gh-copilot` and `grok` are present, no override | ✅ Resolved | `gh-copilot` wins. Grok is opt-in only (`--worker grok` / `--with-grok*` / `includeGrok`). |
| 2 | `--with-grok` default model + billing | ✅ Resolved | Flagship `grok-4.5` via xAI **API** (metered). `--with-grok-cli` / `includeGrok:"cli"` switches to Grok Build CLI (flat). Overridable via `quorum.grokModel`. |
| 3 | How to detect subscription vs API-key auth for a `grok` invocation | 🟡 Open — resolve in Slice 4 | Heuristic: `XAI_API_KEY` present → metered token path; absent + `grok` CLI authed → flat subscription path. Confirm against `grok inspect` output during Slice 4. |
| 4 | `streaming-json` event schema (does it emit `usage` / `cost_in_usd_ticks`?) | 🟡 Open — resolve in Slice 3 | Capture a real transcript fixture in Slice 3; if no token/cost fields, fall back to heuristic token estimate and flag a telemetry gap. |
| 5 | Expose `grok-build-0.1` as a distinct routable model? | ✅ Resolved | No — treat the CLI as `grok-4.5`-backed with `-m` override. `grok-build-0.1` stays an API-only model entry. |

> Decisions #3 and #4 require a machine with the `grok` CLI installed + authed. They are
> **execution-time discoveries**, scoped inside their slices with graceful fallbacks — they
> do not block starting the phase.

---

## Acceptance Criteria

- **MUST**: `pforge run-plan <plan>` with no flags still uses gh-copilot with no Grok, even when the `grok` CLI is installed (default unchanged).
- **MUST**: With `grok` on PATH + authed, `pforge run-plan <plan> --worker grok` executes a slice end-to-end via the `grok` CLI worker.
- **MUST**: `grok-*` model with no `grok` CLI still routes to the xAI API unchanged (no regression).
- **MUST**: `--quorum --with-grok` appends exactly one member — flagship `grok-4.5` via the xAI API — when `XAI_API_KEY` exists, and is a graceful no-op (with a note) when it doesn't; it never removes or reorders existing members.
- **MUST**: The existing subscription-CLI cost path (`gh-copilot` / `claude-cli` / `codex-cli`) is byte-identical (`costForLeg()` regression assertion passes).
- **MUST**: No `exec(` / `Invoke-Expression` on user-influenced strings is introduced.
- **MUST**: Full `vitest` suite green; server-surface golden regenerated intentionally (diff limited to Grok additions).
- **SHOULD**: `--with-grok-cli` (and `includeGrok: "cli"`) routes the appended member through the Grok Build CLI (flat) when the `grok` CLI is available.
- **SHOULD**: Cost report shows flat subscription cost when subscription-authed, per-token when `XAI_API_KEY`-only.
- **SHOULD**: `forge_capabilities` and the Dashboard advertise the `grok` backend and an "Include Grok in quorum" toggle with an API/CLI selector.

---

## Execution Slices

> Gate convention: `npm --prefix pforge-mcp test -- <file>` runs the correct vitest
> from the package root without a `cd`/`bash -c` wrapper (cross-platform, lint-clean).
> `node pforge-mcp/server.mjs --validate` regenerates `tools.json` + `cli-schema.json`.
> All non-vitest checks are `node -e` one-liners (no `grep`/pipes/`||`). Slices touching
> `worker-spawn.mjs` (2, 3, 5) are strictly sequential to avoid merge conflicts.

### Slice 1 — Worker capability entry (`grok`)  `[sequential]`
**Depends On**: none (foundational)
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`
**Files**: `pforge-mcp/worker-capabilities.json`, `pforge-mcp/tests/worker-capability.test.mjs`

**Tasks**:
1. Add a `grok` block to `worker-capabilities.json` mirroring the `codex`/`claude` shape: `versionArgs` (e.g. `["--version"]`), `capabilityMarkers`, headless `invocation` template (`-p <promptFile> --output-format streaming-json -m <model>`), min version, and per-OS `install` hints (`irm https://x.ai/cli/install.ps1 | iex` / `curl -fsSL https://x.ai/cli/install.sh | bash`).
2. Extend `worker-capability.test.mjs` to assert the new entry's required keys.

**Validation Gate**:
```bash
node -e "const j=require('./pforge-mcp/worker-capabilities.json');if(!j.workers?.grok)throw new Error('grok worker entry missing');console.log('ok')"
npm --prefix pforge-mcp test -- tests/worker-capability.test.mjs
```
**Stop Condition**: malformed JSON or missing required keys → STOP.

### Slice 2 — Routing (`grok` CLI preferred when installed, API fallback)  `[sequential]`
**Depends On**: Slice 1
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`
**Files**: `pforge-mcp/orchestrator/worker-spawn.mjs`, `pforge-mcp/tests/quorum-probe.test.mjs`, `pforge-mcp/tests/host-routing-preference.test.mjs`

**Tasks**:
1. Update `resolveRequiredCli()`: `grok-*` / `grok-build-*` → `grok` CLI.
2. Add a `GROK_CLI_SERVABLE` concept parallel to `COPILOT_SERVABLE`: when the `grok` worker is available, prefer CLI; otherwise fall through to the existing `DIRECT_API_ONLY` xAI path. Gate CLI preference behind a `.forge.json` routing preference so it is opt-in and API-first users are unaffected.
3. Ensure `isDirectApiOnlyModel()` still returns the API path when the `grok` CLI is absent.

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- tests/quorum-probe.test.mjs tests/host-routing-preference.test.mjs
node -e "const s=require('fs').readFileSync('pforge-mcp/orchestrator/worker-spawn.mjs','utf8').replace(/execSync/g,'').replace(/execFile/g,'');if(/\bexec\(/.test(s))throw new Error('raw exec introduced');console.log('ok')"
```
**Stop Condition**: any existing quorum-probe assertion regresses for `grok-*` API routing → STOP.

### Slice 3 — `streaming-json` output parser  `[parallel-safe — Group A]`
**Depends On**: Slice 1 (invocation template). Independent of Slice 4 (different file).
**Context Files**: `.github/instructions/testing.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/clean-code.instructions.md`
**Files**: `pforge-mcp/orchestrator/worker-spawn.mjs`, `pforge-mcp/tests/fixtures/grok-streaming-json.jsonl`, `pforge-mcp/tests/grok-stream-parse.test.mjs`

> ⚠️ Group A parallelism is with **Slice 4 only** (cost-service.mjs). Slice 3 shares
> `worker-spawn.mjs` with Slices 2 and 5, so it must run **after Slice 2** and **before Slice 5**.

**Tasks**:
1. Capture a real `grok -p "..." --output-format streaming-json` transcript into `tests/fixtures/grok-streaming-json.jsonl` (resolves Required Decision #4).
2. Add a Grok branch to the worker-result finalizer (`finalizeWorkerResult` / `extractTokens` / `parseStderrStats`) mapping Grok's stream events → `{ output, tokens_in, tokens_out, cost_in_usd_ticks?, exitCode }`.
3. Unit-test the parser against the fixture (happy path + truncated / no-token fallback).

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- tests/grok-stream-parse.test.mjs
```
**Stop Condition**: parser cannot recover token counts from the fixture → record the telemetry gap, fall back to heuristic token estimate (flag, do not hard-block).

### Slice 4 — Cost path (flat subscription vs metered API-key)  `[parallel-safe — Group A]`
**Depends On**: Slice 2 (routing sets `worker=grok`). Independent of Slice 3 (different file).
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/testing.instructions.md`, `.github/instructions/clean-code.instructions.md`
**Files**: `pforge-mcp/cost-service.mjs`, `pforge-mcp/tests/detect-cost-model.test.mjs`, `pforge-mcp/tests/cost-service.test.mjs`

**Tasks**:
1. Add `"grok-cli"` to `SUBSCRIPTION_PROVIDERS` — the **flat** (subscription-authed) path only.
2. `detectCostModel()` auth-mode branch (resolves Required Decision #3): worker is `grok` **and** `XAI_API_KEY` **absent** → **flat** `grok-cli` per-request path; `XAI_API_KEY` **present** → **token** path via the (already-correct) `grok-*` MODEL_PRICING. ⚠️ Do NOT treat `XAI_API_KEY` as flat.
3. Add a regression assertion that `costForLeg()` stays byte-identical for `gh-copilot` / `claude-cli` / `codex-cli` (v2.83.0 invariant).

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- tests/detect-cost-model.test.mjs tests/cost-service.test.mjs
node --input-type=module -e "import{SUBSCRIPTION_PROVIDERS}from'./pforge-mcp/cost-service.mjs';if(!SUBSCRIPTION_PROVIDERS.has('grok-cli'))throw new Error('grok-cli not registered');console.log('ok')"
```
**Stop Condition**: any change to existing subscription-CLI cost math → STOP (Forbidden Action #1).

### 🔄 Parallel Merge Checkpoint (after Group A: Slices 3 + 4)
Re-run both suites together to confirm the worker-spawn parser change and the cost-service change compose cleanly:
```bash
npm --prefix pforge-mcp test -- tests/grok-stream-parse.test.mjs tests/detect-cost-model.test.mjs tests/cost-service.test.mjs
```

### Slice 5 — Preflight auth gate  `[sequential]`
**Depends On**: Slices 1, 2, 3 (worker + routing + parser)
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`
**Files**: `pforge-mcp/orchestrator/worker-spawn.mjs`, `pforge-mcp/tests/worker-backend-preflight.test.mjs`

**Tasks**:
1. Add a `grok` branch to `assertWorkerBackendReady()`: if resolved to `grok` and the binary is missing/unauthenticated → actionable failure (install hint + "sign in with `grok`" or "set `XAI_API_KEY`").
2. Preserve the rule that direct-API-only `grok-*` (no CLI) is validated by `spawnWorker`'s own key check.

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- tests/worker-backend-preflight.test.mjs
```
**Stop Condition**: preflight blocks a valid gh-copilot/claude/codex run → STOP (regression).

### 🧭 Re-anchor Checkpoint (end of Session 1 — Slices 1–5)
Re-read this plan's **Scope Contract** and **Forbidden Actions**. Confirm: (a) the worker
backend is complete and API-first behavior is unregressed; (b) no existing subscription-CLI
cost math changed; (c) all worker-spawn.mjs edits landed sequentially with no merge damage.
Commit progress. Recommended: resume Slices 6–7 in a fresh session.

### Slice 6 — Surface, docs, dashboard, regen  `[sequential]`
**Depends On**: Slices 1–5
**Context Files**: `.github/instructions/aci-design.instructions.md`, `.github/instructions/clean-code.instructions.md`
**Files**: `pforge-mcp/capabilities/surface.mjs`, `docs/capabilities.md`, `docs/CLI-GUIDE.md`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/tools.json`, `pforge-mcp/cli-schema.json`, `pforge-mcp/tests/fixtures/server-surface.golden.json`

**Tasks**:
1. Advertise the `grok` worker in the capability surface (`capabilities/surface.mjs`) and worker docs.
2. Add `grok` / "Grok Build" to the Dashboard worker UI.
3. Update `docs/capabilities.md` (worker table) + `docs/CLI-GUIDE.md` (worker section) noting `--worker grok`, install, and dual-auth.
4. Regenerate `tools.json` + `cli-schema.json` (`node pforge-mcp/server.mjs --validate`); regenerate the server-surface golden; sync `docs/capabilities.md` (`node scripts/generate-capabilities-doc.mjs`).

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
npm --prefix pforge-mcp test -- tests/server-surface-snapshot.test.mjs tests/capabilities.test.mjs
```
**Stop Condition**: golden diff contains anything beyond intended worker/description additions → STOP and review.

### Slice 7 — Config ergonomics (`--with-grok`, `--with-grok-cli`, `quorum.includeGrok`, dashboard toggle)  `[sequential]`
**Depends On**: Slices 2, 4
**Context Files**: `.github/instructions/architecture-principles.instructions.md`, `.github/instructions/security.instructions.md`, `.github/instructions/testing.instructions.md`
**Files**: `pforge-mcp/orchestrator/quorum.mjs`, `pforge-mcp/orchestrator/run-plan.mjs`, `pforge-mcp/capabilities/schemas.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/dashboard/app.js`, `pforge-mcp/tests/quorum-probe.test.mjs`, `pforge-mcp/tests/orchestrator.test.mjs`

**Tasks**:
1. **`quorum.includeGrok`**: accepts `false` (default) | `true`/`"api"` (metered) | `"cli"` (Grok Build CLI, flat). In `loadQuorumConfig()` / `buildQuorumConfigForMode()`, when enabled **and** the matching credential is available (`"api"` → `XAI_API_KEY`; `"cli"` → grok CLI authed), **append** flagship `grok-4.5` (overridable via `quorum.grokModel`) to the resolved `models` array if no grok member is already present. For `"cli"`, tag that member so dispatch routes it through the `grok` worker. Missing credential → skip + advisory (never hard-fail). Purely **additive**.
2. **`--with-grok` / `--with-grok-cli` CLI flags** (`pforge.ps1` + `pforge.sh` + `run-plan.mjs` arg parse): per-run overrides forcing `includeGrok="api"` / `"cli"` respectively (implies `--quorum` if off). Add both to both shells' usage strings (dual-shell parity).
3. **JSON schema** (`capabilities/schemas.mjs`): add `quorum.includeGrok` (enum `false|true|"api"|"cli"`, default `false`) and `quorum.grokModel` (string, default `"grok-4.5"`).
4. **Dashboard**: "Include Grok in quorum" checkbox + an **API (metered) / Grok Build CLI (subscription)** selector, wired via the existing `GET/POST /api/config` atomic-merge path.
5. Tests: appends exactly one `grok-4.5` member when the matching credential is present, no-ops without it, never duplicates/displaces existing members; `"cli"` tags the member for the grok worker; `--with-grok*` parity across both shells.

**Validation Gate**:
```bash
npm --prefix pforge-mcp test -- tests/quorum-probe.test.mjs tests/orchestrator.test.mjs
node -e "const s=require('fs').readFileSync('pforge-mcp/capabilities/schemas.mjs','utf8');for(const k of ['includeGrok','grokModel'])if(!s.includes(k))throw new Error(k+' missing from schema');console.log('ok')"
node -e "const fs=require('fs');for(const f of ['pforge.ps1','pforge.sh'])if(!fs.readFileSync(f,'utf8').includes('with-grok'))throw new Error('with-grok missing from '+f);console.log('ok')"
```
**Stop Condition**: `includeGrok` / `--with-grok*` removes or reorders an operator-declared member, defaults to anything other than `grok-4.5` via API, or hard-fails when no Grok credential exists → STOP (must be additive, API-default, graceful).

---

## Re-anchor Checkpoints

- **After Group A (Slices 3+4)** — Parallel Merge Checkpoint above.
- **End of Slice 5** — Re-anchor Checkpoint above (worker backend complete; verify no regressions; recommended session break).
- **Before Slice 6** — confirm Slices 1–5 committed and green before regenerating `tools.json` + golden (Slice 6 codifies the final surface).

---

## Definition of Done

- [ ] All 7 slices' validation gates pass.
- [ ] Every **MUST** acceptance criterion is satisfied and traceable to a slice gate.
- [ ] Full `vitest` suite green in both `pforge-mcp` and `pforge-master`.
- [ ] `tools.json`, `cli-schema.json`, and the server-surface golden regenerated; `docs/capabilities.md` synced (`capabilities-drift` clean).
- [ ] Dual-shell parity: `--with-grok` / `--with-grok-cli` present and behaving identically in `pforge.ps1` and `pforge.sh`.
- [ ] No secrets in diff; no `exec(`/`Invoke-Expression` on user input introduced (`forge_secret_scan` clean).
- [ ] CHANGELOG entry added; VERSION bumped.
- [ ] **Reviewer Gate passed (zero 🔴 Critical)** — independent Step 5 review in a fresh session.

---

## Stop Conditions

- **Build/parse failure**: any gate command exits non-zero → STOP, diagnose, fix before proceeding.
- **Test failure**: any existing test regresses (especially subscription-CLI cost, quorum-probe API routing, worker-backend-preflight) → STOP.
- **Scope violation**: an edit touches a file outside the change manifest, or changes a v3.23.0 default/preset → STOP, revert, re-scope.
- **Security breach**: introduction of `exec(`/`execSync(string)`/`Invoke-Expression` on user-influenced input, or a `grok` worker `cwd` pointing at the operator's real repo → STOP immediately.
- **Additive-invariant breach**: `--with-grok`/`includeGrok` removes or reorders an existing quorum member → STOP.

---

## Rollback Plan

1. **Routing / config**: the `.forge.json` routing-preference gate and `quorum.includeGrok` default to off/false — unsetting fully restores v3.23.0 behavior (grok-* → API, no add-in).
2. **Code**: single commit per slice; revert the slice commit(s). The `grok` worker entry in `worker-capabilities.json` is inert unless the binary is present.
3. **Cost/config**: removing `"grok-cli"` from `SUBSCRIPTION_PROVIDERS` reverts cost routing; no persisted-state migrations.

---

## File-Level Change Manifest

| File | Slice(s) | Change |
|------|----------|--------|
| `pforge-mcp/worker-capabilities.json` | 1 | Add `grok` worker entry |
| `pforge-mcp/tests/worker-capability.test.mjs` | 1 | Assert `grok` entry keys |
| `pforge-mcp/orchestrator/worker-spawn.mjs` | 2, 3, 5 | Routing (`resolveRequiredCli`, `GROK_CLI_SERVABLE`), stream parser branch, preflight branch |
| `pforge-mcp/tests/quorum-probe.test.mjs` | 2, 7 | Routing + includeGrok assertions |
| `pforge-mcp/tests/host-routing-preference.test.mjs` | 2 | grok CLI-vs-API preference |
| `pforge-mcp/tests/fixtures/grok-streaming-json.jsonl` | 3 | Captured output fixture |
| `pforge-mcp/tests/grok-stream-parse.test.mjs` | 3 | Parser unit tests |
| `pforge-mcp/cost-service.mjs` | 4 | `grok-cli` in `SUBSCRIPTION_PROVIDERS`; `detectCostModel` auth branch |
| `pforge-mcp/tests/detect-cost-model.test.mjs` | 4 | Auth-mode + byte-identical regression |
| `pforge-mcp/tests/cost-service.test.mjs` | 4 | Cost-path assertions |
| `pforge-mcp/tests/worker-backend-preflight.test.mjs` | 5 | grok preflight |
| `pforge-mcp/capabilities/surface.mjs` | 6 | Advertise `grok` worker |
| `pforge-mcp/capabilities/schemas.mjs` | 7 | `quorum.includeGrok` + `quorum.grokModel` |
| `pforge-mcp/orchestrator/quorum.mjs` | 7 | Additive `includeGrok` member logic |
| `pforge-mcp/orchestrator/run-plan.mjs` | 7 | `--with-grok` / `--with-grok-cli` arg parse |
| `pforge.ps1`, `pforge.sh` | 7 | Flags + usage strings (dual-shell parity) |
| `pforge-mcp/dashboard/index.html`, `pforge-mcp/dashboard/app.js` | 6, 7 | Worker option + includeGrok toggle |
| `pforge-mcp/tools.json`, `pforge-mcp/cli-schema.json` | 6 | Regenerated |
| `pforge-mcp/tests/fixtures/server-surface.golden.json` | 6 | Regenerated |
| `docs/capabilities.md`, `docs/CLI-GUIDE.md` | 6 | Worker docs |
| `CHANGELOG.md`, `VERSION` | Ship | Entry + bump |

---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice (portable) | ✅ |
| 3 | Stop conditions (build/test/scope/security) | ✅ |
| 4 | Rollback plan (3 tiers) | ✅ |
| 5 | Anti-pattern grep/`node -e` commands | ✅ |
| 6 | File-level change manifest | ✅ |
