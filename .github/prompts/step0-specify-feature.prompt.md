---
description: "Pipeline Step 0 — Specify what you want to build and why, before any technical planning. Surfaces ambiguities early with [NEEDS CLARIFICATION] markers."
---

# Step 0: Specify Feature

> **Pipeline**: Step 0 (optional, recommended) — Run before Steps 1–5  
> **When**: You have a rough idea for a feature but haven't written a plan yet  
> **Next Step**: Write a `*-PLAN.md`, then `step1-preflight-check.prompt.md`  
> **Output**: A specification section to include as front matter in your Phase Plan

Replace `<FEATURE-NAME>` with a short name for the feature you're building.

---

Act as a SPECIFICATION AGENT helping me define **<FEATURE-NAME>** before any technical planning begins.

Your job is to help me describe WHAT I want to build and WHY — not HOW to build it. Ask me structured questions to surface requirements I may not have thought about. For anything I'm unsure of, tag it with `[NEEDS CLARIFICATION: description]` — these markers MUST be resolved before the plan can be hardened (Step 2 will block on them).

---

### FIRST: Do you have an existing document?

Before starting the interview, ask:

> "Do you have an existing document, spec, PRD, or notes you'd like to use as a starting point? (file path, URL, or 'no')"

**If the user provides a file or location:**

1. Read the file and scan its contents
2. Map its content against the 6 sections below (Problem Statement, User Scenarios, Acceptance Criteria, Edge Cases, Out of Scope, Open Questions)
3. For each section, classify: **Covered**, **Partial**, or **Missing**
4. Show a coverage summary:

   | # | Section | Coverage | Extracted Summary |
   |---|---------|----------|-------------------|
   | 1 | Problem Statement | ✅ / ⚠️ / ❌ | ... |
   | 2 | User Scenarios | ... | ... |
   | 3 | Acceptance Criteria | ... | ... |
   | 4 | Edge Cases | ... | ... |
   | 5 | Out of Scope | ... | ... |
   | 6 | Open Questions | ... | ... |

5. **Only ask about sections marked Partial or Missing.** Do not re-ask what the document already answers.
6. For Partial sections, show what you extracted and ask the user to confirm or expand.

**Check the file's naming and location:**
- If already at `docs/plans/Phase-N-*-PLAN.md` → use it in place, add/adjust sections to meet the spec standard
- If elsewhere or different naming → extract into a new `docs/plans/Phase-N-<NAME>-PLAN.md`

**If the user says "no":** Proceed to the full interview below.

---

Walk me through each section below. After I answer, compile the results into a single specification block I can paste into my Phase Plan.

---

### 1. PROBLEM STATEMENT

- What problem does this feature solve?
- Who has this problem? (end users, internal team, API consumers, etc.)
- What happens today without this feature? (current workaround or pain point)

### 2. USER SCENARIOS

Describe 2–3 concrete scenarios of someone using this feature, step by step:
- What triggers them to use it?
- What do they see / click / input?
- What's the expected result?
- What does success look like from the user's perspective?

If you can't describe a scenario clearly, write:
`[NEEDS CLARIFICATION: describe the user flow for <scenario>]`

### 3. ACCEPTANCE CRITERIA

How will we know this feature is done? List measurable, testable criteria:
- "Users can ___"
- "The system responds with ___"
- "Performance: ___ within ___ ms"
- "Error case: when ___, the system ___"

If you're not sure what done looks like, write:
`[NEEDS CLARIFICATION: define acceptance criteria for <aspect>]`

### 4. EDGE CASES & ERROR STATES

What could go wrong?
- What if the user provides invalid input?
- What if a downstream service is unavailable?
- What if the database is down or returns no results?
- What if the user doesn't have permission?
- What happens under concurrent access?

For each edge case, describe the expected behavior.

### 5. OUT OF SCOPE

What does this feature explicitly NOT do? Be specific:
- "Does NOT include admin UI for ___"
- "Does NOT support ___ in this phase (deferred to Phase N)"
- "Does NOT change existing ___ behavior"

This list becomes the **forbidden actions** in the hardened plan.

### 6. OPEN QUESTIONS

List anything you're unsure about. Each becomes a `[NEEDS CLARIFICATION]` marker:
- Technical unknowns ("Do we need real-time updates or polling?")
- Business unknowns ("What's the approval workflow?")
- Dependency unknowns ("Which API version does the partner use?")

---

After collecting my answers, compile them into this format:

```markdown
## Feature Specification: <FEATURE-NAME>

### Problem Statement
(compiled from section 1)

### User Scenarios
(compiled from section 2)

### Acceptance Criteria
- [ ] (compiled from section 3)

### Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| (from section 4) | ... |

### Out of Scope
- (compiled from section 5)

### Open Questions
- [NEEDS CLARIFICATION: ...] (from section 6, if any)
```

If there are ZERO `[NEEDS CLARIFICATION]` markers, say:
"Specification complete ✅ — ready to write a Phase Plan and proceed to Step 1."

If there ARE markers, say:
"Specification has N open questions ⚠️ — resolve all [NEEDS CLARIFICATION] items before proceeding to Step 1."
