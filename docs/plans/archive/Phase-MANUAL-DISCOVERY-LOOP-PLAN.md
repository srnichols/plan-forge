# Phase-MANUAL-DISCOVERY-LOOP: Document the discovery harness implementation, the 4-pass build sequence, the 3-lane triage funnel, and concrete quorum quality examples

> **Status**: Hardened, ready for execution
> **Tracks**: Docs only (`docs/manual/*.html`, `docs/manual/assets/manual.js`, `docs/manual/assets/diagrams/*.svg`)
> **Estimated cost**: $4.00–$7.00 (7 slices, all docs/HTML, no code touched)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → Harden ✅ → Execute → Sweep → Review → Ship
> **Source**: Blog vs Manual content audit (May 6 2026). Identified 2 high-priority gaps: (1) the discovery harness mechanics from `the-loop-that-never-ends.html` are under-documented in `audit-loop.html`; (2) the quorum chapter explains the *mechanism* but not the concrete *quality deltas* shown in `quorum-mode-3-models.html` (DRY extraction, relative-date tests, modern .NET patterns). This is the SECOND of 3 follow-on phases (EVIDENCE → **DISCOVERY-LOOP** → INTEGRATIONS).
> **Hardener notes**: All source content lives in `docs/blog/the-loop-that-never-ends.html` and `docs/blog/quorum-mode-3-models.html`. The discovery harness specifics (Node + Playwright + structured JSON output + 3-lane triage) need their own dedicated section because they're a non-obvious implementation pattern. Quorum quality examples need a new H3 section under the existing Quorum Mode H2 in `advanced-execution.html`. Two new SVGs follow the convention established by the recent quorum diagrams.

---

## Scope Contract

### In Scope

- **2 new SVG diagrams** in `docs/manual/assets/diagrams/`:
  - `discovery-harness-four-pass.svg` — sequence diagram of the 4-pass build (Harness → Wrapper → Execute → Auto-smelt back to Discovery)
  - `triage-three-lane-funnel.svg` — funnel diagram showing discovery findings split into 3 lanes (bug → bug registry, spec → Crucible re-smelt, classifier → human review under `.forge/audits/`)
- **1 expanded chapter**: `docs/manual/audit-loop.html` gains TWO new H2 sections:
  - "Discovery Harness Implementation" (after the existing audit-loop overview)
  - "Three-Lane Triage Funnel" (immediately after Discovery Harness Implementation)
- **1 expanded chapter**: `docs/manual/advanced-execution.html` gains ONE new H3 sub-section under the existing `<h2 id="quorum">Quorum Mode</h2>`:
  - "Quorum Quality Examples — What 3 Models Catch That 1 Doesn't" (placed after the existing `quorum-multi-agent` H3, before the `host-routing` H2)
- **Navigation registry**: `docs/manual/assets/manual.js` — add 2 anchors per new audit-loop section to `audit-loop.html` SEARCH_SECTIONS entry, and 1 new anchor for the quorum-quality-examples section in the `advanced-execution.html` SEARCH_SECTIONS list

### Out of Scope

- Any new chapter file (everything goes into existing chapters)
- Hero images for the new sections
- Modifying any blog post under `docs/blog/`
- Modifying `docs/manual/index.html` (no new appendix cards)
- Touching any other manual chapter beyond `audit-loop.html` and `advanced-execution.html`
- Any code in `pforge-mcp/`, `pforge-master/`, root scripts, or `.github/`
- Quorum cost numbers (already covered in Phase-MANUAL-EVIDENCE plan and existing `#quorum-estimate` section)
- The Crucible re-smelt mechanics (covered separately in `crucible.html`; this phase only references it via cross-link)
- Phase-MANUAL-EVIDENCE and Phase-MANUAL-INTEGRATIONS — separate plans
- New `applyTo` instruction files
- Any tooling/build changes

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 fix; protected across all phases)
- **Do NOT touch** any file outside `docs/manual/` — this is a docs-only phase
- **Do NOT modify** the Slice 6/Slice 7 quorum sub-sections added in commit 951f005 (`#quorum-estimate`, `#quorum-complexity`, `#quorum-multi-agent`); insert the new `#quorum-quality-examples` AFTER them, before the `#host-routing` H2
- **Do NOT introduce a new CSS file or new manual.css rules** — use existing Tailwind utilities and `.chapter-content` styles
- **Do NOT reorder or rename existing CHAPTERS or SEARCH_SECTIONS entries** in `manual.js` — only insert new anchor entries within existing chapter blocks
- **Do NOT fabricate code examples** — every code snippet showing "what quorum caught" MUST be derivable from the patterns described in `docs/blog/quorum-mode-3-models.html` (e.g. `IsWeekend()`, `CalculateVolumeDiscount()`, `ApplyBankersRounding()`, `DateTime.Now.AddDays(-7)`, `ArgumentException.ThrowIfNullOrWhiteSpace`). If the blog only mentions a pattern by name, the manual MAY show a representative C# snippet illustrating it, clearly labeled as "representative example, not literal output."
- **Do NOT fabricate harness implementation details** — the discovery harness section must reference the Node crawler + Playwright + structured JSON pattern explicitly described in `docs/blog/the-loop-that-never-ends.html`. Do NOT invent additional libraries, hooks, or output schema fields.
- **Do NOT add hero images**

---

## Required Decisions

All resolved during hardening; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Where to place discovery harness implementation — new chapter vs section in audit-loop | **Section in `audit-loop.html`**. The harness IS the audit loop's discovery phase; it belongs in the existing chapter, not as a separate one. |
| 2 | Where to place quorum quality examples — new chapter vs sub-section in advanced-execution | **H3 sub-section under existing Quorum Mode H2**. Mirrors the structure already established by the recent quorum sub-sections (#quorum-estimate, #quorum-complexity, #quorum-multi-agent). |
| 3 | Code-example language for quorum quality section | **C#**. The source blog uses .NET examples (Banker's rounding, ArgumentException.ThrowIfNullOrWhiteSpace). Manual examples should match for consistency. |
| 4 | Triage funnel — separate chapter or section in audit-loop | **Section in `audit-loop.html`**, placed immediately after Discovery Harness Implementation. The two are tightly coupled: discovery produces findings, triage routes them. |
| 5 | Auto-smelt loop diagram — embed in funnel SVG or separate | **Part of `discovery-harness-four-pass.svg`** (the 4-pass sequence already includes auto-smelt as Pass 4). The funnel SVG focuses on the 3 destinations of findings, not the loop closure. |
| 6 | JSON schema for findings — show full schema or representative subset | **Representative subset** — show ~6 fields the blog explicitly mentions: HTTP status, page title, h1, word count, placeholder marker count, broken-link count, console-error count. Mark as "representative" since blog doesn't dump the full schema. |
| 7 | "Representative example" labeling | All code/JSON snippets that are inferred from blog patterns rather than literal blog output get a `<div class="callout callout-info"><strong>Representative example</strong> — illustrates the pattern; not a literal copy of harness output.</div>` directly above the snippet. |
| 8 | Cross-link strategy | Both new audit-loop sections cross-link to: `crucible.html` (for the Crucible re-smelt path), `bug-registry.html` (for the bug-lane destination), `advanced-execution.html#quorum-quality-examples` (because quorum is what catches the regressions the loop discovers). The new quorum sub-section cross-links to: `audit-loop.html#discovery-harness` (the source of regressions) and `advanced-execution.html#quorum-complexity` (the scoring rubric that decides which slices get quorum). |

---

## Acceptance Criteria

### Per-section HTML rules (apply to all new content)

- **MUST**: Every `<h2>` and `<h3>` carries a stable `id` attribute in kebab-case slug form
- **MUST**: All cross-links to other manual pages use `.html` extensions and relative paths
- **MUST**: All inline code uses `<code>...</code>`; all code blocks use `<pre><code>...</code></pre>` with `class="language-csharp"` or `class="language-json"` where applicable
- **MUST**: All callouts use existing Tailwind utility classes (`callout callout-info`, `callout callout-warning`, `callout callout-tip`)
- **MUST**: Every code snippet inferred from blog patterns (rather than literally quoted) carries a "Representative example" callout immediately above it
- **MUST**: No first-person pronouns (I, we, my, our) appear in the new content unless inside a direct quotation from a cited blog post
- **MUST**: Reference voice (third person, present tense)

### "Discovery Harness Implementation" section in `audit-loop.html`

- **MUST**: New `<h2 id="discovery-harness">Discovery Harness Implementation</h2>` exists, placed after the existing audit-loop overview content
- **MUST**: References `discovery-harness-four-pass.svg` via `<img src="assets/diagrams/discovery-harness-four-pass.svg" alt="...">` with descriptive alt text covering all 4 passes
- **MUST**: Lists the harness ingredients explicitly: Node-based crawler, Playwright for browser automation, console-error capture, route enumeration, placeholder regex (`/TODO|FIXME|TBD|stub|mock/i` or equivalent), structured JSON output
- **MUST**: Shows a representative JSON output snippet with the 7 representative fields (httpStatus, title, h1, wordCount, placeholderCount, brokenLinkCount, consoleErrorCount)
- **MUST**: Walks through the 4 passes in named sub-sections or numbered list:
  1. **Pass 1 — Harness** (crawl + collect raw findings)
  2. **Pass 2 — Wrapper** (transform JSON findings into Crucible-compatible inputs)
  3. **Pass 3 — Execute** (Plan Forge runs the resulting plan to fix issues)
  4. **Pass 4 — Auto-smelt** (bug registry writes new ore back to Discovery, no human triage)
- **MUST**: Includes a "When to use" callout describing the type of project this harness fits (production sites with regressions, content-heavy properties, anything where automated discovery beats human spot-checks)
- **MUST**: Cross-links to `bug-registry.html` and `crucible.html`
- **MUST**: Links back to source blog: `<a href="../blog/the-loop-that-never-ends.html" rel="noopener">Original case study</a>`

### "Three-Lane Triage Funnel" section in `audit-loop.html`

- **MUST**: New `<h2 id="three-lane-triage">Three-Lane Triage Funnel</h2>` exists, placed immediately after the Discovery Harness Implementation section
- **MUST**: References `triage-three-lane-funnel.svg` via `<img src="assets/diagrams/triage-three-lane-funnel.svg" alt="...">` with alt text describing the 3 lanes
- **MUST**: Describes each of the 3 lanes in named sub-sections:
  - `id="bug-lane"` — Bug lane → `bug-registry.html`. Findings that match a known bug shape (broken link, console error, HTTP 500) become bug entries.
  - `id="spec-lane"` — Spec lane → Crucible re-smelt. Findings that indicate missing/wrong specification (incorrect copy, missing section, placeholder content) become Crucible interview questions.
  - `id="classifier-lane"` — Classifier lane → `.forge/audits/<runId>/<finding-id>.json`. Ambiguous findings staged for human review with full context.
- **MUST**: Includes a table mapping common finding types to their lane:
  | Finding type | Lane | Why |
  | HTTP 500 | bug | clearly broken |
  | Console error | bug | clearly broken |
  | Broken link | bug | clearly broken |
  | Placeholder text (TODO/TBD) | spec | content not authored |
  | Missing required section | spec | spec gap |
  | Word count below threshold | classifier | could be bug or could be intentional |
  | Title/h1 mismatch | classifier | needs human judgment |
- **MUST**: Includes a "What gets auto-smelted" callout explaining that bug-lane findings can re-enter Discovery automatically without human approval, while spec-lane and classifier-lane findings require a session boundary
- **MUST**: Cross-links to `bug-registry.html`, `crucible.html`, `advanced-execution.html#quorum-quality-examples` (because quorum is what prevents these regressions in the first place)

### "Quorum Quality Examples" section in `advanced-execution.html`

- **MUST**: New `<h3 id="quorum-quality-examples">Quorum Quality Examples — What 3 Models Catch That 1 Doesn't</h3>` exists under the existing `<h2 id="quorum">Quorum Mode</h2>`
- **MUST**: Placed AFTER the existing `<h3 id="quorum-multi-agent">` section, BEFORE the `<h2 id="host-routing">` section
- **MUST**: Opens with the headline finding from the blog: 3-model consensus produced **18 tests vs 15** (a 20% delta) on the same task, both passing all gates
- **MUST**: Shows 4 named example patterns the quorum reviewer caught that single-model missed, each with a "Representative example" callout and a C# snippet:
  1. **DRY helper extraction** — e.g. `IsWeekend()`, `CalculateVolumeDiscount()`, `ApplyBankersRounding()` as private methods instead of inline duplicated logic
  2. **Robust test dates** — `DateTime.Now.AddDays(-7)` instead of hardcoded date literals (test stability across run dates)
  3. **Modern .NET patterns** — `ArgumentException.ThrowIfNullOrWhiteSpace(name)` instead of `if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException(...)`
  4. **Edge-case coverage** — voided invoice regeneration, invoice number sequencing across cancellations (tests the single-model run did not include)
- **MUST**: Includes a callout explaining the synthesis mechanism: when one model proposes inline code and another proposes extraction, the reviewer picks the cleaner approach. This is **the** mechanism behind why quorum produces measurably better code even when both runs pass gates.
- **MUST**: Includes a "When this pays off" decision table:
  | Slice characteristic | Single-model OK | Quorum recommended |
  | Mechanical conversion (HTML/Markdown) | ✅ | ❌ — overhead not justified |
  | CRUD with 1-2 entities | ✅ | ❌ |
  | Business logic with branching | ⚠️ | ✅ |
  | Security-sensitive (auth, crypto) | ❌ | ✅ |
  | Schema migration | ❌ | ✅ — irreversible |
  | Architectural decision | ❌ | ✅ |
- **MUST**: Cross-links to `audit-loop.html#discovery-harness` (so readers see what regressions look like when quorum was skipped) and `advanced-execution.html#quorum-complexity` (the scoring rubric that decides eligibility)
- **MUST**: Links back to source blog: `<a href="../blog/quorum-mode-3-models.html" rel="noopener">Full A/B test write-up with code samples</a>`

### `discovery-harness-four-pass.svg`

- **MUST**: File exists at `docs/manual/assets/diagrams/discovery-harness-four-pass.svg`
- **MUST**: Valid SVG (parses cleanly and contains `<svg` + `</svg>`)
- **MUST**: Includes `<title>` and `<desc>` elements for accessibility
- **MUST**: ViewBox dimensions appropriate for a horizontal sequence (e.g. 1000×360)
- **MUST**: Shows 4 passes as labeled nodes connected by arrows, with the 4th pass arrow looping back to Pass 1 (forming the closed loop)
- **MUST**: Each pass node labeled with its number (1–4), name (Harness / Wrapper / Execute / Auto-smelt), and a one-line summary
- **MUST**: Color palette matches existing diagrams: dark background `#0f172a` or transparent, slate borders `#334155`, amber `#f59e0b` for the loop-closure arrow (highlights the auto-smelt back-edge)
- **MUST**: Inline text uses `'Inter', sans-serif`

### `triage-three-lane-funnel.svg`

- **MUST**: File exists at `docs/manual/assets/diagrams/triage-three-lane-funnel.svg`
- **MUST**: Valid SVG with `<title>` and `<desc>` elements
- **MUST**: ViewBox dimensions appropriate for a funnel (e.g. 800×400)
- **MUST**: Shows a "Findings" input at the top, splitting into 3 labeled lanes/destinations:
  - Bug lane → "Bug Registry" (auto-smelt eligible, marked with amber back-arrow)
  - Spec lane → "Crucible re-smelt" (session boundary required)
  - Classifier lane → ".forge/audits/" (human review required)
- **MUST**: Each lane has 1–2 example finding types listed beneath it (matching the table in the section)
- **MUST**: Color palette matches existing diagrams
- **MUST**: Inline text uses `'Inter', sans-serif`

### Navigation registry — `docs/manual/assets/manual.js`

- **MUST**: Existing SEARCH_SECTIONS entry for `audit-loop.html` gains 2 new anchors (or more):
  - `{ t: "Discovery Harness Implementation", u: "audit-loop.html#discovery-harness" }`
  - `{ t: "Three-Lane Triage Funnel", u: "audit-loop.html#three-lane-triage" }`
- **MUST**: Existing SEARCH_SECTIONS entry for `advanced-execution.html` gains 1 new anchor:
  - `{ t: "Quorum Quality Examples", u: "advanced-execution.html#quorum-quality-examples" }`
- **MUST**: `node --check docs/manual/assets/manual.js` passes
- **MUST**: No existing CHAPTERS or SEARCH_SECTIONS entries reordered, renamed, or removed

---

## Execution Slices

7 slices total. Slices 2 and 3 (the two SVGs) are independent. Slices 4 and 5 depend on Slices 2 and 3 respectively. Slice 6 is independent (different chapter). Slice 7 ties everything together.

### Slice 1: Read source blogs + target chapters + verify content [sequential]

**Goal**: Read-only context loading. Confirm the blog content matches what the audit identified.

**Files**:
- READ: `docs/blog/the-loop-that-never-ends.html`
- READ: `docs/blog/quorum-mode-3-models.html`
- READ: `docs/manual/audit-loop.html`
- READ: `docs/manual/advanced-execution.html`
- READ: `docs/manual/assets/manual.js`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/context-fuel.instructions.md`

**What changes**: Nothing. Pure context loading.

**Validation Gate**:
```bash
grep -F "Playwright" docs/blog/the-loop-that-never-ends.html >/dev/null
grep -F "auto-smelt" docs/blog/the-loop-that-never-ends.html >/dev/null
grep -F "IsWeekend" docs/blog/quorum-mode-3-models.html >/dev/null
grep -F "Banker" docs/blog/quorum-mode-3-models.html >/dev/null
grep -F "id=\"quorum-multi-agent\"" docs/manual/advanced-execution.html >/dev/null
grep -F "id=\"host-routing\"" docs/manual/advanced-execution.html >/dev/null
echo ok
```

---

### Slice 2: Create `discovery-harness-four-pass.svg` [sequential]

**Goal**: Author the 4-pass sequence diagram with auto-smelt loop closure.

**Files**:
- WRITE: `docs/manual/assets/diagrams/discovery-harness-four-pass.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)
- READ: `docs/blog/the-loop-that-never-ends.html` (content source)

**Context Files**: (none — pure asset creation)

**What changes**: Create the SVG with 4 horizontal pass nodes, arrows linking 1→2→3→4, plus an amber back-arrow from 4 → 1 to show the auto-smelt loop closure. Each node labeled with number, name, one-line summary. `<title>` + `<desc>` for accessibility.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/discovery-harness-four-pass.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);if(!s.includes('<title'))process.exit(4);if(!s.includes('<desc'))process.exit(5);for(const w of ['Harness','Wrapper','Execute','Auto-smelt']){if(!s.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 3: Create `triage-three-lane-funnel.svg` [sequential]

**Goal**: Author the 3-lane triage funnel diagram.

**Files**:
- WRITE: `docs/manual/assets/diagrams/triage-three-lane-funnel.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)
- READ: `docs/blog/the-loop-that-never-ends.html` (content source)

**Context Files**: (none — pure asset creation)

**What changes**: Create the SVG with a "Findings" input at top, splitting into 3 labeled lanes (Bug → Bug Registry, Spec → Crucible re-smelt, Classifier → .forge/audits/). Bug lane includes an amber back-arrow indicating auto-smelt eligibility. `<title>` + `<desc>` for accessibility.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/triage-three-lane-funnel.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);if(!s.includes('<title'))process.exit(4);for(const w of ['Bug','Spec','Classifier','Findings']){if(!s.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 4: Add "Discovery Harness Implementation" section to `audit-loop.html` [sequential]

**Goal**: Insert new H2 section with embedded SVG, JSON example, and 4-pass walkthrough.

**Files**:
- EDIT: `docs/manual/audit-loop.html`
- READ: `docs/blog/the-loop-that-never-ends.html`
- READ: `docs/manual/assets/diagrams/discovery-harness-four-pass.svg` (verify exists)

**Depends On**: Slice 2

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert new `<h2 id="discovery-harness">Discovery Harness Implementation</h2>` section after the existing audit-loop overview content
- Embed `discovery-harness-four-pass.svg`
- List harness ingredients (Node + Playwright + console-error capture + route enumeration + placeholder regex + structured JSON output)
- Show representative JSON snippet with 7 fields, in a `<pre><code class="language-json">` block, preceded by a "Representative example" callout
- Walk through 4 passes as numbered list or sub-headings (Harness / Wrapper / Execute / Auto-smelt)
- "When to use" callout
- Cross-links to `bug-registry.html`, `crucible.html`
- Link back to source blog
- Preserve all existing audit-loop content unchanged

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/audit-loop.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"discovery-harness\"'))process.exit(1);if(!c.includes('discovery-harness-four-pass.svg'))process.exit(2);if(!c.includes('Playwright'))process.exit(3);if(!c.includes('Representative example'))process.exit(4);for(const w of ['Pass 1','Pass 2','Pass 3','Pass 4']){if(!c.includes(w))process.exit(10);}if(!c.includes('the-loop-that-never-ends.html'))process.exit(20);console.log('ok')"
```

---

### Slice 5: Add "Three-Lane Triage Funnel" section to `audit-loop.html` [sequential]

**Goal**: Insert new H2 section immediately after Discovery Harness Implementation.

**Files**:
- EDIT: `docs/manual/audit-loop.html`
- READ: `docs/manual/assets/diagrams/triage-three-lane-funnel.svg` (verify exists)

**Depends On**: Slice 3, Slice 4

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert new `<h2 id="three-lane-triage">Three-Lane Triage Funnel</h2>` section immediately after the Discovery Harness Implementation section
- Embed `triage-three-lane-funnel.svg`
- 3 sub-sections (`#bug-lane`, `#spec-lane`, `#classifier-lane`) describing each destination
- Finding-type → lane mapping table
- "What gets auto-smelted" callout
- Cross-links to `bug-registry.html`, `crucible.html`, `advanced-execution.html#quorum-quality-examples`
- Preserve all existing content unchanged

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/audit-loop.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"three-lane-triage\"'))process.exit(1);if(!c.includes('triage-three-lane-funnel.svg'))process.exit(2);for(const id of ['bug-lane','spec-lane','classifier-lane']){if(!c.includes('id=\"'+id+'\"'))process.exit(10);}if(!c.includes('quorum-quality-examples'))process.exit(20);console.log('ok')"
```

---

### Slice 6: Add "Quorum Quality Examples" sub-section to `advanced-execution.html` [sequential]

**Goal**: Insert new H3 sub-section under Quorum Mode H2, between #quorum-multi-agent and #host-routing.

**Files**:
- EDIT: `docs/manual/advanced-execution.html`
- READ: `docs/blog/quorum-mode-3-models.html`

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Locate the existing `<h2 id="host-routing">` line in `advanced-execution.html` (currently line ~190)
- Insert new `<h3 id="quorum-quality-examples">Quorum Quality Examples — What 3 Models Catch That 1 Doesn't</h3>` section IMMEDIATELY BEFORE that line (i.e. as the last H3 under the Quorum Mode H2)
- Open with the 18 vs 15 tests headline (20% delta on same task, both passing all gates)
- 4 named example patterns, each with a "Representative example" callout and a C# snippet:
  - DRY helper extraction (`IsWeekend()`, `CalculateVolumeDiscount()`, `ApplyBankersRounding()`)
  - Robust test dates (`DateTime.Now.AddDays(-7)`)
  - Modern .NET patterns (`ArgumentException.ThrowIfNullOrWhiteSpace`)
  - Edge-case coverage (voided invoice regeneration, invoice number sequencing)
- Synthesis mechanism callout (one model proposes inline, another proposes extraction, reviewer picks cleaner)
- "When this pays off" decision table (6 rows from Acceptance Criteria)
- Cross-links to `audit-loop.html#discovery-harness` and `advanced-execution.html#quorum-complexity`
- Link back to source blog
- Preserve all existing content unchanged

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/advanced-execution.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"quorum-quality-examples\"'))process.exit(1);for(const w of ['IsWeekend','CalculateVolumeDiscount','ApplyBankersRounding','DateTime.Now.AddDays','ThrowIfNullOrWhiteSpace']){if(!c.includes(w))process.exit(10);}if(!c.includes('quorum-mode-3-models.html'))process.exit(20);if(!c.includes('Representative example'))process.exit(21);const qe=c.indexOf('id=\"quorum-quality-examples\"');const hr=c.indexOf('id=\"host-routing\"');if(qe<0 || hr<0 || qe>=hr)process.exit(30);const qm=c.indexOf('id=\"quorum-multi-agent\"');if(qm<0 || qm>=qe)process.exit(31);console.log('ok')"
```

---

### Slice 7: Update navigation registry + final verification [sequential]

**Goal**: Add 3 new search anchors and verify everything is consistent.

**Files**:
- EDIT: `docs/manual/assets/manual.js`

**Depends On**: All prior slices

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Append to the `audit-loop.html` SEARCH_SECTIONS block (find the existing entries for that page):
  - `{ t: "Discovery Harness Implementation", u: "audit-loop.html#discovery-harness" }`
  - `{ t: "Three-Lane Triage Funnel", u: "audit-loop.html#three-lane-triage" }`
- Append to the `advanced-execution.html` SEARCH_SECTIONS block:
  - `{ t: "Quorum Quality Examples", u: "advanced-execution.html#quorum-quality-examples" }`

**Validation Gate**:
```bash
node --check docs/manual/assets/manual.js
node -e "const fs=require('fs');const m=fs.readFileSync('docs/manual/assets/manual.js','utf8');for(const a of ['#discovery-harness','#three-lane-triage','#quorum-quality-examples']){if(!m.includes(a))process.exit(1);}console.log('ok')"
test -f docs/manual/assets/diagrams/discovery-harness-four-pass.svg
test -f docs/manual/assets/diagrams/triage-three-lane-funnel.svg
echo ok
```

---

## Re-anchor Checkpoints

- **After Slice 2 (4-pass SVG)**: Open in browser, confirm 4 nodes + amber loop-back arrow render correctly.
- **After Slice 3 (funnel SVG)**: Open in browser, confirm 3 lanes render correctly with example finding types.
- **After Slice 5 (audit-loop edits complete)**: Open `docs/manual/audit-loop.html` in browser, confirm both new sections render and SVGs embed correctly.
- **After Slice 6 (quorum quality examples)**: Open `docs/manual/advanced-execution.html`, scroll to Quorum Mode, confirm new H3 appears between #quorum-multi-agent and #host-routing.

---

## Definition of Done

- [ ] All 7 Execution Slices passed their validation gates
- [ ] All MUST acceptance criteria satisfied
- [ ] 2 new SVG diagrams exist in `docs/manual/assets/diagrams/`
- [ ] `docs/manual/audit-loop.html` contains both new H2 sections with correct anchor IDs and embedded SVGs
- [ ] `docs/manual/advanced-execution.html` contains the new H3 sub-section, positioned between `#quorum-multi-agent` and `#host-routing`
- [ ] `docs/manual/assets/manual.js` parses cleanly via `node --check` and contains 3 new search anchors
- [ ] Every code/JSON snippet inferred from blog patterns has a "Representative example" callout above it
- [ ] No first-person pronouns in new content (except inside cited quotations)
- [ ] `git diff --stat` shows changes only inside `docs/manual/`
- [ ] No file in `pforge-mcp/`, `pforge-master/`, or root scripts modified
- [ ] `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` byte-identical to pre-execution
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**

---

## Stop Conditions

If any of the following occurs during execution, STOP and escalate:

1. **Out-of-scope file modification** — `git diff --stat` shows changes outside `docs/manual/`. Revert and complete the slice within scope.
2. **Inferred content without "Representative example" callout** — Reviewer Gate will flag this as fabricated content. Pause, add the callout, re-do.
3. **Anchor ordering violated in `advanced-execution.html`** — `#quorum-quality-examples` MUST appear between `#quorum-multi-agent` and `#host-routing`. Validation Gate Slice 6 enforces this.
4. **manual.js parse failure** — Stop, fix, re-run `node --check`. Don't proceed with broken JS.
5. **Existing content accidentally modified in `audit-loop.html` or `advanced-execution.html`** — Revert, re-do as pure insertion of new sections.

---

## Cost Estimate

Run `pforge run-plan --estimate docs/plans/Phase-MANUAL-DISCOVERY-LOOP-PLAN.md` for an exact projection. Expected: $4–$7 (7 docs slices, 0 quorum-eligible, no code touched). For a quorum comparison across all 4 modes, run `forge_estimate_quorum({ planPath: "docs/plans/Phase-MANUAL-DISCOVERY-LOOP-PLAN.md" })`.
