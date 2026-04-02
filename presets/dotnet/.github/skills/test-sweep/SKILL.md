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
dotnet test --filter "Category=Unit" --logger "console;verbosity=normal" --results-directory TestResults/
```

### 2. Integration Tests
```bash
dotnet test --filter "Category=Integration" --logger "console;verbosity=normal" --results-directory TestResults/
```

### 3. API / GraphQL Tests
```bash
dotnet test --filter "Category=Api|Category=GraphQL" --logger "console;verbosity=normal" --results-directory TestResults/
```

### 4. E2E Tests (if available)
```bash
dotnet test --filter "Category=E2E" --logger "console;verbosity=normal" --results-directory TestResults/
```

### 5. Report
Aggregate results:
```
✅ Unit:        X passed, Y failed, Z skipped
✅ Integration: X passed, Y failed, Z skipped
✅ API:         X passed, Y failed, Z skipped
✅ E2E:         X passed, Y failed, Z skipped
──────────────────────────────────────────────
Total:          X passed, Y failed, Z skipped
```

## On Failure
- Show failed test names and error messages
- Read the failing test source to diagnose
- Suggest fixes (ask before applying)

## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries
