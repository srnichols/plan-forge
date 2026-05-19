---
phase: 51
name: CAPABILITIES-SPLIT
status: HARDENED
lockHash: 59fb81858cb75e0ca60e50b9ec3e52ae55e6ca2d35334778b3b969f5a32d8716
---

# Phase 51 — CAPABILITIES-SPLIT — Decompose `pforge-mcp/capabilities.mjs` into focused sub-modules

> **Status**: **HARDENED — awaiting Execution Hold lift** (Phase 43 retro must ship first). Cleared for `pforge run-plan` once Execution Hold checklist is satisfied. Step-2 harden completed 2026-05-19.
> **Source**: Promoted from the A-series module-size findings in Phase 42's audit catalog. `capabilities.mjs` was the marginal case (3,294 LOC — only 10% over the 3,000-LOC threshold), which makes it the **right place to validate the split pattern** before tackling the 9.8 k LOC `server.mjs` (Phase 52) and the 13.9 k LOC `orchestrator.mjs` (Phase 53).
> **Tracks**: `pforge-mcp/capabilities.mjs` (becomes thin re-export shim), `pforge-mcp/capabilities/*.mjs` (NEW directory of 4 focused sub-modules), `pforge-mcp/tests/capabilities*.test.mjs` (unchanged; snapshot test added), `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`.
> **Estimated cost**: low. Zero LLM-cost surfaces. Pure mechanical extraction with snapshot-as-contract validation.
> **Pipeline**: Specify ✅ → Harden ⏳ → Execute → S5 retro. **No QA/E2E slice** because the snapshot gate IS the QA — byte-identical JSON output of `buildCapabilitySurface()` before/after is the only acceptance criterion.
> **Recommended starting slice**: **S0** (golden snapshot must land first — every subsequent slice depends on it as the safety net).
> **Session budget**: 5 slices. Recommend one session — each slice is a single mechanical extraction with a hard validation gate.

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [ ] **Phase 43 (CLEAN-CODE-ESLINT-ERRORS) has shipped its retro**. Splitting a file that still has unresolved D-series ESLint errors compounds the violations across the new sub-modules and forces re-litigation per-module. D-series must be clean in `capabilities.mjs` at split time.
- [ ] `master` is clean
- [ ] `planning/main` is clean (no in-flight phase touching `pforge-mcp/capabilities.mjs`, `pforge-mcp/server.mjs`, or the `forge_capabilities` handler)
- [ ] `lockHash` (added in Step-2 harden) matches plan body at run time
- [ ] No competing in-flight plan is restructuring `pforge-mcp/` directory layout
- [ ] `madge` is installed (`npm i -D madge` in `pforge-mcp/` workspace) — required by every slice's circular-import gate

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-51-CAPABILITIES-SPLIT-PLAN.md`.

---

## Why this phase exists

`pforge-mcp/capabilities.mjs` is 3,294 LOC and growing every release. The file is **62% declarative data tables** (`TOOL_METADATA` alone is 2,068 LOC) and **38% surface-builder logic**. Today:

- Every edit to a single tool's metadata loads the entire 3,294-line file into the agent's context.
- Snapshot diffs in PRs are dominated by data-table churn, drowning out genuine logic changes.
- Test failures in the `buildCapabilitySurface` builder force re-reading the entire file to locate the relevant ~50 lines.
- The A-series catalog finding (A3) is technically the smallest module-size violation, but the cost-per-edit is high because the file is touched on nearly every tool addition.

Splitting along the natural data-vs-logic seam reduces per-edit context cost by 60-80% for the common case (adding/editing a tool's metadata), without changing a single consumer's import statement (re-export shim preserves backward compatibility).

This phase is also the **pattern-validation** phase for the harder splits in 52 and 53. The four cross-cutting concerns below (re-export shim, snapshot-as-contract, circular-import gate, no-behavior-change rule) become the inherited contract for both follow-on phases.

---

## Scope Contract

### In Scope

**S0 — Golden snapshot + circular-import gate**:
- Add `pforge-mcp/tests/capabilities-snapshot.test.mjs` — calls `buildCapabilitySurface()` with a fixed input (no env-dependent values) and asserts the serialised JSON matches a checked-in golden fixture `pforge-mcp/tests/fixtures/capabilities-surface.golden.json`
- Add `pforge-mcp/tests/capabilities-no-circular.test.mjs` — shells out to `madge --circular pforge-mcp/capabilities.mjs pforge-mcp/capabilities/*.mjs` and asserts exit 0
- Add `madge` as a `devDependency` in `pforge-mcp/package.json` (one new dev dep — explicitly allowed for this phase; documented in Required Decisions)
- Capture the current `capabilities.mjs` SHA-256 to the slice's commit message body (forensic anchor — every later slice can verify "the source we started from was X")
- Generate the golden fixture by snapshotting current `buildCapabilitySurface()` output once, before any extraction begins

**S1 — Extract `capabilities/tool-metadata.mjs`** (the 62% data-table majority):
- New file: `pforge-mcp/capabilities/tool-metadata.mjs`
- Move `TOOL_METADATA` (~lines 40-2108 of current `capabilities.mjs`, ~2,068 LOC) and `WORKFLOWS` (~lines 2109-2155, ~46 LOC)
- `capabilities.mjs` re-exports both symbols via `export { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';`
- Zero changes to consumers (re-export preserves the existing import path)
- Largest single extraction — landing it first proves the shim pattern under maximum data volume

**S2 — Extract `capabilities/schemas.mjs`** (CLI + Config schemas):
- New file: `pforge-mcp/capabilities/schemas.mjs`
- Move `CLI_SCHEMA` (~lines 2158-2483, ~325 LOC) and `CONFIG_SCHEMA` (~lines 2486-2605, ~119 LOC)
- `capabilities.mjs` re-exports both
- Combined because both define the toolkit's **external interface** (CLI commands and `.forge.json` schema) — they change together when the config surface evolves

**S3 — Extract `capabilities/reference.mjs` + `capabilities/subsystems.mjs`**:
- New file: `pforge-mcp/capabilities/reference.mjs` — moves `SYSTEM_REFERENCE` (~lines 2609-2819, ~210 LOC) and the `APP_VERSION` resolution helper
- New file: `pforge-mcp/capabilities/subsystems.mjs` — moves `INNER_LOOP_SURFACE` (~lines 2837-2953, ~116 LOC)
- Two files in one slice because each is small (~120-210 LOC) and they are unrelated (separate concerns, separate change cadences); bundling avoids a slice with <150 LOC of moves
- `capabilities.mjs` re-exports all three symbols

**S4 — Extract `capabilities/surface.mjs` + convert `capabilities.mjs` to thin re-export shim**:
- New file: `pforge-mcp/capabilities/surface.mjs` — moves `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, and all private builder helpers (~lines 2955-3293, ~338 LOC)
- `capabilities.mjs` becomes a **≤50-line re-export shim**:
  ```js
  // pforge-mcp/capabilities.mjs — re-export shim (Phase 51)
  // All implementation lives in ./capabilities/*.mjs. This file exists ONLY
  // to preserve the legacy `from './capabilities.mjs'` import path used by
  // 11+ test files and external consumers. Do not add logic here.
  export { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';
  export { CLI_SCHEMA, CONFIG_SCHEMA } from './capabilities/schemas.mjs';
  export { SYSTEM_REFERENCE, APP_VERSION } from './capabilities/reference.mjs';
  export { INNER_LOOP_SURFACE } from './capabilities/subsystems.mjs';
  export { buildCapabilitySurface, writeToolsJson, writeCliSchema } from './capabilities/surface.mjs';
  ```
- The snapshot gate (from S0) MUST still pass byte-identical at slice end — this is the strongest possible "no behavior change" proof
- The original `capabilities.mjs` drops from 3,294 LOC to ≤50 LOC, resolving the A3 audit finding

**S5 — Retro + roadmap update + CHANGELOG**:
- `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` — what got extracted vs deferred, friction in the snapshot-as-contract pattern, recommendation for Phase 52/53 (does the pattern scale to 9.8 k and 13.9 k LOC files, or do those need a different decomposition strategy?), final per-file LOC table
- `docs/plans/DEPLOYMENT-ROADMAP.md` — mark Phase 51 as Completed; replace Phase 44 entry with Phase 52 (SERVER-SPLIT) + Phase 53 (ORCHESTRATOR-SPLIT) DRAFT stubs that inherit this phase's four cross-cutting concerns
- `CHANGELOG.md` — entry under `[Unreleased]`: `### Changed — Decomposed pforge-mcp/capabilities.mjs (3,294 LOC) into 4 focused sub-modules under pforge-mcp/capabilities/. capabilities.mjs becomes a thin re-export shim; all public imports preserved. Zero behavioral changes (byte-identical buildCapabilitySurface output).`

### Out of Scope

- **Any behavioral change in `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, or any moved declaration.** The snapshot gate enforces this — a single byte's difference fails the slice.
- **Any signature change to a `forge_*` tool.** The `forge_capabilities` MCP tool handler in `server.mjs` continues to call the same exported functions with the same arguments and receives identical output.
- **Splitting `server.mjs` (Phase 52) or `orchestrator.mjs` (Phase 53).** Those are separate phases that inherit this one's pattern.
- **Refactoring the data shape of `TOOL_METADATA`, `WORKFLOWS`, `CLI_SCHEMA`, `CONFIG_SCHEMA`, `SYSTEM_REFERENCE`, or `INNER_LOOP_SURFACE`.** Data structures move verbatim. Cleanup of legacy fields is a future phase.
- **Fixing any D-series ESLint errors that surface in the new sub-modules.** If a moved function trips a complexity-error in its new file, the slice records it and Phase 43 (or a follow-up phase) fixes it. The split is not blocked by inherited violations.
- **Adding new exports.** Every export in `capabilities.mjs` post-S4 must trace to a pre-S0 export. New surface area = scope creep.
- **Changing import paths in any consumer.** Re-export shim preserves all existing `from './capabilities.mjs'` import statements. Consumers are NOT modified.
- **Splitting `pforge-mcp/capabilities.mjs` into a different number of files than 4** (tool-metadata, schemas, reference+subsystems, surface). The seam analysis is fixed at draft time; alternate decompositions require re-planning.
- **Touching `pforge-sdk/`, `extensions/`, `pforge-master/` source** (universal carveouts).

### Forbidden Actions

- **Do NOT modify any consumer of `capabilities.mjs`.** All 11+ test files and the `server.mjs` import sites must remain byte-identical post-S4. The shim exists precisely to avoid this.
- **Do NOT introduce a circular import.** Every sub-module is leaf-level (depends only on Node built-ins and `enums.mjs` / `memory.mjs`). `capabilities/*.mjs` files MUST NOT import from each other except through `capabilities.mjs` itself (and even that is discouraged — prefer no inter-sub-module imports at all). The circular-import gate from S0 runs on every slice.
- **Do NOT inline any private helper from `capabilities.mjs` into a sub-module under a different name.** Helpers move with their primary symbol. Renames are forbidden — `git mv -equivalent` semantics only.
- **Do NOT change the snapshot fixture.** If a slice produces a non-matching snapshot, the slice failed — fix the slice, don't update the fixture. The fixture is the contract.
- **Do NOT exceed 50 LOC in the final `capabilities.mjs` shim** (S4 gate). The shim is the smallest possible file that preserves the import path.
- **Do NOT introduce any new devDependency beyond `madge`** (S0 explicitly allows `madge`). If a slice needs additional tooling, file a Required Decision for the next phase — do not expand scope mid-execution.
- **Do NOT bundle slices.** Each slice = one commit. S0, S1, S2, S3, S4, S5 each = one commit.
- **Do NOT modify `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318`** (universal tripwire — does not apply this phase but mentioned for completeness).
- **Do NOT delete `pforge-mcp/capabilities.mjs`.** The shim is permanent (or until a dedicated codemod phase rewrites all consumer imports — that is NOT this phase).
- **Do NOT open follow-up phases from within S5.** Phase 52 and Phase 53 promotion to active is a separate roadmap decision after the retro.

---

## Resolved Decisions

Decisions locked at draft time; Step-2 hardener may sharpen but should not re-litigate.

1. **Capabilities-first ordering** — the three module-split phases run 51 (capabilities, 3.3 k LOC) → 52 (server, 9.8 k LOC) → 53 (orchestrator, 13.9 k LOC). Smallest-first validates the pattern before applying it to the riskier files.
2. **Re-export shim is the public contract** — `pforge-mcp/capabilities.mjs` survives as a ≤50-line shim. Consumer imports are NEVER modified. This is a hard constraint inherited by Phase 52/53.
3. **Snapshot-as-contract** — byte-identical JSON output of `buildCapabilitySurface()` before/after is the sole acceptance criterion for "no behavior change". Per-function unit tests are nice-to-have; the snapshot is the gate.
4. **Circular-import gate is non-negotiable** — `madge --circular` runs in every slice's validation gate, not just S0. ESM circular imports are a known trap in this codebase (see `/memories/repo/esm-circular-shim-pattern.md`).
5. **Sub-modules in `pforge-mcp/capabilities/` subdirectory** — not flat sibling files. Keeps related extracted modules grouped, makes future cleanup atomic, and signals "these belong together" to readers.
6. **4 sub-modules, not 6** — `tool-metadata.mjs`, `schemas.mjs`, `reference.mjs` + `subsystems.mjs` (separate files, one slice), `surface.mjs`. Combines small unrelated files into one slice while keeping each file single-purpose.
7. **`madge` is the only new devDependency** — required for the circular-import gate. No other new deps allowed by Forbidden Actions.
8. **No symbol renames** — `git mv` semantics only. Renames create churn in consumers' grep / IDE-find-references workflows and break the "trivially auditable" property of the split.
9. **Phase supersedes A3 sub-section of `Phase-PROPOSED-A-MODULE-SIZE-STUB.md`** — the stub's "single-pass extraction may not be needed" note is overridden by Phase 42's empirical catalog data (data tables dominate the file).
10. **Phase 52 and Phase 53 inherit all 4 cross-cutting concerns** — shim, snapshot, circular-import gate, no-behavior-change rule. The S5 retro must explicitly carry these forward into the Phase 52/53 stubs added to DEPLOYMENT-ROADMAP.
11. **Snapshot fixture is checked in** — `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` is committed. It is NOT regenerated by CI. Updating it requires a deliberate `--update-snapshot`-style commit that calls out the behavioral change being accepted.
12. **D-series ESLint errors block, B-series warnings do not** — if a moved function carries a complexity warning into its new sub-module, the slice ships. If a moved function carries a complexity-error, the slice ships AND Phase 43 owns the fix.
13. **No tests are deleted** — every existing `capabilities*.test.mjs` continues to work unmodified (the shim guarantees this). New tests (snapshot, circular) are additive.

---

## Required Decisions

All decisions for this phase are resolved in §"Resolved Decisions" above (13 items, locked at draft time). No open TBDs blocking execution.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Phase ordering within module-split work | ✅ Resolved | Capabilities → server → orchestrator (RD #1) |
| 2 | Backward-compat strategy | ✅ Resolved | Re-export shim, consumer imports untouched (RD #2) |
| 3 | "No behavior change" enforcement | ✅ Resolved | Byte-identical JSON snapshot (RD #3) |
| 4 | Circular-import prevention | ✅ Resolved | `madge --circular` gate on every slice (RD #4) |
| 5 | Sub-module directory layout | ✅ Resolved | `pforge-mcp/capabilities/` subdirectory (RD #5) |
| 6 | Number and grouping of sub-modules | ✅ Resolved | 4 files: tool-metadata, schemas, reference + subsystems, surface (RD #6) |
| 7 | New devDependency policy | ✅ Resolved | `madge` only; nothing else (RD #7) |
| 8 | Rename policy | ✅ Resolved | No renames — `git mv` semantics (RD #8) |
| 9 | Relationship to Phase-PROPOSED-A stub | ✅ Resolved | This phase supersedes the A3 sub-section (RD #9) |
| 10 | Pattern inheritance for 52/53 | ✅ Resolved | All 4 concerns inherited; retro carries forward (RD #10) |
| 11 | Snapshot fixture lifecycle | ✅ Resolved | Checked in; deliberate update only (RD #11) |
| 12 | ESLint-error compounding policy | ✅ Resolved | D-series blocks, others ship (RD #12) |
| 13 | Existing test treatment | ✅ Resolved | Unmodified; shim preserves (RD #13) |

---

## Slice Decomposition

> All slices are tagged **[sequential]** — each builds on the snapshot fixture and shim infrastructure landed in S0. No parallel group exists; the dependency chain (snapshot → extraction × 4 → retro) is strict.

### Slice 0 — Golden snapshot + circular-import gate

- **Depends On**: nothing (Phase 43 retro must have shipped per Execution Hold, but that is enforced outside the slice graph)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/capabilities.mjs` (read-only — surveying current `buildCapabilitySurface` output), `pforge-mcp/tests/capabilities.test.mjs` (existing test patterns), `pforge-mcp/package.json` (adding `madge` devDep)
- **Traces to**: Resolved Decisions #3, #4, #7, #11
- Add `madge@^7` to `pforge-mcp/package.json` devDependencies; run `npm install` in `pforge-mcp/` workspace
- Generate `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` by writing a one-shot script that calls `buildCapabilitySurface()` with fixed input (mock env-dependent values like `APP_VERSION` to deterministic strings) and writes the serialised output
- Add `pforge-mcp/tests/capabilities-snapshot.test.mjs` — reads the golden fixture, calls `buildCapabilitySurface()` with the same fixed input, asserts `JSON.stringify(actual, null, 2) === goldenContent`
- Add `pforge-mcp/tests/capabilities-no-circular.test.mjs` — uses `child_process.execFileSync('npx', ['madge', '--circular', 'pforge-mcp/capabilities.mjs'])` and asserts exit 0 + empty stdout
- Capture the current `capabilities.mjs` SHA-256 in the commit message body: `Anchor SHA256 of capabilities.mjs at S0: <hash>`
- **Validation Gate**:
```bash
bash -c "cd pforge-mcp && npx vitest run tests/capabilities-snapshot.test.mjs tests/capabilities-no-circular.test.mjs" && node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/tests/fixtures/capabilities-surface.golden.json'))throw new Error('golden missing');const j=JSON.parse(fs.readFileSync('pforge-mcp/tests/fixtures/capabilities-surface.golden.json','utf8'));if(!j.tools||!j.skills)throw new Error('golden fixture incomplete: missing tools or skills key');console.log('ok S0')"
```

### Slice 1 — Extract `capabilities/tool-metadata.mjs`

- **Depends On**: S0 (snapshot gate must exist before any extraction)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/capabilities.mjs` (lines 1-2160 — imports, `TOOL_METADATA`, `WORKFLOWS`), `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` (the contract)
- **Traces to**: Resolved Decisions #2, #5, #6, #8
- Create `pforge-mcp/capabilities/tool-metadata.mjs`
- Move `TOOL_METADATA` (~lines 40-2108) and `WORKFLOWS` (~lines 2109-2155) verbatim — no renames, no shape changes
- Preserve any imports the moved symbols depend on (`TOOL_NAMES` from `./enums.mjs` etc.) — copy the relevant import to the new file
- In `pforge-mcp/capabilities.mjs`, replace the moved declarations with `export { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';`
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/capabilities/tool-metadata.mjs'))throw new Error('tool-metadata.mjs missing');const sub=fs.readFileSync('pforge-mcp/capabilities/tool-metadata.mjs','utf8');if(!/export\s+const\s+TOOL_METADATA\b/.test(sub))throw new Error('TOOL_METADATA not exported from sub-module');if(!/export\s+const\s+WORKFLOWS\b/.test(sub))throw new Error('WORKFLOWS not exported from sub-module');const shim=fs.readFileSync('pforge-mcp/capabilities.mjs','utf8');if(!shim.includes(\"from './capabilities/tool-metadata.mjs'\"))throw new Error('capabilities.mjs missing re-export');console.log('ok S1 structure')" && bash -c "cd pforge-mcp && npx vitest run tests/capabilities-snapshot.test.mjs tests/capabilities-no-circular.test.mjs tests/capabilities.test.mjs"
```

### Slice 2 — Extract `capabilities/schemas.mjs`

- **Depends On**: S1 (extraction pattern proven on largest data table first)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/capabilities.mjs` (lines ~2158-2605 — `CLI_SCHEMA`, `CONFIG_SCHEMA`)
- **Traces to**: Resolved Decisions #2, #5, #6, #8
- Create `pforge-mcp/capabilities/schemas.mjs`
- Move `CLI_SCHEMA` (~lines 2158-2483) and `CONFIG_SCHEMA` (~lines 2486-2605) verbatim
- Preserve imports the moved symbols depend on
- `capabilities.mjs` adds: `export { CLI_SCHEMA, CONFIG_SCHEMA } from './capabilities/schemas.mjs';`
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/capabilities/schemas.mjs'))throw new Error('schemas.mjs missing');const sub=fs.readFileSync('pforge-mcp/capabilities/schemas.mjs','utf8');if(!/export\s+const\s+CLI_SCHEMA\b/.test(sub))throw new Error('CLI_SCHEMA not exported');if(!/export\s+const\s+CONFIG_SCHEMA\b/.test(sub))throw new Error('CONFIG_SCHEMA not exported');const shim=fs.readFileSync('pforge-mcp/capabilities.mjs','utf8');if(!shim.includes(\"from './capabilities/schemas.mjs'\"))throw new Error('shim missing schemas re-export');console.log('ok S2 structure')" && bash -c "cd pforge-mcp && npx vitest run tests/capabilities-snapshot.test.mjs tests/capabilities-no-circular.test.mjs tests/capabilities.test.mjs"
```

### Slice 3 — Extract `capabilities/reference.mjs` + `capabilities/subsystems.mjs`

- **Depends On**: S2
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/capabilities.mjs` (lines ~2609-2953 — `SYSTEM_REFERENCE`, `APP_VERSION` helper, `INNER_LOOP_SURFACE`)
- **Traces to**: Resolved Decisions #2, #5, #6, #8
- Create `pforge-mcp/capabilities/reference.mjs` — move `SYSTEM_REFERENCE` (~lines 2609-2819) and the `APP_VERSION` resolution helper
- Create `pforge-mcp/capabilities/subsystems.mjs` — move `INNER_LOOP_SURFACE` (~lines 2837-2953)
- `capabilities.mjs` adds two re-export lines: `export { SYSTEM_REFERENCE, APP_VERSION } from './capabilities/reference.mjs';` and `export { INNER_LOOP_SURFACE } from './capabilities/subsystems.mjs';`
- Two files created in one slice (allowed exception to "one extraction per slice" — both are <250 LOC and unrelated; bundling avoids a thin slice)
- **Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['pforge-mcp/capabilities/reference.mjs','pforge-mcp/capabilities/subsystems.mjs'])if(!fs.existsSync(f))throw new Error('missing: '+f);const ref=fs.readFileSync('pforge-mcp/capabilities/reference.mjs','utf8');if(!/export\s+const\s+SYSTEM_REFERENCE\b/.test(ref))throw new Error('SYSTEM_REFERENCE not exported');const sub=fs.readFileSync('pforge-mcp/capabilities/subsystems.mjs','utf8');if(!/export\s+const\s+INNER_LOOP_SURFACE\b/.test(sub))throw new Error('INNER_LOOP_SURFACE not exported');const shim=fs.readFileSync('pforge-mcp/capabilities.mjs','utf8');if(!shim.includes(\"from './capabilities/reference.mjs'\"))throw new Error('shim missing reference re-export');if(!shim.includes(\"from './capabilities/subsystems.mjs'\"))throw new Error('shim missing subsystems re-export');console.log('ok S3 structure')" && bash -c "cd pforge-mcp && npx vitest run tests/capabilities-snapshot.test.mjs tests/capabilities-no-circular.test.mjs tests/capabilities.test.mjs"
```

### Slice 4 — Extract `capabilities/surface.mjs` + convert `capabilities.mjs` to shim

- **Depends On**: S1, S2, S3 (all data tables already extracted — only logic remains)
- **Parallelism**: [sequential]
- **Context Files**: `pforge-mcp/capabilities.mjs` (lines ~2955-3293 — `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, private helpers), `pforge-mcp/tests/fixtures/capabilities-surface.golden.json`
- **Traces to**: Resolved Decisions #2, #3, #5, #6, #8 (the snapshot gate is the strongest test here)
- Create `pforge-mcp/capabilities/surface.mjs` — move `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, and all private helpers verbatim
- Re-write `pforge-mcp/capabilities.mjs` as a ≤50-line re-export shim (exact template in §"Scope Contract → S4")
- Snapshot gate is the proof — byte-identical JSON output OR the slice fails and is rolled back
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/capabilities/surface.mjs'))throw new Error('surface.mjs missing');const surf=fs.readFileSync('pforge-mcp/capabilities/surface.mjs','utf8');if(!/export\s+(async\s+)?function\s+buildCapabilitySurface\b|export\s+const\s+buildCapabilitySurface\b/.test(surf))throw new Error('buildCapabilitySurface not exported');if(!/writeToolsJson/.test(surf))throw new Error('writeToolsJson not in surface');if(!/writeCliSchema/.test(surf))throw new Error('writeCliSchema not in surface');const shim=fs.readFileSync('pforge-mcp/capabilities.mjs','utf8');const lines=shim.split(/\r?\n/).length;if(lines>50)throw new Error('shim too large: '+lines+' lines (max 50)');if(!shim.includes(\"from './capabilities/surface.mjs'\"))throw new Error('shim missing surface re-export');console.log('ok S4 shim is '+lines+' lines')" && bash -c "cd pforge-mcp && npx vitest run tests/capabilities-snapshot.test.mjs tests/capabilities-no-circular.test.mjs tests/capabilities.test.mjs tests/capabilities-doc-sync.test.mjs tests/brain-capability-negotiation.test.mjs"
```

### Slice 5 — Retro + roadmap update + CHANGELOG

- **Depends On**: S0-S4 all green
- **Parallelism**: [sequential]
- **Context Files**: `docs/plans/DEPLOYMENT-ROADMAP.md`, `CHANGELOG.md`, `docs/plans/testbed-findings/Phase-50-CLEAN-CODE-GUIDANCE-retro.md` (existing retro shape)
- **Traces to**: Resolved Decisions #10 (pattern carries to 52/53)
- Create `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` with sections: extraction summary (per-file before/after LOC table), friction log (what surprised us in the snapshot-as-contract pattern), Phase 52/53 carryover (does the 4-cross-cutting-concern pattern scale to 9.8 k and 13.9 k LOC?), final state proof (post-S4 audit re-run showing A3 finding resolved)
- In `docs/plans/DEPLOYMENT-ROADMAP.md`: move Phase 51 row to the Completed Phases table; remove the legacy `### Phase 44 — CLEAN-CODE-MODULE-EXTRACTION` Active entry and replace with two new DRAFT entries: `### Phase 52 — SERVER-SPLIT` (goal: apply Phase 51's pattern to `server.mjs`) and `### Phase 53 — ORCHESTRATOR-SPLIT` (goal: apply Phase 51's pattern to `orchestrator.mjs`); both inherit the four cross-cutting concerns by reference to this plan
- Append `CHANGELOG.md` `[Unreleased] → Changed` entry per §"Scope Contract → S5"
- **Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md'))throw new Error('retro missing');const rm=fs.readFileSync('docs/plans/DEPLOYMENT-ROADMAP.md','utf8');if(!rm.includes('51 — CAPABILITIES-SPLIT')&&!rm.includes('Phase 51'))throw new Error('Phase 51 not in roadmap');if(!rm.includes('Phase 52 — SERVER-SPLIT'))throw new Error('Phase 52 stub not added');if(!rm.includes('Phase 53 — ORCHESTRATOR-SPLIT'))throw new Error('Phase 53 stub not added');if(rm.includes('### Phase 44 — CLEAN-CODE-MODULE-EXTRACTION'))throw new Error('legacy Phase 44 Active entry not removed');const cl=fs.readFileSync('CHANGELOG.md','utf8');if(!/capabilities\.mjs.*sub-modules|Decomposed pforge-mcp\/capabilities\.mjs/i.test(cl))throw new Error('CHANGELOG entry missing');console.log('ok S5')"
```

---

## Acceptance Criteria

- **MUST**: A golden snapshot of `buildCapabilitySurface()` output exists at `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` and is checked into git (owned by S0).
- **MUST**: A circular-import gate (`madge --circular`) runs in every slice's validation and exits 0 (defined in S0; consumed by S1-S4).
- **MUST**: `TOOL_METADATA` and `WORKFLOWS` move verbatim into `pforge-mcp/capabilities/tool-metadata.mjs` and are re-exported from `pforge-mcp/capabilities.mjs` (S1).
- **MUST**: `CLI_SCHEMA` and `CONFIG_SCHEMA` move verbatim into `pforge-mcp/capabilities/schemas.mjs` and are re-exported (S2).
- **MUST**: `SYSTEM_REFERENCE` + `APP_VERSION` move into `pforge-mcp/capabilities/reference.mjs`; `INNER_LOOP_SURFACE` moves into `pforge-mcp/capabilities/subsystems.mjs`; all three re-exported (S3).
- **MUST**: `buildCapabilitySurface`, `writeToolsJson`, `writeCliSchema`, and private helpers move into `pforge-mcp/capabilities/surface.mjs` and are re-exported (S4).
- **MUST**: Post-S4, `pforge-mcp/capabilities.mjs` is ≤50 LOC and contains only `export … from …` lines plus a file-header comment (S4 gate enforces).
- **MUST**: The snapshot gate (byte-identical `buildCapabilitySurface()` JSON output vs golden fixture) passes at the end of every slice S1-S4.
- **MUST**: Zero consumer files outside this plan's scope are modified — no `from './capabilities.mjs'` import statement anywhere in the codebase is touched (S1-S4).
- **MUST**: No new `forge_*` MCP tool surface is added, removed, or changed in signature (snapshot + existing `capabilities.test.mjs` enforce together).
- **MUST**: `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` exists and documents pattern carryover for Phase 52 (`server.mjs`) and Phase 53 (`orchestrator.mjs`) — specifically the four cross-cutting concerns (shim, snapshot-as-contract, circular-import gate, no-behavior-change) (S5).
- **MUST**: `docs/plans/DEPLOYMENT-ROADMAP.md` retires the legacy `### Phase 44 — CLEAN-CODE-MODULE-EXTRACTION` Active entry and promotes two new DRAFT stubs `### Phase 52 — SERVER-SPLIT` and `### Phase 53 — ORCHESTRATOR-SPLIT` (S5).
- **MUST**: `CHANGELOG.md` contains an `[Unreleased] → ### Changed` entry naming `pforge-mcp/capabilities.mjs` decomposition and asserting byte-identical surface (S5).
- **SHOULD**: Each sub-module file is itself ≤2,200 LOC (`tool-metadata.mjs` will be the largest at ~2,100; if it exceeds 2,200 because of inadvertent comment-block movement, audit before commit).
- **SHOULD**: No sub-module in `pforge-mcp/capabilities/` imports from another sub-module in the same directory — they are leaf-level (cross-imports route through `enums.mjs` / `memory.mjs` / Node built-ins).
- **SHOULD**: Post-S4, a re-run of `scripts/audit/clean-code-review.mjs` shows the A3 (`capabilities.mjs` >3,000 LOC) module-size error is resolved (file dropped from 3,294 LOC to ≤50 LOC).
- **SHOULD**: Reviewer Gate passed (zero 🔴 Critical findings) before promoting Phase 51 to Completed.

---

## Re-anchor Checkpoints

> Re-anchor = a forced re-read of the Scope Contract + golden fixture state at a known-stable point. If a checkpoint fails, halt and escalate; do NOT proceed with the next slice.

| After slice | Re-anchor action |
|-------------|------------------|
| **S0** | Confirm `pforge-mcp/tests/fixtures/capabilities-surface.golden.json` exists, is ≥1 KB, and parses as valid JSON with both `tools` and `skills` top-level keys. Confirm `madge` is installed (`node -e "require.resolve('madge', {paths:['./pforge-mcp/node_modules']})"`). |
| **S1** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/capabilities.mjs` and `pforge-mcp/capabilities/tool-metadata.mjs` (no other file). Confirm shim re-export line is byte-exact (`export { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';`). |
| **S2** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/capabilities.mjs` and `pforge-mcp/capabilities/schemas.mjs`. |
| **S3** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/capabilities.mjs`, `pforge-mcp/capabilities/reference.mjs`, and `pforge-mcp/capabilities/subsystems.mjs`. |
| **S4** | Re-read §"Forbidden Actions". Confirm `git diff --stat HEAD~1` touches only `pforge-mcp/capabilities.mjs` and `pforge-mcp/capabilities/surface.mjs`. Confirm post-shim `wc -l pforge-mcp/capabilities.mjs` ≤50. Run the full `pforge-mcp` test suite (`bash -c "cd pforge-mcp && npx vitest run"`) — all tests must pass, not just the 5 snapshot/circular/capabilities tests. |
| **S5** | Confirm DEPLOYMENT-ROADMAP retiral of Phase 44 Active entry is complete (no stale reference). Re-run `node scripts/audit/clean-code-review.mjs --suite module-size` (or equivalent) and confirm A3 finding is gone. |

---

## Definition of Done

- [ ] All 5 execution slices (S0-S5; six total counting S0) committed individually with conventional-commit messages
- [ ] All slice validation gates green
- [ ] All Re-anchor Checkpoints passed
- [ ] Snapshot fixture (`pforge-mcp/tests/fixtures/capabilities-surface.golden.json`) is byte-identical pre-S0 vs post-S4 (the proof of zero behavior change)
- [ ] Final `pforge-mcp/capabilities.mjs` is ≤50 LOC and is a pure re-export shim
- [ ] All four sub-modules exist under `pforge-mcp/capabilities/` (`tool-metadata.mjs`, `schemas.mjs`, `reference.mjs`, `subsystems.mjs`, `surface.mjs` — five files total)
- [ ] Full `pforge-mcp` test suite passes (`bash -c "cd pforge-mcp && npx vitest run"`)
- [ ] Full `pforge-master` test suite passes (no cross-impact expected, but verified)
- [ ] `madge --circular pforge-mcp/` exits 0
- [ ] No consumer file outside this plan's scope is modified (verified via `git log --name-only` for the phase's commit range)
- [ ] `docs/plans/testbed-findings/Phase-51-CAPABILITIES-SPLIT-retro.md` written and committed
- [ ] `docs/plans/DEPLOYMENT-ROADMAP.md` updated: Phase 51 in Completed table; legacy Phase 44 Active entry removed; Phase 52 + 53 DRAFT stubs added
- [ ] `CHANGELOG.md` `[Unreleased] → Changed` entry added
- [ ] Reviewer Gate passed (zero 🔴 Critical findings)
- [ ] `lockHash` in plan frontmatter matches at run time

---

## Stop Conditions

Halt the phase immediately (do NOT brute-force a retry) when any of the following occurs:

| Condition | Why halt | Recovery |
|-----------|----------|----------|
| **Snapshot gate fails twice on the same slice** | Indicates a non-trivial behavior change crept in — either a moved declaration depends on a private helper still in `capabilities.mjs` (broken closure), or a re-export drops something. Brute-force will not find it. | Roll back the slice; diff `git show HEAD` against the snapshot output; identify the missing/changed JSON field; refile the extraction. |
| **`madge --circular` reports a cycle** | A sub-module imports from another sub-module (forbidden by RD #4). The cycle WILL break at runtime in unpredictable ways. | Roll back; route the offending dependency through `enums.mjs` / `memory.mjs` / Node built-ins. |
| **Any test outside the 5 capability tests starts failing post-slice** | The split has leaked into the consumer surface — possible re-export typo (e.g. default vs named export mismatch). | Roll back; verify each re-export line exactly matches the pre-split export signature (named vs default, sync vs async). |
| **Build / lint failure introduced by the slice** | New file has a syntax error or violates an existing lint rule. | Fix in the same commit OR roll back. Do not advance with a broken build. |
| **A consumer file outside this plan's scope was modified** | Scope-contract violation. Per Forbidden Actions, consumer imports MUST NOT be touched. | Roll back the offending change; the shim makes consumer edits unnecessary. |
| **Security check fails** (e.g. `forge_secret_scan` surfaces a new secret introduced by a moved file) | Genuine breach risk — sub-module file may have unintentionally inlined a config value. | Halt, redact, re-do extraction with secrets routed through env or `.forge/secrets.json`. |
| **Snapshot fixture is regenerated mid-phase without an explicit reason in the commit message** | Fixture-as-contract violation — the fixture is the goal-post; moving the goal-post invalidates the proof. | Roll back the fixture change; re-do the slice that triggered the mismatch. |
| **Final shim exceeds 50 LOC** | Likely accidental retention of source code (not just re-exports + header). | Audit `capabilities.mjs`; delete any non-re-export non-comment line; re-run the gate. |

---

## Retry Strategy

Per-slice failure modes and recovery:

| Failure | Recovery |
|---------|----------|
| Snapshot gate fails after extraction | Roll back the slice's commit (`git reset --hard HEAD~1`), re-attempt the extraction with closer attention to import-preservation. Snapshot diff in the test output identifies the exact missing/changed field. |
| `madge --circular` reports a cycle | Roll back, identify the offending cross-import between sub-modules, route the dependency through `enums.mjs` / `memory.mjs` / Node built-ins instead. Sub-modules must be leaf-level. |
| `tests/capabilities.test.mjs` fails after extraction but snapshot passes | Existing test is asserting something the snapshot doesn't capture. Add the missing field to the golden fixture FIRST, regenerate, re-run. Then re-attempt the extraction. (This is the only legitimate reason to regenerate the fixture mid-phase.) |
| `npm install` fails after adding `madge` | Pin to a known-good version (`madge@^7`); if still broken, file a meta-bug via `forge_meta_bug_file` (class: orchestrator-defect, severity: medium) and halt. |
| Slice 4 produces a `capabilities.mjs` shim >50 LOC | Audit for accidentally-retained code (top-of-file comment block, JSDoc, dead imports). The shim is mechanical — anything beyond `export … from …` lines (+ file header comment) is a mistake. |
| Two consecutive failures on the same slice | Stop the run, emit a Blocker Report per `status-reporting.instructions.md`, escalate to human owner. Do NOT brute-force a third attempt. |

---

## References

- [`docs/plans/cleanup-findings/proposed-phases/Phase-PROPOSED-A-MODULE-SIZE-STUB.md`](./cleanup-findings/proposed-phases/Phase-PROPOSED-A-MODULE-SIZE-STUB.md) — original A-series stub (this phase supersedes its A3 sub-section)
- [`docs/plans/Phase-42-CLEAN-CODE-AUDIT-PLAN.md`](./Phase-42-CLEAN-CODE-AUDIT-PLAN.md) — source of the empirical catalog data driving the seam analysis
- [`docs/plans/Phase-50-CLEAN-CODE-GUIDANCE-PLAN.md`](./Phase-50-CLEAN-CODE-GUIDANCE-PLAN.md) — format template for this plan
- [`.github/instructions/clean-code.instructions.md`](../../.github/instructions/clean-code.instructions.md) — module-size tier definitions (3,000 LOC = high)
- [`.github/instructions/architecture-principles.instructions.md`](../../.github/instructions/architecture-principles.instructions.md) — Dependency Rule, Component Cohesion (CCP), Single Responsibility (the principles this split serves)
- `/memories/repo/esm-circular-shim-pattern.md` — prior-art note on ESM circular imports as a known trap; informs Resolved Decision #4
- `/memories/repo/aci-hardening-pattern.md` — adjacent precedent for "extract logic from a god-module while preserving public API"
