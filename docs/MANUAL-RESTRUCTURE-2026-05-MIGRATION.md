# Manual Restructure 2026-05 — Migration Reference

> **Status**: In progress (Slice 1 of 9 complete)  
> **Phase**: MANUAL-RESTRUCTURE  
> **Expires**: 30 days after final slice ships (see each chapter's migration callout)

This document records old-URL → new-URL mappings created by the Tier 3 manual restructure. Bookmark URLs that pointed at chapters that were split will continue to work — the source chapters stay at their original URLs with reduced content and a migration callout. Use this table to find where specific sections moved.

---

## Quick Navigation

| Split Source | New Chapters | Status |
|---|---|---|
| `dashboard.html` | `dashboard-liveguard.html`, `dashboard-forge-master.html`, `dashboard-settings.html` | ⏳ Pending (Slice 4) |
| `mcp-server.html` | `mcp-server-quickstart.html`, `mcp-server-reference.html` | ⏳ Pending (Slice 5) |
| `instructions-agents.html` | `instructions-agents-reference.html` | ⏳ Pending (Slice 6) |
| *(new)* | `quickstart-install.html`, `quickstart-first-plan.html`, `quickstart-first-deploy.html` | ⏳ Pending (Slice 2) |

---

## Anchor Migration Table

> Populated in Slice 9 (final sweep). Columns: original URL → new URL → notes.

| Original URL | New URL | Notes |
|---|---|---|
| *(to be filled in Slice 9)* | | |

### `dashboard.html` → split targets

| Original anchor | Moved to |
|---|---|
| *(to be filled in Slice 4)* | |

### `mcp-server.html` → split targets

| Original anchor | Moved to |
|---|---|
| *(to be filled in Slice 5)* | |

### `instructions-agents.html` → split targets

| Original anchor | Moved to |
|---|---|
| *(to be filled in Slice 6)* | |

---

## External Links Updated

> Populated in Slice 8. Files whose cross-links were updated.

| File | Old link | New link |
|---|---|---|
| *(to be filled in Slice 8)* | | |

---

## Rollback Instructions

All changes are documentation-only. To rollback:

```bash
# Full rollback
git revert <merge-commit>

# Partial rollback (single slice)
git revert <slice-commit-sha>
```

Original source chapters (`dashboard.html`, `mcp-server.html`, `instructions-agents.html`) remain at their original URLs throughout — no 404s are introduced at any point during the migration.
