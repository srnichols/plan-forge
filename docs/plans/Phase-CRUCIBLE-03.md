---
crucibleId: 1127133b-58ae-4a2a-af9c-6ef6e56caba7
source: self-hosted
status: complete
phase: CRUCIBLE-03
---

# Phase CRUCIBLE-03: Crucible-aware watcher

> **Status**: ✅ COMPLETE — shipped via PR #47 (Slice 03.1 `1497404`) + PR #48 (Slice 03.2 `cee6017`)

## Why

`forge_watch` (snapshot / polling mode) currently ignores `.forge/crucible/`
entirely. Stalled smelts, abandoned-but-never-closed funnels, and orphaned
handoff events are invisible to it. `forge_watch_live` forwards every
`crucible-*` hub event — but the snapshot watcher is the one operators point
at already-running projects to get a one-shot health read, so it is the gap
that matters.

Slice 02.2 added this visibility inside `pforge smith`. This phase brings the
same awareness into the watcher subsystem so dashboards, automation, and
`pforge watch` runs flag the same signals.

## Scope

In scope:
- Extend `buildWatchSnapshot` with a `crucible` block (counts + oldest
  in-progress mtime + list of recent finalized smelt ids)
- Two new anomaly rules:
  - `CRUCIBLE_STALLED` — `in_progress` smelt idle ≥ 7 days
  - `CRUCIBLE_ORPHAN_HANDOFF` — `crucible-handoff-to-hardener` hub event
    with a `crucibleId` that never landed in a `docs/plans/*.md` frontmatter
- Surface the new block on `runWatch` reports (so the dashboard Watcher tab
  and `pforge watch` CLI both see it)
- Tests covering both rules + report shape

Out of scope:
- Any change to `forge_watch_live` (already forwards everything)
- Dashboard Watcher tab UI changes — it already handles unknown anomaly
  codes generically
- Auto-abandoning stalled smelts

## Slices

**Slice 03.1 — Watcher snapshot + anomaly rules**
- Read `.forge/crucible/` during `buildWatchSnapshot`
- Compute counts, oldest in-progress mtime, stale-count at 7-day cutoff
- Add `CRUCIBLE_STALLED` and `CRUCIBLE_ORPHAN_HANDOFF` to
  `detectWatchAnomalies`
- Threshold is the same 7 days as Smith Slice 02.2 — single source of truth
  lives on [`CRUCIBLE_STALL_CUTOFF_DAYS`](pforge-mcp/orchestrator.mjs)
- Tests: snapshot shape, stall detection, orphan detection, no-crucible
  graceful skip

## Success Criteria

- `forge_watch { targetPath }` on a project with a stalled smelt returns
  a `CRUCIBLE_STALLED` anomaly in `report.anomalies[]`
- `buildWatchSnapshot(...).crucible` is always defined (never undefined,
  even when `.forge/crucible/` is missing)
- 0 TODO/FIXME in touched files
- Full test suite continues to pass
