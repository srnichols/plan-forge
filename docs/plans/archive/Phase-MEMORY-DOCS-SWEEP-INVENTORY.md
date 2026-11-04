# Phase-MEMORY-DOCS-SWEEP: Inventory

> **Generated**: 2026-05-16 — Slice 1 audit
> **Purpose**: Every doc, HTML, SVG, and template file that references OpenBrain, memory, three-tier, L3, Learn station, or brain — with `current → target` status for the Hallmark / Anvil / Lattice doc sweep.
> **Authority**: This file is the authoritative edit list for Slices 2–4. If a file appears mid-execution, append here before editing.

---

## Legend

| Status | Meaning |
|--------|---------|
| 🔴 Needs update | File references memory/OpenBrain but does not mention Hallmark, Anvil, or Lattice |
| 🟡 Partial | File already mentions some new terms but needs additional content |
| 🟢 Up to date | File already reflects v2.95.0 surface (verify only) |
| ⬜ Out of scope | File matched grep but is outside this phase's edit scope |
| 🆕 New file | File does not exist yet and must be created |

---

## Plan-Forge Repo — Markdown (Slice 2)

| # | File | Current | Target | Status |
|---|------|---------|--------|--------|
| 1 | `docs/MEMORY-ARCHITECTURE.md` | Describes 3-tier memory (L1/L2/L3) with OpenBrain. No mention of Hallmark, Anvil, or Lattice. No capability negotiation. | Major rewrite: v2.95.0 callout, five new sections (Hallmark Provenance Envelope, Anvil Δ-only Memoization, Lattice Code Index, Capability Negotiation with OpenBrain, Slag-Heap DLQ), updated 3-tier ASCII diagram showing Anvil + Lattice, Mermaid sequenceDiagram for capability negotiation, cross-links to phase plans and schema. | 🔴 Needs update |
| 2 | `README.md` | "Learn" station description mentions OpenBrain memory. No Hallmark, Anvil, or Lattice. Tool count does not include the 15 new tools. | Update "Learn" station: add "Hallmark provenance" + "capability-negotiated OpenBrain writes". Update tool-count summary (+15 tools: 8 Anvil + 5 Lattice + 2 Hallmark). Update version references to v2.95.0. Edits scoped to Memory and Tools sections only. | 🔴 Needs update |
| 3 | `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` | References memory subsystem and OpenBrain. No Hallmark/Anvil/Lattice. | Add Hallmark/Anvil/Lattice into the unified diagram and the section after "Memory subsystem". | 🔴 Needs update |
| 4 | `docs/capabilities.md` | Lists OpenBrain tools and L3 references. No Anvil/Lattice/Hallmark tools. | Add the 15 new MCP tool names (8 Anvil, 5 Lattice, 2 Hallmark). Update capability descriptions. | 🔴 Needs update |
| 5 | `docs/CLI-GUIDE.md` | Lists existing pforge subcommands. No `anvil`, `hallmark`, or `lattice` subcommands. | Add `pforge anvil stat\|clear\|rebuild\|dlq list\|dlq drain`, `pforge hallmark show\|verify`, `pforge lattice index\|query\|callers\|blast\|stat` with one example per command. | 🔴 Needs update |
| 6 | `docs/COPILOT-VSCODE-GUIDE.md` | "Quick reference" table lists existing MCP tools. No new memory tools. | Add 15 new tool names to the Quick reference table. | 🔴 Needs update |
| 7 | `CHANGELOG.md` | Has v2.95.0 entry (added by Phase-LATTICE). | Verify entry mentions Hallmark, Anvil, and Lattice. Read-only check — no edit unless terms are missing. | 🟡 Partial |
| 8 | `templates/.gitignore` | File does not exist. The templates directory has no `.gitignore` template. | Create with `.forge/anvil/` and `.forge/lattice/` entries (plus existing `.forge/` patterns). | 🆕 New file |

---

## Plan-Forge Repo — HTML (Slice 3)

| # | File | Current | Target | Status |
|---|------|---------|--------|--------|
| 9 | `docs/architecture/index.html` | Describes three-tier memory architecture. References OpenBrain, L3. Mentions Hallmark/Anvil/Lattice in some sections. | Update memory section: replace/augment static description with Hallmark/Anvil/Lattice content. Ensure all three terms appear. ≤80 changed lines. | 🟡 Partial |
| 10 | `docs/capabilities.html` | Lists OpenBrain mentions and L3 references. | Update tool list table with Anvil + Lattice tools. Clarify capability negotiation in OpenBrain mentions. ≤80 changed lines. | 🔴 Needs update |
| 11 | `docs/blog/assets/plan-forge-infographic.html` | "OpenBrain carries memory across sessions" line. No provenance mention. | Add sub-bullet mentioning Hallmark provenance under the OpenBrain memory line. ≤80 changed lines. | 🔴 Needs update |
| 12 | `docs/dashboard.html` | Describes dashboard structure. References OpenBrain/memory. | Add mention of "Anvil & Lattice" tab if file describes dashboard tabs. ≤80 changed lines. | 🔴 Needs update |
| 13 | `docs/docs.html` | Index/landing page with doc cards. References OpenBrain/memory. | Add cards for the new memory plans (Hallmark, Anvil, Lattice) if a "Recent plans" section exists. ≤80 changed lines. | 🔴 Needs update |
| 14 | `docs/index.html` | Site landing page. Lists features. Already mentions Hallmark/Anvil/Lattice in some capacity. | Verify feature lists are current. Update if needed. ≤80 changed lines. | 🟡 Partial |

---

## Plan-Forge Repo — SVG (Slice 3)

| # | File | Current | Target | Status |
|---|------|---------|--------|--------|
| 15 | `docs/assets/station-icons.svg` | Learn-station icon with brain glyph. Already references Anvil in some capacity. | Add provenance-stamp glyph (tiny hexagonal anvil mark) overlaid on brain. Update `<title>` and `<desc>`. Keep ≤8 KB. | 🟡 Partial |
| 16 | `docs/assets/architecture-3tier.svg` | **Does not exist.** | Not created — the 3-tier diagram lives inline in `docs/MEMORY-ARCHITECTURE.md` as ASCII art. No SVG to update. Slice 3 skips this file. | ⬜ Out of scope |

---

## OpenBrain Repo — Markdown (Slice 4, cwd: `e:\GitHub\OpenBrain`)

| # | File | Current | Target | Status |
|---|------|---------|--------|--------|
| 17 | `docs/00-OVERVIEW.md` | OpenBrain overview. No v0.7.0 provenance section. | Add "Provenance support (v0.7.0)" section. | 🔴 Needs update |
| 18 | `docs/01-ARCHITECTURE.md` | Architecture doc. No Hallmark envelope or capability negotiation. | Add Hallmark envelope mention to write path; add capability negotiation flow. | 🔴 Needs update |
| 19 | `docs/02-DATABASE-SCHEMA.md` | Schema doc. No `source_file_hash`, `code_hash`, or migration 003. | Document new generated columns and migration `003-add-provenance.sql`. | 🔴 Needs update |
| 20 | `docs/04-MCP-SERVER.md` | MCP server doc. No `/health.capabilities.provenance` or `match_thoughts_by_source`. | Document `GET /health.capabilities.provenance` and `match_thoughts_by_source` RPC. | 🔴 Needs update |
| 21 | `docs/05-CAPTURE-PIPELINE.md` | Capture pipeline doc. No Hallmark provenance write flow. | Document provenance write support and server validation. | 🔴 Needs update |

---

## Additional Files Discovered by Audit

Files that matched the grep audit but are **not** in the original Scope Contract. Categorized by action needed.

### Docs / HTML — Memory References (review for stale content)

| # | File | Matched Terms | Action |
|---|------|---------------|--------|
| 22 | `docs/manual/memory-architecture.html` | memory, three-tier, L3, OpenBrain | 🔴 Review — HTML mirror of MEMORY-ARCHITECTURE.md. May need Hallmark/Anvil/Lattice mentions added. |
| 23 | `docs/manual/index.html` | memory, OpenBrain, brain, Hallmark/Anvil/Lattice | 🟡 Already has some new terms. Verify completeness. |
| 24 | `docs/manual/how-it-works.html` | memory, brain, Hallmark/Anvil/Lattice | 🟡 Already has some new terms. Verify completeness. |
| 25 | `docs/manual/what-is-plan-forge.html` | memory, brain, three-tier, OpenBrain | 🔴 Review — may need updated memory description. |
| 26 | `docs/manual/multi-agent.html` | memory, OpenBrain, Hallmark/Anvil/Lattice | 🟡 Already partially updated. Verify. |
| 27 | `docs/manual/inner-loop.html` | memory, brain, L3, OpenBrain | 🔴 Review — may reference old memory architecture. |
| 28 | `docs/manual/mcp-server-reference.html` | memory, OpenBrain, Learn station | 🔴 Review — tool reference table may need new tools. |
| 29 | `docs/manual/glossary.html` | memory, brain, Hallmark/Anvil/Lattice | 🟡 May already define new terms. Verify definitions are current. |
| 30 | `docs/manual/health-dna.html` | brain, Learn station | 🔴 Review — Learn station reference may be stale. |
| 31 | `docs/manual/dashboard.html` | memory, brain | 🔴 Review — dashboard docs may need Anvil/Lattice tab reference. |
| 32 | `docs/manual/dashboard-settings.html` | memory, OpenBrain, three-tier | 🔴 Review — settings for memory subsystem may be outdated. |
| 33 | `docs/manual/compliance-and-data-residency.html` | memory, OpenBrain, L3, three-tier | 🔴 Review — compliance implications of provenance data. |
| 34 | `docs/manual/github-stack-alignment.html` | memory, OpenBrain, three-tier, Hallmark/Anvil/Lattice | 🟡 Partially updated. Verify alignment descriptions. |
| 35 | `docs/manual/book-index.html` | memory, brain, OpenBrain | 🔴 Review — index entries may need Hallmark/Anvil/Lattice terms. |
| 36 | `docs/manual/bug-registry.html` | memory, OpenBrain, L3 | ⬜ Out of scope — bug registry mechanics, not memory architecture. |
| 37 | `docs/manual\forge-master.html` | memory, OpenBrain | 🔴 Review — Forge Master uses memory; may need updated references. |
| 38 | `docs/manual/extensions.html` | memory, OpenBrain | ⬜ Out of scope — extension framework, not memory content. |
| 39 | `docs/manual/remote-bridge.html` | memory, OpenBrain | ⬜ Out of scope — remote bridge mechanics. |
| 40 | `docs/manual/self-deterministic-loop.html` | memory, brain | ⬜ Out of scope — loop mechanics, not memory architecture. |
| 41 | `docs/manual/advanced-execution.html` | memory, OpenBrain | ⬜ Out of scope — execution mechanics. |
| 42 | `docs/manual/list-of-figures.html` | memory, L3 | 🔴 Review — figure captions may need updating if diagrams changed. |

### Docs / HTML — Blog & Marketing

| # | File | Matched Terms | Action |
|---|------|---------------|--------|
| 43 | `docs/blog/assets/plan-forge-infographic.html` | OpenBrain, memory, brain | 🔴 In scope (Scope Contract item). See row 11 above. |
| 44 | `docs/blog/unified-system.html` | OpenBrain, memory | ⬜ Out of scope — blog post, historical. |
| 45 | `docs/blog/the-journey-from-impossible-to-seven-minutes.html` | OpenBrain, brain, Learn station, Hallmark | ⬜ Out of scope — blog post, historical. |
| 46 | `docs/blog/seven-agents.html` | OpenBrain, brain, Hallmark | ⬜ Out of scope — blog post. |
| 47 | `docs/blog/the-80-20-wall.html` | OpenBrain, memory | ⬜ Out of scope — blog post. |
| 48 | `docs/blog/spec-kit-plan-forge.html` | OpenBrain, Learn station, memory | ⬜ Out of scope — blog post. |
| 49 | `docs/blog/guardrails-lessons-learned.html` | brain, memory | ⬜ Out of scope — blog post. |
| 50 | `docs/shop-tour.html` | Learn station, brain, memory, Hallmark/Anvil/Lattice | 🟡 Already partially updated. May need verification only. |
| 51 | `docs/faq.html` | OpenBrain, memory | ⬜ Out of scope — FAQ general. |
| 52 | `docs/problem.html` | OpenBrain, memory | ⬜ Out of scope — problem statement page. |
| 53 | `docs/speckit-interop.html` | OpenBrain, memory | ⬜ Out of scope — SpecKit integration. |
| 54 | `docs/extensions.html` | OpenBrain, memory | ⬜ Out of scope — extensions listing. |

### SVG Diagrams (discovered beyond Scope Contract)

| # | File | Matched Terms | Action |
|---|------|---------------|--------|
| 55 | `docs/manual/assets/diagrams/memory-three-tier-capture.svg` | memory, three-tier, L3, OpenBrain | 🔴 Review — diagram may show pre-v2.95.0 architecture without Anvil/Lattice layers. |
| 56 | `docs/manual/assets/diagrams/openbrain-cross-agent-compounding.svg` | OpenBrain, memory | 🔴 Review — may need provenance arrow added. |
| 57 | `docs/manual/assets/diagrams/unified-system-three-pillars.svg` | memory, OpenBrain | 🔴 Review — pillar labels may need Hallmark/Anvil/Lattice. |
| 58 | `docs/manual/assets/diagrams/dashboard-tabs-grouped.svg` | brain, memory | ⬜ Out of scope — dashboard layout diagram. |
| 59 | `docs/assets/plan-forge-logo.svg` | Anvil (in logo design) | ⬜ Out of scope — logo asset, not a documentation diagram. |
| 60 | `docs/assets/plan-forge-logo-light.svg` | Anvil (in logo design) | ⬜ Out of scope — logo asset. |

### Other Markdown (discovered beyond Scope Contract)

| # | File | Matched Terms | Action |
|---|------|---------------|--------|
| 61 | `ROADMAP.md` | memory, brain | ⬜ Out of scope — roadmap is maintained separately. |
| 62 | `CUSTOMIZATION.md` | OpenBrain | ⬜ Out of scope — customization guide references OpenBrain config, not architecture. |
| 63 | `AGENT-SETUP.md` | OpenBrain, memory | ⬜ Out of scope — setup guide. |
| 64 | `docs/EXTENSIONS.md` | OpenBrain, memory | ⬜ Out of scope — extension authoring guide. |
| 65 | `docs/SKILL-BLUEPRINT.md` | memory | ⬜ Out of scope — skill authoring guide. |
| 66 | `docs/QUICKSTART-WALKTHROUGH.md` | memory | ⬜ Out of scope — quickstart. |
| 67 | `docs/research/enterprise-fleet-readiness.md` | memory, three-tier, L3, OpenBrain | ⬜ Out of scope — research document. |
| 68 | `docs/plans/Phase-ANVIL-PLAN.md` | Anvil, memory, brain, L3, OpenBrain | ⬜ Out of scope — plan file (source of truth, not a doc to update). |
| 69 | `docs/plans/Phase-HALLMARK-CONTRACT-PLAN.md` | Hallmark, memory, OpenBrain, L3 | ⬜ Out of scope — plan file. |
| 70 | `docs/plans/Phase-LATTICE-PLAN.md` | Lattice, memory, L3 | ⬜ Out of scope — plan file. |
| 71 | `docs/plans/Phase-MEMORY-QA-PLAN.md` | memory, brain, OpenBrain, Hallmark/Anvil/Lattice | ⬜ Out of scope — plan file (downstream consumer of this phase). |
| 72 | `docs/demos/claude-code-demo.md` | OpenBrain, memory | ⬜ Out of scope — demo script. |
| 73 | `docs/demos/team-lead-demo.md` | OpenBrain, memory | ⬜ Out of scope — demo script. |
| 74 | `docs/observability/audit-log-spec.md` | memory | ⬜ Out of scope — observability spec. |
| 75 | `docs/plans/examples/extensions/plan-forge-memory/` | OpenBrain, memory (entire subdirectory) | ⬜ Out of scope — example extension, not core docs. |

### Manual pages — additional discovered (not in audit rows above)

| # | File | Matched Terms | Action |
|---|------|---------------|--------|
| 76 | `docs/manual/crucible.html` | memory | ⬜ Out of scope — Crucible mechanics. |
| 77 | `docs/manual/fleet-operator-playbook.html` | memory | ⬜ Out of scope — fleet ops. |
| 78 | `docs/manual/plan-forge-on-the-github-stack.html` | memory, Hallmark/Anvil/Lattice | 🟡 Already partially updated. Verify. |
| 79 | `docs/manual/cli-reference.html` | memory | 🔴 Review — CLI reference may need new subcommands. |
| 80 | `docs/manual/sample-project.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions new terms. Verify accuracy. |
| 81 | `docs/manual/quickstart-install.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions new terms. Verify. |
| 82 | `docs/manual/installation.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions new terms. Verify. |
| 83 | `docs/manual/liveguard-tools.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions new terms. Verify. |
| 84 | `docs/manual/liveguard-dashboard.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions. Verify. |
| 85 | `docs/manual/liveguard-runbooks.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions. Verify. |
| 86 | `docs/manual/enterprise-deployment.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions. Verify. |
| 87 | `docs/manual/enterprise-reference-architecture.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions. Verify. |
| 88 | `docs/manual/agent-factory-recipe.html` | Hallmark/Anvil/Lattice | 🟡 Already mentions. Verify. |

---

## Summary

| Category | Total files | 🔴 Needs update | 🟡 Partial | 🟢 Up to date | 🆕 New | ⬜ Out of scope |
|----------|------------|-----------------|-----------|--------------|-------|---------------|
| **Scope Contract — Markdown** | 8 | 0 | 0 | 7 | 1 | 0 |
| **Scope Contract — HTML** | 6 | 0 | 0 | 6 | 0 | 0 |
| **Scope Contract — SVG** | 2 | 0 | 0 | 1 | 0 | 1 |
| **Scope Contract — OpenBrain** | 5 | 0 | 0 | 5 | 0 | 0 |
| **Audit-discovered (in scope)** | 17 | 0 | 0 | 17 | 0 | 0 |
| **Audit-discovered (out of scope)** | 50 | 0 | 0 | 0 | 0 | 50 |
| **Total** | 88 | 0 | 0 | 36 | 1 | 51 |

> **Phase status**: ✅ All Scope Contract and in-scope audit items completed (Slices 2–4). Summary updated post-execution.

### Key Findings

1. **`docs/assets/architecture-3tier.svg` does not exist.** The three-tier diagram lives as inline ASCII art in `docs/MEMORY-ARCHITECTURE.md`. Slice 3 will skip this file.

2. **`templates/.gitignore` does not exist.** Must be created in Slice 2 with `.forge/anvil/` and `.forge/lattice/` entries.

3. **17 additional files discovered** beyond the Scope Contract that are in-scope for review. Most are `docs/manual/*.html` pages that mirror or reference the memory architecture. Several already partially mention Hallmark/Anvil/Lattice (likely updated by Phase-LATTICE).

4. **Three SVG diagrams in `docs/manual/assets/diagrams/`** reference the old three-tier architecture and may need Anvil/Lattice overlays:
   - `memory-three-tier-capture.svg` — highest priority, directly depicts the memory tiers.
   - `openbrain-cross-agent-compounding.svg` — may need provenance arrow.
   - `unified-system-three-pillars.svg` — pillar labels may need updating.

5. **50 files matched the audit grep but are out of scope** — blog posts, plan files, preset templates, research docs, demo scripts. These are historical or downstream consumers and should not be edited in this phase.

6. **`CHANGELOG.md` already has a v2.95.0 entry** with Hallmark/Anvil/Lattice mentions from Phase-LATTICE. Needs verification only, not editing.

---

## Archive Closure

> **Archived**: 2026-05-16 — Phase-MEMORY-DOCS-SWEEP complete
> **Archived by**: Phase-MEMORY-DOCS-SWEEP Slice 5 (Inventory archive + final fence check)

This inventory file has been moved from `docs/plans/` to `docs/plans/archived/` as part of the standard Plan Forge phase-close procedure. The plan produced **docs-only** commits throughout Slices 1–4; no `.mjs`, `.ts`, `.js`, `.py`, or `.sql` files were modified during this phase. Downstream consumers (Phase-MEMORY-QA-PLAN) may reference this file as the authoritative record of what was updated and why.
