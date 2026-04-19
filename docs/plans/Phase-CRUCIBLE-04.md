---
crucibleId: 7a4c8e5d-9f13-4b2a-b7f8-c3d2a5e9f7b1
source: self-hosted
status: in_progress
phase: CRUCIBLE-04
---

# Phase CRUCIBLE-04: Crucible-aware fix proposals

## Why

CRUCIBLE-03 gave the watcher (and by extension the Dashboard) the ability to
**detect** stalled smelts and orphan handoffs. But detection without a
suggested remediation is half a product: operators still have to manually
decide "resume or abandon?" every time the watcher fires
`crucible-stalled` or `crucible-orphan-handoff`.

`forge_fix_proposal` already turns LiveGuard findings (drift, incidents,
regressions, secret-scan hits) into 1–2-slice auto-plans in
`docs/plans/auto/`. Adding Crucible as a first-class source closes the loop:
the same signal that surfaces in the Dashboard Watcher row can now be
converted into a concrete **abandon-or-resume playbook** per affected smelt,
with no additional typing.

This is the natural evolution of the Crucible funnel work — from "we see it"
to "we can act on it" — and keeps all Crucible-related automation anchored
on the same `readCrucibleState` contract so one function stays the source of
truth for funnel health across watcher snapshots, the Smith panel, the
dashboard Watcher row, and fix proposals.

## Scope Contract

### In-scope

- New `source: "crucible"` branch in the `forge_fix_proposal` MCP tool
- Optional `smeltId` input arg to target a specific smelt; otherwise
  auto-selects from stale in-progress smelts first, then orphan handoffs
- Generated plan writes to `docs/plans/auto/LIVEGUARD-FIX-crucible-<id>.md`
  (reuses existing `autoDir` convention, stays dedup-safe)
- Two-slice abandon-or-resume playbook:
  1. **Triage** — read the smelt journal, decide staleness vs. active
  2. **Decide** — either resume (set next action, reactivate) or abandon
     (mark status, archive, record rationale)
- Schema updates: `tools.json`, `server.mjs` inputSchema, `capabilities.mjs`
  metadata (`consumes`, `produces`, `errors`, `example`)
- Tests pinning the new source, the smelt selection order, the
  abandon-or-resume slice structure, and the dedup behavior

### Out of scope

- No automatic abandonment or resumption — the generated plan is human-run
- No new anomaly types — Slice 03.1 rules stay authoritative
- No dashboard changes — fix-proposal surfacing is already wired via
  `fix-proposal-ready` events
- No changes to the `readCrucibleState` contract — read-only consumer

### Forbidden actions

- Do not mutate `.forge/crucible/*.json` from this tool (write-only is
  reserved for Smith / finalize flows)
- Do not delete hub-events.jsonl entries (orphan detection is append-only)
- Do not auto-execute the generated plan — fix proposals are plans, not runs

## Slices

### Slice 04.1 — Crucible source + abandon-or-resume playbook

Implement the new source end-to-end in a single slice: tool handler, schema,
capabilities metadata, tests.

**Validation gate:** `cd pforge-mcp; npm test -- --run` — all tests pass,
new assertions pin source behavior + plan structure.
