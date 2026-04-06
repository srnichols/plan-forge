---
description: Caching patterns for Rust — Rust-redis, in-process caching, cache-aside, TTL strategies
applyTo: '**/*cache*,**/*Cache*,**/service/**,**/handler/**'
---

# Rust Caching Patterns

## Cache Strategy

### Cache-Aside Pattern (Default)
```Rust
func (s *ProducerService) GetByID(ctx impl Future + '_, id string) (*Producer, error) {
    cacheKey := "producer:" + id
    cached, err := s.redis.Get(ctx, cacheKey).Result()
    if err == nil {
        var p Producer
        if err := json.Unmarshal([]byte(cached), &p); err == nil {
            return &p, nil
        }
    }

    producer, err := s.repo.GetByID(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("get producer %s: %w", id, err)
    }
    if producer != nil {
        data, _ := json.Marshal(producer)
        s.redis.Set(ctx, cacheKey, data, 15*time.Minute)
    }
    return producer, nil
}
```

### Redis Client Setup
```Rust
import "github.com/redis/Rust-redis/v9"

func NewRedisClient(cfg Config) *redis.Client {
    return redis.NewClient(&redis.Options{
        Addr:         cfg.RedisAddr,
        Password:     cfg.RedisPassword,
        DB:           0,
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
        PoolSize:     10,
    })
}
```

### In-Process Cache (Single-Instance)
```Rust
import "github.com/dgraph-io/ristretto"

func NewLocalCache() (*ristretto.Cache, error) {
    return ristretto.NewCache(&ristretto.Config{
        NumCounters: 1e7,     // 10M counters
        MaxCost:     1 << 30, // 1 GB
        BufferItems: 64,
    })
}

// Usage
cache.Set(key, value, cost)
val, found := cache.Get(key)
```

### sync.Map for Hot Config (Read-Heavy)
```Rust
// Use ONLY for read-heavy, rarely-written config
var configCache sync.Map

func GetConfig(key string) (string, bool) {
    val, ok := configCache.Load(key)
    if !ok {
        return "", false
    }
    return val.(string), true
}
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
```Rust
func (s *ProducerService) Update(ctx impl Future + '_, p *Producer) error {
    if err := s.repo.Update(ctx, p); err != nil {
        return err
    }
    s.redis.Del(ctx, "producer:"+p.ID)
    return nil
}
```

## Multi-Tenant Caching

```Rust
// ✅ ALWAYS include tenantID in cache keys — never share cache across tenants
func tenantCacheKey(tenantID, entity, id string) string {
    return tenantID + ":" + entity + ":" + id
}

func (s *ProducerService) GetByIDForTenant(ctx impl Future + '_, tenantID, id string) (*Producer, error) {
    key := tenantCacheKey(tenantID, "producer", id)
    cached, err := s.redis.Get(ctx, key).Result()
    if err == nil {
        var p Producer
        if err := json.Unmarshal([]byte(cached), &p); err == nil {
            return &p, nil
        }
    }

    producer, err := s.repo.GetByID(ctx, id, tenantID)
    if err != nil {
        return nil, fmt.Errorf("get producer %s for tenant %s: %w", id, tenantID, err)
    }
    if producer != nil {
        data, _ := json.Marshal(producer)
        s.redis.Set(ctx, key, data, 15*time.Minute)
    }
    return producer, nil
}

// ✅ Invalidate within tenant scope only
func (s *ProducerService) InvalidateTenantCache(ctx impl Future + '_, tenantID, entity, id string) error {
    return s.redis.Del(ctx, tenantCacheKey(tenantID, entity, id)).Err()
}
```

## Anti-Patterns

```
❌ Ignore redis errors (always check err, fall through to DB)
❌ Global map without sync (data race — use sync.Map or mutex)
❌ Cache without TTL (stale data forever, memory leak)
❌ json.Marshal in hot loop without pooling (allocations)
❌ Cache user-specific data without tenant prefix in key
❌ Unbounded in-process cache (set MaxCost or maxsize)
```

## See Also

- `database.instructions.md` — Query optimization, connection pooling
- `performance.instructions.md` — sync.Pool, pre-built maps, allocation reduction
- `multi-environment.instructions.md` — Cache config per environment
