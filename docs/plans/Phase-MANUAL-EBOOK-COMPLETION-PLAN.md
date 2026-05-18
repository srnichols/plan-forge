# Phase MANUAL-EBOOK-COMPLETION — Close the gap between "reference manual" and "ebook + reference + story"

> **Status**: Draft. Ready for incremental execution slice-by-slice.
> **Tracks**: Docs only (`docs/manual/*.html`, `docs/manual/assets/manual.js`, `docs/manual/assets/diagrams/*.svg`). Optional source pulls from `docs/blog/*.html`, `docs/REST-API.md`, `pforge-mcp/EVENTS.md`. **No code under `pforge-mcp/`, `pforge-master/`, `scripts/`, or root.**
> **Estimated cost**: $30–$60 total across 19 slices (18 content slices + 1 QA closer) if LLM-assisted; $0 if hand-written. Each slice is independently shippable.
> **Pipeline**: Specify ✅ → Harden (per slice on demand) → Execute (slice at a time) → `node maintain.mjs` (must remain GREEN) → Commit + push.
> **Recommended starting cluster**: **Cluster A — Story (Tier 2)** because the source material already exists in `docs/blog/` and the highest reader-payoff/lowest-risk slices live here.

---

## Why this phase exists

The manual is structurally complete as a *reference* (29 chapters across 5 parts, 17 appendices, glossary, book-index, list-of-figures, unified API surface index). The editorial audit in chat on **2026-05-18** — captured as a research document at [`docs/research/manual-ebook-completion-audit.md`](../research/manual-ebook-completion-audit.md) — identified three categories of remaining gap that prevent it from reading as an **ebook + reference + story**:

| Tier | Category | Gap count | Source of fix |
|---|---|---|---|
| **1A** | Reference completeness | 7 missing pages | New chapters/appendices; some promote existing `*.md` files |
| **1B** | Domain chapters | 4 missing chapters | New writing; cite existing tools + blog posts |
| **2** | Story / ebook UX | 5 missing pieces | Mostly absorb `docs/blog/*.html` into manual voice |

Total: **18 content slices + 1 QA closer = 19 slices** across 4 clusters (A Story · B Reference · C Domain · D Closure). Each slice is one chapter/appendix/section/sweep, each independently shippable.

---

## Scope Contract

### In Scope

- New files under `docs/manual/`: chapters, appendices, SVG diagrams
- Edits to `docs/manual/assets/manual.js` (CHAPTERS, SEARCH_SECTIONS, STATUS, MANUAL_COUNTS registries)
- Edits to existing chapters when a slice explicitly adds a section or callout
- **Cross-reference edits to earlier chapters/appendices/`index.html`** so the new chapter is
  discoverable from the places a reader already passes through. Every slice is expected to touch
  ≥1 earlier file with a backward link — see the cross-ref map in
  [`docs/research/manual-ebook-completion-audit.md`](../research/manual-ebook-completion-audit.md#4a-editorial-convention-forward--backward-cross-references-on-every-slice) §4a
- **Diagram edits** — re-use of existing SVGs in `docs/manual/assets/diagrams/` (zero authoring
  cost) and authoring of new SVGs where the per-slice diagram map requires it — see
  [`docs/research/manual-ebook-completion-audit.md`](../research/manual-ebook-completion-audit.md#4c-diagram-requirements-per-slice) §4c
- Edits to `docs/manual/index.html` Appendices/Front Matter grid when a new appendix is added
- Re-runs of `node docs/manual/maintain.mjs` after every slice to propagate counts and regenerate `book-index.html` + `list-of-figures.html`

### Out of Scope

- Any change under `pforge-mcp/`, `pforge-master/`, `pforge-sdk/`, `extensions/`, root scripts, or `.github/`
- Modifying or deleting any blog post under `docs/blog/`
- Deleting or renumbering existing chapters/appendices (only inserts)
- New CSS files or new `manual.css` rules (use existing Tailwind utilities + `.chapter-content` styles)
- Hero images (use existing chapter hero pattern only)
- Tests (this is a docs phase; the validation gate is `node maintain.mjs` returning `All checks passed`)
- Translating any chapter to another language
- Audio / video / podcast assets (a future "MEDIA" status pill could mark companion videos, but recording them is out of scope here)
- Reordering Parts I–V or rebalancing Part II's chapter count (Tier 3 audit items deferred)

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected fix; lives in this list for every docs phase as a tripwire — a docs slice that touches it indicates an executor error)
- **Do NOT touch any file outside `docs/manual/` + `docs/blog/` (read-only) + the four root-of-truth source files listed below in "Source files"
- **Do NOT remove or alter** the `about-author` entry in `CHAPTERS` (must stay last in the Appendix array)
- **Do NOT reorder or rename existing `CHAPTERS` or `SEARCH_SECTIONS` entries** in `manual.js` — only insert new ones
- **Do NOT fabricate** numbers, costs, agent names, tool counts, or model identifiers. Pull from source files; if absent, use `<!--c:KEY-->` count tokens or mark the gap explicitly as `TBD`
- **Do NOT introduce** first-person voice in new content except inside direct quotations from the cited blog posts
- **Do NOT create** a new appendix letter that collides with an existing one. Current appendices end at **Q**. The next free letters are **R, S, T, U, V, W, X, Y, Z** in order. Use them in order; do not skip
- **Do NOT skip** `node docs/manual/maintain.mjs` after edits. A slice is not complete until two consecutive runs report `All checks passed — manual is in sync`
- **Do NOT bundle two slices into one commit**. Each slice = one commit so the history is reviewable

### Source files (read-only, treated as authoritative)

| Source | Authoritative for |
|---|---|
| `pforge-mcp/tools.json` | Tool names, count |
| `pforge.ps1` switch arms | CLI command names, count |
| `pforge-mcp/EVENTS.md` | WebSocket hub event catalog (canonical) |
| `docs/REST-API.md` | REST endpoints (canonical) |
| `pforge-mcp/capabilities.mjs` + `pforge-mcp/cli-schema.json` | Cross-check for tool/CLI references |
| `extensions/catalog.json` | Extension names, descriptions |
| `presets/dotnet/.github/instructions/`, `presets/typescript/.github/instructions/` | Instruction file names |
| `validate-setup.ps1` | Expected file counts per stack (e.g. `≥17 for dotnet`) |
| `docs/blog/*.html` | Story material (Cluster A) |

---

## Required Decisions

All resolved during plan drafting; no TBDs remain.

| # | Decision | Resolution |
|---|---|---|
| 1 | Cluster ordering | **Cluster A (Story) first**, then **B (Reference)**, then **C (Domain chapters)**. Story slices have ready source material in `docs/blog/`, lowest risk, highest reader payoff. Reference slices unblock the domain chapters (which cite them). |
| 2 | Appendix letter assignment | Continuous from current last (Q). R, S, T, U, V, W, X, Y assigned in slice order. List below in the slice table. |
| 3 | Domain chapter placement | Security & Threat Model → Part III (Guard). Cost & Economics → Part II (Forge), positioned after CLI Reference (Ch 8). Plan Pattern Library → Appendix. Failure-Mode Catalog → Appendix (separate from Troubleshooting Ch 15 which is symptom-driven). |
| 4 | Story material — new chapter vs Front Matter | Origin story → **Front Matter Foreword** (sits between `conventions.html` and Quickstart Q1). Vignettes → **Appendix** (sits with Sample Project / Lessons Learned cluster). Reader-Journey Ladders → **Front Matter** as a sibling to `conventions.html`. Task-based "How do I…?" → **Appendix**. |
| 5 | "What's new in this Edition" banner | Edit `index.html` only — add a dismissible `localStorage`-gated banner that shows the diff vs the previous edition. Banner copy lives inline; no new file. |
| 6 | Lifecycle Hooks reference — new chapter or section in Customization? | **Section in Customization Ch 9** + cross-link from `instructions-agents.html`. A standalone hooks chapter would be too thin (5 hooks); a section is the right granularity. |
| 7 | Skills Reference — appendix or section? | **Section in `instructions-agents-reference.html`**. Skills sit alongside instructions and agents conceptually; a separate appendix would fragment the reference. |
| 8 | Errors & Exit Codes — appendix or section? | **Section in Troubleshooting Ch 15** + a flat appendix table referenced from that section. The table belongs in the appendix; the narrative ("what to do when…") belongs in Ch 15. |
| 9 | Edition number after this phase ships | Bump to **Fifth Edition (v3.x)** once ≥10 of the 18 content slices ship. EDITION constant in `manual.js` gets updated as part of the slice that crosses the 10-slice threshold. The QA closer (Slice QA) verifies the bump actually fired. |
| 10 | Whether to register new chapters in the `STATUS` registry | Yes. Every new chapter/appendix from this phase gets `{ label: "NEW", version: "v3.x" }` so the sidebar shows the NEW pill. Set version to the actual ship version when the slice lands. |

---

## Acceptance Criteria (apply to every slice)

### HTML rules

- **MUST**: Markup matches an existing chapter template (e.g. `plan-forge-on-the-github-stack.html`, `memory-architecture.html`)
- **MUST**: Every `<h2>` and `<h3>` carries a stable `id` in kebab-case
- **MUST**: All cross-links to other manual pages use `.html` extensions and relative paths
- **MUST**: All inline code uses `<code>...</code>`; all code blocks use `<pre><code>...</code></pre>`
- **MUST**: Reference voice (third person, present tense) outside quoted blog material
- **MUST**: All callouts use existing Tailwind utility classes (no new CSS rules)
- **MUST**: Hardcoded counts (tools, CLI commands) use `<!--c:KEY-->VALUE<!--/c-->` markers from `MANUAL_COUNTS`, not literal numbers

### Registry rules

- **MUST**: Every new chapter/appendix is registered in the `CHAPTERS` array in `manual.js`
- **MUST**: Every new chapter/appendix has search anchors added to `SEARCH_SECTIONS` (≥3 anchors per page)
- **MUST**: Every new chapter/appendix appears in the regenerated `book-index.html` and `list-of-figures.html` (if it contains figures) after `node maintain.mjs`

### Validation gate (every slice)

```bash
cd docs/manual
node maintain.mjs   # must print "All checks passed — manual is in sync"
node maintain.mjs   # second run must be idempotent
```

### Commit message convention

```
docs(manual): <slice-label> — <one-line summary>

<2-4 sentence body explaining what was added/changed and which source files it cites.>
```

---

## Slice Plan

Slices are independent. Pick any one; finish it; commit; ship. No slice depends on another except where explicitly noted under "Depends on".

### Cluster A — Story (Tier 2) — start here

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **A1** | **Foreword — "From Impossible to Seven Minutes"** | New `docs/manual/foreword.html` registered in Front Matter | `docs/blog/the-journey-from-impossible-to-seven-minutes.html`, `docs/blog/the-80-20-wall.html`, `docs/blog/guardrails-lessons-learned.html` | — |
| **A2** | **Reader-Journey Ladders ("Pick your path")** | New `docs/manual/reader-paths.html` in Front Matter | The four personas: solo dev, team lead, reviewer, enterprise architect, extension author | — |
| **A3** | **"A Day in the Forge" vignettes** | New Appendix **R** at `docs/manual/day-in-the-forge.html` with 3 case studies | `docs/blog/the-loop-that-never-ends.html`, `docs/blog/ab-test-plan-forge-vs-vibe-coding.html`, `docs/blog/quorum-mode-3-models.html` | — |
| **A4** | **Task-based "How do I…?" index** | New Appendix **S** at `docs/manual/how-do-i.html` — task → chapter map, ~40 entries | All existing chapters | — |
| **A5** | **"What's new in this Edition" banner** | Edit only `docs/manual/index.html` — dismissible `localStorage`-gated banner. Update `EDITION` in `manual.js` if ≥10 slices have shipped | `docs/manual/project-history.html#v3-6-openbrain-l3`, `conventions.html#edition-history` | A1–A4 (banner copy references them) |
| **A6** | **Above-the-fold positioning ("harness on substrate, not a Copilot replacement")** | Three small edits with **one verbatim sentence repeated across them**: (a) hero band of `docs/index.html`, (b) opening of `README.md`, (c) first paragraph of `docs/manual/what-is-plan-forge.html`. Plus a new "Plan Forge **is** / Plan Forge **is not**" two-column table in `what-is-plan-forge.html`, and a re-use of the Appendix H stack SVG above the fold (don't re-author; reference / inline-copy the existing markup) | [`docs/manual/github-stack-alignment.html`](../manual/github-stack-alignment.html) (Appendix H), [`docs/manual/plan-forge-on-the-github-stack.html`](../manual/plan-forge-on-the-github-stack.html) (Appendix I), line 231 of `what-is-plan-forge.html` (current disclaimer to absorb) | — (independent; safe to ship first if the maintainer wants the positioning fix in production fast) |
| **A7** | **Stakeholder Briefing ("white paper inside the ebook") + public tailoring flow** | Three deliverables: (1) `docs/manual/stakeholder-briefing.html` — the canonical 8-section briefing in Front Matter between A1 and A2, ≤3000 words, 10–15 min read; (2) `docs/manual/stakeholder-briefing-template.md` — fill-in-the-blanks template with `<<COMPANY>>`, `<<SQUADS>>`, `<<KPIS>>`, `<<PILOT_TIMELINE>>`, `<<THE_ASK>>` placeholders + inline guidance comments; (3) `.github/skills/stakeholder-briefing.skill.md` — `/stakeholder-briefing` slash-command skill (sibling of `/release-notes` etc.) that prompts for placeholders, optionally crawls a `--source-dir` of customer materials via `forge_search`, and emits the filled template. Briefing's closing Section 8 is a three-path ladder (template · skill · community) replacing the original “contact us” CTA. | The reusable ~50% of the per-prospect briefings already being written (example artifact held privately by the maintainer, sections 1/4/6/8/9/11/AppA), plus the canonical numbers from `manual.js` count tokens (no new sources of truth) | A6 (positioning sentence locked), C2 source-of-truth for cost levers (the briefing copies the cost-levers table verbatim so they can't drift). Open question #6 in the audit asks whether the skill (deliverable 3) ships with A7 or splits into A7.1 — audit recommends single A7. |

### Cluster B — Reference completeness (Tier 1A)

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **B1** | **`.forge.json` Reference** | New Appendix **T** at `docs/manual/forge-json-reference.html` — field-by-field table with type, default, example, change-impact | `pforge-mcp/capabilities.mjs`, `.forge.json` examples across the repo, `presets/*/.forge.json` | — |
| **B2** | **Environment Variables Reference** | New Appendix **U** at `docs/manual/env-vars-reference.html` — alphabetized table | `grep -r "process.env\." pforge-mcp/`, `grep -r "PFORGE_\|XAI_\|OPENAI_" pforge.ps1`, secrets handling in `pforge-mcp/secrets.mjs` | — |
| **B3** | **Lifecycle Hooks Reference** | New section in `docs/manual/customization.html#lifecycle-hooks` + cross-link from `instructions-agents.html` | `templates/.github/hooks/`, `.github/hooks/`, README per hook | — |
| **B4** | **Event Catalog** | New Appendix **V** at `docs/manual/event-catalog.html` — promote and reformat `pforge-mcp/EVENTS.md` into manual voice with anchors per event | `pforge-mcp/EVENTS.md`, `pforge-mcp/hub.mjs` | — |
| **B5** | **REST API Reference** | New Appendix **W** at `docs/manual/rest-api-reference.html` — promote `docs/REST-API.md` into manual voice; group by domain; cross-link from `api-surface-index.html` | `docs/REST-API.md`, `pforge-mcp/server.mjs` Express routes | — |
| **B6** | **Skills Reference** | New section in `docs/manual/instructions-agents-reference.html#skills` + per-skill subsections | `presets/dotnet/.github/prompts/skills/*`, `presets/typescript/.github/prompts/skills/*` | — |
| **B7** | **Errors & Exit Codes** | New section in `docs/manual/troubleshooting.html#errors-and-exit-codes` + new Appendix **X** at `docs/manual/exit-codes.html` with the flat table | `pforge.ps1` exit codes, `pforge-mcp/server.mjs` error shapes, `forge_*` tool error returns | — |

### Cluster C — Domain chapters (Tier 1B)

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **C1** | **Security & Threat Model chapter** | New chapter in Part III (Guard) at `docs/manual/security-threat-model.html`, num: "20a" or insert as new chapter — decide at slice harden time | `docs/blog/guardrails-lessons-learned.html`, `pforge-mcp/secrets.mjs`, `pforge-mcp/audit-export.mjs`, `extensions/catalog.json` supply chain story | B2 (env-vars ref), B4 (event catalog) |
| **C2** | **Cost & Economics chapter** | New chapter in Part II (Forge) after Ch 8 at `docs/manual/cost-economics.html` | `pforge-mcp/cost-service.mjs`, `pforge-mcp/foundry-quota.mjs`, `forge_cost_report` + `forge_estimate_quorum` outputs, `docs/blog/quorum-mode-3-models.html` | B1 (`.forge.json` reference for `costEstimator.*`) |
| **C3** | **Plan Pattern Library** | New Appendix **Y** at `docs/manual/plan-patterns.html` — 15–30 archetypes (DB migration, refactor, multi-service rollout, spike+retire, bug-sweep, etc.) with skeleton templates | `docs/plans/examples/`, `docs/plans/archive/Phase-*-PLAN.md`, `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md`, `docs/plans/DEPLOYMENT-ROADMAP-TEMPLATE.md` | — |
| **C4** | **Failure-Mode Catalog** | New Appendix **Z** at `docs/manual/failure-modes.html` — organized by Plan Forge subsystem (gate, quorum, watcher, OpenBrain, snapshot, model-pool, hub) with symptom→cause→fix triples | `pforge-mcp/orchestrator.mjs` failure paths, `troubleshooting.html` symptoms, `BUG-*.md` files in `docs/plans/archive/`, `/memories/repo/*-defects-*.md` | B7 (exit codes) |

### Cluster D — Phase closure

| # | Slice | Output | Source | Depends on |
|---|---|---|---|---|
| **QA** | **Phase-completion sweep + cross-ref audit** | Sweep report appended to [`docs/research/manual-ebook-completion-audit.md`](../research/manual-ebook-completion-audit.md) as new **§7 “What actually shipped”** — pass/fail per check (1–8) of audit §4b, plus a short narrative of any deferred or follow-up items. The sweep **does not auto-fix**; missing items are named and become explicit follow-up commits by each slice's original author. | The slice tables in this plan, the cross-ref map in audit §4a, the diagram map in audit §4c, `node maintain.mjs` output, the current state of `docs/manual/assets/manual.js` registries | ALL content slices A1–A7, B1–B7, C1–C4 shipped (or explicitly deferred with a recorded reason) |

---

## Per-slice playbook (apply to any slice)

1. **Pick the slice** from the table above
2. **Read the listed sources** end-to-end (use `read_file` or open them in the editor)
3. **Re-read [`docs/manual/conventions.html`](../manual/conventions.html)** for typography + voice rules
4. **Open a template chapter** that matches the slice's structure (e.g. `plan-forge-on-the-github-stack.html` for a reference appendix, `memory-architecture.html` for a narrative chapter with a single hero diagram, `liveguard-runbooks.html` for a runbook-style appendix)
5. **Draft** the new file or section, following the HTML rules above
6. **Add forward cross-references** inside the new chapter to every other chapter/appendix that develops a topic the new chapter touches. Use the cross-ref map in [`docs/research/manual-ebook-completion-audit.md`](../research/manual-ebook-completion-audit.md#4a-editorial-convention-forward--backward-cross-references-on-every-slice) §4a as the **minimum** — add more if drafting surfaces them.
7. **Add backward cross-references** by editing ≥1 earlier chapter/appendix/`index.html` so the new chapter is discoverable from the places a reader already passes through. The slice's commit message must enumerate these backward-edit files — a commit listing only the new chapter is presumptively incomplete.
8. **Register** the new file in `manual.js`:
   - Add to `CHAPTERS` in the correct `act` group, in the correct position (numbered or appendix-letter slot)
   - Add ≥3 entries to `SEARCH_SECTIONS` covering the page's main H2 anchors
   - Add to `STATUS` registry if it's a new chapter/appendix: `{ label: "NEW", version: "v3.x" }`
9. **Run `node docs/manual/maintain.mjs` twice** — both runs must end with `All checks passed — manual is in sync`. If the first run rewrites count tokens, the second run validates idempotence.
10. **Commit** with the convention above. One slice = one commit.
11. **Push** to `master`.
12. **Mark the slice complete** in this file by adding `✅` next to the slice ID below.

---

## Progress tracker

> Update this section after each slice ships. The status reflects what is on `master`.

### Cluster A — Story
- [x] **A1** Foreword ✅ (v3.6.2 · commit pending)
- [x] **A2** Reader-Journey Ladders ✅ (v3.6.2 · commit pending)
- [x] **A3** "A Day in the Forge" vignettes (Appendix R) ✅ (v3.6.2 · commit pending)
- [x] **A4** Task-based "How do I…?" index (Appendix S) ✅ (v3.6.2 · commit pending)
- [x] **A5** "What's new in this Edition" banner ✅ (v3.6.2 · commit pending)
- [x] **A6** Above-the-fold positioning (harness-on-substrate) ✅ (v3.6.2 · commit pending)
- [x] **A7** Stakeholder Briefing (white paper inside the ebook) ✅ (v3.6.2 · commit pending)

### Cluster B — Reference
- [x] **B1** `.forge.json` Reference (Appendix T) ✅ (v3.6.2 · commit pending)
- [x] **B2** Environment Variables Reference (Appendix U) ✅ (v3.6.2 · commit pending)
- [x] **B3** Lifecycle Hooks Reference (section in Customization) ✅ (v3.6.2 · EDITION bumped 3.5.1→3.6.2 Fifth Edition · commit pending)
- [x] **B4** Event Catalog (Appendix V) ✅ (v3.6.2 · commit pending)
- [x] **B5** REST API Reference (Appendix W) ✅ (v3.6.2 · commit pending)
- [x] **B6** Skills Reference (section in Instructions & Agents Reference) ✅ (v3.6.2 · commit pending)
- [x] **B7** Errors & Exit Codes (section in Troubleshooting + Appendix X) ✅ (v3.6.2 · commit pending)

### Cluster C — Domain chapters
- [x] **C1** Security & Threat Model chapter (Part III) ✅ (v3.6.2 · Chapter 30 · commit pending)
- [x] **C2** Cost & Economics chapter (Part II) ✅ (v3.6.2 · Chapter 31 · commit pending)
- [x] **C3** Plan Pattern Library (Appendix Y) ✅ (v3.6.2 · 14 patterns · commit pending)
- [ ] **C4** Failure-Mode Catalog (Appendix Z)

### Cluster D — Phase closure
- [ ] **QA** Phase-completion sweep + cross-ref audit (runs last; depends on all content slices)

---

## Branch strategy

- All slices commit directly to `master` (consistent with this repo's existing docs flow — see commits `e6ef66e`, `d2494c8`, `903d395`)
- One slice = one commit (no batching)
- After 4–6 slices ship, consider bumping the manual `EDITION` constant and shipping a `Fifth Edition` release tag

## Rollback plan

Each slice is a single commit touching docs only. To roll back:

```powershell
git revert <slice-commit-sha>
git push origin master
cd docs/manual; node maintain.mjs   # confirm GREEN after revert
```

No production behaviour changes; nothing to roll back beyond the manual itself.

## Cost & risk

- **LLM cost**: ~$2–4 per slice if drafted with assistance. Total ~$30–$60 across 19 slices (18 content + 1 QA closer; QA is cheap because it's mostly `grep` + `Test-Path`).
- **Risk**: LOW. Docs only. No code paths touched. `maintain.mjs` is the gate; if it goes RED, the slice is incomplete.
- **Reviewability**: HIGH. Each slice is one chapter or appendix with a single commit.

---

## Suggested first slice

**A1 — Foreword ("From Impossible to Seven Minutes")**

Three blog posts already do this work in marketing voice; the slice is a focused absorption into ebook voice:

- `docs/blog/the-journey-from-impossible-to-seven-minutes.html` — the arc
- `docs/blog/the-80-20-wall.html` — the problem that crystallized the design
- `docs/blog/guardrails-lessons-learned.html` — the wisdom that comes after the arc

Output: ~3–4 page Front Matter chapter at `docs/manual/foreword.html`, registered in `CHAPTERS` between `conventions.html` and `quickstart-install.html` with `act: "Front Matter"` and `num: ""`. Add ≥3 SEARCH_SECTIONS anchors. Add to STATUS as `{ label: "NEW", version: "v3.7" }` (or whatever the next-ship version is).

That's the natural entry point for the "ebook" framing the audit identified — every great technical book has one, this one doesn't yet, and the raw material is sitting in `docs/blog/` already.
