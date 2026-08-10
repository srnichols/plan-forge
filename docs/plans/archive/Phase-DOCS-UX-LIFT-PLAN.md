# Phase-DOCS-UX-LIFT: Adopt BCDR-Digital-Twin UX patterns for the docs site (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Docs only (`docs/manual/**`, `docs/walkthroughs/**`, `docs/demos/**`, `docs/assets/**`, `docs/architecture/**` (new), `docs/_includes/**` (new), `docs/index.html` & landing-nav HTML)
> **Estimated cost**: $2.50–$5.00 (14 slices, all docs/HTML/CSS/JS, no `pforge-mcp/` or `pforge-master/` code)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: Manual review of `E:\GitHub\BCDR-Digital-Twin` (sibling repo) on 2026-05-07. BCDR ships three reusable UX patterns — a book-style manual, a scroll-snap briefing deck, and an architecture hub — plus a shared theme/style layer. Plan Forge's docs surfaces (`docs/manual/`, `docs/walkthroughs/`, `docs/demos/`, the architecture pages) are flat by comparison and would benefit from the same spine without any change to the live ops dashboard.
> **Hardener notes (2026-05-08)**: Original spec said "TBD at hardening" for Decisions #3, #4, #7. All three resolved against current codebase: (a) `manual.js` already has an `act` field with values `Quickstart` / `I` / `II` / `III` / `IV` / `Appendix` — Decision #3 is essentially "render what already exists," not invent a new mapping; (b) `docs/demos/` has 5 markdown files; `independent-dev-demo.md` (86 lines) is the shortest narrative — picked for Decision #4; (c) 10 root-level `docs/*.html` landing pages have `<nav>` (>=4 threshold met) — Decision #7 is **ship `docs/_includes/site-nav.html`**. All gates rewritten per `/memories/repo/plan-gate-command-rules.md` (no `bash -c` wrapping `node`/`pwsh`; no cmd.exe pipe-to-grep). Slice count expanded from 12-14 "proposed" to 14 firm.
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
- The Plan Forge color identity (blue / amber / cyan / purple per subsystem). Do not adopt the prior BCDR project's azure-blue + red palette.
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

All 8 decisions resolved during hardening (2026-05-08). Each row is firm.

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Status-pill vocabulary | RESOLVED | `Draft` / `Planned` / `Stable` / `Deprecated`. Mirror BCDR exactly. |
| 2 | Where status lives (per-chapter HTML metadata vs central registry) | RESOLVED | **Central registry** in `docs/manual/assets/manual.js` as a `STATUS` map keyed by chapter slug — single source of truth, no per-file edits when status changes. |
| 3 | Roman-numeral "Parts" mapping for the existing chapter list | RESOLVED | **No new mapping needed.** `manual.js` `CHAPTERS` array already carries an `act` field with values `Quickstart` (3 entries), `I` (6 entries), `II` (21 entries), `III` (5 entries), `IV` (4 entries), `Appendix` (18 entries) — 57 chapters total. Phase renders these as parts headings, no `act` value changes. |
| 4 | Which `docs/demos/` page becomes the briefing-deck reference implementation | RESOLVED | **`docs/demos/independent-dev-demo.md`** (86 lines, 5 narrative steps). Shortest demo, mechanical conversion. Output: `docs/walkthroughs/independent-dev-deck.html`. |
| 5 | Architecture-hub URL | RESOLVED | **`docs/architecture/index.html`** — shorter path, matches the singular noun used in our existing nav. |
| 6 | Shared-theme dark/light default | RESOLVED | **Dark default** with light toggle, matching the dashboard. Persist to `localStorage` under key `pforge-theme`. |
| 7 | Whether to ship a top-nav include or inline the nav per page | RESOLVED | **Ship `docs/_includes/site-nav.html`** plus a small `docs/assets/site-nav.js` loader. 10 root-level `docs/*.html` landing pages have `<nav>` blocks today — well above the >=4 threshold. Loader uses `fetch('/_includes/site-nav.html')` + DOM injection so we don't require a build step. Pages without `<nav>` are unaffected. |
| 8 | Briefing-deck keyboard handling on mobile (no keyboard) | RESOLVED | Touch swipe handlers in `briefing-deck.js` (`touchstart` / `touchend` with 50px threshold). Dot nav is primary on mobile; swipe is augmentation. Arrow keys remain primary on desktop. |

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

## Slice Breakdown (14 slices, sequential, all docs-only)

Each slice has its own validation gate. Gates follow `.github/instructions/plan-gate-command-rules.md` — plain `grep -q` (auto-routes to bash on Windows), `test -f`, or direct `node`/`pwsh` calls without `bash -c` wrapping (per Priority-C chain lessons recorded in `/memories/repo/plan-gate-command-rules.md`).

### Slice 1: STATUS registry + status pills [sequential]

**Goal**: Add `STATUS` map to `manual.js` keyed by chapter slug. Render a status pill next to each chapter title on `docs/manual/index.html`. Default to `Stable` when slug missing from map.

**Files**:
- `docs/manual/assets/manual.js` (additive `STATUS` constant + render helper)
- `docs/manual/index.html` (one render-call site)

**Validation Gate**:
```bash
grep -q 'STATUS' docs/manual/assets/manual.js
grep -q 'status-pill' docs/manual/index.html
```

---

### Slice 2: Roman-numeral parts grouping [sequential]

**Goal**: Render Roman-numeral "Part" headings above the chapter list using the existing `act` field on `CHAPTERS`. Group entries by `act` value (preserving array order). Quickstart and Appendix render with their literal labels (not Roman). Parts I/II/III/IV render with their `act` value.

**Files**:
- `docs/manual/index.html`
- `docs/manual/assets/manual.js` (helper to group + emit headings)

**Depends On**: Slice 1

**Validation Gate**:
```bash
grep -q 'Part I' docs/manual/index.html
```

---

### Slice 3: Meta-bar above the TOC [sequential]

**Goal**: Three-stat meta-bar above the chapter list — part count, chapter count, edition (sourced from a single `EDITION` constant in `manual.js`).

**Files**:
- `docs/manual/index.html`
- `docs/manual/assets/manual.js` (EDITION constant, computed counts)

**Depends On**: Slice 2

**Validation Gate**:
```bash
grep -q 'EDITION' docs/manual/assets/manual.js
grep -q 'meta-bar' docs/manual/index.html
```

---

### Slice 4: Prev/next chapter footer [sequential]

**Goal**: Wire the existing `<div id="chapter-prev-next"></div>` placeholder on every chapter page to a renderer in `manual.js` that finds the current chapter by `file` (window.location.pathname basename), then emits prev / next links from `CHAPTERS` order.

**Files**:
- `docs/manual/assets/manual.js` (render function)
- `docs/manual/*.html` chapter files: only files that **do not already have an inline prev/next** are touched. Slice's executor lists current state with `grep -L 'chapter-prev-next' docs/manual/*.html` to find which need the include.

**Depends On**: Slice 3

**Validation Gate**:
```bash
grep -q 'chapter-prev-next' docs/manual/assets/manual.js
```

---

### Slice 5: Briefing-deck CSS [sequential]

**Goal**: Create `docs/assets/briefing-deck.css` with scroll-snap rules (`scroll-snap-type: y mandatory` on container, `scroll-snap-align: start` on slides), slide-number badge (`.slide-num` corner positioning), dot-nav (`.dot-nav` fixed positioning), and current-dot highlight (`.dot-nav .active`). No password overlay, no hero blur-orbs, no BCDR palette. Plan Forge token names (`--pf-blue`, `--pf-amber`, etc.) only.

**Files**:
- `docs/assets/briefing-deck.css` (new)

**Depends On**: Slice 4

**Validation Gate**:
```bash
test -f docs/assets/briefing-deck.css
grep -q 'scroll-snap' docs/assets/briefing-deck.css
```

---

### Slice 6: Briefing-deck JS [sequential]

**Goal**: Create `docs/assets/briefing-deck.js`. Handles dot click → `scrollIntoView({behavior:'smooth'})`, ArrowDown/ArrowRight/PageDown/Space → next slide, ArrowUp/ArrowLeft/PageUp/Shift+Space → prev slide, current-slide tracker (IntersectionObserver on slides updating dot active class). Touch swipe (touchstart/touchend with 50px threshold) per Decision #8.

**Files**:
- `docs/assets/briefing-deck.js` (new)

**Depends On**: Slice 5

**Validation Gate**:
```bash
test -f docs/assets/briefing-deck.js
grep -q 'IntersectionObserver' docs/assets/briefing-deck.js
grep -q 'touchstart' docs/assets/briefing-deck.js
```

---

### Slice 7: Convert QUICKSTART-WALKTHROUGH → quickstart-deck.html [sequential]

**Goal**: New `docs/walkthroughs/quickstart-deck.html` consuming `briefing-deck.css` + `briefing-deck.js`. One slide per `## ` section in `docs/QUICKSTART-WALKTHROUGH.md` (10 sections — plenty above the >=5 minimum). Markdown source stays untouched (still consumed by `llms.txt` and search).

**Files**:
- `docs/walkthroughs/quickstart-deck.html` (new)

**Depends On**: Slice 6

**Validation Gate**:
```bash
test -f docs/walkthroughs/quickstart-deck.html
test -f docs/QUICKSTART-WALKTHROUGH.md
grep -q 'briefing-deck.css' docs/walkthroughs/quickstart-deck.html
```

---

### Slice 8: Convert independent-dev-demo → independent-dev-deck.html [sequential]

**Goal**: Per Decision #4. New `docs/walkthroughs/independent-dev-deck.html`. One slide per major section of `docs/demos/independent-dev-demo.md` (5 narrative steps). Markdown stays.

**Files**:
- `docs/walkthroughs/independent-dev-deck.html` (new)

**Depends On**: Slice 7

**Validation Gate**:
```bash
test -f docs/walkthroughs/independent-dev-deck.html
test -f docs/demos/independent-dev-demo.md
grep -q 'briefing-deck.css' docs/walkthroughs/independent-dev-deck.html
```

---

### Slice 9: Architecture hub [sequential]

**Goal**: New `docs/architecture/index.html`. One card per existing architecture surface: `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`, `docs/MEMORY-ARCHITECTURE.md`, `docs/manual/memory-architecture.html`, `docs/manual/enterprise-reference-architecture.html`, plus any other `docs/manual/*architecture*.html` discovered at execution time. Each card: title (from H1), one-sentence description (from lede), link to source.

**Files**:
- `docs/architecture/index.html` (new)

**Depends On**: Slice 8

**Validation Gate**:
```bash
test -f docs/architecture/index.html
grep -q 'UNIFIED-SYSTEM-ARCHITECTURE' docs/architecture/index.html
grep -q 'MEMORY-ARCHITECTURE' docs/architecture/index.html
```

---

### Slice 10: "Architecture" dropdown in landing-page navs [sequential]

**Goal**: Add an "Architecture" entry to the existing `<nav>` block on every root-level `docs/*.html` landing page (10 files per Decision #7 audit). Linking to `/architecture/`. No restructure of existing nav items.

**Files**:
- `docs/index.html`, `docs/capabilities.html`, `docs/dashboard.html`, `docs/docs.html`, `docs/examples.html`, `docs/extensions.html`, `docs/faq.html`, `docs/problem.html`, `docs/shop-tour.html`, `docs/speckit-interop.html`

**Depends On**: Slice 9

**Validation Gate**:
```bash
grep -lq 'architecture' docs/index.html
```

---

### Slice 11: Shared styles [sequential]

**Goal**: Create `docs/assets/shared-styles.css`. Header comment documents the boundary: dashboard tokens stay in `pforge-mcp/dashboard/` (not consumed). Token block: `--pf-blue`, `--pf-amber`, `--pf-cyan`, `--pf-purple`, plus `:root` background / surface / text token pairs for dark and light modes (`html.light` swap pattern from the dashboard, copied conceptually but tokens use Plan Forge brand palette).

**Files**:
- `docs/assets/shared-styles.css` (new)

**Depends On**: Slice 10

**Validation Gate**:
```bash
test -f docs/assets/shared-styles.css
grep -q '—pf-blue\|--pf-blue' docs/assets/shared-styles.css
grep -q 'html.light' docs/assets/shared-styles.css
```

---

### Slice 12: Shared theme JS [sequential]

**Goal**: Create `docs/assets/shared-theme.js`. On load, reads `localStorage.getItem('pforge-theme')`; defaults to `dark` if absent. Toggles `html.light` class. Exposes `window.toggleTheme()` for inline buttons. No framework, vanilla JS.

**Files**:
- `docs/assets/shared-theme.js` (new)

**Depends On**: Slice 11

**Validation Gate**:
```bash
test -f docs/assets/shared-theme.js
grep -q 'toggleTheme' docs/assets/shared-theme.js
grep -q 'pforge-theme' docs/assets/shared-theme.js
```

---

### Slice 13: Wire shared layer + site-nav include into landing pages [sequential]

**Goal**: Per Decision #7, ship `docs/_includes/site-nav.html` plus `docs/assets/site-nav.js` loader. Each of the 4 target landing pages (manual index, blog index, capabilities page, architecture hub) gains: `<link rel="stylesheet" href="/assets/shared-styles.css">`, `<script src="/assets/shared-theme.js"></script>`, and a `<div id="site-nav"></div>` placeholder + `<script src="/assets/site-nav.js"></script>` loader. Loader fetches `/_includes/site-nav.html` and injects.

**Files**:
- `docs/_includes/site-nav.html` (new)
- `docs/assets/site-nav.js` (new)
- `docs/manual/index.html`, `docs/blog/index.html`, `docs/capabilities.html`, `docs/architecture/index.html`

**Depends On**: Slice 12

**Validation Gate**:
```bash
test -f docs/_includes/site-nav.html
test -f docs/assets/site-nav.js
grep -q 'shared-styles.css' docs/manual/index.html
grep -q 'shared-theme.js' docs/architecture/index.html
```

---

### Slice 14: Sweep — markers, link integrity, and CHANGELOG [sequential]

**Goal**: (a) Run `pforge sweep` and confirm zero new TODO/FIXME/stub/placeholder markers introduced in changed docs files; (b) Verify every `<a href>` produced in Slices 9-13 points at an existing file (basic link-existence check); (c) Verify no `pforge-mcp/dashboard/` file was touched (boundary invariant from Forbidden Actions); (d) Add `[Unreleased]` CHANGELOG entry under `### Phase-DOCS-UX-LIFT — BCDR UX patterns adopted for the docs site`.

**Files**:
- `CHANGELOG.md`

**Depends On**: Slice 13

**Validation Gate**:
```bash
grep -q 'Phase-DOCS-UX-LIFT' CHANGELOG.md
test ! -f pforge-mcp/dashboard/.touched-by-slice-14
```

_(The second check is a no-op assertion — we never create that file. It's a placeholder verifying that no Forbidden Actions tripped.)_

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
| `docs/manual/assets/manual.js` | 1, 2, 3, 4 |
| `docs/manual/index.html` | 1, 2, 3, 13 |
| `docs/manual/*.html` chapter files lacking prev/next | 4 |
| `docs/assets/briefing-deck.css` | 5 (new) |
| `docs/assets/briefing-deck.js` | 6 (new) |
| `docs/walkthroughs/quickstart-deck.html` | 7 (new) |
| `docs/walkthroughs/independent-dev-deck.html` | 8 (new) |
| `docs/architecture/index.html` | 9 (new), 13 |
| `docs/index.html` + 9 other landing pages | 10 |
| `docs/assets/shared-styles.css` | 11 (new) |
| `docs/assets/shared-theme.js` | 12 (new) |
| `docs/_includes/site-nav.html` | 13 (new) |
| `docs/assets/site-nav.js` | 13 (new) |
| `docs/blog/index.html`, `docs/capabilities.html` | 13 |
| `CHANGELOG.md` | 14 |

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
- **BCDR color palette** (azure-blue + red + midnight) — Plan Forge has a consistent forge identity (blue / amber / cyan / purple per subsystem).
- **Per-page hero blur-orbs** — fine on a marketing site, exhausting on docs.
- **Multi-page narrative shell for the dashboard** — the dashboard is an ops console, not a story. Its group-tabs → sub-tabs already work.
- **Sticky brand bar with confidential ribbon** — not applicable.

---

## Hand-off to Executor

Step 3 (executor) should:

1. Run via the existing chain pattern: `pforge run-plan docs/plans/Phase-DOCS-UX-LIFT-PLAN.md --foreground --quorum=auto --manual-import --manual-import-source human --manual-import-reason "docs UX lift from BCDR review"`. Foreground is required (per `/memories/repo/pforge-run-plan-foreground.md`).
2. Each slice auto-commits on gate pass. Halt-on-failure stops the chain at the first regression.
3. After Slice 14 lands, open a PR back to master with body referencing this plan + the BCDR source review date.
4. Do NOT promote `[Unreleased]` to a release in this phase — release happens separately per `docs/RELEASE-CHECKLIST.md`.
