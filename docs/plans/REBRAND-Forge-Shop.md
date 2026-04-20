# Plan Forge Rebrand — Audit Report & Hardened Plan

> **Status**: APPROVED (2026-04-20) — Execution starting with R0 + R1 in parallel.
> **Author**: UI/UX + Brand audit (2026-04-20)
> **Target release**: v2.55.0 (phased, see Roadmap section)
> **Scope Contract**: NON-FUNCTIONAL rebrand only — no behavior changes to CLI, MCP tools, CHANGELOG, or VERSION. Pure positioning, IA, copy, visual language.
>
> **Locked decisions (2026-04-20)**:
> - Tagline: **"The AI-Native SDLC Forge Shop"**
> - Starting slices: **R0 (asset commission) + R1 (README compass) in parallel**
> - Logo: keep v1 hammer-on-anvil unchanged
> - Blog posts: minimal banner on existing posts; new rebrand-release blog post ships with v2.55.0

---

## TL;DR

Plan Forge's **product** has outgrown its **positioning**. The code ships a full idea-to-monitor shop — Crucible (intake) → Pipeline (build) → LiveGuard (operate) → Forge Intelligence (learn) — but 80%+ of surface copy still sells v1.x: *"AI coding guardrails that harden plans."* Users who arrive at the site don't discover Crucible, Tempering, Bug Registry, Testbed, Watcher, notifications, remote orchestration, Health DNA, or the dashboard-as-command-center until deep in the manual.

**The rebrand proposal**: reposition Plan Forge as **"The AI-Native SDLC Forge Shop"** — one system, four stations (**Smelt → Forge → Guard → Learn**), covering the full lifecycle. Keep the blacksmith metaphor (it's earned). Refactor every surface to tell the four-station story consistently. Replace "plan hardening" as the lede; make it one feature among many.

---

## 1. Current State Audit

### 1.1 Brand surface inventory

| Surface | Files | Current lede |
|---------|-------|-------------|
| **README.md** | 1 | "A blacksmith doesn't hand raw iron… Plan Forge does the same for AI-driven development." ✅ Closest to current truth. |
| **Landing page** | [docs/index.html](docs/index.html) | "Forge the Plan. Harden the Scope. Ship with Confidence." ❌ Plan-only framing. |
| **llms.txt** (root + docs) | 2 | "AI coding guardrails that convert rough ideas into hardened execution contracts." ❌ Guardrails framing. |
| **Manual cover** | [docs/manual/index.html](docs/manual/index.html) | "From apprentice to master smith. Learn to harden AI-driven development plans into drift-proof execution contracts." ❌ Plan-only. |
| **Manual Ch.1** | [docs/manual/what-is-plan-forge.html](docs/manual/what-is-plan-forge.html) | Opens with "AI coding agents are powerful but directionless" → pivots entirely to plan hardening. ❌ No mention of Crucible/LiveGuard/Tempering until much later. |
| **Capabilities page** | [docs/capabilities.html](docs/capabilities.html) | Meta description correctly lists full surface, but headline framing still "enterprise-grade AI coding guardrails." ⚠️ Mixed. |
| **FAQ** | [docs/faq.html](docs/faq.html) | "AI coding guardrails, the hardening pipeline, tech presets." ❌ Plan-only. |
| **Blog index** | [docs/blog/index.html](docs/blog/index.html) | Most recent articles already speak the fuller story (unified-system, seven-agents, guardrails-lessons). ✅ Best-aligned surface. |
| **Extensions page** | [docs/extensions.html](docs/extensions.html) | Neutral — describes extensions system only. ✅ OK. |
| **Logo / OG card** | `docs/assets/plan-forge-logo.svg`, `og-card.webp` | Hammer-on-anvil motif only. ⚠️ Missing the "shop" — no watchtower, no crucible, no brain. |
| **Hero illustrations** | `hero-illustration.webp`, `liveguard-hero.webp`, `readme-system-overview.webp` | Fragmented — each shows one station. No unified "Forge Shop" panorama. |
| **Navigation IA** | site nav + manual sidebar | Acts I–III are build-centric. "LiveGuard" gets a late chapter, Crucible/Tempering/Bug Registry barely surface. |

### 1.2 What ships today (product truth)

| Station | Capability | MCP tools | CLI commands | Manual coverage |
|---------|-----------|-----------|--------------|-----------------|
| **SMELT** (intake) | Crucible interview funnel, smelt lifecycle, tempering scoring | 6 Crucible + 4 Tempering = 10 | `crucible-*`, `tempering-*` | 2 of 30 chapters |
| **FORGE** (build) | 7-step pipeline, DAG scheduling, quorum, escalation, cost tracking | ~20 core | `run-plan`, `analyze`, `sweep`, `diff`, `status`, `new-phase`, `migrate-memory`, `version-bump`, etc. | ~15 of 30 chapters (dominant) |
| **GUARD** (operate) | Drift, incidents, secret scan, dep watch, regression guard, env diff, hotspot, fix proposal, quorum-analyze, health trend, deploy journal, alert triage, composite `liveguard-run`, remote bridge (Telegram/Slack/Discord), Watcher, Watcher-live | 14 LiveGuard + 2 Watcher | `drift`, `secret-scan`, `env-diff`, `regression-guard`, `fix-proposal`, `deploy-log`, `hotspot`, `dep-watch`, `health-trend`, `quorum-analyze`, `triage`, `incident` | 3 of 30 chapters |
| **LEARN** (memory + self-tuning) | Health DNA, auto-tune escalation, cost calibration, adaptive quorum, recurring incident detection, L3 memory via OpenBrain, Bug Registry (register/list/validate-fix), Testbed (happy-path + findings) | 4 Bug + 3 Testbed + memory/home/search/timeline/org | `testbed-happypath`, `mcp-call` proxy for the rest | 1 of 30 chapters (mostly inside Ch. `liveguard-dashboard`) |
| **COMMAND** (dashboard / remote) | Live dashboard (25 tabs), WebSocket hub, run drawer, notifications, skill runner, session replay, cost report, OTLP traces, REST API, Telegram/Slack/Discord notify, OpenClaw bridge | `notify_*`, `home_snapshot`, `run_skill`, `skill_status`, `watch`, `watch_live` | `tour`, remote HTTP endpoints | 2 of 30 chapters |

**Gap**: Only `forge/` build is fully surfaced in marketing. Everything else ships but is under-sold.

### 1.3 Scale of the copy problem (measured)

A `grep` across `docs/**/*.html` for brand-critical phrases shows the imbalance:

| Phrase | Rough occurrences | Verdict |
|--------|------------------|---------|
| "plan hardening" / "harden plans" / "hardened execution contract" | 60+ | Over-used. |
| "AI coding guardrails" | 40+ | Over-used as lede. |
| "LiveGuard" / "Guard" | ~25 | Under-used given the product weight. |
| "Crucible" / "smelt" / "tempering" | <10 on public pages (mostly manual) | Near-invisible. |
| "Forge Shop" / "SDLC" / "full lifecycle" | ~0 | Missing entirely. |
| "Bug Registry" | <5 | Near-invisible. |
| "Testbed" | <5 | Near-invisible. |
| "Watcher" | ~3 | Near-invisible. |

**Conclusion**: the site reads like v1.5. The product is v2.53.

---

## 2. Rebrand Strategy

### 2.1 New positioning statement

**Old lede** (plan-centric):
> *AI coding guardrails that convert rough ideas into hardened execution contracts.*

**New lede** (shop-centric):
> **Plan Forge is the AI-Native SDLC Forge Shop.** From first idea to production watch, one system — four stations, one memory, zero drift. **Smelt** the idea. **Forge** the code. **Guard** the build. **Learn** from every run.

### 2.2 The Four Stations (new mental model)

The whole site reorganizes around four stations, each with:
- A station verb (action)
- A station noun (surface)
- A station icon
- A hero illustration
- A dashboard tab group

| # | Station | Verb | What happens | Primary surfaces | Dashboard tab |
|---|---------|------|-------------|-----------------|--------------|
| 1 | **SMELT** | *Smelt the idea* | Raw idea → interview → phase plan | Crucible, Tempering, `forge_new_phase` | Crucible tab (already exists) |
| 2 | **FORGE** | *Forge the code* | Plan → hardened contract → executed slices → shipped code | 7-step pipeline, quorum, escalation, Run Plan, Agents, Skills | Home / Runs / Progress / Traces |
| 3 | **GUARD** | *Guard the build* | Shipped code → drift / secrets / deps / regressions / incidents → fix proposals | LiveGuard tools, Watcher, remote bridge | LiveGuard group (Health/Incidents/Triage/Security/Env) |
| 4 | **LEARN** | *Learn from every run* | Events → memory → Health DNA → self-tuned escalation / cost / quorum | Bug Registry, Testbed, OpenBrain memory, Health Trend | Memory / Bug Registry / Timeline |

> The fifth area — **COMMAND** (dashboard + remote) — is not a station; it's the *control room* that ties the four together.

### 2.3 Visual identity evolution

**Keep**:
- Amber/forge-500 accent (`#f59e0b`) — equity.
- Blacksmith metaphor — it's already earned.
- Inter + JetBrains Mono type pairing.

**Add**:
- A four-station iconography set (Smelt, Forge, Guard, Learn) replacing ad-hoc emojis. Lucide-style stroked SVGs, 1.75 stroke, `currentColor` (same system as dashboard tabs).
- A "Forge Shop" panorama hero illustration — one wide scene showing all four stations connected: crucible (molten iron, right-to-left flow into) anvil + hammer (sparks flying into) watchtower (with runes/shields) (feeding) golden brain atop the floor plan.
- Station-accent colors (secondary palette):
  - Smelt — ember red `#ef4444`
  - Forge — amber `#f59e0b` (primary, retained)
  - Guard — cyan `#06b6d4` (cold, vigilant)
  - Learn — violet `#8b5cf6` (wisdom)
- Refreshed OG card incorporating four-station lineup.

**Retire**:
- Single-station heroes as primary marketing (keep them as secondary).
- Emoji-in-headline patterns (🔨🛡️🧠 etc.) — replaced with SVG icons for consistency across dark/light/print.

### 2.4 Tagline system (tiered)

| Tier | Use | Copy |
|------|-----|------|
| **Primary** | Landing hero, OG card, README | *The AI-Native SDLC Forge Shop.* |
| **Secondary** | Sub-hero, meta description | *From first idea to production watch — one system, four stations, zero drift.* |
| **Station-specific** | Section heads, deep links | *Smelt the idea. Forge the code. Guard the build. Learn from every run.* |
| **Legacy** (retain for SEO) | Deep copy, FAQ | *"plan hardening" and "hardened execution contracts"* remain as Forge-station terminology. |

---

## 3. Information Architecture — Before / After

### 3.1 Landing page (`docs/index.html`)

**Current flow** (sections in order):
1. Hero (plan-centric)
2. "AI Agents Drift Without Guardrails" (problem)
3. "The 7-Step Hardening Pipeline"
4. "Enterprise-Grade by Default"
5. "The Forge Stops. LiveGuard Watches." *(buried ~60% down the page)*
6. "Your AI Gets Smarter Over Time"
7. "Plan Forge Is One Piece of a Bigger Picture"
8. A/B test
9. Tech stacks
10. Quickstart

**Proposed flow**:
1. **Hero** — new four-station tagline + Forge Shop panorama
2. **The Four Stations** — new interactive section, one card per station with icon + one-liner + deep-link
3. **Smelt** — Crucible + Tempering (idea → plan)
4. **Forge** — 7-step pipeline, quorum, escalation (plan → code)
5. **Guard** — LiveGuard + Watcher + remote (code → healthy production)
6. **Learn** — Health DNA + memory + Bug Registry + Testbed (run → smarter next run)
7. **The Control Room** — dashboard screenshot + remote bridge
8. **A/B test + measurable difference** (retain)
9. **Your Stack. Your Rules.** (tech stacks — retain)
10. **Quickstart + Install** (retain)
11. **Works With Your AI Tools** (retain)

### 3.2 Manual (`docs/manual/`) — sidebar restructure

**Current acts**:
- Act I: *Learn the Forge* (Ch. 1–3)
- Act II: *Build with the Forge* (Ch. 4–?)
- Act III: *Master the Forge*
- Act IV/V: LiveGuard + advanced

**Proposed acts** (station-aligned):
- **Act I — Enter the Shop**
  - What Is Plan Forge? *(rewrite with four-station lede)*
  - How the Shop Works *(four-station overview — replaces "How It Works")*
  - Installation
- **Act II — Smelt**
  - Crucible: From Raw Idea to Plan
  - Tempering: Grading Plan Quality
  - Writing Plans (retained, re-positioned as smelt output)
- **Act III — Forge**
  - Your First Plan
  - The 7-Step Pipeline (current "How It Works" content)
  - Advanced Execution (quorum, escalation, agent-per-slice)
  - Instructions & Agents
  - Multi-Agent
- **Act IV — Guard**
  - What Is LiveGuard?
  - LiveGuard Tools
  - LiveGuard Dashboard
  - LiveGuard Runbooks
  - The Watcher (new — was under-documented)
  - Remote Bridge & Notifications *(new chapter — currently scattered)*
- **Act V — Learn**
  - Memory Architecture (retained)
  - Bug Registry *(new chapter — ships today, ~no manual coverage)*
  - Testbed *(new chapter — ships today, ~no manual coverage)*
  - Health DNA & Self-Improvement *(new chapter)*
- **Act VI — Command**
  - The Dashboard (retained, expanded)
  - MCP Server (retained)
  - CLI Reference (retained)
- **Act VII — Extend**
  - Customization
  - Extensions
  - Stack Notes
  - Sample Project
  - Glossary
  - About the Author
  - Troubleshooting

### 3.3 Top-level site nav

| Current | Proposed |
|---------|---------|
| Home / Docs / Capabilities / Manual / Extensions / Blog / Speckit Interop / FAQ | Home / **Shop Tour** (new — four-station overview page) / Capabilities / Manual / Dashboard / Extensions / Blog / FAQ |

### 3.4 README.md (repo root)

Keep the blacksmith blockquote. Rewrite the section after the badges:
- Replace the current `| You are... | Start with |` table with a **"Four Stations" compass** linking directly to the four manual Acts.
- Move the A/B test section below the Four Stations.
- Move the "Beyond Vibe Coding" copy to become the *Forge* station intro.
- Keep the verified stats block but update to v2.53 numbers (65 tools, 2470 tests).

---

## 4. Asset Plan (Grok-generated + hand SVG)

### 4.1 New images to commission from Grok (or DALL·E via `forge_generate_image`)

| # | Asset | Prompt seed | Format | Placement |
|---|-------|------------|--------|-----------|
| 1 | **Forge Shop panorama** (hero) | "A wide cinematic forge workshop at night. Left: a glowing crucible with molten iron pouring. Center: anvil with hammer mid-strike, sparks cascading. Right: stone watchtower with glowing runes scanning the floor. Far right: golden holographic brain above a workbench absorbing event streams. Amber fire light, blue-cold moonlight from windows. Industrial but mythic. Widescreen 2880×1080." | WebP 1920w + 2880w | Landing hero, README hero |
| 2 | **Smelt station** | "Close-up of a stone crucible with molten iron, tongs, a checklist parchment being written, interview-style scroll unfurling behind. Warm ember light." | WebP 1280w | Landing Smelt section, manual Act II cover |
| 3 | **Forge station** | "Anvil with hammer mid-strike, showers of sparks forming small geometric shapes (slices, blocks), a holographic execution graph in the sparks. Amber fire core, bluish glow on edges." | WebP 1280w | Landing Forge section, manual Act III cover |
| 4 | **Guard station** | "Watchtower at the edge of the forge floor with a glowing rune-inscribed shield, cyan/teal aurora radiating outward, small sentry dwarves patrolling, a torn scroll labeled 'CVE' being intercepted by a shield." | WebP 1280w | Landing Guard section, manual Act IV cover |
| 5 | **Learn station** | "A golden brain-shaped crystal suspended over an anvil, tendrils of light absorbing event motes from all directions, runic memory inscriptions floating into it." | WebP 1280w | Landing Learn section, manual Act V cover |
| 6 | **Control room** | "A smith's command desk overlooking the whole forge: multi-screen dashboard, kanban boards drawn in chalk, a speaking tube labeled Telegram/Slack/Discord running to the ceiling." | WebP 1280w | Landing Command section, manual Act VI cover |
| 7 | **OG card v2** | "Plan Forge logo top-center. Below: four station icons (crucible, anvil, watchtower, brain) in a horizontal lineup connected by a glowing golden thread. Tagline: 'The AI-Native SDLC Forge Shop.' 1200×630 dark, amber." | WebP 1200×630 | Social meta |
| 8 | **Logo mark v2** *(optional)* | Current hammer-on-anvil SVG + four-station dots arc around it. Vector redraw. | SVG | Favicon, logo |

### 4.2 SVG iconography (hand-authored, no AI)

A small Lucide-style set aligned with the dashboard tab icons shipped in v2.53:

| Icon | Shape | Usage |
|------|-------|-------|
| `smelt` | Crucible bowl with drip | Station headers, nav |
| `forge` | Anvil + hammer | Station headers |
| `guard` | Shield + eye | Station headers |
| `learn` | Brain + circuit node | Station headers |
| `command` | Control dial | Footer nav |

These live in `docs/assets/station-icons.svg` as a sprite, consumed by `<svg><use href="#smelt"/></svg>` — theme-safe, small payload.

### 4.3 Retired / archived assets

Keep files in place, update references:
- `hero-illustration.webp` → becomes "Forge station" illustration (repurposed)
- `liveguard-hero.webp` → becomes "Guard station" illustration (repurposed)

No deletions until v2.56 (after rebrand settles).

---

## 5. Copy Rewrite Plan (concrete deliverables)

### 5.1 Priority-1 files (lede rewrites)

| File | Action | Effort |
|------|--------|--------|
| [README.md](README.md) hero block | Swap lede + insert Four Stations compass | S |
| [docs/index.html](docs/index.html) | Hero + 4 new station sections (items 3–6 above) | L |
| [docs/index.html](docs/index.html) `<title>` + `<meta>` | Update OG/Twitter/description | S |
| [llms.txt](llms.txt) + [docs/llms.txt](docs/llms.txt) | Rewrite opening paragraph + "Key Concepts" | S |
| [docs/manual/index.html](docs/manual/index.html) cover | New tagline, new chapter grid per Act restructure | M |
| [docs/manual/what-is-plan-forge.html](docs/manual/what-is-plan-forge.html) | Rewrite opening to four-station frame | M |
| [docs/manual/how-it-works.html](docs/manual/how-it-works.html) | Rename & expand to "How the Shop Works" | M |
| [docs/faq.html](docs/faq.html) | Rewrite first 5 Q/A + add Smelt/Guard/Learn sections | M |
| [docs/capabilities.html](docs/capabilities.html) | Reorganize tiles into 4 station columns | M |
| [docs/docs.html](docs/docs.html) | "Plan Hardening Runbook" heading → "The Forge Station Runbook" (+ add Smelt/Guard runbook entries) | S |

### 5.2 Priority-2 files (new chapters)

| File | Action | Effort |
|------|--------|--------|
| `docs/manual/bug-registry.html` | **New** chapter — capabilities already ship | M |
| `docs/manual/testbed.html` | **New** chapter — capabilities already ship | M |
| `docs/manual/health-dna.html` | **New** chapter — self-improvement story | M |
| `docs/manual/watcher.html` | **New** chapter — watcher + watch-live under-documented | M |
| `docs/manual/remote-bridge.html` | **New** chapter — Telegram/Slack/Discord/OpenClaw | M |
| `docs/shop-tour.html` | **New** top-level page — four-station overview, link target for nav | M |
| `docs/blog/rebrand-forge-shop.html` | **New** blog post — announces the rebrand with v2.55.0 | M |

### 5.3 Priority-3 files (sweep & polish)

| File | Action |
|------|--------|
| All blog posts | Audit ledes; retroactively add "previously positioned as plan-hardening, now Forge station" footnote where appropriate |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Update positioning paragraph |
| [SECURITY.md](SECURITY.md) | No change (unless contact info drifts) |
| `.github/copilot-instructions.md.template` | Update "Project Overview" template with Four Stations language |
| `templates/copilot-instructions.md.template` | Same |
| Extension catalog descriptions | Audit for "plan hardening" over-use |

### 5.4 SEO continuity

**Preserve**:
- All existing URLs (no redirects needed).
- Existing keywords: "AI coding guardrails," "plan hardening," "hardened execution contracts" — move from H1s into H3s and prose where they remain accurate.
- `sitemap.xml` unchanged.

**Add**:
- New keywords: "AI SDLC," "AI development shop," "post-coding intelligence," "Health DNA," "self-improving AI workflow," "Crucible," "Tempering," "LiveGuard dashboard."
- New JSON-LD `SoftwareApplication` description covering all four stations.

---

## 6. Hardened Execution — The Rebrand Plan

### 6.1 Scope Contract

**In scope:**
- Copy rewrites (README, landing, manual, llms.txt, FAQ, capabilities).
- New documentation chapters for under-sold capabilities (Bug Registry, Testbed, Watcher, Remote Bridge, Health DNA).
- New assets (8 Grok illustrations + 5 hand SVG icons + OG card + sprite).
- IA restructure (new Act ordering in manual, new `shop-tour.html`).
- Nav bar changes (add "Shop Tour" link).
- Metadata updates (title/OG/Twitter/JSON-LD).

**Out of scope (Forbidden Actions):**
- ❌ No VERSION bump or CHANGELOG edits (pure positioning work).
- ❌ No MCP tool renames, no CLI command renames.
- ❌ No behavior changes in `pforge-mcp/`, dashboard, skills, agents, or hooks.
- ❌ No new tests; dashboard structure tests must stay green.
- ❌ No URL deletions — every current URL must continue to resolve.
- ❌ No logo primary-mark change (optional v2 add-on only).
- ❌ Do not break existing links from external blog posts / A/B test / Spec Kit interop.

### 6.2 Slice breakdown

Each slice is independently shippable. **Validation gate at every boundary**: `npx vitest run` must print 2470/2470 green before commit. No slice chains to the next until its gate passes.

| # | Slice | Deliverable | Validation Gate | Est. effort |
|---|-------|-------------|-----------------|------------|
| **R0** | Asset commission | Generate 8 Grok images via `forge_generate_image` + author 5 station SVGs into `docs/assets/station-icons.svg` sprite. | Files exist in `docs/assets/`; referenced nowhere yet. Tests green. | S |
| **R1** | README compass | Rewrite README hero + Four Stations compass table. Keep blacksmith quote. No asset dependency — use emoji placeholders until R2. | `grep -c "Four Stations" README.md` ≥ 1; markdown renders on GitHub; tests green. | S |
| **R2** | Landing hero + station sections | Rewrite hero, insert 4 new `<section>` blocks, wire new Grok hero image. | Lighthouse a11y score ≥ 95 on `index.html`; no broken internal links (`node scripts/validate-action.sh` or equivalent grep); tests green. | L |
| **R3** | llms.txt + llms.txt (docs) | Update both files' opening paragraphs + Key Concepts. | Both files contain "four stations" and "AI-Native SDLC"; tests green. | S |
| **R4** | Shop Tour page + nav link | Create `docs/shop-tour.html`; add nav entry to site-wide header (touch every HTML page's `<nav>`). | All site HTML pages contain the new nav link; tests green. | M |
| **R5** | Manual Act restructure | Update `docs/manual/index.html` chapter grid + sidebar JSON to new Act ordering. Existing chapter files stay put; only ordering and Act labels change. | All existing chapter URLs still resolve (grep sidebar JSON); tests green. | M |
| **R6** | Ch1/Ch2 rewrites | Rewrite `what-is-plan-forge.html` + `how-it-works.html` with four-station lede. | Both pages contain "Smelt / Forge / Guard / Learn"; no broken anchors from FAQ/landing; tests green. | M |
| **R7** | New chapters batch 1 | Author `watcher.html` + `remote-bridge.html` (content exists today in code + CHANGELOG; needs packaging). | New chapters link from Act IV; sidebar updated; tests green. | M |
| **R8** | New chapters batch 2 | Author `bug-registry.html` + `testbed.html` + `health-dna.html`. | New chapters link from Act V; sidebar updated; tests green. | M |
| **R9** | FAQ + Capabilities rewrite | Rewrite FAQ top 5 Q/A; reorganize capabilities.html tiles into 4 station columns. | Both pages contain four-station taxonomy; tests green. | M |
| **R10** | OG card + meta sweep | Install new OG card; update `<meta>` tags site-wide; refresh JSON-LD. | `grep -r "og:description" docs/` shows consistent new copy; tests green. | S |
| **R11** | Blog retrofit | Add brief footnote banner atop each old blog post: "This post uses v1.x positioning. See the current Shop Tour → ". | Every `docs/blog/*.html` contains banner (grep check); tests green. | S |
| **R12** | Release cut | Bump VERSION 2.55.0, CHANGELOG promotion, tag, `gh release create`. Follow `/memories/repo/release-procedure.md` strictly. | Post-release `git show v2.55.0:VERSION` = `2.55.0` exactly; tests green; release published. | S |

### 6.3 Temper Guards (common shortcuts to refuse)

| Shortcut | Why it's wrong |
|---------|---------------|
| *"Just change the hero tagline and call it done."* | The manual + FAQ + llms.txt still read v1.5 and LLMs index them. A hero-only change leaves a broken brand. |
| *"Regenerate the logo to include all four stations."* | Logos age poorly when they encode too many specifics. Keep the mark simple; tell the four-station story in hero art instead. |
| *"Retire 'plan hardening' terminology."* | It's earned SEO equity and still accurately describes the Forge station. Demote it (H1 → H3), don't delete it. |
| *"Skip new chapters — just link to code / CHANGELOG for Bug Registry etc."* | The rebrand premise is "read like we always had these." Missing chapters = broken premise. |
| *"Break current URLs to force the new taxonomy."* | All inbound links from blogs, A/B post, Spec Kit interop must keep working. Taxonomy lives in nav/titles, not URLs. |
| *"Defer the assets — copy is enough."* | The Forge Shop panorama is load-bearing. Without it, the four-station claim looks like a rename, not a product. |
| *"Add a VERSION bump for the rebrand mid-slice."* | This is non-functional work. Bundle release at the end (R12). |

### 6.4 Rollback protocol

Every slice is a single commit on master (standard Plan Forge admin-bypass push flow). Rollback = `git revert <sha>`. Because no VERSION/CHANGELOG changes happen until R12, any mid-flight revert is safe and invisible to `pforge self-update` users.

### 6.5 Completion criteria

The rebrand is done when:
1. ✅ A cold visitor lands on `planforge.software`, and within 10 seconds knows Plan Forge is a **full SDLC shop** (not a plan-hardening tool).
2. ✅ Every ship-today capability (Crucible, Tempering, Bug Registry, Testbed, Watcher, Remote Bridge, Health DNA) has a dedicated manual chapter.
3. ✅ Four-station taxonomy appears consistently in: hero, nav, llms.txt, README, OG card, capabilities page, FAQ.
4. ✅ `grep -c "plan hardening" docs/**/*.html` drops from 60+ to ≤ 10, all in context (Forge station copy).
5. ✅ All 2470 tests still green.
6. ✅ Lighthouse a11y on landing ≥ 95.
7. ✅ v2.55.0 tagged with release notes framing the rebrand.

---

## 7. Recommended First Action (this session)

**Pick one of three starting points**:

| Option | Start with | Why |
|--------|-----------|-----|
| **A — Narrative-first** | R1 (README compass) | Cheapest to iterate on; sets the voice for everything downstream. Unblocks the rest. |
| **B — Visual-first** | R0 (asset commission) | Grok image turnaround is async; start it now so R2 isn't blocked later. |
| **C — Architecture-first** | R5 (Manual Act restructure) | Biggest IA change; easiest to do before new chapters are written. |

**Recommendation**: **Option A + B in parallel.** Draft the README compass (~1 hour), kick off Grok generations simultaneously (async, ~15-30 min each), then proceed to R2–R5 in sequence.

---

## 8. Open questions for the user

1. **Logo mark** — keep v1 (hammer-on-anvil) untouched, or commission a v2 with four-station hint? (Recommended: keep v1 for the rebrand; consider v2 for v2.60.)
2. **Domain change?** No — `planforge.software` stays. The name stays. Only positioning changes.
3. **Tagline vote** — options:
   - "The AI-Native SDLC Forge Shop." *(recommended — clearest product category)*
   - "Smelt · Forge · Guard · Learn."
   - "One shop. Four stations. Zero drift."
   - "Plan Forge — from idea to production watch."
4. **Blog retrofit depth** — minimal banner (R11 proposed), or full rewrites? Recommended minimal.
5. **Spec Kit Interop page** — keep as-is (product comparison still valid), or re-frame under a broader "Interop" section? Recommended keep.

---

## 9. Appendix — What stays, what goes

### Stays (load-bearing equity)
- Blacksmith metaphor
- Amber/forge-500 primary color
- Inter + JetBrains Mono typography
- `planforge.software` domain
- MCP tool names, CLI command names
- "Plan hardening" language (demoted, not deleted)
- All URLs
- Dogfooding claim and A/B test evidence
- 7-step pipeline (it's now the Forge station's internal workflow)

### Goes (or demotes)
- "AI coding guardrails" as the lede → becomes one feature of the Forge station
- "Hardened execution contracts" as the tagline → becomes Forge-station terminology
- Emoji-in-headline patterns → replaced with SVG icons
- Manual's "Acts I–III build-centric" ordering → replaced with station-aligned Acts I–VII
- Single-station hero illustrations as primary → moved to section-level use; panorama takes the hero

---

**Next step when ready**: confirm tagline + starting option (A/B/C), and I'll execute the chosen slice(s) behind the scope contract above.
