# Phase TAILWIND-STATIC-BUILD — Replace runtime Tailwind CDN with a pre-built static stylesheet

> **Status**: Draft. Ready for incremental execution slice-by-slice.
> **Tracks**: Docs build pipeline + every HTML file under `docs/`. Adds one dev dependency (`tailwindcss`) and one build script. **No code under `pforge-mcp/`, `pforge-master/`, `pforge-sdk/`, `extensions/`, root scripts, or `.github/`.**
> **Estimated cost**: $0 (no LLM cost — entirely mechanical edits + a CLI invocation). ~95 HTML files touched in a deterministic find/replace pattern.
> **Pipeline**: Specify ✅ → Harden (per slice on demand) → Execute (slice at a time) → `node docs/manual/maintain.mjs` (must remain GREEN) → `npm run build:css` (must be idempotent) → Commit + push.
> **Recommended starting cluster**: **Cluster A — Foundation** (S1) because nothing else can ship without the config + first build proving the migration is viable.

---

## Why this phase exists

Every public-facing HTML page (`docs/**/*.html` — currently **95 files**) loads Tailwind CSS via the runtime CDN:

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{forge:{...}}}}}</script>
```

This pattern was fine for prototyping but has accumulated four architectural violations as the manual grew to ebook scale:

| Violation | Evidence |
|---|---|
| **Vendor explicitly disrecommends this in production** | `cdn.tailwindcss.com should not be used in production` warning emitted on every page load |
| **Single source of truth broken** | The `forge` color palette is inlined in 95 files with **at least 3 distinct definitions** (`400/500` only, `300/400/500/600/700`, with or without `fontFamily`) — drift already present |
| **Layer separation broken** | A ~300 KB JavaScript CSS compiler runs in the browser on every page load. CSS generation is a build concern, not a runtime one |
| **Runtime third-party CDN dependency for static content** | Breaks offline ebook reading, breaks behind air-gapped firewalls, no Subresource Integrity hash = supply-chain risk |

The fix is **one config file + one build step + one static stylesheet**. The HTML edit per page is a two-line swap.

---

## Scope Contract

### In Scope

- New file `tailwind.config.cjs` at repo root — canonical theme (forge palette, fontFamily, content paths, safelist)
- New file `docs/assets/tailwind.css` — source file with three `@tailwind` directives
- New committed artifact `docs/assets/tailwind.built.css` — generated, **committed to repo** so GitHub Pages serves it without a build step
- Edits to `package.json` — add `tailwindcss` to `devDependencies`, add `build:css` npm script
- Edits to **every HTML file under `docs/**`** matching the pattern below — exactly two-line swap per file:
  ```diff
  - <script src="https://cdn.tailwindcss.com"></script>
  - <script>tailwind.config={...}</script>
  + <link rel="stylesheet" href="<RELATIVE>/assets/tailwind.built.css">
  ```
  where `<RELATIVE>` is `.` for `docs/*.html`, `..` for `docs/manual/*.html` / `docs/blog/*.html` / `docs/architecture/*.html`
- New validation step in `docs/manual/maintain.mjs` (or a sibling `scripts/validate-tailwind-build.mjs` if maintain.mjs's scope is too narrow) — rebuilds the CSS and fails if `tailwind.built.css` has uncommitted drift
- Updates to `docs/RELEASE-CHECKLIST.md` and `CONTRIBUTING.md` documenting the build step
- New entry in `.gitattributes` marking `tailwind.built.css` as `linguist-generated=true` so GitHub diffs don't surface it as authored

### Out of Scope

- Any change under `pforge-mcp/`, `pforge-master/`, `pforge-sdk/`, `extensions/`, `presets/`, root scripts, `.github/`
- Adding new Tailwind classes or refactoring class usage in any HTML page (mechanical migration only — visual output must be byte-identical or near-identical)
- Switching to PostCSS, replacing Tailwind with another CSS framework, or restructuring `manual.css` / `shared.css`
- Removing the existing inline `<style>` blocks in HTML pages (they coexist with Tailwind classes; out of scope for this phase)
- Touching the SVG diagrams under `docs/manual/assets/diagrams/`
- Performance work beyond what naturally falls out of dropping the runtime compiler
- Lighthouse / CI performance audit infrastructure
- Subresource Integrity hashes on remaining CDN scripts (mermaid, fonts) — separate concern
- Migrating off the Google Fonts CDN
- Renaming `forge:{400,500}` → `forge:{300,400,500,600,700}` in pages that use the slimmer palette — they continue to work because the consolidated config defines the full palette

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected fix; tripwire for any phase — an executor that touches it has misread the scope)
- **Do NOT** ship a slice that leaves a page with **both** the CDN script tag **and** the new stylesheet `<link>` — pages must be fully migrated or fully unmigrated. Half-migrated pages double-load Tailwind and the inline `tailwind.config` script silently no-ops against the static build
- **Do NOT** delete `tailwind.built.css` from the repo (it must be committed so GitHub Pages serves it with zero build infra)
- **Do NOT** add `tailwind.built.css` to `.gitignore`
- **Do NOT** introduce a `postinstall` hook that runs the Tailwind build — it must be explicit (`npm run build:css`) so CI failures are visible and contributors aren't surprised
- **Do NOT** add a watch process, dev server, or live-reload tooling — out of scope; this phase ships a one-shot build only
- **Do NOT** consolidate any `<style>` block from an HTML page into `tailwind.css` — page-local styles stay page-local
- **Do NOT** rewrite the manual's `shared.css` or `assets/manual.css` — they layer on top of the built Tailwind file unchanged
- **Do NOT** bundle two slices into one commit. Each slice = one commit so a single bad migration can be reverted cleanly

### Source files (read-only, treated as authoritative)

| Source | Authoritative for |
|---|---|
| `docs/index.html` (lines 27–35) | Most complete inline `tailwind.config` (forge palette + fontFamily) — copy into root config |
| `docs/manual/*.html` lines 9–11 (slim variant) | Manual-page pattern (`forge:{400,500}` only) — slim palette consumers |
| `docs/blog/*.html` lines 30–32 (full variant) | Blog-page pattern (forge:{300–700} + fontFamily) |
| `docs/manual/maintain.mjs` | Validator hook surface for the drift check step |
| Tailwind v3 standalone CLI docs | Build command syntax + content scan rules |

### Surface inventory (final scope counts)

| Subtree | HTML files | Notes |
|---|---|---|
| `docs/*.html` (root) | 12 | Includes `index.html`, `404.html`, `dashboard.html`, marketing pages |
| `docs/manual/*.html` | ~70 | Largest cluster — every chapter + appendix |
| `docs/blog/*.html` | 10 | All use the full forge palette |
| `docs/architecture/*.html` | 1 | Single file |
| `docs/observability/`, `docs/security/`, `docs/walkthroughs/`, `docs/demos/`, `docs/integrations/`, `docs/research/`, `docs/manual/` subdirs | TBD at S1 harden time | Re-run the grep to catch any subdirs missed by the initial scan |
| **Total target** | **~95** | Verified via `grep "cdn.tailwindcss.com" docs/**/*.html` at plan-draft time |

---

## Required Decisions

All resolved during plan drafting; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Tailwind version | **v3 standalone CLI** (`tailwindcss@^3`). v4 changes config format and is still settling; v3 is the proven stable line and the inline configs we're consolidating use v3 syntax. |
| 2 | Where the source CSS lives | `docs/assets/tailwind.css` — same folder as `shared.css`, alongside the built output. Keeps assets co-located. |
| 3 | Where the built CSS lives | `docs/assets/tailwind.built.css` — committed, served directly by GitHub Pages. The `.built.css` suffix makes it visually obvious in diffs that it's a generated artifact. |
| 4 | Config file format | `tailwind.config.cjs` (CommonJS) at repo root — Tailwind v3 supports both, but CJS sidesteps the `"type":"module"` setting in `package.json` (which would break other root scripts). |
| 5 | Canonical forge palette | The **full 5-shade variant** from `docs/index.html`: `forge:{300:'#fcd34d',400:'#fbbf24',500:'#f59e0b',600:'#d97706',700:'#b45309'}`. Pages that currently only reference `400/500` continue to work; pages currently using `300/600/700` continue to work. No HTML class-name edits needed. |
| 6 | Canonical fontFamily | `sans: ['Inter','system-ui','sans-serif']`, `mono: ['"JetBrains Mono"','"Fira Code"','monospace']` — matches the inline config used by most pages. |
| 7 | Safelist contents | Class names generated at runtime by `manual.js` (status pills: `status-pill--*`, mermaid output classes, glossary tooltip classes). Enumerate at S1 harden time by grepping `manual.js` for template-literal class concatenation. |
| 8 | Build invocation | `npm run build:css` → `tailwindcss -i docs/assets/tailwind.css -o docs/assets/tailwind.built.css --minify`. No watch mode. |
| 9 | Drift validation | A new step in `docs/manual/maintain.mjs` runs `npm run build:css` and `git diff --exit-code docs/assets/tailwind.built.css`. Fails if the committed CSS doesn't match a fresh build. |
| 10 | Commit cadence for the built CSS | Rebuild + commit the CSS as part of **the same commit** that adds new Tailwind classes to any HTML page. Author responsibility documented in `CONTRIBUTING.md` (S6 deliverable). |
| 11 | Whether to keep the inline `<script>tailwind.config=...</script>` blocks during migration | **No**. Both lines (CDN script + config script) are removed atomically per page. Leaving the config script orphan-loaded against a static build would be silent dead code. |
| 12 | Migration ordering within Cluster B | **Smallest cluster first** (architecture → root → blog → manual) so any pattern surprises surface on a small surface before the 70-file manual sweep. |

---

## Acceptance Criteria (apply to every slice)

### Build rules

- **MUST**: `npm run build:css` exits 0 and produces `docs/assets/tailwind.built.css`
- **MUST**: A second consecutive `npm run build:css` produces a byte-identical file (idempotence)
- **MUST**: The built file is ≤ 200 KB minified (sanity check — if it's larger, content scan is wrong)
- **MUST**: The built file contains the forge color CSS variables (`grep -q "forge-500" docs/assets/tailwind.built.css`)

### HTML migration rules

- **MUST**: Every migrated page has **zero** occurrences of `cdn.tailwindcss.com`
- **MUST**: Every migrated page has **zero** occurrences of the literal string `tailwind.config=` (the inline config block is fully removed)
- **MUST**: Every migrated page contains exactly one `<link rel="stylesheet" href="<RELATIVE>/assets/tailwind.built.css">` in `<head>`
- **MUST**: Relative path matches the file's directory depth (`./` for `docs/*.html`, `../` for `docs/manual/*.html`, etc.)
- **MUST**: Visual output of a sampled subset (root `index.html`, one manual chapter, one blog post) is unchanged — verify by opening in a browser and confirming no missing styles, font fallback flashes, or broken layouts
- **SHOULD**: The CDN warning `cdn.tailwindcss.com should not be used in production` no longer appears in the browser console on any migrated page

### Registry / config rules

- **MUST**: `tailwind.config.cjs` declares `content` covering all migrated subtrees plus `docs/manual/assets/manual.js` (which contains class strings in template literals)
- **MUST**: `tailwind.config.cjs` declares the forge palette as decided in #5 and fontFamily as decided in #6
- **MUST**: `package.json` has `tailwindcss` in `devDependencies` and `build:css` in `scripts`
- **MUST**: `.gitattributes` marks `docs/assets/tailwind.built.css` with `linguist-generated=true`

### Validation gate (every slice)

```pwsh
# Mechanical checks
npm run build:css                                         # MUST exit 0
git diff --exit-code docs/assets/tailwind.built.css       # MUST be clean (idempotent build)
node docs/manual/maintain.mjs                             # MUST print "All checks passed — manual is in sync"
node docs/manual/maintain.mjs                             # second run MUST be idempotent

# Drift checks (per slice — count must reach 0 after final migration slice)
(Select-String -Path "docs\**\*.html" -Pattern "cdn\.tailwindcss\.com" -SimpleMatch).Count   # MUST equal 0 after S5
(Select-String -Path "docs\**\*.html" -Pattern "tailwind\.config=" -SimpleMatch).Count       # MUST equal 0 after S5
```

### Commit message convention

```
build(docs): <slice-label> — <one-line summary>

<2-4 sentence body explaining what migrated and what the visual-validation sample was.>
```

---

## Slice Plan

Slices are mostly sequential because S1 (Foundation) gates everything else, and S6 (drift guard) requires the migration to be complete. Within Cluster B (migrations), slices are independent and can ship in any order — recommended order is smallest-first per decision #12.

### Cluster A — Foundation

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **S1** | **Foundation: config + first build + one-page proof** | New `tailwind.config.cjs`, `docs/assets/tailwind.css`, `docs/assets/tailwind.built.css`, `npm run build:css` script in `package.json`, `.gitattributes` entry. Migrate **exactly one** representative page (`docs/manual/copilot-integration.html` — it has the mermaid diagrams already touched this session, so visual regression is easy to spot) as the proof point. | `docs/index.html` (canonical inline config), Tailwind v3 standalone CLI docs | — |

### Cluster B — Mass migration (run in this order)

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **S2** | **Migrate `docs/architecture/*.html`** | 1 file — `docs/architecture/index.html`. Smallest cluster, validates the pattern on a non-manual subtree. | Inline `tailwind.config` in target file | S1 |
| **S3** | **Migrate `docs/*.html` (root)** | ~12 files — `index.html`, `404.html`, `dashboard.html`, `capabilities.html`, `docs.html`, `extensions.html`, `examples.html`, `faq.html`, `problem.html`, `shop-tour.html`, `speckit-interop.html`, plus any others surfaced at harden time | Inline `tailwind.config` in each target file | S1 |
| **S4** | **Migrate `docs/blog/*.html`** | 10 files — all blog posts use the full forge palette so they're the safest cluster | Inline `tailwind.config` in each target file | S1 |
| **S5** | **Migrate `docs/manual/*.html`** | ~70 files — the largest cluster. Split into sub-commits if a single commit would exceed reasonable review size, but each sub-commit must pass the validation gate independently | Inline `tailwind.config` in each target file | S1, S2 (architecture serves as a non-manual subtree smoke test), S4 (blog validates the full forge palette consumer path) |

### Cluster C — Hardening

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **S6** | **Drift guard in `maintain.mjs` + documentation** | New step in `docs/manual/maintain.mjs` that runs `npm run build:css` and `git diff --exit-code docs/assets/tailwind.built.css`, failing if drift is detected. Updates to `docs/RELEASE-CHECKLIST.md` (add "rebuild tailwind.built.css if any HTML class changed") and `CONTRIBUTING.md` (add "after editing HTML run `npm run build:css`"). Optional: a `.github/workflows/` check if the repo runs CI — confirm at harden time whether one exists. | This plan + maintain.mjs existing validator pattern | S5 |
| **S7** | **Phase closure: cross-grep sweep + retro** | Run the drift-check greps from the Acceptance Criteria section across the whole tree. Confirm zero occurrences of `cdn.tailwindcss.com` and `tailwind.config=`. Write a 1-paragraph retro note appended to this plan as `## What actually shipped` covering: total HTML pages migrated, built CSS size, any class names that needed safelisting, and any visual regressions caught during migration. | Output of the full slice run | S1–S6 |

---

## Per-slice playbook (apply to any slice)

1. **Pick the slice** from the table above
2. **For S1**: Install `tailwindcss@^3` as a devDependency, write `tailwind.config.cjs` per decisions #4–#7, write `docs/assets/tailwind.css` with the three `@tailwind` directives, add `build:css` to `package.json`, run `npm run build:css`, verify output, then migrate one proof-of-concept page
3. **For S2–S5 (migration slices)**: Run the find/replace pattern across the target subtree, verify path-relativity (`./` vs `../`), spot-check one file in the editor to confirm the two old lines are gone and the new line is present
4. **Run the validation gate** at the bottom of every slice — both the build idempotence check and the maintain.mjs check
5. **Visually verify** at least one page from the slice's subtree by opening it in a browser. Compare against the same page on `master` (use `git stash` + browser refresh) to confirm no visual regression
6. **Rebuild and commit** the built CSS — every migration slice that triggers a content scan delta must include the updated `tailwind.built.css` in the same commit
7. **Commit** with the convention above. One slice = one commit (or a small numbered sequence for S5 if needed; document the split in the commit body)
8. **Push** to `master`
9. **Mark the slice complete** in this file by adding `✅` next to the slice ID below

---

## Progress tracker

> Update this section after each slice ships. The status reflects what is on `master`.

### Cluster A — Foundation
- [ ] **S1** Foundation: config + first build + one-page proof

### Cluster B — Mass migration
- [ ] **S2** Migrate `docs/architecture/*.html`
- [ ] **S3** Migrate `docs/*.html` (root)
- [ ] **S4** Migrate `docs/blog/*.html`
- [ ] **S5** Migrate `docs/manual/*.html`

### Cluster C — Hardening
- [ ] **S6** Drift guard in `maintain.mjs` + documentation
- [ ] **S7** Phase closure: cross-grep sweep + retro

---

## Open questions

> These don't block the plan but should be answered before or during S1 harden.

1. **CI presence**: Does the repo run CI on PRs / pushes to `master`? If yes, S6 should add a GitHub Actions step calling `npm run build:css && git diff --exit-code`. If no, the maintain.mjs hook alone is the guard.
2. **Tailwind v4 timing**: v4 was released earlier in 2026 with breaking config changes. Is there appetite to skip v3 and go straight to v4? Recommend **no** — v4's CSS-first config is a separate migration; do v3 now, plan v4 as a follow-on phase only if there's a concrete payoff.
3. **`shared.css` interaction**: Does `docs/assets/shared.css` define utility classes that overlap with Tailwind? If yes, the new built file may shadow/duplicate them. Audit at S1 harden time.
4. **Hand-written `<style>` blocks**: Some pages (e.g. `docs/manual/copilot-integration.html`) have inline `<style>` blocks defining `.callout`, `.cmd-block`, etc. These stay as-is — they're page-local component styles outside Tailwind's purview. Confirm none of them duplicate utility classes that the migration would silently shadow.
5. **Mermaid CSS**: The new `mermaid-init.js` injects mermaid's UMD bundle which ships its own CSS. No interaction expected with Tailwind, but verify at S1 by checking a mermaid-containing page in both pre- and post-migration states.
