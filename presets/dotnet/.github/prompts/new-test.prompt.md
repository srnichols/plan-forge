---
description: "Scaffold xUnit v3 test classes with Arrange-Act-Assert, mock setup, proper naming conventions, and trait categories."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test classes following project conventions.

## Test Naming Convention

```
{MethodUnderTest}_When{Condition}_Should{ExpectedBehavior}
```

Examples:
- `CreateProduct_WhenNameIsNull_ShouldThrowValidationException`
- `GetById_WhenNotFound_ShouldReturnNull`
- `CalculateTotal_WhenDiscountApplied_ShouldReturnReducedPrice`

## Unit Test Pattern

```csharp
public class {ClassName}Tests
{
    private readonly Mock<I{Dependency}> _mockDependency;
    private readonly {ClassUnderTest} _sut; // System Under Test

    public {ClassName}Tests()
    {
        _mockDependency = new Mock<I{Dependency}>();
        _sut = new {ClassUnderTest}(_mockDependency.Object, NullLogger<{ClassUnderTest}>.Instance);
    }

    [Fact]
    [Trait("Category", "Unit")]
    public async Task Method_WhenCondition_ShouldExpected()
    {
        // Arrange
        _mockDependency
            .Setup(x => x.GetAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new EntityDto { Id = Guid.NewGuid() });

        // Act
        var result = await _sut.MethodAsync(Guid.NewGuid(), CancellationToken.None);

        // Assert
        result.Should().NotBeNull();
    }
}
```

## Integration Test Pattern (Testcontainers)

```csharp
public class {ClassName}IntegrationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine")
        .Build();

    public async ValueTask InitializeAsync() => await _postgres.StartAsync();
    public async ValueTask DisposeAsync() => await _postgres.DisposeAsync();

    [Fact]
    [Trait("Category", "Integration")]
    public async Task Repository_WhenInserted_ShouldBeRetrievable()
    {
        // Arrange — real DB connection
        // Act — actual repository call
        // Assert — verify round-trip
    }
}
```

## Trait Categories

| Trait | When to Use |
|-------|------------|
| `[Trait("Category", "Unit")]` | Pure unit tests with mocks |
| `[Trait("Category", "Integration")]` | Tests hitting real DB |
| `[Trait("Category", "Smoke")]` | Fast subset for PR validation |

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
