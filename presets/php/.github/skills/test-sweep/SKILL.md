---
name: test-sweep
description: Run Laravel test suites, static analysis, formatting checks, dependency audit, coverage, and completeness scan. Use after execution slices or before the Review Gate.
argument-hint: "[optional: specific test category to run]"
tools: [run_in_terminal, read_file, forge_sweep]
---

# Test Sweep Skill

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Unit Tests
```bash
php artisan test --testsuite=Unit
```

### Conditional: Unit Test Failure
> If unit tests fail, skip slower suites and go directly to Report.

### 2. Feature Tests
```bash
php artisan test --testsuite=Feature
```

### 3. Integration Tests
```bash
php artisan test --group=integration
```

Verify Docker Desktop before running Testcontainers-backed tests.

### 4. Static Analysis and Formatting
```bash
vendor/bin/phpstan analyse
vendor/bin/pint --test
```

### 5. Dependency and Migration Checks
```bash
composer audit
php artisan migrate --pretend
php artisan migrate:status
```

### 6. Coverage
```bash
php artisan test --coverage --min=80
```

### 7. Completeness Scan
Use `forge_sweep` to scan for TODO, FIXME, HACK, stub, placeholder, and mock-data markers.

### 8. Report
```text
Unit:        X passed, Y failed, Z skipped
Feature:     X passed, Y failed, Z skipped
Integration: X passed, Y failed, Z skipped
PHPStan:     PASS / FAIL
Pint:        PASS / FAIL
Audit:       PASS / FAIL
Coverage:    XX%
Sweep:       N markers
Total:       X passed, Y failed, Z skipped
```

## On Failure

- Show failing test names and assertion messages.
- Read the failing test source and source under test.
- Identify whether the issue is fixture data, tenant context, policy, validation, database, queue fake, or external HTTP fake.
- Suggest fixes and ask before applying them.

## Safety Rules

- NEVER hide skipped, risky, or incomplete PHPUnit tests.
- NEVER replace failing PostgreSQL integration tests with SQLite.
- ALWAYS include exact commands and results in the final report.
- Stop before destructive database changes.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Feature tests cover unit tests" | Unit tests isolate business rules and fail faster. |
| "Coverage can drop for now" | Coverage drops are hard to recover and usually mean untested behavior shipped. |
| "Composer audit is unrelated" | Vulnerable dependencies are release blockers for web applications. |
| "Migration preview is not a test" | Bad migrations fail deployments even when PHPUnit is green. |

## Warning Signs

- Tests pass only when run in a specific order.
- Fakes are asserted after the real event was already dispatched.
- Coverage command is omitted for new service logic.
- `migrate --pretend` fails but deploy proceeds.
- `forge_sweep` finds TODO/FIXME markers in production paths.

## Exit Proof

After completing this skill, confirm:

- [ ] Unit, feature, and integration suites executed or explicitly blocked
- [ ] Static analysis and Pint results included
- [ ] Composer audit result included
- [ ] Coverage result included
- [ ] `forge_sweep` result included

## Persistent Memory for Test Sweeps

- **Before running tests**: `search_thoughts("Laravel test failures", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After test sweep**: `capture_thought("Laravel test sweep: <N passed, N failed, key failures>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-test-sweep")`
