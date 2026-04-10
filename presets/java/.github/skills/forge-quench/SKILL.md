---
name: forge-quench
description: "Systematically reduce Java code complexity while preserving exact behavior — measure, understand, propose, prove, report. Use after a feature is complete and tests pass, when code works but is harder to maintain than it should be."
argument-hint: "[optional: specific files or directories to simplify, e.g. 'src/main/java/services/' or 'src/main/java/services/OrderProcessor.java']"
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

Identify the most complex methods in the target files. Use Java-appropriate static analysis:

```bash
# Cyclomatic complexity via PMD
pmd check -d <target> -R rulesets/java/complexity.xml

# Count methods exceeding 50 lines
grep -rn "public\|private\|protected" <target> --include="*.java" | head -30

# Check inner class depth and method count per class
grep -rn "class " <target> --include="*.java" | wc -l

# Manual analysis: identify deep nesting, long switch statements, excessive branching
grep -rn "if\|else\|switch\|case\|catch" <target> --include="*.java" | wc -l
```

List the **top 3–5 most complex methods** by:
- Line count (methods >50 lines)
- Nesting depth (>3 levels of indentation)
- Branch count (>5 if/else/switch branches)
- Parameter count (>4 parameters)

> **If no methods exceed thresholds**: Report "No simplification candidates found" and STOP with a PASS.

### 2. Understand First (Chesterton's Fence)

**Before simplifying ANY code, document WHY the complexity exists.**

For each candidate function:
1. Read the git blame to find when and why it was written
2. Check if comments explain the reasoning
3. Look for edge cases the complexity handles (null checks, retry logic, fallback paths)
4. Document your understanding in a brief note

```markdown
| Function | Lines | Why Complex | Still Valid? | Action |
|----------|-------|-------------|-------------|--------|
| processOrder() | 87 | Handles 3 payment providers + retry | Yes — 3 providers still active | Simplify: extract per-provider strategies |
| validateInput() | 62 | Legacy regex for 5 country formats | Partially — 2 formats deprecated | Simplify: remove deprecated formats |
| buildReport() | 45 | Single function, low nesting | N/A — not complex enough | Skip |
```

> **If the reason is still valid and the complexity is necessary**: Leave it alone. Document WHY you're leaving it and move on. Not all complexity is bad.

### 3. Propose Simplifications

For each function marked "Simplify", propose a specific change:

**Common simplification patterns**:
- **Extract Method** — long function → smaller named functions
- **Replace Conditional with Polymorphism** — switch/if-else → strategy pattern or map lookup
- **Remove Dead Code** — unreachable branches, unused parameters, commented-out blocks
- **Flatten Nesting** — early returns instead of deep if/else chains
- **Simplify Boolean Logic** — De Morgan's laws, extract named predicates
- **Consolidate Duplicate Code** — repeated blocks → shared function (only if used 3+ times)

For each proposal:
- Show the **before** (current code)
- Show the **after** (proposed simplification)
- State the **rationale** (which pattern, why it's better)
- State what **behavior is preserved** (same inputs → same outputs)

> **STOP**: Do NOT apply changes yet. Present all proposals to the user for approval.

### 4. Apply and Prove (One at a Time)

For each approved simplification:

1. **Apply** the change to the file
2. **Run the full test suite** immediately (`./gradlew test` or `mvn test`)
3. **If tests pass**: Commit with a descriptive message:
   ```
   refactor(service): decompose OrderProcessor.processPayment
   
   Chesterton's Fence: <why the complexity existed>
   Simplification: <pattern applied>
   Behavior: unchanged — all N tests pass (`./gradlew test`)
   ```
4. **If tests FAIL**: Immediately revert the change. Do NOT fix the test — the failing test indicates the simplification changed behavior. Report the failure and move to the next candidate.

> **CRITICAL**: One simplification per commit. Never batch simplifications together.

### 5. Report

```
Forge Quench Report:
  Target:          <files/directories analyzed>
  
  Candidates Found:  N functions
  Understood:        N (Chesterton's Fence documented)
  Proposed:          N simplifications
  Approved:          N by user
  Applied:           N
  Reverted:          N (test failures)
  Skipped:           N (complexity still valid)

  Complexity Before: <metric>
  Complexity After:  <metric>
  Delta:             <reduction>

  Tests:  All passing / N failures (reverted)
  Sweep:  Zero new TODO/FIXME markers

  Overall: PASS (simplified) / PASS (no candidates) / PARTIAL (some reverted)
```

## Safety Rules

- NEVER simplify code you don't understand — always document the "why" first (Chesterton's Fence)
- NEVER combine simplification with feature changes — one concern per commit
- ALWAYS run tests after EACH simplification — not just at the end
- STOP if any test fails — revert the simplification, don't fix the test
- NEVER delete code that handles an edge case you haven't verified is obsolete
- ALWAYS get user approval before applying proposed simplifications

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This code is obviously redundant — just delete it" | Chesterton's Fence: understand before removing. It may handle an edge case you haven't seen. Check git blame and test coverage first. |
| "I'll simplify and add the feature at the same time" | Mixed commits make revert impossible. Simplify first, commit, then add the feature in a separate commit. |
| "The tests still pass so the simplification is safe" | Tests may not cover the behavior the complexity protected. Check coverage of the specific function before declaring safety. |
| "This whole class can be replaced with a utility function" | If it's used in multiple places, you're creating a God utility. Prefer targeted simplification that preserves clear ownership. |
| "I'll batch all the simplifications into one commit" | One commit per simplification. If a batch commit breaks tests, you can't tell which change caused it. Atomic commits enable atomic reverts. |

## Warning Signs

- Code deleted without checking git blame or documenting why it existed
- Multiple simplifications combined in a single commit
- Tests not run between individual simplifications
- Complexity "reduced" by moving it to a different file (shuffling, not simplifying)
- Functions renamed without updating all call sites and documentation
- Simplification introduced new TODO/FIXME markers ("I'll clean this up later")

## Exit Proof

After completing this skill, confirm:
- [ ] Complexity metrics reduced (paste before/after measurement)
- [ ] All tests pass after every simplification (paste final test output)
- [ ] No behavior changes — same inputs produce same outputs
- [ ] Each simplification committed separately with Chesterton's Fence rationale
- [ ] `forge_sweep` shows zero new TODO/FIXME/HACK markers introduced
- [ ] Functions that were complex for valid reasons are documented and left unchanged

## Persistent Memory (if OpenBrain is configured)

- **Before simplifying**: `search_thoughts("code complexity", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior simplification decisions, functions intentionally left complex, and patterns that worked
- **After simplifying**: `capture_thought("Forge Quench: <N functions simplified, N skipped — key changes>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-forge-quench")` — persist what was simplified and what was intentionally left complex for future sessions
