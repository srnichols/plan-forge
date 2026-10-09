---
description: Clean Code guardrails — function design, naming, commenting, and review checklist derived from the Phase 42 audit (Clean Code, Robert C. Martin).
applyTo: '**'
tags: [clean-code-review]
---

# Clean Code Guardrails

> Derived from the Phase 42 Clean-Code Audit (27 findings, 6 categories).
> Full catalog: `docs/plans/cleanup-findings/CATALOG.md`

---

## When writing a function

| Rule | Threshold | Action |
|------|-----------|--------|
| Length | ≤100 lines (warn) / ≤300 lines (error) | Extract helpers; split by single responsibility |
| Complexity | ≤12 paths (warn) / ≤20 paths (error) | Flatten conditionals; extract guard clauses |
| Parameters | ≤4 positional (warn) / ≤6 (error) | Wrap excess args in an `options` object |
| Nesting depth | ≤3 levels | Invert conditions; extract inner blocks |

**Checks before merging a function change:**

- [ ] Function does exactly one thing (name is a verb phrase, single concern)
- [ ] No positional parameter list longer than 4 — use `{ a, b, c }` destructuring
- [ ] No magic numbers — assign to a named `const` at module scope
- [ ] No side effects beyond the function's stated contract
- [ ] ESLint `complexity-error` and `max-lines-per-function-error` must be zero

---

## When naming

- **Modules / files**: noun, kebab-case (`cost-service.mjs`, not `cs.mjs`)
- **Functions**: verb phrase, reveals intent (`buildEstimate`, not `calc`)
- **Variables**: noun, camelCase; boolean prefixed `is` / `has` / `can`
- **Constants**: UPPER_SNAKE for true compile-time literals; camelCase `const` for runtime values
- **Enums / frozen arrays**: import from a canonical enums module — never hand-type string literals
- **Avoid**: `data`, `info`, `result`, `tmp`, `val`, single letters outside loop indices

---

## When commenting

- Comment **why**, not **what** — the code shows *what*; the comment explains *why it had to be this way*
- Delete commented-out code; use `git` for history
- JSDoc only on exported API surfaces; inline comments are a last resort
- Do NOT leave `TODO` / `FIXME` / `HACK` markers — create a tracked issue instead
- `console.log` must be intentional CLI output; remove debug leakage before committing

---

## When you spot duplication (DRY)

DRY protects one source of truth for the same knowledge, not identical text. Before extracting, identify the shared fact and its owner; similar code with independent reasons to change should remain separate. Two copies of the same policy can drift even when their implementations look different.

| Pattern | Action |
|---------|--------|
| Same string/numeric literal representing the same fact in ≥2 sites | Extract to a `const`. Canonical hook names, modes, tiers, and error codes belong in an enums/constants module — never re-type |
| Same 3+ line block encoding the same responsibility in ≥2 sites | Extract a helper in the nearest shared module |
| Same regex / format string with the same semantics in ≥2 sites | Extract a named `const` so the rule changes in one place |
| Same configuration contract constructed in ≥2 sites | Extract a factory when the consumers share ownership and reasons to change |
| Parallel switch/if chains encoding the same mapping in ≥2 functions | Extract a single mapping object or strategy table |
| Same policy expressed differently across code, config, schemas, or docs | Establish an authoritative definition and keep its representations consistent; keep test expectations independent of the implementation |
| Similar syntax or equal literals belonging to independent policies | Keep responsibilities separate; record the distinction when triaging a scanner match |

**Why so strict?** Hand-typed string literals scattered across a codebase become multi-week cleanup projects once they reach 20+ sites. Catching duplication at copy #2 is one extract; catching it at #50 is a migration phase.

`/clean-code-review` surfaces duplication candidates mechanically; `/code-review` determines whether they duplicate knowledge. A smaller duplication count alone does not justify an abstraction.

---

## Module size

| Tier | LOC | Action |
|------|-----|--------|
| High | >3,000 | **Blocking** — extract sub-modules now, split by Single Responsibility |
| Medium | 1,000–3,000 | Monitor — extract on the next feature addition to that file |
| OK | <1,000 | No action required |

---

## Quick review checklist (`clean-code-review`)

> **Skill**: Use `/clean-code-review` to run all checks mechanically. Add `--fix-suggestions` for concrete remediation guidance per finding. See `.github/skills/clean-code-review/SKILL.md`.

Before approving any PR:

- [ ] No new `complexity-error` or `max-lines-per-function-error` violations (`npm run lint`)
- [ ] No function has >4 positional parameters (use options object)
- [ ] No file added that exceeds 3,000 LOC
- [ ] No magic numbers — named constants used throughout
- [ ] No commented-out code blocks
- [ ] No TODO/FIXME/HACK markers
- [ ] `console.log` calls audited — debug output removed

---

## Boy Scout Rule (quick reminder)

> "Leave the code cleaner than you found it."

Every commit touching a file earns one Boy Scout improvement: a better name, a guard clause extraction, a deleted dead comment. See the full rule and its corollaries in `.github/instructions/architecture-principles.instructions.md` under **Boy Scout Rule**.

The improvement can be a surgical correctness fix without a lower warning count. Review per-rule changes, severity, and scope; do not suppress or relocate debt to improve metrics, introduce new violations, or require unrelated cleanup. Existing blocking gates still apply.

---

## References

- *Clean Code* — Robert C. Martin (naming, functions, comments, formatting)
- *Clean Architecture* — Robert C. Martin (SOLID, Dependency Rule, Component Cohesion, Stable Dependencies, Professional Refusal)
- `docs/plans/cleanup-findings/CATALOG.md` — audit findings with IDs and file locations
- `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — remediation priority order
- `.github/instructions/architecture-principles.instructions.md` — Temper Guards, ACI rules, and Clean Architecture Principles
