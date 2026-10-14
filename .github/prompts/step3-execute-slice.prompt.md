---
description: "Pipeline Step 3 — Execute a hardened plan slice-by-slice with validation gates, re-anchoring, and rollback protocol."
---

# Step 3: Execute Slices

> **Pipeline**: Step 3 of 5 (Session 2 — Execution)
> **When**: After plan is hardened (Step 2), in a new agent session
> **Model suggestion**: Any model / Codex / Copilot Auto (10% token savings) — execution is mechanical; Codex is fast and focused
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

Before starting Slice 1, run a **Pre-Execution Traceability Check**:
- **Check OpenBrain** (if configured): `search_thoughts("<plan topic>", project: "<YOUR PROJECT NAME>")` — load prior gotchas, patterns, and lessons for the affected files/areas
- **Check LiveGuard memories**: Read `.forge/liveguard-memories.jsonl` if present — prior drift violations and incident history for this project
- Scan the spec's MUST acceptance criteria
- Verify each MUST criterion maps to at least one slice's validation gate
- If any MUST criterion has no corresponding validation gate, flag it and ask before proceeding

### Design-Context Handoff Check

For new or materially revised plans, before each affected slice or delegation:
1. Load its **Contract Refs**, **Decision Refs**, and **Language Ref** from their declared source locations, with exact revisions and approval evidence. Unchanged boundaries may cite existing approved sources; use `not applicable` with a reason for work without consequential boundary changes.
2. Compare the requested revisions with the plan's currently accepted records. Missing, stale, or agent-proposed consequential approval is a reason to pause and ask, not to guess or silently select the latest revision.
3. Carry those references into the worker's numbered tasks and handoff, alongside scope, invariants, and conformance gates. The worker must read the referenced sections before coding.
4. On return and on session resume, verify the result still conforms to the requested revisions and domain meanings. Record verification gaps explicitly.

If implementation reveals a changed decision, contract, or domain meaning, propose an amendment with affected decisions/contracts/slices and wait for owner approval before proceeding, even if the scope check passes. Reopen dependent decisions for review; do not silently rewrite accepted records.

These are agent-side checks, **not runtime enforcement**. A `crucibleId`, passed gate, or `lockHash` does not establish approval of a contract revision; runtime execution and lock-hash coverage are unchanged.

Before each slice, load its Context Files (including .github/instructions/*.instructions.md guardrails).
When scaffolding new entities/services/tests, use the matching prompt template from .github/prompts/.
Follow the validation loop exactly. Commit after each passed slice.
If any gate fails or any ambiguity arises, pause and ask for clarification.

Re-anchor after each slice using the lightweight check (4 yes/no questions).
Do a full re-anchor every 3rd slice or when a lightweight check flags a concern.

For [parallel-safe] slices:
- Note which Parallel Group they belong to
- After all slices in a group complete, run the Parallel Merge Checkpoint
- If any parallel slice fails, pause all slices in that group and report

After ALL slices pass, run the COMPLETENESS SWEEP (Section 6.1).

---

### Files Modified Verification (Issue #152)

Before declaring a slice complete — even if the validation gate passes — re-read
the slice's **Files Modified (Exhaustive)** table (when present). For each row,
confirm via `git diff --name-only HEAD` (or `git status --porcelain` for new
files) that the path appears in the slice's working-tree changes.

If any declared file is missing from the diff, **the slice is not finished**:
- Either complete the missing modification, OR
- Amend the plan to remove the row (with a brief rationale) before continuing.

Do not rely on the validation gate alone. Gates often only test what the worker
*chose* to add to the build (`dotnet test <slnx>`, `npm test`, etc.) — they do
not catch a silently-skipped registration like a missing `.csproj` reference,
an unedited README, or an unreleased CHANGELOG entry. The Exhaustive table is
the contract; the gate is one verification of it, not the only one.

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
3. Run the **Session Resume Checklist** before continuing:

```
SESSION RESUME CHECKLIST:
1. Run `git status` — confirm working tree is clean (all prior slices committed)
2. Run `git log --oneline -5` — verify last committed slice number
3. Read the hardened plan's Scope Contract and Stop Conditions
4. Confirm the plan file has not been amended since last session
   (check for ## Amendments section — if new amendments exist, read them first)
5. Identify the next unexecuted slice and load its Context Files
6. State: "Resuming from Slice N. Prior slices 1–(N-1) are committed."
7. Reconcile the next slice's Contract Refs, Decision Refs and Language Ref with their requested revisions and approval evidence; pause on stale consequential context.
```

---

## MCP Tools (if Plan Forge MCP server is running)

- **After each slice**: call `forge_sweep` to scan for TODO/FIXME markers before moving to the next slice
- **Before committing**: call `forge_diff` with the plan file to verify all changes are within scope
- **If build/test fails**: call `forge_smith` to check if the environment is healthy

> These tools are available as MCP function calls if `.vscode/mcp.json` or `.claude/mcp.json` is configured. Otherwise, use the equivalent CLI commands (`pforge sweep`, `pforge diff`, `pforge smith`).

---

## Persistent Memory (if OpenBrain is configured)

- **Before each slice**: `search_thoughts("<slice topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — load prior decisions, patterns, and implementation lessons relevant to the current slice
- **After each slice**: `capture_thought("Slice N: <key decision or outcome>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-3-slice-N", type: "decision")` — persist decisions made during execution
- **After completeness sweep**: `capture_thoughts([...lessons], project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-4-sweep", type: "convention")` — batch capture patterns, conventions, and lessons discovered

---

## Self-Repair Reporting

If you had to work around a Plan Forge defect to complete a slice (brittle gate, orchestrator bug, prompt issue), call `forge_meta_bug_file` before ending the slice. This files a meta-bug against Plan Forge itself so the problem is captured and not repeated.

See `.github/instructions/self-repair-reporting.instructions.md` for the three canonical defect classes, worked examples, and the full tool signature.
