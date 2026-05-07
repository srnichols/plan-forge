# Phase-DOCS-UX-LIFT: Adopt BCDR-Digital-Twin UX patterns for the docs site

> **Status**: Draft (not yet hardened)
> **Tracks**: Docs only (`docs/manual/**`, `docs/walkthroughs/**`, `docs/demos/**`, `docs/assets/**`, `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` and any siblings, `docs/index.html` & landing nav)
> **Estimated cost**: TBD at hardening (docs-only, no `pforge-mcp/` or `pforge-master/` code)
> **Pipeline**: Specify ✅ → Pre-flight ⏳ → Harden ⏳ → Execute → Sweep → Review → Ship
> **Source**: Manual review of `E:\GitHub\BCDR-Digital-Twin` (sibling repo) on 2026-05-07. BCDR ships three reusable UX patterns — a book-style manual, a scroll-snap briefing deck, and an architecture hub — plus a shared theme/style layer. Plan Forge's docs surfaces (`docs/manual/`, `docs/walkthroughs/`, `docs/demos/`, the architecture pages) are flat by comparison and would benefit from the same spine without any change to the live ops dashboard.
> **Explicit non-goal**: The `pforge-mcp/dashboard/` ops console is **not** in scope. It is a real-time operator surface and the BCDR narrative pattern would actively hurt it. See "Out of Scope" below.

---

## Why

BCDR-Digital-Twin uses three patterns that map cleanly to Plan Forge surfaces we already have but which currently render flat:

| BCDR pattern | What it is | Plan Forge surface that needs it |
|---|---|---|
| **The Forge Manual** (`the-forge-manual/index.html`) | Roman-numeral parts, chapter list with `Draft / Planned / Stable` status pills, sticky TOC sidebar, prev/next chapter footer | `docs/manual/index.html` — appendices and chapters are listed but with no spine, no status, no progress indicator |
| **Briefing Deck** (`briefing-deck.html`) | Full-viewport scroll-snap slides, dot nav, arrow-key navigation, slide number badges | `docs/walkthroughs/`, `docs/demos/`, `docs/QUICKSTART-WALKTHROUGH.md` — currently long-scroll markdown/HTML pages, hard to use as a guided demo |
| **Architecture Center hub** (`architecture-center/index.html`) | Single hub with cards per diagram + dropdown nav linking related architecture pages | `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` and the various `docs/MEMORY-ARCHITECTURE.md`-style pages — reachable only via random links, no central index |
| **Shared theme layer** (`shared-styles.css` + `shared-theme.js`) | One stylesheet + one theme toggle script consumed by every page | The docs site (blog, capabilities, dashboard landing) each redefine their own tokens; drift is starting to show |

We do **not** copy the password overlay, the BCDR color palette, or the per-page hero gradient orbs.

---

## Scope Contract

### In Scope

- **Forge Manual book shell** at `docs/manual/index.html`:
  - Add Roman-numeral "Parts" grouping over the existing chapter/appendix list
  - Add per-entry status pill (`Draft` / `Planned` / `Stable` / `Deprecated`) sourced from a single registry in `docs/manual/assets/manual.js`
  - Add a meta-bar above the TOC: total parts, total chapters, edition number (read from `VERSION` or a constant in `manual.js`)
  - Add prev/next chapter footer to every chapter page (the placeholder `<div id="chapter-prev-next"></div>` already exists per Phase-ENTERPRISE-DOCS-HTML — populate it from `manual.js`)
- **Briefing-deck format** as a reusable template:
  - New file `docs/assets/briefing-deck.css` containing the scroll-snap, slide-number, and dot-nav rules from `briefing-deck.html`
  - New file `docs/assets/briefing-deck.js` containing dot click → scroll, arrow-key → next/prev slide, current-slide tracker
  - Convert `docs/QUICKSTART-WALKTHROUGH.md` → `docs/walkthroughs/quickstart-deck.html` using the new template (one slide per current section)
  - Convert one existing demo under `docs/demos/` (TBD at hardening — pick the one most representative) to the deck format as a reference implementation
- **Architecture hub** at `docs/architecture/index.html` (new):
  - One landing card per existing architecture page: `UNIFIED-SYSTEM-ARCHITECTURE.md`, `MEMORY-ARCHITECTURE.md`, plus any `docs/manual/*architecture*.html` appendices
  - Top-nav dropdown registered in the shared header (`docs/_includes/` if it exists, else inline in landing pages) that mirrors BCDR's "Architecture ▾" submenu
- **Shared theme layer** under `docs/assets/`:
  - Promote any existing `shared.css` / `manual.css` token blocks into `docs/assets/shared-styles.css`
  - Promote the dashboard's light/dark `html.light` token swap into `docs/assets/shared-theme.js`
  - Make the manual, blog, capabilities, and architecture-hub pages all consume the shared files (one `<link>` + one `<script>`)

### Out of Scope

- **`pforge-mcp/dashboard/index.html`** and any file under `pforge-mcp/dashboard/`. The ops console is intentionally excluded:
  - It is a single-page app with live data, not a narrative
  - Its group-tabs → sub-tabs structure already maps to the four mental models (Forge / LiveGuard / Forge-Master / Settings)
  - Hero blur-orbs and per-page gradients would eat scroll budget that operators need for tables, logs, and charts
  - Dashboard tokens stay in `pforge-mcp/dashboard/index.html`'s `:root` block; no shared-styles consolidation across that boundary
- The Plan Forge color identity (blue / amber / cyan / purple per subsystem). Do not adopt BCDR's azure-blue + cohesity-red palette.
- Password overlays of any kind (`#passwordOverlay`, `content-protected`, `checkPassword()`). Plan Forge docs are open source.
- Per-page hero blur-orbs and gradient backdrops (`absolute … rounded-full bg-azure-500/10 blur-[120px]`). Acceptable on the marketing landing page only; forbidden in the manual, walkthroughs, and architecture hub.
- Any change to `pforge-mcp/`, `pforge-master/`, root scripts, `setup.ps1`/`setup.sh`, or `templates/`.
- A site-wide CSS framework swap. Continue using Tailwind CDN per existing manual convention.
- Build/deploy of planforge.software (Jekyll build remains a separate manual step).

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 fix; protected across all phases).
- **Do NOT touch** any file under `pforge-mcp/dashboard/`. Explicit boundary.
- **Do NOT touch** any file under `pforge-mcp/` or `pforge-master/`. Docs-only phase.
- **Do NOT delete** existing chapter HTML files. Status pills are additive metadata only.
- **Do NOT introduce** a new top-level CSS framework. Tailwind CDN + a single `shared-styles.css` token sheet only.
- **Do NOT add** password overlays, gated content, or `content-protected` wrappers.
- **Do NOT change** the Plan Forge brand palette. Blue / amber / cyan / purple stays.
- **Do NOT reorder** existing CHAPTERS entries in `manual.js` — only insert grouping metadata and status fields.
- **Do NOT restructure** the dashboard's group-tab → sub-tab navigation. Out of scope.

---

## Required Decisions

To be resolved during hardening (Step 2). Listed here so the hardener can lock them.

| # | Decision | Default proposal |
|---|---|---|
| 1 | Status-pill vocabulary | `Draft` / `Planned` / `Stable` / `Deprecated`. Mirror BCDR exactly. |
| 2 | Where status lives (per-chapter HTML metadata vs central registry) | **Central registry** in `docs/manual/assets/manual.js` — single source of truth, no per-file edits when status changes. |
| 3 | Roman-numeral "Parts" mapping for the existing chapter list | TBD at hardening. Read current `CHAPTERS` array in `manual.js` and propose a 4–6 part split. |
| 4 | Which `docs/demos/` page becomes the briefing-deck reference implementation | TBD at hardening. Pick the shortest narrative-style demo so the conversion is mechanical. |
| 5 | Architecture-hub URL: `docs/architecture/index.html` vs `docs/architecture-center/index.html` | **`docs/architecture/`** — shorter path, matches the singular noun used in our existing nav. |
| 6 | Shared-theme dark/light default | **Dark default** with light toggle, matching the dashboard. Persist to `localStorage` under key `pforge-theme`. |
| 7 | Whether to ship a top-nav include or inline the nav per page | TBD at hardening based on how many landing pages exist. If ≥ 4, ship `docs/_includes/site-nav.html`; if fewer, inline. |
| 8 | Briefing-deck keyboard handling on mobile (no keyboard) | Touch swipe handlers in `briefing-deck.js`. Dot nav is primary on mobile. |

---

## Acceptance Criteria

### Forge Manual book shell

- **MUST**: `docs/manual/index.html` shows Roman-numeral parts (I, II, III…) above the chapter list
- **MUST**: Every chapter and appendix entry on the manual index renders a status pill
- **MUST**: Status registry lives in `docs/manual/assets/manual.js` as a `STATUS` map keyed by chapter slug; missing keys default to `Stable`
- **MUST**: Meta-bar above the TOC shows part count, chapter count, edition (sourced from a single constant)
- **MUST**: Prev/next chapter footer populates on every chapter page using the existing `<div id="chapter-prev-next"></div>` placeholder
- **MUST NOT**: Any chapter HTML file is reordered or renamed
- **MUST NOT**: A new CSS file is added (use Tailwind utilities + existing `manual.css`)

### Briefing-deck template

- **MUST**: `docs/assets/briefing-deck.css` exists and contains scroll-snap, slide-number badge, and dot-nav rules
- **MUST**: `docs/assets/briefing-deck.js` exists and handles dot click, ←/→/↑/↓ arrow keys, current-slide tracking
- **MUST**: `docs/walkthroughs/quickstart-deck.html` exists, consumes the new template, and renders ≥ 5 slides corresponding to QUICKSTART sections
- **MUST**: One file under `docs/demos/` (slug picked at hardening) is converted to the deck format
- **MUST NOT**: `docs/QUICKSTART-WALKTHROUGH.md` is deleted (the deck is additive; the markdown stays for `llms.txt` and search)
- **MUST NOT**: Any password overlay, hero blur-orb, or BCDR-palette color appears in either deck

### Architecture hub

- **MUST**: `docs/architecture/index.html` exists with one card per existing architecture page
- **MUST**: Each card links to its target page and shows a one-sentence description sourced from the target's first H1 + lede
- **MUST**: An "Architecture ▾" entry is added to landing-page navs that already have a top nav
- **MUST NOT**: Any architecture page itself is moved or renamed (links stay valid)

### Shared theme layer

- **MUST**: `docs/assets/shared-styles.css` exists and is consumed by the manual index, blog index, capabilities page, and architecture hub
- **MUST**: `docs/assets/shared-theme.js` exists, exposes a `toggleTheme()` global, and persists choice to `localStorage`
- **MUST**: Dark/light toggle works on every page that includes the shared script
- **MUST NOT**: `pforge-mcp/dashboard/index.html` is touched or made to consume the shared layer

### Universal

- **MUST NOT**: Any file under `pforge-mcp/` or `pforge-master/` is touched in any slice
- **MUST NOT**: `costForLeg()` is touched
- **MUST**: Each slice ships an HTML/CSS/JS-only diff (no `.mjs`, no `.json` outside `package.json`-free docs assets)

---

## Slice Breakdown (proposed — refine at hardening)

12–14 slices, all docs-only. Initial split:

1. Add `STATUS` registry + status pills to `manual.js` and render on `docs/manual/index.html`
2. Add Roman-numeral parts grouping to `docs/manual/index.html`
3. Add meta-bar (parts / chapters / edition) above the TOC
4. Wire prev/next chapter footer from `manual.js` into all chapter HTML files
5. Create `docs/assets/briefing-deck.css`
6. Create `docs/assets/briefing-deck.js`
7. Convert `docs/QUICKSTART-WALKTHROUGH.md` → `docs/walkthroughs/quickstart-deck.html`
8. Convert one `docs/demos/` page to deck format (slug TBD at hardening)
9. Create `docs/architecture/index.html` hub with cards per existing page
10. Add "Architecture ▾" dropdown to landing-page navs
11. Create `docs/assets/shared-styles.css` from existing token blocks
12. Create `docs/assets/shared-theme.js` with light/dark toggle + persistence
13. Wire shared layer into manual index, blog index, capabilities, architecture hub
14. Sweep: link-check, link-rot scan, visual diff against BCDR reference where applicable

Each slice gets its own validation gate at hardening (Step 2). All gates are `grep -q` style or simple file-existence checks per `plan-gate-command-rules.md`.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Status pills become stale and lie about chapter readiness | Single registry in `manual.js`; sweep slice greps each chapter file for "TODO" / "FIXME" / "Planned" markers and cross-checks against registered status |
| Briefing deck breaks on Safari (scroll-snap quirks) | Test against Safari Tech Preview during execution; fall back to `scroll-snap-stop: always` only if needed |
| Shared theme layer drifts from dashboard tokens | Out of scope by design — dashboard keeps its own tokens. Document the boundary in `docs/assets/shared-styles.css` header comment. |
| Architecture hub becomes another flat list | Each card MUST include a one-sentence summary, not just a title; reviewer-gate enforces |
| Adding parts grouping reorders the existing chapter list visually and confuses bookmark holders | Anchor links stay valid (chapters are not renamed); only grouping containers change |

---

## What we explicitly chose NOT to copy from BCDR

Documented here so future readers don't re-litigate:

- **Password overlays** — Plan Forge docs are open source.
- **BCDR color palette** (azure-blue + cohesity-red + midnight) — Plan Forge has a consistent forge identity (blue / amber / cyan / purple per subsystem).
- **Per-page hero blur-orbs** — fine on a marketing site, exhausting on docs.
- **Multi-page narrative shell for the dashboard** — the dashboard is an ops console, not a story. Its group-tabs → sub-tabs already work.
- **Sticky brand bar with confidential ribbon** — not applicable.

---

## Hand-off to Hardener

Step 2 should:

1. Read the current `CHAPTERS` array in `docs/manual/assets/manual.js` and propose Decision #3 (Parts mapping)
2. Read `docs/demos/` and pick Decision #4 (which demo to convert)
3. Count existing landing pages with top-nav and resolve Decision #7
4. Lock all 8 decisions in the table above
5. Write per-slice validation gates following `.github/instructions/plan-gate-command-rules.md` (no brace-group `read`, no Windows-cmd-shim hostility)
6. Estimate cost across `auto` / `power` / `speed` quorum modes via `forge_estimate_quorum`
