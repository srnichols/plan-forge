---
description: "Pipeline Step 5 — Independent review gate and drift detection. Run in a fresh agent session (read-only audit)."
---

# Step 5: Review & Audit Gate

> **Pipeline**: Step 5 of 5 (Session 3 — Review & Audit)  
> **When**: After completeness sweep passes (Step 4), in a fresh agent session  
> **Verdict**: PASS (ship it) or FAIL (lockout — fix and re-review)

Replace `<YOUR-HARDENED-PLAN>` with your hardened plan filename.

---

Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Section 6.2 + Drift Detection Prompt)
2. docs/plans/<YOUR-HARDENED-PLAN>.md
3. .github/copilot-instructions.md
4. .github/instructions/ (relevant guardrail files for this phase)
5. docs/plans/DEPLOYMENT-ROADMAP.md

Now act as a REVIEWER GATE + DRIFT DETECTION AGENT.

You are an independent quality gate. You should be a different session from the one that wrote the code.

--- PART A: CODE REVIEW ---

Review checklist:
1. SCOPE COMPLIANCE — All changes within the Scope Contract?
2. FORBIDDEN ACTIONS — Off-limits files/folders touched?
3. ARCHITECTURE — Code follows layer separation?
4. ERROR HANDLING — Proper error types, no empty catch blocks?
5. NAMING — Follows project naming conventions?
6. PATTERNS — Follows existing patterns from .github/instructions/?
7. TESTING — New features covered by tests?
8. SECURITY — Input validation? No secrets in code?

For each finding, assign: 🔴 Critical / 🟡 Warning / 🔵 Info

Output Part A:
| # | File | Finding | Severity | Rule Violated |
|---|------|---------|----------|---------------|

--- PART B: DRIFT DETECTION ---

Compare Scope Contract against actual changes:
1. SCOPE CREEP — Work not in Scope Contract?
2. UNPLANNED FILES — Files not in any Execution Slice?
3. NON-GOAL VIOLATIONS — Work contradicting Out of Scope?
4. FORBIDDEN ACTIONS — Off-limits touched?
5. ARCHITECTURAL DRIFT — Patterns conflicting with instructions?

Output Part B:
| File | Issue | Violated Section |
|------|-------|------------------|

--- COMBINED SUMMARY ---

- Code Review: Critical: N | Warnings: N | Info: N
- Drift Detection: Drift found: Yes/No (N issues)
- Verdict: PASS or FAIL (LOCKOUT)

Do NOT modify any files. Report only.

If the verdict is **PASS** and the phase is Small or Medium (≤5 slices), you may proceed
to Step 6 (Ship) in this same session — Session 4 is optional for smaller features.
For Large phases (6+ slices), a separate Session 4 is recommended to avoid context exhaustion.

---

### If Lockout Is Triggered

1. Do not continue in the original execution session
2. Document the finding in `## Amendments`
3. Open a new agent session to re-execute affected slice(s)
4. Re-run this Review & Audit Gate after the fix

### Targeted Re-Review (after LOCKOUT fix)

If you are re-reviewing after a LOCKOUT fix, the user may specify which slices were re-executed.
In that case, focus the review on:

1. The re-executed slices and their changed files (primary audit)
2. Integration points between the fixed slices and adjacent slices (regression check)
3. The specific 🔴 Critical finding(s) that triggered the original LOCKOUT (confirm resolved)

You may skip full review of slices that were not re-executed, unless the fix introduced
cross-cutting changes (e.g., shared interfaces, database schema). If in doubt, do a full review.

---

## MCP Tools (if Plan Forge MCP server is running)

- **Scope drift check**: call `forge_diff` with the plan file — structured drift detection against the Scope Contract
- **Completeness verification**: call `forge_sweep` to verify zero deferred-work markers remain
- **Setup health**: call `forge_validate` to confirm all guardrail files are intact

> Use MCP tools for structured results when available. Fall back to manual `git diff` + grep if MCP is not configured.

---

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("all decisions for this phase", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — load the full decision trail from planning and execution sessions for drift comparison
- **After verdict**: `capture_thought("Review verdict: PASS/FAIL — N findings, details: ...", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-5-review", type: "postmortem")` — persist the review outcome and any violations found
