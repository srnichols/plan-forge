# Phase-MEMORY-DOCS-SWEEP: Documentation + SVG + Diagram Refresh for Hallmark/Anvil/Lattice (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Docs (HTML, MD, SVG) only — zero code edits.
> **Estimated cost**: $6.00–$10.00 (5 slices, mostly Markdown + a few SVG/HTML edits)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Source**: User request after approving phases 1–4: *"add a doc sweep update once done as our memory system is getting a big upgrade, lots of docs and svgs to update."*
> **Position in chain**: 5 of 6 — depends on Phase-LATTICE being shipped at `v2.95.0` (so docs describe the real released surface). Feeds Phase-MEMORY-QA (QA cites the new docs as its source of truth).
> **Release target**: Documentation patch alongside `v2.95.0` (no version bump in this phase; docs land as part of the same released minor).

---

## Scope Contract

### In Scope

#### Plan-Forge repo — Markdown

- `docs/MEMORY-ARCHITECTURE.md` — major rewrite:
  - Update 3-tier diagram to show Hallmark envelope on every write, Anvil cache between tools and L1/L2, Lattice as a separate parallel index, and the capability-negotiation arrow to OpenBrain.
  - Add new sections: "Hallmark Provenance Envelope", "Anvil Δ-only Memoization", "Lattice Code Index", "Capability Negotiation with OpenBrain", "Slag-Heap DLQ".
  - Add a "What changed in v2.95.0" callout at the top.
  - Cross-link to `pforge-sdk/schemas/hallmark-provenance.v1.json`, Phase-HALLMARK-CONTRACT, Phase-ANVIL, Phase-LATTICE plans.
- `README.md` — Smelt/Forge/Guard/Learn descriptions:
  - Update "Learn" station description to mention Hallmark provenance + capability negotiation with OpenBrain.
  - Add Anvil + Lattice mentions to the tool count / capability summary.
  - Update any "since v2.x" version mentions to reference `v2.95.0`.
- `docs/capabilities.md` — regenerate via the existing `pforge smith` capabilities dump (or hand-update if the regen target lives in Phase-LATTICE Slice 10) so it reflects the new tools.
- `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` — add Hallmark/Anvil/Lattice into the unified diagram and the section after "Memory subsystem".
- `docs/MEMORY-ARCHITECTURE.md` is the *primary* doc; the others reference it.
- `docs/CLI-GUIDE.md` — add `pforge anvil`, `pforge hallmark`, `pforge lattice` subcommands.
- `docs/COPILOT-VSCODE-GUIDE.md` — add the new MCP tool names to the "Quick reference" table.
- `docs/manual/` — index page + any memory-related child pages (sweep finds them in Slice 1).
- `CHANGELOG.md` — already touched in Phase-LATTICE Slice 10; this phase only verifies the docs entry is present.
- `templates/.gitignore` (the template shipped to consuming projects) — add `.forge/anvil/` and `.forge/lattice/` entries.

#### Plan-Forge repo — HTML

- `docs/architecture/index.html` — three-tier memory diagram block: replace static description with the new Hallmark/Anvil/Lattice content. Diff scoped to the memory section only.
- `docs/capabilities.html` — update the OpenBrain mentions to clarify capability negotiation; add Anvil + Lattice in the tool list table.
- `docs/blog/assets/plan-forge-infographic.html` — "OpenBrain carries memory across sessions" line gets a sub-bullet mentioning Hallmark provenance.
- `docs/dashboard.html` — add a small mention of the new "Anvil & Lattice" tab if the file describes dashboard structure.
- `docs/docs.html` — index/landing page: add cards for the new memory plans if it has a "Recent plans" section.
- `docs/index.html` — only if it surfaces feature lists; otherwise leave alone (Slice 1 audit confirms).

#### Plan-Forge repo — SVG

- `docs/assets/station-icons.svg` — Learn-station icon: add a small provenance-stamp glyph (a tiny hexagonal anvil mark) overlaid on the brain. Keep file under 8KB.
- `docs/assets/architecture-3tier.svg` (if it exists; Slice 1 verifies) — overlay Anvil between tools and tiers, Lattice as a side index, capability handshake arrow.
- Any new SVG additions must be hand-authored (no AI-binary blob), gzip-clean, viewBox-sized, and accessible (`<title>`/`<desc>`).

#### OpenBrain repo — Markdown

- `docs/00-OVERVIEW.md` — add a "Provenance support (v0.7.0)" section.
- `docs/01-ARCHITECTURE.md` — add Hallmark envelope mention to the write path; add capability negotiation flow.
- `docs/02-DATABASE-SCHEMA.md` — document the new generated columns (`source_file_hash`, `code_hash`) and migration `003`.
- `docs/04-MCP-SERVER.md` — document `/health.capabilities.provenance` and the `match_thoughts_by_source` RPC.
- `docs/05-CAPTURE-PIPELINE.md` — call out that consumers may now write provenance and how the server validates.

### Out of Scope

- **Code changes of any kind.** This phase is documentation. If a doc reveals a code bug, file a bug via `forge_bug_register` and proceed without fixing.
- **New blog posts or release announcements.** Marketing copy is downstream of this phase.
- **Translated/localized docs.** English only.
- **CHANGELOG editing for past versions.** Only verify the `[2.95.0]` entry mentions Hallmark, Anvil, Lattice.
- **Regenerating capabilities.md from scratch if it requires running `pforge smith`** — that runs in Phase-LATTICE Slice 10. This phase only hand-edits docs in a way that aligns with the regenerated output.
- **The Plan-Forge dashboard HTML itself** (`pforge-mcp/dashboard/*.html`). Those landed in Phase-LATTICE Slice 9.
- **Sphinx / mkdocs / Jekyll rebuilds.** Authoring only; site builds via the existing `_config.yml` pipeline on push.

### Forbidden Actions

- **Do NOT edit any `.mjs`, `.json`, `.ts`, `.js`, `.py`, or `.sql` file in either repo.** Docs-only phase. Slice gate explicitly fences via `git diff --name-only` extension check.
- **Do NOT alter `.forge/` runtime files.**
- **Do NOT change the version line in `VERSION`, `pforge-mcp/package.json`, `pforge-sdk/package.json`, or `pforge-master/package.json`.** Version is already at `2.95.0` from Phase-LATTICE.
- **Do NOT introduce new images, screenshots, or binary assets larger than 64 KB without a documented reason in the slice.** SVG only when possible.
- **Do NOT update `docs/_metrics.json`** — that file is metrics-generated.
- **Do NOT delete or rename existing doc files.** Additive + in-place edits only. Renames break inbound links from blog posts and the README.
- **Do NOT modify the Plan-Forge release tag `v2.95.0`.** If a docs fix needs to ship under a tag, it ships as `v2.95.1`, and that bump happens in a follow-up phase (not here).
- **Do NOT add backlinks to or from this plan in `docs/plans/AI-Plan-Hardening-Runbook.md` (the runbook itself).** Runbook stays generic.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | Primary doc of record | RESOLVED | `docs/MEMORY-ARCHITECTURE.md`. Every other doc cross-links to it for memory details. |
| 2 | SVG editing approach | RESOLVED | Hand-edited XML only. No Inkscape exports (bloated). Keep `viewBox`, add `<title>`+`<desc>`, no inline raster. |
| 3 | Diagram of capability negotiation | RESOLVED | New sequence diagram in `MEMORY-ARCHITECTURE.md` as Mermaid `sequenceDiagram` block — renders inline on GitHub and on the docs site. |
| 4 | HTML doc edits scope discipline | RESOLVED | Each HTML edit must touch ≤ one `<section>` per file. Slice gate enforces line-count cap of 80 changed lines per HTML file (sweep flags violations). |
| 5 | Where to put the "v2.95.0 memory upgrade" callout | RESOLVED | Top of `MEMORY-ARCHITECTURE.md` (primary doc) + a one-line mention in `README.md` Memory section. Avoids callout sprawl. |
| 6 | Cross-repo docs ordering | RESOLVED | Plan-Forge docs first (the system describes itself end-to-end), OpenBrain docs second (server-side details). Slice 4 covers OpenBrain. |
| 7 | Mermaid vs ASCII diagrams | RESOLVED | Mermaid for sequence/flow, ASCII for the existing 3-tier box diagram (keep current ASCII; add a new Mermaid sequenceDiagram for capability negotiation). |
| 8 | Audit step for stale references | RESOLVED | Slice 1 produces an inventory file `docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md` listing every doc with current vs needed mentions. Subsequent slices delete or update from that list. Inventory is itself a docs file (allowed). |
| 9 | Inventory commit policy | RESOLVED | Inventory committed as part of Slice 1, archived (not deleted) at end of Slice 5 by moving to `docs/plans/archived/`. |

---

## Acceptance Criteria

### Inventory

- **MUST**: `docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md` exists and lists every file in scope with a `current → target` status row.
- **MUST**: The inventory cites at least: all files in the Scope Contract above, plus any additional file Slice 1's audit discovers (e.g., another `docs/manual/*` page mentioning OpenBrain).

### MEMORY-ARCHITECTURE.md

- **MUST**: Top of file has a "v2.95.0 Memory Upgrade" callout linking to Phase-HALLMARK-CONTRACT, Phase-ANVIL, Phase-LATTICE, Phase-PROVENANCE plans.
- **MUST**: Contains five new sections (titles): "Hallmark Provenance Envelope", "Anvil Δ-only Memoization", "Lattice Code Index", "Capability Negotiation with OpenBrain", "Slag-Heap DLQ".
- **MUST**: Contains a Mermaid `sequenceDiagram` block for capability negotiation (Plan-Forge → OpenBrain `/health` → conditional provenance write).
- **MUST**: The 3-tier diagram is updated (ASCII block) to show Anvil and Lattice as parallel layers.
- **MUST**: Renders without errors on GitHub (Markdown + Mermaid).

### README.md

- **MUST**: "Learn" station description includes the phrase "Hallmark provenance" and "capability-negotiated OpenBrain writes".
- **MUST**: Tool-count summary reflects the eight Anvil + five Lattice + two Hallmark tools = 15 new tools.
- **MUST**: No edits outside the Memory and Tools sections.

### HTML docs

- **MUST**: Each touched HTML file passes `npx html-validate` (or whatever existing linter the repo uses; gate skips if no linter is wired).
- **MUST**: Each HTML diff respects the 80-changed-line cap from Decision 4.
- **MUST**: `docs/architecture/index.html`, `docs/capabilities.html`, `docs/blog/assets/plan-forge-infographic.html` all mention "Hallmark", "Anvil", and "Lattice" at least once each.

### SVGs

- **MUST**: `docs/assets/station-icons.svg` — Learn icon gains the provenance glyph; file size ≤ 8 KB; `<title>` and `<desc>` updated.
- **MUST**: Every new or modified SVG has a `<title>` element under 80 chars and a `<desc>` element describing the icon for accessibility.
- **MUST**: SVGs render correctly when inlined in a sample HTML file (Slice 3 gate uses a tiny harness).

### CLI / Copilot guide updates

- **MUST**: `docs/CLI-GUIDE.md` lists `pforge anvil stat|clear|rebuild|dlq list|dlq drain`, `pforge hallmark show|verify`, `pforge lattice index|query|callers|blast|stat` with one example per command.
- **MUST**: `docs/COPILOT-VSCODE-GUIDE.md` "Quick reference" table mentions the 15 new tool names.

### OpenBrain docs

- **MUST**: `docs/00-OVERVIEW.md`, `docs/01-ARCHITECTURE.md`, `docs/02-DATABASE-SCHEMA.md`, `docs/04-MCP-SERVER.md`, `docs/05-CAPTURE-PIPELINE.md` each include a "v0.7.0 — Hallmark Provenance" section.
- **MUST**: `docs/02-DATABASE-SCHEMA.md` documents the two new generated columns and migration `003-add-provenance.sql`.
- **MUST**: `docs/04-MCP-SERVER.md` documents `GET /health.capabilities.provenance` and `match_thoughts_by_source` RPC.

### Templates

- **MUST**: `templates/.gitignore` includes `.forge/anvil/` and `.forge/lattice/` lines.

### Backward compatibility / fence

- **MUST**: `git diff --name-only` between Slice 1 base and Slice 5 head contains zero entries ending in `.mjs`, `.json` (other than `docs/_metrics.json` exclusion), `.ts`, `.js`, `.py`, `.sql`. Documentation extensions only (`.md`, `.html`, `.svg`, `.css` for doc styling, `.gitignore` for the templates file).
- **MUST**: No file deletions in this phase except moving the inventory to `archived/` at the end (which is a move, not a delete, but verified by gate).

---

## Execution Slices

### Slice 1: Audit + inventory generation [sequential]

**Goal**: Comprehensive grep-based inventory of every doc/SVG/HTML file referencing "OpenBrain", "memory", "three-tier", "L3", "Learn station", "brain". Output the targeted `current → target` plan.

**Files**:
- `docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md` (new)

**Depends On**: Phase-LATTICE Slice 10 (release tagged).

**Validation Gate**:
```bash
test -f docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md && grep -q 'MEMORY-ARCHITECTURE' docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md && grep -q 'station-icons.svg' docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md && echo ok
```

---

### Slice 2: Plan-Forge core Markdown updates [sequential]

**Goal**: Update `MEMORY-ARCHITECTURE.md`, `README.md`, `UNIFIED-SYSTEM-ARCHITECTURE.md`, `CLI-GUIDE.md`, `COPILOT-VSCODE-GUIDE.md`, `templates/.gitignore`.

**Files**:
- `docs/MEMORY-ARCHITECTURE.md`
- `README.md`
- `docs/UNIFIED-SYSTEM-ARCHITECTURE.md`
- `docs/CLI-GUIDE.md`
- `docs/COPILOT-VSCODE-GUIDE.md`
- `templates/.gitignore`

**Depends On**: Slice 1.

**Validation Gate**:
```bash
grep -q 'Hallmark' docs/MEMORY-ARCHITECTURE.md && grep -q 'Anvil' docs/MEMORY-ARCHITECTURE.md && grep -q 'Lattice' docs/MEMORY-ARCHITECTURE.md && grep -q 'sequenceDiagram' docs/MEMORY-ARCHITECTURE.md && grep -q 'Hallmark' README.md && grep -q '.forge/anvil/' templates/.gitignore && grep -q '.forge/lattice/' templates/.gitignore && echo ok
```

---

### Slice 3: Plan-Forge HTML + SVG updates [sequential]

**Goal**: Update `docs/architecture/index.html`, `docs/capabilities.html`, `docs/blog/assets/plan-forge-infographic.html`, `docs/dashboard.html`, `docs/docs.html`, and the SVGs in `docs/assets/`.

**Files**:
- `docs/architecture/index.html`
- `docs/capabilities.html`
- `docs/blog/assets/plan-forge-infographic.html`
- `docs/dashboard.html`
- `docs/docs.html`
- `docs/assets/station-icons.svg`
- `docs/assets/architecture-3tier.svg` (if it exists per Slice 1 audit)

**Depends On**: Slice 2.

**Validation Gate**:
```bash
grep -q 'Hallmark' docs/architecture/index.html && grep -q 'Lattice' docs/capabilities.html && grep -q 'Hallmark' docs/blog/assets/plan-forge-infographic.html && grep -q '<title>' docs/assets/station-icons.svg && [ "$(wc -c < docs/assets/station-icons.svg)" -le 8192 ] && echo ok
```

---

### Slice 4: OpenBrain docs updates (in `e:\GitHub\OpenBrain`) [sequential]

**Goal**: Five OpenBrain Markdown files. Cross-repo edit; the orchestrator must be pointed at the OpenBrain workspace for this slice (`cwd` override in the plan runner).

**Files**:
- `e:/GitHub/OpenBrain/docs/00-OVERVIEW.md`
- `e:/GitHub/OpenBrain/docs/01-ARCHITECTURE.md`
- `e:/GitHub/OpenBrain/docs/02-DATABASE-SCHEMA.md`
- `e:/GitHub/OpenBrain/docs/04-MCP-SERVER.md`
- `e:/GitHub/OpenBrain/docs/05-CAPTURE-PIPELINE.md`

**Depends On**: Slice 3.

**Validation Gate**:
```bash
grep -q 'v0.7.0' /e/GitHub/OpenBrain/docs/00-OVERVIEW.md && grep -q 'provenance' /e/GitHub/OpenBrain/docs/01-ARCHITECTURE.md && grep -q 'source_file_hash' /e/GitHub/OpenBrain/docs/02-DATABASE-SCHEMA.md && grep -q 'match_thoughts_by_source' /e/GitHub/OpenBrain/docs/04-MCP-SERVER.md && grep -q 'Hallmark' /e/GitHub/OpenBrain/docs/05-CAPTURE-PIPELINE.md && echo ok
```

*(Note: PowerShell-side runners substitute the path style automatically. The above is bash-style for the gate; the orchestrator's portability layer handles the OS difference.)*

---

### Slice 5: Inventory archive + final fence check [sequential]

**Goal**: Move inventory to archived, run the no-code-edits fence, verify all required strings exist across all touched files.

**Files**:
- `docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md` → `docs/plans/archived/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md`

**Depends On**: Slice 4.

**Validation Gate**:
```bash
test -f docs/plans/archived/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md && ! test -f docs/plans/Phase-MEMORY-DOCS-SWEEP-INVENTORY.md && [ "$(git diff --name-only HEAD~5 HEAD -- '*.mjs' '*.ts' '*.js' '*.py' '*.sql' | wc -l)" = "0" ] && echo ok
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Slice 1 audit misses a doc | Inventory grep uses broad terms ("OpenBrain", "L3", "three-tier", "brain", "memory"); any miss is caught in the final review or by Phase-MEMORY-QA. |
| HTML edits accidentally break templated layout | 80-line cap per file enforces minimal blast radius; each HTML edit scoped to one section. |
| SVG bloat from naive editing | 8 KB cap on station-icons.svg enforced via gate; hand-edit XML, no Inkscape round-trip. |
| OpenBrain repo not present locally | Slice 4 gate fails fast with a clear message; the orchestrator's `--workdir` flag points at the OpenBrain checkout. |
| Mermaid diagram doesn't render | Slice 2 includes a smoke test that the file parses as Markdown without error; Mermaid renderer is GitHub-native. |
| Code accidentally edited despite fence | Slice 5 gate explicitly counts code-file diffs; non-zero count fails the slice and forces revert. |
| Inventory becomes stale during execution | Slice 1 inventory is the authoritative target; Slices 2–4 reference it. If a file appears mid-execution, append to inventory before editing. |

---

## Definition of Done

- All five slices pass their validation gates.
- The inventory has been archived; no stale inventory file in `docs/plans/`.
- Every doc, HTML page, and SVG listed in the Scope Contract is updated.
- `git diff --stat` shows only `.md`, `.html`, `.svg`, `.css`, and `.gitignore` extensions.
- Manual smoke read of `docs/MEMORY-ARCHITECTURE.md` confirms it accurately describes the v2.95.0 surface end-to-end.
- A `git log --oneline -- docs/` for this phase shows 5 commits (one per slice) with conventional `docs(memory): ...` messages.

---

## Post-Mortem

_To be filled in after execution. Capture:_
- How many additional files did the Slice 1 audit surface beyond the original Scope Contract?
- Were any HTML/SVG edits blocked by the 80-line / 8KB caps and require a follow-up phase?
- Did the cross-repo edit in Slice 4 require any orchestrator workdir adjustments worth documenting?
- Were the Mermaid diagrams readable and accurate, or did Phase-MEMORY-QA flag any?
