---
crucibleId: dc32e7bd-2327-4000-99f8-722fac005c38
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.3 — Plan Forge Knowledge Graph

> **Target release**: v2.74.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-37 shipped (v2.71.0). Independent of 38.1/38.2 — can ship in parallel.
> **Unblocks**: Phase-38.4 (planner needs the graph), Phase-38.6 (pattern surfacing reads the graph).

## Core Problem

Plan Forge has rich artifacts — phases, slices, commits, files, tests, bugs, memory, runs, costs — but they're scattered across disk (`docs/plans/**`, `.forge/runs/**`, `.git/log`, `.forge/bugs/**`, `pforge-mcp/brain.mjs`). When Forge-Master is asked "what touched the classifier in the last 30 days?" it has to fan out tool calls to brain_recall, git log, file search, then stitch results together. Slow, expensive, and lossy.

A queryable in-memory graph collapses this into a single read. Nodes: Phase, Slice, Commit, File, Test, Bug, Memory, Run. Edges: Phase→Slice, Slice→Commit, Commit→File, File→Test, Slice→Bug, Slice→Memory, Run→Slice.

## Design Constraints

- **Read-only indexer.** The graph is built FROM existing artifacts; never modifies them.
- **In-memory + persisted snapshot.** Live graph in process (Forge-Master HTTP server). Snapshot to `.forge/graph/snapshot.json` for cold-start. Refresh on git post-commit hook or `pforge graph rebuild`.
- **Bounded.** Last 90 days of commits, last 10 runs per phase, last 200 bugs. Older artifacts addressable by ID but not auto-indexed.
- **Query API, not graph DB.** Pure JS module exports `queryByPhase`, `queryByFile`, `queryRecentChanges({since, type})`, `neighbors(nodeId, {edgeType})`. No Neo4j, no SPARQL.
- **No tool-list mutations.** Add a new MCP tool `forge_graph_query` to the **advisory** lane only (Phase-32 guardrail: build/operational/troubleshoot tool lists are frozen).
- **Honest empty-state.** On fresh repos the graph is empty; queries return `{nodes: [], edges: []}` not errors.

## Candidate Slices

### Slice 1 — Graph schema + builder

**Scope**: New `pforge-mcp/graph/schema.mjs` (node + edge type definitions, JSDoc), `pforge-mcp/graph/builder.mjs` (`buildGraph(projectDir, {since}) → {nodes, edges}`). Reads `docs/plans/*.md` for phases/slices, `git log` for commits, `.forge/runs/**` for runs, `.forge/bugs/**` for bugs. New `pforge-mcp/tests/graph-builder.test.mjs`.

- **Gate**: `npx vitest run pforge-mcp/tests/graph-builder.test.mjs` green.

### Slice 2 — Query API + snapshot persistence

**Scope**: `pforge-mcp/graph/query.mjs` — `queryByPhase(name)`, `queryByFile(path)`, `queryRecentChanges({since, type})`, `neighbors(nodeId, opts)`. Snapshot to `.forge/graph/snapshot.json`. Lazy load on first query.

- **Gate**: new query test file green; covers each API + snapshot round-trip.

### Slice 3 — `forge_graph_query` MCP tool + advisory-lane wire-up

**Scope**: `pforge-mcp/server.mjs` adds `forge_graph_query` tool. `pforge-master/src/intent-router.mjs` adds the tool ONLY to the advisory lane (and explicitly NOT to operational/troubleshoot/build per Phase-32 guardrail). `capabilities.mjs` + `tools.json` registration.

- **Gate**: `npx vitest run pforge-master/tests/forge-master.test.mjs` green; verifies tool is in advisory allowlist and absent from operational/troubleshoot/build.

### Slice 4 — Git post-commit refresh + CLI + release v2.74.0

**Scope**: `.github/hooks/postSlice` triggers graph rebuild. `pforge graph rebuild|stats|query <type>` CLI commands. CHANGELOG, ROADMAP, version bump.

- **Gate**: `pforge graph stats` exits 0 with a node-count summary on the current repo.

## Out of Scope

- ❌ Embedding nodes for semantic search (that's a future phase, not 38.x).
- ❌ Modifying any source artifact based on graph queries.
- ❌ Adding the new tool to operational/troubleshoot/build lanes.
- ❌ Cross-repo graph (single project root only).
