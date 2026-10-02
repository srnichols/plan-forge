---
description: Testing patterns for any stack — test types, naming, isolation, test doubles, integration tests, validation gates
applyTo: '**/test/**,**/tests/**,**/__tests__/**,**/*.test.*,**/*.spec.*,**/*_test.*,**/*Test.*,**/*Tests.*'
---

# Testing Patterns

> Stack-neutral guidance. When a stack preset is installed, its own
> `testing.instructions.md` replaces this file with the stack's runner,
> libraries and commands.

## Test Types

| Type | Scope | Dependencies | Speed | Runs |
|------|-------|--------------|-------|------|
| **Unit** | One function, class or module | Test doubles for I/O | Milliseconds | Every change |
| **Integration** | Service + real database, cache or broker | Real (containers) | Seconds | Every change in CI |
| **Contract** | Request/response shape between services | Recorded or provider-verified | Seconds | Before releasing an API change |
| **End-to-end** | Full user flow through the deployed stack | Real | Tens of seconds | Critical paths only |

Keep the pyramid: many unit tests, fewer integration tests, a handful of end-to-end tests.

## Structure Every Test the Same Way

- **Arrange / Act / Assert** — three visible blocks; one behavior per test.
- **Name the behavior, not the implementation**: `returns 404 when the order does not exist`,
  not `test calls repository`.
- **One reason to fail** — if a test needs several unrelated assertions, it is several tests.
- **Deterministic** — no real clock, randomness, network or shared state without control:
  inject a clock, seed generators, and reset state between tests.
- **Independent** — tests pass in any order and in parallel; each creates the data it needs.

## Test Doubles

| Double | Use it for | Avoid |
|--------|-----------|-------|
| **Fake** (in-memory repository, fake clock) | Fast, realistic behavior in unit tests | Re-implementing complex systems such as SQL engines |
| **Stub** | Returning canned answers from a dependency | Asserting how often it was called |
| **Mock** | Verifying an interaction that *is* the behavior (an email was sent) | Verifying every internal call — that couples tests to the implementation |
| **Spy** | Recording calls on a real object | Production code paths in shared fixtures |

Mock at your architecture's boundaries (repositories, HTTP clients, message publishers), not
inside the module under test. If a dependency is hard to replace, inject it instead of skipping the test.

## Integration Tests

- Run against the same database engine and major version as production, started in a container
  (Testcontainers or Docker Compose) — never an in-memory substitute with different SQL semantics.
- Apply the real migrations before the suite; wrap each test in a transaction or truncate tables after it.
- Exercise the HTTP layer through the framework's in-process test client where one exists, so
  routing, validation, serialization and error mapping are covered without a network hop.
- Cover the failure paths: validation errors, not-found, conflicts, unauthorized and forbidden
  responses, and dependency timeouts.

## Test-Driven Development

1. **Red** — write a failing test that states the next behavior.
2. **Green** — write the simplest code that passes it.
3. **Refactor** — clean up with the test as a safety net.

For bug fixes, the first commit is a test that reproduces the bug and fails.

## Conventions

- Mirror the source tree in the test tree (or co-locate tests, if the stack's convention is to).
- Share setup through builders or factories, not through long fixture files edited by every test.
- Mark slow or external tests so CI can run unit tests on every push and the full suite before merge.
- Treat flaky tests as defects: fix or quarantine them with a tracked issue — never retry them silently.

## Validation Gates (for Plan Hardening)

```markdown
- [ ] The project's build command passes with zero errors and zero new warnings
- [ ] The full test suite passes; new behavior has new tests
- [ ] The linter and formatter report no violations
- [ ] No skipped, focused or disabled tests were added
```

## See Also

- `architecture-principles.instructions.md` — layering that keeps code testable
- `security.instructions.md` — security test cases for input validation and authorization

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple functions get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow and don't pinpoint failures. Unit tests are the foundation of the pyramid. |
| "Mocking this dependency is too complex" | If it's hard to replace, the design has too much coupling. Fix the design with dependency injection — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test empty inputs, boundary values, invalid input and error paths. |
| "The test is flaky, re-run it" | A flaky test hides real failures and trains the team to ignore red builds. Find the shared state, timing or ordering dependency. |

---

## Warning Signs

- Fewer tests than public behaviors in the module under test (coverage gap)
- Test names describe implementation (`calls repository`) instead of behavior (`returns 404 when user not found`)
- Fixed sleeps or delays instead of awaiting the condition under test
- Tests that only pass when run in a particular order or alone
- An Arrange section longer than about 15 lines (the test does too much, or setup needs a builder)
- Integration tests running against a different database engine than production
