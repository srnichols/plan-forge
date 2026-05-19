# Plan Forge — Internal Deployment Roadmap

> **Purpose**: Master tracker for Plan Forge framework's own in-flight and planned phases.
> **Not to be confused with**: [DEPLOYMENT-ROADMAP-TEMPLATE.md](./DEPLOYMENT-ROADMAP-TEMPLATE.md) — the template that ships to consuming projects via `setup.ps1` / `setup.sh`.
> **Release history**: See root [ROADMAP.md](../../ROADMAP.md) and [CHANGELOG.md](../../CHANGELOG.md) for shipped versions; this file tracks unshipped / planned work.

---

## Status Legend

| Icon | Meaning |
|------|---------|
| 📋 | Planned (DRAFT — Step-2 harden required before execution) |
| 🔬 | Hardened (cleared for `pforge run-plan`) |
| 🚧 | In Progress (slices executing) |
| ✅ | Complete (S-final retro committed; CHANGELOG promoted; tag pushed) |
| ⏸️ | Paused / Blocked |

---

## Active Phases

Listed in **execution order**. Each phase's Execution Hold gates on its predecessor shipping.

### Phase 39 — AUDITOR-AUTOMATION
- **Goal**: Tier the sense-making layer (Watcher / Forge-Master observer process / A4 auditor) with proper config blocks, cross-run watcher mode, and auto-invoke wiring.
- **Plan**: [Phase-39-AUDITOR-AUTOMATION-PLAN.md](./Phase-39-AUDITOR-AUTOMATION-PLAN.md)
- **Status**: 📋 Planned (DRAFT, pending Step-2 harden)
- **Depends on**: Phase-WORKER-GUARDRAILS shipping (✅ shipped)

### Phase 40 — AUDITOR-AUTOMATION-UI
- **Goal**: Dashboard surfaces for Phase 39's config knobs — settings tab for Forge-Master roles + observer/watcher/auditor observability cards.
- **Plan**: [Phase-40-AUDITOR-AUTOMATION-UI-PLAN.md](./Phase-40-AUDITOR-AUTOMATION-UI-PLAN.md)
- **Status**: 📋 Planned (DRAFT, pending Step-2 harden)
- **Depends on**: Phase 39 shipping

### Phase 41 — ENUMS-CENTRALIZATION
- **Goal**: Single source of truth for stable small-set identifiers (`pforge-mcp/enums.mjs`) — eliminates the hardcoded-array drift pattern that produced 4 separate locked-in lists during Phase 39 planning.
- **Plan**: [Phase-41-ENUMS-CENTRALIZATION-PLAN.md](./Phase-41-ENUMS-CENTRALIZATION-PLAN.md)
- **Status**: 📋 Planned (DRAFT, pending Step-2 harden)
- **Depends on**: Phase 39 + Phase 40 shipping (seeds enums file with final post-AUDITOR shape)

### Phase 42 — CLEAN-CODE-AUDIT
- **Goal**: Read-only Clean Code 2nd ed (Robert C. Martin, 2025) audit + categorized cleanup queue. **No production code change** — outputs catalog + proposed follow-up phase stubs only.
- **Plan**: [Phase-42-CLEAN-CODE-AUDIT-PLAN.md](./Phase-42-CLEAN-CODE-AUDIT-PLAN.md)
- **Status**: 📋 Planned (DRAFT, pending Step-2 harden)
- **Depends on**: Phase 41 shipping (so audit runs against the post-enums baseline)

---

## Completed Phases

| Phase | Goal | Shipped | Reference |
|-------|------|---------|-----------|
| — | All shipped phases predating this roadmap | See [CHANGELOG.md](../../CHANGELOG.md) and root [ROADMAP.md](../../ROADMAP.md) | — |

> Future shipped phases promote from the Active table above with their actual ship date and any retro notes.

---

## Notes

- Each phase goes through the [Plan Forge Pipeline](./AI-Plan-Hardening-Runbook.md) before execution: Step 0 (Specify) → Step 1 (Preflight) → **Step 2 (Harden)** → Step 3 (Execute slices) → Step 4 (Completeness sweep) → Step 5 (Review).
- A DRAFT plan's `Execution Hold` block must be cleared (Status flipped to `HARDENED`) before `pforge run-plan` will proceed.
- This roadmap lives on planning branches (e.g. `planning/phase-39-42-roadmap`) while DRAFTs are in flux; it merges to `master` once the listed phases are hardened or shipped.
- Consuming-project deployment roadmaps follow the structure in [DEPLOYMENT-ROADMAP-TEMPLATE.md](./DEPLOYMENT-ROADMAP-TEMPLATE.md) — this internal file is **not** copied by `setup.ps1` / `setup.sh`.
