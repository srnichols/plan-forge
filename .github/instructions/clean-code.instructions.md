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

## When you spot duplication (DRY)

DRY protects one source of truth for the same knowledge, not identical text. Before extracting, identify the shared fact and its owner; similar code with independent reasons to change should remain separate. Two copies of the same policy can drift even when their implementations look different.

| Pattern | Action |
|---------|--------|
| Same string/numeric literal representing the same fact in ≥2 sites | Extract to a `const`. For canonical hook names, modes, tiers, or error codes, import from `pforge-mcp/enums.mjs` — never re-type |
| Same 3+ line block encoding the same responsibility in ≥2 sites | Extract a helper in the nearest shared module |
| Same regex / format string with the same semantics in ≥2 sites | Extract a named `const` so the rule changes in one place |
| Same configuration contract constructed in ≥2 sites | Extract a factory when the consumers share ownership and reasons to change |
| Parallel switch/if chains encoding the same mapping in ≥2 functions | Extract a single mapping object or strategy table |
| Same policy expressed differently across code, config, schemas, or docs | Establish an authoritative definition and keep its representations consistent; keep test expectations independent of the implementation |
| Similar syntax or equal literals belonging to independent policies | Keep responsibilities separate; record the distinction when triaging a scanner match |

**Why so strict?** The Phase 41 enums centralization had to chase the same hook-name string across 50+ files because "just two copies" became fifty over a year. Catching duplication at copy #2 is one extract; catching it at #50 is a multi-slice migration phase.

`/clean-code-review` surfaces duplication candidates mechanically; `/code-review` determines whether they duplicate knowledge. A smaller duplication count alone does not justify an abstraction.

---

## Module size

| Tier | LOC | Action |
|------|-----|--------|
| High | >3,000 | **Blocking** — extract sub-modules now, split by Single Responsibility |
| Medium | 1,000–3,000 | Monitor — extract on the next feature addition to that file |
| OK | <1,000 | No action required |

> High-severity files: `orchestrator.mjs` (13,933 LOC), `server.mjs` (9,812 LOC), `capabilities.mjs` (3,294 LOC).

---

## Source-read guards

When a separation boundary between two sibling modules is load-bearing (e.g. the SDK worker must never call the spawn-path parsers), encode the boundary as a **source-read guard** in the corresponding test file:

```js
const src = readFileSync(join(__dirname, "../orchestrator/sdk-worker.mjs"), "utf8");
expect(src).not.toContain("parseGrokStreamingJson");
```

Name the describe block `"Guard: <invariant in plain English>"` so the test ID is self-documenting and easy to grep. Mirror the guard with a positive assertion on the sibling module so renaming the symbol also breaks the guard.

---

## Quick review checklist (`clean-code-review`)

> **Skill**: Use `/clean-code-review` to run all checks mechanically. Add `--fix-suggestions` for concrete remediation guidance per finding. See `.github/skills/clean-code-review/SKILL.md`.

Before approving any PR that touches `pforge-mcp/` or `pforge-master/`:

- [ ] No new `complexity-error` or `max-lines-per-function-error` violations (see **Running the checks** below)
- [ ] No function has >4 positional parameters (use options object)
- [ ] No file added that exceeds 3,000 LOC
- [ ] No magic numbers — named constants used throughout
- [ ] No commented-out code blocks
- [ ] No TODO/FIXME/HACK markers
- [ ] `console.log` calls audited — debug output removed

### Running the checks

There is **no `npm run lint` script** in this repo. ESLint 9 is already a
devDependency and the clean-code rules live in
`scripts/audit/eslint-clean-code.config.mjs`.

```bash
# Full sweep — every audit script, merged report
npm run audit:full

# One or more files, straight from ESLint (exits 1 on errors)
node node_modules/eslint/bin/eslint.js --config scripts/audit/eslint-clean-code.config.mjs <file>...

# "No NEW violations" delta — lints base vs HEAD and reports the difference
node scripts/audit/boyscout-delta.mjs
```

> **`scripts/audit/run-eslint-clean-code.mjs` always exits 0.** It is a report
> generator (writes `docs/plans/cleanup-findings/raw/eslint-report.json`), not a
> gate. Do not wire it into CI expecting it to block — invoke ESLint directly, or
> assert on the report contents.

To baseline a file before your change (the trick `boyscout-delta.mjs` uses):

```bash
git show HEAD~1:<path> | node node_modules/eslint/bin/eslint.js \
  --config scripts/audit/eslint-clean-code.config.mjs --stdin --stdin-filename <path>
```

Compare like with like — a one-file baseline against a multi-file run will invent
a regression that does not exist.

---

## Boy Scout Rule (quick reminder)

> "Leave the code cleaner than you found it."

Every commit touching a file earns one Boy Scout improvement: a better name, a guard clause extraction, a deleted dead comment. See the full rule and its corollaries in `.github/instructions/architecture-principles.instructions.md` under **Boy Scout Rule**.

The improvement can be a surgical correctness fix without a lower warning count. Review per-rule changes, severity, and scope; do not suppress or relocate debt to improve metrics, introduce new violations, or require unrelated cleanup. Existing blocking gates still apply.

---

## References

- *Clean Code* — Robert C. Martin (naming, functions, comments, formatting)
- *Clean Architecture* — Robert C. Martin (SOLID, Dependency Rule, Component Cohesion, Stable Dependencies, Professional Refusal)
- `docs/plans/cleanup-findings/CATALOG.md` — 27 audit findings with IDs and file locations
- `docs/plans/cleanup-findings/CATEGORIES-SUMMARY.md` — remediation priority order
- `pforge-mcp/enums.mjs` — canonical frozen arrays (hook names, quorum modes, model tiers)
- `.github/instructions/architecture-principles.instructions.md` — Temper Guards, ACI rules, and Clean Architecture Principles
