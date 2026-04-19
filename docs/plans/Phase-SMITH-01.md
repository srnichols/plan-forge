---
crucibleId: ea5e6db2-95c8-40c2-b04d-ee4c0685e4b2
lane: tweak
source: selfhost
status: absorbed
absorbedBy: docs/plans/Phase-CRUCIBLE-02.md
absorbedIn: v2.39.1
---

# Phase SMITH-01: Crucible Diagnostics in `forge_smith` — **ABSORBED**

> **Status**: ✅ ABSORBED — no standalone PR.
> **Shipped as**: [Phase-CRUCIBLE-02.md](Phase-CRUCIBLE-02.md) Slice 02.2
> **Released**: v2.39.1 (PR #46)
> **Draft date**: pre-CRUCIBLE-02

---

## Why this file still exists

This phase was drafted before CRUCIBLE-02 absorbed its scope. The draft
is retained as a tombstone so:

- The `crucibleId` stays reachable for any audit trail that referenced it
- Future agents reading the phase history don't mistake "no file" for
  "forgotten work"
- The scope notes below stay discoverable for anyone extending the Smith
  panel further

## Scope that actually shipped (in CRUCIBLE-02 Slice 02.2)

All three diagnostic fields originally proposed here landed in the
Smith panel:

- `smeltsInProgress` → funnel counts + stall detection
- `lastManualImport` → surfaced via audit-log tail
- `phasesMissingCrucibleId` → enforcement check in `pforge smith`

See [Phase-CRUCIBLE-02.md](Phase-CRUCIBLE-02.md) Slice 02.2 for the
hardened spec and [CHANGELOG.md](../../CHANGELOG.md) v2.39.1 for the
shipped implementation.

## Follow-on work built on top

- **v2.40.0** — Phase CRUCIBLE-03: watcher-side awareness of the same signals
- **v2.40.1** — Dashboard Watcher tab Crucible row (same contract)
- **v2.41.0** — Phase CRUCIBLE-04: `forge_fix_proposal` `source=crucible`
  generates abandon-or-resume playbooks from the same signals

## Do not re-open

If additional Smith-panel diagnostics are needed, create a new phase
(e.g. `Phase-SMITH-02.md`) with a fresh `crucibleId`. This file is a
historical record only.

---

## Original draft scope (historical)

The original draft proposed surfacing Crucible health in `pforge smith`:
`smeltsInProgress`, `lastManualImport`, `phasesMissingCrucibleId`. All
three items were built and shipped as part of CRUCIBLE-02 Slice 02.2 —
see that phase document for the authoritative contract.
