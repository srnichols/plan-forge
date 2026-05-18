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

1. **Above-the-fold positioning fix** — one sentence on `index.html`, `README.md`, and `what-is-plan-forge.html` that says explicitly: *Plan Forge is the orchestration harness on top of GitHub Copilot (and other AI coding tools); it does not replace your model or your IDE.* The full "harness on substrate" story already exists in Appendix H but is invisible to a first-contact reader — early-reader feedback shows that even GitHub-ecosystem-fluent readers default-assume Plan Forge is a Copilot alternative. This is the cheapest, highest-impact slice in the entire phase.
2. **Foreword** absorbing the existing blog posts into ebook voice ("From Impossible to Seven Minutes") **and** explicitly volunteering the positioning disclaimer in a paragraph titled *"What this book is **not**"*. The book has no origin story; the blog does.
3. **Cost & Economics chapter** — Plan Forge's biggest commercial question is *"how much will this cost me?"* and the manual doesn't answer it directly. The data is in the dashboard's Cost tab and in `forge_cost_report`; the narrative is missing. Lead with the **four levers** documented in §2 below (quality-at-constant-time, quality-per-extra-dollar, rework-avoidance, memory-as-subsidy) and the **compounding flywheel** observation — the cost curve bends downward over the life of a project, which is the opposite of what most engineering managers default-assume.

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
| 2 | **Cost & Economics** | Cost is referenced across 4 chapters and the Cost dashboard tab; no chapter teaches *budgeting a plan*: cost-per-slice in practice, when quorum is worth it, when `--quorum=speed` beats `--quorum=power`, how to set spend caps. **Bigger than the token-spend question**: the chapter has to make the **effort-savings / time-to-done / quality** case that lets a team lead or engineering manager justify adopting Plan Forge to their own boss. Today that argument lives in the blog; the manual asks the reader to assemble it themselves. | New chapter in **Part II (Forge)** |
| 3 | **Plan Pattern Library** | The manual teaches HOW to write a plan; readers want a *Design Patterns*-style catalog of plan archetypes (DB migration, refactor, multi-service rollout, spike+retire, bug-sweep) with skeleton templates | New **Appendix Y** |
| 4 | **Failure-Mode Catalog** | Troubleshooting Ch 15 is symptom-driven; a parallel catalog organized by Plan Forge *subsystem* (gate, quorum, watcher, OpenBrain, snapshot, model-pool, hub) keyed to "symptom → cause → fix" triples would be the single most-bookmarked page | New **Appendix Z** |

#### Why the Cost & Economics chapter is the highest-leverage one in Cluster C

The other Cluster C chapters answer reader questions a developer would ask in private. Cost &
Economics has to answer the question a **team lead emails their VP of Engineering** to get budget
approval. That's a different writing job, and it's the one the manual is most underprepared for
today.

The chapter should not lead with API pricing tables. It should lead with **the three numbers
that already exist in our own blog posts** and that nobody on the maintainer team has yet pulled
into a single page:

| Lever | Concrete evidence already in the repo | Source |
|---|---|---|
| **Quality at constant time** | Same model, same ~7-minute budget: **99/100 quality vs 44/100**. 4.6× more tests. The vibe-coded run "needed a rewrite of the architecture" to reach production. | [`docs/blog/ab-test-plan-forge-vs-vibe-coding.html`](../blog/ab-test-plan-forge-vs-vibe-coding.html) |
| **Quality per extra dollar** | Quorum mode: **+$0.22 per feature** ($0.62 → $0.84, +35%) buys 20% more tests, DRY helpers, and modern patterns. "The cheapest code review you'll ever buy." | [`docs/blog/quorum-mode-3-models.html`](../blog/quorum-mode-3-models.html) |
| **Rework avoidance** | The vibe run's extra minute was spent fighting 12 compilation errors and backtracking. Plan Forge's guardrails removed the rework loop, not added overhead. | [`docs/blog/ab-test-plan-forge-vs-vibe-coding.html`](../blog/ab-test-plan-forge-vs-vibe-coding.html) ("Guardrails don't slow you down. Rework slows you down.") |
| **Memory as a tier-downgrade subsidy** | After the v3.x memory upgrades (Hallmark + Anvil + Lattice + `forge_sync_memories`): **cost per slice ~$0.09 → $0.04 (−55%)**, **Sonnet-4.6 success rate ~78% → 91% (332/365 slices)**, **drift score −64% over 90 days**, **Opus-escalation rate dropped to ~0%** for memory-aware plans. The Phase-MEMORY-QA receipt: **7 slices for $0.07 total on Sonnet alone, zero failed slices**. | [`docs/manual/memory-system.html`](../manual/memory-system.html#cheaper-models) ("The memory upgrades subsidize the model choice.") |

Three reader personas this chapter has to serve, in this order:

1. **The team lead pitching their boss.** Needs a "Total Cost of a Feature" worksheet:
   *(plan-time tokens) + (build-time tokens) + (quorum overhead, if any) − (avoided rework hours
   × loaded engineer rate) − (avoided defects shipped to prod)*. The blog has the numerator; the
   manual has to teach the denominator.
2. **The engineering manager doing the rollout.** Needs a "When to spend more" decision tree —
   `--quorum=speed` for refactors, `--quorum=power` for security-sensitive or financial logic,
   no quorum for boilerplate. Plus spend caps (per-plan, per-day, per-month) and how to alert
   when a runaway slice burns through budget.
3. **The IC operator running a plan.** Needs the existing material: `forge_cost_report`, the
   Cost dashboard tab, per-model pricing, how `forge_estimate_quorum` projects spend *before*
   the run starts so the picker shows real dollar amounts.

**Token-efficiency angle** (often missed in cost discussions): Plan Forge's planning pass front-loads
context so the build pass spends fewer tokens re-discovering architecture. The 4-session model
deliberately starts each session with a fresh context window, which sounds wasteful but is
*cheaper* than letting a single conversation degrade into hallucination-driven rework. The chapter
should make this concrete with a token-count comparison from a real run (the `forge_cost_report`
output for one of our own phases would serve).

**The memory-system multiplier** (the most under-told part of the story today): a fresh session is
only cheaper than a degraded one *if* the new session starts smarter than the last one ended. That's
the job of the v3.x memory stack — **Hallmark** (provenance stamps that let the agent trust prior
records without re-deriving them), **Anvil** (the L3 boundary with a dead-letter queue so bad
captures don't poison context), **Lattice** (the code graph that turns "who calls this function?"
from a 50-second grep into a 50-millisecond query), and **`forge_sync_memories`** (knowledge
crosses session boundaries automatically). The cumulative effect, documented in
[`memory-system.html`](../manual/memory-system.html#cheaper-models), is that the cheaper model
(Sonnet-4.6) now succeeds on 91% of slices where it used to manage ~78%, while cost per slice
fell from ~$0.09 to $0.04 (−55%) and Opus-escalation rate effectively went to zero on
memory-aware plans. The chapter needs to **lift this story out of the memory chapter and put it in
the cost chapter where the budget conversation actually happens** — a team lead reading Part II
should not have to discover this benefit accidentally in Part IV.

The Cost & Economics chapter should also be explicit about the **compounding flywheel**: every
finished feature deposits decisions and lessons into OpenBrain. The next feature on the same
project starts with that context already loaded, which makes it both cheaper *and* higher-quality
than the previous feature. The cost curve bends downward over the life of a project, which is
exactly the opposite of what most engineering managers assume happens with AI tooling. That single
observation, backed by the −55% and −64% numbers above, is probably the most persuasive paragraph
the chapter will contain.

**What this chapter must NOT do**: become a price list. Per-token rates change quarterly; the
chapter must teach the *mental model* (cost per feature, cost per quality unit, cost of rework
avoided) so it stays useful when GPT-5-mini drops in price or when a new model joins the pool.

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
| 6 | **Above-the-fold positioning: "harness on substrate, not a Copilot replacement"** | [`github-stack-alignment.html`](../manual/github-stack-alignment.html) (Appendix H — the content is excellent but buried in the appendices) + [`plan-forge-on-the-github-stack.html`](../manual/plan-forge-on-the-github-stack.html) (Appendix I) | Promoted into **Foreword (A1)**, **What is Plan Forge? (existing chapter)**, **`index.html` hero**, and **README.md tagline** |

#### The hidden positioning gap (the "Microsoft-coworker test")

This is the single most surprising finding of the audit, and it didn't surface from re-reading the
manual — it surfaced from **early-reader feedback that even readers fluent in the GitHub/Copilot
ecosystem assumed Plan Forge was an alternative to Copilot rather than a layer on top of it.** If
that assumption forms at the homepage or in the first chapter, the rest of the manual is read
through the wrong frame and everything else (cost, security, plan workflow) gets misinterpreted.

The positioning *is* documented — Appendix H ([`github-stack-alignment.html`](../manual/github-stack-alignment.html))
is excellent. It introduces the "harness on substrate" metaphor, names the lane GitHub explicitly
leaves to the ecosystem, and ships an SVG of the full stack. Appendix I
([`plan-forge-on-the-github-stack.html`](../manual/plan-forge-on-the-github-stack.html)) is the
surface-by-surface technical companion. Together they're a complete answer.

The problem is **placement**. A new reader's path is roughly:

1. `index.html` (homepage) → mentions "Copilot" 20+ times, never says "Plan Forge does not
   replace Copilot"
2. `README.md` → same: lists Copilot as a prerequisite, never explicitly disclaims replacement
3. `what-is-plan-forge.html` → has the disclaimer ("Not an AI model. Plan Forge works with
   whatever AI you already use") at **line 231**, three screens below the fold
4. Appendix H → has the full answer, but it's **Appendix H**, and no reader reaches an appendix
   on first contact

Result: the positioning is correct but invisible to the audience most at risk of misreading it
(GitHub-ecosystem-fluent readers who already know Copilot does codegen and assume any other
"AI coding tool" must be competing).

**What the chapter / surface changes should do** (each is small and additive — not a rewrite):

1. **One-sentence positioning line at the top of three surfaces.** Same sentence, repeated
   verbatim, on `index.html` hero, `README.md` opening, and the first paragraph of
   `what-is-plan-forge.html`. Suggested wording:
   > *Plan Forge is the orchestration harness that sits **on top of** GitHub Copilot (and other AI
   > coding tools). It does not replace your model or your IDE — it adds the SDLC layer GitHub
   > deliberately leaves to the ecosystem: planning, validation gates, memory, cost control, and
   > reviewer separation.*
2. **Foreword (Slice A1) must explicitly say it.** The Foreword is where a confused reader's
   assumption gets locked in — it has to volunteer the disclaimer, not wait for the reader to ask.
   A single paragraph titled "What this book is **not**" early in the Foreword does this best.
3. **Promote the Appendix H SVG forward.** The "harness on substrate" diagram is the single
   most clarifying artifact in the entire manual. It belongs above-the-fold on `index.html` and as
   Figure 1 of the Foreword, not behind a sidebar click into Appendix H. Appendix H stays as the
   long-form reference; the diagram graduates to front-matter status.
4. **Add a "Plan Forge is / Plan Forge is not" table** to `what-is-plan-forge.html` immediately
   after the opening paragraph. Two columns, ~5 rows each. Mirrors the framing of Round 1's
   "Conventions used in this book" page — same editorial pattern, applied to identity instead of
   typography. This is the page that absorbs the line-231 disclaimer and gives it the prominence
   it should have had.

**Why this matters for the plan.** Item #6 should not be a standalone slice; it should be
**baked into Slices A1 (Foreword) and A2 (Reader-Journey Ladders) plus a small standalone edit
to `index.html` / `README.md` / `what-is-plan-forge.html`**. The execution plan
([`Phase-MANUAL-EBOOK-COMPLETION-PLAN.md`](../plans/Phase-MANUAL-EBOOK-COMPLETION-PLAN.md))
should grow a small new slice — call it **A6 — Above-the-fold positioning** — between A5 and
Cluster B. Cost: roughly one focused commit. Impact: prevents the wrong frame from forming in
the first thirty seconds of contact with the book.

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
5. **Positioning sentence — sign off on the exact wording.** The audit proposes (§2 Tier 2 / item 6):
   > *Plan Forge is the orchestration harness that sits **on top of** GitHub Copilot (and other AI
   > coding tools). It does not replace your model or your IDE — it adds the SDLC layer GitHub
   > deliberately leaves to the ecosystem: planning, validation gates, memory, cost control, and
   > reviewer separation.*
   Three places will repeat this verbatim (`index.html` hero, `README.md` opening,
   `what-is-plan-forge.html` first paragraph). Cheaper to argue the wording once, before it ships
   to three surfaces, than to drift them apart later. Sub-questions: do we name competitors ("…and
   other AI coding tools like Cursor, Claude, Codex") explicitly, or stay generic? Do we lead with
   "harness on substrate" (the metaphor that already exists in Appendix H) or with the plainer
   "sits on top of" framing used above?

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
