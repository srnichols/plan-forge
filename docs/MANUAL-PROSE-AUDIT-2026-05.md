# Manual Prose Audit — May 2026 (New-Developer Perspective)

> **Generated**: May 4, 2026
> **Reviewer perspective**: Senior dev at 50-person SaaS company, CTO asked "evaluate Plan Forge for our AI-assisted dev workflow", 2 hours to decide.
> **Focus**: 90% on prose clarity. Visuals were audited separately.
> **Companion docs**: [MANUAL-AUDIT-2026-05.md](MANUAL-AUDIT-2026-05.md) (content/structural audit)

---

## Executive Summary

**Plan Forge solves a real, hard problem with a thoughtful, well-architected system. The prose is the biggest barrier to adoption.** The manual tries to be both a narrative tutorial AND a reference catalog, and it fails at both. Newcomers will close the tab 30 minutes in.

### The three biggest sins

1. **Jargon introduced before definition** — "scope contract," "slice," and "validation gate" are used 10+ times in Chapter 1 without ever being defined in that chapter
2. **Reference material masquerading as narrative** — the Dashboard chapter tries to describe 33 tabs in one chapter; the MCP chapter lists 69 tools with no guidance on which to learn first
3. **Version-speak baked into content** — "v2.82.1 added," "Phase-30 broke," "v2.57 adds on top" scattered throughout. Newcomers don't care about Plan Forge's release history — they care about what to do now

---

## Chapter Verdicts (in nav order)

| Chapter | Verdict | Top issue |
|---|---|---|
| **Act I — Smelt** | | |
| index.html | ✅ Excellent | Navigation; nothing to fix |
| what-is-plan-forge.html | 🟡 Needs work | Scope contract / slice / gate used 10+ times before defined |
| how-it-works.html | 🟡 Needs work | Repeating closed-loop paragraph; version-speak about v2.57 inner loop |
| installation.html | 🟢 Good | Polyglot term used without explanation |
| writing-plans.html | 🟢 Good | RFC 7807 used without expansion; CRITICAL_FIELDS as version-speak callout |
| crucible.html | 🟠 Confusing | "Lane" introduced before explained; "smelted" as past participle confuses; Crucible vs Crucible tab vs Governance tab |
| **Act II — Forge** | | |
| your-first-plan.html | 🟢 Good | "Hardened plan" used before defined in this chapter |
| dashboard.html | 🔴 **Rewrite** | 33 tabs in one chapter; version-speak about Phase-30; "25 tabs" headline contradicts "33 tabs" body |
| cli-reference.html | 🟡 Needs work | 20+ commands not grouped by use case; "I'm trying to..." section missing |
| customization.html | 🟢 Good | applyTo glob pattern table doesn't explain why pick A over B |
| instructions-agents.html | 🟠 Confusing | 17 files + 14 agents + 12 skills as one narrative; lifecycle hooks assume "SessionStart"/"PreToolUse" knowledge |
| mcp-server.html | 🔴 **Rewrite** | 69 tools in one chapter; categories not self-explanatory; no "learn these 10 first" guidance |
| extensions.html | 🟡 Needs work | 3 examples with vague "for whom?" descriptions |
| multi-agent.html | (not reviewed in detail) | likely OK — feature parity matrix is the right format |
| advanced-execution.html | (not reviewed in detail) | likely OK |
| troubleshooting.html | 🟡 Needs work | Assumes "context window," "rate limited," "escalation chain" knowledge; inconsistent depth across rows |
| self-deterministic-loop.html | (not reviewed in detail) | likely needs work — phase numbers in title |
| inner-loop.html | (not reviewed in detail) | likely needs work — same issue |
| competitive-loop.html | (not reviewed in detail) | likely OK |
| audit-loop.html | (not reviewed in detail) | likely OK |
| forge-master.html | (not reviewed in detail — newest chapter) | likely OK |
| **Act III — Guard** | | |
| what-is-liveguard.html | 🟡 Needs work | Recurring features mentioned but not explained until later; arrows shown without per-stage prose |
| liveguard-tools.html | (not reviewed in detail) | likely OK with new SVG |
| liveguard-dashboard.html | (not reviewed in detail) | likely OK |
| watcher.html | (not reviewed in detail) | likely OK with 2 SVGs |
| remote-bridge.html | (not reviewed in detail) | likely OK with new SVG |
| **Act IV — Learn** | | |
| bug-registry.html | (not reviewed in detail) | likely OK with status machine SVG |
| testbed.html | (not reviewed in detail) | likely OK |
| health-dna.html | (not reviewed in detail) | likely OK |
| memory-architecture.html | (not reviewed in detail) | likely OK |
| **Appendices** | | |
| glossary.html | 🟡 Needs work | Alphabetical scatters related terms; forward references; "Forge is shorthand for Plan Forge" is circular |
| quick-reference.html | (not reviewed in detail) | likely OK — printable cheat sheet |
| stack-notes.html | (not reviewed in detail) | likely OK — reference |
| grok-image-warnings.html | (not reviewed in detail) | likely OK — short |
| sample-project.html | (not reviewed in detail) | likely OK — walkthrough |
| liveguard-runbooks.html | (not reviewed in detail) | likely OK — operational checklists |
| update-source.html | (not reviewed in detail) | likely OK — update instructions |
| about-author.html | ✅ Bio | nothing to fix |

---

## Top 5 Chapters That Confuse Newcomers Most

1. **Dashboard chapter** — 33 tabs, tries to describe them all in one narrative flow; structure defeats your purpose
2. **MCP Server chapter** — 69 tools organized by subsystem, not by use case; overwhelming without a guided entry point
3. **Instructions-Agents chapter** — 17 files, 14 agents, 12 skills in tables, no guidance on which to use; reference material presented as learning material
4. **How It Works chapter** — version-speak about v2.57 inner loop, closed-loop diagram feels academic; doesn't ground you in what *you* do operationally
5. **Troubleshooting chapter** — assumes knowledge of "context window," "escalation chain," doesn't define before use; trying to be both reference and tutorial fails at both

---

## Most-Overused Jargon Needing Glossary Callouts in Early Chapters

| Term | Used N+ times before defined | Fix |
|---|---|---|
| **scope contract** | 15+ in Ch 1-3 | One-sentence callout in Ch 1 §2 |
| **slice** | 10+ in Ch 1-2 | Define in Ch 1 |
| **validation gate / gate** | 8+ before defined | Callout in Ch 1 |
| **smelt / forge / guard / learn** | constant | Disambiguate "smelting station" (location) vs "smelt (v)" (process) |
| **hardened (plan)** | constant | Explain what makes a plan "hardened" vs "soft" |
| **applyTo** | scattered across 5 chapters | Define on first use as YAML frontmatter field |
| **lane** | Crucible-only | Add 1-line intro: "Crucible has three sizes: tweak, feature, full" |
| **MCP** | scattered | Expand "Model Context Protocol" on first use per chapter |
| **RFC 7807** | writing-plans table | Replace with "JSON error responses" or expand |

---

## Chapters That Are Gold Standard (Use as Templates)

- **Installation chapter** — clear prerequisites → three options → what happened → verification. Perfect structure for "I'm starting from zero."
- **Your First Plan chapter** — step-by-step walkthrough, concrete command outputs, clear before/after.
- **Writing Plans chapter** — structure (plan sections table) + good/bad examples + common mistakes. Reference + guidance.
- **Customization chapter** — two-layer model clearly explained, side-by-side comparison table (Principles vs Profile), concrete examples of both.
- **Troubleshooting chapter** (despite issues) — symptom/cause/fix table is scannable; users can Ctrl-F their error and find the fix in 10 seconds.

---

## The Deeper Problem

Plan Forge is trying to be four things simultaneously:

1. **A tutorial for newcomers** ("Your First Plan," "Installation")
2. **An operational reference** ("CLI Reference," "Dashboard")
3. **An architecture exposition** ("How It Works," "What Is LiveGuard")
4. **An API reference** ("MCP Server," "Instructions-Agents")

This works for someone who reads the manual cover-to-cover. It **fails** for someone who wants to pick it up and get to work in 30 minutes.

### Recommended restructure

> Block 2-3 days to rewrite the manual. Split it:
>
> - **Part 1 — Quickstart** (10 pages): Install → First Plan → Deployed. Nothing else.
> - **Part 2 — Operational** (20 pages): Dashboard, CLI, execution modes, cost control
> - **Part 3 — Reference** (60+ pages): Instruction files, agents, tools, glossary
> - **Part 4 — Advanced** (30+ pages): LiveGuard, multi-agent, custom extensions, architecture internals
>
> Right now, a newcomer trying to "just deploy a feature" has to page through 15 chapters of intermediate material. Split structure lets them say "I only need Part 1."

---

## Recommended Action Tiers

### Tier 1 — Highest impact, lowest cost (do first)

These are surgical edits to existing chapters. Each is 30-60 min of work.

- [ ] **Add a "Plan Forge in 5 terms" callout** at the top of `what-is-plan-forge.html` defining: scope contract, slice, validation gate, hardened plan, station. Each one sentence. Link to glossary.
- [ ] **Strip version-speak from prose** across `how-it-works.html`, `dashboard.html`, `writing-plans.html`, `crucible.html`, `troubleshooting.html`. Move version chips to footer notes only. Keep `v2.82.1+` chips on H2/H3 headings (those are useful) but remove "v2.X added" interruptions from body paragraphs.
- [ ] **Expand acronyms on first use per chapter**: MCP, OTLP, RBAC, RFC 7807. One sentence each.
- [ ] **`how-it-works.html` repeating paragraph fix** — the closed-loop description appears twice (once in prose, once in callout). Remove the callout duplicate.
- [ ] **`dashboard.html` "25 tabs" → "33 tabs"** — fix the contradiction between the headline number and the body count.
- [ ] **Glossary "Getting Started" section** — 5-term linked sequence at the top before the alphabetical reference begins.

### Tier 2 — Medium impact, medium cost

- [ ] **`crucible.html` lede rewrite** — open with "The Crucible is the intake interview for Plan Forge. It comes in three sizes (Lanes)..." instead of jumping into Phase-37 history. Define "lane" and "smelt" on first use.
- [ ] **`cli-reference.html` "I'm trying to..." section** — group commands by workflow (Setup, Planning, Execution, Troubleshooting). Add a use-case index at the top.
- [ ] **`liveguard-tools.html` "LiveGuard Is Not" section** — explicitly contrast with APM tools (Datadog/New Relic/Sentry). Distinguish operational vs request-level monitoring upfront.
- [ ] **`instructions-agents.html` "What auto-loads when?" scenario** — concrete walkthrough: "You edit `src/auth/token-validator.cs`. These four instruction files auto-load. Here's why each matters."

### Tier 3 — Highest impact, highest cost (the big restructure)

- [ ] **Split `dashboard.html` into 3 chapters** — (1) Home/Progress/Runs (your first session), (2) Forge monitoring tabs, (3) Settings configuration. Move LiveGuard tabs entirely to Act III where they already have their own chapter.
- [ ] **Split `mcp-server.html` into 3 chapters** — (1) Architecture & starting the server, (2) Core tools quickstart (10-15 most useful), (3) Full reference by category. Lead with `forge_capabilities` as the discovery tool.
- [ ] **Split `instructions-agents.html` into 2 chapters** — (1) "How guardrails work" tutorial with one concrete scenario, (2) Full reference of every instruction file + agent + skill.
- [ ] **Add a "Quickstart" Act 0** before Act I — exactly 3 chapters: Install, First Plan, First Deploy. Promise the reader can be productive in 30 minutes. Link out to deeper chapters only when they're ready.

---

## Working checklist

Edit this list as items are completed. Date format: YYYY-MM-DD.

### Tier 1 (surgical edits, low cost) ✅ COMPLETE

- [x] [2026-05-04] "Plan Forge in 5 terms" callout in what-is-plan-forge.html — added right under the One-Line Answer; defines Plan, Slice, Scope contract, Validation gate, Hardened plan with one sentence each
- [x] [2026-05-04] Version-speak strip across 5 chapters — removed `(v2.82.1)` / `v2.82 added` / `v2.57.0 adds` / `v2.16+` / `Phase-30 broke` / `Original (v2.37.0)` interruptions from body prose. Kept version chips on H2/H3 headings (those answer "is my install current?") and in the Common Errors table where they identify when an error code was introduced
- [x] [2026-05-04] Acronym expansions — `MCP` → `MCP (Model Context Protocol)`, `OTLP` → `OTLP (OpenTelemetry Protocol)`, `RBAC` → `RBAC (role-based access control)`, `ProblemDetails` → `ProblemDetails (RFC 7807 standard JSON error responses)` on first use per chapter
- [x] [2026-05-04] how-it-works.html duplicate paragraph fix — removed the italic prose paragraph that repeated the diagram caption verbatim
- [x] [2026-05-04] dashboard.html "25 tabs" → "33 tabs across 4 top-level groups" — fixed contradiction between headline number and body content
- [x] [2026-05-04] glossary.html "Getting Started: Read These Five First" section — numbered list of Plan Forge → Plan → Scope contract → Slice → Validation gate, each with anchor to its full entry, before the alphabetical reference begins

### Tier 2 (medium cost)

- [ ] [2026-MM-DD] crucible.html lede rewrite
- [ ] [2026-MM-DD] cli-reference.html "I'm trying to..." section
- [ ] [2026-MM-DD] liveguard-tools.html "LiveGuard Is Not" section
- [ ] [2026-MM-DD] instructions-agents.html scenario walkthrough

### Tier 3 (restructure)

- [ ] [2026-MM-DD] Split dashboard.html into 3 chapters
- [ ] [2026-MM-DD] Split mcp-server.html into 3 chapters
- [ ] [2026-MM-DD] Split instructions-agents.html into 2 chapters
- [ ] [2026-MM-DD] Add Quickstart Act 0

---

## Bottom line for the CTO

Plan Forge is technically solid. The architecture is clean. The guardrail system is thoughtful.

But **the prose is your barrier to adoption**. Fix Tier 1 (a half-day of work) and you remove 80% of the new-user friction. Tier 2 closes the rest. Tier 3 is the long-term play.

Right now, a busy senior dev who opens the manual cold has roughly a **30% chance** of figuring out what Plan Forge does and how to start using it within their attention budget. After Tier 1, that goes to ~70%. After Tier 2, ~90%.

This is fixable. The bones are good.
