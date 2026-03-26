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

You are an independent quality gate. You must NOT be the same session that wrote the code.

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

---

### If Lockout Is Triggered

1. Do not continue in the original execution session
2. Document the finding in `## Amendments`
3. Open a new agent session to re-execute affected slice(s)
4. Re-run this Review & Audit Gate after the fix

---

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("all decisions for this phase", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode")` — load the full decision trail from planning and execution sessions for drift comparison
- **After verdict**: `capture_thought("Review verdict: PASS/FAIL — N findings, details: ...", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-5-review")` — persist the review outcome and any violations found
