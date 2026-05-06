# Phase-ENTERPRISE-DOCS-HTML: Convert 6 enterprise Markdown docs to HTML appendices

> **Status**: Hardened, ready for execution
> **Tracks**: Docs only (`docs/manual/*.html`, `docs/manual/assets/manual.js`, `docs/manual/index.html`, `docs/manual/assets/diagrams/*.svg`)
> **Estimated cost**: $2.00–$5.00 (12 slices, all docs/HTML, no code touched)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → Harden ✅ → Execute → Sweep → Review → Ship
> **Source**: PR #154 added 6 Markdown enterprise docs to `docs/manual/`. The rest of the manual is HTML. This phase converts them to match site convention so they appear in the manual sidebar and on planforge.software.
> **Hardener notes**: All 6 source Markdown files exist and are committed (df5ce45 on `chore/repo-cleanup`). Conversion is mechanical: read MD → write HTML matching `plan-forge-on-the-github-stack.html` template → register in `manual.js` → add cards to `index.html` → delete MD source. Two SVG diagrams needed for the reference-architecture page (the existing ASCII art).

---

## Scope Contract

### In Scope

- **6 new HTML files** in `docs/manual/`:
  - `enterprise-deployment.html` (Appendix I)
  - `github-stack-alignment.html` (Appendix J)
  - `enterprise-reference-architecture.html` (Appendix K)
  - `agent-factory-recipe.html` (Appendix L)
  - `fleet-operator-playbook.html` (Appendix M)
  - `compliance-and-data-residency.html` (Appendix N)
- **2 new SVG diagrams** in `docs/manual/assets/diagrams/`:
  - `enterprise-reference-architecture-generic.svg` (5-team / 1000-dev architecture)
  - `enterprise-reference-architecture-foundry.svg` (Microsoft Foundry composition variant)
- **Navigation registry**: `docs/manual/assets/manual.js` — add 6 new entries between current `plan-forge-on-the-github-stack` (Appendix H) and `about-author` lines, plus matching `SEARCH_SECTIONS` entries
- **Index page**: `docs/manual/index.html` — add 6 cards in the Appendices section grouped under an "🏢 Enterprise" sub-heading
- **Cleanup**: delete the 6 source `.md` files after HTML conversions verified

### Out of Scope

- Hero images for the new appendices (can be added later; Appendix H ships without one)
- New CSS rules in `manual.css` (use existing Tailwind utility classes per template)
- A new "Enterprise" group in `actLabels` (`buildSidebar()` line 105 in manual.js) — using existing "Appendix" group per simpler precedent set by Appendix H
- Updates to `docs/research/enterprise-fleet-readiness.md` cross-links (the `.md`-pointing links in §11 and §12 remain valid because the new HTML pages will be at `docs/manual/*.html` not the old `.md` paths; cross-references can be updated in a follow-on commit if desired)
- Updates to PR #154 (this phase produces a new PR; #154 stays as-is)
- Touching any chapter HTML files outside the 6 new appendices
- Site build/deploy to planforge.software (Jekyll build is a separate manual step)
- Any code in `pforge-mcp/`, `pforge-master/`, root scripts

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 fix; protected across all phases)
- **Do NOT touch** any file outside `docs/manual/` — this is a docs-only phase
- **Do NOT delete** the source `.md` files until ALL 6 HTML conversions pass their gates (Slice 11 only)
- **Do NOT introduce a new CSS file or new manual.css rules** — use existing Tailwind utilities and `.chapter-content` styles per template
- **Do NOT reorder or rename existing CHAPTERS entries** in manual.js — only insert new entries
- **Do NOT remove or alter** the `about-author` entry (must stay last in the Appendix array)
- **Do NOT add hero images** — can be added later; Appendix H ships without one

---

## Required Decisions

All resolved during hardening; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Group placement (new "Enterprise" group vs existing "Appendix") | **Existing "Appendix" group**. Matches precedent set by Appendix H (`plan-forge-on-the-github-stack`), lower friction, no `actLabels` map change needed. |
| 2 | Numbering (continue I–N, or restart with letters elsewhere) | **Continue I, J, K, L, M, N**. Current Appendix tail is H. Insert 6 new entries between H and unnumbered `about-author`. |
| 3 | File naming convention | Match Markdown source basenames: `enterprise-deployment.html`, `github-stack-alignment.html`, `enterprise-reference-architecture.html`, `agent-factory-recipe.html`, `fleet-operator-playbook.html`, `compliance-and-data-residency.html`. |
| 4 | Order within the new appendices | I = landing, J = stack alignment (companion to H), K = architecture, L = onboarding recipe, M = operations playbook, N = compliance reference. Mirrors logical reading order in the landing page. |
| 5 | SVG style | Match existing diagram conventions in `docs/manual/assets/diagrams/`: dark background, slate borders, amber accents per Tailwind `forge` theme. Use plain SVG (no JS, no animations). |
| 6 | Index page card grouping | Add a new "🏢 Enterprise" sub-heading inside the existing Appendices block. Six cards underneath, in I–N order. |
| 7 | Page metadata (title/description/og:) | Each page: `<title>Appendix [I-N]: [Page Title] — Plan Forge Manual</title>`, OG title and description matching the page lede paragraph, canonical pointing at `https://planforge.software/manual/<filename>`. |
| 8 | Cleanup of source .md files | Delete in Slice 11 only, after all 6 HTML conversions pass their gates. Single source of truth principle. |

---

## Acceptance Criteria

### Per-page HTML conversion

For each of the 6 new appendices:

- **MUST**: HTML file exists at `docs/manual/<filename>.html`
- **MUST**: First 25 lines of the file match the template skeleton from `plan-forge-on-the-github-stack.html` (DOCTYPE, html lang, head with meta charset/viewport, title with "Appendix [letter]: [title] — Plan Forge Manual" pattern, OG meta tags, canonical link, favicon, Tailwind CDN with `forge` color extension config, fonts, shared.css + manual.css)
- **MUST**: Body wrapper present: `<body class="bg-slate-950 text-slate-300 min-h-screen">` with mobile sidebar button, sidebar overlay, `.manual-layout` containing `<aside id="manual-sidebar"><nav id="sidebar-nav"></nav></aside>` and `<main><div class="chapter-content">`
- **MUST**: Page header pattern: breadcrumb `<div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Appendix [letter]</div>` followed by `<h1>` and lede `<p class="text-lg text-slate-400 mb-8">`
- **MUST**: Footer includes `<div id="chapter-prev-next"></div>` placeholder and `<script src="assets/manual.js">` tag (so prev/next chapter buttons populate at runtime)
- **MUST**: Markdown content fully translated — every section heading from the source `.md` becomes an `<h2>` or `<h3>` in HTML with appropriate `id="..."` slug for anchor linking
- **MUST**: Tables in source Markdown become HTML `<table>` elements (styled by `.chapter-content table` in manual.css; no extra classes needed)
- **MUST**: Fenced code blocks in source Markdown become `<pre><code>...</code></pre>` blocks
- **MUST**: Inline code (backticks) in source becomes `<code>...</code>` inline
- **MUST**: Bold/italic preserved as `<strong>` / `<em>`
- **MUST**: Bullet/numbered lists preserved as `<ul>`/`<ol>` with `<li>` items
- **MUST**: Internal cross-links (e.g. `[Reference Architecture](enterprise-reference-architecture.md)`) rewritten to point at `.html` extensions (`enterprise-reference-architecture.html`)
- **MUST**: Each `<h2>` and `<h3>` carries a stable `id` attribute matching the heading text in slug form (lowercase, hyphenated) so deep links work
- **SHOULD**: Long pages (`> 300` lines of HTML body) include a "When to read / when to skip" callout box at the top, matching the pattern in `plan-forge-on-the-github-stack.html:35-38`

### Reference architecture page (special — has 2 SVG diagrams)

- **MUST**: `enterprise-reference-architecture.html` references both new SVG diagrams via `<figure class="my-6"><img src="assets/diagrams/<file>.svg" ...></figure>` pattern matching existing convention
- **MUST**: SVG file `docs/manual/assets/diagrams/enterprise-reference-architecture-generic.svg` exists, valid SVG, depicts the 5-layer architecture (developer workstations → GitHub Enterprise → CI/fleet runners → observability → LLM provider) with dark background, slate borders, amber accents
- **MUST**: SVG file `docs/manual/assets/diagrams/enterprise-reference-architecture-foundry.svg` exists, valid SVG, depicts the Microsoft Foundry composition (Plan Forge → Foundry → Foundry Agent Service, with Foundry Toolbox / App Insights / Entra ID / Private VNet supporting blocks)
- **MUST**: Both SVGs render correctly when opened directly in a browser (no missing fonts, no broken paths, dimensions appropriate for inline rendering at ~800px wide)
- **MUST**: ASCII art versions in the source Markdown are removed from the HTML version (replaced by the SVG figures)

### Navigation registry — `docs/manual/assets/manual.js`

- **MUST**: 6 new entries added to the `CHAPTERS` array, positioned between current line 62 (Appendix H) and line 64 (`about-author`)
- **MUST**: Each entry follows the exact shape `{ id: "<slug>", file: "<filename>.html", num: "<letter>", title: "<title>", act: "Appendix" }`
- **MUST**: Entries are in the order I, J, K, L, M, N (matching alphabetical and logical reading order)
- **MUST**: `id` field uses kebab-case matching the file basename (e.g. `id: "enterprise-deployment"` for `enterprise-deployment.html`)
- **MUST**: 6 corresponding entries added to the `SEARCH_SECTIONS` cross-page index, each with at least 3 section anchors (h2-level) so search finds the new content
- **MUST**: `about-author` remains the last entry in the array
- **MUST**: No existing entries reordered, renamed, or removed

### Index page — `docs/manual/index.html`

- **MUST**: 6 new cards added inside the existing Appendices block
- **MUST**: Cards grouped under a new "🏢 Enterprise" sub-heading (inserted before the existing Appendix cards, or as a separate sub-block within the Appendices grid — implementer's choice based on what fits the existing layout cleanly)
- **MUST**: Each card uses the same visual pattern as existing Appendix cards (Tailwind classes, hover states, chapter number, title, brief description)
- **MUST**: Existing Appendix card for Appendix H (`plan-forge-on-the-github-stack`) preserved unchanged
- **MUST**: The "12 skills" stale-metric drift fix from PR #154 (line 191 in index.html, now reading "13 skills") is not regressed

### Cleanup (Slice 11)

- **MUST**: All 6 source Markdown files deleted via `git rm`:
  - `docs/manual/enterprise-deployment.md`
  - `docs/manual/github-stack-alignment.md`
  - `docs/manual/enterprise-reference-architecture.md`
  - `docs/manual/agent-factory-recipe.md`
  - `docs/manual/fleet-operator-playbook.md`
  - `docs/manual/compliance-and-data-residency.md`
- **MUST**: Deletion happens ONLY after all 6 HTML conversion gates have passed (verified by Slice 12)
- **MUST**: No other files deleted

### Final verification (Slice 12)

- **MUST**: All 6 HTML files exist and have the required template skeleton
- **MUST**: `docs/manual/assets/manual.js` parses cleanly via `node --check` (no syntax errors after the inserts)
- **MUST**: Both SVG files exist and are valid XML (parse cleanly)
- **MUST**: All 6 source `.md` files no longer exist
- **MUST**: `index.html` contains the 6 new card titles
- **MUST**: Metrics drift checker still clean (`scripts/check-metrics.ps1 -Strict` returns "[OK] No stale metric aliases found.")
- **SHOULD**: Manual link audit — every internal href in the 6 new HTML files resolves to an existing file in `docs/manual/`
- **MAY**: Capture a screenshot of one of the new pages for visual verification (e.g. open in browser and screenshot, save to `docs/manual/assets/screenshots/` for the changelog)

---

## Execution Slices

12 slices total. Slices 2–8 are independent file creations and could parallelize, but the orchestrator will run sequentially by default since each slice writes to a different file (no merge risk, but the plan keeps them sequential for clarity and easier failure isolation).

### Slice 1: Read template + reference source markdown [sequential]

**Goal**: Read-only context loading. The agent reads `plan-forge-on-the-github-stack.html` (template), `manual.js` (registry shape), `index.html` (Appendices block layout), and one or two of the source Markdown files to confirm the conversion pattern is clear.

**Files**:
- READ: `docs/manual/plan-forge-on-the-github-stack.html`
- READ: `docs/manual/assets/manual.js`
- READ: `docs/manual/index.html`
- READ: `docs/manual/enterprise-deployment.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Nothing in this slice — pure context loading. The agent confirms it has the template pattern, the registry pattern, and the Markdown source structure. No file writes.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const t=fs.readFileSync('docs/manual/plan-forge-on-the-github-stack.html','utf8');const m=fs.readFileSync('docs/manual/assets/manual.js','utf8');const i=fs.readFileSync('docs/manual/index.html','utf8');const ed=fs.readFileSync('docs/manual/enterprise-deployment.md','utf8');if(!t.includes('chapter-content'))process.exit(1);if(!m.includes('plan-forge-on-the-github-stack'))process.exit(2);if(!ed.includes('Plan Forge for Enterprise'))process.exit(3);console.log('ok')"
```

---

### Slice 2: Create Appendix I — enterprise-deployment.html [sequential]

**Goal**: Convert `enterprise-deployment.md` to `enterprise-deployment.html` matching template.

**Files**:
- WRITE: `docs/manual/enterprise-deployment.html`
- READ: `docs/manual/enterprise-deployment.md`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Create `docs/manual/enterprise-deployment.html` using the template skeleton from `plan-forge-on-the-github-stack.html`
- Set page title to "Appendix I: Plan Forge for Enterprise — Plan Forge Manual"
- Breadcrumb: "Appendix I"
- Convert Markdown content to HTML preserving all sections, tables, lists, links
- Rewrite all internal `.md` cross-links to point at `.html` (the other 5 new appendices)
- Lead with the same "TL;DR" content from the Markdown plus the structured map of where to find what

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/enterprise-deployment.html'))process.exit(1);const c=fs.readFileSync('docs/manual/enterprise-deployment.html','utf8');if(!c.includes('Appendix I'))process.exit(2);if(!c.includes('chapter-content'))process.exit(3);if(!c.includes('plan-forge-on-the-github-stack'))process.exit(4);if(c.includes('.md\"') && c.includes('href'))process.exit(5);console.log('ok')"
```

---

### Slice 3: Create Appendix J — github-stack-alignment.html [sequential]

**Goal**: Convert `github-stack-alignment.md` to `github-stack-alignment.html`. Companion to Appendix H.

**Files**:
- WRITE: `docs/manual/github-stack-alignment.html`
- READ: `docs/manual/github-stack-alignment.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Same conversion pattern as Slice 2. Title "Appendix J: GitHub Stack Alignment — Plan Forge Manual". Cross-link to Appendix H (`plan-forge-on-the-github-stack.html`) where the source mentions the existing GitHub stack page.

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/github-stack-alignment.html'))process.exit(1);const c=fs.readFileSync('docs/manual/github-stack-alignment.html','utf8');if(!c.includes('Appendix J'))process.exit(2);if(!c.includes('chapter-content'))process.exit(3);console.log('ok')"
```

---

### Slice 4: Create SVG diagrams for reference architecture [sequential]

**Goal**: Author 2 SVG diagrams referenced by Appendix K.

**Files**:
- WRITE: `docs/manual/assets/diagrams/enterprise-reference-architecture-generic.svg`
- WRITE: `docs/manual/assets/diagrams/enterprise-reference-architecture-foundry.svg`
- READ: `docs/manual/enterprise-reference-architecture.md` (for the ASCII art that informs each diagram)

**Context Files**:
- (No instruction files — pure asset creation)

**What changes**:
- Create SVG `enterprise-reference-architecture-generic.svg`: 5-layer architecture (Customer Network Boundary outer box → Developer Workstations → GitHub Enterprise → CI/Fleet Execution → Observability → LLM Provider). Dark background `#0f172a`, slate borders `#334155`, amber accents `#f59e0b` for the Plan Forge highlight. Width ~900px, height ~600px. Plain SVG, no embedded JS.
- Create SVG `enterprise-reference-architecture-foundry.svg`: Microsoft Foundry composition (Customer Azure Tenant outer box, Plan Forge → Microsoft Foundry → Foundry Agent Service top row with arrows showing relationships, Foundry Toolbox below as shared MCP endpoint, App Insights / Entra ID / Private VNet bottom row). Same color palette and dimensions.
- Both diagrams use legible inline text (no external font dependencies — use `font-family="system-ui, -apple-system, sans-serif"` in SVG)

**Validation Gate**:
```bash
node -e "const fs=require('fs');const a='docs/manual/assets/diagrams/enterprise-reference-architecture-generic.svg';const b='docs/manual/assets/diagrams/enterprise-reference-architecture-foundry.svg';if(!fs.existsSync(a))process.exit(1);if(!fs.existsSync(b))process.exit(2);const sa=fs.readFileSync(a,'utf8');const sb=fs.readFileSync(b,'utf8');if(!sa.includes('<svg') || !sa.includes('</svg>'))process.exit(3);if(!sb.includes('<svg') || !sb.includes('</svg>'))process.exit(4);if(!sa.includes('Plan Forge') || !sb.includes('Foundry'))process.exit(5);console.log('ok')"
```

---

### Slice 5: Create Appendix K — enterprise-reference-architecture.html [sequential]

**Goal**: Convert `enterprise-reference-architecture.md` to HTML, embedding the 2 SVG diagrams from Slice 4 instead of the ASCII art.

**Files**:
- WRITE: `docs/manual/enterprise-reference-architecture.html`
- READ: `docs/manual/enterprise-reference-architecture.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Standard conversion with one twist — replace the two ASCII-art diagrams in the source with `<figure>` blocks pointing at the SVGs from Slice 4. Each `<figure>` includes a `<figcaption>` describing the diagram.

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/enterprise-reference-architecture.html'))process.exit(1);const c=fs.readFileSync('docs/manual/enterprise-reference-architecture.html','utf8');if(!c.includes('Appendix K'))process.exit(2);if(!c.includes('enterprise-reference-architecture-generic.svg'))process.exit(3);if(!c.includes('enterprise-reference-architecture-foundry.svg'))process.exit(4);console.log('ok')"
```

---

### Slice 6: Create Appendix L — agent-factory-recipe.html [sequential]

**Goal**: Convert `agent-factory-recipe.md` to HTML.

**Files**:
- WRITE: `docs/manual/agent-factory-recipe.html`
- READ: `docs/manual/agent-factory-recipe.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Standard conversion. Title "Appendix L: Agent Factory Recipe — Plan Forge Manual". The 7-step recipe is the structural backbone; preserve numbered list ordering and the per-step substructure. Code-fenced JSON examples (e.g. `.vscode/mcp.json` snippets) become `<pre><code>` blocks.

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/agent-factory-recipe.html'))process.exit(1);const c=fs.readFileSync('docs/manual/agent-factory-recipe.html','utf8');if(!c.includes('Appendix L'))process.exit(2);if(!c.includes('Agent Factory'))process.exit(3);console.log('ok')"
```

---

### Slice 7: Create Appendix M — fleet-operator-playbook.html [sequential]

**Goal**: Convert `fleet-operator-playbook.md` to HTML.

**Files**:
- WRITE: `docs/manual/fleet-operator-playbook.html`
- READ: `docs/manual/fleet-operator-playbook.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Standard conversion. Title "Appendix M: Fleet Operator Playbook — Plan Forge Manual". The Day 1 / Week 4 / Week 12 calendar uses tables — preserve those. Anchor IDs on each phase heading so the landing page can deep-link to specific sections.

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/fleet-operator-playbook.html'))process.exit(1);const c=fs.readFileSync('docs/manual/fleet-operator-playbook.html','utf8');if(!c.includes('Appendix M'))process.exit(2);if(!c.includes('Fleet Operator'))process.exit(3);console.log('ok')"
```

---

### Slice 8: Create Appendix N — compliance-and-data-residency.html [sequential]

**Goal**: Convert `compliance-and-data-residency.md` to HTML.

**Files**:
- WRITE: `docs/manual/compliance-and-data-residency.html`
- READ: `docs/manual/compliance-and-data-residency.md`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/security.instructions.md`

**What changes**: Standard conversion. Title "Appendix N: Compliance and Data Residency — Plan Forge Manual". Q&A section at the end uses `<dl>`/`<dt>`/`<dd>` or `<details>`/`<summary>` — implementer's choice; both render cleanly with `.chapter-content` styles.

**Validation Gate**:
```bash
node -e "const fs=require('fs');if(!fs.existsSync('docs/manual/compliance-and-data-residency.html'))process.exit(1);const c=fs.readFileSync('docs/manual/compliance-and-data-residency.html','utf8');if(!c.includes('Appendix N'))process.exit(2);if(!c.includes('Compliance'))process.exit(3);if(!c.includes('air-gapped') && !c.includes('Air-Gapped'))process.exit(4);console.log('ok')"
```

---

### Slice 9: Update navigation registry — manual.js [sequential]

**Goal**: Insert 6 new entries into `CHAPTERS` array and add matching `SEARCH_SECTIONS` entries.

**Files**:
- EDIT: `docs/manual/assets/manual.js`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert 6 new lines between current Appendix H entry and `about-author` entry, in the format:
  ```js
  { id: "enterprise-deployment",            file: "enterprise-deployment.html",            num: "I", title: "Plan Forge for Enterprise",       act: "Appendix" },
  { id: "github-stack-alignment",           file: "github-stack-alignment.html",           num: "J", title: "GitHub Stack Alignment",          act: "Appendix" },
  { id: "enterprise-reference-architecture", file: "enterprise-reference-architecture.html", num: "K", title: "Enterprise Reference Architecture", act: "Appendix" },
  { id: "agent-factory-recipe",             file: "agent-factory-recipe.html",             num: "L", title: "Agent Factory Recipe",           act: "Appendix" },
  { id: "fleet-operator-playbook",          file: "fleet-operator-playbook.html",          num: "M", title: "Fleet Operator Playbook",        act: "Appendix" },
  { id: "compliance-and-data-residency",    file: "compliance-and-data-residency.html",    num: "N", title: "Compliance & Data Residency",    act: "Appendix" },
  ```
- Add 6 corresponding entries to `SEARCH_SECTIONS` (appending to the existing array around line 200–360); each entry needs at least 3 section anchors per page

**Validation Gate**:
```bash
node --check docs/manual/assets/manual.js
node -e "const fs=require('fs');const m=fs.readFileSync('docs/manual/assets/manual.js','utf8');for(const id of ['enterprise-deployment','github-stack-alignment','enterprise-reference-architecture','agent-factory-recipe','fleet-operator-playbook','compliance-and-data-residency']){if(!m.includes(id))process.exit(1);}for(const num of ['\"I\"','\"J\"','\"K\"','\"L\"','\"M\"','\"N\"']){if(!m.includes(num))process.exit(2);}if(!m.match(/about-author[\s\S]*\];/))process.exit(3);console.log('ok')"
```

---

### Slice 10: Update index page — index.html [sequential]

**Goal**: Add 6 new cards to the Appendices block of `docs/manual/index.html`.

**Files**:
- EDIT: `docs/manual/index.html`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Locate the existing Appendices grid in `index.html`
- Add 6 new cards in I–N order, ideally grouped under a "🏢 Enterprise" sub-heading inside the Appendices block (or as a clearly-labeled sub-grid)
- Each card matches existing Appendix card visual pattern (Tailwind classes, hover states, "Appendix [letter]" label, title link, brief description)
- Existing Appendix H card preserved unchanged
- The "13 skills" string from PR #154's metrics fix is preserved

**Validation Gate**:
```bash
node -e "const fs=require('fs');const i=fs.readFileSync('docs/manual/index.html','utf8');for(const f of ['enterprise-deployment.html','github-stack-alignment.html','enterprise-reference-architecture.html','agent-factory-recipe.html','fleet-operator-playbook.html','compliance-and-data-residency.html']){if(!i.includes(f))process.exit(1);}if(!i.includes('Appendix I') || !i.includes('Appendix N'))process.exit(2);if(!i.includes('13 skills'))process.exit(3);console.log('ok')"
```

---

### Slice 11: Delete source Markdown files [sequential]

**Goal**: Remove the 6 source `.md` files now that the HTML versions are the canonical surface. Single source of truth.

**Files**:
- DELETE: `docs/manual/enterprise-deployment.md`
- DELETE: `docs/manual/github-stack-alignment.md`
- DELETE: `docs/manual/enterprise-reference-architecture.md`
- DELETE: `docs/manual/agent-factory-recipe.md`
- DELETE: `docs/manual/fleet-operator-playbook.md`
- DELETE: `docs/manual/compliance-and-data-residency.md`

**Depends On**: Slices 2, 3, 5, 6, 7, 8 (all 6 HTML files must exist and pass their gates first)

**Context Files**: (none — mechanical deletion)

**What changes**: Run `git rm` on each file. No other deletions.

**Validation Gate**:
```bash
node -e "const fs=require('fs');for(const f of ['enterprise-deployment.md','github-stack-alignment.md','enterprise-reference-architecture.md','agent-factory-recipe.md','fleet-operator-playbook.md','compliance-and-data-residency.md']){if(fs.existsSync('docs/manual/'+f))process.exit(1);}console.log('ok')"
```

---

### Slice 12: Final verification + metrics check [sequential]

**Goal**: End-to-end verification that everything is consistent.

**Files**:
- READ-ONLY: All files modified by previous slices

**Depends On**: All prior slices

**Context Files**: (none — pure verification)

**What changes**: Nothing — verification only. Runs the metrics drift checker, the manual.js syntax check, and confirms file existence/non-existence per the Cleanup criteria.

**Validation Gate**:
```bash
node --check docs/manual/assets/manual.js
node -e "const fs=require('fs');const html=['enterprise-deployment.html','github-stack-alignment.html','enterprise-reference-architecture.html','agent-factory-recipe.html','fleet-operator-playbook.html','compliance-and-data-residency.html'];for(const f of html){if(!fs.existsSync('docs/manual/'+f))process.exit(1);}const md=['enterprise-deployment.md','github-stack-alignment.md','enterprise-reference-architecture.md','agent-factory-recipe.md','fleet-operator-playbook.md','compliance-and-data-residency.md'];for(const f of md){if(fs.existsSync('docs/manual/'+f))process.exit(2);}if(!fs.existsSync('docs/manual/assets/diagrams/enterprise-reference-architecture-generic.svg'))process.exit(3);if(!fs.existsSync('docs/manual/assets/diagrams/enterprise-reference-architecture-foundry.svg'))process.exit(4);console.log('ok')"
pwsh -NoProfile -File scripts/check-metrics.ps1 -Strict
```

---

## Re-anchor Checkpoints

- **After Slice 4 (SVGs)**: Open both SVGs in a browser tab and visually confirm they render. The orchestrator can't verify visual quality, but the agent can confirm the XML is valid and dimensions are reasonable.
- **After Slice 9 (manual.js update)**: Open `docs/manual/index.html` in a browser and confirm the sidebar populates with the 6 new entries. Click one — should navigate cleanly.
- **After Slice 11 (cleanup)**: Run `git status` and confirm only files in the Scope Contract are modified (no surprise edits to other manual chapters or to `pforge-mcp/`).

---

## Definition of Done

- [ ] All 12 Execution Slices passed their validation gates
- [ ] All MUST acceptance criteria satisfied
- [ ] 6 new HTML files exist in `docs/manual/`
- [ ] 2 new SVG diagrams exist in `docs/manual/assets/diagrams/`
- [ ] `docs/manual/assets/manual.js` parses cleanly via `node --check` and contains all 6 new chapter entries
- [ ] `docs/manual/index.html` contains 6 new cards
- [ ] All 6 source `.md` files no longer exist
- [ ] `scripts/check-metrics.ps1 -Strict` returns "[OK] No stale metric aliases found."
- [ ] `git diff --stat` shows changes only inside `docs/manual/`
- [ ] No file in `pforge-mcp/`, `pforge-master/`, or root scripts modified
- [ ] `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` byte-identical to pre-execution (verify with `git diff pforge-mcp/cost-service.mjs` returning empty)
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**

---

## Stop Conditions

If any of the following occurs during execution, STOP and escalate:

1. **Out-of-scope file modification** — `git diff --stat` shows changes outside `docs/manual/`. Revert and complete the slice within scope.
2. **`costForLeg()` modified** — any change appears in `pforge-mcp/cost-service.mjs`. CRITICAL: revert immediately.
3. **`about-author` entry damaged** — `manual.js` no longer ends with the `about-author` entry as the final array element.
4. **Existing chapter HTML modified** — any file other than `index.html`, `manual.js`, the 6 new appendices, or the 2 new SVGs shows in `git diff`.
5. **Metrics drift checker fails** — `scripts/check-metrics.ps1 -Strict` reports stale aliases that weren't there before. The 6 new appendices must not introduce new drift.
6. **Source Markdown deleted before HTML conversion verified** — Slice 11 only fires after Slices 2, 3, 5, 6, 7, 8 all pass.
7. **manual.js becomes invalid JavaScript** — `node --check` fails after Slice 9 edit.

---

## Reference: Source provenance

- 6 source Markdown files committed in PR #154 commit `df5ce45` on `chore/repo-cleanup` branch
- Template reference: `docs/manual/plan-forge-on-the-github-stack.html` (Appendix H, the most recent appendix and direct precedent for "deployment-stack alignment" content)
- Navigation registry: `docs/manual/assets/manual.js:7-65` (CHAPTERS array), `:200-360` (SEARCH_SECTIONS)
- Diagram convention: `docs/manual/assets/diagrams/*.svg` — hand-authored, dark background, slate borders, amber accents

---

## Plan Quality Self-Check

1. ✅ Every Execution Slice has at least one validation gate with an exact command
2. ✅ All slices are sequential (no parallel-safe tags) — file creation is naturally serializable, simpler than coordinating parallelism for a 12-slice docs phase
3. ✅ All REQUIRED DECISIONS resolved (8 rows, no TBD)
4. ✅ Definition of Done includes "Reviewer Gate passed (zero 🔴 Critical)"
5. ✅ Stop Conditions cover: scope violation (#1, #4), costForLeg integrity (#2), structural integrity (#3, #7), pre-existing CI gate (#5), dependency ordering (#6)
6. ✅ Each slice lists only relevant instruction files
7. ✅ Every MUST acceptance criterion is traceable to at least one slice
8. ✅ Validation gates pass Gate Portability Rules: all use `node -e` for filesystem checks, `node --check` for JS validation, `pwsh -NoProfile` for the existing check-metrics script

---

## Session Budget Check

- 12 slices total, sized at 5–25 minutes each (HTML conversion + small JS/HTML edits)
- No single slice has more than 4 Context Files
- Total estimated wall-clock: 60–120 minutes
- No recommended session break — entire phase fits in one session

**Plan hardened ✅ — proceed to Step 3 (Execute Slices)**
