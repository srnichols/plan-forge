# AI Plan Hardening Runbook

> **Purpose**: A repeatable process for converting rough draft phase plans into hardened, drift-proof execution contracts that AI agents can follow without scope creep.  
> **When to use**: After drafting any `*-PLAN.md` for a roadmap phase — before handing it to an agent for execution.  
> **Applies to**: All `*-PLAN.md` files linked from your `DEPLOYMENT-ROADMAP.md`  
> **Version**: 2.0 (Multi-Stack)

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [Where This Runbook Fits](#where-this-runbook-fits)
3. [Inputs & Outputs](#inputs--outputs)
4. [The Hardening Process](#the-hardening-process)
   - [Step 0 — Pre-flight Checks](#step-0--pre-flight-checks)
   - [Step 1 — Draft the Phase Plan](#step-1--draft-the-phase-plan)
   - [Step 2 — Run the Plan Hardening Pass](#step-2--run-the-plan-hardening-pass)
   - [Step 3 — Slice into Bounded Execution Chunks](#step-3--slice-into-bounded-execution-chunks)
   - [Step 4 — Execute with the Validation Loop](#step-4--execute-with-the-validation-loop)
   - [Step 5 — Maintain Guardrails](#step-5--maintain-guardrails)
5. [Plan Hardening Prompt](#plan-hardening-prompt)
6. [Execution Agent Prompt](#execution-agent-prompt)
6.1. [Completeness Sweep Protocol](#completeness-sweep-protocol-section-61)
6.2. [Reviewer Gate Protocol](#reviewer-gate-protocol-section-62)
7. [Drift Detection Prompt](#drift-detection-prompt)
8. [Mandatory Template Blocks](#mandatory-template-blocks)
9. [Stop Conditions](#stop-conditions)
10. [Rollback Protocol](#rollback-protocol)
11. [Plan Amendment Protocol](#plan-amendment-protocol)
12. [File Naming & Linking Conventions](#file-naming--linking-conventions)
13. [Worked Examples](#worked-examples)

---

## The Big Picture

Every feature starts as a phase in the master roadmap and flows through a structured pipeline before any code is written. This runbook prevents the most common AI-agent failure mode: **scope drift** — where an agent silently expands, reorganizes, or reinterprets a plan mid-execution.

### Development Workflow

```
1. PLAN MODE (human + AI)
   Talk through what needs to be done; refine the idea collaboratively.

2. AGENT MODE — Generate Phase Plan
   Switch to agent mode and generate a detailed roadmap phase doc (*-PLAN.md).

3. AGENT PASS — Harden the Phase Plan  ← THIS RUNBOOK
   Run a second agent pass to harden the plan with scope contracts,
   checklists, and agent-ready execution steps.

4. AGENT EXECUTION — Top-Down Coding Guide
   Kick off an agent to execute tasks slice-by-slice as a verified coding guide.

5. GUARDRAIL MAINTENANCE
   Continuously update *.instructions.md and AGENTS.md as patterns emerge.
```

### The Hardened Flow

```
DEPLOYMENT-ROADMAP.md (master tracker — all phases)
  │
  └─► Phase N: *-PLAN.md (draft — rough intent and structure)
        │
        └─► PLAN HARDENING PASS (this runbook)
              │  Adds: scope contract, required decisions, forbidden actions
              │
              └─► EXECUTION SLICING
                    │  Breaks plan into 30-120 min bounded chunks
                    │  Each slice has its own validation gates
                    │
                    └─► EXECUTION LOOP (per slice)
                          │  validate → execute → re-anchor → next slice
                          │
                          └─► Done. Update roadmap status.
                                │
                                └─► POST-MORTEM
                                      Record what drifted, what worked,
                                      and what guardrails to add.
```

---

## Where This Runbook Fits

### Document Hierarchy

| Document | Role | Who Writes It |
|----------|------|---------------|
| `DEPLOYMENT-ROADMAP.md` | Master tracker — lists every phase, status, and links | You (human) |
| `*-PLAN.md` | Detailed plan for one phase — goals, architecture, tasks | AI agent (plan mode) |
| **This Runbook** | Process for hardening a `*-PLAN.md` into an execution contract | Reference doc (you run it) |
| `*.instructions.md` | Guardrails — coding standards, architecture rules, patterns | You + AI (maintained over time) |
| `*.prompt.md` | Scaffolding recipes — templates for generating entities, services, tests | Preset (customizable) |
| `*.agent.md` | Agent definitions — specialized reviewer/executor roles | Preset (customizable) |
| `SKILL.md` | Multi-step skills — chained procedures for migrations, deploys, sweeps | Preset (customizable) |
| `AGENTS.md` | Agent architecture, worker patterns, automation docs | You + AI |

---

## Inputs & Outputs

### Inputs

| Input | Description |
|-------|-------------|
| `DEPLOYMENT-ROADMAP.md` | The master roadmap — confirms the phase exists and what it should deliver |
| Draft `*-PLAN.md` | The rough phase plan from your plan-mode conversation |
| Guardrail files | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` |
| Prompt templates | `.github/prompts/*.prompt.md` — scaffolding recipes for consistent code generation |
| Agent definitions | `.github/agents/*.agent.md` — specialized reviewer/executor roles for audits |
| Skills | `.github/skills/*/SKILL.md` — multi-step procedures for migrations, deploys, sweeps |

### Outputs

A **hardened** `*-PLAN.md` that an agent can execute without guessing. It will contain:

| Section | Purpose |
|---------|---------|
| **Scope Contract** | What's in, what's out, what's forbidden |
| **Required Decisions** | Ambiguities resolved before execution starts |
| **Execution Slices** | Bounded 30-120 min chunks with clear inputs/outputs/dependencies |
| **Validation Gates** | Exact commands to verify each slice (build, test, lint) |
| **Re-anchor Checkpoints** | Drift detection after every slice |
| **Definition of Done** | Measurable criteria for phase completion |
| **Stop Conditions** | Hard rules that halt execution immediately |

---

## The Hardening Process

### Step 0 — Pre-flight Checks

> **Time**: ~2 minutes. Do this before writing or expanding any `*-PLAN.md`.

- [ ] Phase exists in `DEPLOYMENT-ROADMAP.md` with a clear one-line goal
- [ ] Phase plan filename is linked from the roadmap
- [ ] Guardrail files are current:
  - [ ] `.github/copilot-instructions.md` — repo-wide standards
  - [ ] `.github/instructions/*.instructions.md` — path-scoped rules for relevant areas
  - [ ] `AGENTS.md` — agent patterns include "stop on ambiguity" and "slice-by-slice execution"
- [ ] Agentic files are present (if preset was applied):
  - [ ] `.github/prompts/` — prompt templates for scaffolding
  - [ ] `.github/agents/` — agent definitions for reviews
  - [ ] `.github/skills/` — multi-step procedures

> **If any box is unchecked**: Fix it before proceeding. Stale guardrails cause agent drift.

### Step 1 — Draft the Phase Plan

Use **plan mode** (collaborative conversation, not code generation) to explore the idea.

- **Mode**: Copilot Chat → Plan Mode (or equivalent)
- **Goal**: Capture intent, architecture decisions, and rough task list
- **Output**: An initial draft `*-PLAN.md` — messy is fine at this stage

**What a good draft covers:**
- What the phase delivers (user-visible outcome)
- Which files/folders are involved
- Key architecture decisions
- Rough task ordering
- Known unknowns or open questions

### Step 2 — Run the Plan Hardening Pass

Switch to **agent mode** and run the [Plan Hardening Prompt](#plan-hardening-prompt) against your draft.

- **Mode**: Copilot Chat → Agent Mode
- **Input**: The draft `*-PLAN.md` + roadmap context
- **Goal**: Convert the draft into an execution contract with scope fences
- **Output**: A revised `*-PLAN.md` with all [Mandatory Template Blocks](#mandatory-template-blocks) filled in

**What the hardening pass adds:**
- Scope Contract (in-scope, out-of-scope, forbidden actions)
- Required Decisions (anything implicit gets flagged)
- Execution Slices (bounded chunks with validation gates and dependencies)
- Re-anchor Checkpoints (drift detection between slices)
- Definition of Done (measurable completion criteria)
- Stop Conditions (hard-halt rules)

### Step 3 — Slice into Bounded Execution Chunks

Review the execution slices the hardening pass produced. Each slice should be:

| Property | Target |
|----------|--------|
| **Duration** | 30–120 minutes of focused agent work |
| **Independence** | Completable without depending on unfinished slices |
| **Verifiable** | Has at least one concrete validation gate (build passes, test passes, file exists) |
| **Scoped** | Touches only the files/folders listed in the Scope Contract |
| **Dependencies** | Explicitly lists which prior slices must be complete first |
| **Context** | Lists files the agent must load before starting |
| **Parallelism** | Tagged `[parallel-safe]` or `[sequential]` |

> **If a slice is too big**: Split it. If a slice has no validation gate: add one. If a slice touches forbidden files: rewrite it.

#### Parallel Execution Rules

Slices may be tagged for parallel execution when they have no shared dependencies:

| Tag | Meaning | When to Use |
|-----|---------|-------------|
| `[parallel-safe]` | Can run simultaneously with others in the same group | Slices that touch different files with no shared state |
| `[sequential]` | Must wait for its `Depends On` slices to complete | Slices that read outputs of prior slices or touch shared files |

**Safety constraints**:
- Two `[parallel-safe]` slices MUST NOT touch the same file
- If a parallel slice fails its validation gate, ALL slices in that group HALT
- After a parallel group completes, run a **Parallel Merge Checkpoint** before the next group

**Parallel Merge Checkpoint** (run after each parallel group):
```markdown
- [ ] All slices in Group [X] passed their validation gates
- [ ] Build passes after all parallel slice outputs are combined
- [ ] Tests pass (catches integration issues between parallel slices)
- [ ] No file conflicts (two slices didn't modify the same file)
- [ ] Re-anchor: all changes still in-scope
```

### Step 4 — Execute with the Validation Loop

Hand the hardened plan to an agent for execution. The agent works **one slice at a time**, top-down:

```
For each slice:
  1. LOAD context files listed for this slice
  2. READ the slice goal, inputs, and constraints
  3. EXECUTE the work (code, config, docs)
  4. RUN validation gates (build, test, lint)
  5. RE-ANCHOR — re-read the Scope Contract, confirm no drift
  6. SUMMARIZE changes in ≤ 5 bullets
  7. COMMIT — git add -A && git commit (if validation passed)
  8. MOVE to the next slice (or STOP if a gate fails)

  If a gate FAILS → see ROLLBACK PROTOCOL (Section 10)
  If scope must CHANGE → see PLAN AMENDMENT PROTOCOL (Section 11)
```

> **Critical**: The agent must re-read the Scope Contract and Stop Conditions between every slice. This is what prevents drift.

### Step 5 — Maintain Guardrails

After completing a phase, update your guardrail files to capture any new patterns:

- [ ] Update `.github/instructions/*.instructions.md` if new coding patterns emerged
- [ ] Update `AGENTS.md` if new workers/agents were created
- [ ] Update `.github/copilot-instructions.md` if project-wide conventions changed
- [ ] Update `.github/prompts/` if new scaffolding patterns emerged
- [ ] Update `.github/agents/` if new reviewer checklists are needed
- [ ] Update `.github/skills/` if new multi-step procedures were discovered
- [ ] Update `DEPLOYMENT-ROADMAP.md` with phase completion status
- [ ] Complete the [Post-Mortem Template](#template-6--post-mortem) for this phase

---

## Plan Hardening Prompt

Copy-paste this prompt into agent mode when hardening a draft plan:

```text
# v2.0 — Plan Hardening Agent (Multi-Stack)

You are acting as a PLAN HARDENING AGENT.

Your job is NOT to write code. Your job is to identify ambiguity and drift risk
in the attached plan document, then convert it into an EXECUTION CONTRACT.

Context:
- Master roadmap: docs/plans/DEPLOYMENT-ROADMAP.md
- Guardrails: .github/copilot-instructions.md, .github/instructions/*.instructions.md
- Agent patterns: AGENTS.md

You must:
1) Restate the explicit goals of this phase (from the roadmap + plan).
2) Identify NON-GOALS (what must NOT be built or changed).
3) Identify REQUIRED DECISIONS that are currently implicit or missing.
4) Identify FORBIDDEN ACTIONS (files/folders/systems/behaviors that must not be touched).
5) Break the plan into EXECUTION SLICES (30-120 min each, independently completable).
   - Each slice must declare: Depends On, Context Files (including .github/instructions/*.instructions.md), Inputs, Outputs.
   - Tag each slice as `[parallel-safe]` (with Parallel Group) or `[sequential]`.
   - Two `[parallel-safe]` slices in the same group MUST NOT touch the same file.
   - Add a Parallel Merge Checkpoint after each parallel group.
6) Add VALIDATION GATES per slice (exact commands — build, test, lint).
7) Add RE-ANCHOR CHECKPOINTS after each slice.
8) Add STOP CONDITIONS that halt execution immediately.
9) Add a DEFINITION OF DONE with measurable completion criteria.
   - Include: Reviewer Gate passed (Section 6.2), zero 🔴 Critical findings.

Rules:
- Do NOT add new features or expand scope beyond what the plan describes.
- If the plan implies a decision that is not explicitly stated, flag it as a REQUIRED DECISION.
- Prefer smaller slices. Each slice must be completable in 30-120 minutes.
- Every slice must have at least one validation gate with an exact command.
- Include a "Roadmap Reference" backlink at the top of the output.

Output:
- A revised version of the plan document with all sections above integrated.
- Use the template blocks from this runbook.
```

---

## Execution Agent Prompt

Copy-paste this prompt into agent mode when executing a hardened plan slice-by-slice:

```text
# v2.0 — Execution Agent (Multi-Stack)

You are an EXECUTION AGENT.

You must follow the plan as a CONTRACT, not a suggestion.

Context:
- Hardened plan: <path to *-PLAN.md>
- Guardrails: .github/copilot-instructions.md, .github/instructions/*.instructions.md
- Agent patterns: AGENTS.md

Operating rules:
- Execute ONE execution slice at a time, top-down.
- Before starting each slice, LOAD all files listed in its Context Files field
  (including the relevant .github/instructions/*.instructions.md guardrail files).
- Do not start the next slice until the current slice passes its Validation Gates.
- After each slice, perform a RE-ANCHOR CHECKPOINT.
- Re-read the Scope Contract and Stop Conditions between every slice.
- After each passed slice, commit: git add -A && git commit -m "phase-N/slice-K: <goal>"
- After ALL slices pass, run the COMPLETENESS SWEEP (Section 6.1) to eliminate
  any TODO/mock/stub/placeholder artifacts before the Reviewer Gate.

Parallel execution rules:
- If a slice is tagged `[parallel-safe]`, check its Parallel Group assignment.
- Slices in the same Parallel Group MAY be executed concurrently (by separate agent sessions).
- After all slices in a Parallel Group complete, run the Parallel Merge Checkpoint.
- If any parallel slice fails: HALT all slices in that group and report.
- `[sequential]` slices always execute one-at-a-time in order.

Post-execution gates:
- After all slices + Completeness Sweep: run the REVIEWER GATE (Section 6.2) in a fresh session.
- After Reviewer Gate passes: run DRIFT DETECTION (Section 7) in another fresh session.
- If Reviewer Gate returns 🔴 Critical: follow the Lockout Protocol (Section 6.2).

If you encounter ambiguity:
- STOP immediately.
- Ask a clarification question.
- Do NOT invent behavior, architecture, or new scope.
- Do NOT work around the issue — wait for human resolution.

If a Validation Gate FAILS:
- STOP immediately.
- Report the failure details.
- Follow the Rollback Protocol (see Section 10).
- Do NOT attempt alternate approaches without human approval.

Output format after each slice:
1) What changed (max 5 bullets)
2) Validation results (exact commands run + pass/fail)
3) Re-anchor check:
   - All changes in-scope? (yes/no)
   - Non-goals violated? (yes/no)
   - Forbidden files touched? (yes/no)
   - Stop conditions triggered? (yes/no)
4) Next slice to execute (name only)

If ANY re-anchor check returns a violation: STOP and report.
```

---

## Completeness Sweep Protocol (Section 6.1)

> **When to run**: After ALL execution slices have passed their individual validation gates and been committed, but BEFORE the Reviewer Gate audit.

### The Problem This Solves

Per-slice Validation Gates verify that code **builds and tests pass**. But agents frequently introduce deferred-work artifacts during scaffolding that pass both checks:

| Artifact | Why Gates Miss It | Impact if Shipped |
|----------|-------------------|-------------------|
| `// TODO: Wire to API` | Compiles fine | Feature doesn't work |
| Inline mock data | Valid code | Fake data in production |
| Stub implementations | No test covers it | Silent no-op |
| `// Will be replaced` | Comment, not code | Misleading behavior |

### Sweep Process

1. **Scan** all files in the phase's scope for deferred-work markers:
   ```
   TODO, HACK, FIXME, "mock data", "will be replaced", "Simulate",
   "placeholder" (in code, not HTML attributes), "stub" (in comments)
   ```

2. **For each finding**, determine the correct resolution:
   | Finding Type | Resolution |
   |-------------|------------|
   | TODO with known method | Wire to existing service/API method |
   | TODO needing new method | Add method to interface + implementation, then wire |
   | Inline mock data | Replace with API/service call |
   | Stub implementation | Wire to real service call |
   | Stale phase comment | Update to current phase attribution |
   | Cannot resolve without scope expansion | **STOP** — report as blocked |

3. **Validate** after each batch of fixes: build + test

4. **Commit** when sweep is complete

### Completeness Sweep Prompt

```text
# v2.0 — Completeness Sweep Agent

You are a COMPLETENESS SWEEP AGENT.

Your job is to find and eliminate ALL deferred-work artifacts introduced during
slice-by-slice execution. The Definition of Done requires zero such artifacts.

Context:
- Hardened plan: <path to *-PLAN.md>
- Guardrails: .github/copilot-instructions.md

Scan ALL files created or modified during this phase for:
1. TODO / HACK / FIXME comments
2. Mock/placeholder/stub inline data (hardcoded records, fake values)
3. "will be replaced" / "Simulate" / "Seed with sample" comments
4. Stub implementations (methods that do nothing or return defaults)
5. Stale phase-attribution comments
6. Commented-out code with future-intent markers

For each finding:
- Wire it to the correct real service, API method, or platform API
- If a new interface method is needed, add it (interface + implementation)
- Remove the deferred-work comment
- Verify build + tests pass after each batch

If ANY finding requires adding scope not covered by the plan: STOP and report.

Output format:
1) Total findings (before → after)
2) Files modified
3) New methods/types added
4) Build: pass/fail
5) Tests: pass/fail

Commit when complete.
```

---

## Reviewer Gate Protocol (Section 6.2)

> **When to run**: After the Completeness Sweep passes and before marking the phase complete.

### Reviewer Gate Rules

| Rule | Requirement |
|------|-------------|
| **Fresh context** | Reviewer MUST be a different agent session |
| **Read-only** | Reviewer MUST NOT modify any files — audit only |
| **Lockout on rejection** | If critical drift found: original execution agent is locked out |
| **Escalation** | Locked-out slices require human re-assignment or a fresh agent |
| **Evidence-based** | Every finding must cite the specific rule violated |

### Severity Levels

| Level | Description | Action |
|-------|-------------|--------|
| 🔴 **Critical** | Forbidden action violated, security boundary crossed | **LOCKOUT** — slice must be re-done by fresh agent |
| 🟡 **Warning** | Architectural drift, naming inconsistency, missing test | **FIX** — original agent may fix under reviewer supervision |
| 🔵 **Info** | Style suggestion, documentation gap | **NOTE** — record in Post-Mortem |

### Lockout Protocol

When a reviewer issues a 🔴 Critical finding:

1. Original execution agent session is terminated
2. Document the finding in the plan's `## Amendments` section
3. Open a new agent session to re-execute the affected slice(s)
4. New agent must re-read: Scope Contract, reviewer findings, and domain guardrails
5. Re-run Reviewer Gate after the fix

### Reviewer Gate Prompt

```text
# v2.0 — Reviewer Gate Agent

You are a REVIEWER GATE AGENT.

Your job is to AUDIT, not to fix. You are an independent quality gate.
You must NOT be the same session that wrote or executed the code.

Context:
- Hardened plan: <path to *-PLAN.md>
- Guardrails: .github/copilot-instructions.md, .github/instructions/*.instructions.md
- Agent patterns: AGENTS.md

Review checklist:
1. SCOPE COMPLIANCE — Are all changes within the Scope Contract?
2. FORBIDDEN ACTIONS — Were any off-limits files/folders touched?
3. ARCHITECTURE — Does the code follow layer separation (Controller → Service → Repository)?
4. ERROR HANDLING — Proper error types, no empty catch blocks?
5. NAMING — Follows project naming conventions from instruction files?
6. PATTERNS — Follows existing patterns from .github/instructions/?
7. TESTING — New/modified features covered by tests?
8. SECURITY — Input validation? Parameterized queries? No secrets in code?

For each finding:
- Assign severity: 🔴 Critical / 🟡 Warning / 🔵 Info
- Cite the specific rule or section violated
- Do NOT suggest fixes — report only

Output format:
| # | File | Finding | Severity | Rule Violated |
|---|------|---------|----------|---------------|

Summary:
- Critical: N (if >0: LOCKOUT triggered)
- Warnings: N
- Info: N
- Verdict: PASS / FAIL (LOCKOUT)

Do NOT modify any files. Report ONLY.
```

---

## Drift Detection Prompt

Copy-paste into a **fresh agent session** to audit completed work:

```text
# v2.0 — Drift Detection Agent

You are a DRIFT DETECTION AGENT.

Your job is to AUDIT, not to fix. You are an independent reviewer.

Compare these three sources of truth:
1. DEPLOYMENT-ROADMAP.md — the phase's stated goal
2. The hardened *-PLAN.md — the scope contract, non-goals, and forbidden actions
3. The actual changes made — files modified, added, or deleted

Identify:
- Scope creep (work done that is not in the Scope Contract)
- Unplanned changes (files touched not in any Execution Slice)
- Non-goal violations (work contradicting the Out of Scope section)
- Forbidden action violations (off-limits files/folders/dependencies touched)
- Architectural drift (patterns conflicting with .github/instructions/)
- Unresolved amendments (changes without Amendment Protocol)

Output format:
- Drift found: Yes / No
- If Yes:
  | File | Issue | Violated Section |
  |------|-------|------------------|

- Amendment compliance:
  | Amendment # | Properly documented? | Re-hardened? |
  |-------------|---------------------|--------------|

Do NOT suggest fixes. Do NOT modify files. Report ONLY.
```

---

## Mandatory Template Blocks

Every hardened `*-PLAN.md` must contain these six sections.

### Template 1 — Scope Contract

```markdown
## Scope Contract

### In Scope
- (Explicit list of what is being built/changed)
- (Explicit folders/modules that may be touched)

### Out of Scope (Non-Goals)
- (What must NOT change — call out explicitly)

### Forbidden Actions
- Do not modify: (list specific folders/files that are off-limits)
- Do not introduce: (new dependencies, new databases, new frameworks, etc.)
- Do not refactor: (unrelated code outside the scope of this phase)
```

### Template 2 — Required Decisions

```markdown
## Required Decisions (Resolve Before Execution)

| # | Decision | Options | Resolution |
|---|----------|---------|------------|
| 1 | (e.g., Which DB for storage?) | Option A / Option B | (TBD or resolved) |
| 2 | (e.g., Auth pattern?) | JWT / API Key | (TBD or resolved) |

> **Rule**: If ANY decision is marked TBD, execution MUST NOT begin.
```

### Template 3 — Execution Slices

```markdown
## Execution Slices

### Slice 1: <descriptive name>
**Goal**: (one sentence)
**Estimated Time**: (30-120 min)
**Parallelism**: `[parallel-safe]` Group A | `[sequential]`
**Depends On**: Slice N | None
**Inputs**: (files, data, or prior slice outputs)
**Outputs**: (files created/modified, config changes)

**Context Files** (load before starting):
- `path/to/relevant-file`
- `.github/instructions/relevant.instructions.md`

**Test Strategy**: Unit tests | Integration tests | E2E tests | No new tests

**Validation Gates**:
- [ ] Build passes with zero errors
- [ ] Tests pass
- [ ] (any other concrete check)

**Files Touched**:
- `path/to/file1`
- `path/to/file2`

---

### Parallel Merge Checkpoint (after Group A)
- [ ] All Group A slices passed validation gates
- [ ] Build passes after combining all Group A outputs
- [ ] Tests pass (integration check)
- [ ] No file conflicts between parallel slices
- [ ] Re-anchor: all changes in-scope
```

### Template 4 — Re-anchor Checkpoints

```markdown
## Re-anchor Checkpoints

After completing each slice, the executing agent MUST:

- [ ] Re-read the **Scope Contract** — confirm all changes are in-scope
- [ ] Re-read the **Forbidden Actions** — confirm nothing off-limits was touched
- [ ] Re-read the **Stop Conditions** — confirm no halt triggers fired
- [ ] Summarize what changed in ≤ 5 bullets
- [ ] Record validation gate results (pass/fail with output)
- [ ] Confirm the next slice's inputs are ready
- [ ] Confirm the next slice's dependencies are satisfied

> If any checkbox fails: STOP execution and report the issue.
```

### Template 5 — Definition of Done

```markdown
## Definition of Done

This phase is COMPLETE when ALL of the following are true:

### Build & Test
- [ ] Build passes with zero errors across the entire project
- [ ] Tests pass with no new test failures
- [ ] All execution slices have passed their individual validation gates

### Drift & Quality
- [ ] All re-anchor checkpoints passed (no drift detected)
- [ ] Completeness Sweep passed (zero TODO/mock/stub artifacts)
- [ ] Reviewer Gate passed (run in fresh agent session — Section 6.2)
- [ ] Zero 🔴 Critical findings (or all lockout slices re-executed)
- [ ] Drift Detection audit passed (run in fresh agent session)
- [ ] All Required Decisions are resolved (no TBD rows remain)
- [ ] No Forbidden Actions were violated

### Documentation & Guardrails
- [ ] Documentation updated (if applicable)
- [ ] `DEPLOYMENT-ROADMAP.md` status updated to ✅ Complete
- [ ] Guardrail files updated with any new patterns discovered
- [ ] Post-Mortem template completed (Template 6)

### Sign-Off
- [ ] Human review confirms the phase deliverable matches the roadmap goal
```

### Template 6 — Post-Mortem

```markdown
## Post-Mortem

### What Went Well
- (things that worked smoothly — patterns to repeat)

### What Drifted
- (any scope creep or unplanned changes)
- (were any amendments needed? how many?)

### What Was Underestimated
- (slices that took longer than estimated)
- (missing decisions that surfaced during execution)

### Guardrail Gaps Discovered
- (missing *.instructions.md rules that would have prevented drift)
- (patterns the agent invented that should be codified)

### Changes to Make for Next Phase
- [ ] Add to `.github/instructions/...`: (new rule discovered)
- [ ] Update `AGENTS.md`: (new agent pattern to document)
- [ ] Update this runbook: (process improvement identified)
```

---

## Stop Conditions

Every hardened `*-PLAN.md` must include:

```markdown
## Stop Conditions (Execution Must Halt)

Execution STOPS immediately if:

1. A **Required Decision** is still marked TBD
2. The agent needs to **guess** about behavior, schema, auth, or architecture
3. A task would **touch Forbidden files/folders**
4. A **Validation Gate fails** (build breaks, tests fail)
5. The work required **exceeds the current slice boundary**
6. The agent discovers a **conflict** with existing guardrail rules
7. A **new dependency** would be introduced that isn't in the Scope Contract

When stopped:
- Report what triggered the halt
- Do NOT attempt to work around the issue
- Follow the Rollback Protocol if code was partially written
- Wait for human resolution before continuing
```

---

## Rollback Protocol

### Option 1: Git Stash (Quick Save)

```bash
git stash push -m "phase-N/slice-K: failed validation — preserving for review"
```

### Option 2: Git Reset (Single Slice Rollback)

```bash
git checkout -- .
git clean -fd
```

### Option 3: Branch-Per-Slice (Safest)

```bash
# Before each slice
git checkout -b phase-N/slice-K

# After validation passes
git checkout main
git merge phase-N/slice-K --no-ff -m "phase-N/slice-K: <goal>"

# If validation fails
git checkout main
git branch -D phase-N/slice-K
```

### After Any Rollback

1. Identify what caused the failure
2. Update the plan if needed (see Amendment Protocol)
3. Re-execute from the failed slice — do NOT re-run passed slices
4. Never "fix forward" without approval

---

## Plan Amendment Protocol

### Rules

1. **STOP execution** at the current slice boundary
2. **Do NOT modify the plan in-place** during an active execution session
3. Open a **new plan-mode conversation** to discuss the change
4. Apply amendments using the process below

### Amendment Process

1. Document what changed and why — add an `## Amendments` section
2. Re-run the Plan Hardening Prompt on remaining slices only
3. Update the Scope Contract if boundaries changed
4. Re-validate Required Decisions
5. Update slice dependencies
6. Resume execution from the next unexecuted slice

### Amendment Log Template

```markdown
## Amendments

### Amendment 1 — <date>
**Trigger**: (what happened)
**Change**: (what was modified)
**Affected Slices**: (which slices were re-hardened)
**Re-hardened**: Yes / No
**Scope Contract Updated**: Yes / No
```

---

## File Naming & Linking Conventions

### Plan File Naming

| Pattern | Example |
|---------|---------|
| `Phase-N-FEATURE-NAME-PLAN.md` | `Phase-1-USER-AUTH-PLAN.md` |
| All caps, hyphen-separated | `Phase-3-CICD-PIPELINE-PLAN.md` |
| Located in `docs/plans/` | `docs/plans/Phase-5-MONITORING-PLAN.md` |

### Roadmap → Plan Linking

```markdown
### Phase 1: User Authentication
**Plan**: [Phase-1-USER-AUTH-PLAN.md](./Phase-1-USER-AUTH-PLAN.md)
**Status**: ✅ Complete
```

### Plan → Roadmap Backlinking

```markdown
> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase N
> **Status**: 🚧 In Progress | ✅ Complete | 📋 Planned
```

---

## Worked Examples

See the `docs/plans/examples/` directory for complete worked examples:

| Example | Tech Stack | Complexity |
|---------|-----------|------------|
| [Phase-DOTNET-EXAMPLE.md](./examples/Phase-DOTNET-EXAMPLE.md) | .NET / C# / Blazor | Medium (6 slices) |
| [Phase-TYPESCRIPT-EXAMPLE.md](./examples/Phase-TYPESCRIPT-EXAMPLE.md) | TypeScript / React / Node | Medium (5 slices) |
| [Phase-PYTHON-EXAMPLE.md](./examples/Phase-PYTHON-EXAMPLE.md) | Python / FastAPI | Small (4 slices) |

Each example shows all 6 Mandatory Template Blocks filled in with realistic data for that stack.
