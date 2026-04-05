# Demo: Spec Kit Users

> **Audience**: Developers already using Spec Kit who want enforcement on top of specifications
> **Key message**: Write specs with Spec Kit. Enforce them with Plan Forge. Shared extensions. Complementary, not competing.
> **Duration**: 10 minutes

---

## Script

### 1. "You Write Great Specs. Are They Actually Followed?" (1 min)

> "Spec Kit is excellent at defining what to build. /speckit.specify → /speckit.plan → /speckit.tasks. But once /speckit.implement starts... how do you know the code actually matches the spec?"

### 2. Plan Forge Auto-Detects Your Spec Kit Artifacts (2 min)

Show a project with existing Spec Kit files:
```
specs/003-user-auth/spec.md
specs/003-user-auth/plan.md
specs/003-user-auth/tasks.md
memory/constitution.md
```

Start Plan Forge Step 0 (Specifier):

> "I found Spec Kit artifacts in this project:
> - specs/003-user-auth/spec.md — feature specification
> - specs/003-user-auth/plan.md — implementation plan
> - memory/constitution.md — project constitution
>
> Import as Plan Forge execution contract?"

Select "Import spec" → Plan Forge maps sections automatically.

### 3. Your Constitution Becomes Project Principles (2 min)

```
memory/constitution.md → docs/plans/PROJECT-PRINCIPLES.md
```

> "Article I (Library-First) becomes Principle 1. Article III (Test-First) becomes Principle 3. Same rules, enforced at every step."

### 4. Hardened Execution — The Missing Piece (3 min)

> "Spec Kit gives you the spec. Plan Forge hardens it into a contract the AI can't deviate from."

Show the hardened plan:
- Scope contract (locked — no additions mid-build)
- Execution slices with validation gates
- Forbidden actions (files the AI cannot touch)

```bash
pforge analyze docs/plans/Phase-1-USER-AUTH-PLAN.md
```

> "Consistency score: 94. Every requirement from your spec.md is traced to code and tests."

### 5. Shared Extension Ecosystem (1 min)

```bash
pforge ext search
```

> "Same catalog format as Spec Kit's catalog.community.json. Extensions marked 'speckit_compatible' work in both tools."

Show: Verify extension, Cleanup extension, Staff Review — all from Spec Kit community, usable in Plan Forge.

### 6. The Combined Workflow (1 min)

```
Spec Kit: /speckit.constitution → /speckit.specify → /speckit.plan → /speckit.tasks
    ↓
Plan Forge: auto-import → harden → execute (with gates) → sweep → analyze → review → ship
```

> "Spec Kit defines what. Plan Forge ensures how. Both free. Both MIT. Both work standalone or together."

Show the interop page: `planforge.software/speckit-interop.html`

---

## Objection Handling

| Objection | Answer |
|---|---|
| "Isn't this competing with Spec Kit?" | Complementary. Spec Kit writes specs. Plan Forge enforces them. We link to Spec Kit on our site. |
| "I already have /speckit.implement" | That generates code from spec. Plan Forge validates the generated code matches the spec at every step. |
| "Why not just use Spec Kit extensions?" | You can! Our catalog is compatible. Plan Forge adds 19 reviewer agents, lifecycle hooks, and a consistency scoring engine. |
| "Do I need to learn a new workflow?" | Step 0 auto-imports your Spec Kit artifacts. You keep using Spec Kit for spec writing. Plan Forge handles enforcement. |
