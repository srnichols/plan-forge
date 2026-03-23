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
