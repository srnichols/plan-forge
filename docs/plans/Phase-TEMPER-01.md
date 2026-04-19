---
crucibleId: 0f412001-9658-4b46-bc27-14b02d47963c
source: self-hosted
status: finalized
phase: TEMPER-01
arc: TEMPER
---

# Phase TEMPER-01: Foundation — config, storage contract, read-only scan

> **Status**: ✅ FINALIZED — Slice 01.1 + Slice 01.2 shipped (v2.42.0)
> **Estimated Effort**: 2 slices
> **Risk Level**: Low (purely additive subsystem; no existing surfaces change)
> **Target Version**: v2.42.0

See arc overview: [Phase-TEMPER-ARC.md](Phase-TEMPER-ARC.md)

---

## Why

The Tempering arc cannot start with execution — the storage contract,
config shape, and dashboard surface have to be frozen first, because
every later phase (TEMPER-02 through TEMPER-06) reads from and writes
to them. Getting the shape wrong here cascades into five painful
migrations later.

TEMPER-01 ships the **foundation and only the foundation**: a readable
subsystem that, on day 1, answers "does my project have adequate test
coverage, and if not, where are the gaps?" — using coverage data that
already exists on disk (lcov, coverage-final.json, cobertura.xml).
Nothing is executed. No tests are run. No bugs are created.

This is the deliberate "Crucible-01" of the arc: unglamorous but
load-bearing.

## Scope Contract

### In-scope

**Slice 01.1 — Storage + MCP read-only surface**

- `.forge/tempering/` directory auto-created by a new
  `ensureTemperingDirs(projectRoot)` helper in `orchestrator.mjs`
- `.forge/tempering/config.json` with enterprise defaults (see arc doc
  §"`.forge/tempering/config.json` shape") — created if missing, never
  overwritten
- `readTemperingState(targetPath)` exported from `orchestrator.mjs` —
  mirrors `readCrucibleState` exactly: returns `null` if subsystem not
  initialized, otherwise an object with counts + freshness + gaps
- `readTemperingConfig(targetPath)` helper — loads config or returns
  baked-in defaults; never throws
- New MCP tool `forge_tempering_scan` — **read-only**:
  - Detects stack (reuses `presets/` detection logic)
  - Locates existing coverage reports (lcov.info, coverage-final.json,
    cobertura.xml, coverage.py XML, jacoco.xml, go cover.out)
  - Parses coverage per layer (config-driven glob rules)
  - Compares against `coverageMinima` from config
  - Emits gap report: `{ scanner: "unit", layer: "domain", minimum: 90,
    actual: 72, gap: 18, files: [...] }`
  - Checks freshness: last scan age from `.forge/tempering/<runId>.json`
    mtime
  - Writes `.forge/tempering/scan-<timestamp>.json` with structured results
- New MCP tool `forge_tempering_status` — returns latest N scan summaries
  for dashboard feed
- TOOL_METADATA entries in `capabilities.mjs` + `tools.json` for both
  tools, with `addedIn: "2.42.0"`, full `consumes`/`produces`/`errors`
- Hub events `tempering-scan-started` + `tempering-scan-completed`
  (consumed by dashboard)
- Telemetry via existing `emitToolTelemetry`
- **L3 capture** on `tempering-scan-completed` via existing
  `captureMemory()` helper — tags `tempering`, `scan`, `<stack>`,
  `<status>`; payload: gap summary (no file contents). Never blocks
  the scanner; OpenBrain outages fall through to
  `.forge/openbrain-queue.jsonl` as usual. See arc doc
  §"L3 semantic memory (OpenBrain) integration".

**Slice 01.2 — Dashboard surface + watcher anomalies**

- New **Tempering tab** in the dashboard (full pane, sibling of Crucible
  tab) — skeleton only: coverage-vs-minima chart, last scan summary,
  gap list, "Run scan" button wiring to `forge_tempering_scan`
- **Watcher-tab chip row** mirroring the Crucible row pattern from
  Slice 03.2: `Σ total scanners / ✓ passing / ⚠ below minimum / ⏱ scan
  age`. `data-testid="watcher-tempering-row"`. Hidden when subsystem not
  initialized.
- Watcher-snapshot payload extension: `tempering` block added to
  `buildWatchSnapshot` output (parallel to the `crucible` block from
  03.1), primitives-only for compact WS payload
- Two new anomaly rules in `detectWatchAnomalies`:
  - `tempering-coverage-below-minimum` (severity: warn) — any layer's
    actual < minimum by ≥ 5 points
  - `tempering-scan-stale` (severity: warn) — no scan in ≥ 7 days
- `recommendFromAnomalies` cases for both
- `forge_smith` panel extension: Tempering section with 3 fields
  (latest scan timestamp, # gaps, overall status)

### Out of scope (for this phase — all land in later phases)

- Running any actual tests (TEMPER-02)
- UI link sweep / accessibility / contract tests (TEMPER-03)
- Visual analyzer (TEMPER-04)
- Load / stress / mutation / flakiness (TEMPER-05)
- Bug Registry / GitHub Issues / fix-proposal integration (TEMPER-06)
- Any write to production source files

### Forbidden actions

- Do NOT run any test framework directly (read-only phase)
- Do NOT overwrite an existing `.forge/tempering/config.json`
- Do NOT create bugs (the Bug Registry doesn't exist yet — TEMPER-06)
- Do NOT scan `node_modules`, `.git`, or the watcher's own cwd
- Do NOT extend `forge_liveguard_run` yet (TEMPER-06 owns that wire-in)

## Slices

### Slice 01.1 — Storage contract + MCP read-only surface

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `ensureTemperingDirs`, `readTemperingState`, `readTemperingConfig`, config defaults object
- `pforge-mcp/server.mjs` — `forge_tempering_scan`, `forge_tempering_status` handlers
- `pforge-mcp/tools.json` — schemas (auto-generated from capabilities)
- `pforge-mcp/capabilities.mjs` — TOOL_METADATA entries
- `pforge-mcp/tests/tempering-foundation.test.mjs` — new file, ~20 tests

**Validation gate:** `cd pforge-mcp; npm test -- --run` — all pass.

### Slice 01.2 — Dashboard + watcher awareness

**Files touched:**
- `pforge-mcp/dashboard/index.html` — new Tempering tab structure
- `pforge-mcp/dashboard/app.js` — `renderTemperingPanel`, Watcher-row chip block, event handlers
- `pforge-mcp/orchestrator.mjs` — `buildWatchSnapshot` extended with `tempering` block, 2 new anomaly rules
- `pforge-mcp/server.mjs` — `forge_smith` Tempering section
- `pforge-mcp/tests/tempering-dashboard.test.mjs` — new file, ~15 tests
- `pforge-mcp/tests/tempering-watcher.test.mjs` — new file, ~10 tests

**Validation gate:** `cd pforge-mcp; npm test -- --run` — all pass. Manual
dashboard smoke-test: open localhost:3100/dashboard, Tempering tab
renders without errors on a project with no tempering state.

## Success Criteria

- `forge_tempering_scan` on a project with an existing `lcov.info`
  returns coverage-per-layer vs. config minima
- Dashboard Tempering tab loads and renders the output
- Watcher snapshot carries a `tempering` block (or `null` when
  uninitialized)
- `forge_smith` output includes a `Tempering:` section
- Zero new TODO/FIXME/stub markers (`forge_sweep` clean on touched files)
- All existing tests continue to pass; new test count +40–50
- CHANGELOG entry under `v2.42.0` documents the foundation
- `Phase-TEMPER-01.md` moved from `status: draft` to `status: in_progress`
  at start, to `status: finalized` on merge

## Dependencies on later phases

**None.** This phase is standalone. If TEMPER-02 through TEMPER-06 are
never shipped, TEMPER-01 still delivers a useful coverage-gap reporter.
