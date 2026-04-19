---
crucibleId: 6de31a56-4341-45dc-bf91-eab3993b6078
source: self-hosted
status: complete
phase: TEMPER-05
arc: TEMPER
---

# Phase TEMPER-05: Performance, mutation, and flakiness

> **Status**: ✅ COMPLETE — Slices 05.1 + 05.2 shipped (v2.46.0-dev)
> **Estimated Effort**: 2 slices
> **Risk Level**: Medium (mutation is runtime-expensive; scheduling
> decisions are the risk surface)
> **Target Version**: v2.46.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

By the end of TEMPER-04 we know: code compiles, unit tests pass,
integration tests pass, every page loads, every link works, a11y
is clean, contracts hold, and no visual regressions. What we still do
*not* know:

1. **Do the tests actually catch bugs?** Coverage numbers lie —
   100% line-hit ≠ 100% mutation-kill. Most teams discover this only
   after a real bug slips through a "covered" file.
2. **Are the passing tests reliable?** A test that passes 95% of the
   time is a bug in the test, not a feature. CI flakiness kills
   operator trust in the entire system.
3. **Did this change make things slower?** Perf regressions don't fail
   assertions; they just silently degrade user experience until
   someone notices.
4. **Can the system handle real load?** Unit and integration prove
   correctness at n=1. Load/stress prove correctness at n=thousands.

These four dimensions are often treated as "nice-to-have." For
enterprise defaults, they're table stakes.

## Scope Contract

### In-scope

**Slice 05.1 — Flakiness detector + performance budget + load/stress**

- `pforge-mcp/tempering/scanners/flakiness.mjs` — new scanner
- **Flakiness detection algorithm**:
  - Tracks per-test outcomes across the last N runs (default 20)
  - Classifies: `stable-pass`, `stable-fail`, `flaky` (mixed), `new`
  - For tests flagged `flaky`: automatically rerun 3x on next run to
    confirm; if still flaky → write a bug with `classification:
    "infra"` (this is the one infra-bug that tempering *may* attempt
    to auto-fix in a later phase — not this one)
  - Quarantine mode: `config.scanners.flakiness.quarantine: true` skips
    known-flaky tests in subsequent runs, reports them separately
- `pforge-mcp/tempering/scanners/performance-budget.mjs` — new scanner
- **Performance budget**:
  - Per-endpoint p95 budget (source: `config.scanners.performance-
    budget.endpoints[]` or auto-derived from OpenAPI)
  - Per-page TTI (Time-To-Interactive) budget from Playwright
    (integrates with TEMPER-03 scanner data)
  - Regression detection: compare current run p95 to baseline p95;
    flag at > 10% regression (config-tunable)
  - Writes time-series data to `.forge/tempering/perf-history.jsonl`
    for long-horizon trend reporting
- `pforge-mcp/tempering/scanners/load-stress.mjs` — new scanner
- **Load/stress**:
  - Uses `autocannon` (node-native) for HTTP load — no Docker, no k6
    install needed; works out-of-box
  - Default load profile: 100 concurrent / 60 seconds against the
    endpoints declared in OpenAPI (reuses contract-scanner surface
    from TEMPER-03)
  - Enterprise defaults: load runs in staging config only; production
    config requires explicit opt-in flag
  - Stress profile (opt-in): ramp concurrency until 1% error rate
    observed, report break-point concurrency
  - Integration with `forge_liveguard_run` still deferred — TEMPER-06
    wires the full composite
- Tests — ~35 assertions

**Slice 05.2 — Mutation testing + scheduling intelligence**

- `pforge-mcp/tempering/scanners/mutation.mjs` — new scanner
- **Mutation testing**:
  - **typescript**: `stryker-mutator`
  - **dotnet**: `Stryker.NET`
  - **python**: `mutmut`
  - **java**: `pitest`
  - **go**: `go-mutesting` (or `gremlins-tool`)
  - **rust**: extension opportunity (cargo-mutants in catalog as
    third-party)
  - Preset-adapter pattern extended with `mutation` section
- **Scheduling intelligence** — the single biggest design call in
  this phase:
  - Mutation is expensive (can be 10-100× slower than the unit suite)
  - Default schedule: **nightly only** when run under `post-slice`
    trigger — TEMPER-05 does not run mutation on every slice
  - Exception: if the touched files of a slice overlap the "critical
    path" (configurable glob list: `config.scanners.mutation.criticalPaths`),
    mutation runs on that slice
  - Full-codebase mutation requires explicit `forge_tempering_run
    --full-mutation` invocation
  - Mutation score per layer compared against
    `config.scanners.mutation.minima` (default: domain 70%,
    integration 50%, overall 60%)
- New anomaly `tempering-mutation-below-minimum`
- New anomaly `tempering-flake-detected`
- New anomaly `tempering-perf-regression`
- Dashboard Tempering tab gets three new subsections
- **L3 capture** via `captureMemory()` at three moments:
  - Flake-confirmed (≥ 3 of N runs) — tags `tempering`, `flake`,
    `<scanner>`, `<testName>`
  - Perf regression confirmed (2 consecutive runs) — tags `tempering`,
    `perf-regression`, `<endpoint-or-page>`
  - Mutation score below minimum — tags `tempering`, `mutation-gap`,
    `<layer>`
  Cross-project recall is the point: "this test has been flaky
  elsewhere too" informs classification in TEMPER-06. See arc doc
  §"L3 semantic memory (OpenBrain) integration".
- Tests — ~30 assertions

### Out of scope

- Chaos engineering / fault injection — separate arc entirely if we
  ever go there
- Production load testing — only staging, enforced
- Custom mutation operators — default operator sets only
- Profile-guided optimization hints — feels-like-future-work

### Forbidden actions

- Do NOT run mutation during a slice's critical-path execution window
  (too slow; will blow runtime budgets)
- Do NOT run load/stress against production without explicit
  `allowProduction: true` config + matching env-config flag
- Do NOT auto-quarantine a test unless it has been flaky in ≥ 3 of
  the last N runs (protects against one-off transient failures
  causing permanent skips)
- Do NOT classify a performance regression as a bug without holding
  for 2 consecutive runs (smooths out transient system noise)
- Do NOT promote baselines automatically when perf improves — humans
  approve perf baseline changes same as visual baseline

## Slices

### Slice 05.1 — Flake + perf budget + load ✅

**Files touched:**
- `pforge-mcp/tempering/scanners/flakiness.mjs` — new
- `pforge-mcp/tempering/scanners/performance-budget.mjs` — new
- `pforge-mcp/tempering/scanners/load-stress.mjs` — new
- `pforge-mcp/tempering/perf-history.mjs` — new (time-series helper)
- `pforge-mcp/dashboard/app.js` — three new subsections
- `pforge-mcp/dashboard/index.html` — subsection DOM
- `pforge-mcp/tests/tempering-flake.test.mjs` — new
- `pforge-mcp/tests/tempering-perf-budget.test.mjs` — new
- `pforge-mcp/tests/tempering-load.test.mjs` — new
- `package.json` deps — `autocannon`

### Slice 05.2 — Mutation + scheduling ✅

**Files touched:**
- `pforge-mcp/tempering/scanners/mutation.mjs` — new
- All 6 supported preset adapters extended with `mutation` section
- `pforge-mcp/tempering/scheduling.mjs` — new (critical-path
  detection, nightly vs. post-slice routing)
- `pforge-mcp/orchestrator.mjs` — 3 new anomaly rules
- `pforge-mcp/tests/tempering-mutation.test.mjs` — new
- `pforge-mcp/tests/tempering-scheduling.test.mjs` — new

## Success Criteria

- Fixture project with one deterministically-flaky test: scanner
  correctly classifies after N runs, quarantine respected
- Fixture project with a perf regression (add `sleep 50ms` to a
  handler): flagged at 2nd consecutive slow run
- Fixture project with a weak test suite (100% coverage, 40% mutation
  score): correctly flags below-minimum
- Load scanner completes a 60s 100-concurrent run against a fixture
  and reports p50/p95/p99 + error rate
- Scheduling intelligence: a slice touching a non-critical file does
  NOT trigger full mutation run
- All existing tests continue to pass; new tests +65
- CHANGELOG entry under `v2.46.0`

## Dependencies

- **Requires TEMPER-02** (runner + adapter contract)
- **Reuses TEMPER-03 contract scanner** (load scanner points at the
  same OpenAPI-declared endpoints)
- Sets the stage for **TEMPER-06** bug classification by providing
  the flakiness data that drives it
