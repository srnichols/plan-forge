# Plan Forge Manual — Apress Publisher Review

> **Premise**: Re-read the Plan Forge Manual as if we were an Apress acquisitions editor preparing it
> for the **Pro / Expert / Illustrated** series. What would a tech-book publisher push us to add,
> tighten, or formalize before signing the contract?
>
> **Status**: Discussion document. No changes proposed yet — these are ideas to triage together.
> **Scope reviewed**: `docs/manual/index.html` + spot-check of 8 chapters and the auto-generated book index.

---

## TL;DR — Editor's One-Page Verdict

> "This is already most of an Apress book. The skeleton is *better* than most of what we ship —
> Parts, Chapters, Appendices, a 1,500-entry book index, a glossary, status pills, callouts, hero
> art per chapter. What's missing is the **reader scaffolding** that a paid book provides on every
> page: chapter learning objectives, end-of-chapter recaps, numbered Figures and Listings,
> cross-references by Figure number, audience/difficulty markers, and a printable single-source PDF.
> Add that scaffolding and you have a book — not just docs."

If we only do **three things** from this list, do these:

1. **Numbered Figures & Listings** (Apress signature — `Figure 5-1`, `Listing 3-2`) with captions.
2. **Per-chapter "What you'll learn" intro + "Recap" outro** boxes (templated, 30-min add per chapter).
3. **A printable / single-page "Book PDF" build target** (so the manual ships as one artifact too).

---

## 1 · What the manual already does well (Apress would keep these)

| Apress hallmark | Plan Forge equivalent | Verdict |
|---|---|---|
| Parts → Chapters → Appendices | Part I-IV (Smelt/Forge/Guard/Learn) + Appendices A-O | ✅ Excellent |
| Foreword / About the Author | `about-author.html` | ✅ Present, well-placed |
| Glossary | `glossary.html` | ✅ Present |
| Index | `book-index.html` (auto-generated A-Z, with letter jump-bar) | ✅ Better than most published books |
| Quickstart / "Hello World" | 30-min Quickstart (Install → First Plan → Ship) | ✅ Better than most |
| Status / "What's new" badges | `NEW v2.58` / `UPDATED` / `BETA` pills | ✅ Editorial-grade |
| Callouts (Note / Tip / Warning) | `callout callout-info / -tip / -warning` | ✅ Three-flavor, color-coded |
| Hero image per chapter | `chapter-hero` JPGs | ✅ Distinctive — better than Apress's stock |
| "Reader path" tiles | "Where to next?" 4-tile picker (new / GitHub / extending / other stack) | ✅ More modern than Apress |
| Per-chapter prev / next nav | `#chapter-prev-next` | ✅ Present |
| Code blocks with file labels | `cmd-block-header` showing `.forge.json`, `Terminal`, etc. | ✅ Excellent |
| Cross-references | "See also" links, "Further reading" sections in some chapters | ⚠️ Inconsistent (see §3) |
| Sample / capstone project | `sample-project.html` (Tracker app, 5 phases) | ✅ Apress would call this "Chapter Project" |

**Editor's note**: The audience-tile pattern, status pills, and auto-generated index are *better than what Apress ships*. We should not copy Apress backwards.

---

## 2 · What an Apress editor would push us to add

Ranked by impact-to-effort.

### 🔥 High impact / Low effort

#### 2.1 Numbered Figures and Listings ("Figure 5-1, Listing 3-2")

**Current state**: Images and `<pre>` blocks are unnumbered. They're referenced inline as "see the diagram below" or "the example shows…".

**Apress pattern**: Every figure and code listing gets a number scoped to its chapter (`Figure 5-1`, `Listing 5-3`) and a one-line caption underneath. In-text references say `(see Figure 5-1)` so a reader can hunt for it across the page (or in a printed version) without scrolling guesswork.

**Why it matters**: Numbered references make the manual feel **authoritative**. They also unlock a "List of Figures" / "List of Listings" appendix — Apress's standard back-matter that helps readers find a remembered diagram without grepping.

**Suggested implementation**:
- Add a `<figure>` wrapper with `<figcaption>` rendering "Figure {N}-{M}. {caption}".
- Auto-number via `maintain.mjs` on build (so authors don't hand-number).
- Add `Appendix P: List of Figures` and `Appendix Q: List of Listings` (auto-generated like `book-index.html`).
- **Discussion**: do we go all-in on numbering, or only number diagrams (skip code blocks)? Apress numbers both.

#### 2.2 "What you'll learn" intro box + "Recap" outro box per chapter

**Current state**: Each chapter has a 1-line subtitle (e.g., *"Tour of the Forge Shop: four stations, the gates between them, and the sessions that keep them honest."*). That's it. Chapters end on the prev/next nav.

**Apress pattern**: Every chapter opens with a 3-5 bullet "In this chapter you'll learn" box, and closes with a "Summary / Recap / Key takeaways" box of equal length. The reader can read just the boxes and know whether to invest in the body.

**Suggested implementation**:
- New CSS class `chapter-objectives` (top) and `chapter-recap` (bottom).
- 3-5 bullets each.
- For long chapters (CLI Reference, MCP Server Reference) the recap is a 1-table cheat-sheet rather than bullets.
- Could be **templated** — `maintain.mjs` could enforce that every non-reference chapter has both blocks (lint rule).

**Effort**: ~30 min per chapter × 24 chapters = ~12 hours of editorial work, paid back forever in skim-ability.

#### 2.3 Difficulty / Audience markers per chapter

**Current state**: The Parts (Smelt/Forge/Guard/Learn) implicitly group by topic, but there's no signal for *who should read this when*. A solo dev and a fleet operator both see "Chapter 14 · Advanced Execution" and have to guess.

**Apress pattern**: "Pro" series uses 🟢 Beginner / 🟡 Intermediate / 🔴 Advanced ribbons. "Illustrated" uses persona icons.

**Suggested implementation**:
- Add a `chapter-tags` row beside the chapter number: `🟢 Apprentice` / `🟡 Smith` / `🔴 Master`, plus persona tags (`👤 Solo Dev`, `🏢 Fleet Op`, `🛡️ Security`).
- Render in the chapter grid on `index.html` and at the top of each chapter.
- Aligns nicely with the existing "apprentice → master smith" metaphor.

#### 2.4 "Prerequisites" and "If you've read X, you can skip Y" at the top of each chapter

**Current state**: Chapter 5 dives into plan structure assuming you've read Chapter 4. Chapter 14 (Advanced Execution) assumes you understand the Inner Loop deep-dive, but doesn't say so.

**Apress pattern**: Each chapter starts with a "Before you read this chapter" line: *"Read Chapter 3 (Installation) first. Familiarity with Chapter 5 helps but isn't required."*

**Suggested implementation**:
- 1-line `chapter-prereqs` block above the H1, color-coded subtle slate.
- Explicit "skippable if…" hints reduce the perceived size of the manual.

### 🟡 High impact / Medium effort

#### 2.5 A "How to use this book" front-matter chapter

**Current state**: Reader lands on the cover, sees "24 chapters · 14 appendices" and has to figure out the conventions on their own — what the colored pills mean, what the callout flavors mean, that there's an A-Z index, that `pforge smith` is the universal sanity check.

**Apress pattern**: Every Apress book has a 2-page **"Conventions used in this book"** section: *Italics mean filenames, monospace means code, the lightbulb icon means a Tip, the warning icon means…*

**Suggested implementation**:
- Insert a new short page `conventions.html` between the cover and Quickstart.
- Cover: callout legend, status-pill legend, status pills (NEW/UPDATED/BETA), code-block header conventions, the chapter-numbering scheme, where to find the index/glossary, how to report errata.
- Roughly 1 screen long. Sets tone immediately.

#### 2.6 Single-source export — "Download the manual as one HTML / PDF"

**Current state**: 56 chapter files. No way to grab the whole manual at once. Web-only.

**Apress pattern**: The book *is* a single PDF/EPUB. Even when serialized online, there's always a "Download the entire book" link. This is the artifact Apress sells.

**Why it matters for us**:
- **Air-gapped enterprises** (we already pitch them in `compliance-and-data-residency.html`) can't browse the website. They need the manual on disk.
- **Offline reading** on a plane / commute — a real differentiator for "I'll teach my team Plan Forge this weekend."
- **Single-source search** — `Ctrl+F` across the whole manual at once.

**Suggested implementation**:
- New build target in `maintain.mjs`: concatenate all chapter HTML in order, strip the sidebar/nav chrome, render Quickstart → Part I → … → Appendices → Index.
- Output: `docs/manual/plan-forge-manual.html` (one big HTML file) and optionally `plan-forge-manual.pdf` (via `puppeteer` or `prince-html` headless render).
- Add a "📥 Download manual (HTML / PDF)" link on the cover and at the bottom of `index.html`.
- Bonus: include a generated date and a content hash, so air-gapped teams can prove they're on a known edition.

#### 2.7 An Errata page

**Current state**: The meta-bar mentions "edition" and points at the changelog. There's no canonical place to surface "we got this wrong, here's the fix" between releases.

**Apress pattern**: `apress.com/book/<isbn>/errata` is permanent. Every reported error gets a page, the page links to the GitHub commit that fixed it, and the print run that incorporates the fix.

**Suggested implementation**:
- New `docs/manual/errata.html`, auto-generated from a structured `errata.json` or from issues labeled `manual-errata` on GitHub.
- Each entry: chapter / section, what was wrong, what's correct, fix-commit hash, edition fixed.
- Links from the meta-bar.

### 🟡 Medium impact / Medium effort

#### 2.8 End-of-Part wrap-ups ("You've finished Part II. Here's what you can now do.")

**Current state**: Part II ends silently — the next chapter just starts. There's no moment for the reader to *land*.

**Apress pattern**: Each Part has its own title page with a one-paragraph intro, and ends with a "Bringing it all together" section that names the skills you've now acquired and previews the next Part.

**Suggested implementation**:
- 4 new pages: `part-i-smelt.html`, `part-ii-forge.html`, `part-iii-guard.html`, `part-iv-learn.html`.
- Each is a half-screen reader-pause: "You've now learned to smelt an idea into a Scope Contract. Part II turns that contract into shipped code."
- Linked between the last chapter of one Part and the first chapter of the next.

#### 2.9 "Try it yourself" exercises at chapter ends

**Current state**: `sample-project.html` (Appendix E) carries all the hands-on exercises. Most chapters are read-only.

**Apress pattern**: Every chapter in Pro/Expert series ends with 2-4 exercises (graded by difficulty). The Tracker capstone is the *final* exercise — but the per-chapter exercises build muscle memory along the way.

**Suggested implementation**:
- New `chapter-exercises` block before the prev/next nav.
- Each chapter gets 1-3 short exercises (~5-15 min each), tied to the Tracker capstone where possible: *"Open the plan you wrote in Chapter 4. Add a Forbidden Action that blocks edits to `appsettings.json`. Re-run `forge_validate` and confirm the gate fires."*
- Don't grade them — Apress doesn't either. The point is to make the reader put the book down and try.

#### 2.10 Sidebars (long-form named callouts)

**Current state**: We have callouts (info / tip / warning) — short, inline. We don't have **named sidebars** ("From the Trenches: A 3 a.m. Production Story").

**Apress pattern**: Sidebars are the seasoning. They're 100-300 word boxes with their own title, set apart visually, that share a war story, a deeper dive, or a meta-comment that doesn't belong in the main flow.

**Suggested implementation**:
- New `<aside class="sidebar">` with a `<header class="sidebar-title">` slot.
- A handful of high-value sidebars first: *"From the Trenches: When the Audit Loop Saved a Friday Deploy"* in `audit-loop.html`, *"Why we built Forge-Master read-only"* in `forge-master.html`.
- Many of the existing `lessons-learned.html` entries could become sidebars **embedded in the relevant chapter** instead of living off in their own room.

### 🟢 Lower priority but easy wins

#### 2.11 Captions under diagrams (even without Figure numbers)

**Current state**: Diagrams have rich `alt` text but no visible caption. A sighted reader sees the diagram with no label.

**Quick fix**: Add a `<figcaption>` under each `<img class="diagram-img">` with the same one-line summary that's currently in `alt`. Costs nothing, looks instantly more book-like.

#### 2.12 Pull quotes / epigraphs at chapter open

**Current state**: Chapters open with a tagline subtitle. No epigraph.

**Apress pattern**: Some series use a one-line quote attributed to a practitioner: *"Tests don't slow you down. Production fires slow you down." — anonymous SRE*. Sets tone.

**Quick fix**: Optional `chapter-epigraph` block above the H1, italic small-caps. Use sparingly — only where there's a genuine, attributed quote that nails the chapter's thesis.

#### 2.13 "About the cover" / "About the artwork" appendix

**Current state**: Hero art on every chapter is one of the manual's standout features, but it's never *explained*. A reader doesn't know whether it's stock, hand-drawn, AI-generated, or what each piece represents.

**Apress pattern**: Apress books have a one-page "About the cover" note. We could go bigger — a small gallery of all chapter heroes with one-line captions and the artist/tooling.

**Quick fix**: Add `appendix-cover-art.html`. Cheap, distinctive, shareable on social.

#### 2.14 A reading roadmap diagram on the cover

**Current state**: Cover has chapter tiles in a grid. There's no visual that says "Read Q1-Q3 first; then if you're a solo dev → 4-6-7; if you're an architect → 16-K-N."

**Quick fix**: Add an SVG flow above the chapter grid showing 3-4 reading paths (Solo Dev / Architect / Security / Fleet Op) as colored arrows through the chapter list. We have the data — we already pitch the same audiences in the audience tiles.

#### 2.15 "Updates to this edition" on the cover

**Current state**: Edition badge is in the meta-bar but doesn't say *what changed in this edition*.

**Quick fix**: One-line summary next to the edition pill: `v2.83 · 9 new chapters since v2.0 · last update May 2026 · CHANGELOG ↗`. Sets a "this is alive" signal without a full changelog reread.

### 🔵 Stretch / Optional

#### 2.16 A printed quick-reference card / poster

**Current state**: We have `quick-reference.html` (Appendix B). It's web-only.

**Apress pattern**: Best-in-class books ship a tear-out cheat sheet. We could ship a printable A3/Letter-size PDF poster of the four-station shop with all the gates and CLI commands. Hand it to a new team member day one.

#### 2.17 A "Common pitfalls" bestiary

**Current state**: The mistakes table in `writing-plans.html` is excellent. There isn't a *unified* bestiary across all chapters.

**Apress pattern**: Some books have an "Anti-Patterns" appendix collecting all the "don't do this" boxes from the body chapters into one searchable place.

**Suggested implementation**: Auto-extract every `callout-warning` block in the manual into `appendix-anti-patterns.html`, linked back to its source chapter. `maintain.mjs` already does this kind of extraction for the book index.

#### 2.18 "Industry voice" foreword

**Current state**: We have an excellent About the Author. We don't have a Foreword by an outside voice.

**Apress pattern**: Foreword by a known practitioner gives instant credibility. *"I've been running platform teams for fifteen years. Here's why this approach matters." — <senior person at $known_company>*.

**Caveat**: Asking for a foreword is a relationship investment, not a writing task. Defer until v3.0 or a major positioning moment.

---

## 3 · Editorial / Consistency Issues to Sweep

These are inconsistencies an Apress copyeditor would flag in a first pass. None are bugs — just polish.

| Issue | Where I noticed it | Suggestion |
|---|---|---|
| "Further reading" exists in some chapters (`crucible.html`, `forge-master.html`, `audit-loop.html`) but not others | Spot-checked 8 chapters | Make it a chapter-template requirement (lint rule via `maintain.mjs`). Even "no further reading needed" is a valid value. |
| Chapter 11 mentions "69 tools"; Chapter 10 mentions "21+ instruction files, 19 agents, 13 skills, 7 hooks"; the cover says "65 tools" in `installation.html` | Hard-counts drift across chapters | Centralize counts in `assets/manual.js` and have `maintain.mjs` template-substitute them. Single source of truth. |
| Mixed em-dash / en-dash / hyphen usage in headlines | Throughout | Apress style: `—` (em-dash) for parenthetical breaks, no spaces around it in print, optional spaces in screen. Pick one and lint. |
| "Dashboard — LiveGuard" vs "The LiveGuard Dashboard" name two different chapters | `index.html` lists both | Distinguish naming so a new reader doesn't think they're duplicates. Maybe sub-chapter is "LiveGuard Tab" (it's literally a tab in the main dashboard). |
| Some chapter heroes are 16:9 photographic JPG; the diagrams in body are SVG; the four-stations widget is HTML/CSS art | Visual styles vary | Document the visual system in §2.5 "Conventions" page. Three styles is fine — calling them out is what matters. |
| "Chapter 4" vs "Chapter Q2" vs "Appendix L" — three numbering schemes coexist | `book-index.html` shows them side by side | Apress allows this, but the legend belongs on the §2.5 conventions page. |

---

## 4 · Series Positioning — which Apress series fits Plan Forge?

Half-serious thought experiment: if we pitched this to Apress today, which series would it land in?

| Series | Fit | Verdict |
|---|---|---|
| **Apress Pocket Guide** (~150 pp, fast reference) | The CLI/MCP Reference subset alone could be a Pocket Guide | Could be a future spin-off |
| **Apress Pro** (~300-500 pp, working pro audience) | This is the natural fit. Pro books are deep, code-heavy, audience-tagged | ✅ Best fit today |
| **Apress Expert** (~500+ pp, advanced practitioner) | The enterprise track (Appendices H-N) plus Inner Loop / Competitive Loop / Audit Loop deep dives could be an Expert vol | A second book once the field matures |
| **Apress Illustrated** (graphic-heavy, diagram-led) | Hero art and diagram density support this. We'd need to invest in *all* art being on the same level as the heroes | Aspirational |

If we wanted a single editorial north-star: **"Pro Plan Forge: The AI-Native SDLC Forge Shop"** — Pro series, Quickstart + 4 Parts + Enterprise track as the appendix, ~400 web-rendered pages.

---

## 5 · Suggested Phasing

If we like any of this, here's a no-pressure phasing.

### Wave 1 — One weekend
- §2.1 Numbered Figures & Listings (build-time, via `maintain.mjs`)
- §2.2 "What you'll learn" + "Recap" boxes (template + 24-chapter pass)
- §2.5 "Conventions used in this manual" page
- §2.11 Visible figure captions
- §3 Sweep (counts centralized, "Further reading" required, em-dash lint)

### Wave 2 — Following sprint
- §2.6 Single-source HTML / PDF export ("download the whole manual")
- §2.3 Difficulty / persona pills on chapter cards
- §2.4 "Prerequisites" line per chapter
- §2.8 End-of-Part wrap-up pages
- §2.7 Errata page

### Wave 3 — When time allows
- §2.9 Per-chapter exercises (Tracker-tied)
- §2.10 Sidebars (relocate `lessons-learned.html` highlights into source chapters)
- §2.14 Reading-roadmap diagram on cover
- §2.13 About the cover-art appendix

### Wave 4 — Stretch
- §2.16 Printable cheat-sheet poster
- §2.17 Anti-patterns bestiary appendix
- §2.18 Foreword by an outside voice

---

## 6 · What we should *not* copy from Apress

Worth being explicit so we don't over-correct.

- **Don't number sections** beyond Figures/Listings. Apress's `5.3.2.1` deep numbering is print-era. Our anchor links + book index do the job better.
- **Don't add a "downloadable code bundle"** in the Apress sense. The repo *is* the bundle, and we're better off saying that loudly than zipping a snapshot.
- **Don't add ISBN-style edition formality** unless we genuinely freeze editions. Our edition badge tied to `VERSION` is honest; an ISBN-style "First Edition / Second Printing" would be cosplay.
- **Don't add print-style title pages** for every chapter. Web readers will scroll past them.
- **Don't lock the visual style** to Apress's reserved "ProBook" feel. Our amber/forge aesthetic is a brand asset.

---

## Appendix A — Quick wins I could do unsupervised in an afternoon

If you want me to just *go*, the lowest-risk batch is:

1. Add a `chapter-objectives` and `chapter-recap` CSS class + populate them on the 5 most-trafficked chapters (Installation, Writing Plans, Your First Plan, CLI Reference, Troubleshooting).
2. Add `<figcaption>` under every `diagram-img` using the existing `alt` text.
3. Centralize the tool/instruction/agent/skill/hook counts in `assets/manual.js` and template-substitute on build.
4. Add a `conventions.html` page covering callout flavors, status pills, and the chapter-numbering scheme.
5. Add the "📥 Download manual" placeholder link (even if it 404s today) so the slot exists.

Anything beyond that — Figure/Listing numbering, the PDF build, persona pills, end-of-Part pages — is worth a short scoping conversation first because the design choices have downstream effects.

---

*Reviewed by: GitHub Copilot · Editorial pass through 8 chapters + index/glossary · Plan Forge v2.83 · for discussion only*
