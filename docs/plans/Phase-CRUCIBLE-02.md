---
crucibleId: eeaf8e42-4251-421f-9a14-3d0f0427b423
lane: feature
source: selfhost
---

# Phase CRUCIBLE-02: Operability Polish — Slice Badges + Smith Panel

> **Status**: 🟡 DRAFT
> **Estimated Effort**: 1–2 execution slices
> **Risk Level**: Low (purely additive; no API breaking changes)
> **Target Version**: v2.38.x (after UPDATE-01 ships)

---

## Overview

Small, visible quality-of-life upgrades that surface information the
orchestrator already computes but the UI doesn't yet show. None of these
are architectural — they're polish that answers the "what am I spending?
/ how hard was this slice?" questions at a glance.

## Scope Contract

### In-Scope

1. **Complexity Score badge on slice cards** (Progress tab)
   - Renders a small pill (e.g. `⚙ 7/10`) next to the existing status icon
   - Pulls from `state.slices[].complexityScore`; renders `—` when absent
   - Color-graded: green (1–3), amber (4–6), red (7–10)

2. **Total-Spend badge on slice cards** (Progress tab)
   - Renders dollar amount (e.g. `$0.42`) next to the complexity badge
   - Pulls from `state.slices[].cost` (already tracked by orchestrator)
   - Shows running total per slice; aggregates quorum-leg costs

3. **Hub payload extension**
   - `slice-start` / `slice-end` events carry `complexityScore` and `cost`
   - Dashboard event handler propagates into `state.slices[]`

4. **Smith panel for Crucible** (`forge_smith` diagnostic)
   - New section reporting: # smelts in-progress, last manual-import timestamp,
     any `docs/plans/Phase-*.md` still missing `crucibleId:`

5. **Setup-script Crucible banner**
   - `setup.ps1` and `setup.sh` post-install banner line:
     `Crucible enabled — see docs/manual/crucible.html`

### Out-of-Scope

- Any change to how complexity is scored (pre-existing logic stays as-is)
- Any change to cost tracking semantics
- Smith refactors beyond adding the Crucible panel

### Forbidden Actions

- Don't alter `scoreSliceComplexity` or its signals
- Don't change cost aggregation — only display it

## Slices

**Slice 02.1 — Hub payload + slice-card badges**
- Extend `slice-start`/`slice-end` hub events with `complexityScore` and `cost`
- Update dashboard state to hydrate both fields from the hub
- Render two new pills in `renderSliceCards()`
- Tests: hub event shape, card render with/without scores

**Slice 02.2 — Smith panel + setup banner**
- Add Crucible section to `forge_smith` output
- Add one-line banner to `setup.ps1` / `setup.sh`
- Tests: smith output shape; banner grep in setup scripts

## Success Criteria

- Progress-tab screenshot shows complexity + spend on every executing/completed slice
- `pforge smith` output includes `Crucible:` section with counts
- 0 TODO/FIXME in touched files
- All existing tests continue to pass
