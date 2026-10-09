---
description: "Pipeline Step 5 — Independent review gate and drift detection. Run in a fresh agent session (read-only audit)."
---

# Step 5: Review & Audit Gate

> **Pipeline**: Step 5 of 5 (Session 3 — Review & Audit)  
> **When**: After completeness sweep passes (Step 4), in a fresh agent session  
> **Model suggestion**: Claude or Gemini — best at independent critical analysis and drift detection  
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

**Pre-review context check:**
- **Check OpenBrain** (if configured): `search_thoughts("<plan topic> review", project: "<YOUR PROJECT NAME>")` — load prior review findings, recurring issues, and known patterns
- **Check LiveGuard memories**: Read `.forge/liveguard-memories.jsonl` if present — recent drift violations and incidents may flag known problem areas

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
9. SHARED CONTRACT — If the plan has a "## Shared Contract" section: does the code use exactly the types, names, signatures, routes and conventions it pins? Two slices defining the same thing differently is 🔴 Critical, even if each slice's own gate passed.
10. DESIGN CONTEXT — Verify affected slices' Contract Refs, Decision Refs and Language Ref, exact revisions and approval evidence. Flag missing or stale consequential approval; neither an agent proposal nor a provenance tag counts as acceptance.
11. DOMAIN LANGUAGE — Check the Domain Language meanings, bounded contexts, invariants and allowed aliases across specification, APIs, code and tests. Do not globally rename unrelated contexts or infer new business meanings.
12. DEEP MODULES — Deep modules hide coherent complexity behind a usable interface. Check what callers no longer need to know; preserve legitimate thin adapters, single responsibility and module-size gates. More files, wrappers, or lower LOC alone are not design improvement.

These are agent-side checks, **not runtime enforcement**. Current execution and lock-hash coverage are unchanged. For unchanged legacy boundaries, inspect existing approved sources rather than invent IDs or approvals.

Missing or stale approval for a consequential change is a **blocking verification gap**: withhold PASS until resolved, without inventing a technical defect to represent missing evidence.

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

### Design Concerns (read-only feedback)

Report genuinely observed design friction, not a quota. Reuse existing issue/smelt references or propose a follow-up for owner approval; do not create issues, plans, or refactors during this read-only review.

| Concern / evidence | Owner | Disposition | Issue / smelt or proposed follow-up | Revisit trigger | Closure validation |
|--------------------|-------|-------------|------------------------------------|-----------------|--------------------|
| (observed concern) | (owner or unassigned) | fix now / plan later / accept risk | (reference or proposal) | (specific change or event) | (behavioral or caller-simplicity proof) |

Current blockers still prevent PASS and cannot be reclassified as accepted debt. Owner-approved deferrals need a revisit trigger; closure requires relevant validation, not just fewer warnings. Keep future design work outside the current scope. Zero concerns is valid with review coverage stated.

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
