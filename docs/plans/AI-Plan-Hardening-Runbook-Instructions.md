---
description: AI Plan Hardening Runbook usage instructions - Step-by-step workflow for hardening, executing, and auditing phase plans with copy-paste prompts
applyTo: 'docs/plans/**'
priority: HIGH
---

# AI Plan Hardening Runbook — Usage Instructions

> **Purpose**: Quick-reference guide for using the [AI-Plan-Hardening-Runbook.md](./AI-Plan-Hardening-Runbook.md) to harden and execute phase plans  
> **When to use**: Every time you have a new or updated `*-PLAN.md` to prepare for agent execution  
> **Version**: 2.0 (Multi-Stack)

---

## Workflow Overview

The pipeline has **6 steps** (Step 0–5) using **3 separate agent sessions**. Each session is isolated to prevent context bleed.

```
┌───────────────────────────────────────────────────────────────────┐
│  STEP 0 — Specify (optional, recommended)                         │
│  Define WHAT and WHY before any technical planning                 │
├───────────────────────────────────────────────────────────────────┤
│  SESSION 1 — Plan Hardening                                       │
│  Step 1: Pre-flight checks (agent — automated)                    │
│  Step 2: Harden the plan + resolve TBDs (agent)                   │
├───────────────────────────────────────────────────────────────────┤
│  SESSION 2 — Execution                                            │
│  Step 3: Execute slices (agent, slice-by-slice)                   │
│  Step 4: Completeness sweep (same or new session)                 │
├───────────────────────────────────────────────────────────────────┤
│  SESSION 3 — Review & Audit                                       │
│  Step 5: Independent review + drift detection (fresh agent, R/O)  │
└───────────────────────────────────────────────────────────────────┘
```

> **Why separate sessions?** The executor shouldn't self-audit. Fresh context eliminates blind spots.
>
> **Pipeline prompts**: Each step is also available as a prompt template in `.github/prompts/step<N>-*.prompt.md` — browse the file picker for a self-documenting workflow.

---

## When to Use This Pipeline

| Change Size | Examples | Recommendation |
|-------------|----------|----------------|
| **Micro** (<30 min) | Bug fix, config tweak, copy change | **Skip** — direct commit |
| **Small** (30–120 min) | Single-file feature, simple migration | **Optional** — Scope Contract + Definition of Done only |
| **Medium** (2–8 hrs) | Multi-file feature, new API endpoint | **Full pipeline** — all 5 steps |
| **Large** (1+ days) | New module, schema redesign, cross-cutting | **Full pipeline + branch-per-slice** |

---

## Step 0: Specify Feature (Optional)

Before writing a plan, use this step to define *what* you're building and *why*. This is especially valuable for teams that are new to structured planning or when requirements are unclear.

> **Prompt template**: `.github/prompts/step0-specify-feature.prompt.md`

Open a new agent session and use the Step 0 prompt template. It walks you through:

1. **Problem Statement** — What problem does this solve? Who has it?
2. **User Scenarios** — Concrete step-by-step usage examples
3. **Acceptance Criteria** — Measurable "done" criteria
4. **Edge Cases** — What could go wrong?
5. **Out of Scope** — What this feature does NOT do
6. **Open Questions** — Unknowns tagged with `[NEEDS CLARIFICATION]`

The output is a specification block you paste into your Phase Plan as front matter.

### `[NEEDS CLARIFICATION]` Markers

Any uncertainty in the spec gets tagged:
```
[NEEDS CLARIFICATION: describe what's unclear]
```

These markers are **blocking** — Step 2 (Harden the Plan) will refuse to proceed if any remain unresolved. This prevents ambiguity from leaking into execution.

> **Skip this step** if you already have clear, well-defined requirements.

---

## Step 1: Pre-flight Checks

Open a **new agent session** (Copilot Chat → Agent Mode).

> **Prompt template**: `.github/prompts/step1-preflight-check.prompt.md`

Replace `<YOUR-PLAN>` with your plan filename, then copy the entire block.

### Pre-flight Prompt (Copy-Paste)

```text
Act as a PRE-FLIGHT CHECK AGENT for plan hardening.

Run these checks and report results. STOP if any check fails.

1. GIT STATE — Run `git pull origin main` and `git status`.
   Report: clean / dirty (list uncommitted files if dirty).

2. ROADMAP LINK — Read docs/plans/DEPLOYMENT-ROADMAP.md.
   Confirm the phase for <YOUR-PLAN> exists with a one-line goal.
   Report: ✅ found (quote the goal) / ❌ missing.

3. PLAN FILE — Confirm docs/plans/<YOUR-PLAN>.md exists and is non-empty.
   Report: ✅ exists (N lines) / ❌ not found.

4. CORE GUARDRAILS — Confirm these files exist and are non-empty:
   - .github/copilot-instructions.md
   - .github/instructions/architecture-principles.instructions.md
   - AGENTS.md
   Report: ✅ all present / ❌ missing (list which).

4b. AGENTIC FILES — Check if prompt templates, agent definitions, and skills exist:
   - .github/prompts/ — list *.prompt.md files found (0 is OK for non-preset repos)
   - .github/agents/ — list *.agent.md files found
   - .github/skills/ — list */SKILL.md files found
   Report: ✅ N prompts, N agents, N skills found / ⚠️ none found (optional — won't block)

5. DOMAIN GUARDRAILS — Scan <YOUR-PLAN>.md for keywords to identify relevant domains.
   For each domain detected, confirm the matching guardrail file exists:
   - UI/Component/Frontend/Razor/React/Vue → .github/instructions/frontend.instructions.md (or blazor/react specific)
   - Database/SQL/Repository/ORM/migration → .github/instructions/database.instructions.md
   - API/Route/Controller/REST → .github/instructions/api-patterns.instructions.md
   - Auth/OAuth/JWT/OIDC/session → .github/instructions/auth.instructions.md
   - GraphQL/Schema/Resolver → .github/instructions/graphql.instructions.md
   - Security/CORS/Secrets/Validation → .github/instructions/security.instructions.md
   - Docker/K8s/deploy/CI → .github/instructions/deploy.instructions.md
   - Test/spec/coverage → .github/instructions/testing.instructions.md
   Report: domains detected + guardrail status for each.

6. PROJECT PRINCIPLES — Check if docs/plans/PROJECT-PRINCIPLES.md exists.
   If exists: read it and confirm plan doesn't violate any Core Principle.
   Report: ✅ Project Principles found (N principles) / ⚠️ no Project Principles file (optional)

7. BRANCH CHECK — Does the plan declare a Branch Strategy?
   If yes: confirm current branch matches the plan's declared branch.
   If no: recommend a strategy based on estimated effort.
   Report: ✅ on correct branch / ❌ wrong branch / ⚠️ no strategy declared

Output a summary table:

| Check | Result | Details |
|-------|--------|---------|
| Git state | ✅/❌ | ... |
| Roadmap link | ✅/❌ | ... |
| Plan file | ✅/❌ | ... |
| Core guardrails | ✅/❌ | ... |
| Agentic files | ✅/⚠️ | ... |
| Domain guardrails | ✅/❌ | ... |
| Project Principles | ✅/⚠️ | ... |
| Branch check | ✅/⚠️/❌ | ... |

If ALL pass: "Pre-flight complete ✅ — proceed to Step 2 (Harden the Plan)"
If ANY fail: "Pre-flight FAILED ❌" + list exactly what to fix.
```

---

## Step 2: Harden the Plan

Open a **new agent session**. Replace `<YOUR-PLAN>` with your plan filename.

> **Prompt template**: `.github/prompts/step2-harden-plan.prompt.md`

### Hardening Prompt (Copy-Paste)

```text
Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md
2. docs/plans/<YOUR-PLAN>.md
3. docs/plans/DEPLOYMENT-ROADMAP.md
4. .github/copilot-instructions.md
5. docs/plans/PROJECT-PRINCIPLES.md (if exists)

Now act as a PLAN HARDENING AGENT (see the Plan Hardening Prompt in the runbook).

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
- Add a Parallel Merge Checkpoint after each parallel group

Do NOT add features or expand scope. Only structure what already exists.

If a Specification Source is referenced in the Scope Contract, ensure each
slice includes a "Traces to" field mapping to requirements in that spec.

If Project Principles exist, validate that no execution slice violates a
Core Principle or introduces a Forbidden Pattern. Flag violations as
REQUIRED DECISIONS that must be resolved before execution.

If a Requirements Register is present, ensure each Execution Slice includes
a "Traces to" field (e.g., "Traces to: REQ-001, REQ-003"). Flag any
requirement with no corresponding slice as a gap.

After hardening, run a TBD RESOLUTION SWEEP:
1. Scan Required Decisions for TBD entries.
2. Resolve using context from the plan, roadmap, and guardrails.
3. If a TBD requires human judgment, list it and ASK.
4. Do NOT proceed while any TBD remains unresolved.

Also validate parallelism tags:
- Are [parallel-safe] slices truly independent (no shared files)?
- Are Parallel Merge Checkpoints present after each parallel group?

Output a TBD summary:
| # | Decision | Status | Resolution |
|---|----------|--------|------------|

If ALL TBDs resolved: "Plan hardened ✅ — proceed to Step 3 (Execute Slices)"
If ANY need input: list them and WAIT.
```

---

## Step 3: Execute Slice-by-Slice

Open a **new agent session** (separate from hardening).

> **Prompt template**: `.github/prompts/step3-execute-slice.prompt.md`

### Execution Prompt (Copy-Paste)

```text
Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Execution Agent Prompt + Sections 10-11)
2. docs/plans/<YOUR-HARDENED-PLAN>.md
3. .github/copilot-instructions.md

Now act as an EXECUTION AGENT (see the Execution Agent Prompt in the runbook).

Execute the hardened plan one slice at a time, starting with Slice 1.
Before each slice, load its Context Files (including .github/instructions/*.instructions.md guardrails).
When scaffolding new entities/services/tests, use the matching prompt template from .github/prompts/.
Follow the validation loop exactly. Commit after each passed slice.
STOP if any gate fails or any ambiguity arises.

For [parallel-safe] slices:
- Note which Parallel Group they belong to
- After all slices in a group complete, run the Parallel Merge Checkpoint
- If any parallel slice fails, HALT all slices in that group

After ALL slices pass, run the COMPLETENESS SWEEP (Section 6.1).
```

### If a Gate Fails

Follow the **Rollback Protocol** (Runbook Section 10):

| Strategy | When to Use |
|----------|-------------|
| `git stash` | Quick save — preserves work for review |
| `git checkout -- .` | Discard changes for single slice |
| Branch-per-slice | Safest — recommended for high-risk phases |

### If the Agent Hits Context Limits

1. Commit completed work
2. Open new session with same Execution Prompt
3. Tell it: "Slices 1–N are complete. Resume from Slice N+1."

---

## Step 4: Completeness Sweep

After all slices pass, before the Reviewer Gate.

> **Prompt template**: `.github/prompts/step4-completeness-sweep.prompt.md`

### Completeness Sweep Prompt (Copy-Paste)

```text
Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Section 6.1)
2. docs/plans/<YOUR-HARDENED-PLAN>.md (Definition of Done)
3. .github/copilot-instructions.md

Now act as a COMPLETENESS SWEEP AGENT (see Section 6.1 of the runbook).

Scan ALL files created or modified during this phase for:
- TODO, HACK, FIXME comments
- Mock/placeholder/stub data (hardcoded records, fake values)
- "will be replaced" / "Simulate" / "Seed with sample" comments
- Stub implementations (methods that return defaults / do nothing)
- Commented-out code with future intent

For each finding:
1. Wire it to the real service/API/method
2. Remove the deferred-work comment
3. Verify build + tests pass after each batch

Output:
1) Findings count (before → after)
2) Files modified
3) New methods/types added
4) Build: pass/fail
5) Tests: pass/fail

If ANY finding cannot be resolved without scope expansion: STOP and report.
```

---

## Step 5: Review & Audit Gate

Open a **fresh agent session** (not the execution session).

> **Prompt template**: `.github/prompts/step5-review-gate.prompt.md`

### Review & Audit Prompt (Copy-Paste)

```text
Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Section 6.2 + Drift Detection Prompt)
2. docs/plans/<YOUR-HARDENED-PLAN>.md
3. .github/copilot-instructions.md
4. .github/instructions/ (relevant guardrail files for this phase)
5. docs/plans/DEPLOYMENT-ROADMAP.md
6. docs/plans/PROJECT-PRINCIPLES.md (if exists)

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
9. PROJECT PRINCIPLES — Core Principles respected? Forbidden Patterns absent? (if Project Principles file exists)

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

--- PART C: TRACEABILITY CHECK (if Specification Source exists) ---

If the plan references an external specification or Requirements Register:
1. Verify every requirement in the spec has at least one slice that addresses it
2. Verify no slice implements functionality NOT in the spec
3. Flag any spec requirements with no corresponding validation gate

Output Part C:
| Requirement | Traced to Slice(s) | Status |
|-------------|-------------------|--------|

If no specification is referenced, skip Part C entirely.

For Part C: Use the Requirements Register (if present) OR the external
Specification Source (if referenced) as the source of truth.

--- COMBINED SUMMARY ---

- Code Review: Critical: N | Warnings: N | Info: N
- Drift Detection: Drift found: Yes/No (N issues)
- Verdict: PASS or FAIL (LOCKOUT)

Do NOT modify any files. Report only.
```

### If Lockout Is Triggered

1. Do not continue in the original execution session
2. Document the finding in `## Amendments`
3. Open a new agent session to re-execute affected slice(s)
4. Re-run Review & Audit Gate after the fix

---

## Post-Execution Checklist

- [ ] All Definition of Done criteria satisfied
- [ ] Completeness Sweep passed (zero TODO/mock/stub artifacts)
- [ ] Review & Audit Gate passed (zero 🔴 Critical, no drift)
- [ ] Post-Mortem template completed
- [ ] Guardrail files updated with new patterns
- [ ] `DEPLOYMENT-ROADMAP.md` status updated to ✅ Complete
- [ ] Committed and pushed

---

## Quick Reference: Which Prompt When?

| Situation | Step | Prompt | Template |
|-----------|------|--------|----------|
| Define what to build | Step 0 | Specify Prompt | `step0-specify-feature.prompt.md` |
| Verify prerequisites | Step 1 | Pre-flight Prompt | `step1-preflight-check.prompt.md` |
| Structure a new plan | Step 2 | Hardening Prompt | `step2-harden-plan.prompt.md` |
| Plan is hardened, ready to build | Step 3 | Execution Prompt | `step3-execute-slice.prompt.md` |
| All slices done, clean up | Step 4 | Completeness Sweep | `step4-completeness-sweep.prompt.md` |
| Independent quality audit | Step 5 | Review & Audit Prompt | `step5-review-gate.prompt.md` |
| Gate failed mid-execution | — | Rollback Protocol (Section 10) | — |
| Scope changed mid-execution | — | Amendment Protocol (Section 11) | — |

---

## Related Files

| File | Purpose |
|------|---------|
| [AI-Plan-Hardening-Runbook.md](./AI-Plan-Hardening-Runbook.md) | Full runbook with templates and prompts |
| [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) | Master tracker |
| `.github/copilot-instructions.md` | Project-wide coding standards |
| `.github/instructions/*.instructions.md` | Domain-specific guardrail files |
| `AGENTS.md` | Background worker and agent patterns |

---

## Alternative: Using Pipeline Agents

Instead of copy-pasting prompts for each session, you can use the **pipeline agents** — pre-built `.agent.md` files that chain the 3-session workflow with clickable handoff buttons.

### Pipeline Agent Chain

```
Plan Hardener → Executor → Reviewer Gate
     │                │              │
     │  "Start        │  "Run        │  (terminal —
     │  Execution →"  │  Review      │   no handoff)
     │                │  Gate →"     │
```

### How to Use

1. **Open a chat** with the `Plan Hardener` agent (`.github/agents/plan-hardener.agent.md`)
2. **Provide your plan**: "Harden `docs/plans/Phase-YOUR-FEATURE-PLAN.md`"
3. The agent runs pre-flight checks, adds the 6 mandatory template blocks, and resolves TBDs
4. When done, click **"Start Execution →"** to hand off to the Executor agent
5. The **Executor** runs slices one-by-one with validation gates, then runs the completeness sweep
6. When done, click **"Run Review Gate →"** to hand off to the Reviewer Gate agent
7. The **Reviewer Gate** audits all changes read-only and reports a PASS/FAIL verdict

### Pipeline Agents vs Copy-Paste Prompts

| Aspect | Pipeline Agents | Copy-Paste Prompts |
|--------|----------------|-------------------|
| Session transitions | Clickable handoff buttons | Manual copy-paste into new session |
| Context carry-over | Automatic via handoff prompt | Manual (reference plan file) |
| Customization | Edit the `.agent.md` files | Edit the prompt text |
| Functionality | Identical | Identical |

> **Both approaches produce the same result.** Pipeline agents just make session transitions smoother. Use whichever you prefer.
