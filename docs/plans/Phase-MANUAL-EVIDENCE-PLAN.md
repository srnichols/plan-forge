# Phase-MANUAL-EVIDENCE: Add business-case evidence, problem narrative, session-isolation psychology, version timeline, and lessons-learned to the manual

> **Status**: Hardened, ready for execution
> **Tracks**: Docs only (`docs/manual/*.html`, `docs/manual/assets/manual.js`, `docs/manual/assets/diagrams/*.svg`)
> **Estimated cost**: $4.00–$8.00 (8 slices, all docs/HTML, no code touched)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → Harden ✅ → Execute → Sweep → Review → Ship
> **Source**: Blog vs Manual content audit (May 6 2026). Identified 5 narrative + business-case gaps where the manual is feature-focused but blog posts contain quantified evidence and psychological insights that should anchor the manual chapters. This is the FIRST of 3 follow-on phases (EVIDENCE → DISCOVERY-LOOP → INTEGRATIONS).
> **Hardener notes**: All source content lives in `docs/blog/*.html` (already in repo). All numeric claims verified against the blog posts. New SVGs follow the convention established by `quorum-complexity-rubric.svg` and `quorum-estimate-tool-flow.svg` (added in commit 951f005). No code in `pforge-mcp/` is touched.

---

## Scope Contract

### In Scope

- **2 new SVG diagrams** in `docs/manual/assets/diagrams/`:
  - `evidence-ab-test-bars.svg` — head-to-head bar chart (60 vs 13 tests, 6 vs 0 interfaces, 9 vs 0 DTOs, 79 vs 0 CancellationToken refs, 4 vs 0 typed exceptions, 99 vs 44 quality score)
  - `evolution-timeline.svg` — version timeline v1.0 → v2.0 → v2.5 → v2.10 → v2.14 → v2.18 → v2.83 with inflection points
- **1 expanded chapter**: [docs/manual/what-is-plan-forge.html](docs/manual/what-is-plan-forge.html) gains TWO new sections:
  - "The 80/20 Wall: The Problem Plan Forge Solves" (after the existing intro, before the existing comparison table)
  - "Evidence: A/B Test Results" (new H2 near end of chapter, before the FAQ-style closer if any)
- **1 expanded chapter**: [docs/manual/how-it-works.html](docs/manual/how-it-works.html) gains ONE new section:
  - "Why Session Isolation Works" (new H2 placed after the existing 4-session model description, before the next architectural section)
- **2 new chapters** (registered in TOC):
  - `docs/manual/lessons-learned.html` — adapted from `docs/blog/guardrails-lessons-learned.html`. The seven hard-won lessons reframed as manual-grade reference (no marketing voice, no first-person), with cross-links to the relevant existing chapters (Architecture Principles, Crucible, Forbidden Actions).
  - `docs/manual/project-history.html` — version evolution narrative adapted from `docs/blog/the-journey-from-impossible-to-seven-minutes.html`, anchored by the new `evolution-timeline.svg`.
- **Navigation registry**: `docs/manual/assets/manual.js` — register the 2 new chapters with `act: "Appendix"` (matching the precedent set by Phase-ENTERPRISE-DOCS-HTML for non-numbered reference material), plus add ~6 search-section anchors per new chapter and ~4 anchors for the new sections inside `what-is-plan-forge.html` and `how-it-works.html`.

### Out of Scope

- Hero images for the 2 new chapters (can ship without; matches Appendix H precedent)
- New CSS rules in `manual.css` — use existing Tailwind utilities and `.chapter-content` styles
- Touching any other manual chapter beyond `what-is-plan-forge.html`, `how-it-works.html`, and the 2 new chapter files
- Modifying any blog post under `docs/blog/`
- Modifying `docs/manual/index.html` Appendices grid (next phase will batch all 3 phases' new appendix cards together)
- Any code in `pforge-mcp/`, `pforge-master/`, root scripts, or `.github/`
- The other 2 follow-on phases (DISCOVERY-LOOP, INTEGRATIONS) — separate plan files
- New `applyTo` instruction files
- Any tooling/build changes

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 fix; protected across all phases)
- **Do NOT touch** any file outside `docs/manual/` (and specifically only the files in scope) — this is a docs-only phase
- **Do NOT introduce a new CSS file or new manual.css rules** — use existing Tailwind utilities and `.chapter-content` styles per existing chapters
- **Do NOT reorder or rename existing CHAPTERS entries** in `manual.js` — only insert new entries
- **Do NOT remove or alter** the `about-author` entry (must stay last in the Appendix array)
- **Do NOT copy first-person voice from blogs into the manual** — blog says "I learned"; manual says "the system requires" or "experience shows". Reference voice, not memoir voice.
- **Do NOT fabricate numbers** — every numeric claim in the new sections MUST appear verbatim in `docs/blog/ab-test-plan-forge-vs-vibe-coding.html`, `docs/blog/quorum-mode-3-models.html`, `docs/blog/the-80-20-wall.html`, or `docs/blog/the-journey-from-impossible-to-seven-minutes.html`. Verify with `grep -F` before writing.
- **Do NOT add hero images** — can be added later
- **Do NOT delete the source blog HTML files** — they remain canonical marketing content; the manual chapters are reference adaptations

---

## Required Decisions

All resolved during hardening; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Where to place "80/20 Wall" content — new chapter vs section in existing chapter | **Section in `what-is-plan-forge.html`**. The 80/20 problem is the *motivation* for Plan Forge; it belongs in the introductory chapter, not as a separate one. |
| 2 | Where to place "Session Isolation Why" content | **Section in `how-it-works.html`**. The 4-session structure is already there; this section explains the *why* alongside the *what*. |
| 3 | Lessons-Learned and Project-History — chapters or appendices | **Appendices** (act: "Appendix"). They're reference material, not part of the linear learning path. |
| 4 | Numbering for the 2 new appendices | **No letters** — register with `num: ""` so the sidebar shows just the title. Precedent: `about-author` already uses no number. (Verified: `manual.js:60` and the rendered sidebar.) Alternative: continue O, P after Phase-ENTERPRISE-DOCS-HTML's I–N. **Decision: No letters.** Lessons-Learned and Project-History are conceptually different from the I–N enterprise appendix track. |
| 5 | A/B test bar chart — embed numbers from which run | The **April 11 2026 ".NET 60 vs 13" run** documented in `docs/blog/ab-test-plan-forge-vs-vibe-coding.html`. Verified numbers: tests 60/13, interfaces 6/0, DTOs 9/0, CancellationToken refs 79/0, typed exceptions 4/0, quality score 99/44, build cost $0.62. |
| 6 | Evolution timeline — which version milestones to include | v1.0 (Summer 2025, 18 instruction files + 4-session pipeline), v2.0 (Jan 2026, autonomous orchestrator + 17 MCP tools), v2.5 (Feb 2026, Quorum Mode), v2.10 (Mar 2026, OpenClaw bridge), v2.14 (Mar 2026, Copilot platform integration), v2.18 (Apr 2026, Temper Guards + Warning Signs + Context Fuel), v2.83 (May 2026, current). All anchored from the journey blog. |
| 7 | Voice for adapted blog content | Reference voice: third person, present tense, no "I/we/you decided to". Quote blog posts inline only when the original phrasing is the technical claim itself (e.g. "an order of magnitude reduction in scope drift"). |
| 8 | How to verify numeric claims | Each slice with numeric claims includes a `grep -F` line in its validation gate confirming the same number appears in the source blog HTML. |

---

## Acceptance Criteria

### Per-section / per-chapter HTML rules (apply to all new content)

- **MUST**: Markup matches the chapter template established by `plan-forge-on-the-github-stack.html` and `quorum-*` sub-sections recently added to `advanced-execution.html` — DOCTYPE, html lang, head with meta/title/OG/canonical, body wrapper with sidebar/main structure, `<div class="chapter-content">` content area, footer with `<div id="chapter-prev-next">` and `<script src="assets/manual.js">`
- **MUST**: Every `<h2>` and `<h3>` carries a stable `id` attribute in kebab-case slug form
- **MUST**: All cross-links to other manual pages use `.html` extensions and relative paths (no absolute URLs to planforge.software except for explicit external citations)
- **MUST**: All inline code uses `<code>...</code>`; all code blocks use `<pre><code>...</code></pre>`
- **MUST**: All callouts use existing Tailwind utility classes (`callout callout-info`, `callout callout-warning`, `callout callout-tip`)
- **MUST**: No first-person pronouns (I, we, my, our) appear in the new content unless inside a direct quotation from a cited blog post

### A/B test evidence section in `what-is-plan-forge.html`

- **MUST**: New `<h2 id="evidence">Evidence: A/B Test Results</h2>` exists
- **MUST**: References `evidence-ab-test-bars.svg` via `<img src="assets/diagrams/evidence-ab-test-bars.svg" alt="...">` with descriptive alt text covering all bars
- **MUST**: Includes the verified numbers (60/13 tests, 6/0 interfaces, 9/0 DTOs, 79/0 CancellationToken refs, 4/0 typed exceptions, 99/44 quality, $0.62 cost) presented as a table
- **MUST**: Links back to the source blog post: `<a href="../blog/ab-test-plan-forge-vs-vibe-coding.html" rel="noopener">Full A/B test write-up</a>`
- **MUST**: Includes a one-paragraph explanation of methodology (same model: Claude Opus 4.6; same time: ~7 minutes; same task)
- **MUST**: Includes a "What this measures" callout explaining that the differences are structural quality (interfaces, DTOs, cancellation, exception types) — not just test count

### "80/20 Wall" section in `what-is-plan-forge.html`

- **MUST**: New `<h2 id="the-eighty-twenty-wall">The 80/20 Wall — The Problem Plan Forge Solves</h2>` exists
- **MUST**: Walks through the 4 phases (0→50% greenfield rush, 50→80% complexity creeps, 80→wall every-change-breaks, 100% maybe-start-over) using a numbered list or sub-headings
- **MUST**: Includes the "architectural memory loss" explanation from the blog (agents forget *why* code was written a certain way → improve it → break every caller)
- **MUST**: Cross-links to `how-it-works.html#why-session-isolation-works` for the deeper psychological explanation
- **MUST**: Links back to the source blog: `<a href="../blog/the-80-20-wall.html" rel="noopener">Read the longer essay</a>`
- **SHOULD**: Includes a simple visual or callout summarizing the 4-phase trajectory (text-based ASCII-style timeline acceptable; no new SVG required)

### "Why Session Isolation Works" section in `how-it-works.html`

- **MUST**: New `<h2 id="why-session-isolation-works">Why Session Isolation Works</h2>` exists, placed after the existing 4-session model description
- **MUST**: Explains the three reasons isolation matters: (1) sunk-cost bias prevents builders from criticizing their own code, (2) context contamination from the build phase clouds review judgment, (3) fresh-context reviews catch blind spots
- **MUST**: Uses the blog's grading-your-own-exam analogy (cited as adapted from `docs/blog/the-80-20-wall.html` and `docs/blog/guardrails-lessons-learned.html`)
- **MUST**: Cross-links to `lessons-learned.html#independent-review` once that chapter exists
- **MUST**: References the v2.18 Temper Guards + Warning Signs as the codified version of these psychological defenses

### `lessons-learned.html` chapter

- **MUST**: File exists at `docs/manual/lessons-learned.html`
- **MUST**: Title: "Lessons Learned — Plan Forge Manual"
- **MUST**: Breadcrumb: "Reference" (or "Appendix" if simpler — implementer's choice as long as `act` matches the registry entry)
- **MUST**: Contains 7 H2 sections, one per lesson, in this order with these stable anchor IDs:
  1. `id="agents-dont-drift-maliciously"` — Agents don't drift maliciously; they drift because no rule said "stop here"
  2. `id="auto-loading-beats-manual"` — Auto-loading beats manual attachment (the 20% → 100% adoption story)
  3. `id="independent-review"` — The builder must never review its own work
  4. `id="slice-boundaries"` — Slice boundaries are the only real validation points
  5. `id="focused-instructions"` — Focused instruction files beat one giant guardrails document
  6. `id="tech-stack-presets"` — Stack presets are not optional (PascalCase in Python anti-example)
  7. `id="enterprise-quality-default"` — Enterprise-grade quality must be the default, not an upgrade
- **MUST**: Each lesson section includes: (a) the principle in 1–2 sentences, (b) the failure mode it addresses, (c) cross-link to the manual chapter where the principle is enforced (e.g. Lesson 1 → `customization.html#forbidden-actions`)
- **MUST**: Quotes the blog's "an order of magnitude" claim verbatim and cites it
- **MUST**: Links back to source blog at chapter top: `<a href="../blog/guardrails-lessons-learned.html" rel="noopener">Original blog post</a>`

### `project-history.html` chapter

- **MUST**: File exists at `docs/manual/project-history.html`
- **MUST**: Title: "Project History — Plan Forge Manual"
- **MUST**: References `evolution-timeline.svg` near the top via `<img src="assets/diagrams/evolution-timeline.svg" alt="...">` with alt text listing all 7 milestones
- **MUST**: Contains 7 H2 sections, one per milestone, in chronological order with stable anchor IDs:
  1. `id="v1-0-foundation"` — v1.0 (Summer 2025): 18 instruction files, 4-session pipeline
  2. `id="v2-0-autonomous"` — v2.0 (January 2026): autonomous orchestrator, DAG-based execution, 17 MCP tools
  3. `id="v2-5-quorum"` — v2.5 (February 2026): Quorum Mode
  4. `id="v2-10-openclaw"` — v2.10 (March 2026): OpenClaw bridge
  5. `id="v2-14-copilot"` — v2.14 (March 2026): Copilot platform integration
  6. `id="v2-18-temper-guards"` — v2.18 (April 2026): Temper Guards, Warning Signs, Context Fuel
  7. `id="v2-83-current"` — v2.83 (May 2026): host-aware routing, quorum estimator, complexity rubric (current)
- **MUST**: Each milestone section explains the inflection point (what problem it solved, not just what shipped)
- **MUST**: Links back to source blog at chapter top: `<a href="../blog/the-journey-from-impossible-to-seven-minutes.html" rel="noopener">Original blog post</a>`

### `evidence-ab-test-bars.svg`

- **MUST**: File exists at `docs/manual/assets/diagrams/evidence-ab-test-bars.svg`
- **MUST**: Valid SVG (parses cleanly via `node -e "require('fs').readFileSync('...')"` and contains `<svg` + `</svg>`)
- **MUST**: ViewBox dimensions 800×400 or larger so it renders legibly inline
- **MUST**: Shows 6 paired bars (vibe vs forge) for: Tests, Interfaces, DTOs, CancellationToken refs, Typed Exceptions, Quality Score
- **MUST**: Vibe bars use red/amber color (`#ef4444` or `#f87171`); Forge bars use emerald/green (`#10b981` or `#34d399`)
- **MUST**: Numeric labels on each bar (e.g. "60", "13", "99", "44")
- **MUST**: Title text element near top (e.g. "Same task, same model, same time — Plan Forge vs vibe coding")
- **MUST**: Includes `<title>` and `<desc>` elements for accessibility (matching the convention in `quorum-complexity-rubric.svg`)
- **MUST**: No external font dependencies beyond `'Inter', sans-serif` (matches existing diagrams)

### `evolution-timeline.svg`

- **MUST**: File exists at `docs/manual/assets/diagrams/evolution-timeline.svg`
- **MUST**: Valid SVG with `<title>` and `<desc>` elements
- **MUST**: ViewBox dimensions appropriate for a horizontal timeline (e.g. 1000×320)
- **MUST**: 7 milestone markers along a horizontal axis: v1.0, v2.0, v2.5, v2.10, v2.14, v2.18, v2.83
- **MUST**: Each marker labeled with version + date + 2–4 word feature summary
- **MUST**: Color palette matches existing diagrams: dark background `#0f172a` or transparent, slate borders `#334155`, amber highlight `#f59e0b` for the most recent milestone
- **MUST**: Inline text uses `'Inter', sans-serif` (no external fonts)

### Navigation registry — `docs/manual/assets/manual.js`

- **MUST**: 2 new entries added to the `CHAPTERS` array:
  ```js
  { id: "lessons-learned",  file: "lessons-learned.html",  num: "", title: "Lessons Learned",  act: "Appendix" },
  { id: "project-history",  file: "project-history.html",  num: "", title: "Project History",  act: "Appendix" },
  ```
- **MUST**: Both entries placed BEFORE the `about-author` entry (which must remain last in the array)
- **MUST**: 2 new entries added to `SEARCH_SECTIONS`, each with at least 4 anchors corresponding to H2 sections in the new chapters
- **MUST**: Anchors for the new sections in `what-is-plan-forge.html` (`#evidence`, `#the-eighty-twenty-wall`) and `how-it-works.html` (`#why-session-isolation-works`) added to the existing search entries for those chapters
- **MUST**: `node --check docs/manual/assets/manual.js` passes
- **MUST**: No existing CHAPTERS or SEARCH_SECTIONS entries reordered, renamed, or removed

---

## Execution Slices

8 slices total. Slices 2 and 3 (the two SVGs) are independent and could parallelize but the plan keeps them sequential for failure isolation. Slices 4 and 5 (the two new chapters) depend on Slices 2 and 3 respectively.

### Slice 1: Read source blogs + template + verify numbers [sequential]

**Goal**: Read-only context loading. Confirm every numeric claim in the audit appears verbatim in the source blog HTML files.

**Files**:
- READ: `docs/blog/ab-test-plan-forge-vs-vibe-coding.html`
- READ: `docs/blog/the-80-20-wall.html`
- READ: `docs/blog/guardrails-lessons-learned.html`
- READ: `docs/blog/the-journey-from-impossible-to-seven-minutes.html`
- READ: `docs/blog/quorum-mode-3-models.html`
- READ: `docs/manual/what-is-plan-forge.html`
- READ: `docs/manual/how-it-works.html`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)
- READ: `docs/manual/assets/manual.js`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/context-fuel.instructions.md`

**What changes**: Nothing. Pure context loading.

**Validation Gate**:
```bash
grep -F "60" docs/blog/ab-test-plan-forge-vs-vibe-coding.html >/dev/null
grep -F "99" docs/blog/ab-test-plan-forge-vs-vibe-coding.html >/dev/null
grep -F "44" docs/blog/ab-test-plan-forge-vs-vibe-coding.html >/dev/null
grep -F "0.62" docs/blog/ab-test-plan-forge-vs-vibe-coding.html >/dev/null
grep -F "an order of magnitude" docs/blog/guardrails-lessons-learned.html >/dev/null
grep -F "v1.0" docs/blog/the-journey-from-impossible-to-seven-minutes.html >/dev/null
grep -F "v2.18" docs/blog/the-journey-from-impossible-to-seven-minutes.html >/dev/null
echo ok
```

---

### Slice 2: Create `evidence-ab-test-bars.svg` [sequential]

**Goal**: Author the 6-pair head-to-head bar chart SVG.

**Files**:
- WRITE: `docs/manual/assets/diagrams/evidence-ab-test-bars.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)
- READ: `docs/blog/ab-test-plan-forge-vs-vibe-coding.html` (number source)

**Context Files**: (none — pure asset creation)

**What changes**: Create the SVG following the conventions established by `quorum-complexity-rubric.svg`:
- Dark background or transparent
- 6 paired bars with vibe (red `#ef4444`) on left, forge (emerald `#10b981`) on right of each pair
- Numeric label on top of each bar
- Category labels below each pair (Tests, Interfaces, DTOs, CancellationToken, Typed Exceptions, Quality Score)
- Title element at top, legend at top-right
- `<title>` and `<desc>` for accessibility

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/evidence-ab-test-bars.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);if(!s.includes('<title'))process.exit(4);if(!s.includes('<desc'))process.exit(5);for(const n of ['60','13','99','44','79']){if(!s.includes(n))process.exit(10);}console.log('ok')"
```

---

### Slice 3: Create `evolution-timeline.svg` [sequential]

**Goal**: Author the horizontal version-timeline SVG with 7 milestones.

**Files**:
- WRITE: `docs/manual/assets/diagrams/evolution-timeline.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)
- READ: `docs/blog/the-journey-from-impossible-to-seven-minutes.html` (milestone source)

**Context Files**: (none — pure asset creation)

**What changes**: Create the SVG with 7 horizontal milestone markers (v1.0 → v2.83), each with version label, date label, and 2–4 word feature summary. Amber highlight on the most recent milestone (v2.83). Connecting line in slate `#334155`.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/evolution-timeline.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);if(!s.includes('<title'))process.exit(4);for(const v of ['v1.0','v2.0','v2.5','v2.10','v2.14','v2.18','v2.83']){if(!s.includes(v))process.exit(10);}console.log('ok')"
```

---

### Slice 4: Create `lessons-learned.html` [sequential]

**Goal**: New chapter file with 7 lesson sections adapted from the guardrails blog.

**Files**:
- WRITE: `docs/manual/lessons-learned.html`
- READ: `docs/blog/guardrails-lessons-learned.html`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Create the chapter using the template skeleton. 7 H2 sections with the IDs specified in Acceptance Criteria. Reference voice (no first-person). Each section: principle (1–2 sentences), failure mode it addresses, cross-link to enforcing chapter. Quote "an order of magnitude" verbatim and cite the blog. Link back to source blog at top.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/lessons-learned.html';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('chapter-content'))process.exit(2);if(!c.includes('Lessons Learned'))process.exit(3);for(const id of ['agents-dont-drift-maliciously','auto-loading-beats-manual','independent-review','slice-boundaries','focused-instructions','tech-stack-presets','enterprise-quality-default']){if(!c.includes('id=\"'+id+'\"'))process.exit(10);}if(!c.includes('an order of magnitude'))process.exit(20);if(!c.includes('guardrails-lessons-learned.html'))process.exit(21);console.log('ok')"
```

---

### Slice 5: Create `project-history.html` [sequential]

**Goal**: New chapter with 7 milestone sections + embedded timeline SVG.

**Files**:
- WRITE: `docs/manual/project-history.html`
- READ: `docs/blog/the-journey-from-impossible-to-seven-minutes.html`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)
- READ: `docs/manual/assets/diagrams/evolution-timeline.svg` (verify exists)

**Depends On**: Slice 3

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Create the chapter using the template skeleton. Embed `evolution-timeline.svg` near the top. 7 H2 sections with the IDs specified in Acceptance Criteria. Each section explains the inflection point (problem solved), not just feature list. Link back to source blog at top.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/project-history.html';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('Project History'))process.exit(2);if(!c.includes('evolution-timeline.svg'))process.exit(3);for(const id of ['v1-0-foundation','v2-0-autonomous','v2-5-quorum','v2-10-openclaw','v2-14-copilot','v2-18-temper-guards','v2-83-current']){if(!c.includes('id=\"'+id+'\"'))process.exit(10);}if(!c.includes('the-journey-from-impossible-to-seven-minutes.html'))process.exit(20);console.log('ok')"
```

---

### Slice 6: Expand `what-is-plan-forge.html` with 80/20 wall + Evidence sections [sequential]

**Goal**: Add 2 new H2 sections to the existing intro chapter.

**Files**:
- EDIT: `docs/manual/what-is-plan-forge.html`
- READ: `docs/blog/the-80-20-wall.html`
- READ: `docs/blog/ab-test-plan-forge-vs-vibe-coding.html`
- READ: `docs/manual/assets/diagrams/evidence-ab-test-bars.svg` (verify exists)

**Depends On**: Slice 2

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert new `<h2 id="the-eighty-twenty-wall">The 80/20 Wall — The Problem Plan Forge Solves</h2>` section after the chapter intro. Walk through 0→50%, 50→80%, 80→wall, 100% phases. Include architectural memory loss explanation. Cross-link to `how-it-works.html#why-session-isolation-works`. Cite blog.
- Insert new `<h2 id="evidence">Evidence: A/B Test Results</h2>` section before the chapter footer. Embed `evidence-ab-test-bars.svg`. Include the 6-row data table. Methodology paragraph. "What this measures" callout. Cite blog.
- Preserve all existing content unchanged.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/what-is-plan-forge.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"the-eighty-twenty-wall\"'))process.exit(1);if(!c.includes('id=\"evidence\"'))process.exit(2);if(!c.includes('evidence-ab-test-bars.svg'))process.exit(3);if(!c.includes('the-80-20-wall.html'))process.exit(4);if(!c.includes('ab-test-plan-forge-vs-vibe-coding.html'))process.exit(5);for(const n of ['60','13','99','44']){if(!c.includes('>'+n+'<') && !c.includes(' '+n+' '))process.exit(10);}console.log('ok')"
```

---

### Slice 7: Expand `how-it-works.html` with Why Session Isolation Works section [sequential]

**Goal**: Add 1 new H2 section to the existing chapter.

**Files**:
- EDIT: `docs/manual/how-it-works.html`
- READ: `docs/blog/the-80-20-wall.html`
- READ: `docs/blog/guardrails-lessons-learned.html`

**Depends On**: Slice 4 (so the cross-link target exists)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert new `<h2 id="why-session-isolation-works">Why Session Isolation Works</h2>` section after the existing 4-session model description (find the existing H2 about sessions and place this immediately after it).
- Three reasons: sunk-cost bias, context contamination, fresh-context blind-spot detection.
- Use the grading-your-own-exam analogy.
- Cross-link to `lessons-learned.html#independent-review`.
- Reference v2.18 Temper Guards + Warning Signs.
- Preserve all existing content unchanged.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/how-it-works.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"why-session-isolation-works\"'))process.exit(1);if(!c.includes('lessons-learned.html#independent-review'))process.exit(2);if(!c.includes('Temper Guard') && !c.includes('temper guard'))process.exit(3);if(!c.includes('sunk-cost') && !c.includes('sunk cost'))process.exit(4);console.log('ok')"
```

---

### Slice 8: Update navigation registry + final verification [sequential]

**Goal**: Register the 2 new chapters and section anchors in `manual.js`, then verify everything is consistent.

**Files**:
- EDIT: `docs/manual/assets/manual.js`

**Depends On**: All prior slices

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert 2 new CHAPTERS entries before the `about-author` entry:
  ```js
  { id: "lessons-learned",  file: "lessons-learned.html",  num: "", title: "Lessons Learned",  act: "Appendix" },
  { id: "project-history",  file: "project-history.html",  num: "", title: "Project History",  act: "Appendix" },
  ```
- Add 2 new SEARCH_SECTIONS entries (one per new chapter) with at least 4 anchor entries each
- Append to the `what-is-plan-forge.html` section in SEARCH_SECTIONS: `{ t: "The 80/20 Wall", u: "what-is-plan-forge.html#the-eighty-twenty-wall" }` and `{ t: "Evidence A/B Test Results", u: "what-is-plan-forge.html#evidence" }`
- Append to the `how-it-works.html` section in SEARCH_SECTIONS: `{ t: "Why Session Isolation Works", u: "how-it-works.html#why-session-isolation-works" }`

**Validation Gate**:
```bash
node --check docs/manual/assets/manual.js
node -e "const fs=require('fs');const m=fs.readFileSync('docs/manual/assets/manual.js','utf8');for(const id of ['lessons-learned','project-history']){if(!m.includes('id: \"'+id+'\"') && !m.includes('id:\"'+id+'\"'))process.exit(1);}for(const a of ['the-eighty-twenty-wall','why-session-isolation-works','#evidence']){if(!m.includes(a))process.exit(2);}if(!m.match(/about-author[\s\S]*\];/))process.exit(3);console.log('ok')"
test -f docs/manual/lessons-learned.html
test -f docs/manual/project-history.html
test -f docs/manual/assets/diagrams/evidence-ab-test-bars.svg
test -f docs/manual/assets/diagrams/evolution-timeline.svg
echo ok
```

---

## Re-anchor Checkpoints

- **After Slice 2 (A/B bars SVG)**: Open the SVG in a browser tab and visually confirm bars are paired correctly, colors are right, numbers are legible.
- **After Slice 3 (timeline SVG)**: Open the SVG and confirm 7 milestones are evenly spaced, dates and labels readable.
- **After Slice 6 (what-is-plan-forge edits)**: Open the chapter in browser and confirm both new sections render correctly with embedded SVG.
- **After Slice 8 (registry update)**: Open `docs/manual/index.html` and confirm sidebar has Lessons Learned + Project History entries; click each to confirm navigation.

---

## Definition of Done

- [ ] All 8 Execution Slices passed their validation gates
- [ ] All MUST acceptance criteria satisfied
- [ ] 2 new HTML chapters exist in `docs/manual/`
- [ ] 2 new SVG diagrams exist in `docs/manual/assets/diagrams/`
- [ ] `docs/manual/what-is-plan-forge.html` contains both new H2 sections with correct anchor IDs
- [ ] `docs/manual/how-it-works.html` contains the new H2 section with correct anchor ID
- [ ] `docs/manual/assets/manual.js` parses cleanly via `node --check` and contains all new CHAPTERS + SEARCH_SECTIONS entries
- [ ] All numeric claims in new content verified against source blog HTML via `grep -F`
- [ ] No first-person pronouns in new content (except inside cited quotations)
- [ ] `git diff --stat` shows changes only inside `docs/manual/`
- [ ] No file in `pforge-mcp/`, `pforge-master/`, or root scripts modified
- [ ] `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` byte-identical to pre-execution
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**

---

## Stop Conditions

If any of the following occurs during execution, STOP and escalate:

1. **Out-of-scope file modification** — `git diff --stat` shows changes outside `docs/manual/`. Revert and complete the slice within scope.
2. **Numeric claim cannot be verified in source blog** — If a number planned for the manual doesn't appear in the cited blog HTML, do NOT fabricate. Either find a verified source or remove the claim.
3. **Voice violation** — If the new content reads as first-person memoir rather than reference voice, the Reviewer Gate will fail. Pause and rewrite in third-person present tense.
4. **manual.js parse failure** — Stop, fix, re-run `node --check`. Don't proceed with broken JS.
5. **Existing CHAPTERS or SEARCH_SECTIONS entry accidentally modified** — Revert, re-do as pure insertion.

---

## Cost Estimate

Run `pforge run-plan --estimate docs/plans/Phase-MANUAL-EVIDENCE-PLAN.md` for an exact projection. Expected: $4–$8 (8 docs slices, 0 quorum-eligible, no code touched). For a quorum comparison across all 4 modes, run `forge_estimate_quorum({ planPath: "docs/plans/Phase-MANUAL-EVIDENCE-PLAN.md" })`.
