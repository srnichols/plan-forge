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
./mvnw test
```

### 2. Integration Tests
```bash
./mvnw verify -Pfailsafe
```

### 3. Architecture Tests (if ArchUnit configured)
```bash
./mvnw test -Dtest="*ArchTest"
```

### 4. Coverage
```bash
./mvnw test jacoco:report
# Report at: target/site/jacoco/index.html
```

### 5. Report
```
✅ Unit:        X passed, Y failed, Z skipped
✅ Integration: X passed, Y failed, Z skipped
✅ Arch:        X passed, Y failed, Z skipped
✅ Coverage:    XX%
──────────────────────────────────────────────
Total:          X passed, Y failed, Z skipped
```

## On Failure
- Show failed test names from `target/surefire-reports/`
- Read the failing test source to diagnose
- Suggest fixes (ask before applying)

## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries
