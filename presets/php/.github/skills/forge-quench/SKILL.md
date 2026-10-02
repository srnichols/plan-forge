---
name: forge-quench
description: "Systematically reduce Laravel code complexity while preserving exact behavior — measure, understand, propose, prove, report. Use after a feature is complete and tests pass, when controllers, services, repositories, jobs, or resources are harder to maintain than they should be."
argument-hint: "[optional: specific files or directories to simplify, e.g. 'app/Services/' or 'app/Services/OrderService.php']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - replace_string_in_file
  - forge_sweep
---

# Forge Quench — Code Simplification Skill

> Named after the metallurgical quenching process — rapidly cooling hot metal simplifies its crystal structure and hardens it.

## Trigger
"Simplify this code" / "Reduce complexity" / "Clean up before review" / "Quench this module" / "Code is too complex"

## Steps

### 1. Measure Complexity
Use PHP-appropriate signals:

```bash
vendor/bin/phpstan analyse
vendor/bin/pint --test
grep -rn "public function\|private function\|protected function" app tests --include="*.php"
grep -rn "if\|elseif\|switch\|match\|catch" app --include="*.php" | wc -l
```

List the top candidates by:

- Methods over 50 lines
- Nesting deeper than 3 levels
- More than 4 positional constructor or method parameters
- Repeated validation, query, or resource mapping code
- Controllers that do more than delegate

If no candidates exceed thresholds, report "No simplification candidates found" and stop with PASS.

### 2. Understand First (Chesterton's Fence)
For each candidate:

1. Read surrounding tests and git blame.
2. Identify whether complexity protects tenant isolation, authorization, transactions, retries, or backward compatibility.
3. Document why the code exists and whether that reason still applies.

```markdown
| Method | Lines | Why Complex | Still Valid? | Action |
|--------|-------|-------------|--------------|--------|
| OrderService::create | 82 | Transaction plus provider fallback | Yes | Extract provider strategy, keep transaction |
| OrderResource::toArray | 64 | Repeated nested mapping | Partly | Extract value mappers |
```

### 3. Propose Simplifications
Common Laravel simplification patterns:

- Extract Form Request validation from controllers.
- Extract DTO creation to `toData()`.
- Move query clauses into repository methods or named scopes.
- Replace long `if` chains with policies, enum methods, or strategy classes.
- Split a large job into a coordinator job plus focused services.
- Extract API Resource helper methods for repeated nested shapes.

For each proposal, state behavior preserved and tests that prove it.

Stop for approval before editing.

### 4. Apply and Prove
For each approved simplification:

1. Apply exactly one simplification.
2. Run the narrow test first.
3. Run the relevant suite.
4. If tests fail, revert that simplification and report the failure.

```bash
php artisan test --filter={RelevantTest}
php artisan test
vendor/bin/phpstan analyse
vendor/bin/pint --test
```

### 5. Report
```text
Forge Quench Report:
  Target:             <files/directories>
  Candidates Found:   N
  Understood:         N
  Proposed:           N
  Approved:           N
  Applied:            N
  Reverted:           N
  Skipped:            N
  Tests:              PASS / FAIL
  Sweep:              N markers
```

## Safety Rules

- NEVER simplify code you do not understand.
- NEVER mix simplification with a feature or bug fix.
- ALWAYS run tests after each individual simplification.
- STOP and revert when behavior changes.
- NEVER remove tenant, authorization, transaction, retry, or error-mapping logic without proof it is obsolete.
- ALWAYS get user approval before applying proposals.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This controller can just call the model" | That bypasses Form Requests, services, policies, and repositories. |
| "This scope looks redundant" | Tenant scopes can look repetitive but protect data isolation. |
| "Move it to a helper" | Generic helpers often hide ownership. Prefer services, DTOs, policies, or resource methods. |
| "Tests pass, so delete the branch" | Tests may not cover the edge case the branch protected. Read blame and coverage first. |

## Warning Signs

- Complexity moved from a service into a controller.
- A simplification removes `DB::transaction()`.
- A job no longer sets `CurrentTenant`.
- A resource starts exposing model attributes directly.
- Multiple simplifications appear in one patch.

## Exit Proof

After completing this skill, confirm:

- [ ] Before/after complexity notes included
- [ ] Tests pass after each accepted simplification
- [ ] No behavior changes observed
- [ ] `forge_sweep` shows no new TODO/FIXME/HACK markers
- [ ] Intentionally complex code is documented

## Persistent Memory for Simplification

- **Before simplifying**: `search_thoughts("Laravel complexity", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")`
- **After simplifying**: `capture_thought("Laravel quench: <N simplified, N skipped, key reasons>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-forge-quench")`
