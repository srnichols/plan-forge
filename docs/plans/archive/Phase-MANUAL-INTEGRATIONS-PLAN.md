# Phase-MANUAL-INTEGRATIONS: Document OpenBrain cross-agent knowledge compounding, Spec Kit field-by-field import, and the WhatsApp-to-PR end-to-end workflow with ACP

> **Status**: Hardened, ready for execution
> **Tracks**: Docs only (`docs/manual/*.html`, `docs/manual/assets/manual.js`, `docs/manual/assets/diagrams/*.svg`)
> **Estimated cost**: $5.00–$9.00 (9 slices, all docs/HTML, no code touched)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → Harden ✅ → Execute → Sweep → Review → Ship
> **Source**: Blog vs Manual content audit (May 6 2026). Identified 3 high-priority integration narratives missing or under-documented in the manual: (1) OpenBrain compounds knowledge across sessions and agents (`seven-agents.html`, `unified-system.html`); (2) Spec Kit interop has field-by-field import mechanics not documented anywhere in the manual (`spec-kit-plan-forge.html`); (3) the WhatsApp-to-shipped-PR end-to-end workflow with ACP is the aspirational closed-loop story (`unified-system.html`). This is the THIRD of 3 follow-on phases (EVIDENCE → DISCOVERY-LOOP → **INTEGRATIONS**).
> **Hardener notes**: Source content lives in `docs/blog/seven-agents.html`, `docs/blog/spec-kit-plan-forge.html`, and `docs/blog/unified-system.html`. Existing manual coverage exists but is shallow: `memory-architecture.html` mentions OpenBrain but not cross-agent compounding; `multi-agent.html` lists 7 agents but not the unified-memory story; `crucible.html` doesn't cover Spec Kit import; `remote-bridge.html` is reference-only. Three new SVGs follow the convention established by recent quorum diagrams. The static `docs/speckit-interop.html` page exists at root level — this phase creates a manual chapter version with deeper content and registers it in the manual TOC.

---

## Scope Contract

### In Scope

- **3 new SVG diagrams** in `docs/manual/assets/diagrams/`:
  - `openbrain-cross-agent-compounding.svg` — sequence diagram showing Claude Code session → OpenBrain capture → Cursor session search → Copilot review with full decision history
  - `speckit-import-field-mapping.svg` — field-by-field mapping diagram (spec.md → Crucible spec section, plan.md → execution-contract baseline, tasks.md → execution slices, constitution.md → PROJECT-PRINCIPLES.md)
  - `unified-system-three-pillars.svg` — three-pillar architecture (Plan Forge guardrails + OpenBrain memory + OpenClaw orchestration) with WhatsApp/desktop/voice inputs converging to OpenClaw → Plan Forge + OpenBrain → Copilot CLI via ACP
- **1 expanded chapter**: `docs/manual/memory-architecture.html` gains ONE new H2 section:
  - "Unified Memory Across Agents" (after the existing tier-architecture description)
- **1 expanded chapter**: `docs/manual/multi-agent.html` gains ONE new H2 section:
  - "OpenBrain: The Connective Tissue" (placed near the chapter end, before the FAQ/closer)
- **1 new chapter** (registered in TOC):
  - `docs/manual/spec-kit-interop.html` — full chapter on importing Spec Kit projects into Plan Forge (current root-level `docs/speckit-interop.html` is a marketing page; the new manual chapter is reference documentation with field-by-field import mechanics, anchored by `speckit-import-field-mapping.svg`)
- **1 expanded chapter**: `docs/manual/remote-bridge.html` gains ONE new H2 section:
  - "End-to-End Workflow: WhatsApp to Shipped PR" (placed after the existing Remote Bridge overview, before the per-channel reference content)
- **Navigation registry**: `docs/manual/assets/manual.js` — register `spec-kit-interop` chapter (act: "Appendix", num: ""), add ~5 search anchors for the new chapter, add ~2 anchors for the new sections in `memory-architecture.html`, `multi-agent.html`, and `remote-bridge.html`

### Out of Scope

- Hero images for the new chapter or sections
- Modifying any blog post under `docs/blog/`
- Modifying `docs/manual/index.html` Appendices grid (next batched commit will add appendix cards across all 3 phases together — not in scope here)
- Deleting or modifying the root-level `docs/speckit-interop.html` (it's a marketing landing page; the new manual chapter is reference documentation)
- Touching any other manual chapter beyond the 4 in scope
- Any code in `pforge-mcp/`, `pforge-master/`, root scripts, or `.github/`
- The other 2 follow-on phases (EVIDENCE, DISCOVERY-LOOP) — separate plans
- New `applyTo` instruction files
- Detailed OpenBrain implementation (search algorithms, tier rotation, retention policies) — references only; the existing `memory-architecture.html` already covers tier mechanics
- Detailed OpenClaw protocol internals — references only; the existing `remote-bridge.html` covers per-channel reference
- ACP (Agent Client Protocol) full spec — describe its role in enabling the workflow, link to upstream docs
- Any tooling/build changes
- Generating actual screenshots of the WhatsApp workflow

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 fix; protected across all phases)
- **Do NOT touch** any file outside `docs/manual/` (and specifically only the files in scope) — this is a docs-only phase
- **Do NOT modify** the existing root-level `docs/speckit-interop.html` — the new chapter is `docs/manual/spec-kit-interop.html` (note the path difference)
- **Do NOT introduce a new CSS file or new manual.css rules** — use existing Tailwind utilities and `.chapter-content` styles
- **Do NOT reorder or rename existing CHAPTERS or SEARCH_SECTIONS entries** in `manual.js` — only insert new entries
- **Do NOT remove or alter** the `about-author` entry (must stay last in the Appendix array)
- **Do NOT fabricate field mappings for Spec Kit import** — the spec.md → Crucible, plan.md → contract baseline, tasks.md → slices, constitution.md → PROJECT-PRINCIPLES.md mapping is documented in `docs/blog/spec-kit-plan-forge.html`. If the manual chapter wants to show field-level mapping (e.g. spec.md "User Story" → Crucible spec section "User Need"), the mapping MUST be derivable from the blog or marked as "representative mapping; verify against your Spec Kit version" in a callout.
- **Do NOT fabricate the WhatsApp-to-PR workflow steps** — the 5-step workflow (request capture → plan hardening → slice execution with captures → independent review → ship + Learn) is documented in `docs/blog/unified-system.html`. Do NOT invent additional steps or omit documented ones.
- **Do NOT add hero images**
- **Do NOT delete the source blog HTML files** — they remain canonical marketing content

---

## Required Decisions

All resolved during hardening; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Spec Kit interop — new chapter vs section in existing chapter | **New manual chapter** at `docs/manual/spec-kit-interop.html`. Field-by-field import mechanics are too detailed to fit in `crucible.html`. The existing root-level `docs/speckit-interop.html` is marketing-voice; the manual chapter is reference-voice. |
| 2 | Manual chapter path vs root path for Spec Kit | Manual chapter at `docs/manual/spec-kit-interop.html`. Both pages can coexist (different audiences). The root page links DOWN to the manual chapter for "deep reference"; the manual chapter links UP to the marketing page for "see also". |
| 3 | OpenBrain cross-agent — new chapter or section | **Section** in both `memory-architecture.html` AND `multi-agent.html`. The story has two facets: from the memory side (compounding) and from the multi-agent side (connective tissue). One section in each chapter, cross-linked. |
| 4 | WhatsApp-to-PR — new chapter or section in remote-bridge | **Section in `remote-bridge.html`**. Remote Bridge IS the inbound channel for the WhatsApp message; the workflow narrative belongs in that chapter. |
| 5 | Numbering for new spec-kit-interop chapter | **`num: ""`** (no letter). Matches the precedent set by Phase-MANUAL-EVIDENCE for `lessons-learned` and `project-history`. Lessons-Learned, Project-History, and Spec-Kit-Interop are the "non-numbered reference" appendix track. |
| 6 | Three-pillar diagram detail level | **Architecture-block style** matching `enterprise-reference-architecture-generic.svg` (added in PR #154). Not a sequence diagram. Shows the 3 pillars as labeled boxes, inputs converging on the left, outputs (shipped PR, captured memory) on the right. |
| 7 | ACP coverage depth | Brief: 1 paragraph + a callout explaining ACP enables programmatic control of Copilot CLI. Link to upstream Agent Client Protocol docs. Do not duplicate the spec. |
| 8 | OpenBrain compounding diagram — sequence or graph | **Sequence diagram** (horizontal swim lanes for Claude/OpenBrain/Cursor/Copilot). Better than a graph for showing temporal compounding. |
| 9 | Spec Kit ecosystem context (85K stars, 144 contributors, 40+ extensions) | Include ONE sentence with these numbers in the chapter intro, citing the blog. Do NOT make the numbers the focus of the chapter. |

---

## Acceptance Criteria

### Per-section / per-chapter HTML rules (apply to all new content)

- **MUST**: Markup matches the chapter template established by `plan-forge-on-the-github-stack.html` and recently added quorum sub-sections
- **MUST**: Every `<h2>` and `<h3>` carries a stable `id` attribute in kebab-case slug form
- **MUST**: All cross-links to other manual pages use `.html` extensions and relative paths
- **MUST**: All inline code uses `<code>...</code>`; all code blocks use `<pre><code>...</code></pre>`
- **MUST**: All callouts use existing Tailwind utility classes
- **MUST**: No first-person pronouns in the new content unless inside a direct quotation from a cited blog post
- **MUST**: Reference voice (third person, present tense)

### "Unified Memory Across Agents" section in `memory-architecture.html`

- **MUST**: New `<h2 id="unified-memory-across-agents">Unified Memory Across Agents</h2>` exists
- **MUST**: References `openbrain-cross-agent-compounding.svg` via `<img>` with descriptive alt text
- **MUST**: Walks through the concrete 4-step example: Claude Code session hardens plan → captures decisions to OpenBrain → Cursor session executes and searches OpenBrain for prior decisions → Copilot review session has full decision history without re-derivation
- **MUST**: Explains the mechanism: each session writes thought-records and decision-records to OpenBrain on shutdown; subsequent sessions (in any agent) call `brain_recall` at SessionStart to load relevant history
- **MUST**: Includes a table mapping the 7 supported agents to their OpenBrain integration (which use SessionStart hooks vs which use manual `brain_recall` calls)
- **MUST**: Cross-links to `multi-agent.html#openbrain-connective-tissue` (the companion section)
- **MUST**: Links back to source blogs: `seven-agents.html` and `unified-system.html`

### "OpenBrain: The Connective Tissue" section in `multi-agent.html`

- **MUST**: New `<h2 id="openbrain-connective-tissue">OpenBrain: The Connective Tissue</h2>` exists, placed near the chapter end
- **MUST**: Opens with the killer-feature framing from the blog: OpenBrain is what makes multi-agent valuable beyond "just supports lots of agents" — knowledge compounds across the whole fleet
- **MUST**: Explains the 4-station x N-agent pattern: any of the 7 agents can sit at any of the 4 stations (Smelt, Forge, Guard, Learn), and OpenBrain is the persistent context layer between station transitions
- **MUST**: Notes the Copilot-only limitation for lifecycle hooks (Copilot is the only agent with true file-type-scoped auto-loading + lifecycle hooks; other agents rely on manual `brain_recall` invocations or SessionStart-equivalent constructs)
- **MUST**: Cross-links to `memory-architecture.html#unified-memory-across-agents` (the companion section)
- **MUST**: Links back to source blog: `seven-agents.html`

### `spec-kit-interop.html` chapter

- **MUST**: File exists at `docs/manual/spec-kit-interop.html`
- **MUST**: Title: "Spec Kit Interop — Plan Forge Manual"
- **MUST**: Breadcrumb: "Reference" or "Appendix" matching the registered `act` value
- **MUST**: Chapter intro mentions Spec Kit ecosystem context in ONE sentence (85K+ stars, 144 contributors, 40+ extensions per blog), cited as adapted from `spec-kit-plan-forge.html`
- **MUST**: Includes a one-paragraph summary of the comparison: "Spec Kit specializes in requirement elicitation; Plan Forge specializes in build enforcement and post-ship watch. The two compose: spec → plan → execution → ship → guard."
- **MUST**: Contains a 3-pillar comparison table (Spec Kit vs Plan Forge) with these rows: Philosophy, Strength, Agents Supported, Mechanism, Execution Model, Review, Memory
- **MUST**: Contains a `<h2 id="import-flow">Import Flow — File-by-File Mapping</h2>` section
- **MUST**: References `speckit-import-field-mapping.svg` via `<img>` with alt text describing the 4 file mappings
- **MUST**: Field mapping table with these rows:
  | Spec Kit file | Maps to Plan Forge | How |
  | `spec.md` | Crucible spec section | Imported via Crucible interview; values populate the spec answers |
  | `plan.md` | Execution-contract baseline | Becomes the Scope Contract section's seed content |
  | `tasks.md` | Execution slices | Each task becomes a slice with auto-generated validation gates |
  | `constitution.md` | `docs/plans/PROJECT-PRINCIPLES.md` | Direct copy with optional reformatting |
- **MUST**: Step-by-step import procedure section (`<h2 id="import-procedure">`)
- **MUST**: A "Representative mapping; verify against your Spec Kit version" callout above the field mapping table
- **MUST**: A `<h2 id="ecosystem-extensions">Ecosystem Extensions</h2>` section explaining that extensions marked `speckit_compatible: true` work in both tools, and `pforge ext` commands are parallel to `specify` commands
- **MUST**: Links back to source blog: `<a href="../blog/spec-kit-plan-forge.html" rel="noopener">Original blog post</a>`
- **MUST**: Cross-links to `crucible.html`, `customization.html`
- **MUST**: Includes a "See also" reference to the marketing page: `<a href="../speckit-interop.html">Marketing landing page</a>`

### "End-to-End Workflow: WhatsApp to Shipped PR" section in `remote-bridge.html`

- **MUST**: New `<h2 id="end-to-end-workflow">End-to-End Workflow: WhatsApp to Shipped PR</h2>` exists, placed after the Remote Bridge overview, before the per-channel reference
- **MUST**: References `unified-system-three-pillars.svg` via `<img>` with alt text describing the 3 pillars and inputs/outputs
- **MUST**: Walks through the 5 steps from `unified-system.html`:
  1. **Request capture** — WhatsApp message hits OpenClaw; OpenClaw queries OpenBrain for prior project context
  2. **Plan hardening** — OpenClaw activates `plan-forge-orchestrator` skill; Plan Forge hardens plan via Crucible
  3. **Slice-by-slice execution with captures** — each slice's decisions captured to OpenBrain
  4. **Independent review** — fresh-context review session (per Plan Forge's session isolation model)
  5. **Ship + Learn** — PR opened, lessons captured to OpenBrain for next phase
- **MUST**: Includes ACP context callout (1 paragraph): the Agent Client Protocol enables Copilot CLI to run as a programmable server; OpenClaw uses ACP to launch sessions, send prompts, and manage tool approvals. Link to upstream ACP docs.
- **MUST**: Cross-links to `crucible.html`, `how-it-works.html#why-session-isolation-works` (will exist after Phase-MANUAL-EVIDENCE), `memory-architecture.html#unified-memory-across-agents` (will exist after Slice 4 of this phase)
- **MUST**: Links back to source blog: `<a href="../blog/unified-system.html" rel="noopener">Original blog post</a>`

### `openbrain-cross-agent-compounding.svg`

- **MUST**: File exists, valid SVG with `<title>` and `<desc>`
- **MUST**: ViewBox dimensions appropriate for a sequence diagram (e.g. 900×400)
- **MUST**: 4 horizontal swim lanes labeled: Claude Code, OpenBrain, Cursor, Copilot
- **MUST**: 4 message arrows between lanes showing the compounding flow: (1) Claude → OpenBrain (capture decisions), (2) Cursor → OpenBrain (recall), (3) OpenBrain → Cursor (history), (4) Copilot → OpenBrain (recall full history)
- **MUST**: Color palette matches existing diagrams; OpenBrain swim lane uses amber `#f59e0b` highlight (it's the connective tissue)
- **MUST**: Inline text uses `'Inter', sans-serif`

### `speckit-import-field-mapping.svg`

- **MUST**: File exists, valid SVG with `<title>` and `<desc>`
- **MUST**: ViewBox dimensions appropriate for a 4-pair mapping (e.g. 800×400)
- **MUST**: 4 left-side boxes (Spec Kit files): `spec.md`, `plan.md`, `tasks.md`, `constitution.md`
- **MUST**: 4 right-side boxes (Plan Forge targets): Crucible spec section, Scope Contract baseline, Execution slices, PROJECT-PRINCIPLES.md
- **MUST**: 4 arrows connecting each pair, labeled with the mechanism (Crucible interview / contract seed / per-task → per-slice / direct copy)
- **MUST**: Color palette matches existing diagrams
- **MUST**: Inline text uses `'Inter', sans-serif`

### `unified-system-three-pillars.svg`

- **MUST**: File exists, valid SVG with `<title>` and `<desc>`
- **MUST**: ViewBox dimensions appropriate for an architecture block diagram (e.g. 1000×500)
- **MUST**: Inputs section (left): WhatsApp icon, Desktop icon, Voice icon — converging arrows to OpenClaw
- **MUST**: Three middle pillars labeled: "Plan Forge — Guardrails", "OpenBrain — Memory", "OpenClaw — Orchestration"
- **MUST**: Output section (right): Copilot CLI box, with arrow to "Shipped PR"
- **MUST**: ACP label on the OpenClaw → Copilot CLI connection
- **MUST**: Color palette matches existing diagrams; the 3 pillars distinguished by amber/blue/green to match Plan Forge / OpenBrain / OpenClaw branding established in the blog
- **MUST**: Inline text uses `'Inter', sans-serif`

### Navigation registry — `docs/manual/assets/manual.js`

- **MUST**: 1 new entry added to the `CHAPTERS` array, placed BEFORE the `about-author` entry:
  ```js
  { id: "spec-kit-interop", file: "spec-kit-interop.html", num: "", title: "Spec Kit Interop", act: "Appendix" },
  ```
- **MUST**: 1 new SEARCH_SECTIONS entry for `spec-kit-interop.html` with at least 5 anchors
- **MUST**: Existing SEARCH_SECTIONS entry for `memory-architecture.html` gains:
  - `{ t: "Unified Memory Across Agents", u: "memory-architecture.html#unified-memory-across-agents" }`
- **MUST**: Existing SEARCH_SECTIONS entry for `multi-agent.html` gains:
  - `{ t: "OpenBrain Connective Tissue", u: "multi-agent.html#openbrain-connective-tissue" }`
- **MUST**: Existing SEARCH_SECTIONS entry for `remote-bridge.html` gains:
  - `{ t: "End-to-End WhatsApp to Shipped PR", u: "remote-bridge.html#end-to-end-workflow" }`
- **MUST**: `node --check docs/manual/assets/manual.js` passes
- **MUST**: No existing CHAPTERS or SEARCH_SECTIONS entries reordered, renamed, or removed

---

## Execution Slices

9 slices total. Slices 2, 3, 4 (the three SVGs) are independent. Slice 5 (spec-kit chapter) depends on Slice 3. Slices 6, 7, 8 (chapter expansions) depend on Slices 2, 4, and 5 respectively. Slice 9 ties everything together.

### Slice 1: Read source blogs + target chapters + verify content [sequential]

**Goal**: Read-only context loading.

**Files**:
- READ: `docs/blog/seven-agents.html`
- READ: `docs/blog/spec-kit-plan-forge.html`
- READ: `docs/blog/unified-system.html`
- READ: `docs/manual/memory-architecture.html`
- READ: `docs/manual/multi-agent.html`
- READ: `docs/manual/remote-bridge.html`
- READ: `docs/manual/crucible.html`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)
- READ: `docs/manual/assets/manual.js`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `.github/instructions/context-fuel.instructions.md`

**What changes**: Nothing. Pure context loading.

**Validation Gate**:
```bash
grep -F "OpenBrain" docs/blog/seven-agents.html >/dev/null
grep -F "OpenClaw" docs/blog/unified-system.html >/dev/null
grep -F "ACP" docs/blog/unified-system.html >/dev/null
grep -F "spec.md" docs/blog/spec-kit-plan-forge.html >/dev/null
grep -F "constitution.md" docs/blog/spec-kit-plan-forge.html >/dev/null
echo ok
```

---

### Slice 2: Create `openbrain-cross-agent-compounding.svg` [sequential]

**Goal**: Author the 4-swim-lane sequence diagram.

**Files**:
- WRITE: `docs/manual/assets/diagrams/openbrain-cross-agent-compounding.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)

**Context Files**: (none — pure asset creation)

**What changes**: Create SVG with 4 swim lanes (Claude Code, OpenBrain, Cursor, Copilot). 4 message arrows showing compounding (capture → recall → history → recall full history). OpenBrain lane highlighted amber. `<title>` + `<desc>`.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/openbrain-cross-agent-compounding.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);if(!s.includes('<title'))process.exit(4);for(const w of ['Claude','OpenBrain','Cursor','Copilot']){if(!s.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 3: Create `speckit-import-field-mapping.svg` [sequential]

**Goal**: Author the 4-pair file-mapping diagram.

**Files**:
- WRITE: `docs/manual/assets/diagrams/speckit-import-field-mapping.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)

**Context Files**: (none — pure asset creation)

**What changes**: Create SVG with 4 left boxes (Spec Kit files), 4 right boxes (Plan Forge targets), 4 labeled arrows. `<title>` + `<desc>`.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/speckit-import-field-mapping.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);for(const w of ['spec.md','plan.md','tasks.md','constitution.md','Crucible','PROJECT-PRINCIPLES']){if(!s.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 4: Create `unified-system-three-pillars.svg` [sequential]

**Goal**: Author the 3-pillar architecture block diagram.

**Files**:
- WRITE: `docs/manual/assets/diagrams/unified-system-three-pillars.svg`
- READ: `docs/manual/assets/diagrams/quorum-complexity-rubric.svg` (style reference)
- READ: `docs/manual/assets/diagrams/enterprise-reference-architecture-generic.svg` (block-diagram style reference, if exists from Phase-ENTERPRISE-DOCS-HTML)

**Context Files**: (none — pure asset creation)

**What changes**: Create SVG with inputs (WhatsApp/Desktop/Voice icons → OpenClaw on left), 3 middle pillar boxes (Plan Forge / OpenBrain / OpenClaw, each color-distinguished), output (Copilot CLI → Shipped PR on right), ACP label on the OpenClaw → Copilot CLI connection. `<title>` + `<desc>`.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/assets/diagrams/unified-system-three-pillars.svg';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');if(!s.includes('<svg'))process.exit(2);if(!s.includes('</svg>'))process.exit(3);for(const w of ['Plan Forge','OpenBrain','OpenClaw','Copilot','ACP']){if(!s.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 5: Create `spec-kit-interop.html` chapter [sequential]

**Goal**: New manual chapter with 3-pillar comparison table, field-by-field import flow, and embedded SVG.

**Files**:
- WRITE: `docs/manual/spec-kit-interop.html`
- READ: `docs/blog/spec-kit-plan-forge.html`
- READ: `docs/manual/plan-forge-on-the-github-stack.html` (template reference)
- READ: `docs/manual/assets/diagrams/speckit-import-field-mapping.svg` (verify exists)

**Depends On**: Slice 3

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Create the chapter using the template skeleton. Sections: chapter intro (with 1-sentence ecosystem context), 3-pillar comparison table, `<h2 id="import-flow">` with embedded SVG + field mapping table + "Representative mapping" callout, `<h2 id="import-procedure">` with step-by-step procedure, `<h2 id="ecosystem-extensions">` for the cross-tool extension story. Reference voice. Link back to source blog at top. "See also" link to root marketing page.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/spec-kit-interop.html';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('Spec Kit Interop'))process.exit(2);if(!c.includes('speckit-import-field-mapping.svg'))process.exit(3);for(const id of ['import-flow','import-procedure','ecosystem-extensions']){if(!c.includes('id=\"'+id+'\"'))process.exit(10);}for(const f of ['spec.md','plan.md','tasks.md','constitution.md']){if(!c.includes(f))process.exit(20);}if(!c.includes('Representative mapping'))process.exit(30);if(!c.includes('spec-kit-plan-forge.html'))process.exit(31);console.log('ok')"
```

---

### Slice 6: Add "Unified Memory Across Agents" section to `memory-architecture.html` [sequential]

**Goal**: Insert new H2 section with embedded SVG.

**Files**:
- EDIT: `docs/manual/memory-architecture.html`
- READ: `docs/blog/seven-agents.html`
- READ: `docs/blog/unified-system.html`
- READ: `docs/manual/assets/diagrams/openbrain-cross-agent-compounding.svg` (verify exists)

**Depends On**: Slice 2

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Insert new `<h2 id="unified-memory-across-agents">Unified Memory Across Agents</h2>` after the existing tier-architecture description. Embed `openbrain-cross-agent-compounding.svg`. 4-step concrete walkthrough. Mechanism explanation. Agent-integration table. Cross-link to `multi-agent.html#openbrain-connective-tissue`. Link back to source blogs. Preserve all existing content.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/memory-architecture.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"unified-memory-across-agents\"'))process.exit(1);if(!c.includes('openbrain-cross-agent-compounding.svg'))process.exit(2);if(!c.includes('multi-agent.html#openbrain-connective-tissue'))process.exit(3);for(const blog of ['seven-agents.html','unified-system.html']){if(!c.includes(blog))process.exit(10);}console.log('ok')"
```

---

### Slice 7: Add "OpenBrain: The Connective Tissue" section to `multi-agent.html` [sequential]

**Goal**: Insert new H2 section near chapter end.

**Files**:
- EDIT: `docs/manual/multi-agent.html`
- READ: `docs/blog/seven-agents.html`

**Depends On**: Slice 6 (so the cross-link target exists)

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Insert new `<h2 id="openbrain-connective-tissue">OpenBrain: The Connective Tissue</h2>` near the chapter end. Killer-feature framing. 4-station x N-agent pattern. Copilot-only lifecycle hook limitation. Cross-link to `memory-architecture.html#unified-memory-across-agents`. Link back to source blog. Preserve all existing content.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/multi-agent.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"openbrain-connective-tissue\"'))process.exit(1);if(!c.includes('memory-architecture.html#unified-memory-across-agents'))process.exit(2);if(!c.includes('seven-agents.html'))process.exit(3);console.log('ok')"
```

---

### Slice 8: Add "End-to-End Workflow" section to `remote-bridge.html` [sequential]

**Goal**: Insert new H2 section after Remote Bridge overview, with embedded 3-pillar SVG.

**Files**:
- EDIT: `docs/manual/remote-bridge.html`
- READ: `docs/blog/unified-system.html`
- READ: `docs/manual/assets/diagrams/unified-system-three-pillars.svg` (verify exists)

**Depends On**: Slice 4

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**: Insert new `<h2 id="end-to-end-workflow">End-to-End Workflow: WhatsApp to Shipped PR</h2>` after the Remote Bridge overview. Embed `unified-system-three-pillars.svg`. 5-step workflow walkthrough. ACP callout. Cross-links to `crucible.html`, `how-it-works.html#why-session-isolation-works` (Phase-MANUAL-EVIDENCE adds this anchor), `memory-architecture.html#unified-memory-across-agents` (added in Slice 6). Link back to source blog. Preserve all existing content.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const p='docs/manual/remote-bridge.html';const c=fs.readFileSync(p,'utf8');if(!c.includes('id=\"end-to-end-workflow\"'))process.exit(1);if(!c.includes('unified-system-three-pillars.svg'))process.exit(2);if(!c.includes('ACP'))process.exit(3);if(!c.includes('unified-system.html'))process.exit(4);for(const w of ['Request capture','Plan hardening','Independent review']){if(!c.includes(w))process.exit(10);}console.log('ok')"
```

---

### Slice 9: Update navigation registry + final verification [sequential]

**Goal**: Register new chapter + 4 new search anchors, verify everything is consistent.

**Files**:
- EDIT: `docs/manual/assets/manual.js`

**Depends On**: All prior slices

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`

**What changes**:
- Insert 1 new CHAPTERS entry before the `about-author` entry:
  ```js
  { id: "spec-kit-interop", file: "spec-kit-interop.html", num: "", title: "Spec Kit Interop", act: "Appendix" },
  ```
  (Note: if Phase-MANUAL-EVIDENCE has already been merged and added `lessons-learned` and `project-history` entries, place this new entry alongside them, all before `about-author`. Order among the three appendices is not strict; alphabetical or chronological-by-phase both acceptable.)
- Add 1 new SEARCH_SECTIONS entry for `spec-kit-interop.html` with at least 5 anchors (chapter intro, import-flow, import-procedure, ecosystem-extensions, comparison)
- Append to the `memory-architecture.html` SEARCH_SECTIONS block:
  - `{ t: "Unified Memory Across Agents", u: "memory-architecture.html#unified-memory-across-agents" }`
- Append to the `multi-agent.html` SEARCH_SECTIONS block:
  - `{ t: "OpenBrain Connective Tissue", u: "multi-agent.html#openbrain-connective-tissue" }`
- Append to the `remote-bridge.html` SEARCH_SECTIONS block:
  - `{ t: "End-to-End WhatsApp to Shipped PR", u: "remote-bridge.html#end-to-end-workflow" }`

**Validation Gate**:
```bash
node --check docs/manual/assets/manual.js
node -e "const fs=require('fs');const m=fs.readFileSync('docs/manual/assets/manual.js','utf8');if(!m.includes('id: \"spec-kit-interop\"') && !m.includes('id:\"spec-kit-interop\"'))process.exit(1);for(const a of ['#unified-memory-across-agents','#openbrain-connective-tissue','#end-to-end-workflow','#import-flow']){if(!m.includes(a))process.exit(2);}if(!m.match(/about-author[\s\S]*\];/))process.exit(3);console.log('ok')"
test -f docs/manual/spec-kit-interop.html
test -f docs/manual/assets/diagrams/openbrain-cross-agent-compounding.svg
test -f docs/manual/assets/diagrams/speckit-import-field-mapping.svg
test -f docs/manual/assets/diagrams/unified-system-three-pillars.svg
echo ok
```

---

## Re-anchor Checkpoints

- **After Slices 2, 3, 4 (SVGs)**: Open each SVG in browser; confirm rendering, colors, labels.
- **After Slice 5 (spec-kit chapter)**: Open in browser; confirm all sections render, SVG embeds correctly, comparison table is readable.
- **After Slice 8 (remote-bridge expansion)**: Open chapter; confirm 5-step workflow renders cleanly with embedded 3-pillar SVG.
- **After Slice 9 (registry update)**: Open `docs/manual/index.html`; confirm sidebar shows Spec Kit Interop entry; click each new anchor link to confirm navigation.

---

## Definition of Done

- [ ] All 9 Execution Slices passed their validation gates
- [ ] All MUST acceptance criteria satisfied
- [ ] 1 new HTML chapter exists in `docs/manual/` (`spec-kit-interop.html`)
- [ ] 3 new SVG diagrams exist in `docs/manual/assets/diagrams/`
- [ ] `docs/manual/memory-architecture.html` contains the new H2 section with correct anchor ID
- [ ] `docs/manual/multi-agent.html` contains the new H2 section with correct anchor ID
- [ ] `docs/manual/remote-bridge.html` contains the new H2 section with correct anchor ID and embedded SVG
- [ ] `docs/manual/assets/manual.js` parses cleanly via `node --check` and contains all new CHAPTERS + SEARCH_SECTIONS entries
- [ ] All field mappings in spec-kit-interop chapter have a "Representative mapping" callout above them
- [ ] No first-person pronouns in new content (except inside cited quotations)
- [ ] `git diff --stat` shows changes only inside `docs/manual/`
- [ ] Root-level `docs/speckit-interop.html` is byte-identical to pre-execution
- [ ] No file in `pforge-mcp/`, `pforge-master/`, or root scripts modified
- [ ] `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` byte-identical to pre-execution
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**

---

## Stop Conditions

If any of the following occurs during execution, STOP and escalate:

1. **Out-of-scope file modification** — `git diff --stat` shows changes outside `docs/manual/`. Revert and complete the slice within scope.
2. **Root-level `docs/speckit-interop.html` accidentally modified** — Revert immediately. The new chapter is at `docs/manual/spec-kit-interop.html`.
3. **Field mapping fabricated without callout** — Reviewer Gate will flag this as fabricated content. Pause, add callout, re-do.
4. **WhatsApp-to-PR workflow has more or fewer than 5 steps** — The blog documents exactly 5 steps. Adding extras = fabrication; omitting = drift. Re-verify against `docs/blog/unified-system.html`.
5. **manual.js parse failure** — Stop, fix, re-run `node --check`. Don't proceed with broken JS.
6. **Existing CHAPTERS or SEARCH_SECTIONS entry accidentally modified** — Revert, re-do as pure insertion.

---

## Cost Estimate

Run `pforge run-plan --estimate docs/plans/Phase-MANUAL-INTEGRATIONS-PLAN.md` for an exact projection. Expected: $5–$9 (9 docs slices, 0 quorum-eligible, no code touched). For a quorum comparison across all 4 modes, run `forge_estimate_quorum({ planPath: "docs/plans/Phase-MANUAL-INTEGRATIONS-PLAN.md" })`.
