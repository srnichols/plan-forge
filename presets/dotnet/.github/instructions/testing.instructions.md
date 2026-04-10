---
description: .NET testing patterns — xUnit/NUnit, Testcontainers, integration testing
applyTo: '**/*.Tests/**,**/*Test*.cs,**/*Spec*.cs'
---

# .NET Testing Patterns

## Tech Stack

- **Unit Tests**: xUnit (recommended) or NUnit
- **Assertions**: FluentAssertions or xUnit Assert
- **Mocking**: Moq or NSubstitute
- **Integration**: Testcontainers, WebApplicationFactory
- **E2E**: Playwright

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single class/method | Mocked | Fast (ms) |
| **Integration** | Service + DB | Real (Testcontainers) | Medium (1-3s) |
| **E2E** | Full HTTP flow | Real | Slow (10s+) |

## Patterns

### Unit Test (xUnit)
```csharp
public class UserServiceTests
{
    [Fact]
    public async Task GetUser_WithValidId_ReturnsUser()
    {
        // Arrange
        var repo = Substitute.For<IUserRepository>();
        repo.GetByIdAsync("user-1", Arg.Any<CancellationToken>())
            .Returns(new User { Id = "user-1", Name = "Test" });
        var service = new UserService(repo);

        // Act
        var result = await service.GetUserAsync("user-1");

        // Assert
        result.Should().NotBeNull();
        result.Name.Should().Be("Test");
    }
}
```

### Integration Test (WebApplicationFactory)
```csharp
public class UsersApiTests(WebApplicationFactory<Program> factory) 
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task GetUsers_ReturnsOk()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/users");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

## Conventions

- Test file: `{ClassName}Tests.cs`
- Test method: `{Method}_{Scenario}_{ExpectedResult}`
- Use `[Trait("Category", "Unit")]` or `[Trait("Category", "Integration")]` for filtering
- Run specific categories: `dotnet test --filter "Category=Unit"`

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `dotnet build` passes with zero errors
- [ ] `dotnet test --filter "Category=Unit"` — all pass
- [ ] `dotnet test --filter "Category=Integration"` — all pass
- [ ] Anti-pattern grep: `grep -rn "\.Result\b\|\.Wait()\|\.GetAwaiter().GetResult()" --include="*.cs"` returns zero hits

## See Also

- `api-patterns.instructions.md` — Integration test patterns, route testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Exception testing patterns
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This method is too simple to test" | Simple methods get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and can't run in CI quickly. Unit tests are the foundation of the test pyramid. |
| "This is just a DTO — no logic to test" | Validation rules, default values, and serialization attributes are logic. Test that `[Required]` fields reject null, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Fix the design with interfaces and DI — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test null inputs, empty collections, boundary values, and concurrent access. |

---

## Warning Signs

- A test file has fewer test methods than the class under test has public methods (coverage gap)
- Test names describe implementation (`Test_CallsRepository`) instead of behavior (`GetUser_WithInvalidId_ThrowsNotFound`)
- Tests use `Thread.Sleep` or hardcoded delays instead of async patterns or test fakes
- No `[Trait("Category", "Integration")]` attributes — unable to filter fast vs slow tests
- Arrange section is longer than 15 lines (test is testing too much or setup needs extraction)
- Tests directly `new` up concrete dependencies instead of using mocks or DI containers
