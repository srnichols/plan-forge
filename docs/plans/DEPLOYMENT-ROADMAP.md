# Deployment Roadmap

> **Purpose**: Master tracker for all project phases.  
> **How to use**: Add phases as they're planned. Link to plan files. Update status as work progresses.

---

## Status Legend

| Icon | Meaning |
|------|---------|
| 📋 | Planned — not yet started |
| 🚧 | In Progress — actively being worked on |
| ✅ | Complete — all Definition of Done criteria met |
| ⏸️ | Paused — blocked or deprioritized |

---

## Phases

### Phase 1: <Your First Feature>
**Goal**: (one-line description of what this phase delivers)  
**Plan**: [Phase-1-YOUR-FEATURE-PLAN.md](./Phase-1-YOUR-FEATURE-PLAN.md)  
**Status**: 📋 Planned

---

### Phase 2: <Your Second Feature>
**Goal**: (one-line description)  
**Plan**: [Phase-2-YOUR-FEATURE-PLAN.md](./Phase-2-YOUR-FEATURE-PLAN.md)  
**Status**: 📋 Planned

---

<!-- Add more phases as needed. Each phase should link to its *-PLAN.md file. -->

---


---

### Phase 1: orchestrator-run-plan
**Goal**: DAG-based plan execution with CLI worker spawning
**Plan**: [Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md](./Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md)
**Status**: ✅ Complete

---

### Phase 7: Quorum Mode — Multi-Model Consensus Execution
**Goal**: Dispatch high-complexity slices to 3 AI models for dry-run consensus, synthesize best approach, execute with higher confidence
**Plan**: [Phase-7-QUORUM-MODE-PLAN.md](./Phase-7-QUORUM-MODE-PLAN.md)
**Status**: ✅ Complete

---

### Phase 8: Skill Slash Command Upgrade — MCP-Integrated Executable Skills
**Goal**: Upgrade all 8 app-preset skills and 3 azure-iac skills from static markdown playbooks to MCP-integrated procedures with validation gates, conditional logic, hub events, and structured output. Add 2 new shared skills (`/health-check`, `/forge-execute`). Tier 3 adds a programmable Skill Engine with `forge_run_skill` MCP tool. Includes comprehensive doc sweep across 18 markdown files, 5 HTML pages, and 11 code/config files.
**Plan**: [Phase-8-SKILL-UPGRADE-PLAN.md](./Phase-8-SKILL-UPGRADE-PLAN.md)
**Status**: ✅ Complete

---

### Phase 9: Dashboard Enhancement — Low-Hanging Fruit GUI Tools
**Goal**: Add plan browser with estimate/run, git operation buttons (branch, commit, diff), sweep table view, model performance comparison, and phase status editor to the dashboard
**Plan**: [Phase-9-DASHBOARD-ENHANCEMENT-PLAN.md](./Phase-9-DASHBOARD-ENHANCEMENT-PLAN.md)
**Status**: 🚧 In Progress

## Completed Phases

<!-- Move phases here when they reach ✅ Complete status -->

| Phase | Goal | Plan | Completed |
|-------|------|------|-----------|
| — | — | — | — |

---

## Notes

- Each phase goes through the [Plan Forge Pipeline](./AI-Plan-Hardening-Runbook-Instructions.md) before execution
- Phase plans are stored in this directory (`docs/plans/`)
- Guardrail files are updated after each phase completion (Step 5 of the pipeline)
