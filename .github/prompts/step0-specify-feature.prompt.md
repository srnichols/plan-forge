---
description: "Pipeline Step 0 — Specify what you want to build and why, before any technical planning. Surfaces ambiguities early with [NEEDS CLARIFICATION] markers."
---

# Step 0: Specify Feature

> **Pipeline**: Step 0 (optional, recommended) — Run before Steps 1–5  
> **Model suggestion**: Claude (best at conversational interviews and ambiguity detection)  
> **When**: You have a rough idea for a feature but haven't written a plan yet  
> **Next Step**: Write a `*-PLAN.md`, then `step1-preflight-check.prompt.md`  
> **Output**: A specification section to include as front matter in your Phase Plan

Replace `<FEATURE-NAME>` with a short name for the feature you're building.

---

Act as a SPECIFICATION AGENT helping me define **<FEATURE-NAME>** before any technical planning begins.

Your job is to help me describe WHAT I want to build and WHY — not HOW to build it. Ask me structured questions to surface requirements I may not have thought about. For anything I'm unsure of, tag it with `[NEEDS CLARIFICATION: description]` — these markers MUST be resolved before the plan can be hardened (Step 2 will block on them).

---

### FIRST: Check for Spec Kit Artifacts

Before asking any questions, scan the project for Spec Kit artifacts:

1. Check if `specs/` directory exists (Spec Kit feature directory)
2. Check if `memory/constitution.md` exists (Spec Kit project constitution)
3. Check if any `specs/*/spec.md` or `specs/*/plan.md` files exist

**If Spec Kit artifacts are found:**

> "I found Spec Kit artifacts in this project:
> - `specs/<feature>/spec.md` — feature specification
> - `specs/<feature>/plan.md` — implementation plan
> - `memory/constitution.md` — project constitution
>
> Plan Forge can import these directly:
> 1. **Import spec** → Skip the interview, map spec.md sections to Plan Forge format
> 2. **Import plan** → Convert plan.md into a hardened execution contract (Phase Plan)
> 3. **Import constitution** → Convert to `docs/plans/PROJECT-PRINCIPLES.md`
> 4. **Start fresh** → Ignore Spec Kit files and run the full interview
>
> Which would you like?"

**If the user chooses to import:**

1. Read the Spec Kit `spec.md` and map its content to the 6 sections below
2. Read `plan.md` (if it exists) and extract technology choices, architecture decisions, and task breakdown
3. Read `constitution.md` (if it exists) and map principles to Plan Forge's `PROJECT-PRINCIPLES.md` format
4. Show a coverage summary and fill in any gaps with targeted questions
5. Generate the Plan Forge Phase Plan with a `### Specification Source` section:
   ```markdown
   ### Specification Source
   - Imported from: Spec Kit (`specs/<feature>/spec.md`)
   - Plan source: `specs/<feature>/plan.md`
   - Constitution: `memory/constitution.md`
   ```

**If no Spec Kit artifacts found** — continue to the document check below.

---

### NEXT: Do you have an existing document?

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

How will we know this feature is done? Express criteria as testable statements using this format:

- **MUST** (non-negotiable — becomes a validation gate):
  `"GET /health MUST return 200 OK with JSON body {status: 'healthy'} within 50ms"`
- **SHOULD** (expected behavior — becomes a test case):
  `"The notification bell SHOULD update the unread count within 2 seconds of a new event"`
- **MAY** (optional enhancement — becomes future scope if not completed):
  `"The dashboard MAY support dark mode toggle"`

Each MUST criterion should be specific enough to verify with a command or test.
Avoid vague criteria like "should be fast" or "must work well."

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
- [ ] MUST: (compiled from section 3 — non-negotiable, testable)
- [ ] SHOULD: (compiled from section 3 — expected behavior)
- [ ] MAY: (compiled from section 3 — optional enhancements)

### Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| (from section 4) | ... |

### Out of Scope
- (compiled from section 5)

### Open Questions
- [NEEDS CLARIFICATION: ...] (from section 6, if any)

### Complexity Estimate
- Estimated effort: Micro / Small / Medium / Large
- Estimated files: N
- Recommended pipeline: Skip / Light hardening / Full pipeline / Full + branch-per-slice
```

Additionally, output a **machine-readable summary** wrapped in XML tags so downstream
pipeline steps (Harden, Execute, Review) can extract sections unambiguously:

```xml
<specification feature="<FEATURE-NAME>">
  <problem_statement>(one-paragraph summary)</problem_statement>
  <acceptance_criteria>
    <criterion id="AC-1" priority="MUST">(testable statement)</criterion>
    <criterion id="AC-2" priority="SHOULD">(testable statement)</criterion>
  </acceptance_criteria>
  <out_of_scope>
    <item>(each out-of-scope item)</item>
  </out_of_scope>
  <open_questions>
    <question status="resolved|open">(each question)</question>
  </open_questions>
  <complexity effort="Micro|Small|Medium|Large" files="N" pipeline="Skip|Light|Full|Full+branch"/>
</specification>
```

Place this XML block at the end of the specification, after the Markdown format. It is consumed
by Step 2 (Harden) to auto-generate validation gates from MUST criteria. If you prefer Markdown
only, the XML block can be omitted — the pipeline works with either format.

**Complexity classification** (include in the output):
- **Micro** (<30 min, 1 file): Direct commit — skip the pipeline
- **Small** (30–120 min, 1–3 files): Optional — Scope Contract + Definition of Done only
- **Medium** (2–8 hrs, 4–10 files): Full pipeline — all steps
- **Large** (1+ days, 10+ files): Full pipeline + branch-per-slice

---

<examples>
<example index="1" label="Strong specification">
## Feature Specification: health-endpoint

### Problem Statement
Load balancers and monitoring tools need a way to verify the service is running.
Today, they probe the root URL which returns HTML — unreliable for automated health checks.

### User Scenarios
1. A load balancer sends GET /health every 30 seconds. It receives 200 OK with
   `{"status": "healthy"}`. If the service is down, it gets a connection refused.
2. An ops engineer opens /health in a browser to triage an alert. They see the
   JSON response immediately without authentication.

### Acceptance Criteria
- [ ] MUST: GET /health returns 200 with `{"status": "healthy"}` when the service is running
- [ ] MUST: Response time under 50ms (no database calls in the happy path)
- [ ] MUST: No authentication required on /health
- [ ] SHOULD: Return 503 with `{"status": "degraded", "reason": "database"}` when DB is unreachable
- [ ] MAY: Include service version in the response body

### Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| Database unreachable | Return 503 with degraded status |
| Unknown path hit | Normal 404 — health endpoint doesn't change routing |
| Concurrent requests | No shared state — each request is independent |

### Out of Scope
- No deep dependency checks (Redis, external APIs) — deferred to Phase N
- No custom health check UI dashboard
- No /metrics endpoint (separate phase)

### Open Questions
(none)

### Complexity Estimate
- Estimated effort: Small (~1 hour)
- Estimated files: 2–3
- Recommended pipeline: Light hardening only
</example>

<example index="2" label="Weak specification (avoid this)">
## Feature Specification: notifications

### Problem Statement
We need notifications.
<!-- ❌ Too vague — WHO needs them? What PROBLEM do they solve? What happens today? -->

### Acceptance Criteria
- [ ] Notifications should work
- [ ] Should be fast
<!-- ❌ Not testable — "work" and "fast" can't be verified with a command -->
<!-- Better: "MUST deliver WebSocket event within 2 seconds of creation" -->

### Out of Scope
(nothing listed)
<!-- ❌ Dangerous — without explicit boundaries, the agent will add email, SMS, push, etc. -->
</example>
</examples>

If there are ZERO `[NEEDS CLARIFICATION]` markers, say:
"Specification complete ✅ — ready to write a Phase Plan and proceed to Step 1."

Then, based on the complexity estimate, recommend the next action:

- **Micro**: "This is a micro change. Skip the pipeline — implement and commit directly."
- **Small**: "This is a small change. Consider light hardening: write a Scope Contract and
  Definition of Done, then implement. Full pipeline is optional."
- **Medium**: "This is a medium feature. Use the full pipeline — proceed to Step 1 (Pre-flight)
  then Step 2 (Harden) in this session."
- **Large**: "This is a large feature. Use the full pipeline with branch-per-slice. Proceed to
  Step 1 (Pre-flight), and plan for multiple execution sessions."

If there ARE markers, say:
"Specification has N open questions ⚠️ — resolve all [NEEDS CLARIFICATION] items before proceeding to Step 1."

---

## Persistent Memory (if OpenBrain is configured)

- **Before interviewing**: `search_thoughts("<feature topic>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "decision")` — check if this feature or similar has been specified before, load prior decisions and lessons
- **After specification is complete**: `capture_thought("Feature spec: <summary of what and why>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-0", type: "decision")` — persist the specification for downstream sessions
