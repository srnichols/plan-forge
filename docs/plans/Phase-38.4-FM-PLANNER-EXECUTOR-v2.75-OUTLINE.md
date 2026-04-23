---
crucibleId: bc753a48-cd91-4460-8bae-9fe527bbb717
lane: feature
source: human
status: outline
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.4 — Forge-Master Planner-Executor Split

> **Target release**: v2.75.0
> **Status**: Outline — ready for step2 hardening
> **Depends on**: Phase-38.3 shipped (v2.74.0). Planner uses `forge_graph_query` to decompose multi-step queries.

## Core Problem

The current `runTurn` reasoning loop in `pforge-master/src/reasoning.mjs` is one-shot reactive: classify → call up to N tools → reply. There is no "plan first, execute second" stage. So a query like *"show cost for runs that failed last week, broken down by model"* either takes 5+ tool calls of trial-and-error or falls back to a vague answer.

Adding a planner stage that DECOMPOSES the user query into a sequence of read-only tool calls (using the Phase-38.3 graph + cost service + run index), then executes them, then reasons over the joined result, lifts Forge-Master from "smart chatbot" to "system AI".

## Design Constraints

- **Read-only tools only.** Planner can only schedule tools already on the lane's allowlist; cannot invent new tools or schedule write tools.
- **Bounded.** Max 5 planned steps per turn. Hard timeout 30s for the full plan execution.
- **Falls back to single-shot reactive.** If planner produces zero steps OR detects the query is simple (single tool obvious), skip to existing tool loop. Backward-compatible.
- **Visible plan.** Planned steps stream as a new SSE event `plan` (sibling to `classification`, `tool-call`, `error`). Dashboard renders the plan tree.
- **No tool-list mutations.** Lanes are frozen per Phase-32 guardrail.
- **Token-budgeted.** Planner stage uses `claude-haiku` or whatever cheap model the router resolves for sonnet-mini-tier. Big reasoning still uses the lane's escalated model.

## Candidate Slices

### Slice 1 — Planner module + plan schema

**Scope**: New `pforge-master/src/planner.mjs` exporting `plan({userMessage, classification, lane, allowedTools, deps}) → {steps: [{tool, args, rationale}], skipReason?: string}`. New `pforge-master/src/__tests__/planner.test.mjs`.

- Step shape: `{tool: string, args: object, rationale: string, dependsOn?: string[]}`.
- Skip rules: lane=offtopic, single-tool-obvious heuristic, zero allowed tools.
- **Gate**: vitest on planner test file green.

### Slice 2 — Executor that walks the plan + joins results

**Scope**: New `pforge-master/src/plan-executor.mjs` exporting `executePlan(plan, deps) → {results: [{step, output, error?}], totalDurationMs}`. Sequential by default; parallelizes steps with no `dependsOn`.

- **Gate**: vitest verifies sequential execution, parallel branches, error short-circuit, timeout enforcement.

### Slice 3 — Wire into `runTurn` + SSE `plan` event

**Scope**: `runTurn` calls `planner.plan(...)`. If steps non-empty, calls `executePlan`, then synthesizes reply over joined results. SSE emits `plan` with the planned steps before execution. `http-routes.mjs` updated to forward.

- **Gate**: SSE test asserts `plan` event arrives before any `tool-call` event AND only when planner returned steps.

### Slice 4 — Probe harness + release v2.75.0

**Scope**: 3 new probes in `.forge/validation/probes.json` exercise multi-step queries. Probe harness asserts `plan` event in SSE stream for those probes. CHANGELOG, ROADMAP, version bump.

- **Gate**: `node scripts/probe-forge-master.mjs --keyword-only` shows ≥1 successful planned-execution probe.

## Out of Scope

- ❌ Write tools or auto-PR creation.
- ❌ Adding tools to operational/troubleshoot/build lanes.
- ❌ Multi-turn planning (each turn plans independently).
- ❌ Replacing the existing reactive tool loop — planner is opt-in based on query shape.
