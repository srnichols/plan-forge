---
crucibleId: dc32e7bd-2327-4000-99f8-722fac005c38
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.3 — Plan Forge Knowledge Graph

> **Target release**: v2.74.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0). Independent of 38.1/38.2 — can ship in parallel with those phases.
> **Unblocks**: Phase-38.4 (planner needs `forge_graph_query`), Phase-38.6 (pattern surfacing reads the graph).

---

## Specification Source

- **Problem**: Rich Plan Forge artifacts (phases, slices, commits, files, tests, bugs, runs) are scattered across disk. Answering "what touched the classifier in the last 30 days?" requires multiple sequential tool calls — `brain_recall`, `git log`, file search — and is slow, expensive, and lossy.
- **Root cause**: No in-process queryable index of cross-artifact relationships exists.
- **Contract**: After this phase, a queryable in-memory graph (snapshot-persisted to `.forge/graph/snapshot.json`) collapses multi-artifact queries into a single `forge_graph_query` MCP tool call. The tool is added only to the advisory lane (Phase-32 guardrail).

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-mcp/graph/schema.mjs` — node + edge type definitions with JSDoc. Node types: `Phase`, `Slice`, `Commit`, `File`, `Test`, `Bug`, `Memory`, `Run`. Edge types: `Phase→Slice`, `Slice→Commit`, `Commit→File`, `File→Test`, `Slice→Bug`, `Slice→Memory`, `Run→Slice`.
- New `pforge-mcp/graph/builder.mjs` — `buildGraph(projectDir, {since}) → {nodes, edges}`. Reads `docs/plans/*.md`, `git log`, `.forge/runs/**`, `.forge/bugs/**`.
- New `pforge-mcp/graph/query.mjs` — `queryByPhase(name)`, `queryByFile(path)`, `queryRecentChanges({since, type})`, `neighbors(nodeId, opts)`. Lazy-load graph from snapshot; snapshot written to `.forge/graph/snapshot.json`.
- New `pforge-mcp/tests/graph-builder.test.mjs` — unit tests for builder.
- New `pforge-mcp/tests/graph-query.test.mjs` — unit tests for query API + snapshot round-trip.
- `pforge-mcp/server.mjs` — register `forge_graph_query` MCP tool.
- `pforge-master/src/intent-router.mjs` — add `forge_graph_query` to advisory lane's `LANE_TOOLS` ONLY; verify absent from operational/troubleshoot/build lists.
- `pforge-mcp/capabilities.mjs` + `pforge-mcp/tools.json` — register `forge_graph_query`.
- `.github/hooks/postSlice` — trigger graph rebuild after each slice commit.
- `pforge.ps1` + `pforge.sh` — `graph rebuild|stats|query <type>` CLI commands.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.74.0 release metadata.

### Out of Scope

- ❌ Embedding graph nodes for semantic search (future phase beyond 38.x).
- ❌ Modifying any source artifact based on graph queries — purely read-only indexer.
- ❌ Adding `forge_graph_query` to operational, troubleshoot, or build lanes (Phase-32 guardrail).
- ❌ Cross-repo graph — single project root only.
- ❌ Graph database (Neo4j, SQLite) — pure JS module in process.
- ❌ Changes to build/operational/troubleshoot lane tool lists (Phase-32 guardrail).

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Do not add `forge_graph_query` to `LANE_TOOLS.operational`, `LANE_TOOLS.troubleshoot`, or `LANE_TOOLS.build`.
- ❌ Do not modify any `docs/plans/*.md`, `.forge/runs/**`, or `.forge/bugs/**` files during graph construction — read-only indexer.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Graph storage format | Resolved | In-memory JS objects + JSON snapshot to `.forge/graph/snapshot.json` |
| 2 | Bounds | Resolved | Last 90 days of commits, last 10 runs per phase, last 200 bugs |
| 3 | Query API surface | Resolved | `queryByPhase`, `queryByFile`, `queryRecentChanges`, `neighbors` |
| 4 | `forge_graph_query` lane placement | Resolved | Advisory lane ONLY (Phase-32 guardrail) |
| 5 | Snapshot refresh | Resolved | On `pforge graph rebuild` or git postSlice hook |
| 6 | Empty-state behavior | Resolved | Returns `{nodes: [], edges: []}` — no error |

---

## Acceptance Criteria

### Slice 1 — Graph schema + builder

- **MUST**: `pforge-mcp/graph/schema.mjs` defines and exports node type constants and edge type constants with JSDoc.
- **MUST**: `pforge-mcp/graph/builder.mjs` exports `buildGraph(projectDir, {since}) → {nodes, edges}`.
- **MUST**: `buildGraph` reads `docs/plans/*.md` to extract Phase and Slice nodes.
- **MUST**: `buildGraph` calls `git log --oneline` to extract Commit nodes and infers Slice→Commit edges from commit messages referencing slice keywords.
- **MUST**: `buildGraph` reads `.forge/runs/**` for Run nodes and `.forge/bugs/**` for Bug nodes.
- **MUST**: On a fresh repo with no artifacts, `buildGraph` returns `{nodes: [], edges: []}` without throwing.
- **MUST**: `pforge-mcp/tests/graph-builder.test.mjs` passes and covers: Phase + Slice extraction from fixture plan file, Commit nodes from fixture git log, empty-state, and `since` date filtering.

### Slice 2 — Query API + snapshot persistence

- **MUST**: `pforge-mcp/graph/query.mjs` exports `queryByPhase(name)`, `queryByFile(path)`, `queryRecentChanges({since, type})`, `neighbors(nodeId, opts)`.
- **MUST**: Each query function returns `{nodes: [...], edges: [...]}` — consistent shape.
- **MUST**: First call to any query function loads snapshot from `.forge/graph/snapshot.json` if present; otherwise calls `buildGraph`.
- **MUST**: `buildGraph` writes snapshot to `.forge/graph/snapshot.json` after construction.
- **MUST**: Snapshot round-trip test: build → write → load → query returns same result.
- **MUST**: `pforge-mcp/tests/graph-query.test.mjs` passes covering all 4 query functions + snapshot round-trip.

### Slice 3 — `forge_graph_query` MCP tool + advisory-lane wire-up

- **MUST**: `pforge-mcp/server.mjs` registers `forge_graph_query` tool with schema `{type, filter, since}`.
- **MUST**: `pforge-master/src/intent-router.mjs` adds `forge_graph_query` to `LANE_TOOLS.advisory`.
- **MUST**: `forge_graph_query` is NOT present in `LANE_TOOLS.operational`, `LANE_TOOLS.troubleshoot`, or `LANE_TOOLS.build`.
- **MUST**: `pforge-mcp/capabilities.mjs` includes `forge_graph_query` in the advisory tool list.
- **MUST**: `pforge-master/tests/forge-master.test.mjs` (or a new graph-tool test) verifies: tool is in advisory allowlist AND absent from operational/troubleshoot/build allowlists.
- **MUST**: Full pforge-master test suite passes.

### Slice 4 — Git hook + CLI + release v2.74.0

- **MUST**: `.github/hooks/postSlice` invokes `pforge graph rebuild` (or equivalent node script) after each slice commit.
- **MUST**: `pforge graph rebuild` regenerates snapshot and exits 0.
- **MUST**: `pforge graph stats` prints node count by type and exits 0 on current repo.
- **MUST**: `pforge graph query <type>` prints matching nodes and exits 0 (returns empty on fresh repo).
- **MUST**: `VERSION` contains exactly `2.74.0`.
- **MUST**: `CHANGELOG.md` has a `[2.74.0]` section mentioning `knowledge graph`, `forge_graph_query`, and `advisory lane`.
- **MUST**: `ROADMAP.md` reflects Phase-38.3 / v2.74.0 as shipped.

### Quality bar

- **SHOULD**: `neighbors(nodeId, {edgeType})` supports filtering by a specific edge type.
- **SHOULD**: `forge_graph_query` tool response includes `nodeCount` + `edgeCount` summary fields.
- **SHOULD**: `.forge/graph/snapshot.json` is gitignored (runtime artifact).

---


### Slice 38.3 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.3/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.3/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Graph schema + builder [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-mcp/graph/schema.mjs`
- `pforge-mcp/graph/builder.mjs`
- `pforge-mcp/tests/graph-builder.test.mjs`

**Depends On**: Phase-37 shipped (v2.71.0).

**Context Files**:
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — understand tool registration pattern
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Define schema constants in `schema.mjs`: `NODE_TYPES`, `EDGE_TYPES` with JSDoc.
2. `buildGraph`: parse `docs/plans/*.md` for frontmatter to extract phases; scan slice headings for Slice nodes.
3. Run `git log --oneline --since=<90d>` via `child_process.execSync` to get Commit nodes.
4. Glob `.forge/runs/**/*.json` for Run nodes; `.forge/bugs/**/*.json` for Bug nodes.
5. Wire tests with fixture plan MD and mock git log output in temp dir.

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/graph-builder.test.mjs
```

**Commit**: `feat(graph): knowledge graph schema + builder`

---

### Slice 2 — Query API + snapshot persistence [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-mcp/graph/query.mjs`
- `pforge-mcp/tests/graph-query.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-mcp/graph/builder.mjs](../../pforge-mcp/graph/builder.mjs) (Slice 1)
- [pforge-mcp/graph/schema.mjs](../../pforge-mcp/graph/schema.mjs) (Slice 1)

**Steps**:
1. Implement `queryByPhase`: filter nodes by `type === "Phase"` and `name` match; return connected subgraph.
2. Implement `queryByFile`: find File nodes matching path; return connected commits and tests.
3. Implement `queryRecentChanges`: filter Commit/Slice/Run nodes by `since` date.
4. Implement `neighbors`: breadth-first traversal 1 hop, with optional `edgeType` filter.
5. Lazy-load: on first call read snapshot; on cache miss call `buildGraph`.
6. Write snapshot round-trip test.

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/graph-query.test.mjs
```

**Commit**: `feat(graph): query API + snapshot persistence`

---

### Slice 3 — `forge_graph_query` MCP tool + advisory wire-up [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge-mcp/server.mjs`
- `pforge-master/src/intent-router.mjs`
- `pforge-mcp/capabilities.mjs`
- `pforge-mcp/tools.json`

**Files to create**:
- `pforge-master/tests/graph-tool-lane.test.mjs`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — tool registration pattern
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs) — LANE_TOOLS structure
- [pforge-master/tests/forge-master.test.mjs](../../pforge-master/tests/forge-master.test.mjs)

**Steps**:
1. Register `forge_graph_query` in `server.mjs` with input schema `{type: string, filter: string, since: string}`.
2. In `intent-router.mjs`, add `"forge_graph_query"` to `LANE_TOOLS.advisory` ONLY.
3. Update `capabilities.mjs` and `tools.json`.
4. Write `graph-tool-lane.test.mjs`: assert `LANE_TOOLS.advisory.includes("forge_graph_query")` AND each of operational/troubleshoot/build does NOT include it.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/graph-tool-lane.test.mjs
```

**Commit**: `feat(graph): forge_graph_query MCP tool — advisory lane only`

---

### Slice 4 — Git hook + CLI + release v2.74.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to modify**:
- `.github/hooks/postSlice`
- `pforge.ps1`
- `pforge.sh`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [pforge.ps1](../../pforge.ps1)
- [.github/hooks/postSlice](../../.github/hooks/postSlice)

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='2.74.0')throw new Error('VERSION mismatch: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.74.0]'))throw new Error('missing [2.74.0]');if(!c.includes('knowledge graph'))throw new Error('missing narrative');console.log('ok');"
```

**Commit**: `chore(release): v2.74.0 — Plan Forge knowledge graph`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.74.0 released).

**Context Files**:
- [pforge-mcp/graph/builder.mjs](pforge-mcp/graph/builder.mjs)
- [pforge-mcp/graph/query.mjs](pforge-mcp/graph/query.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.3-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.3/hammer-<iter>.md`.

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.3.mjs`. 100 `buildGraph` + `queryByPhase` + `queryByFile` cycles. Edge cases: cyclic graph fixture, node with no edges, 500-commit git log, unicode in commit messages. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.3/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Cyclic edge in fixture (Phase→Slice→Phase loop) — assert query terminates without infinite loop.
- Git log exec fails (no git repo) — `buildGraph` returns empty graph, does not throw.
- `.forge/graph/snapshot.json` corrupted (truncated JSON) — `loadSnapshot` returns null and triggers rebuild.
- Builder invoked concurrently — snapshot not corrupted (tmpfile+rename pattern).
- Plan .md with malformed frontmatter — builder skips that file, logs warning, continues.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.3-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.3/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.3/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.3-FM-KNOWLEDGE-GRAPH-v2.74-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.3/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.3.mjs --validate-converged ; npx vitest run pforge-mcp/tests/graph-builder.test.mjs ; pforge analyze docs/plans/Phase-38.3-FM-KNOWLEDGE-GRAPH-v2.74-PLAN.md
```

**Commit**: `test(38.3): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Confirm the graph `builder.mjs` is read-only — it must not write to any plan files or run artifacts. Review test coverage for empty-state.

**After Slice 2**: Re-read `LANE_TOOLS` in `intent-router.mjs` — confirm `forge_graph_query` is NOT yet in any lane (it gets added in Slice 3). Confirm snapshot file is under `.forge/graph/` and gitignored.

**After Slice 3**: Verify the lane-restriction test passes. Check `capabilities.mjs` update is complete and consistent with `tools.json`.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] `forge_graph_query` is in advisory LANE_TOOLS and absent from all other lane allowlists.
- [ ] Zero regressions in full pforge-master and pforge-mcp test suites.
- [ ] `.forge/graph/` and `.forge/fm-sessions/` are gitignored.
- [ ] `VERSION` = `2.74.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.74.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ `forge_graph_query` appears in operational/troubleshoot/build lane allowlist (Phase-32 violation) → halt immediately.
- ❌ `buildGraph` modifies any plan or artifact file → halt.
- ❌ Graph query test suite fails and cannot be fixed within time budget → abort, document in postmortem.
- ❌ `pforge-master` full suite drops below baseline → regression investigation.
- ❌ Any file outside the listed scope is modified → halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `git log` parse fails on repos with unusual commit message formats | Use `--format=%H %s` and handle parse errors gracefully; return empty commit list rather than throw |
| 2 | Graph build time exceeds 10s on large repos (90 days of commits) | Add a `--since=30d` default in CLI; allow `--since` override; memoize within a process session |
| 3 | Snapshot JSON grows large (10K+ nodes) | Cap at 90-day window + 10-runs-per-phase + 200-bug limits as specified in outline; log warning if node count exceeds 5000 |
| 4 | `LANE_TOOLS` mutation accidentally adds tool to wrong lane in a future phase | The new test `graph-tool-lane.test.mjs` pins the constraint permanently — any future accidental addition will fail CI |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~12K | ~$0.03 |
| Slice 2 | ~12K | ~$0.03 |
| Slice 3 | ~8K | ~$0.02 |
| Slice 4 | ~5K | ~$0.01 |
| **Total** | **~37K** | **~$0.09** |

---

## Session Break Points

After Slice 2 — Slice 3 context-switches to MCP server registration and lane allowlist changes which require re-reading different modules; fresh session prevents stale mental model of the graph construction details.
