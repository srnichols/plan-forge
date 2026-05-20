# Phase 51 — CAPABILITIES-SPLIT — Retrospective

> **Status**: Complete  
> **Completed**: 2026-05-19  
> **Plan**: [Phase-51-CAPABILITIES-SPLIT-PLAN.md](../Phase-51-CAPABILITIES-SPLIT-PLAN.md)

---

## What Shipped

Phase 51 decomposed `pforge-mcp/capabilities.mjs` (3,294 LOC, A3 audit finding) into four
focused sub-modules under `pforge-mcp/capabilities/`, leaving `capabilities.mjs` as a ≤50-line
re-export shim that preserves all existing consumer import paths byte-for-byte.

| Sub-module | Symbols moved | Approx. LOC |
|-----------|--------------|-------------|
| `capabilities/tool-metadata.mjs` | `TOOL_METADATA`, `WORKFLOWS` | ~2,114 |
| `capabilities/schemas.mjs` | `CLI_SCHEMA`, `CONFIG_SCHEMA` | ~444 |
| `capabilities/reference.mjs` | `SYSTEM_REFERENCE`, `APP_VERSION` | ~212 |
| `capabilities/subsystems.mjs` | `INNER_LOOP_SURFACE` | ~118 |
| `capabilities/surface.mjs` | `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, private builder helpers | ~340 |

`capabilities.mjs` dropped from 3,294 LOC to ≤50 LOC, resolving the A3 finding.

### Safety Infrastructure (S0)

Two permanent test files were added in S0 and run as a gate on every subsequent slice:

- **`pforge-mcp/tests/capabilities-snapshot.test.mjs`** — asserts byte-identical JSON output of
  `buildCapabilitySurface()` before and after each extraction. This is the sole "no behavior
  change" acceptance criterion; no per-function unit tests were needed.
- **`pforge-mcp/tests/no-circular-imports.test.mjs`** — whole-tree `madge --circular` gate with
  a `KNOWN_CYCLES` allowlist. Scope is the full `pforge-mcp/` tree so Phases 52 and 53 inherit
  this test file unchanged (zero new test files needed in follow-on phases).

`madge@^7` was added as the only new `devDependency` in `pforge-mcp/package.json`.

---

## Pattern Validation: Does It Scale to Phases 52 and 53?

This phase was explicitly the **pattern-validation** step before the higher-risk splits.
The four cross-cutting concerns validated here are:

1. **Re-export shim** — `capabilities.mjs` as a thin shim preserves all 11+ consumer import
   sites without modification. The shim is ≤50 LOC and contains zero logic. This scales to
   `server.mjs` (Phase 52) and `orchestrator.mjs` (Phase 53) identically.

2. **Snapshot-as-contract** — byte-identical JSON from `buildCapabilitySurface()` is a
   stronger and cheaper guarantee than per-function unit tests. The same pattern applies in
   Phase 52 (snapshot `buildForgeMasterCapabilities()` output) and Phase 53 (snapshot
   `runSlice()` or `runPlan()` summarized state if deterministic inputs are achievable).

3. **Circular-import gate** — the `no-circular-imports.test.mjs` file is whole-tree by
   design. Phases 52 and 53 must not introduce new cycles; Phase 53 has the obligation to
   clear the one pre-existing `orchestrator.mjs > cost-service.mjs` cycle, at which point
   the `KNOWN_CYCLES` allowlist drops to empty.

4. **No-behavior-change rule** — no symbol renames, no shape changes, no new exports. Git-mv
   semantics only. This is enforced by the snapshot gate mechanically and by Forbidden Actions
   contractually. Both constraints carry forward to 52 and 53.

### Scaling considerations for Phase 52 (server.mjs, 9.8 k LOC)

`server.mjs` is 3× the size of `capabilities.mjs` but follows a similar data-vs-logic seam:
route registration tables dominate. The re-export shim pattern applies directly. The main risk
is that `server.mjs` has more import consumers than `capabilities.mjs`; a pre-S0 grep of all
`from './server.mjs'` import sites is the recommended first step. Expect 6–8 sub-modules rather
than 4 to keep each file under 1,000 LOC. The snapshot gate may be harder to construct if
server-side output is env-dependent — consider snapshotting the route manifest or the registered
tool names as a proxy.

### Scaling considerations for Phase 53 (orchestrator.mjs, 13.9 k LOC)

`orchestrator.mjs` is 4× the size of `capabilities.mjs` and carries the one pre-existing
circular import (`orchestrator.mjs > cost-service.mjs`). The circular must be resolved as
part of the split — that is the architectural obligation documented in the KNOWN_CYCLES
allowlist. The snapshot approach may require mocking more runtime state; a "dry-run plan
execution" fixture test is the recommended analog. Expect 8–12 sub-modules. This phase
carries the highest blast radius and should be executed under `--quorum=power` with a full
test run before promotion.

---

## Friction

- **Snapshot fixture determinism** — `buildCapabilitySurface()` reads `APP_VERSION` from disk.
  A mock shim was required in `capabilities-snapshot.test.mjs` to pin `APP_VERSION` to a
  fixed string (`"SNAPSHOT_TEST"`). Future phases using the same pattern must identify and
  mock all env-dependent values before generating their golden fixture.

- **Data-table volume** — `TOOL_METADATA` is ~2,068 LOC of dense declarative data. Moving it
  as a single block was straightforward, but the initial S1 diff was intimidating in size.
  Future reviewers should `git diff --stat` first to confirm only one file changed, then
  `git diff --ignore-all-space` to verify no logic was altered.

- **Phase 43 Execution Hold** — Phase 51 was hardened but gated on Phase 43 (D-series ESLint
  errors) shipping first. In practice the Execution Hold was navigated by the orchestrator;
  future phases should document their hold conditions clearly so human reviewers can validate
  them at plan-start without re-reading the full plan.

---

## Key Artifacts

| Artifact | Path |
|----------|------|
| Re-export shim (≤50 LOC) | `pforge-mcp/capabilities.mjs` |
| Tool metadata | `pforge-mcp/capabilities/tool-metadata.mjs` |
| CLI + config schemas | `pforge-mcp/capabilities/schemas.mjs` |
| System reference | `pforge-mcp/capabilities/reference.mjs` |
| Inner loop surface | `pforge-mcp/capabilities/subsystems.mjs` |
| Surface builder | `pforge-mcp/capabilities/surface.mjs` |
| Snapshot test | `pforge-mcp/tests/capabilities-snapshot.test.mjs` |
| Circular-import gate | `pforge-mcp/tests/no-circular-imports.test.mjs` |
| Golden fixture | `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` |
| This retro | `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` |

---

## What Went Well

- **Snapshot gate was decisive** — having a byte-identical JSON contract eliminated all
  ambiguity about whether a slice introduced a behavior change. No human judgment required.
- **Sub-module directory layout** — grouping the four files under `pforge-mcp/capabilities/`
  made the relationship immediately clear to readers and will make future cleanup atomic.
- **Whole-tree circular-import scope** — designing `no-circular-imports.test.mjs` to cover all
  of `pforge-mcp/` (not just the new sub-modules) means Phases 52 and 53 inherit it unchanged.
  This was a deliberate investment in future phases that paid off immediately in reduced
  per-phase setup overhead.
- **Zero consumer modification** — all 11+ test files and `server.mjs` import sites continued
  to work without any changes throughout the split, confirming the shim strategy is sound.
