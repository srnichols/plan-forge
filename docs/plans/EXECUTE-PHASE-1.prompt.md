---
description: "Execute Phase 1 of v2.0 — Orchestrator (forge_run_plan). Read review findings first, apply critical fixes, then execute slices."
---

# Execute: Phase 1 — Orchestrator (`forge_run_plan`)

You are executing Phase 1 of Plan Forge v2.0 — the Orchestrator.

## BEFORE WRITING ANY CODE:

1. Read these files in order:
   - `docs/plans/REVIEW-FINDINGS-v2.0.md` (critical fixes that MUST be applied to the plan before execution)
   - `docs/plans/Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md` (the hardened execution plan)
   - `ROADMAP.md` (v2.0 section for context)
   - `mcp/server.mjs` (existing MCP server you're extending)
   - `.github/instructions/architecture-principles.instructions.md` (follow these rules)

2. The REVIEW-FINDINGS-v2.0.md has 6 critical fixes (C1-C6) and 8 medium fixes (M1-M8).
   Apply **C1-C4, M1-M2, and M6** to the Phase 1 plan FIRST — update the plan file, then execute.

3. Key architecture decisions already made:
   - **DAG-based executor from day 1** (not sequential — C2). Sequential = DAG with no parallel tags.
   - **Event emitter pattern** with dependency injection (C3). Orchestrator emits events, hub subscribes later.
   - **Session log capture** to `slice-N-log.txt` (C4). Phase 5 Session Replay depends on this.
   - **Three execution modes**: Full Auto (Claude CLI), Full Auto (Copilot CLI — needs spike), Assisted (VS Code Copilot)
   - **Token tracking consolidated** into Phase 1 (M1). Captures tokens from CLI output per slice.
   - **`.forge/SCHEMA.md`** documenting all `.forge/` files (M2).
   - **Scope metadata parsing** for slices — optional `[scope: src/auth/**]` (M6). Enables Phase 6 conflict detection.

4. **START WITH SLICE 0: CLI Spawning Spike**
   Test all worker options:
   - `claude` CLI non-interactive invocation (pipe context via stdin)
   - `codex` CLI non-interactive invocation (skills mode)
   - `gh copilot` CLI with context injection (pipe guardrail content)
   - VS Code Copilot programmatic control (likely NO — confirm)
   - Validation-only mode (run build/test without agent)
   Document results in `.forge/spike-results.md` before proceeding to Slice 1.

5. **Feature branch**: `git checkout feature/v2.0-autonomous-execution`
   All work goes on this branch. Follow conventional commits: `feat(orchestrator): <description>`

6. **After each slice**: Run validation gates from the plan, then commit.
   Do not proceed to the next slice until gates pass.

7. **Model suggestions per slice**:
   - Slice 0 (Spike): Any — manual testing
   - Slice 1 (DAG Engine): Claude — architectural, multi-file
   - Slice 2 (Storage + Schema): Codex/Auto — mechanical file I/O
   - Slice 3 (MCP Tools): Codex/Auto — follows existing pattern
   - Slice 4 (CLI Commands): Codex/Auto — follows existing pattern
   - Slice 5 (Model Routing): Codex/Auto — config + JSON schema
   - Slice 6 (Auto-Sweep/Analyze): Codex/Auto — calls existing commands
   - Slice 7 (Token Tracking): Claude — needs understanding of token APIs
   - Slice 8 (Docs + Smith): Claude — cross-file consistency

Execute slice by slice. Do not skip ahead. Ask me if any NEEDS CLARIFICATION markers block progress.

---

## Quick Reference

| Resource | Path |
|---|---|
| Phase 1 Plan | `docs/plans/Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md` |
| Review Findings | `docs/plans/REVIEW-FINDINGS-v2.0.md` |
| Existing MCP Server | `mcp/server.mjs` |
| Roadmap | `ROADMAP.md` |
| Architecture Principles | `.github/instructions/architecture-principles.instructions.md` |
| All Phase Plans | `docs/plans/Phase-*-PLAN.md` (1-6) |
| Demo Scripts | `docs/demos/*.md` (5 audience-specific demos) |
| Repo Memory | `/memories/repo/v2-architecture-notes.md` |
