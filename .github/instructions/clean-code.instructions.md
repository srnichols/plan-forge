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
- **Enums / frozen arrays**: import from `pforge-mcp/enums.mjs` — never hand-type string literals
- **Avoid**: `data`, `info`, `result`, `tmp`, `val`, single letters outside loop indices

---

## When commenting

- Comment **why**, not **what** — the code shows *what*; the comment explains *why it had to be this way*
- Delete commented-out code; use `git` for history
- JSDoc only on exported API surfaces; inline comments are a last resort
- Do NOT leave `TODO` / `FIXME` / `HACK` markers — create a tracked issue instead
- `console.log` must be intentional CLI output; remove debug leakage before committing

---

## Module size

| Tier | LOC | Action |
|------|-----|--------|
| High | >3,000 | **Blocking** — extract sub-modules now, split by Single Responsibility |
| Medium | 1,000–3,000 | Monitor — extract on the next feature addition to that file |
| OK | <1,000 | No action required |

> High-severity files: `orchestrator.mjs` (13,933 LOC), `server.mjs` (9,812 LOC), `capabilities.mjs` (3,294 LOC).

---

## Quick review checklist (`clean-code-review`)

Before approving any PR that touches `pforge-mcp/` or `pforge-master/`:

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

---

## References

- *Clean Code* — Robert C. Martin (naming, functions, comments, formatting)
- *Clean Architecture* — Robert C. Martin (SOLID, Dependency Rule, Component Cohesion, Stable Dependencies, Professional Refusal)
- `docs/plans/cleanup-findings/CATALOG.md` — 27 audit findings with IDs and file locations
- `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — remediation priority order
- `pforge-mcp/enums.mjs` — canonical frozen arrays (hook names, quorum modes, model tiers)
- `.github/instructions/architecture-principles.instructions.md` — Temper Guards, ACI rules, and Clean Architecture Principles
