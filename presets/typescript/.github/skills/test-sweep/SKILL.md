---
name: test-sweep
description: Run all test suites (unit, integration, API, E2E) and aggregate results into a summary report. Use after completing execution slices or before the Review Gate.
argument-hint: "[optional: specific test category to run]"
---

# Test Sweep Skill

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Unit Tests
```bash
npx vitest run --reporter=verbose
```

### 2. Integration Tests
```bash
npx vitest run --config vitest.integration.config.ts --reporter=verbose
```

### 3. E2E Tests (if available)
```bash
npx playwright test --reporter=list
```

### 4. Lint
```bash
npx eslint src/ --max-warnings=0
npx tsc --noEmit
```

### 5. Report
Aggregate results:
```
✅ Unit:        X passed, Y failed, Z skipped
✅ Integration: X passed, Y failed, Z skipped
✅ E2E:         X passed, Y failed, Z skipped
✅ Lint:        0 errors, 0 warnings
✅ TypeCheck:   No errors
──────────────────────────────────────────────
Total:          X passed, Y failed, Z skipped
```

## On Failure
- Show failed test names and error messages
- Read the failing test source to diagnose
- Suggest fixes (ask before applying)

## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<project>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<project>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries
