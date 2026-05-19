---
phase: 52
name: SERVER-SPLIT
status: HARDENED
lockHash: a359dcc40ec1b9f8086285e6ac569623abe940f53b76aa45d627f6e1d3805530
---

# Phase 52 — SERVER-SPLIT — Decompose `pforge-mcp/server.mjs` into focused sub-modules

> **Status**: **HARDENED — cleared for execution 2026-05-19**
> **Source**: Promoted from the A-series module-size findings in Phase 42's audit catalog (A2 — `server.mjs` at 9,202–9,812 LOC, ~3.3× the 3,000-LOC threshold). Phase 51 (CAPABILITIES-SPLIT) validated the pattern at marginal scale (3.3 k LOC); this phase applies it at medium scale before the 13.9 k LOC `orchestrator.mjs` in Phase 53.
> **Tracks**: `pforge-mcp/server.mjs` (becomes thin re-export + entrypoint shim), `pforge-mcp/server/*.mjs` (NEW directory of focused sub-modules), `pforge-mcp/tests/server-surface-snapshot.test.mjs` (NEW), `pforge-mcp/tests/fixtures/server-surface.golden.json` (NEW), `pforge-mcp/tests/no-circular-imports.test.mjs` (inherited from Phase 51 — unchanged), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`.
> **Estimated cost**: low–medium. Zero LLM-cost surfaces. Pure mechanical extraction with snapshot-as-contract validation. Larger blast radius than Phase 51 (server.mjs is the MCP entrypoint AND the Express app host, so the shim retains a `main()` wiring section in addition to re-exports).
> **Pipeline**: Specify ✅ → Harden ⏳ → Execute → S7 retro. **No QA/E2E slice** because the server-surface snapshot + the existing pforge-mcp test suite is the QA — byte-identical `buildServerSurface()` output + all existing tests green before/after is the acceptance criterion.
> **Recommended starting slice**: **S0** (golden snapshot must land first — every subsequent slice depends on it as the safety net).
> **Session budget**: 8 slices (S0–S7). Recommend one or two sessions; each extraction slice is mechanical with a hard validation gate. S5 (tool-handlers, 4.3 k LOC) is the highest-risk single slice — recommend a fresh context if it lands late in a session.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **Phase 51 (CAPABILITIES-SPLIT) has shipped its retro** — the four cross-cutting concerns (shim, snapshot-as-contract, circular-import gate, no-behavior-change) and the `tests/no-circular-imports.test.mjs` infrastructure are inherited verbatim from Phase 51 and MUST be in place. ✅ Already satisfied (Phase 51 shipped 2026-05-19).
- [ ] `master` is clean.
- [ ] `planning/main` is clean (no in-flight phase touching `pforge-mcp/server.mjs`, `pforge-mcp/orchestrator.mjs`, the MCP transport, or any `forge_*` tool handler).
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time.
- [ ] No competing in-flight plan is restructuring `pforge-mcp/` directory layout.
- [ ] `madge` is installed (`npm ls madge --workspaces=false --prefix pforge-mcp`) — required by every slice's circular-import gate. ✅ Already satisfied (installed in Phase 51 S0).

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-52-SERVER-SPLIT-PLAN.md`.

---

## Why this phase exists

`pforge-mcp/server.mjs` is ~9,200 LOC of MCP server + REST API + tool dispatch. It is the **single largest file the agent loads when reasoning about any `forge_*` tool**, and its monolithic shape has measurable downstream costs:

- Every tool-handler edit forces a 9 k-LOC read into the agent's context — for a one-handler change.
- The file is a **mixed-concern God object**: it owns MCP transport, REST routing, tool definitions, tool dispatch, audit writing, OpenBrain bridging, and the Express app startup wiring. Each of these is a separate Single Responsibility per Clean Architecture.
- Snapshot diffs in PRs that touch `server.mjs` are uninterpretable — a 12-line REST-route change ships in a file the reviewer cannot scroll. PR review quality drops.
- The A2 finding is the second-largest module-size violation; cost-per-edit is high because almost every Plan Forge feature touches this file.
- The four cross-cutting concerns from Phase 51 (shim, snapshot, circular-import gate, no-behavior-change) are reusable; this phase **proves they scale to the medium-LOC tier** before Phase 53 applies them to `orchestrator.mjs` at 13.9 k LOC.

Splitting along the natural section-banner seams already present in the file reduces per-edit context cost by 60–85% for the common case (editing one tool handler), and gives Phase 53 a validated template.

---

## Scope Contract

### In Scope

**S0 — Golden snapshot + inherit circular-import gate**:
- Add `buildServerSurface()` as a **new pure export** in `pforge-mcp/server.mjs` — returns `{ tools: [{name, description, inputSchema}], restRoutes: [{method, path}], mcpOnlyTools: [...] }` deterministically from the in-module data. This is the ONLY net-new export this phase introduces; it is additive, side-effect-free, and serves as the contract.
- Add `pforge-mcp/tests/fixtures/server-surface.golden.json` — checked in, generated once via a one-shot script that calls `buildServerSurface()` and serialises to canonical JSON (sorted keys, sorted arrays of names, 2-space indent).
- Add `pforge-mcp/tests/server-surface-snapshot.test.mjs` — imports `buildServerSurface` from `../server.mjs`, asserts `JSON.stringify(buildServerSurface(), null, 2)` matches the golden fixture byte-for-byte. Fails if any tool name, schema field, REST route, or MCP_ONLY_TOOLS membership changes.
- `pforge-mcp/tests/no-circular-imports.test.mjs` (existing from Phase 51) is run on every slice's gate WITHOUT modification. `KNOWN_CYCLES` allowlist remains `{ 'orchestrator.mjs > cost-service.mjs' }` — Phase 53 owns clearing it.
- Capture current `server.mjs` SHA-256 in the S0 commit message body: `Anchor SHA256 of server.mjs at S0: <hash>`.

**S1 — Extract `server/state.mjs` (module-level mutable state)**:
- New file: `pforge-mcp/server/state.mjs`
- Move ~lines 181–290 (`// ─── Config ───` + `// ─── Orchestrator State ───` sections) — the `orchestratorRuns`, `costEstimateCache`, `globalHub`, and any other top-level `let`/`const` mutable references shared across handler modules.
- Export every moved binding so sibling sub-modules can `import { orchestratorRuns } from './state.mjs'`.
- `server.mjs` re-exports the public surface via `export { ... } from './server/state.mjs'` if any consumer outside this directory depends on these symbols (audit consumer imports during the slice; majority should be internal-only).
- Extracted FIRST because every other sub-module will import from it; landing the shared-state contract before the dependent extractions guarantees no closure surprises later.

**S2 — Extract `server/audit-writer.mjs` + `server/helpers.mjs`**:
- New file: `pforge-mcp/server/audit-writer.mjs` — moves ~lines 291–330 (`// ─── Audit artifact writer (Phase-39 Slice 4) ───`).
- New file: `pforge-mcp/server/helpers.mjs` — moves ~lines 331–529 (`// ─── Helpers ───`), including `resolveProjectRoot()`.
- `server.mjs` re-exports `resolveProjectRoot` (existing public export — consumers in 4 test files depend on it).
- Two files in one slice: each is <250 LOC and unrelated; bundling avoids two thin slices.

**S3 — Extract `server/org-rules.mjs` + `server/anvil-compute.mjs`**:
- New file: `pforge-mcp/server/org-rules.mjs` — moves ~lines 530–643 (`// ─── Org Rules Consolidation ───`).
- New file: `pforge-mcp/server/anvil-compute.mjs` — moves ~lines 2085–2310 (`// ─── Anvil-wrapped compute helpers (Phase ANVIL Slice 5) ───`).
- `server.mjs` re-exports the four existing `_sweepAnvilCompute`, `_analyzeAnvilCompute`, `_temperingScanAnvilCompute`, `_hotspotAnvilCompute` public exports.
- Two files in one slice for the same reason as S2 (small + unrelated).

**S4 — Extract `server/tool-definitions.mjs`** (the TOOLS array):
- New file: `pforge-mcp/server/tool-definitions.mjs`
- Move ~lines 644–2084 (`// ─── Tool Definitions ───`, ~1,441 LOC) — the `TOOLS` array with every tool's `{ name, description, inputSchema }` entry.
- `server.mjs` imports the array (used by the MCP `ListTools` handler and by `buildServerSurface()`).
- Largest data-table extraction; mirrors Phase 51 S1 (`TOOL_METADATA`) in shape.

**S5 — Extract `server/tool-handlers.mjs`** (the dispatch + handler bodies):
- New file: `pforge-mcp/server/tool-handlers.mjs`
- Move ~lines 2311–6700 (`invokeForgeTool` dispatcher + `MCP_ONLY_TOOLS` set + every per-tool handler body, ~4,329 LOC). This is the largest single extraction in the phase.
- `server.mjs` re-exports `invokeForgeTool` (consumers in 4 test files depend on it).
- The snapshot gate is the strongest possible safety net here — every handler's tool name + dispatch wiring must survive byte-identical.
- **Recommended**: fresh agent context for this slice; the LOC volume is comparable to a small project.

**S6 — Extract `server/rest-api.mjs` + `server/openbrain-bridge.mjs` + `server/mcp-handler.mjs` + convert `server.mjs` to shim + entrypoint**:
- New file: `pforge-mcp/server/rest-api.mjs` — moves ~lines 6898–9683 (`// ─── Express App + REST API ───`, ~2,786 LOC) including `createExpressApp()`.
- New file: `pforge-mcp/server/openbrain-bridge.mjs` — moves ~lines 6701–6897 (`// ─── Issue #205 — OpenBrain L3 semantic-search bridge ───` + `// ─── Phase-28.4 — OpenBrain queue drain I/O wrapper ───`, ~197 LOC) including `runDrainPass`, `__resetPlanPathAliasWarned`, `__shouldDrainOnInit`.
- New file: `pforge-mcp/server/mcp-handler.mjs` — moves the MCP `Server` construction + `setRequestHandler` wiring (~lines 2339–2371 + the request-handler closures), so the shim only orchestrates startup.
- Re-write `pforge-mcp/server.mjs` as a **≤120-line entrypoint shim**. (Higher LOC cap than Phase 51's 50-LOC shim because this file is also the executable entrypoint that wires MCP transport, hub, bridge, express listen, and the dotenv load — those cannot move into a sub-module without breaking `node pforge-mcp/server.mjs`.) Shim structure:
  ```js
  // pforge-mcp/server.mjs — entrypoint + re-export shim (Phase 52)
  // Implementation lives in ./server/*.mjs. This file is BOTH the public
  // import surface (preserved verbatim for consumers) AND the executable
  // entrypoint that starts the MCP transport + Express app.
  import "dotenv/config";
  // Public re-exports (consumer-facing — DO NOT modify)
  export { resolveProjectRoot } from './server/helpers.mjs';
  export { invokeForgeTool } from './server/tool-handlers.mjs';
  export { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from './server/anvil-compute.mjs';
  export { runDrainPass, __resetPlanPathAliasWarned, __shouldDrainOnInit, createExpressApp } from './server/openbrain-bridge.mjs';
  export { buildServerSurface } from './server/surface.mjs';
  // Entrypoint wiring (executes only when run directly, not when imported)
  import { runServerMain } from './server/main.mjs';
  if (import.meta.url === `file://${process.argv[1].replace(/\\\\/g, '/')}`) {
    runServerMain();
  }
  ```
- New file: `pforge-mcp/server/main.mjs` — holds the startup sequence (hub creation, bridge wiring, MCP transport connect, Express listen) extracted from the original `// ─── Start ───` section (~lines 9684–end).
- New file: `pforge-mcp/server/surface.mjs` — holds the `buildServerSurface()` function added in S0, now extracted alongside the shim conversion.
- The snapshot gate from S0 MUST still pass byte-identical at slice end — strongest no-behavior-change proof.

**S7 — Retro + roadmap update + CHANGELOG**:
- Create `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md` — per-file before/after LOC table, friction log specific to entry-point-shim pattern vs Phase 51's pure-re-export shim, recommendation for Phase 53 (does the entry-point split scale to orchestrator.mjs, or does that file's `runPlan()` orchestration need different treatment?), proof that A2 finding is resolved.
- `docs/plans/DEPLOYMENT-ROADMAP.md` — move Phase 52 row to the Completed Phases table; refresh Phase 53 entry to remove the "blocked by Phase 52" dependency and mark it as ready-to-harden.
- `CHANGELOG.md` `[Unreleased] → Changed` entry: `Decomposed pforge-mcp/server.mjs (~9.2k LOC) into 9 focused sub-modules under pforge-mcp/server/. server.mjs becomes an entrypoint + re-export shim; all public imports preserved. Zero behavioral changes (byte-identical buildServerSurface output + full test suite green).`

### Out of Scope

- **Any behavioral change in any moved declaration.** The snapshot gate + existing pforge-mcp test suite enforce this together.
- **Any signature change to any `forge_*` MCP tool.** Tool names, descriptions, and input schemas are part of the snapshot contract.
- **Any signature change to any REST endpoint** (path or method). REST routes are part of the snapshot contract.
- **Splitting `orchestrator.mjs` (Phase 53).** Out of scope; Phase 53 inherits this phase's pattern.
- **Splitting `server/tool-handlers.mjs` further by domain** (e.g. forge-master handlers, crucible handlers, tempering handlers). The 4.3 k LOC extracted file may still trigger the A-series module-size finding; that is acceptable for this phase and may be addressed by a future Phase 52.5 if cost-per-edit remains painful. Re-splitting mid-execution is forbidden.
- **Refactoring `TOOLS` array entries**, the `MCP_ONLY_TOOLS` set, or any handler body. Cleanup of stale tool wiring is a separate phase.
- **Fixing any D-series ESLint errors that surface in the new sub-modules.** If a moved function trips a complexity-error in its new file, the slice records it and the relevant follow-up phase owns the fix.
- **Adding new exports.** The only net-new export is `buildServerSurface()` (S0, explicitly justified as the contract). Every other export in the post-shim `server.mjs` must trace to a pre-S0 export.
- **Changing import paths in any consumer.** Re-export shim preserves all existing `from './server.mjs'` import statements in the 4 known consumer test files and in `pforge-master/`.
- **Touching `pforge-sdk/`, `extensions/`, `pforge-master/` source** (universal carveouts).
- **Adding new devDependencies.** `madge` (added in Phase 51) is the only tooling dep this phase touches.

### Forbidden Actions

- **Do NOT modify any consumer of `server.mjs`.** All 4 known consumer test files (`anvil-adoption`, `crucible-config-governance`, `crucible-dashboard`, `drain-io-wrapper`, `drain-rest-endpoint`, `resolve-project-root`, `self-update`, `update-check`) and any external imports must remain byte-identical post-S6.
- **Do NOT introduce a new circular import.** Every sub-module under `pforge-mcp/server/` may import from `pforge-mcp/server/state.mjs` (shared mutable state — established in S1) and from leaf modules (`enums.mjs`, `memory.mjs`, Node built-ins). Sub-modules MUST NOT import from each other except through `server/state.mjs`. The circular-import gate runs on every slice; `KNOWN_CYCLES` does not grow.
- **Do NOT inline any private helper from `server.mjs` into a sub-module under a different name.** Helpers move with their primary symbol. Renames are forbidden — `git mv` semantics only.
- **Do NOT change the snapshot fixture.** If a slice produces a non-matching snapshot, the slice failed — fix the slice, don't update the fixture. The fixture is the contract.
- **Do NOT exceed 120 LOC in the final `server.mjs` shim** (S6 gate). The shim is the smallest possible file that preserves the import path AND retains the executable-entrypoint wiring.
- **Do NOT remove the `import "dotenv/config"` from the shim**. Env load must happen before any sub-module is imported (preserves existing startup semantics).
- **Do NOT introduce any new dependency** (`dependencies` or `devDependencies`). Phase 51 added `madge`; that is the only new dep allowed in the split trilogy.
- **Do NOT bundle slices.** S0, S1, S2, S3, S4, S5, S6, S7 each = one commit.
- **Do NOT modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire — does not apply this phase but mentioned for completeness).
- **Do NOT delete `pforge-mcp/server.mjs`.** The shim is permanent (it is also the executable entrypoint).
- **Do NOT split `server/tool-handlers.mjs` further** during this phase. Future split is a separate decision.
- **Do NOT add new `forge_*` MCP tools or REST endpoints during this phase.** The snapshot contract would catch this; respecting the rule avoids burning a slice on rollback.
- **Do NOT modify `pforge-mcp/tests/no-circular-imports.test.mjs`.** Inherited verbatim from Phase 51.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Capabilities-first ordering proven** — Phase 51 shipped 2026-05-19 with snapshot + circular gate intact. This phase applies the validated pattern at medium scale; Phase 53 applies it at maximum scale.
2. **Re-export + entrypoint shim is the public contract** — `pforge-mcp/server.mjs` survives as a ≤120-line shim that re-exports public symbols AND retains the executable entrypoint wiring. Consumer imports are NEVER modified. Higher LOC cap than Phase 51 (50) because this file is also `node pforge-mcp/server.mjs`'s entrypoint.
3. **Snapshot-as-contract** — byte-identical JSON output of `buildServerSurface()` (newly added in S0; returns tools + REST routes + MCP_ONLY_TOOLS membership) is the sole acceptance criterion for "no behavior change". The full pforge-mcp vitest suite is a secondary confirmation.
4. **Circular-import gate inherited verbatim** — `pforge-mcp/tests/no-circular-imports.test.mjs` (added in Phase 51 S0) runs in every slice's gate WITHOUT modification. `KNOWN_CYCLES` stays at `{ 'orchestrator.mjs > cost-service.mjs' }` — Phase 53 owns clearing it.
5. **Sub-modules in `pforge-mcp/server/` subdirectory** — not flat siblings. Keeps related extracted modules grouped, signals "these belong together" to readers.
6. **9 sub-modules** — `state.mjs`, `audit-writer.mjs`, `helpers.mjs`, `org-rules.mjs`, `anvil-compute.mjs`, `tool-definitions.mjs`, `tool-handlers.mjs`, `rest-api.mjs`, `openbrain-bridge.mjs`, `mcp-handler.mjs`, `main.mjs`, `surface.mjs`. (11 files counting `main.mjs` and `surface.mjs` added in S6; "9 sub-modules" refers to the count cited in the CHANGELOG which counts logical groupings.)
7. **`buildServerSurface()` is the only net-new export** — pure function, side-effect-free, returns the snapshot contract. Justified in §"Out of Scope" exception clause; no other new exports allowed.
8. **No symbol renames** — `git mv` semantics only. Renames break IDE-find-references and the "trivially auditable" property.
9. **Extraction order: shared-state first, then leaves, then big middle, then entrypoint conversion** — S1 (state) → S2/S3 (small leaves) → S4 (TOOLS array) → S5 (handlers — biggest) → S6 (REST + bridge + shim). This progression validates the shared-state contract on small risk before applying it to the 4.3 k LOC tool-handler extraction.
10. **Phase 53 inherits all four cross-cutting concerns** — shim, snapshot-as-contract, circular-import gate, no-behavior-change rule. Retro (S7) must document any friction encountered with the entrypoint-shim variant so Phase 53 can absorb the lesson.
11. **Snapshot fixture is checked in** — `pforge-mcp/tests/fixtures/server-surface.golden.json` is committed. It is NOT regenerated by CI. Updating it requires a deliberate `--update-snapshot`-style commit that calls out the behavioral change being accepted.
12. **D-series ESLint errors block, B-series warnings do not** — same policy as Phase 51 RD #12. If a moved function carries a complexity warning into its new sub-module, the slice ships. If a moved function carries a complexity-error, the slice ships AND the relevant ESLint-fix phase owns the cleanup.
13. **No tests are deleted** — every existing test continues to work unmodified (the shim guarantees this). New tests (server-surface snapshot) are additive; the inherited circular-import test is unchanged.
14. **`server/tool-handlers.mjs` may exceed 3,000 LOC after extraction** — at ~4,300 LOC it will still trip the A-series finding. This is an accepted limitation of this phase. A potential future Phase 52.5 would split it by domain (forge-master / crucible / tempering / search-timeline-lattice / github-team / brain-memory groups). Not in scope here because routing logic + dispatch table changes raise the blast radius beyond what a single slice should cover.
15. **Validation gates use the per-line `node -e "process.chdir(); execSync()"` pattern** — proven by Phase 41 + Phase 51 recovery. No `bash -c "cd X && ..."` constructions (which broke Phase 51 S0). Lock rule for the hardener.

---

## Required Decisions

All decisions for this phase are resolved in §"Resolved Decisions" above (15 items, locked at draft time). No open TBDs blocking execution.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Phase ordering within module-split trilogy | ✅ Resolved | Capabilities → server → orchestrator (RD #1) |
| 2 | Backward-compat strategy | ✅ Resolved | Entrypoint + re-export shim, ≤120 LOC (RD #2) |
| 3 | "No behavior change" enforcement | ✅ Resolved | Byte-identical `buildServerSurface()` snapshot + full suite green (RD #3) |
| 4 | Circular-import prevention | ✅ Resolved | Inherited `no-circular-imports.test.mjs` from Phase 51 (RD #4) |
| 5 | Sub-module directory layout | ✅ Resolved | `pforge-mcp/server/` subdirectory (RD #5) |
| 6 | Number and grouping of sub-modules | ✅ Resolved | 9 logical sub-modules (11 files counting main + surface) (RD #6) |
| 7 | Net-new export policy | ✅ Resolved | Only `buildServerSurface()` — pure contract function (RD #7) |
| 8 | Rename policy | ✅ Resolved | No renames — `git mv` semantics (RD #8) |
| 9 | Extraction order within phase | ✅ Resolved | state → small leaves → TOOLS → handlers → REST + shim (RD #9) |
| 10 | Pattern inheritance for Phase 53 | ✅ Resolved | All 4 concerns + entrypoint-shim variant carryover (RD #10) |
| 11 | Snapshot fixture lifecycle | ✅ Resolved | Checked in; deliberate update only (RD #11) |
| 12 | ESLint-error compounding policy | ✅ Resolved | D-series blocks, others ship (RD #12) |
| 13 | Existing test treatment | ✅ Resolved | Unmodified; shim preserves (RD #13) |
| 14 | `tool-handlers.mjs` further split | ✅ Resolved | Accepted as out of scope; future Phase 52.5 may revisit (RD #14) |
| 15 | Validation-gate command pattern | ✅ Resolved | Per-line `node -e "process.chdir(); execSync()"` only (RD #15) |

---

## Slice Decomposition

> All slices are tagged **[sequential]** — each builds on the snapshot fixture and shared-state contract landed in S0 and S1. No parallel group exists.

### Slice 0 — Golden snapshot + inherit circular-import gate

- **Depends On**: nothing (Execution Hold enforced outside the slice graph).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (read-only — surveying current `TOOLS` array, REST routes, MCP_ONLY_TOOLS), `pforge-mcp/tests/no-circular-imports.test.mjs` (existing — verifying it covers `pforge-mcp/` tree), `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` (existing — model for fixture shape).
- **Traces to**: Resolved Decisions #3, #4, #7, #11.
- Add `export function buildServerSurface()` to `pforge-mcp/server.mjs` — pure function returning `{ tools: [...].sort(byName).map(t=>({name,description,inputSchema})), restRoutes: [...].sort(), mcpOnlyTools: [...mcpOnlyToolsSet].sort() }`. No side effects. Sorted arrays guarantee determinism.
- Generate `pforge-mcp/tests/fixtures/server-surface.golden.json` via one-shot Node script that imports `buildServerSurface` and writes `JSON.stringify(result, null, 2)`.
- Add `pforge-mcp/tests/server-surface-snapshot.test.mjs` — reads golden fixture, calls `buildServerSurface()`, asserts byte-identical match (`expect(JSON.stringify(actual, null, 2)).toBe(goldenContent)`).
- Confirm `pforge-mcp/tests/no-circular-imports.test.mjs` exists from Phase 51 and runs on `pforge-mcp/` whole-tree scope. No changes made to this file.
- Capture current `server.mjs` SHA-256 in the S0 commit message body: `Anchor SHA256 of server.mjs at S0: <hash>`.
- **Validation Gate**:
```bash
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs', {stdio:'inherit',shell:true});"
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/tests/fixtures/server-surface.golden.json'))throw new Error('golden missing');const j=JSON.parse(fs.readFileSync('pforge-mcp/tests/fixtures/server-surface.golden.json','utf8'));if(!Array.isArray(j.tools)||j.tools.length<50)throw new Error('golden tools array missing or too small');if(!Array.isArray(j.restRoutes)||j.restRoutes.length<10)throw new Error('golden restRoutes missing or too small');if(!Array.isArray(j.mcpOnlyTools))throw new Error('golden mcpOnlyTools missing');console.log('ok S0 — tools:'+j.tools.length+' routes:'+j.restRoutes.length+' mcpOnly:'+j.mcpOnlyTools.length);"
```

### Slice 1 — Extract `server/state.mjs`

- **Depends On**: S0 (snapshot gate must exist before any extraction).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~181–290 — Config + Orchestrator State sections), `pforge-mcp/tests/fixtures/server-surface.golden.json` (the contract).
- **Traces to**: Resolved Decisions #2, #5, #6, #8, #9.
- Create `pforge-mcp/server/state.mjs`.
- Move all module-level mutable state from the Config + Orchestrator State sections verbatim.
- Export every moved binding as a named export so sibling sub-modules can import.
- Replace the moved declarations in `server.mjs` with `import { ... } from './server/state.mjs'` (NOT `export ... from` — these are internal-to-server-module-family symbols, not part of the public consumer surface unless audited otherwise).
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/server/state.mjs'))throw new Error('state.mjs missing');const sub=fs.readFileSync('pforge-mcp/server/state.mjs','utf8');if(!/export\b/.test(sub))throw new Error('no exports in state.mjs');console.log('ok S1 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 2 — Extract `server/audit-writer.mjs` + `server/helpers.mjs`

- **Depends On**: S1 (shared state contract established).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~291–529).
- **Traces to**: Resolved Decisions #2, #5, #6, #8.
- Create `pforge-mcp/server/audit-writer.mjs` — move the audit artifact writer (~lines 291–330) verbatim.
- Create `pforge-mcp/server/helpers.mjs` — move the helpers section (~lines 331–529) including `resolveProjectRoot()` verbatim.
- `server.mjs` retains `export { resolveProjectRoot } from './server/helpers.mjs'` for consumers in 4 test files.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/server/audit-writer.mjs','pforge-mcp/server/helpers.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);const h=fs.readFileSync('pforge-mcp/server/helpers.mjs','utf8');if(!/export\s+function\s+resolveProjectRoot\b/.test(h))throw new Error('resolveProjectRoot not exported');const shim=fs.readFileSync('pforge-mcp/server.mjs','utf8');if(!/from\s+['\"]\.\/server\/helpers\.mjs['\"]/.test(shim))throw new Error('shim missing helpers re-export');console.log('ok S2 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/resolve-project-root.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 3 — Extract `server/org-rules.mjs` + `server/anvil-compute.mjs`

- **Depends On**: S2.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~530–643 + lines ~2085–2310).
- **Traces to**: Resolved Decisions #2, #5, #6, #8.
- Create `pforge-mcp/server/org-rules.mjs` — move Org Rules Consolidation section (~lines 530–643) verbatim.
- Create `pforge-mcp/server/anvil-compute.mjs` — move Anvil-wrapped compute helpers (~lines 2085–2310) verbatim.
- `server.mjs` retains `export { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from './server/anvil-compute.mjs'` for the existing 4 public exports.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/server/org-rules.mjs','pforge-mcp/server/anvil-compute.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);const a=fs.readFileSync('pforge-mcp/server/anvil-compute.mjs','utf8');for(const fn of ['_sweepAnvilCompute','_analyzeAnvilCompute','_temperingScanAnvilCompute','_hotspotAnvilCompute'])if(!a.includes('export async function '+fn))throw new Error(fn+' not exported');const shim=fs.readFileSync('pforge-mcp/server.mjs','utf8');if(!shim.includes(\"from './server/anvil-compute.mjs'\")&&!shim.includes('from \"./server/anvil-compute.mjs\"'))throw new Error('shim missing anvil-compute re-export');console.log('ok S3 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/anvil-adoption.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 4 — Extract `server/tool-definitions.mjs`

- **Depends On**: S3.
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~644–2084 — Tool Definitions section).
- **Traces to**: Resolved Decisions #2, #5, #6, #8.
- Create `pforge-mcp/server/tool-definitions.mjs` — move the `TOOLS` array (~lines 644–2084, ~1,441 LOC) verbatim.
- `server.mjs` imports the array: `import { TOOLS } from './server/tool-definitions.mjs';` (internal — not re-exported).
- The snapshot gate proves every tool entry survives.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/server/tool-definitions.mjs'))throw new Error('tool-definitions.mjs missing');const sub=fs.readFileSync('pforge-mcp/server/tool-definitions.mjs','utf8');if(!/export\s+const\s+TOOLS\b/.test(sub))throw new Error('TOOLS not exported');if(sub.length<30000)throw new Error('TOOLS file suspiciously small');console.log('ok S4 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs', {stdio:'inherit',shell:true});"
```

### Slice 5 — Extract `server/tool-handlers.mjs`

- **Depends On**: S4 (TOOLS array already extracted so handlers don't drag it along).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~2311–6700 — `invokeForgeTool` + dispatcher + handler bodies + `MCP_ONLY_TOOLS` set), `pforge-mcp/tests/fixtures/server-surface.golden.json` (the contract).
- **Traces to**: Resolved Decisions #2, #3, #5, #6, #8, #14.
- Create `pforge-mcp/server/tool-handlers.mjs` — move the entire tool-dispatch + handler-body section (~4,329 LOC) verbatim, including the `MCP_ONLY_TOOLS` Set declaration.
- `server.mjs` retains `export { invokeForgeTool } from './server/tool-handlers.mjs'` for consumers in 4 test files.
- The snapshot gate is the strongest possible safety net here — `mcpOnlyTools` membership and any `inputSchema` drift fails the slice immediately.
- **Highest-risk slice**; recommend fresh agent context if S4 was late in a session.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/server/tool-handlers.mjs'))throw new Error('tool-handlers.mjs missing');const sub=fs.readFileSync('pforge-mcp/server/tool-handlers.mjs','utf8');if(!sub.includes('export async function invokeForgeTool'))throw new Error('invokeForgeTool not exported');if(!sub.includes('MCP_ONLY_TOOLS')||!sub.includes('new Set'))throw new Error('MCP_ONLY_TOOLS not in tool-handlers.mjs');if(sub.length<100000)throw new Error('tool-handlers file suspiciously small');const shim=fs.readFileSync('pforge-mcp/server.mjs','utf8');if(!shim.includes(\"from './server/tool-handlers.mjs'\")&&!shim.includes('from \"./server/tool-handlers.mjs\"'))throw new Error('shim missing tool-handlers re-export');console.log('ok S5 structure');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/server-surface-snapshot.test.mjs tests/no-circular-imports.test.mjs tests/drain-io-wrapper.test.mjs tests/drain-rest-endpoint.test.mjs', {stdio:'inherit',shell:true});"
```
```

### Slice 6 — Extract `server/rest-api.mjs` + `server/openbrain-bridge.mjs` + `server/mcp-handler.mjs` + `server/main.mjs` + `server/surface.mjs` + convert `server.mjs` to shim

- **Depends On**: S5 (handlers extracted so the REST routes that call them resolve via re-export).
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/server.mjs` (lines ~2339–2371 MCP handler, ~6701–6897 OpenBrain bridge + drain wrapper, ~6898–9683 Express REST API, ~9684–end startup), `pforge-mcp/tests/fixtures/server-surface.golden.json` (the contract).
- **Traces to**: Resolved Decisions #2, #3, #5, #6, #8.
- Create `pforge-mcp/server/rest-api.mjs` — move Express App + REST API section (~lines 6898–9683, ~2,786 LOC) verbatim, including `createExpressApp()`.
- Create `pforge-mcp/server/openbrain-bridge.mjs` — move OpenBrain L3 bridge + queue drain wrapper (~lines 6701–6897, ~197 LOC) including `runDrainPass`, `__resetPlanPathAliasWarned`, `__shouldDrainOnInit` verbatim.
- Create `pforge-mcp/server/mcp-handler.mjs` — move the MCP `Server` construction + `setRequestHandler` wiring verbatim.
- Create `pforge-mcp/server/main.mjs` — move the `// ─── Start ───` startup sequence (hub creation, bridge wiring, MCP transport connect, Express listen) verbatim, wrap as exported `runServerMain()` function.
- Create `pforge-mcp/server/surface.mjs` — move the `buildServerSurface()` function added in S0 verbatim from `server.mjs` to this new file.
- Re-write `pforge-mcp/server.mjs` as the entrypoint shim per the template in §"Scope Contract → S6" (≤120 LOC, contains `import "dotenv/config"`, public re-exports, conditional entrypoint guard).
- The snapshot gate MUST still pass byte-identical at slice end.
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/server/rest-api.mjs','pforge-mcp/server/openbrain-bridge.mjs','pforge-mcp/server/mcp-handler.mjs','pforge-mcp/server/main.mjs','pforge-mcp/server/surface.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);const rest=fs.readFileSync('pforge-mcp/server/rest-api.mjs','utf8');if(!rest.includes('export function createExpressApp'))throw new Error('createExpressApp not exported');const bridge=fs.readFileSync('pforge-mcp/server/openbrain-bridge.mjs','utf8');if(!bridge.includes('export async function runDrainPass'))throw new Error('runDrainPass not exported');const main=fs.readFileSync('pforge-mcp/server/main.mjs','utf8');if(!main.includes('export function runServerMain')&&!main.includes('export async function runServerMain'))throw new Error('runServerMain not exported');const surf=fs.readFileSync('pforge-mcp/server/surface.mjs','utf8');if(!surf.includes('export function buildServerSurface'))throw new Error('buildServerSurface not exported');const shim=fs.readFileSync('pforge-mcp/server.mjs','utf8');const lines=shim.split(/\r?\n/).length;if(lines>120)throw new Error('shim too large: '+lines+' lines (max 120)');if(!shim.includes('dotenv/config'))throw new Error('shim missing dotenv import');if(!shim.includes(\"from './server/main.mjs'\")&&!shim.includes('from \"./server/main.mjs\"'))throw new Error('shim missing main re-export');console.log('ok S6 shim is '+lines+' lines');"
node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"
```
```

### Slice 7 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0–S6 all green.
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` (model for retro shape).
- **Traces to**: Resolved Decisions #10 (pattern carries to Phase 53).
- Create `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md` with sections: extraction summary (per-file before/after LOC table), entrypoint-shim friction log (what was harder than Phase 51's pure-re-export shim — `dotenv/config` ordering, executable-detection sentinel, startup-wiring extraction), shared-state pattern review (did `server/state.mjs` work cleanly as the single shared-state hub, or did closures leak), Phase 53 carryover (does the pattern scale to `orchestrator.mjs` at 13.9 k LOC, what changes for an orchestrator that owns runtime state + plan execution vs a server that owns transport + routing), final state proof (post-S6 audit re-run showing A2 finding resolved).
- In `docs/plans/DEPLOYMENT-ROADMAP.md`: move Phase 52 row to the Completed Phases table; refresh Phase 53 entry — remove the "Depends on: Phase 52 shipping" wording, mark it as ready-to-harden.
- Append `CHANGELOG.md` `[Unreleased] → Changed` entry per §"Scope Contract → S7".
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md'))throw new Error('retro missing');const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!rm.includes('52 — SERVER-SPLIT')&&!rm.includes('Phase 52'))throw new Error('Phase 52 not in roadmap');const completedIdx=rm.indexOf('Completed Phases');const p52Idx=rm.indexOf('52 — SERVER-SPLIT');if(p52Idx<completedIdx)throw new Error('Phase 52 not moved to Completed table');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!/server\\.mjs.*sub-modules|Decomposed pforge-mcp\\/server\\.mjs/i.test(cl))throw new Error('CHANGELOG entry missing');console.log('ok S7');"
```

---

## Acceptance Criteria

- **MUST**: A golden snapshot of `buildServerSurface()` output exists at `pforge-mcp/tests/fixtures/server-surface.golden.json` and is checked into git (owned by S0).
- **MUST**: A new pure function `buildServerSurface()` is exported from `pforge-mcp/server.mjs` (S0; the contract) and survives the shim conversion intact (S6).
- **MUST**: The whole-tree circular-import gate (`pforge-mcp/tests/no-circular-imports.test.mjs`, inherited from Phase 51) runs in every slice's validation; the set of detected cycles equals `KNOWN_CYCLES = { 'orchestrator.mjs > cost-service.mjs' }` — no new cycles allowed. The test file is NOT modified by this phase.
- **MUST**: Shared module-level state moves into `pforge-mcp/server/state.mjs` (S1).
- **MUST**: `pforge-mcp/server/audit-writer.mjs` and `pforge-mcp/server/helpers.mjs` exist and contain the corresponding original sections verbatim (S2). `resolveProjectRoot` is re-exported from `server.mjs`.
- **MUST**: `pforge-mcp/server/org-rules.mjs` and `pforge-mcp/server/anvil-compute.mjs` exist (S3). The four `_*AnvilCompute` exports remain available via `server.mjs` re-export.
- **MUST**: The `TOOLS` array moves into `pforge-mcp/server/tool-definitions.mjs` (S4).
- **MUST**: `invokeForgeTool` and `MCP_ONLY_TOOLS` move into `pforge-mcp/server/tool-handlers.mjs` (S5). `invokeForgeTool` is re-exported from `server.mjs`.
- **MUST**: `createExpressApp`, `runDrainPass`, `__resetPlanPathAliasWarned`, `__shouldDrainOnInit` move into `pforge-mcp/server/rest-api.mjs` / `pforge-mcp/server/openbrain-bridge.mjs` as appropriate (S6). All remain re-exported from `server.mjs`.
- **MUST**: Post-S6, `pforge-mcp/server.mjs` is ≤120 LOC, contains `import "dotenv/config"`, public re-exports only, and the conditional entrypoint guard. No business logic or handler bodies.
- **MUST**: The snapshot gate (byte-identical `buildServerSurface()` JSON output vs golden fixture) passes at the end of every slice S1–S6.
- **MUST**: The full `pforge-mcp` vitest suite passes at the end of S6 — not just the snapshot + circular tests. This is the secondary no-behavior-change proof.
- **MUST**: Zero consumer files outside this plan's scope are modified — no `from './server.mjs'` import statement anywhere in the codebase is touched (S1–S6).
- **MUST**: No new `forge_*` MCP tool surface is added, removed, or changed in signature (snapshot enforces).
- **MUST**: No new REST route surface is added, removed, or changed in path/method (snapshot enforces).
- **MUST**: `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md` exists and documents pattern carryover for Phase 53 (`orchestrator.mjs`) — specifically the entrypoint-shim variant and the shared-state extraction lessons (S7).
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` moves Phase 52 to the Completed Phases table and refreshes Phase 53 entry (removes "depends on Phase 52 shipping") (S7).
- **MUST**: `CHANGELOG.md` contains an `[Unreleased] → Changed` entry naming `pforge-mcp/server.mjs` decomposition and asserting byte-identical surface (S7).
- **SHOULD**: Each sub-module file is ≤3,000 LOC except for `tool-handlers.mjs` which is accepted at ~4,300 LOC per RD #14.
- **SHOULD**: No sub-module in `pforge-mcp/server/` imports from another sub-module in the same directory except through `server/state.mjs` (the explicitly-permitted shared-state hub).
- **SHOULD**: Post-S6, a re-run of `scripts/audit/clean-code-review.mjs` (or equivalent) shows the A2 (`server.mjs` >3,000 LOC) module-size error is resolved (file dropped from ~9,200 LOC to ≤120 LOC).
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before promoting Phase 52 to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + golden fixture state at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm `pforge-mcp/tests/fixtures/server-surface.golden.json` exists, parses as valid JSON with `tools` (≥50 entries), `restRoutes` (≥10 entries), and `mcpOnlyTools` arrays. Confirm `tests/no-circular-imports.test.mjs` exists and passes against the current tree. |
| **S1** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/server.mjs` and `pforge-mcp/server/state.mjs` (no other file). Confirm snapshot still byte-identical. |
| **S2** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/server.mjs`, `pforge-mcp/server/audit-writer.mjs`, `pforge-mcp/server/helpers.mjs`. |
| **S3** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/server.mjs`, `pforge-mcp/server/org-rules.mjs`, `pforge-mcp/server/anvil-compute.mjs`. |
| **S4** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/server.mjs` and `pforge-mcp/server/tool-definitions.mjs`. |
| **S5** | **CRITICAL**. Re-read §"Forbidden Actions" + RD #14. Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/server.mjs` and `pforge-mcp/server/tool-handlers.mjs`. Run the full `pforge-mcp` test suite — not just the snapshot tests. If any non-snapshot test fails, roll back. |
| **S6** | Re-read §"Forbidden Actions". Confirm post-shim `wc -l pforge-mcp/server.mjs` ≤120. Confirm the shim contains `import "dotenv/config"`. Run `node pforge-mcp/server.mjs --validate` (executable-entrypoint smoke test). Run the full `pforge-mcp` test suite + the full `pforge-master` test suite. |
| **S7** | Confirm DEPLOYMENT-ROADMAP move to Completed is complete. Re-run audit script and confirm A2 finding is resolved. |

---

## Definition of Done

- [ ] All 8 execution slices (S0–S7) committed individually with conventional-commit messages.
- [ ] All slice validation gates green.
- [ ] All Re-anchor Checkpoints passed.
- [ ] Snapshot fixture (`pforge-mcp/tests/fixtures/server-surface.golden.json`) is byte-identical pre-S0 vs post-S6 (the proof of zero behavior change).
- [ ] Final `pforge-mcp/server.mjs` is ≤120 LOC, is the entrypoint + re-export shim, and contains `import "dotenv/config"` + the conditional entrypoint guard.
- [ ] All sub-modules exist under `pforge-mcp/server/`: `state.mjs`, `audit-writer.mjs`, `helpers.mjs`, `org-rules.mjs`, `anvil-compute.mjs`, `tool-definitions.mjs`, `tool-handlers.mjs`, `rest-api.mjs`, `openbrain-bridge.mjs`, `mcp-handler.mjs`, `main.mjs`, `surface.mjs` (12 files total).
- [ ] Full `pforge-mcp` test suite passes (`node -e "process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run', {stdio:'inherit',shell:true});"`).
- [ ] Full `pforge-master` test suite passes (no cross-impact expected, but verified).
- [ ] `madge --circular --extensions mjs pforge-mcp/` reports exactly the `KNOWN_CYCLES` set (no new cycles introduced).
- [ ] `node pforge-mcp/server.mjs --validate` runs without error (executable-entrypoint smoke test).
- [ ] No consumer file outside this plan's scope is modified (verified via `git log --name-only` for the phase's commit range).
- [ ] `docs/plans/testbed-findings/Phase-52-SERVER-SPLIT-retro.md` written and committed.
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` updated: Phase 52 in Completed table; Phase 53 entry refreshed.
- [ ] `CHANGELOG.md` `[Unreleased] → Changed` entry added.
- [ ] Reviewer Gate passed (zero 🔴 Critical findings).
- [ ] `lockHash` in plan frontmatter matches at run time.

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Snapshot gate fails twice on the same slice** | Indicates a non-trivial behavior change crept in — a moved declaration depends on a private helper still in `server.mjs`, a closure broke, or a re-export drops something. Brute-force will not find it. | Roll back the slice; diff `git show HEAD` against the snapshot output; identify the missing/changed JSON field; refile the extraction. |
| **`madge --circular` reports a NEW cycle (not in `KNOWN_CYCLES`)** | A sub-module imports from another sub-module (forbidden by RD #4), OR a moved declaration accidentally created a new cycle elsewhere. The cycle WILL break at runtime in unpredictable ways. | Roll back; identify the offending import via `madge --circular --extensions mjs pforge-mcp/` output; route the offending dependency through `server/state.mjs` (the permitted hub) or a leaf module. NEVER add a Phase-52-introduced cycle to `KNOWN_CYCLES`. |
| **`node pforge-mcp/server.mjs --validate` fails post-S6** | Executable entrypoint broke — dotenv load order, MCP transport wiring, or Express listen wiring did not survive the shim conversion. Critical because this is HOW the MCP server is invoked. | Roll back S6; preserve S0–S5; redo S6 with explicit per-step verification of each startup line. |
| **Any test outside the snapshot + circular tests starts failing post-slice** | The split has leaked into the consumer surface — possible re-export typo (named vs default, sync vs async). | Roll back; verify each re-export line exactly matches the pre-split export signature. |
| **Build / lint failure introduced by the slice** | New file has a syntax error or violates an existing lint rule. | Fix in the same commit OR roll back. Do not advance with a broken build. |
| **A consumer file outside this plan's scope was modified** | Scope-contract violation. Per Forbidden Actions, consumer imports MUST NOT be touched. | Roll back the offending change; the shim makes consumer edits unnecessary. |
| **Security check fails** (e.g. `forge_secret_scan` surfaces a new secret introduced by a moved file) | Genuine breach risk — sub-module file may have unintentionally inlined a config value. | Halt, redact, re-do extraction with secrets routed through env or `.forge/secrets.json`. |
| **Snapshot fixture is regenerated mid-phase without an explicit reason in the commit message** | Fixture-as-contract violation. | Roll back the fixture change; re-do the slice that triggered the mismatch. |
| **Final shim exceeds 120 LOC** | Likely accidental retention of source code (not just re-exports + entrypoint guard). | Audit `server.mjs`; delete any non-re-export, non-entrypoint, non-comment line; re-run the gate. |
| **`tool-handlers.mjs` extraction (S5) leaves stranded handler bodies in `server.mjs`** | Partial extraction — some `case "forge_*"` branches moved but others remained. The dispatcher will silently route to undefined handlers and the snapshot may not catch it (snapshot only sees tool names, not whether the dispatch resolves). | Roll back S5; verify the dispatcher's `switch` (or equivalent) maps every tool name to a handler in `server/tool-handlers.mjs`; re-extract in one shot. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| Snapshot gate fails on first try | Retry once after re-reading the slice's instructions. If it fails again, halt per Stop Conditions. |
| Circular-import gate fails on first try | Halt immediately — do NOT retry. The cycle must be diagnosed before the next move. |
| A non-snapshot, non-circular test fails | Halt; re-read the test's expectations; verify the re-export shape matches what the test imports. |
| Shim exceeds LOC cap on first try | Re-read S6 template; delete inlined logic; re-run gate. |
| `node pforge-mcp/server.mjs --validate` fails | Halt; the entrypoint is broken. Do not advance. |
| Unrelated test flake on `pforge-mcp` full suite | Re-run the suite once. If the same test fails twice, treat as a real failure. |

---

## Notes for the Hardener

- The Step-2 hardener should sharpen line-number estimates (the section banners in `server.mjs` are stable but the exact line numbers may shift slightly between this draft and execution; the hardener should re-grep at harden time and update the slice "Context Files" entries with current line ranges).
- The hardener should compute `lockHash` and replace `TBD` in the frontmatter.
- The hardener should validate that the per-line `node -e "process.chdir(); execSync()"` gate pattern is used throughout (per RD #15) and emit a failure if any `bash -c "cd X && ..."` constructions appear.
- The hardener should NOT add new Resolved Decisions; the 15 above are the locked set.
- If the surface survey reveals more or fewer module-level mutable state symbols than implied by ~lines 181–290, the hardener should expand or contract S1's scope accordingly — but the structural slice plan (S0 snapshot → S1 state → S2–S3 leaves → S4 TOOLS → S5 handlers → S6 shim → S7 retro) is locked.
