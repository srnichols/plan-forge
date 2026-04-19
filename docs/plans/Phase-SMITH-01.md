---
crucibleId: ea5e6db2-95c8-40c2-b04d-ee4c0685e4b2
lane: tweak
source: selfhost
---

# Phase SMITH-01: Crucible Diagnostics in forge_smith

> **Status**: 🟡 DRAFT (likely absorbed into CRUCIBLE-02 Slice 02.2)
> **Estimated Effort**: 1 execution slice
> **Risk Level**: Low
> **Target Version**: v2.38.x

---

## Overview

Surface Crucible health signals in `pforge smith` / `forge_smith` so
operators can see at a glance: are smelts stuck in progress? When was
the last manual-import bypass? Are any phase plans still missing
`crucibleId`?

This phase overlaps with CRUCIBLE-02 Slice 02.2. If CRUCIBLE-02 ships
first with the Smith panel included, this phase can be marked as
absorbed and closed without a dedicated PR.

## Scope Contract

### In-Scope

- New diagnostic panel in `forge_smith`:
  - `smeltsInProgress`: count + list of `{id, lane, ageMinutes}`
  - `lastManualImport`: `{timestamp, planPath, source, reason}` from audit log
  - `phasesMissingCrucibleId`: array of `docs/plans/Phase-*.md` paths without the frontmatter field

### Out-of-Scope

- Any change to enforcement behavior — smith is read-only, reports only
- Any new persistent storage

### Forbidden Actions

- Don't emit warnings in a way that breaks `smith`'s existing exit-code contract
- Don't scan outside `docs/plans/` or `.forge/crucible/`

## Success Criteria

- `pforge smith` output contains a `Crucible` section when any smelts exist or any audit rows exist
- Graceful no-op when the project has no Crucible data yet
- Unit tests for each of the three reported fields
