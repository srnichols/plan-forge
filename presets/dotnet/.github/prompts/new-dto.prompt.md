---
description: "Scaffold request/response DTOs with records, validation attributes, and mapping from domain entities."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Data Transfer Object)

Scaffold request and response DTOs that separate API contracts from domain entities.

## Required Pattern

### Response DTO
```csharp
// Immutable record — returned from API endpoints
public record {EntityName}Dto(
    Guid Id,
    string Name,
    string Description,
    DateTime CreatedAt,
    DateTime UpdatedAt);
```

### Create Request DTO
```csharp
// Input validation via DataAnnotations or FluentValidation
public record Create{EntityName}Request(
    [Required, StringLength(200, MinimumLength = 1)]
    string Name,

    [StringLength(2000)]
    string? Description);
```

### Update Request DTO
```csharp
public record Update{EntityName}Request(
    [Required, StringLength(200, MinimumLength = 1)]
    string Name,

    [StringLength(2000)]
    string? Description);
```

### FluentValidation (Complex Rules)
```csharp
public class Create{EntityName}RequestValidator : AbstractValidator<Create{EntityName}Request>
{
    public Create{EntityName}RequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(200);

        RuleFor(x => x.Description)
            .MaximumLength(2000)
            .When(x => x.Description is not null);
    }
}
```

### Mapping (Manual or AutoMapper)
```csharp
// Prefer manual mapping for simple cases — explicit and debuggable
public static {EntityName}Dto ToDto(this {EntityName} entity) =>
    new(entity.Id, entity.Name, entity.Description, entity.CreatedAt, entity.UpdatedAt);

public static {EntityName} ToEntity(this Create{EntityName}Request request) =>
    new() { Name = request.Name, Description = request.Description };
```

## Paged Response Wrapper
```csharp
public record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount)
{
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrevious => Page > 1;
}
```

## Rules

- NEVER return domain entities directly from API endpoints
- NEVER accept domain entities as input — always use request DTOs
- Use `record` types for immutability
- Validate at the boundary using DataAnnotations or FluentValidation
- Keep DTOs in a separate `Models/` or `Contracts/` folder
- Map explicitly — avoid magic mapping for critical paths

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
