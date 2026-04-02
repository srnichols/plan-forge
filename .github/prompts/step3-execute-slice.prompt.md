---
description: "Pipeline Step 3 — Execute a hardened plan slice-by-slice with validation gates, re-anchoring, and rollback protocol."
---

# Step 3: Execute Slices

> **Pipeline**: Step 3 of 5 (Session 2 — Execution)  
> **When**: After plan is hardened (Step 2), in a new agent session  
> **Next Step**: `step4-completeness-sweep.prompt.md`

Replace `<YOUR-HARDENED-PLAN>` with your hardened plan filename.

---

Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Execution Agent Prompt + Sections 10-11)
2. docs/plans/<YOUR-HARDENED-PLAN>.md
3. .github/copilot-instructions.md

Now act as an EXECUTION AGENT (see the Execution Agent Prompt in the runbook).

<investigate_before_coding>
Before writing code that depends on an existing file, read that file first. Never
assume a method signature, type name, or import path — verify it by opening the file.
If the plan references a file you haven't loaded, load it before coding against it.
</investigate_before_coding>

<implementation_discipline>
Only make changes specified in the current slice. Do not add features, refactor
existing code, add abstractions, or create helpers beyond what the slice requires.
Do not add error handling for scenarios that cannot occur within this slice's scope.
Do not add docstrings, comments, or type annotations to code you did not change.
The right amount of complexity is the minimum needed for the current slice.
</implementation_discipline>

Execute the hardened plan one slice at a time, starting with Slice 1.
Before each slice, load its Context Files (including .github/instructions/*.instructions.md guardrails).
When scaffolding new entities/services/tests, use the matching prompt template from .github/prompts/.
Follow the validation loop exactly. Commit after each passed slice.
If any gate fails or any ambiguity arises, pause and ask for clarification.

For [parallel-safe] slices:
- Note which Parallel Group they belong to
- After all slices in a group complete, run the Parallel Merge Checkpoint
- If any parallel slice fails, pause all slices in that group and report

After ALL slices pass, run the COMPLETENESS SWEEP (Section 6.1).

---

### If a Gate Fails

Follow the Rollback Protocol (Runbook Section 10):

| Strategy | When to Use |
|----------|-------------|
| `git stash` | Quick save — preserves work for review |
| `git checkout -- .` | Discard changes for single slice |
| Branch-per-slice | Safest — recommended for high-risk phases |

### If the Agent Hits Context Limits

1. Commit completed work
2. Open new session with this same prompt
3. Tell it: "Slices 1–N are complete. Resume from Slice N+1."

---

## Persistent Memory (if OpenBrain is configured)

- **Before each slice**: `search_thoughts("<slice topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode")` — load prior decisions and patterns relevant to the current slice
- **After each slice**: `capture_thought("Slice N: <key decision or outcome>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-3-slice-N")` — persist decisions made during execution
- **After completeness sweep**: `capture_thoughts([...lessons], project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-4-sweep")` — batch capture patterns, conventions, and lessons discovered
