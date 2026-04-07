# Plan Forge — User Manual Plan

> **Status**: Planning — iterating on structure  
> **Location**: `docs/manual/`  
> **Format**: Vanilla HTML (Tailwind CDN, no build step, GitHub Pages compatible)  
> **Goal**: Single navigable reference book consolidating all existing documentation

---

## Design Principles

- **No build step** — matches existing site (`docs/*.html`), ships as static HTML
- **Mobile-friendly** — responsive sidebar collapses to hamburger on small screens
- **Client-side search** — lightweight JS indexing headings + first paragraph of each section (~50 lines)
- **Dark mode** — matches existing site (`bg-slate-900` base)
- **Print-friendly** — `@media print` stylesheet strips nav, expands all sections
- **Deep-linkable** — every heading gets an anchor, shareable URLs like `manual/cli-reference.html#smith`

---

## Chapter Structure

| # | Chapter | Source Material | Key Visuals |
|---|---------|----------------|-------------|
| 1 | **Getting Started** | README.md Quick Start, QUICKSTART-WALKTHROUGH.md | Terminal recording of first setup |
| 2 | **Installation & Setup** | AGENT-SETUP.md, setup.ps1/sh docs | Before/after file tree diagram |
| 3 | **Presets & Stacks** | README.md presets table, preset AGENTS.md files | 9-stack grid (reuse site asset) |
| 4 | **The Pipeline** | AI-Plan-Hardening-Runbook.md | Mermaid: 7-step pipeline flow |
| 5 | **Writing Plans** | AI-Plan-Hardening-Runbook-Instructions.md, step0–step5 prompts | Annotated plan example |
| 6 | **Executing Plans** | CLI-GUIDE.md run-plan section, orchestrator docs | Dashboard progress screenshot |
| 7 | **The Dashboard** | dashboard.html descriptions, app.js tab list | Tab-by-tab screenshots (9 tabs) |
| 8 | **CLI Reference** | CLI-GUIDE.md full command reference | Command cheat sheet table |
| 9 | **Customization** | CUSTOMIZATION.md | Mermaid: 2-layer config hierarchy |
| 10 | **Instruction Files & Agents** | capabilities.md, COPILOT-VSCODE-GUIDE.md | applyTo pattern diagram |
| 11 | **MCP Server & Tools** | capabilities.md API section, tools.json | REST endpoint table, tool catalog |
| 12 | **Extensions** | EXTENSIONS.md, extensions.html, catalog.json | Extension card grid |
| 13 | **Multi-Agent Setup** | AGENT-SETUP.md agent sections, adapter docs | Agent adapter comparison table |
| 14 | **Troubleshooting & FAQ** | faq.html, COPILOT-VSCODE-GUIDE.md troubleshooting | Decision tree: "My agent isn't..." |
| 15 | **Appendix: Glossary** | capabilities.mjs glossary object | Alphabetical term index |

---

## File Structure

```
docs/manual/
├── index.html              ← TOC / landing page with chapter cards
├── getting-started.html    ← Chapter 1
├── installation.html       ← Chapter 2
├── presets.html             ← Chapter 3
├── pipeline.html            ← Chapter 4
├── writing-plans.html       ← Chapter 5
├── executing-plans.html     ← Chapter 6
├── dashboard.html           ← Chapter 7
├── cli-reference.html       ← Chapter 8
├── customization.html       ← Chapter 9
├── instructions-agents.html ← Chapter 10
├── mcp-server.html          ← Chapter 11
├── extensions.html          ← Chapter 12
├── multi-agent.html         ← Chapter 13
├── troubleshooting.html     ← Chapter 14
├── glossary.html            ← Chapter 15 (Appendix)
├── assets/
│   ├── manual.css           ← Manual-specific styles (imports shared.css)
│   ├── manual.js            ← Sidebar, search, nav, print
│   ├── screenshots/         ← Chapter-specific screenshots
│   └── diagrams/            ← Exported Mermaid SVGs (fallback for no-JS)
└── book-manual-plan.md      ← This file
```

---

## Shared Components

### Sidebar (all pages)
```
┌──────────────────────────┐
│  📖 Plan Forge Manual    │
│  v2.x                    │
├──────────────────────────┤
│  🔍 Search...            │
├──────────────────────────┤
│  1. Getting Started       │
│  2. Installation          │
│  3. Presets & Stacks      │
│  4. The Pipeline          │
│  5. Writing Plans         │
│  6. Executing Plans       │
│  7. The Dashboard         │
│  8. CLI Reference         │
│  9. Customization         │
│  10. Instructions & Agents│
│  11. MCP Server & Tools   │
│  12. Extensions           │
│  13. Multi-Agent Setup    │
│  14. Troubleshooting      │
│  A. Glossary              │
├──────────────────────────┤
│  ← Back to Site           │
│  ↗ GitHub                 │
└──────────────────────────┘
```

### Page Template
```
┌─────────────────────────────────────────────────┐
│  [Sidebar]  │  Chapter N: Title                 │
│             │                                    │
│             │  In This Chapter:                  │
│             │  • Section 1                       │
│             │  • Section 2                       │
│             │  • Section 3                       │
│             │                                    │
│             │  ─── Content ───                   │
│             │                                    │
│             │  [code blocks, screenshots,        │
│             │   diagrams, callout boxes,         │
│             │   step-by-step guides]             │
│             │                                    │
│             │  ─── Footer ───                    │
│             │  ← Prev Chapter  │  Next Chapter → │
│             │  Last updated: 2026-04-07          │
└─────────────────────────────────────────────────┘
```

### Callout Boxes
- 💡 **Tip** — helpful shortcuts or best practices
- ⚠️ **Warning** — common mistakes to avoid
- 📋 **Example** — concrete code/config examples
- 🔗 **See Also** — cross-references to other chapters

---

## Visual Assets Needed

| Asset | Type | Chapter | Source |
|-------|------|---------|--------|
| Setup wizard terminal recording | GIF/WebM | 2 | Record `setup.ps1 -Preset dotnet` run |
| 9-stack grid | Image | 3 | Reuse `docs/assets/tech-stacks-grid.webp` |
| Pipeline flow | Mermaid SVG | 4 | Render from Runbook pipeline diagram |
| Plan anatomy | Annotated screenshot | 5 | Annotate a real plan file |
| Dashboard tabs (9) | Screenshots | 7 | `capture-screenshots.mjs` |
| CLI cheat sheet | HTML table | 8 | Generate from `cli-schema.json` |
| Config hierarchy | Mermaid SVG | 9 | New diagram: .forge.json → preferences.json → .vscode/settings.json |
| applyTo pattern flow | Mermaid SVG | 10 | How frontmatter → file matching works |
| Extension lifecycle | Mermaid SVG | 12 | search → install → update → remove |
| Agent adapter comparison | HTML table | 13 | Matrix: Copilot vs Claude vs Cursor vs Codex vs Gemini vs Windsurf |
| Troubleshooting decision tree | Mermaid SVG | 14 | "Agent not responding?" → branching diagnosis |

---

## Search Implementation

Lightweight client-side search (no server, no index build):

```javascript
// On page load: build index from all chapter links
// Each entry: { title, url, headings[], firstParagraph }
// On keystroke: filter by title + heading text
// Show dropdown with chapter → heading matches
// Click navigates to chapter.html#heading-anchor
```

No external dependencies — just DOM manipulation + `fetch()` to load chapter metadata.

---

## Content Migration Strategy

For each chapter:
1. **Copy** — pull relevant sections from source `.md` / `.html` files
2. **Restructure** — organize into a logical chapter flow with intro → concepts → examples → reference
3. **Enrich** — add screenshots, diagrams, callout boxes, cross-references
4. **Trim** — remove duplicate explanations that are better covered in other chapters (link instead)
5. **Review** — ensure code examples are current, screenshots match latest dashboard

**Important**: The source files (README, CLI-GUIDE, etc.) remain authoritative. The manual is a *reader-friendly presentation* of the same content, not a replacement. When source docs change, the manual chapter should be updated too — add this to the doc sweep tables for future features.

---

## Iteration Plan

### Round 1 — Shell
- [ ] `index.html` with chapter cards and basic styling
- [ ] `manual.css` + `manual.js` (sidebar, nav, search stub)
- [ ] One complete chapter (Chapter 8: CLI Reference — most structured, easiest to migrate)
- [ ] Page template verified on desktop + mobile

### Round 2 — Core Chapters
- [ ] Chapters 1–6 (the "learn Plan Forge" flow)
- [ ] Screenshots captured for Chapters 2 + 7
- [ ] Mermaid diagrams rendered for Chapters 4 + 5

### Round 3 — Reference Chapters
- [ ] Chapters 7–11 (dashboard, CLI, customization, agents, MCP)
- [ ] Searchable index built from all chapters
- [ ] Glossary auto-generated from `capabilities.mjs` glossary object

### Round 4 — Polish
- [ ] Chapters 12–14 (extensions, multi-agent, troubleshooting)
- [ ] Print stylesheet
- [ ] Cross-chapter links verified
- [ ] Link from main site nav (`docs/index.html`) to manual
- [ ] `docs/manual/` added to sitemap / `llms.txt`

---

## Open Questions

- [ ] Should the manual version track Plan Forge version? (e.g., "Manual for v2.17")
- [ ] Should chapters have a "Last verified" date to flag stale content?
- [ ] Should we auto-generate the glossary from `capabilities.mjs` at build time, or maintain it manually?
- [ ] Should the CLI Reference chapter be auto-generated from `cli-schema.json`?
- [ ] Do we want a "What's New" chapter that mirrors CHANGELOG but in narrative form?
