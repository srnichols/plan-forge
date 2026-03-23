---
description: "Scaffold request/response records with Bean Validation, MapStruct mapping, and proper separation from JPA entities."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Data Transfer Object)

Scaffold request and response records that separate API contracts from JPA entities.

## Required Pattern

### Response DTO
```java
// Immutable record — returned from API endpoints
public record {EntityName}Response(
    UUID id,
    String name,
    String description,
    Instant createdAt,
    Instant updatedAt
) {}
```

### Create Request DTO
```java
public record Create{EntityName}Request(
    @NotBlank @Size(max = 200)
    String name,

    @Size(max = 2000)
    String description
) {}
```

### Update Request DTO
```java
public record Update{EntityName}Request(
    @NotBlank @Size(max = 200)
    String name,

    @Size(max = 2000)
    String description
) {}
```

### Custom Validation
```java
// Cross-field validation with class-level constraint
@ValidDateRange
public record CreateEventRequest(
    @NotBlank String name,
    @NotNull Instant startDate,
    @NotNull Instant endDate
) {}
```

### Mapping (Manual)
```java
public class {EntityName}Mapper {

    public static {EntityName}Response toResponse({EntityName} entity) {
        return new {EntityName}Response(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getCreatedAt(),
            entity.getUpdatedAt());
    }

    public static {EntityName} toEntity(Create{EntityName}Request request) {
        var entity = new {EntityName}();
        entity.setName(request.name());
        entity.setDescription(request.description());
        return entity;
    }
}
```

## Paged Response Wrapper
```java
public record PagedResult<T>(
    List<T> items,
    int page,
    int pageSize,
    long totalCount,
    int totalPages,
    boolean hasNext,
    boolean hasPrevious
) {
    public static <T> PagedResult<T> from(Page<T> springPage) {
        return new PagedResult<>(
            springPage.getContent(),
            springPage.getNumber() + 1,
            springPage.getSize(),
            springPage.getTotalElements(),
            springPage.getTotalPages(),
            springPage.hasNext(),
            springPage.hasPrevious());
    }
}
```

## Rules

- NEVER return JPA entities directly from controllers — always use response records
- NEVER accept JPA entities as input — always use request records
- Use `record` types for immutability (not classes)
- Validate at the boundary with `@Valid` + Bean Validation annotations
- Keep DTOs in a `dto/` package — separate from entities
- Use `@NotBlank` instead of `@NotNull` for strings (catches empty strings)

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
