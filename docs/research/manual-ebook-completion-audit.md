# Plan Forge Manual — Ebook Completion Audit (Round 2)

> **Premise**: Re-read the manual not as an Apress acquisitions editor (that was [Round 1](manual-apress-publisher-review.md))
> but as a **reader buying a $40 ebook** on AI-Native SDLC. The Apress review focused on *scaffolding*
> (numbered figures, recap boxes, prereqs, PDF export). This round focuses on *content gaps* —
> chapters and references that an ebook reader expects to find but that the manual doesn't yet provide.
>
> **Status**: Discussion document. Drives the execution plan at
> [`docs/plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md`](../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md).
> **Scope reviewed**: Full TOC of `docs/manual/` (29 chapters across 5 Parts + 17 appendices),
> the blog inventory under `docs/blog/`, and the source surfaces (`pforge-mcp/EVENTS.md`,
> `docs/REST-API.md`, `pforge-mcp/capabilities.mjs`, `pforge.ps1`, `extensions/catalog.json`).
> **Date**: 2026-05-18.

---

## TL;DR — Reader's One-Page Verdict

> "It's already most of an ebook. The reference scaffolding is excellent — 90 MCP tools, 97 CLI
> commands, glossary, alphabetical book index, list of figures, unified API surface index. What's
> missing is the **content** that turns a reference manual into an ebook you'd actually *read*:
> the origin story, the case-study vignettes, a 'how do I…?' index, and a small handful of
> reference pages that everyone reaches for and currently can't find (`.forge.json` schema,
> environment variables, REST API, event payloads, cost economics, security threat model)."

If we only do **three things** from this list, do these:

1. **Foreword** absorbing the existing blog posts into ebook voice ("From Impossible to Seven Minutes"). The book has no origin story; the blog does.
2. **`.forge.json` Reference appendix** — every other Tier-1 reference gap is symptomatic of the same problem: readers go looking for the config schema and find nothing canonical.
3. **Cost & Economics chapter** — Plan Forge's biggest commercial question is *"how much will this cost me?"* and the manual doesn't answer it directly. The data is in the dashboard's Cost tab and in `forge_cost_report`; the narrative is missing.

The full execution plan ([`Phase-MANUAL-EBOOK-COMPLETION-PLAN.md`](../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md))
breaks the gap-closure into **16 independently shippable slices** across 3 clusters.

---

## 1 · What changed since the Apress review (Round 1)

The earlier review identified ~13 recommendations, ranked by impact/effort. Many of those have since
landed — worth listing what's done so this round doesn't re-recommend solved problems.

| Apress recommendation (Round 1) | Status today |
|---|---|
| 2.1 Numbered Figures and Listings | ✅ Done — Appendix P (List of Figures) exists; figures use `id="fig-N-M"` |
| 2.5 "Conventions used in this book" front-matter page | ✅ Done — `conventions.html` exists with edition history |
| Status / "What's new" badges | ✅ Done — `STATUS` registry in `manual.js` drives sidebar pills |
| Quickstart / "Hello World" | ✅ Done — Q1/Q2/Q3 quickstart cluster |
| Glossary + auto-generated A-Z index | ✅ Done — `glossary.html`, `book-index.html` |
| Audience / Persona ladders | ❌ Still missing — addressed by **Slice A2** below |
| Single-source export (PDF / single HTML) | ❌ Still missing — deferred (not in this phase; tooling concern) |
| Errata page | ❌ Still missing — deferred (lightweight; could fold into Project History) |
| End-of-Part wrap-ups | 🟡 Partial — some Parts have intros, no closers |
| "Try it yourself" exercises per chapter | ❌ Still missing — deferred (sample-project carries the load for now) |
| Sidebars (long-form named callouts) | 🟡 Partial — `lessons-learned.html` collects what could be embedded sidebars |
| Pull quotes / epigraphs | ❌ Deferred — stylistic, not a content gap |

**Verdict**: Round 1's scaffolding recommendations largely landed. What remains from Round 1
(audience ladders, single-source PDF, errata) is a mix of "addressed in Round 2's plan" (ladders =
Slice A2) and "deferred to a future tooling phase" (PDF export, errata page).

---

## 2 · Round 2 — Three tiers of remaining gap

### Tier 1A — Reference completeness (7 missing pages)

Pages that a reader **will go looking for** and currently can't find a canonical home for.

| # | Missing reference | Why a reader reaches for it | Suggested home |
|---|---|---|---|
| 1 | **`.forge.json` schema reference** | Config has ~20 top-level keys (`hooks.*`, `meta.*`, `quorum.*`, `costEstimator.*`, `liveguard.*`, `openclaw.*`, `cli.*`…). Customization Ch 9 covers *philosophy*, not the schema. | New **Appendix T** |
| 2 | **Environment variables reference** | `PFORGE_*`, `XAI_API_KEY`, `OPENAI_API_KEY`, `PFORGE_QUORUM_TURN`, `PFORGE_API_TOKEN` are mentioned in 5+ chapters with no single index | New **Appendix U** |
| 3 | **Lifecycle Hooks reference** | PreDeploy / PreCommit / PreAgentHandoff / PostSlice + `plan-forge.json` config are mentioned in 5 chapters; no one page documents them | New section in **Customization Ch 9** |
| 4 | **Event / WebSocket hub catalog** | Ch 11 says "60+ event types"; `pforge-mcp/EVENTS.md` has the data; no manual appendix documents payload shapes per event | New **Appendix V** (promote `EVENTS.md`) |
| 5 | **REST API reference** | `docs/REST-API.md` exists at repo root, not in the manual. App Q indexes REST but doesn't document it | New **Appendix W** (promote `REST-API.md`) |
| 6 | **Skills reference** | 11 skills per preset, only mentioned in passing in Customization | Section inside **Instructions & Agents Reference** |
| 7 | **Errors & exit codes** | `forge_*` tools return structured errors; CLI has exit codes; today the only way to learn them is to fail | Section in **Troubleshooting Ch 15** + new **Appendix X** with the flat table |

### Tier 1B — Domain chapters (4 missing chapters)

Chapters whose absence is **conspicuous given Plan Forge's stated audience** (enterprise + solo dev).

| # | Missing chapter | Why it's missing matters | Suggested home |
|---|---|---|---|
| 1 | **Security & Threat Model** | The book moves credentials, source code, and plan files through LLMs. App N (Compliance & Data Residency) covers regulatory framing; no chapter covers the *security posture* — what leaves your machine, prompt-injection mitigations, the extensions-catalog supply chain story | New chapter in **Part III (Guard)** |
| 2 | **Cost & Economics** | Cost is referenced across 4 chapters and the Cost dashboard tab; no chapter teaches *budgeting a plan*: cost-per-slice in practice, when quorum is worth it, when `--quorum=speed` beats `--quorum=power`, how to set spend caps | New chapter in **Part II (Forge)** |
| 3 | **Plan Pattern Library** | The manual teaches HOW to write a plan; readers want a *Design Patterns*-style catalog of plan archetypes (DB migration, refactor, multi-service rollout, spike+retire, bug-sweep) with skeleton templates | New **Appendix Y** |
| 4 | **Failure-Mode Catalog** | Troubleshooting Ch 15 is symptom-driven; a parallel catalog organized by Plan Forge *subsystem* (gate, quorum, watcher, OpenBrain, snapshot, model-pool, hub) keyed to "symptom → cause → fix" triples would be the single most-bookmarked page | New **Appendix Z** |

### Tier 2 — Story / ebook UX (5 missing pieces)

The manual reads as a **reference**, not an **ebook**. These slices supply the narrative arc that
turns it into something a reader works through cover-to-cover.

The user's blog (`docs/blog/*.html`) is the goldmine — most of the source material already exists
in marketing voice and needs absorbing into reference voice.

| # | Missing piece | Source material already exists in | Suggested home |
|---|---|---|---|
| 1 | **Foreword — "From Impossible to Seven Minutes"** | `the-journey-from-impossible-to-seven-minutes.html` + `the-80-20-wall.html` + `guardrails-lessons-learned.html` | New **Front Matter** chapter |
| 2 | **Reader-Journey Ladders ("Pick your path")** | The four personas: solo dev / team lead / reviewer / enterprise architect / extension author | New **Front Matter** chapter |
| 3 | **"A Day in the Forge" vignettes** | `the-loop-that-never-ends.html` + `ab-test-plan-forge-vs-vibe-coding.html` + `quorum-mode-3-models.html` | New **Appendix R** with 3 case studies |
| 4 | **Task-based "How do I…?" index** | All existing chapters — this is a navigational layer over them | New **Appendix S** |
| 5 | **"What's new in this Edition" banner** | `project-history.html#v3-6-openbrain-l3`, `conventions.html#edition-history` | Edit to **`index.html`** only |

---

## 3 · Tier 3 — Structural rebalancing (deferred)

Not blocking, not in the execution plan; recorded here so it isn't forgotten:

- **Part II is overloaded** (16 chapters vs 4–5 in Parts III/IV/V). The four Loop deep-dives (Self-Deterministic, Inner, Competitive, Audit) read like a mini-part "The Four Loops". The three Dashboard sub-pages want to be a Dashboard mini-part. Restructuring would be a separate phase.
- **17 appendices warrant a Part-front landing** ("Reference Material"). Currently a flat list.
- **`MEDIA` status pill** for chapters with companion videos / screencasts (when recorded). Slots into the existing STATUS registry.
- **Per-chapter "What you'll learn / Prerequisites / Next chapter" footer consistency pass** — most chapters have *some* version; a normalization pass would help.
- **Cross-reference glossary**: map Plan Forge terms to Claude Code / Cursor / Aider / OpenHands equivalents. Niche but powerful for migrating users.

---

## 4 · Why this round picks the slices it picks

The execution plan ([`Phase-MANUAL-EBOOK-COMPLETION-PLAN.md`](../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md))
orders work as **Cluster A (Story) → B (Reference) → C (Domain chapters)** even though the gap
analysis above is presented in the opposite order. The reasoning:

1. **Cluster A has the lowest risk + highest reader payoff.** Source material exists in `docs/blog/`;
   the slice is absorption into reference voice. No new research required.
2. **Cluster B unblocks Cluster C.** The Cost & Economics chapter (C2) wants to cite the
   `.forge.json` reference (B1) for `costEstimator.*`. The Security chapter (C1) wants to cite the
   env-vars reference (B2) and the event catalog (B4).
3. **Cluster C is the most editorial-writing-heavy.** Best done after the reference clusters are
   in place so they can be cross-linked instead of inlined.

Each slice is **one commit**. The manual's `maintain.mjs` validator is the gate (must report
`All checks passed — manual is in sync` twice consecutively).

---

## 5 · Open questions for the maintainer

These weren't resolved in the audit chat and want a thumbs-up before slice execution starts:

1. **Should the Foreword be signed?** Apress forewords usually are. The blog posts are first-person;
   the manual's voice is third-person. Three options:
   - (a) Third-person throughout, with no signature (consistent with the rest of the manual)
   - (b) Third-person body + a final signed paragraph ("— Scott Nichols, May 2026")
   - (c) First-person throughout, framed as "a letter from the author" (book-like, breaks the
     manual's voice convention once and then resumes)
2. **Vignette anonymity** — `docs/blog/ab-test-plan-forge-vs-vibe-coding.html` names a specific
   project. Do we keep the name in the vignette, or rename to "Project X" / "Tracker" to match the
   sample-project framing?
3. **"What's new" banner persistence** — should the banner disappear after the user dismisses it
   (per-edition `localStorage` key), or stay until the next edition ships?
4. **Edition bump trigger** — at what slice count do we bump the manual to **Fifth Edition (v3.x)**?
   The plan suggests ≥10 of 16 slices; some maintainers prefer "ship the edition when the foreword
   lands" because the foreword is the most ebook-visible change.

---

## 6 · Cross-references

- **Round 1 review** (Apress scaffolding focus): [`manual-apress-publisher-review.md`](manual-apress-publisher-review.md)
- **Execution plan** (slice-by-slice playbook): [`../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md`](../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md)
- **Source surfaces**:
  - Blog inventory: [`../blog/`](../blog/)
  - Tools manifest: `pforge-mcp/tools.json` (canonical tool count)
  - Event catalog source: `pforge-mcp/EVENTS.md`
  - REST API source: `docs/REST-API.md`
  - CLI source: `pforge.ps1` switch arms
- **Drift sweep that preceded this audit** (commit `d2494c8`): refreshed stale counts (88 → 90 MCP
  tools, 57 → 97 CLI commands) and fixed `maintain.mjs` regex bug that had silently skipped
  hyphenated count keys for several releases. That sweep cleaned the *numbers*; this round
  addresses the *content*.
