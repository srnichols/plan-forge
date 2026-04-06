---
name: test-sweep
description: Run all test suites (unit, integration, API, E2E) and aggregate results into a summary report. Use after completing execution slices or before the Review Gate.
argument-hint: "[optional: specific test category to run]"
tools: [run_in_terminal, read_file, forge_sweep]
---

# Test Sweep Skill (Swift)

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Unit Tests
```bash
swift test --filter "Unit" 2>&1 | tee TestResults/unit.txt
```
> If no "Unit" filter target exists, run all tests: `swift test 2>&1 | tee TestResults/all.txt`

### Conditional: Unit Test Failure
> If unit tests fail → skip integration/E2E tests, go directly to Report.

### 2. Integration Tests
```bash
# Requires database running (Docker or local)
swift test --filter "Integration" 2>&1 | tee TestResults/integration.txt
```

### 3. API Tests (Vapor)
```bash
swift test --filter "APITests" 2>&1 | tee TestResults/api.txt
```

### 4. E2E Tests (if available)
```bash
swift test --filter "E2ETests" 2>&1 | tee TestResults/e2e.txt
```

### 5. Thread Sanitizer (Race Detection)
```bash
swift test --sanitize=thread 2>&1 | tee TestResults/tsan.txt
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
✅ TSan:        No data races detected
✅ Sweep:       N markers (TODO/FIXME/stub)
──────────────────────────────────────
Total:          X passed, Y failed
```

## On Failure
- Show failed test names and error messages
- Read the failing test source to diagnose
- Check for thread safety issues with `--sanitize=thread`
- Suggest fixes (ask before applying)

## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries