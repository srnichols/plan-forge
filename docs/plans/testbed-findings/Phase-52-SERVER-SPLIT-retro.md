# Phase 52 — SERVER-SPLIT — Retrospective

> **Status**: Complete  
> **Completed**: 2026-05-19  
> **Plan**: [Phase-52-SERVER-SPLIT-PLAN.md](../Phase-52-SERVER-SPLIT-PLAN.md)

---

## What Shipped

Phase 52 decomposed `pforge-mcp/server.mjs` (~9,202 LOC, A2 audit finding) into 12 focused
sub-modules under `pforge-mcp/server/`, leaving `server.mjs` as a ≤40-line entrypoint + re-export
shim that preserves all existing consumer import paths byte-for-byte.

### Per-File Before/After LOC

| File | Before (LOC) | After (LOC) | Notes |
|------|-------------|-------------|-------|
| `pforge-mcp/server.mjs` | ~9,202 | 38 | Entrypoint + re-export shim — A2 finding resolved |
| `pforge-mcp/server/state.mjs` | — | 183 | Module-level mutable state (config, orchestrator refs) |
| `pforge-mcp/server/audit-writer.mjs` | — | 40 | Audit artifact writer (Phase-39 Slice 4 logic) |
| `pforge-mcp/server/helpers.mjs` | — | 201 | `resolveProjectRoot` + helpers |
| `pforge-mcp/server/org-rules.mjs` | — | 118 | `callOrgRules` (Org Rules Consolidation) |
| `pforge-mcp/server/anvil-compute.mjs` | — | 107 | `_sweep/analyze/temperingScan/hotspot AnvilCompute` |
| `pforge-mcp/server/tool-definitions.mjs` | — | 1,318 | `TOOLS` array (all tool `{name, description, inputSchema}`) |
| `pforge-mcp/server/tool-handlers.mjs` | — | 4,881 | `invokeForgeTool` + `MCP_ONLY_TOOLS` + all handler bodies |
| `pforge-mcp/server/openbrain-bridge.mjs` | — | 110 | `runDrainPass`, `__resetPlanPathAliasWarned`, `__shouldDrainOnInit` |
| `pforge-mcp/server/rest-api.mjs` | — | 2,976 | `createExpressApp` + all REST routes |
| `pforge-mcp/server/mcp-handler.mjs` | — | 19 | MCP `Server` construction + `setRequestHandler` wiring |
| `pforge-mcp/server/main.mjs` | — | 200 | `runServerMain` startup sequence |
| `pforge-mcp/server/surface.mjs` | — | 23 | `buildServerSurface` pure contract function |

`server.mjs` dropped from ~9,202 LOC to 38 LOC, resolving the A2 module-size finding (threshold: 3,000 LOC).

### Safety Infrastructure (inherited from Phase 51 S0)

Two test files inherited from Phase 51 ran as a gate on every slice:

- **`pforge-mcp/tests/server-surface-snapshot.test.mjs`** — asserts byte-identical JSON output of
  `buildServerSurface()` before and after each extraction. The sole "no behavior change" acceptance
  criterion for all MCP tool names, input schemas, REST route paths/methods, and `MCP_ONLY_TOOLS`
  membership.
- **`pforge-mcp/tests/no-circular-imports.test.mjs`** — whole-tree `madge --circular` gate. The
  `KNOWN_CYCLES` allowlist remained at `{ 'orchestrator.mjs > cost-service.mjs' }` throughout —
  no new cycles were introduced by the split. Phase 53 inherits this file unchanged and has the
  obligation to clear the pre-existing cycle.

---

## Entrypoint-Shim Friction Log

Phase 52 applied the re-export shim pattern from Phase 51 at 3× the LOC scale, but with one
additional constraint: **`server.mjs` is the executable entrypoint** (`node pforge-mcp/server.mjs`).
This added complexity not present in Phase 51's pure re-export shim.

### 1. `import "dotenv/config"` ordering

The dotenv import MUST be the first statement in `server.mjs` — before any sub-module is imported
— to ensure environment variables are available when sub-modules execute their top-level code.
This is the standard ESM caveat for dotenv; the shim template encoded it explicitly. No runtime
issues arose in practice, but any future reorder of the shim imports would silently break env-var
loading in sub-modules.

### 2. Executable-detection sentinel

The original `if (import.meta.url === ...)` guard required computing a platform-portable
`file://` URL for comparison on both POSIX and Windows. The final implementation used
`path.resolve(process.argv[1])` vs `path.resolve(fileURLToPath(import.meta.url))` — a
comparison that works on both platforms without string manipulation. Early drafts using
the triple-backslash replace pattern from the plan template were not needed.

### 3. Startup-wiring extraction to `server/main.mjs`

The `runServerMain` function extracted to `server/main.mjs` needed access to symbols from
`state.mjs`, `mcp-handler.mjs`, and `rest-api.mjs`. Because sub-modules must not import each
other except through `state.mjs`, the startup wiring was the highest fan-in point. The
extraction was clean, but the resulting `main.mjs` at 200 LOC touches more of the system than
any other sub-module.

### 4. MCP Server reference and circular-import resolution

`invokeForgeTool` (in `tool-handlers.mjs`) originally referenced the `server` (MCP Server
instance) declared in the startup wiring — creating a prospective circular dependency when
`main.mjs` would need to import from `tool-handlers.mjs` and vice versa. Resolution: a
`_mcpServerRef` mutable reference was added to `server/state.mjs` with a `setMcpServerRef`
setter; `main.mjs` calls `setMcpServerRef(server)` after creating the MCP server instance,
and `tool-handlers.mjs` reads `_mcpServerRef` from `state.mjs`. No circular import.

### 5. Large-file edit tool reliability

`server.mjs` at ~9,200 LOC exceeded the practical reliability threshold for the editor's
inline edit tool. Session-proven mitigation: Python `pathlib.Path` file I/O for all large
file modifications, replacing the problematic multi-kilobyte `old_str/new_str` diff pattern.
This mitigation should be carried forward as a standard operating procedure for any file
exceeding 5,000 LOC.

### 6. Test file `SERVER_COMBINED_SRC` helper

Post-S6, several test files that had previously imported directly from `server.mjs` needed
to reason about the combined source across `server.mjs` + all sub-modules (e.g., to assert
that specific handler logic was present). A `SERVER_COMBINED_SRC` helper was introduced in
the test infrastructure to produce a concatenated view of all server-split files for
pattern-match assertions, avoiding modifications to the import structure while allowing
existing regex-based tests to continue working.

---

## Shared-State Pattern Review

`pforge-mcp/server/state.mjs` served as the single shared-state hub for all sub-modules.
This worked cleanly for the following reasons:

- **Named exports with clear semantics** — every binding exported from `state.mjs` had a
  well-understood purpose (`orchestratorRuns`, `costEstimateCache`, `globalHub`, `_mcpServerRef`).
- **No circular writes** — sub-modules import state, not the other way around. `main.mjs` is
  the only file that writes to state at startup (via `setMcpServerRef`).
- **No closure leakage** — because `server.mjs` had no closures that captured sub-module
  state across extraction boundaries, the named-export pattern worked without adaptation.

One caution for Phase 53: `orchestrator.mjs` has a richer internal state machine (per-run
`orchestratorRuns` map, retry counters, gate failure records). The state module will need
to model this more carefully, potentially with factory functions or class instances rather
than simple top-level `let`/`const` bindings.

---

## Phase 53 Carryover (Orchestrator-Split Pattern Guidance)

The four cross-cutting concerns carry forward to Phase 53 unchanged:

1. **Re-export shim** — `orchestrator.mjs` can become a ≤50-line re-export shim. Unlike
   `server.mjs`, `orchestrator.mjs` is NOT an executable entrypoint, so the entrypoint-shim
   variant is not needed. The shim is simpler: only re-exports, no executable guard.

2. **Snapshot-as-contract** — `orchestrator.mjs` does not have a pure-function API surface
   equivalent to `buildServerSurface()`. The recommended analog (per Phase 51 retro) is a
   dry-run plan-execution fixture test: inject a synthetic plan with known slices and assert
   the slice execution log is deterministic. Alternatively, snapshot the `SLICE_STATUS_*`
   enum surface and the `runSlice` function signature if a purely structural contract suffices.

3. **Circular-import gate** — `no-circular-imports.test.mjs` inherits unchanged. **Phase 53's
   primary architectural obligation** is to clear the `KNOWN_CYCLES` allowlist by resolving
   the `orchestrator.mjs > cost-service.mjs` cycle. The standard resolution is dependency
   inversion: introduce an abstraction (a cost-callback or cost-query function) that
   `orchestrator.mjs` accepts as an injected dependency rather than importing `cost-service.mjs`
   directly.

4. **No-behavior-change rule** — same enforcement: git-mv semantics, no renames, snapshot
   gate must stay byte-identical throughout extraction.

### Scale considerations (orchestrator.mjs at 13,933 LOC)

- **Blast radius is higher**: `orchestrator.mjs` exports `runPlan`, `runSlice`, and gate
  evaluation — surfaces touched by virtually every test in `pforge-mcp/tests/`. Budget extra
  time for the S5 equivalent (handler-body extraction) and run the full test suite, not just
  the snapshot + circular gate, before promoting each slice.
- **Runtime state complexity**: unlike `server.mjs` which is mostly I/O dispatch, the
  orchestrator manages per-run state machines. The `state.mjs` analog for Phase 53 may
  need to export factory functions (`createRunState(runId)`) rather than module-level
  mutable maps.
- **Recommend `--quorum=power`** for the Phase 53 execution run, as specified in the
  roadmap. The risk/reward ratio for a 13.9k LOC extraction justifies flagship-model
  reasoning on each slice gate.

---

## A2 Finding Resolution Proof

| Metric | Before Phase 52 | After Phase 52 |
|--------|----------------|----------------|
| `pforge-mcp/server.mjs` LOC | ~9,202 | 38 |
| A2 finding (>3,000 LOC threshold) | ❌ ACTIVE | ✅ RESOLVED |
| Largest remaining module | `orchestrator.mjs` (~13,933 LOC) | `orchestrator.mjs` (~13,933 LOC) |
| Next A-series finding | A1 `orchestrator.mjs` | A1 `orchestrator.mjs` (Phase 53) |

The golden fixture `pforge-mcp/tests/fixtures/server-surface.golden.json` was byte-identical
before and after every slice S1–S6. The full `pforge-mcp` vitest suite passed at the end of S6.

---

## Key Artifacts

| Artifact | Path |
|----------|------|
| Entrypoint + re-export shim (≤40 LOC) | `pforge-mcp/server.mjs` |
| Module-level state | `pforge-mcp/server/state.mjs` |
| Audit writer | `pforge-mcp/server/audit-writer.mjs` |
| Helpers + resolveProjectRoot | `pforge-mcp/server/helpers.mjs` |
| Org rules | `pforge-mcp/server/org-rules.mjs` |
| Anvil compute helpers | `pforge-mcp/server/anvil-compute.mjs` |
| TOOLS array | `pforge-mcp/server/tool-definitions.mjs` |
| Tool handlers + MCP_ONLY_TOOLS | `pforge-mcp/server/tool-handlers.mjs` |
| OpenBrain bridge + drain wrapper | `pforge-mcp/server/openbrain-bridge.mjs` |
| Express app + REST routes | `pforge-mcp/server/rest-api.mjs` |
| MCP Server wiring | `pforge-mcp/server/mcp-handler.mjs` |
| Startup sequence | `pforge-mcp/server/main.mjs` |
| buildServerSurface contract | `pforge-mcp/server/surface.mjs` |
| Snapshot test | `pforge-mcp/tests/server-surface-snapshot.test.mjs` |
| Circular-import gate | `pforge-mcp/tests/no-circular-imports.test.mjs` |
| Golden fixture | `pforge-mcp/tests/fixtures/server-surface.golden.json` |
| This retro | `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md` |

---

## What Went Well

- **Snapshot gate was decisive** — byte-identical JSON from `buildServerSurface()` caught
  every accidental drift in tool names, schemas, or route registration. No manual inspection
  was needed to verify behavioral equivalence.
- **Entrypoint-shim pattern scaled cleanly** — the additional complexity of the executable
  guard vs Phase 51's pure shim was contained entirely within `server.mjs` and `server/main.mjs`.
  All other sub-modules are identical in structure to Phase 51's capability sub-modules.
- **`state.mjs` as shared-state hub** — centralizing mutable state in one named-export module
  eliminated all closure-leakage risk during extraction. Every sub-module had a clean import
  boundary.
- **12 sub-modules at clear seam lines** — the section banners already present in the original
  `server.mjs` (`// ─── Config ───`, `// ─── Helpers ───`, etc.) mapped cleanly to the
  extraction boundaries. No ambiguous splits arose.
- **Zero consumer modification** — all consumer test files continued to work without any
  changes throughout S1–S6, confirming the shim strategy is sound at the entrypoint-shim scale.
