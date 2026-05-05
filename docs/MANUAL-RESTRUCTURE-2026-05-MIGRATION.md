# Manual Restructure 2026-05 — Migration Reference

> **Status**: ✅ COMPLETE — All 9 slices shipped (final sweep: Slice 9, 2026-05-04)  
> **Phase**: MANUAL-RESTRUCTURE  
> **Migration callouts**: Permanent — stub anchors remain at original URLs indefinitely (see [Decision: migration callout duration](#decisions))

This document records old-URL → new-URL mappings created by the Tier 3 manual restructure. Bookmark URLs that pointed at chapters that were split will continue to work — the source chapters stay at their original URLs with reduced content and a migration callout. Use this table to find where specific sections moved.

---

## Quick Navigation

| Split Source | New Chapters | Status |
|---|---|---|
| `dashboard.html` | `dashboard-liveguard.html`, `dashboard-forge-master.html`, `dashboard-settings.html` | ✅ Complete (Slice 4) |
| `mcp-server.html` | `mcp-server-quickstart.html`, `mcp-server-reference.html` | ✅ Complete (Slice 5) |
| `instructions-agents.html` | `instructions-agents-reference.html` | ✅ Complete (Slice 6) |
| *(new)* | `quickstart-install.html`, `quickstart-first-plan.html`, `quickstart-first-deploy.html` | ✅ Complete (Slice 2) |

---

## Anchor Migration Table

> Populated in Slice 9 (final sweep, 2026-05-04). Columns: original URL → new URL → notes.

| Original URL | New URL | Notes |
|---|---|---|
| `dashboard.html#liveguard` | `dashboard-liveguard.html#liveguard` | Permanent stub callout retained at original anchor |
| `dashboard.html#config` | `dashboard-settings.html#config` | Permanent stub callout retained at original anchor |
| `dashboard.html#studio` | `dashboard-forge-master.html#studio` | Permanent stub callout retained at original anchor |
| `dashboard.html#lg-health` | `dashboard-liveguard.html#lg-health` | No stub at original (sub-anchor); see liveguard callout |
| `dashboard.html#lg-incidents` | `dashboard-liveguard.html#lg-incidents` | No stub at original |
| `dashboard.html#lg-triage` | `dashboard-liveguard.html#lg-triage` | No stub at original |
| `dashboard.html#lg-security` | `dashboard-liveguard.html#lg-security` | No stub at original |
| `dashboard.html#lg-env` | `dashboard-liveguard.html#lg-env` | No stub at original |
| `dashboard.html#settings-*` | `dashboard-settings.html#settings-*` | All settings sub-anchors; see config callout at original |
| `dashboard.html#studio-*` | `dashboard-forge-master.html#studio-*` | All studio sub-anchors; see studio callout at original |
| `mcp-server.html#tools` | `mcp-server-reference.html#tools` | Full tool tables moved to reference page |
| `mcp-server.html#tools-core` | `mcp-server-reference.html#tools-core` | |
| `mcp-server.html#tools-liveguard` | `mcp-server-reference.html#tools-liveguard` | |
| `mcp-server.html#tools-watcher` | `mcp-server-reference.html#tools-watcher` | |
| `mcp-server.html#tools-crucible` | `mcp-server-reference.html#tools-crucible` | |
| `mcp-server.html#tools-tempering` | `mcp-server-reference.html#tools-tempering` | |
| `mcp-server.html#tools-bug-registry` | `mcp-server-reference.html#tools-bug-registry` | |
| `mcp-server.html#tools-testbed` | `mcp-server-reference.html#tools-testbed` | |
| `mcp-server.html#tools-forge-master` | `mcp-server-reference.html#tools-forge-master` | |
| `mcp-server.html#rest-api` | `mcp-server-reference.html#rest-api` | |
| `mcp-server.html#websocket` | `mcp-server-reference.html#websocket` | |
| `mcp-server.html#telemetry` | `mcp-server-reference.html#telemetry` | |
| `mcp-server.html#cost` | `mcp-server-reference.html#cost` | |
| `mcp-server.html#sdk` | `mcp-server-reference.html#sdk` | |
| `mcp-server.html#api-keys` | `mcp-server-reference.html#api-keys` | |
| `mcp-server.html#starting` | `mcp-server-quickstart.html#starting` | Start-server content in quickstart |
| `mcp-server.html#essential-tools` | `mcp-server-quickstart.html#essential-tools` | |
| `instructions-agents.html#agents` | `instructions-agents-reference.html#agents` | Agents/skills/hooks reference moved |
| `instructions-agents.html#skills` | `instructions-agents-reference.html#skills` | |
| `instructions-agents.html#hooks` | `instructions-agents-reference.html#hooks` | |

### `dashboard.html` → split targets

| Original anchor | Moved to |
|---|---|
| `#liveguard` | `dashboard-liveguard.html#liveguard` — stub callout retained at original |
| `#lg-health` | `dashboard-liveguard.html#lg-health` |
| `#lg-incidents` | `dashboard-liveguard.html#lg-incidents` |
| `#lg-triage` | `dashboard-liveguard.html#lg-triage` |
| `#lg-security` | `dashboard-liveguard.html#lg-security` |
| `#lg-env` | `dashboard-liveguard.html#lg-env` |
| `#config` | `dashboard-settings.html#config` — stub callout retained at original |
| `#settings-general` | `dashboard-settings.html#settings-general` |
| `#settings-models` | `dashboard-settings.html#settings-models` |
| `#settings-execution` | `dashboard-settings.html#settings-execution` |
| `#settings-api-keys` | `dashboard-settings.html#settings-api-keys` |
| `#settings-updates` | `dashboard-settings.html#settings-updates` |
| `#settings-memory` | `dashboard-settings.html#settings-memory` |
| `#settings-bridge` | `dashboard-settings.html#settings-bridge` |
| `#settings-crucible` | `dashboard-settings.html#settings-crucible` |
| `#settings-brain` | `dashboard-settings.html#settings-brain` |
| `#studio` | `dashboard-forge-master.html#studio` — stub callout retained at original |
| `#studio-classification` | `dashboard-forge-master.html#studio-classification` |
| `#studio-quorum` | `dashboard-forge-master.html#studio-quorum` |
| `#studio-sessions` | `dashboard-forge-master.html#studio-sessions` |
| `#studio-timeline` | `dashboard-forge-master.html#studio-timeline` |

### `mcp-server.html` → split targets

| Original anchor | Moved to |
|---|---|
| `#architecture` | Retained in `mcp-server.html` (hub page) |
| `#starting` | `mcp-server-quickstart.html#starting` |
| `#verify` | `mcp-server-quickstart.html#verify` |
| `#essential-tools` | `mcp-server-quickstart.html#essential-tools` |
| `#tool-capabilities` | `mcp-server-quickstart.html#tool-capabilities` |
| `#tool-smith` | `mcp-server-quickstart.html#tool-smith` |
| `#tool-run-plan` | `mcp-server-quickstart.html#tool-run-plan` |
| `#tool-plan-status` | `mcp-server-quickstart.html#tool-plan-status` |
| `#tool-abort` | `mcp-server-quickstart.html#tool-abort` |
| `#tool-diagnose` | `mcp-server-quickstart.html#tool-diagnose` |
| `#tool-analyze` | `mcp-server-quickstart.html#tool-analyze` |
| `#tool-estimate` | `mcp-server-quickstart.html#tool-estimate` |
| `#workflow` | `mcp-server-quickstart.html#workflow` |
| `#tools` | `mcp-server-reference.html#tools` |
| `#tools-core` | `mcp-server-reference.html#tools-core` |
| `#tools-liveguard` | `mcp-server-reference.html#tools-liveguard` |
| `#tools-watcher` | `mcp-server-reference.html#tools-watcher` |
| `#tools-crucible` | `mcp-server-reference.html#tools-crucible` |
| `#tools-tempering` | `mcp-server-reference.html#tools-tempering` |
| `#tools-bug-registry` | `mcp-server-reference.html#tools-bug-registry` |
| `#tools-testbed` | `mcp-server-reference.html#tools-testbed` |
| `#tools-forge-master` | `mcp-server-reference.html#tools-forge-master` |
| `#rest-api` | `mcp-server-reference.html#rest-api` |
| `#websocket` | `mcp-server-reference.html#websocket` |
| `#telemetry` | `mcp-server-reference.html#telemetry` |
| `#cost` | `mcp-server-reference.html#cost` |
| `#sdk` | `mcp-server-reference.html#sdk` |
| `#api-keys` | `mcp-server-reference.html#api-keys` |

### `instructions-agents.html` → split targets

| Original anchor | Moved to |
|---|---|
| `#overview` | Retained in `instructions-agents.html` (tutorial page) |
| `#scenario` | Retained in `instructions-agents.html` |
| `#shared` | Retained in `instructions-agents.html` |
| `#domain` | Retained in `instructions-agents.html` |
| `#agents` | `instructions-agents-reference.html#agents` |
| `#agents-stack` | `instructions-agents-reference.html#agents-stack` |
| `#agents-cross-stack` | `instructions-agents-reference.html#agents-cross-stack` |
| `#agents-pipeline` | `instructions-agents-reference.html#agents-pipeline` |
| `#skills` | `instructions-agents-reference.html#skills` |
| `#hooks` | `instructions-agents-reference.html#hooks` |

---

## External Links Updated

> Populated in Slice 8. Files whose cross-links were updated.

| File | Old link | New link |
|---|---|---|
| `index.html` | *(new chapters added to nav)* | `quickstart-install.html`, `quickstart-first-plan.html`, `quickstart-first-deploy.html`, `mcp-server-quickstart.html`, `mcp-server-reference.html`, `instructions-agents-reference.html`, `dashboard-liveguard.html`, `dashboard-forge-master.html`, `dashboard-settings.html` |
| `sidebar-nav.js` (or equivalent nav data) | Flat list of chapters | Updated with Quickstart section + split chapter entries |

---

## Slice 9 Decisions {#decisions}

> Recorded 2026-05-04 during the final sweep.

### Decision: Quickstart vs Act 0 naming

**Chosen: "Quickstart"** — not "Act 0".

The Acts convention (I — Smelt, II — Forge, III — Guard, IV — Learn) was preserved as-is. The new entry-point section is labeled **"Quickstart · Zero to shipped in 30 minutes"** in the nav and uses file names `quickstart-install.html`, `quickstart-first-plan.html`, `quickstart-first-deploy.html`. No "Act 0" numbering is used anywhere in the implementation.

*Rationale*: "Act 0" requires the reader to already understand the Acts numbering. "Quickstart" is self-describing and matches the reader's mental model when opening docs for the first time. The Acts remain a meaningful learning arc for readers who continue past the Quickstart.

---

### Decision: Reference chapter hero strategy — New (not Inherit)

**Chosen: New standalone hero for each split chapter.**

Each split-off chapter (`dashboard-liveguard.html`, `dashboard-settings.html`, `dashboard-forge-master.html`, `mcp-server-quickstart.html`, `mcp-server-reference.html`, `instructions-agents-reference.html`) received its own standalone hero introduction rather than inheriting the source chapter's opening paragraphs.

Source chapters became either:
- **Navigation hubs** (`mcp-server.html`): architecture overview + chapter navigation cards pointing to quickstart and reference sub-pages.
- **Reduced content with permanent stub callouts** (`dashboard.html`): retained core tabs; moved sections replaced by inline `callout-info` divs at their original anchor IDs, each linking to the new chapter.

*Rationale*: Inherited heroes would repeat context that no longer matched the narrower scope of each sub-chapter. A new hero keeps each chapter self-contained — a reader linking directly to `dashboard-liveguard.html` gets full context without needing to have read `dashboard.html` first.

---

### Decision: Migration callout duration — Permanent

**Chosen: Permanent stub anchors.** The original "Expires: 30 days" header language is superseded.

Stub callouts at `dashboard.html#liveguard`, `dashboard.html#config`, and `dashboard.html#studio` are permanent `callout-info` divs that will remain at their original anchor IDs indefinitely. They contain a one-line description and a direct link to the new chapter.

*Rationale*: Documentation bookmarks have no expiry. A reader who saved `dashboard.html#liveguard` six months ago should still land on a useful page. 30-day expiry would create 404-equivalent experiences for external links, blog posts, and archived Slack messages. Permanent stubs have near-zero maintenance cost.

*Note*: Sub-anchors that moved (e.g. `dashboard.html#lg-health`) do **not** have stubs — the browser will scroll to the top of `dashboard.html` for those, where the LiveGuard callout is visible. This is acceptable: the callout points to `dashboard-liveguard.html` and the reader can locate `#lg-health` from there.

---

### Decision: No `<meta>` refresh redirects on split-source chapter anchors

**Chosen: NO redirect.** Original anchors remain functional via permanent section retention (stubs).

Adding `<meta http-equiv="refresh" content="0; url=dashboard-liveguard.html#lg-health">` would interrupt the reading experience mid-chapter for readers who navigate from the top. It would also cause accessibility issues for readers on slow connections who might see a flash of the redirect page.

The better tradeoff: keep the stub callout at `#liveguard` / `#config` / `#studio` as the permanent navigation aid for moved sections. Readers with deep sub-anchor bookmarks (e.g. `#lg-health`) see the top of `dashboard.html` and can follow the LiveGuard callout — a minor inconvenience that avoids a worse automated-redirect experience for all other readers.

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
