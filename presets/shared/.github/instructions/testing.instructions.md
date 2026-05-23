---
description: TypeScript testing patterns — Vitest/Jest, Supertest, integration testing
applyTo: '**/*.test.ts,**/*.spec.ts,**/tests/**,**/vitest.config.*,**/jest.config.*'
---

# TypeScript Testing Patterns

## Tech Stack

- **Test Runner**: Vitest (recommended) or Jest
- **API Testing**: Supertest
- **Mocking**: vi.mock (Vitest) or jest.mock, MSW for HTTP
- **E2E**: Playwright
- **Coverage**: v8 / istanbul

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single function/class | Mocked | Fast (ms) |
| **Integration** | Service + DB | Real (Docker) | Medium (1-3s) |
| **E2E** | Full user flows | Real (Docker) | Slow (10s+) |

## Patterns

### Unit Test (Vitest)
```typescript
import { describe, it, expect, vi } from 'vitest';
import { UserService } from './user.service';

describe('UserService', () => {
  it('should return user by ID', async () => {
    // Arrange
    const mockRepo = { findById: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }) };
    const service = new UserService(mockRepo);

    // Act
    const result = await service.getUser('1');

    // Assert
    expect(result).toBeDefined();
    expect(result.name).toBe('Test');
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });
});
```

### API Integration Test (Supertest)
```typescript
import request from 'supertest';
import { app } from '../app';

describe('GET /api/users', () => {
  it('should return 200 with user list', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${testToken}`)
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
  });
});
```

## Conventions

- Test file: `{module}.test.ts` or `{module}.spec.ts`
- Test name: `should {expected behavior} when {condition}`
- Collocate tests next to source, or use `__tests__/` directory
- Use `describe` blocks to group related tests

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `pnpm build` passes with zero errors
- [ ] `pnpm test -- --run` — all pass
- [ ] `pnpm lint` — no violations
- [ ] Anti-pattern grep: `grep -rn "as any\|@ts-ignore\|@ts-expect-error" --include="*.ts"` returns zero hits in new files

## See Also

- `api-patterns.instructions.md` — Integration test patterns, route testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Exception testing patterns
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple functions get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and can't run in CI quickly. Unit tests are the foundation of the test pyramid. |
| "This is just a type/interface — no logic to test" | Validation schemas, default values, and transform logic are testable behavior. Test that Zod schemas reject invalid input, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Fix the design with dependency injection — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test null inputs, empty arrays, boundary values, and async error paths. |

---

## Warning Signs

- A test file has fewer `it()` / `test()` blocks than the module under test has exported functions (coverage gap)
- Test names describe implementation (`test calls repository`) instead of behavior (`returns 404 when user not found`)
- Tests use `setTimeout` or hardcoded delays instead of `async/await` with proper assertions
- No test categorization — unable to filter unit vs integration vs e2e tests
- Arrange section is longer than 15 lines (test is testing too much or setup needs extraction)
- Tests import concrete implementations instead of using mocks or dependency injection
