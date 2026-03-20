---
description: Caching patterns for .NET — IDistributedCache, Redis, in-memory, cache-aside, TTL strategies
applyTo: '**/*Cache*.cs,**/*Caching*.cs,**/Services/**,**/Program.cs'
---

# .NET Caching Patterns

## Cache Strategy

### Cache-Aside Pattern (Default)
```csharp
public async Task<Producer?> GetByIdAsync(string id, CancellationToken ct = default)
{
    string cacheKey = $"producer:{id}";
    var cached = await _cache.GetStringAsync(cacheKey, ct);
    if (cached is not null)
        return JsonSerializer.Deserialize<Producer>(cached);

    var producer = await _repository.GetByIdAsync(id, ct);
    if (producer is not null)
    {
        await _cache.SetStringAsync(cacheKey, JsonSerializer.Serialize(producer),
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15) }, ct);
    }
    return producer;
}
```

### Redis via IDistributedCache
```csharp
// Program.cs — Registration
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration.GetConnectionString("Redis");
    options.InstanceName = "myapp:";
});
```

### In-Memory Cache (Single-Instance Only)
```csharp
// Use for non-distributed scenarios or local hot cache
builder.Services.AddMemoryCache();

// Hot-path lookup tables — use FrozenDictionary
private static readonly FrozenDictionary<string, string> StatusMap =
    new Dictionary<string, string>
    {
        ["active"] = "Active",
        ["inactive"] = "Inactive",
    }.ToFrozenDictionary();
```

## Key Naming Convention
```
{service}:{entity}:{id}           → myapp:producer:abc-123
{service}:{entity}:list:{hash}    → myapp:producers:list:tenant-xyz
{service}:{entity}:count:{scope}  → myapp:producers:count:active
```

## TTL Strategy

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| User session | 30 min | Security, re-auth |
| Entity by ID | 15 min | Balances freshness vs load |
| List/search results | 5 min | Volatile, frequent changes |
| Config/reference data | 1 hr+ | Rarely changes |
| Count/aggregate | 2 min | Must stay reasonably current |

## Cache Invalidation
```csharp
// Invalidate on write
public async Task UpdateAsync(Producer producer, CancellationToken ct = default)
{
    await _repository.UpdateAsync(producer, ct);
    await _cache.RemoveAsync($"producer:{producer.Id}", ct);
    // Also invalidate list caches if needed
}
```

## Anti-Patterns

```
❌ Cache without TTL (stale data forever)
❌ Cache mutable objects by reference (in-memory)
❌ String concatenation for cache keys (use interpolation with prefix)
❌ Cache null results without short TTL (negative caching must expire fast)
❌ Sync-over-async cache access (.Result, .Wait())
```

## Multi-Tenant Caching
```csharp
// ALWAYS include tenant_id in cache keys
string cacheKey = $"{tenantId}:producer:{producerId}";
```
