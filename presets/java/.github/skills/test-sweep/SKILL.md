---
name: test-sweep
description: Run all test suites (unit, integration, API, E2E) and aggregate results into a summary report. Use after completing execution slices or before the Review Gate.
argument-hint: "[optional: specific test category to run]"
tools: [run_in_terminal, read_file, forge_sweep]
---

# Test Sweep Skill

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Unit Tests
```bash
./mvnw test
```

### Conditional: Unit Test Failure
> If unit tests fail → skip integration/E2E tests, go directly to Report.

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

### 5. Completeness Scan
Use the `forge_sweep` MCP tool to scan for TODO/FIXME/stub markers in the codebase.

### 6. Report
```
✅ Unit:        X passed, Y failed, Z skipped
✅ Integration: X passed, Y failed, Z skipped
✅ Arch:        X passed, Y failed, Z skipped
✅ Coverage:    XX%
✅ Sweep:       N markers (TODO/FIXME/stub)
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
