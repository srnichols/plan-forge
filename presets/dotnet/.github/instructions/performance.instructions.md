---
description: Performance optimization patterns — Hot/cold path analysis, frozen collections, source-generated patterns, async best practices
applyTo: '**/*.cs'
---

# Performance Patterns (.NET)

## Hot Path vs Cold Path

**Hot path**: Code executed on every request (middleware, auth, routing, serialization).
**Cold path**: Code run infrequently (startup, config reload, migration).

Rules:
- Optimize hot paths aggressively; cold paths can favor readability
- Profile before optimizing — don't guess

## Frozen Collections (Hot Config)

```csharp
// ✅ Use FrozenDictionary for read-heavy lookups (routing, config, tenant mapping)
private static readonly FrozenDictionary<string, TenantConfig> _tenantCache =
    tenants.ToFrozenDictionary(t => t.Id, t => t.Config);

// ✅ Use FrozenSet for membership checks
private static readonly FrozenSet<string> _validRoles =
    new[] { "Admin", "Editor", "Viewer" }.ToFrozenSet();
```

## Source-Generated Logging

```csharp
// ❌ NEVER on hot paths (allocates params array)
_logger.LogInformation("Processing request for tenant {TenantId}", tenantId);

// ✅ ALWAYS use source-generated (zero-alloc)
[LoggerMessage(Level = LogLevel.Information, Message = "Processing request for tenant {TenantId}")]
partial void LogProcessingRequest(string tenantId);
```

## Source-Generated Regex

```csharp
// ❌ NEVER compile at runtime
var regex = new Regex(@"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$");

// ✅ ALWAYS use source-generated
[GeneratedRegex(@"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")]
private static partial Regex EmailRegex();
```

## Async Best Practices

- **NEVER** use `.Result`, `.Wait()`, `.GetAwaiter().GetResult()` — causes thread pool starvation
- **ALWAYS** pass `CancellationToken` through the full call chain
- **AVOID** `Task.Run` to wrap synchronous code — keep sync methods sync
- Use `ValueTask<T>` for methods that often complete synchronously

## String Optimization

```csharp
// ❌ Excessive string allocations
string result = input.ToLower().Replace("-", "").Trim();

// ✅ Use Span<char> for hot paths
ReadOnlySpan<char> span = input.AsSpan().Trim();
```

## Database Performance

- Use `CreateReadOnlyConnectionAsync()` for SELECT queries (routes to read replicas)
- Batch queries with `WHERE id = ANY(@Ids)` instead of looping
- Select only needed columns — never `SELECT *`
- Add indexes for frequently filtered/sorted columns
- Use DataLoaders in GraphQL to prevent N+1

## General Rules

| Pattern | When to Use |
|---------|-------------|
| `FrozenDictionary` / `FrozenSet` | Static lookup data read on every request |
| `[LoggerMessage]` | Any logging on hot paths (>10 req/sec) |
| `[GeneratedRegex]` | All regex patterns |
| `Span<T>` / `ReadOnlySpan<T>` | String manipulation in tight loops |
| `ValueTask<T>` | Cache-first methods with sync fast-path |
| `ObjectPool<T>` | Expensive objects reused across requests |

## Memory Management

### ArrayPool / ObjectPool
```csharp
// ✅ Rent byte arrays instead of allocating
byte[] buffer = ArrayPool<byte>.Shared.Rent(4096);
try
{
    int bytesRead = await stream.ReadAsync(buffer, cancellationToken);
    // process buffer[..bytesRead]
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer);
}

// ✅ Pool expensive objects (e.g., StringBuilder) across requests
services.AddSingleton<ObjectPoolProvider, DefaultObjectPoolProvider>();
services.AddSingleton(sp =>
    sp.GetRequiredService<ObjectPoolProvider>().CreateStringBuilderPool());
```

### GC Pressure Reduction
```csharp
// ❌ Allocates on every call (closure captures)
var items = list.Where(x => x.TenantId == tenantId).ToList();

// ✅ Use struct enumerators with Span where possible
ReadOnlySpan<Item> span = CollectionsMarshal.AsSpan(list);
foreach (ref readonly var item in span)
{
    if (item.TenantId == tenantId) { /* process */ }
}
```

- Avoid `LINQ` on hot paths — use `for`/`foreach` with spans
- Use `stackalloc` for small, fixed-size buffers (<1 KB)
- Use `record struct` over `record class` for short-lived data on hot paths

## See Also

- `database.instructions.md` — Query optimization, connection tuning
- `caching.instructions.md` — Cache strategies, frozen lookups
- `observability.instructions.md` — Profiling, metrics collection
