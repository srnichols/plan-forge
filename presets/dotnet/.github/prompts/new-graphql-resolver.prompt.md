---
description: "Scaffold a Hot Chocolate GraphQL resolver with query, mutation, subscription, and DataLoader patterns."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a GraphQL resolver using Hot Chocolate with query, mutation, and DataLoader patterns.

## Required Pattern

### Query Resolver
```csharp
[QueryType]
public class {EntityName}Queries
{
    [UseProjection]
    [UseFiltering]
    [UseSorting]
    public IQueryable<{EntityName}> Get{EntityName}s(
        [Service] I{EntityName}Repository repository)
    {
        return repository.GetAll();
    }

    public async Task<{EntityName}?> Get{EntityName}ById(
        Guid id,
        [Service] I{EntityName}Repository repository,
        CancellationToken ct)
    {
        return await repository.GetByIdAsync(id, ct);
    }
}
```

### Mutation Resolver
```csharp
[MutationType]
public class {EntityName}Mutations
{
    public async Task<{EntityName}> Create{EntityName}(
        Create{EntityName}Input input,
        [Service] I{EntityName}Service service,
        CancellationToken ct)
    {
        return await service.CreateAsync(input, ct);
    }

    public async Task<{EntityName}> Update{EntityName}(
        Guid id,
        Update{EntityName}Input input,
        [Service] I{EntityName}Service service,
        CancellationToken ct)
    {
        return await service.UpdateAsync(id, input, ct);
    }
}
```

### Input Types
```csharp
public record Create{EntityName}Input(
    [property: MaxLength(200)] string Name,
    string? Description);

public record Update{EntityName}Input(
    [property: MaxLength(200)] string Name,
    string? Description);
```

### DataLoader (N+1 Prevention)
```csharp
public class {EntityName}ByIdDataLoader : BatchDataLoader<Guid, {EntityName}>
{
    private readonly I{EntityName}Repository _repository;

    public {EntityName}ByIdDataLoader(
        I{EntityName}Repository repository,
        IBatchScheduler scheduler)
        : base(scheduler)
    {
        _repository = repository;
    }

    protected override async Task<IReadOnlyDictionary<Guid, {EntityName}>> LoadBatchAsync(
        IReadOnlyList<Guid> keys, CancellationToken ct)
    {
        var items = await _repository.GetByIdsAsync(keys, ct);
        return items.ToDictionary(x => x.Id);
    }
}

// Usage in a type extension
[ExtendObjectType(typeof(Order))]
public class OrderTypeExtension
{
    public async Task<{EntityName}?> Get{EntityName}(
        [Parent] Order order,
        {EntityName}ByIdDataLoader loader,
        CancellationToken ct)
    {
        return await loader.LoadAsync(order.{EntityName}Id, ct);
    }
}
```

### Registration
```csharp
builder.Services
    .AddGraphQLServer()
    .AddQueryType()
    .AddMutationType()
    .AddTypeExtension<OrderTypeExtension>()
    .AddDataLoader<{EntityName}ByIdDataLoader>()
    .AddFiltering()
    .AddSorting()
    .AddProjections();
```

## Rules

- ALWAYS use DataLoaders for related entity resolution — never query inside a field resolver
- ALWAYS use `CancellationToken` on all async resolver methods
- Input validation goes on input types using DataAnnotations or middleware
- Keep resolvers thin — delegate to services for business logic
- Use `[UseProjection]` to push field selection down to the database
- Keep resolvers in a `GraphQL/` folder organized by entity

## Reference Files

- [GraphQL patterns](../instructions/graphql.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
