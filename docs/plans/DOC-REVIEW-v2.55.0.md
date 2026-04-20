# Plan Forge — Editorial Review, v2.55.0

> **Reviewer**: Publisher / editor-on-retainer  
> **Reviewee**: Plan Forge engineering team (the documentation surface)  
> **Date**: 2026-04-20  
> **Scope**: Post-rebrand pass on the newly-shipped v2.55.0 "Forge Shop" surface  
> **Status**: Draft — pending author sign-off before patches are applied

---

## 0. TL;DR for the editor-in-chief

- **1 ship-stopper** (P0, hotfix today): a literal PowerShell escape (`` `n ``) has leaked into the navigation of **8 top-level pages**. Rendered HTML shows the escape as visible text. Fix first.
- **~8 factual drifts** (P1): version numbers, test counts, tool counts, chapter-range references that weren't updated when the rebrand renumbered chapters or when v2.55.0 cut.
- **Positioning drift** (P1): Twitter cards and glossary still carry v1.x "AI coding guardrails" copy after we committed to "AI-Native SDLC Forge Shop" as the canonical framing.
- **Structural inconsistencies** (P2): the three new Act IV chapters (Bug Registry, Testbed, Health DNA) + Watcher + Remote Bridge hand-code their prev/next nav with different CSS classes than the other 19 chapters, which use JS-generated nav. Behavior parity isn't guaranteed.
- **Copy polish** (P3): a handful of typos, one gendered metaphor, one stale model-name inconsistency, and some "verified: v2.21.0" HTML comments that should be retired or automated.

Applying the P0 + P1 fixes earns us a clean, trustworthy v2.55.0 surface. P2/P3 can ride in a follow-up polish PR.

---

## 1. Method

- Read the priority surface: manual cover, Ch 1–3, Ch 19 (Watcher), Ch 21 (Bug Registry), Appendix A (Glossary).
- Sampled landing page, Shop Tour, FAQ, capabilities.html, README.
- Grep-swept for visible bugs and stale version strings.
- Did **not** (yet) read: Ch 4–18, Ch 20, 22, 23, 24, Appendices B–F, all blog posts (banner-flagged per R11), walkthroughs, `docs/demos/`, or the Manual's sister `book-manual-plan.md` / `tempering.md` working files.

A full sweep of the manual will follow on your signal. This review reflects roughly the top **~35%** of the written surface — sampled deliberately across the newest, riskiest content.

---

## 2. P0 — Ship-stopper (fix first)

### 2.1 Literal PowerShell escape in nav dropdown — 8 files

**Symptom**: In the Resources dropdown, between "Shop Tour" and "The 80/20 Wall", rendered HTML shows the literal characters `` `n ``.

**Root cause**: When we inserted the "Shop Tour" link into the nav via a PowerShell heredoc, the `` `n `` newline escape was written literally into the string instead of being interpreted. The replacement pushed the escape into the output.

**Files affected** (8):
- [docs/capabilities.html](docs/capabilities.html#L45)
- [docs/docs.html](docs/docs.html#L42)
- [docs/examples.html](docs/examples.html#L42)
- [docs/extensions.html](docs/extensions.html#L42)
- [docs/faq.html](docs/faq.html#L148)
- [docs/problem.html](docs/problem.html#L69)
- [docs/dashboard.html](docs/dashboard.html#L56)
- [docs/speckit-interop.html](docs/speckit-interop.html#L44)

**Fix**: Replace `</a>` `n              <a href="problem.html"` with `</a>\n              <a href="problem.html"` (real newline) in all 8 files. One-liner PowerShell script.

**Severity**: P0 — this is the first thing a visitor sees when they open the Resources menu. It makes the site look amateur.

---

## 3. P1 — Factual drift (must fix in this release)

### 3.1 Stale version / test counts in prominent surfaces

| File | Location | Reads | Should read |
|---|---|---|---|
| [README.md](README.md#L22) | Hero stat line | `2470 Tests · v2.53.0` | `2478 Tests · v2.55.0` |
| [docs/manual/index.html](docs/manual/index.html#L48) | Cover hero caption | `v2.54.0-dev` | `v2.55.0` (or just drop the version — it will lie on the next release) |
| [docs/manual/index.html](docs/manual/index.html#L265) | Cover footer | `Plan Forge v2.30.0` | `v2.55.0` |
| [docs/manual/index.html](docs/manual/index.html#L15) | `twitter:description` meta | `14 chapters, 5 appendices` | `24 chapters, 6 appendices` |
| [docs/manual/index.html](docs/manual/index.html#L13) | `og:image` meta | `assets/og-card.webp` | `assets/brand/og-card-v2.webp` |

**Note**: Version strings embedded in static pages are a recurring maintenance burden. Recommend dropping them from copy where possible, or generating them from `VERSION` at build/deploy time.

### 3.2 Stale "Chapters 16–18" reference in Ch 1

[docs/manual/what-is-plan-forge.html](docs/manual/what-is-plan-forge.html#L217) in the "How to Read This Manual" section reads:

> Act III — Guard (Chapters 16–18): LiveGuard — mental model, all 14 tools, and the 5-tab dashboard for post-deploy defense.

Act III now runs **Chapters 16–20** (Watcher = Ch 19, Remote Bridge = Ch 20 were added in R7). The LiveGuard dashboard is also no longer "5 tabs" — it's been renamed and expanded per the nav. Needs a rewrite.

**Fix**:
> Act III — Guard (Chapters 16–20): LiveGuard — mental model, all 14 tools, the dashboard, plus the Watcher (tail another project read-only) and the Remote Bridge (phone-friendly approvals via Telegram/Slack/Discord/OpenClaw).

### 3.3 Stale tool count in Installation chapter

[docs/manual/installation.html](docs/manual/installation.html#L42):

> **Node.js is optional** unless you want the MCP server (dashboard, **19 tools**, REST API).

**Glossary** and **README** both say 65 MCP tools. Fix: `65 tools`.

### 3.4 Glossary — definition of "Plan Forge" itself is v1.x

[docs/manual/glossary.html](docs/manual/glossary.html#L33):

> **Plan Forge** — The framework itself — AI coding guardrails that enforce spec-driven development.

This is the canonical definition in the canonical reference. It needs to match the v2.55.0 positioning.

**Fix**:
> **Plan Forge** — The AI-Native SDLC Forge Shop. One workshop with four stations — Smelt, Forge, Guard, Learn — connected by gates, telemetry, and persistent memory.

### 3.5 Glossary — "Quorum Mode" defined twice, inconsistently

[docs/manual/glossary.html](docs/manual/glossary.html#L73) says `3+ models`.  
[docs/manual/glossary.html](docs/manual/glossary.html#L95) says `2–3 models`.

Pick one (the Execution section definition is better-written) and delete the duplicate from the LiveGuard section. The FAQ and Ch 14 ("Advanced Execution") are the authoritative sources — cross-check them.

### 3.6 Glossary — missing entries for the new taxonomy

The glossary is the reference readers will hit first for a definition. It currently lacks entries for:

- **Smelt, Forge (station), Guard, Learn** — the four stations
- **Station** and **Act** (the manual's organizational unit)
- **Watcher**, **Remote Bridge**
- **Bug Registry**, **Testbed**
- **Fingerprint (dedup)**, **scannerOverride**, error codes (`DUPLICATE_BUG`, `INVALID_TRANSITION`)
- **Classifier outcomes** (`real-bug`, `flaky`, `noise`)

These are all first-class concepts in the rebrand and must appear in the glossary. Estimated: +15 entries, one hour of work.

### 3.7 Twitter card positioning drift on landing

[docs/index.html](docs/index.html#L20):

```html
<meta name="twitter:title" content="Plan Forge — AI Coding Guardrails Framework" />
```

Twitter cards are often cached hard by social platforms. Fix now before the v2.55.0 release notes propagate.

**Fix**:
```html
<meta name="twitter:title" content="Plan Forge — The AI-Native SDLC Forge Shop" />
```

### 3.8 FAQ — `twitter:description` also stale

[docs/faq.html](docs/faq.html#L13):

```html
<meta name="twitter:description" content="Frequently asked questions about Plan Forge — AI coding guardrails, the hardening pipeline, tech presets, memory integration, and more." />
```

Should match the `og:description` two lines above, which we did update in R9.

---

## 4. P2 — Structural & consistency issues

### 4.1 New Act III/IV chapters don't use the JS chapter-nav

The five new chapters ([watcher.html](docs/manual/watcher.html), [remote-bridge.html](docs/manual/remote-bridge.html), [bug-registry.html](docs/manual/bug-registry.html), [testbed.html](docs/manual/testbed.html), [health-dna.html](docs/manual/health-dna.html)) all end with a hand-coded block:

```html
<div class="chapter-nav mt-12">
  <a class="chapter-nav-prev" href="...">← Chapter N: ...</a>
  <a class="chapter-nav-next" href="...">Chapter N+1: ... →</a>
</div>
```

The other 19 chapters use an empty `<div id="chapter-prev-next" class="chapter-nav"></div>` which `manual.js` populates at runtime. Two problems:

1. **Class mismatch**: `.chapter-nav-prev` / `.chapter-nav-next` aren't defined in `assets/manual.css` (the JS-generated version uses different markup). Visual rendering may drift from the rest of the book.
2. **Brittle maintenance**: any chapter renumber has to hand-edit the string in the prev/next HTML — exactly the kind of thing a publishing pipeline should automate. We already lived through "Ch 19 → Ch 21 → Ch 24" for Memory Architecture; that was a 2-edit shuffle in `manual.js` versus a 5-file find-and-replace here.

**Recommendation**: Convert all five to the JS-driven pattern (`<div id="chapter-prev-next" class="chapter-nav"></div>`), verify `manual.js` CHAPTERS array has them registered (✓ it does), and delete the hand-coded blocks. 20-minute task.

### 4.2 Stale "verified:" HTML comments

Found these at the top of the `<!DOCTYPE html>` on manual chapters:

- Ch 1 & 2: `<!-- verified: v2.21.0 -->` (most recently rewritten in R6 — should be v2.55.0 or dropped)
- Ch 3 (Installation): `<!-- verified: v2.21.0 -->`
- Glossary: `<!-- verified: v2.30.0 -->`
- The five new chapters: `<!-- verified: v2.54.0-dev -->`

**Recommendation**: Either automate these via a pre-publish script, or delete them. They lie the moment a chapter is touched without the marker being bumped — which is exactly what happened on Ch 1/Ch 2 during R6.

### 4.3 `tempering.md` and `book-manual-plan.md` living in `docs/manual/`

[docs/manual/tempering.md](docs/manual/tempering.md) and [docs/manual/book-manual-plan.md](docs/manual/book-manual-plan.md) are the only `.md` files in an otherwise all-HTML published manual folder, and neither is in the nav. If they're working notes, move them to `docs/plans/` or `.forge/`. If they're meant to be published, convert them to HTML chapters or appendices.

**Side effect**: The README links to `docs/manual/tempering.md` as a "Smelt" starter resource, which will render as raw markdown on GitHub (OK) but as a 404 on the site if a reader follows the path through planforge.software. Worth checking deployment behaviour.

### 4.4 Dashboard tab count disagreement

- Glossary: `15 tabs`
- README: `25 tabs`
- FAQ: doesn't cite a number

One of these is right. Most likely the README is correct (post-Watcher-tab). Audit `pforge-mcp/dashboard/` for the actual count, pick one number, put it in the glossary, and stop citing the number in prose outside the glossary.

### 4.5 Model-name inconsistency across chapters

- Ch 2 `.forge.json` sample uses `claude-opus-4.6`
- Ch 19 (Watcher) docs the analyze default as `claude-opus-4.7`
- FAQ answer on `--quorum=power` lists `Claude Opus 4.6`

Pick the canonical model version string in one place (FAQ or a new `docs/manual/models.html`) and link others to it. If the defaults in code disagree with any of the above, update code or docs to match.

---

## 5. P3 — Copy polish

### 5.1 Typos & light grammar

- **Shop Tour, Station 2 alt text** ([shop-tour.html](docs/shop-tour.html#L167)):
  > "...holographic execution graph glowing in the shower."
  
  Should be **"in the shower of sparks"** or **"in the spark-shower"**. As written, the blacksmith is taking a bath.

- **Ch 1 (What Is Plan Forge?)** quote:
  > "A blacksmith without a shop is just a man with a hammer."

  Gendered phrasing in a customer-facing intro. Recommend **"just someone with a hammer"** or **"a blacksmith without a shop is just a hammer in a hand."** The editor's pick is the latter — it's tighter and keeps the tool-focus.

- **Glossary — Dashboard entry**: the tab list reads *"monitoring, cost, replay, skills, config, watcher, and LiveGuard"* — the Oxford comma convention across the rest of the site is inconsistent. Pick a house style and enforce.

### 5.2 Ch 1 — "Cost Model" callout is dense

The callout runs four sentences without break — dense for a chapter-1 read. Split into a two-sentence lede + a bullet list of the three cost categories (Core / Automated execution / Direct API). Easier to skim.

### 5.3 Ch 2 — `.forge.json` sample has a stale template version

[how-it-works.html](docs/manual/how-it-works.html#L158):

```json
"templateVersion": "2.17.0"
```

Either bump to 2.55.0 or drop the line from the sample — newcomers will copy-paste this and then get a version mismatch in `pforge smith`.

### 5.4 Ch 2 — step-0 caption flips terminology mid-sentence

> You describe what you want (Step 0 — Smelt). The AI creates a spec. ... The shipper commits, LiveGuard runs its pre-deploy scan (**Guard**), and OpenBrain captures lessons (**Learn**).

The parenthetical "(Smelt)" / "(Guard)" / "(Learn)" mapping is a great teaching device — but "Forge" isn't called out the same way in the same paragraph. Add "(Forge)" to the slice-by-slice build sentence for symmetry.

### 5.5 Watcher chapter — phrasing

> "For continuous observation, `forge_watch_live` streams events for a fixed duration"

"Streams for a fixed duration" is a contradiction for some readers (streaming implies open-ended). Recommend:

> "For near-live observation, `forge_watch_live` tails the event stream for a bounded window (default 60 s, max 1 hr)."

### 5.6 Ch 1 — claim accuracy check

> "19 independent reviewer agents — including compliance, security, and multi-tenancy auditors that run automatically."

`copilot-instructions.md` counts **6 stack-specific + 7 cross-stack + 6 pipeline = 19 agents**, which matches. ✓ Keep as-is, but recommend including the 6/7/6 breakdown in one place (glossary or a new "Agents" appendix) because the claim is repeated verbatim in 4+ locations and will drift the next time we add an agent.

---

## 6. Recommendations — publisher's standing order

1. **Lock a glossary**. Before the next chapter is rewritten, the glossary is the source of truth for Smelt/Forge/Guard/Learn, Station, Act, Scope Contract, Slice, Gate. Any new chapter that introduces a term must register it in the glossary in the same commit.
2. **Single source of truth for numbers**. `45+ CLI commands`, `65 MCP tools`, `19 agents`, `13 skills`, `9 presets`, `7 adapters`, `2478 tests`, `25 dashboard tabs` should live in **one** place (either `capabilities.md` or a generated JSON used at build time). All pages should link to or include from there. The current copy-paste approach has already produced three contradictions inside one release.
3. **Retire the "verified:" HTML comments** or automate them. Today they lie silently.
4. **Convert the five hand-coded prev/next nav blocks** to the JS-driven pattern. One commit.
5. **Kill stale version strings embedded in prose**. Where a version number is rhetorically important (release notes, CHANGELOG, about-author), keep it; where it's just noise (chapter footers, manual cover caption), delete it.
6. **Mark the tempering / book-manual-plan working files** — either publish them (with nav entries) or move them out of `docs/manual/`.

---

## 7. Proposed patch plan

If the editor-in-chief greenlights, I'll apply the fixes in **three commits**:

### Commit A — Hotfix (P0 only)
- Fix the literal `` `n `` in 8 nav files
- Message: `fix(site): remove literal PowerShell escape from Resources nav dropdown on 8 pages (editorial P0)`

### Commit B — Factual drift (P1)
- README test/version bump
- Manual cover footer + twitter meta + og image
- Ch 1 "Chapters 16–18" → "16–20"
- Ch 3 tool count 19 → 65
- Glossary: Plan Forge definition, quorum dedup, +15 new entries
- Landing + FAQ twitter:title/description
- Message: `docs(site): correct version/test counts, chapter ranges, glossary taxonomy for v2.55.0 (editorial P1)`

### Commit C — Structural + polish (P2 + P3)
- Convert 5 new chapters to JS-driven prev/next
- Retire `verified:` comments
- Typos ("in the shower"), gendered metaphor, mid-sentence terminology symmetry
- `.forge.json` templateVersion bump
- Message: `docs(manual): chapter-nav consistency, copy polish, remove stale verification comments (editorial P2/P3)`

Total scope: ~2 hours of real work. Zero behavior changes.

---

## 8. Open questions for the editor-in-chief

1. **Version strings in prose**: keep, automate, or delete wholesale?
2. **`tempering.md` / `book-manual-plan.md`**: publish them as chapters, move them out of the manual folder, or leave as hidden working notes?
3. **Blacksmith metaphor dial**: the Ch 1 quote and station alt text lean heavy on the metaphor; the glossary and installation chapter are neutral. House style decision — where on that spectrum do you want the voice to settle?
4. **Follow-up sweep**: after these fixes, want me to do a second pass on Ch 4–18, 20, 22, 23, 24, all appendices, and the blog archive? Recommend yes — the surface I reviewed found issues at roughly 1 per 200 lines.
