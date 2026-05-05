# Phase MANUAL-RESTRUCTURE: Manual Tier 3 Restructure (Quickstart Act 0 + Chapter Splits)

> **Status**: Drafted, awaiting hardening (Step 2)
> **Source**: Tier 3 of [docs/MANUAL-PROSE-AUDIT-2026-05.md](../MANUAL-PROSE-AUDIT-2026-05.md)
> **Tracks**: Documentation only — no code changes
> **Estimated cost**: $0.30–$1.00 (small writing/editing slices, no test gates needed)

---

## Feature Specification: Manual Restructure

### Problem Statement

After Tier 1 + Tier 2 prose fixes (commits [`9068888`](https://github.com/srnichols/plan-forge/commit/9068888) and [`7163f3e`](https://github.com/srnichols/plan-forge/commit/7163f3e)), a busy senior dev has a ~90% chance of figuring out Plan Forge in a 30-minute attention budget. The remaining ~10% of friction comes from three specific structural problems the prose audit flagged:

1. **`dashboard.html` describes 33 tabs in one chapter** — overwhelming for first-time dashboard users; no progressive disclosure
2. **`mcp-server.html` describes 69 tools in one chapter** — overwhelming for integrators; no "learn these 10 first" path
3. **`instructions-agents.html` mixes 17 instruction files + 14 agents + 12 skills + 7 lifecycle hooks** — reference catalog masquerading as tutorial
4. **No "Quickstart Act 0"** — newcomers must page through 5 Act I chapters before reaching the hands-on `your-first-plan.html` walkthrough

### User Scenarios

**Scenario 1: New user wants to be productive in 30 minutes**
1. They land on planforge.software/manual/ from the README
2. They see a clearly-labelled "**Quickstart**" section above Act I
3. Three chapters: Install → First Plan → First Deploy. Promise: 30 minutes from zero to shipped.
4. Outcome: They complete Quickstart in 25 minutes, then return to Act I when they want depth.

**Scenario 2: Operator wants to find a specific dashboard tab**
1. They land on `dashboard.html` looking for "where do I see costs?"
2. The chapter intro lists the 4 top-level groups (Forge / LiveGuard / Forge-Master / Settings) with a link to each.
3. They click "Forge → Operations" and land on a focused chapter covering Progress, Runs, Cost, Actions, Replay, Traces (~6 tabs, not 33).
4. Outcome: They find the Cost tab in 30 seconds without scrolling past 27 unrelated tabs.

**Scenario 3: Integrator wants to use forge_run_plan from their CI**
1. They land on `mcp-server.html` looking for one tool to wire up.
2. The chapter intro shows three paths: "Architecture" / "Quickstart: 10 most useful tools" / "Full reference (69 tools, 8 categories)".
3. They click "Quickstart: 10 most useful tools" and find `forge_run_plan` with full schema + example in the first 200 words.
4. Outcome: They wire it up without ever opening the 1500-line full reference.

### Acceptance Criteria

- [ ] **MUST**: A new top-level "Quickstart" section exists in `docs/manual/index.html` chapter grid, visually distinct from Acts I–IV, containing exactly 3 chapter cards.
- [ ] **MUST**: Three new chapter pages exist at `docs/manual/quickstart-{install,first-plan,first-deploy}.html`, each ≤300 lines of prose, each promising completion in ≤10 minutes.
- [ ] **MUST**: `dashboard.html` is split into 4 chapters: `dashboard.html` (overview + Forge group), `dashboard-liveguard.html` (LiveGuard group), `dashboard-forge-master.html` (Studio tab), `dashboard-settings.html` (Settings group).
- [ ] **MUST**: `mcp-server.html` is split into 3 chapters: `mcp-server.html` (architecture + starting the server), `mcp-server-quickstart.html` (10 most-useful tools), `mcp-server-reference.html` (full 69-tool reference).
- [ ] **MUST**: `instructions-agents.html` is split into 2 chapters: `instructions-agents.html` (tutorial + concrete scenario + auto-load mechanics), `instructions-agents-reference.html` (full catalog of 17 files + 14 agents + 12 skills + 7 hooks).
- [ ] **MUST**: All cross-links inside the manual that point at split-source chapters are updated to point at the correct new chapter.
- [ ] **MUST**: External cross-links from `docs/index.html` (homepage), `docs/blog/*.html`, `docs/capabilities.md`, and `README.md` that point at split-source chapters are updated.
- [ ] **MUST**: `docs/manual/assets/manual.js` chapter registry is updated with the 9 new chapters in the right Act order; sidebar nav renders correctly.
- [ ] **MUST**: `docs/manual/index.html` chapter grid is updated to reflect the new chapter count and structure.
- [ ] **MUST**: Every existing anchor (`#tab-overview`, `#tools-core`, etc.) on the split-source chapters is preserved either at its original URL with a redirect note OR migrated to the new chapter where its content lives, with a redirect callout at the original location.
- [ ] **SHOULD**: A "What changed" callout appears at the top of each split-source chapter for 30 days pointing at the new structure.
- [ ] **SHOULD**: Chapter renumbering is reflected in `docs/manual/assets/manual.js` chapter `num` field; existing chapter numbers (1–24 + appendices) are not renumbered.
- [ ] **SHOULD**: All 3 Quickstart chapters have a hero image generated via the existing `gen-manual-tier1-heroes.mjs` pattern.
- [ ] **MAY**: A `docs/MANUAL-RESTRUCTURE-2026-05-MIGRATION.md` document records old-URL → new-URL mappings for 30 days of redirect callouts.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| External link points at `dashboard.html#tab-cost` | Anchor stays on `dashboard.html` (Forge-group chapter still owns it). Cross-links from outside the manual continue to work. |
| External link points at `dashboard.html#lg-health` | Original page has a callout pointing at `dashboard-liveguard.html#lg-health` for 30 days. Anchor on the original page redirects via JS or section moves. |
| Internal link in `customization.html` points at `instructions-agents.html#hooks` | Updated to point at `instructions-agents-reference.html#hooks` (lifecycle hooks live in the reference chapter). |
| Search engine has indexed old URLs | Old URLs return HTTP 200 with content (the split-source chapter still exists with reduced content + migration callout). No 404s. |
| Sidebar nav renders 9 extra chapters | Acceptable — manual has 38 chapters today; will have 47 after the split. Sidebar groups by Act so the count growth is visible per-Act, not in one wall. |

### Out of Scope

- Renumbering existing chapters 1–24 (would break ~50+ external links; not worth it)
- Splitting any other chapter (`writing-plans`, `crucible`, `liveguard-tools`, `forge-master`, etc. all stay single-page)
- Creating new content beyond the 3 Quickstart chapters and the introductory sections of the split chapters
- Translating any chapter to other languages
- Adding new SVGs (existing 19 SVGs are sufficient for the new chapter structure)

### Open Questions

1. **Quickstart vs Act 0?** — Audit recommended "Act 0". Considered "Quickstart" instead because it's more discoverable on the index page. **Decision pending hardening**; both options ship the same chapters.
2. **Should `mcp-server-reference.html` have its own hero?** — Reference chapters traditionally don't, but the existing `mcp-server.html` has `ch11-hero.jpg` which would naturally migrate. **Recommend: hero stays on the architecture chapter, reference inherits a smaller chip-style header.**
3. **Migration callout duration: 30 days or permanent?** — 30 days is enough for search engines to re-crawl. After that, the original chapters become slim (architecture + group overview only). **Recommend: 30 days, then trim.**

### Complexity Estimate

- **Estimated effort**: Large (5–8 hours of editing across 14 files; no AI generation needed since prose already exists in source chapters)
- **Estimated files**: 14 (3 new Quickstart, 8 new split chapters, 3 source chapters reduced, plus updates to manual.js + index.html)
- **Recommended pipeline**: **Documentation pipeline** — Steps 0–4 (Specify, Pre-flight, Harden, Execute, Sweep). Skip Step 5 (Review) because there are no tests; manual visual spot-check on the live site replaces it. Step 6 (Ship) = git push + Pages rebuild.

---

## Scope Contract

### Inputs

- Existing chapters: `dashboard.html` (~370 lines), `mcp-server.html` (~470 lines), `instructions-agents.html` (~200 lines)
- Existing chapter registry: `docs/manual/assets/manual.js` (CHAPTERS array)
- Existing chapter grid: `docs/manual/index.html`
- Audit recommendations: `docs/MANUAL-PROSE-AUDIT-2026-05.md` Tier 3 section
- External link sources: `docs/index.html` (homepage), `docs/capabilities.md`, `README.md`, every `docs/blog/*.html`

### Outputs

**New files** (12):
- `docs/manual/quickstart-install.html`
- `docs/manual/quickstart-first-plan.html`
- `docs/manual/quickstart-first-deploy.html`
- `docs/manual/dashboard-liveguard.html`
- `docs/manual/dashboard-forge-master.html`
- `docs/manual/dashboard-settings.html`
- `docs/manual/mcp-server-quickstart.html`
- `docs/manual/mcp-server-reference.html`
- `docs/manual/instructions-agents-reference.html`
- `docs/manual/assets/chapter-heroes/quickstart-install-hero.jpg`
- `docs/manual/assets/chapter-heroes/quickstart-first-plan-hero.jpg`
- `docs/manual/assets/chapter-heroes/quickstart-first-deploy-hero.jpg`

**Modified files** (5):
- `docs/manual/dashboard.html` — content removed for splits, migration callout added
- `docs/manual/mcp-server.html` — content removed for splits, migration callout added
- `docs/manual/instructions-agents.html` — content removed for split, migration callout added
- `docs/manual/assets/manual.js` — chapter registry expanded with 12 new entries in correct Act order
- `docs/manual/index.html` — Quickstart section added at top, chapter grid expanded, chapter counts updated

**Optional documentation**:
- `docs/MANUAL-RESTRUCTURE-2026-05-MIGRATION.md` (old → new URL mappings)

### Forbidden Actions

- **DO NOT** rename or delete any existing chapter file. Splits add new files; sources stay at their original URL with reduced content.
- **DO NOT** renumber chapters 1–24 in `manual.js`. New chapters get suffixes (e.g., `7a`, `7b`, `7c` for dashboard splits) or are inserted at numbered positions (`Q1`, `Q2`, `Q3` for Quickstart).
- **DO NOT** modify `docs/manual/assets/manual.css` — the existing styling must work for the new chapters.
- **DO NOT** introduce new dependencies (Tailwind CDN + the existing manual.css is sufficient).
- **DO NOT** create new SVG diagrams — existing 19 SVGs cover the new chapter structure.
- **DO NOT** modify any plan in `docs/plans/` other than this one.
- **DO NOT** modify any code in `pforge-mcp/`, `pforge-master/`, or `scripts/`.
- **DO NOT** modify any blog post in `docs/blog/` beyond updating cross-links to split chapters.

### Build / Test Commands

- **Build command**: `(none — static HTML, no build step)`
- **Test command**: `node scripts/check-broken-links.mjs docs/manual/` — broken-link check across the manual after each slice (script needs to be added in Slice 0 if it doesn't exist; otherwise use `grep -r 'href=' docs/manual/ | check_each_resolves`)

---

## MUST Criteria

- [ ] All 12 new files created and render correctly when opened in a browser
- [ ] `manual.js` sidebar nav renders Quickstart section + all 9 new chapters in correct Act order
- [ ] No broken internal links in `docs/manual/` (verified by link checker)
- [ ] Migration callouts present on the 3 split-source chapters
- [ ] Homepage `docs/index.html` references at least one Quickstart chapter (e.g., from "Get Started" CTA)

## SHOULD Criteria

- [ ] All 3 Quickstart hero images generated and wired
- [ ] `docs/MANUAL-RESTRUCTURE-2026-05-MIGRATION.md` exists with old → new URL table
- [ ] `MANUAL-PROSE-AUDIT-2026-05.md` Tier 3 checklist updated to ✅ COMPLETE

---

## Execution Slices

### Slice 1 — Add link checker + baseline
**Files in scope**: `scripts/check-manual-links.mjs` (new), `docs/MANUAL-RESTRUCTURE-2026-05-MIGRATION.md` (new, scaffold only)
**Goal**: Add a Node script that grep-walks `docs/manual/*.html` and reports any internal link that doesn't resolve. Use as the validation gate for every subsequent slice. Also scaffolds the migration doc with table headers.
**Validation gate**: `node scripts/check-manual-links.mjs` exits 0 with current manual (baseline)
**Estimated cost**: $0.02

### Slice 2 — Quickstart Act 0 (3 new chapters)
**Files in scope**: `docs/manual/quickstart-install.html`, `docs/manual/quickstart-first-plan.html`, `docs/manual/quickstart-first-deploy.html`, `docs/manual/index.html` (Quickstart section added at top of chapter grid)
**Goal**: Three short, focused chapters distilled from the full `installation.html` + `your-first-plan.html` + new "first deploy" content. Each chapter ≤300 lines, ≤10 minute read promise. Wired into `index.html` chapter grid in a new "Quickstart" band above Act I.
**Validation gate**: `node scripts/check-manual-links.mjs` passes; manual `Get-Content quickstart-*.html | Measure-Object -Line` shows each ≤350 lines (≤300 prose + boilerplate)
**Estimated cost**: $0.10

### Slice 3 — Generate 3 Quickstart hero images
**Files in scope**: `docs/manual/assets/chapter-heroes/quickstart-{install,first-plan,first-deploy}-hero.jpg`, `scripts/gen-quickstart-heroes.mjs` (new), 3 quickstart chapters wire heroes
**Goal**: Generate 3 new heroes via Grok Aurora following the existing `gen-manual-tier1-heroes.mjs` pattern. Wire each into its chapter.
**Validation gate**: All 3 .jpg files exist and are >50KB; quickstart chapters reference them via `<img src="assets/chapter-heroes/quickstart-*.jpg" class="chapter-hero" />`
**Estimated cost**: $0.06 (Grok image gen)

### Slice 4 — Split dashboard.html (4 chapters)
**Files in scope**: `docs/manual/dashboard.html` (reduced), `docs/manual/dashboard-liveguard.html` (new), `docs/manual/dashboard-forge-master.html` (new), `docs/manual/dashboard-settings.html` (new)
**Goal**: Move LiveGuard tabs section to `dashboard-liveguard.html`; move Forge-Master Studio section to `dashboard-forge-master.html`; move Settings group section to `dashboard-settings.html`. Original `dashboard.html` keeps overview, tab taxonomy SVG, and the 16-tab Forge group. Add migration callout on `dashboard.html` listing what moved where with anchor links.
**Validation gate**: link checker passes; `Select-String -Pattern '<h2 id=' docs/manual/dashboard*.html | Measure-Object -Line` shows total H2 count is preserved (same anchors, just redistributed)
**Estimated cost**: $0.04

### Slice 5 — Split mcp-server.html (3 chapters)
**Files in scope**: `docs/manual/mcp-server.html` (reduced), `docs/manual/mcp-server-quickstart.html` (new), `docs/manual/mcp-server-reference.html` (new)
**Goal**: Reduce `mcp-server.html` to architecture + starting the server + REST API summary. Create `mcp-server-quickstart.html` with the 10 most-useful tools (forge_capabilities, forge_smith, forge_run_plan, forge_estimate_quorum, forge_cost_report, forge_diff, forge_diagnose, forge_master_ask, forge_liveguard_run, forge_drift_report) and full schemas. Move 8-category tool catalog to `mcp-server-reference.html`. Migration callout on source.
**Validation gate**: link checker passes; reference page has all 69 tools (count `<code>forge_` occurrences)
**Estimated cost**: $0.05

### Slice 6 — Split instructions-agents.html (2 chapters)
**Files in scope**: `docs/manual/instructions-agents.html` (reduced), `docs/manual/instructions-agents-reference.html` (new)
**Goal**: Reduce `instructions-agents.html` to "How Auto-Loading Works" + the new "A Concrete Scenario" walkthrough + a brief overview of agent types. Move full catalog (17 instruction files + 14 agents + 12 skills + 7 lifecycle hooks) to `instructions-agents-reference.html`. Migration callout on source.
**Validation gate**: link checker passes; reference page has all 17 instruction files (count rows in main table)
**Estimated cost**: $0.04

### Slice 7 — Update manual.js + index.html for new structure
**Files in scope**: `docs/manual/assets/manual.js` (CHAPTERS array), `docs/manual/index.html` (chapter grid)
**Goal**: Add 12 new entries to CHAPTERS in correct Act order. Update chapter count in `index.html` header text. Add Quickstart section to chapter grid above Act I. Verify sidebar nav renders correctly.
**Validation gate**: link checker passes; sidebar in browser renders all chapters in correct order (manual visual spot-check)
**Estimated cost**: $0.03

### Slice 8 — Update external cross-links
**Files in scope**: `docs/index.html`, `docs/capabilities.md`, `docs/blog/spec-kit-plan-forge.html`, `docs/blog/seven-agents.html`, `docs/blog/the-loop-that-never-ends.html`, `docs/blog/the-journey-from-impossible-to-seven-minutes.html`, `README.md`
**Goal**: Find every external link pointing at `dashboard.html#`, `mcp-server.html#`, or `instructions-agents.html#` and update to the correct new chapter URL. Use `grep -r` to enumerate first.
**Validation gate**: `node scripts/check-manual-links.mjs --include-external` exits 0 (or matches the baseline if external check is best-effort)
**Estimated cost**: $0.02

### Slice 9 — Final sweep + migration doc
**Files in scope**: `docs/MANUAL-PROSE-AUDIT-2026-05.md` (Tier 3 ✅), `docs/MANUAL-RESTRUCTURE-2026-05-MIGRATION.md` (populated)
**Goal**: Mark Tier 3 complete in the prose audit doc with the date. Populate the migration doc with the full old → new URL table for 30-day reference.
**Validation gate**: link checker passes one final time; `Select-String '\[ \]' docs/MANUAL-PROSE-AUDIT-2026-05.md | Measure-Object -Line` shows zero unchecked Tier 3 boxes
**Estimated cost**: $0.01

---

## Branch Strategy

- Branch name: `manual/restructure-tier3`
- Base: `master`
- Merge strategy: Squash merge after all 9 slices pass

## Rollback Plan

- All changes are documentation-only. Rollback = `git revert <merge-commit>` and force-push.
- For partial rollback (e.g., split worked but Quickstart didn't): each slice is its own commit; revert individual commits.
- Migration doc preserves old-URL → new-URL mapping so a rollback restores all original anchors automatically.
- No data migrations, no DB changes, no code dependencies — rollback is safe at any point.

---

## Open Decisions (resolve during Step 2 hardening)

1. Quickstart vs Act 0 naming
2. Reference chapter hero strategy (inherit vs new)
3. Migration callout duration (30 days vs permanent)
4. Whether to add a one-line `meta refresh` on split-source chapter anchors that moved (e.g., `#lg-health` on dashboard.html → 0-second redirect to dashboard-liveguard.html#lg-health). **Recommend: NO**, keep all original anchors functional via section retention; users with bookmarks shouldn't get redirected mid-read.

---

## Notes for the Hardener (Step 2)

- This plan is unusual in that it's a **pure documentation restructure** with no code changes. The Plan Hardener should verify the validation gates are appropriate for prose work (link checker, line counts, anchor preservation) rather than build/test.
- Slice 1 must add `scripts/check-manual-links.mjs` — without it, every subsequent slice's gate is hand-verification.
- The link checker should be lenient on external links (warn, don't fail) since blog posts and the homepage are outside the manual's controlled cross-link space.
- All 9 slices are sequential — none can run in parallel because each touches `manual.js` (slices 2–7) or `index.html` (slices 2, 7).
