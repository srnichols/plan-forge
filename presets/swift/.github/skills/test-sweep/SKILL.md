---
name: test-sweep
description: Run all test suites (unit, integration, UI, E2E) and aggregate results into a summary report. Use after completing execution slices or before the Review Gate.
argument-hint: "[optional: specific test category to run]"
tools: [run_in_terminal, read_file, forge_sweep]
---

# Test Sweep Skill (Swift)

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Unit Tests
```bash
swift test --filter UnitTests 2>&1 | tee TestResults/unit.txt
# Or if no tags, run all unit tests (SPM target)
swift test 2>&1 | tee TestResults/unit.txt
```

### Conditional: Unit Test Failure
> If unit tests fail → skip integration/UI/E2E tests, Swift directly to Report.

### 2. Integration Tests (Vapor — requires database)
```bash
# Requires database running (Docker or local)
swift test --filter IntegrationTests 2>&1 | tee TestResults/integration.txt
```
> **If database not running**: `docker compose up -d db` then retry.

### 3. Xcode Unit + Integration Tests (iOS/macOS)
```bash
xcodebuild test \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  2>&1 | tee TestResults/xcode.txt
```

### 4. UI Tests with XCUITest (if available)
```bash
xcodebuild test \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:MyAppUITests \
  2>&1 | tee TestResults/ui.txt
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
✅ Unit:         X passed, Y failed
✅ Integration:  X passed, Y failed
✅ UI Tests:     X passed, Y failed
✅ Thread Sanitizer: No races detected
✅ Sweep:        N markers (TODO/FIXME/stub)
──────────────────────────────────────
Total:           X passed, Y failed
```

## On Failure
- Show failed test names and error messages
- Read the failing test source to diagnose
- Check for `XCTUnwrap` failures — may indicate unexpected nil
- Check for async timing issues — increase `expectation.fulfill()` wait time
- Suggest fixes (ask before applying)

## Persistent Memory (if OpenBrain is configured)

- **Before running tests**: `search_thoughts("test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load known flaky tests, recurring failures, and environment-specific issues
- **After test sweep**: `capture_thought("Test sweep: <N passed, N failed — key failure patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")` — persist failure patterns and flaky test discoveries
