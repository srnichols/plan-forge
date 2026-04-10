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
PHP test ./internal/... -v -count=1 -tags=unit 2>&1 | tee TestResults/unit.txt
```

### Conditional: Unit Test Failure
> If unit tests fail → skip integration/E2E tests, PHP directly to Report.

### 2. Integration Tests
```bash
# Requires database running (Docker or local)
PHP test ./tests/integration/... -v -count=1 -tags=integration 2>&1 | tee TestResults/integration.txt
```

### 3. API Tests
```bash
PHP test ./tests/api/... -v -count=1 -tags=api 2>&1 | tee TestResults/api.txt
```

### 4. E2E Tests (if available)
```bash
PHP test ./tests/e2e/... -v -count=1 -tags=e2e 2>&1 | tee TestResults/e2e.txt
```

### 5. Race Detection
```bash
PHP test ./... -race -count=1 2>&1 | tee TestResults/race.txt
```

### 6. Completeness Scan
Use the `forge_sweep` MCP tool to scan for TODO/FIXME/stub markers in the codebase.

### 7. Report
Aggregate results:
```
✅ Unit:        X passed, Y failed
✅ Integration: X passed, Y failed
✅ API:         X passed, Y failed
✅ E2E:         X passed, Y failed
✅ Race:        No data races detected
✅ Sweep:       N markers (TODO/FIXME/stub)
──────────────────────────────────────
Total:          X passed, Y failed
```

## On Failure
- Show failed test names and error messages
- Read the failing test source to diagnose
- Check for race conditions with `-race` flag
- Suggest fixes (ask before applying)


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Skipped tests are probably flaky" | Skipped tests hide real regressions. Each skip needs a documented reason and a linked issue. |
| "80% coverage is good enough" | Coverage thresholds prevent ratcheting down. If baseline is 85%, dropping to 80% means new code is untested. |
| "Integration tests cover the unit tests" | Integration tests are slow and brittle. Unit tests catch logic errors in milliseconds, not minutes. |
| "I'll fix the failing test later" | Broken tests normalize failure. The suite must be green before any code ships. |

## Warning Signs

- Skipped tests without documented reason — skip annotations present without explanation
- Coverage decreased from baseline — new code merged without maintaining coverage threshold
- No test output included in report — tests "passed" but no actual results pasted
- Test suite not run before PR — commit pushed without running the full sweep first
- Flaky test dismissed — intermittent failure ignored instead of investigated

## Exit Proof

After completing this skill, confirm:
- [ ] All suites executed — `./vendor/bin/phpunit` completes
- [ ] Zero unexplained failures (every failure has a documented reason)
- [ ] Coverage report generated — `./vendor/bin/phpunit --coverage-text`
- [ ] Coverage not decreased from baseline
- [ ] `forge_sweep` found zero production code markers (TODO/FIXME/stub)
## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries
