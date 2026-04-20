---
crucibleId: 9b3d5e72-ac48-4f61-b925-e8d4f2a6c107
source: self-hosted
status: draft
phase: HOTFIX-2.50.1
---

# Phase HOTFIX-2.50.1: Orchestrator plumbing bundle

> **Status**: 📝 DRAFT — ready for Session 2 execution
> **Estimated Effort**: 3 slices (one per field bug)
> **Risk Level**: Low-medium (each slice narrowly scoped; no new
> surfaces; tests prove the fix)
> **Target Version**: v2.50.1

---

## Why

Three field-reported orchestrator bugs accumulated during the
FORGE-SHOP arc. None are severe enough to block daily use, but they
add friction for multi-model setups and pollute audit trails. This
hotfix bundles all three into one patch release for efficient
review + rollout.

- **#63** — Cost/token tracking returns `\` and model `unknown` for
  gh-copilot worker. Cost reports are wrong; escalation chains can't
  learn because model attribution is lost.
- **#73** — `model-performance.json` is not runtime-aware. Quorum
  resolution can pick an unavailable model, falling back to
  single-model mid-run with no upfront warning. H.3 from v2.49.1 fixed
  worker-availability probing; this issue extends to performance-tier
  validation.
- **#74** — PreCommit hook does not reject direct-to-master commits
  during `run-plan` execution. Workers occasionally commit straight
  to master (recurring on every phase), forcing manual branch+reset
  dance after-the-fact.

Each is independently valuable. Shipping together minimizes CI
churn and testing overhead.

## Scope Contract

### In-scope

**Slice 1 — #63 cost/token model attribution for gh-copilot worker**

- Problem: `orchestrator.mjs` `parseTokenUsage()` currently returns
  `{ model: null, ... }` for gh-copilot worker output. Downstream
  `buildCostReport()` maps null → `"unknown"`, breaking cost
  breakdown by model and the escalation-chain calibration loop
- Fix:
  - Extend `parseTokenUsage()` to read `--model <name>` arg passed
    to gh-copilot spawn; plumb through `workerContext.model` into
    the `tokens` object before `slice-completed` event emission
  - For quorum legs, each leg already carries its own model; the fix
    only addresses the default (non-quorum) path where the CLI arg
    is the canonical source
  - `tokens.model` now: non-null string matching the `--model` value
    (e.g., `"claude-opus-4.6"`); null only when gh-copilot was
    invoked without `--model` (unusual; preserve existing behavior)
  - Deduplicate the trailing `\` in `premiumRequests` string-to-int
    coercion (root cause: PowerShell piping inserts trailing
    backslash on some locales); strip `[\r\n\\]+$` before parsing
- `buildCostReport()`: when `tokens.model` is non-null, use it as
  the `by_model` key; remove the `"unknown"` catch-all bucket unless
  a leg genuinely has no model
- Hub event: `slice-completed` payload `tokens.model` now populated
- Backward-compat: consumers reading `tokens.model` may see a real
  value where before they got null. Dashboard cost panel updates
  to show per-model rows
- Tests in `pforge-mcp/tests/orchestrator-token-attribution.test.mjs`
  (**new**, ~10 tests):
  - gh-copilot worker spawned with `--model claude-opus-4.6` →
    `tokens.model === "claude-opus-4.6"`
  - No-model invocation → `tokens.model === null`
  - Trailing `\r`, `\n`, `\\` stripped from `premiumRequests` int
    coercion
  - `buildCostReport()` emits `by_model[<actualModel>]` not
    `by_model.unknown` when model resolved
  - Quorum leg passthrough unchanged (each leg already has model)
  - PowerShell fixture simulating backslash-polluted output

**Slice 2 — #73 runtime-aware model-performance.json validation**

- Problem: `.forge/model-performance.json` is consulted at run-start
  to pick escalation targets. If the file references
  `grok-4.20-0309-reasoning` but no XAI_API_KEY is set, the escalation
  lookup succeeds (file is valid JSON), then the spawn fails mid-run
- Fix:
  - New helper `validatePerformanceTier(tier, availableModels)` in
    `orchestrator.mjs` (~50 LOC):
    - Input: tier object from performance JSON +
      `availableModels: string[]` from the run-start H.3 probe
    - Output: `{ ok: boolean, unavailableModels: [...],
      degradedTier: {...} | null }`
    - When an escalation target is not in `availableModels`, **drop
      it** from the tier and log `warn`. If the tier becomes empty,
      mark `ok: false` and fall back to the next tier
  - Wire-in: call `validatePerformanceTier()` at run-start, **after**
    the existing quorum availability probe, **before** escalation
    chain resolution
  - Emit `performance-tier-degraded` hub event when a tier is
    modified; payload: `{ tier, original: [...], degraded: [...],
    reason }`
  - New `.forge.json` config: `performance.strictValidation` (default
    `false`). When `true`, a degraded tier fails the run instead of
    warning
- CLI flag: `--no-perf-validation` skips the check (useful for debug)
- Tests in `pforge-mcp/tests/orchestrator-perf-validation.test.mjs`
  (**new**, ~8 tests):
  - All models available → tier unchanged
  - Unavailable model in tier → dropped, warn emitted, event emitted
  - All models in tier unavailable → tier `ok: false`, fallback used
  - `strictValidation: true` + degraded tier → run fails with exit 2
  - `--no-perf-validation` skips the check entirely
  - Regression: bundle with #63 doesn't break quorum leg attribution

**Slice 3 — #74 PreCommit hook rejects direct-to-master during run-plan**

- Problem: Workers occasionally run `git commit` on the master branch
  during a slice. Current PreCommit hook (from v2.31+) warns but
  doesn't block. Recurring across every phase; manual cleanup
  (branch + reset --hard + PR) adds overhead
- Fix:
  - `.github/hooks/PreCommit.mjs` — extend existing hook:
    - If `PFORGE_RUN_PLAN_ACTIVE=1` env var is set (set by
      `orchestrator.mjs` before spawning the worker) AND the current
      branch is the configured default branch (`master`/`main`),
      **reject the commit** with exit code 1 and message:
      ```
      PreCommit blocked: direct commit to <branch> during run-plan.
      Create a feature branch first:
        git checkout -b feat/<phase-id>-slice-<n>
      Hotfix: set PFORGE_ALLOW_MASTER_COMMIT=1 to bypass (not recommended).
      ```
    - Default-branch detection: read
      `git config init.defaultBranch` first, then check
      `git symbolic-ref refs/remotes/origin/HEAD` (fallback to
      `master`)
    - Bypass: `PFORGE_ALLOW_MASTER_COMMIT=1` environment variable
      (uppercase, not a git config — explicit per-invocation opt-in)
    - Outside `run-plan` (no env var set) the hook remains advisory
      — unchanged behavior for human commits
  - `orchestrator.mjs` — set `PFORGE_RUN_PLAN_ACTIVE=1` in the worker
    spawn's `env` block before fork; unset after slice completes
    (ensures the hook only blocks during active execution)
  - Plan writer guidance: the hotfix message tells workers to create
    a branch. Existing plan hardening already requires this; the hook
    now enforces it at runtime
- `.forge.json` config: `hooks.preCommit.rejectMasterDuringRun`
  (default `true`). Users who explicitly want the old advisory
  behavior can set it to `false`
- Tests in `pforge-mcp/tests/hook-precommit-master.test.mjs`
  (**new**, ~10 tests):
  - Env var unset → advisory (legacy behavior preserved)
  - Env var set + master branch → exit 1, stderr matches pattern
  - Env var set + feature branch → allowed
  - Env var set + master + bypass flag → allowed with warn
  - Default branch detection: `main` honored as well as `master`
  - Config `rejectMasterDuringRun: false` → advisory regardless
  - Orchestrator env set + unset lifecycle (before/after slice)
  - Integration smoke: spawn a fake worker that attempts a master
    commit during run-plan, assert it fails with expected message

### Out of scope (later)

- Rewriting the commit model attribution for other workers (Claude
  CLI direct, Grok direct) — gh-copilot is the dominant path; others
  already carry their model end-to-end
- Auto-suggesting a branch name in the PreCommit hook rejection —
  the phase ID comes from the plan file; hook doesn't have plan
  context. The error message points at the convention; extension
  can land later
- Migrating all warn-level hooks to strict by default — each hook
  has its own migration story; this phase only touches PreCommit
- Cost-report UI in dashboard — Slice 1 fixes data layer only; the
  dashboard Cost panel will start showing per-model rows
  automatically as a side effect

### Forbidden actions

- Do NOT change the existing `quorum.strictAvailability` semantics
  from #70 — Slice 2 adds a **separate** `performance.strictValidation`
  flag. Quorum and performance-tier validation are distinct failure
  modes
- Do NOT make PreCommit hook reject master commits by **default when
  `PFORGE_RUN_PLAN_ACTIVE` is not set** — human commits outside
  run-plan must remain advisory. Explicit opt-in only for the
  run-plan lifecycle
- Do NOT swallow the `premiumRequests` parse error silently — if
  the stripped value still fails to parse, emit a warn with the raw
  bytes so future locale issues are diagnosable
- Do NOT introduce a new MCP tool — hotfix scope is orchestrator +
  hook internals only
- Do NOT churn `tools.json` — no TOOL_METADATA changes this phase
- Do NOT add new hub events beyond `performance-tier-degraded` —
  Slice 1 and Slice 3 reuse existing events
- Do NOT modify `.forge/model-performance.json` schema itself —
  Slice 2 validates the existing schema; schema changes are a
  separate concern
- Do NOT stash or reset working tree state in the hook — reject
  before any state mutation

## Slices

### Slice 1 — #63 cost/token model attribution for gh-copilot worker

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `parseTokenUsage()`,
  `buildCostReport()`, PowerShell `premiumRequests` sanitize
  (~40 LOC net change)
- `pforge-mcp/tests/orchestrator-token-attribution.test.mjs` —
  **new**, ~10 tests

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test in
PR body: invoke a 1-slice plan with gh-copilot + `--model
claude-opus-4.6`, assert `slice-completed` event payload
`tokens.model === "claude-opus-4.6"` and cost report
`by_model.claude-opus-4.6` populated.

### Slice 2 — #73 runtime-aware model-performance.json validation

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `validatePerformanceTier()`,
  run-start wire-in, `performance-tier-degraded` event emission
  (~60 LOC)
- `pforge.ps1` + `pforge.sh` — `--no-perf-validation` CLI flag
  plumbing (~10 LOC each)
- `pforge-mcp/tests/orchestrator-perf-validation.test.mjs` —
  **new**, ~8 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — all
pass. Manual smoke-test: set `.forge/model-performance.json` with
an unavailable model, run a 1-slice plan, assert warn logged and
tier degraded, slice completes with fallback model.

### Slice 3 — #74 PreCommit hook rejects direct-to-master during run-plan

**Files touched:**
- `.github/hooks/PreCommit.mjs` — reject-master logic, default-branch
  detection, bypass flag (~50 LOC)
- `pforge-mcp/orchestrator.mjs` — `PFORGE_RUN_PLAN_ACTIVE` env
  lifecycle around worker spawn (~8 LOC)
- `.forge.json` schema defaults: `hooks.preCommit.rejectMasterDuringRun`
- `pforge-mcp/tests/hook-precommit-master.test.mjs` — **new**, ~10
  tests

**Validation gate:**
`cd pforge-mcp; npm test -- --run` — all pass. Manual smoke-test:
spawn a test worker under `run-plan` env that attempts
`git commit` on master, assert it exits with code 1 and stderr
matches the "PreCommit blocked" message.

## Success Criteria

- Slice 1: `slice-completed.tokens.model` is non-null for gh-copilot
  workers invoked with `--model <name>`; `buildCostReport()`
  `by_model` keys are real model names, not `"unknown"` (except
  for genuinely model-less invocations)
- Slice 2: a tier with an unavailable model is degraded at run-start
  with a `performance-tier-degraded` event; empty tier falls back
  to the next tier; `strictValidation: true` fails fast with exit 2
- Slice 3: direct commits to master during `run-plan` execution are
  rejected with exit 1; human commits outside `run-plan` remain
  advisory; bypass flag works
- Zero new TODO/FIXME/stub markers on touched files
- Test count +28
- CHANGELOG entry under `[Unreleased]` targeting v2.50.1 (patch)
- `Phase-HOTFIX-2.50.1.md` `status: draft` → `in_progress` →
  `complete`
- Issues #63, #73, #74 closed with commit refs

## Dependencies

**From prior phases:**
- v2.49.1 hotfix H.3 — worker availability probe (runs before
  Slice 2's tier validation; Slice 2 reads its `availableModels`
  output)
- Existing PreCommit hook from v2.31+ (advisory baseline that
  Slice 3 extends)
- Existing `parseTokenUsage()` in `orchestrator.mjs` (Slice 1
  extends, does not replace)

**On later phases:**
- FORGE-SHOP-05 timeline — `performance-tier-degraded` events land on
  timeline as `source: "hub-event"` entries (no change needed)
- Self-recursive escalation chains (v2.47.0) — Slice 1's correct
  model attribution unblocks accurate escalation learning

## Release notes

Patch release v2.50.1 after FORGE-SHOP-03/04/05 land. Target version
depends on shipping order; if SHOP-04/05 slip, bundle this as
v2.50.0 (it qualifies as a normal hotfix and does not need to wait
for UX work).

## Notes for the executing agent

- **Slice 1** and **Slice 3** are independent; **Slice 2** overlaps
  orchestrator.mjs but in a different function. Each slice can land
  as its own commit
- The `premiumRequests` regex fix in Slice 1 should match the exact
  symptom in #63 — if the stripping works but another symbol appears
  later, emit the warn so we see the bytes. Do not retroactively
  patch the regex for unknown characters
- **Slice 2's tier validation** reuses H.3's `availableModels` result
  — do not re-probe. Read it from the orchestrator's run-start
  context
- **Slice 3's PreCommit hook** is cross-platform — `.mjs` hook runs
  via node, spawn `git symbolic-ref` via `execSync`. Windows and
  Unix both work without path translation
- The `.forge.json` config additions are **backward-compatible** —
  missing keys use the documented defaults; existing projects don't
  need migration
- Each slice commits to its own feature branch: `fix/hotfix-2.50.1-slice-<n>`.
  The final release tag bundles all three. Per-issue commit
  attribution matters for #63, #73, #74 links in the CHANGELOG
- **CHANGELOG format** follows v2.49.1 conventions: each fix gets
  its own bullet with the issue link + commit SHA
