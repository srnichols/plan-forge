---
description: Clean Code guardrails — function design, naming, commenting, duplication, and review checklist (Clean Code, Robert C. Martin).
applyTo: '**'
tags: [clean-code-review]
---

# Clean Code Guardrails

> Generic guardrails. Project-specific thresholds, audit catalogs, or
> "high-severity files" lists belong in your project's own docs (e.g.
> `docs/plans/PROJECT-PRINCIPLES.md` or a project-specific audit).

---

## When writing a function

| Rule | Threshold | Action |
|------|-----------|--------|
| Length | ≤100 lines (warn) / ≤300 lines (error) | Extract helpers; split by single responsibility |
| Complexity | ≤12 paths (warn) / ≤20 paths (error) | Flatten conditionals; extract guard clauses |
| Parameters | ≤4 positional (warn) / ≤6 (error) | Wrap excess args in an options object / DTO / parameter struct |
| Nesting depth | ≤3 levels | Invert conditions; extract inner blocks |

**Checks before merging a function change:**

- [ ] Function does exactly one thing (name is a verb phrase, single concern)
- [ ] No positional parameter list longer than 4 — use a parameter object
- [ ] No magic numbers — assign to a named constant
- [ ] No side effects beyond the function's stated contract
- [ ] Linter complexity / max-lines violations are zero

---

## When naming

- **Modules / files**: noun, follow your stack's convention (`kebab-case`, `snake_case`, `PascalCase` — pick one and apply consistently)
- **Functions**: verb phrase, reveals intent (`buildEstimate`, not `calc`)
- **Variables**: noun; boolean prefixed `is` / `has` / `can`
- **Constants**: UPPER_SNAKE for true compile-time literals; ordinary identifier for runtime values
- **Enums / closed value sets**: define in one canonical module; import from there — never hand-type the string literal in code
- **Avoid**: `data`, `info`, `result`, `tmp`, `val`, single letters outside loop indices

---

## When commenting

- Comment **why**, not **what** — the code shows *what*; the comment explains *why it had to be this way*
- Delete commented-out code; use version control for history
- Doc comments only on exported / public API surfaces; inline comments are a last resort
- Do NOT leave `TODO` / `FIXME` / `HACK` markers — create a tracked issue instead
- Debug print statements (`console.log`, `print`, `Console.WriteLine`, `fmt.Println`, etc.) must be intentional output; remove debug leakage before committing

---

## When you spot duplication (DRY)

Two copies is already drift. Don't wait for a third.

| Pattern | Action |
|---------|--------|
| Same string/numeric literal in ≥2 sites | Extract to a named constant. If it's from a stable small set (modes, tiers, error codes, status names), centralize in an enums/constants module — never re-type |
| Same 3+ line code block in ≥2 sites | Extract to a helper function in the nearest shared module |
| Same regex / format string in ≥2 sites | Extract to a named constant so a fix lands in one place |
| Same config shape constructed in ≥2 sites | Extract a factory function returning the shape |
| Parallel switch/if chains over the same values in ≥2 functions | Extract a single mapping object or strategy table |

**Why so strict?** Hand-typed string literals scattered across a codebase become multi-week cleanup projects once they reach 20+ sites. Catching duplication at copy #2 is one extract; catching it at #50 is a migration phase.

The `/clean-code-review` skill runs `jscpd` (and equivalents for non-JS stacks) to surface inline duplicates mechanically — but literal/symbol duplicates above won't trigger jscpd unless the surrounding code matches. Catch those by hand at review time.

---

## Module size

| Tier | LOC | Action |
|------|-----|--------|
| High | >3,000 | **Blocking** — extract sub-modules now, split by Single Responsibility |
| Medium | 1,000–3,000 | Monitor — extract on the next feature addition to that file |
| OK | <1,000 | No action required |

> Track your own high-severity files in `docs/plans/PROJECT-PRINCIPLES.md` (or equivalent) as they appear — the `/clean-code-review` skill reports current LOC tiers across the codebase.

---

## Quick review checklist (`clean-code-review`)

> **Skill**: Use `/clean-code-review` to run all checks mechanically. Add `--fix-suggestions` for concrete remediation guidance per finding. See `.github/skills/clean-code-review/SKILL.md`.

Before approving any PR:

- [ ] No new complexity / max-lines / parameter-count linter violations
- [ ] No function has >4 positional parameters (use a parameter object)
- [ ] No file added that exceeds 3,000 LOC
- [ ] No magic numbers — named constants used throughout
- [ ] No commented-out code blocks
- [ ] No TODO/FIXME/HACK markers
- [ ] Debug print statements audited — leakage removed
- [ ] No empty `catch { }` / `except: pass` / `if err != nil { }` — every caught error is logged or handled
- [ ] No hand-typed copies of values that belong in an enum / constants module

---

## Boy Scout Rule (quick reminder)

> "Leave the code cleaner than you found it." — Robert C. Martin

Every commit touching a file earns one Boy Scout improvement: a better name, a guard clause extraction, a deleted dead comment. See the full rule and its corollaries in `.github/instructions/architecture-principles.instructions.md` under **Boy Scout Rule**.

---

## References

- *Clean Code* — Robert C. Martin (naming, functions, comments, formatting)
- *Clean Architecture* — Robert C. Martin (SOLID, Dependency Rule, Component Cohesion, Stable Dependencies, Professional Refusal)
- `.github/instructions/architecture-principles.instructions.md` — Temper Guards and Clean Architecture principles
- `.github/skills/clean-code-review/SKILL.md` — the mechanical-pass skill that backs this checklist
