---
crucibleId: 2e20ae07-526c-4d6e-af36-9535bc09a80c
source: self-hosted
status: draft
phase: TEMPER-02
arc: TEMPER
---

# Phase TEMPER-02: Execution harness — unit + integration

> **Status**: 📝 DRAFT (arc-prep, no code yet)
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (first phase that *runs* code; subprocess
> boundary + language detection are the risk surface)
> **Target Version**: v2.43.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

TEMPER-01 observes. TEMPER-02 *acts*. This phase introduces the
execution harness that actually runs unit and integration suites,
parses their output, writes structured scan records, and reports
pass/fail per scanner per slice.

Unit + integration are the safest scanners to land first — they run in
the project's own test runner (which already exists), produce
machine-readable output (exit codes + structured reports), and do not
require browser automation. They also cover the largest volume of tests
in most codebases, so getting them right delivers the most immediate
value per operator hour invested.

The phase also establishes the **preset-adapter pattern** that every
later scanner (UI, visual, load, mutation) will reuse: each stack's
preset declares how its tests run, and the core orchestrator stays
language-agnostic.

## Scope Contract

### In-scope

**Slice 02.1 — Execution orchestrator + preset adapters (unit)**

- New `pforge-mcp/tempering/runner.mjs` module exporting
  `runScannerUnit(config, stack, sliceRef, cwd)` and surrounding
  orchestration (`runTemperingRun` dispatcher)
- Subprocess boundary: `child_process.spawn`, with stdout/stderr
  capture, timeout against `config.runtimeBudgets.unitMaxMs`, cancel on
  budget exceeded
- **Preset adapter contract** (added to `presets/shared/`):
  ```js
  export const temperingAdapter = {
    unit: { cmd: [...], parseOutput: (stdout) => ({ pass, fail, skipped, coverage }) },
    integration: { cmd: [...], parseOutput: ... },
  };
  ```
- Concrete adapters for **typescript**, **dotnet**, **python**, **go**,
  **java**, **rust** — the six most-used stacks in our existing preset
  catalog. `php`, `swift`, `azure-iac` stubs with `supported: false`
  (extension opportunity — documented in EXTENSIONS.md).
- New MCP tool `forge_tempering_run` — executes enabled scanners per
  `config.scanners`, writes `.forge/tempering/<runId>.json`, emits
  `tempering-run-*` hub events per scanner
- Parallelism: respects `config.execution.parallelism` (`"cpu-count"` default)
- **Regression-first ordering**: when `config.execution.regressionFirst`
  is true, run tests covering files changed since last green scan first
  (uses `git diff --name-only <lastGreenSha>..HEAD`)
- Tests written in the same format as TEMPER-01 — ~30 assertions

**Slice 02.2 — Integration adapters + slice-card wire-in + post-slice hook**

- Integration-scanner adapters per stack (re-uses preset contract)
- **Post-slice hook integration**: when `config.execution.trigger ==
  "post-slice"`, `pforge run-plan` invokes `forge_tempering_run` after
  each slice commit, with `sliceRef` pointing to the plan+slice
- **Progress tab slice cards** get a small Tempering pill:
  `🔨 ✓ 412/0` (pass/fail) or `🔨 ⚠ 392/20` — color-graded by status,
  links to the Tempering tab filtered to that slice
- Watcher anomaly `tempering-run-failed` + `recommendFromAnomalies` case
- `forge_smith` panel updated to include latest run summary
- Tests — ~25 assertions

### Out of scope

- UI tests (TEMPER-03)
- Visual analyzer (TEMPER-04)
- Load / stress / mutation / flakiness (TEMPER-05)
- Bug creation on test failures — this phase *reports* failures but
  does not classify them yet (TEMPER-06 owns classification + Bug
  Registry)
- Auto-fix of test-infra issues — deferred to TEMPER-05 (where we
  have flakiness data to drive it) and TEMPER-06 (where we have
  bug-vs-infra classification)

### Forbidden actions

- Do NOT edit any source file during a run (harness runs tests
  verbatim; fixes come in later phases with guardrails)
- Do NOT commit changes made by test runners (clean up on abort)
- Do NOT exceed `runtimeBudgets` — abort cleanly with a
  `tempering-run-budget-exceeded` scan result (not a bug)
- Do NOT invoke tempering recursively (plan-forge-MCP running tempering
  that triggers plan-forge-MCP)
- Do NOT run tempering during an active `pforge run-plan` slice
  (must be post-slice, not mid-slice, to avoid state corruption)

## Slices

### Slice 02.1 — Execution orchestrator + unit adapters

**Files touched:**
- `pforge-mcp/tempering/runner.mjs` — new
- `pforge-mcp/tempering/adapters.mjs` — new (adapter registry)
- `presets/typescript/tempering-adapter.mjs` — new
- `presets/dotnet/tempering-adapter.mjs` — new
- `presets/python/tempering-adapter.mjs` — new
- `presets/go/tempering-adapter.mjs` — new
- `presets/java/tempering-adapter.mjs` — new
- `presets/rust/tempering-adapter.mjs` — new
- `pforge-mcp/server.mjs` — `forge_tempering_run` handler
- `pforge-mcp/capabilities.mjs` + `tools.json` — schema
- `pforge-mcp/tests/tempering-runner.test.mjs` — new, ~30 tests

**Validation gate:** `cd pforge-mcp; npm test -- --run`. Smoke test:
point `forge_tempering_run` at a known-good fixture project in
`pforge-mcp/tests/fixtures/temper/typescript-basic/`.

### Slice 02.2 — Integration adapters + post-slice wire-in

**Files touched:**
- All six preset adapters extended with `integration` section
- `pforge-mcp/orchestrator.mjs` — post-slice hook invocation
- `pforge-mcp/dashboard/app.js` — slice-card Tempering pill
- `pforge-mcp/dashboard/index.html` — pill slot
- `pforge-mcp/tests/tempering-integration.test.mjs` — new
- `pforge-mcp/tests/tempering-post-slice-hook.test.mjs` — new

**Validation gate:** full test suite + manual: execute a plan slice on
a fixture project, confirm `.forge/tempering/<runId>.json` written,
Progress tab shows pill, Tempering tab shows result.

## Success Criteria

- `forge_tempering_run` on a fixture project completes within its unit
  budget, writes a valid run record, emits the expected hub events
- Post-slice trigger fires exactly once per committed slice (not per
  failed attempt)
- Each of the 6 supported stacks has a working unit + integration adapter
  proven by a fixture test
- Progress tab slice cards show the Tempering pill after a run
- Extension path documented for PHP / Swift / Azure IaC
- Zero new TODO / FIXME / stub markers in touched files
- All existing tests continue to pass; new tests +55–60
- CHANGELOG entry under `v2.43.0`

## Dependencies

- **Requires TEMPER-01** merged (reads its config, writes to its storage)
- Blocks TEMPER-03 onwards (they reuse the runner + adapter contract)
