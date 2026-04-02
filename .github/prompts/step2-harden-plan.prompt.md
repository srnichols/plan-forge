---
description: "Pipeline Step 2 — Harden a draft plan into an execution contract with scope contracts, execution slices, validation gates, and TBD resolution."
---

# Step 2: Harden the Plan

> **Pipeline**: Step 2 of 5 (Session 1 — Plan Hardening)  
> **When**: After pre-flight passes (Step 1)  
> **Next Step**: `step3-execute-slice.prompt.md` (new session)

Replace `<YOUR-PLAN>` with your plan filename (without path or `.md` extension).

---

Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md
2. docs/plans/<YOUR-PLAN>.md
3. docs/plans/DEPLOYMENT-ROADMAP.md
4. .github/copilot-instructions.md

Also check for prior phase lessons (if they exist — skip if not found):
- `/memories/repo/conventions.md` — patterns and conventions from earlier phases
- `/memories/repo/lessons-learned.md` — past mistakes to avoid
- `/memories/repo/forbidden-patterns.md` — patterns that caused regressions

Now act as a PLAN HARDENING AGENT (see the Plan Hardening Prompt in the runbook).

**CLARIFICATION CHECK**: Before hardening, scan the plan for `[NEEDS CLARIFICATION]` markers.
If any exist, list them all and wait for the user to resolve them before proceeding.

Harden <YOUR-PLAN>.md by adding all 6 Mandatory Template Blocks from the runbook:
- Scope Contract (in-scope, out-of-scope, forbidden actions)
- Required Decisions (flag anything implicit as TBD)
- Execution Slices (30-120 min each, with Depends On + Context Files + Parallelism tag)
- Re-anchor Checkpoints
- Definition of Done (must include Reviewer Gate checkbox)
- Stop Conditions

For each Execution Slice:
- Tag as [parallel-safe] (with Parallel Group) or [sequential]
- Include relevant .github/instructions/*.instructions.md files in Context Files
- List only instruction files whose domain matches the slice (not all 15 — each consumes context budget)
- Add a Parallel Merge Checkpoint after each parallel group

Do NOT add features or expand scope. Only structure what already exists.

After hardening, run a TBD RESOLUTION SWEEP:
1. Scan Required Decisions for TBD entries.
2. Resolve using context from the plan, roadmap, and guardrails.
3. If a TBD requires human judgment, list it and ask the user.
4. Wait for all TBDs to be resolved before finalizing.

Also validate parallelism tags:
- Are [parallel-safe] slices truly independent (no shared files)?
- Are Parallel Merge Checkpoints present after each parallel group?

After all sections are drafted, run a **PLAN QUALITY SELF-CHECK** before outputting:

1. Does every Execution Slice have at least one validation gate with an exact command?
2. Does every [parallel-safe] slice avoid touching files shared by other slices in the same group?
3. Are all REQUIRED DECISIONS resolved (no TBD remaining)?
4. Does the Definition of Done include "Reviewer Gate passed (zero 🔴 Critical)"?
5. Do the Stop Conditions cover: build failure, test failure, scope violation, and security breach?
6. Does every slice list only the instruction files relevant to its domain (not all 15)?
7. Are MUST acceptance criteria from the spec traceable to at least one slice's validation gate?

If any check fails, revise the plan before outputting. Do not present a plan that fails its own quality check.

Finally, run a **SESSION BUDGET CHECK**:

- Count total slices
- If 8+ slices: recommend a session break point (e.g., "Plan for a session break after Slice N —
  commit progress, start a new session, resume from Slice N+1")
- If any single slice has 5+ Context Files: flag it and suggest trimming to the 3 most relevant

Output a TBD summary:
| # | Decision | Status | Resolution |
|---|----------|--------|------------|

If ALL TBDs resolved: "Plan hardened ✅ — proceed to Step 3 (Execute Slices)"
If ANY need input: list them and WAIT.

---

## Persistent Memory (if OpenBrain is configured)

- **Before hardening**: `search_thoughts("<phase topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode")` — load prior decisions, patterns, and post-mortem lessons that inform scope and slicing
- **During TBD resolution**: `search_thoughts("<ambiguous topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — check if prior decisions already resolve the ambiguity
- **After hardening**: `capture_thought("Plan hardened: <phase name> — N slices, key decisions: ...", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-2-hardening", type: "decision")` — persist hardening decisions for the execution session
