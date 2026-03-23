---
description: Caching patterns for TypeScript — Redis (ioredis), node-cache, cache-aside, TTL strategies
applyTo: '**/*cache*,**/*Cache*,**/services/**,**/middleware/**'
---

# TypeScript Caching Patterns

## Cache Strategy

### Cache-Aside Pattern (Default)
```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function getProducer(id: string): Promise<Producer | null> {
  const cacheKey = `producer:${id}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as Producer;

  const producer = await producerRepository.findById(id);
  if (producer) {
    await redis.set(cacheKey, JSON.stringify(producer), 'EX', 900); // 15 min
  }
  return producer;
}
```

### Redis Client Setup
```typescript
// lib/redis.ts
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  keyPrefix: 'myapp:',
  retryStrategy: (times) => Math.min(times * 50, 2000),
});
```

### In-Memory Cache (Single-Instance / Edge)
```typescript
import NodeCache from 'node-cache';

const localCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export function getCached<T>(key: string, fetcher: () => Promise<T>, ttl = 300): Promise<T> {
  const cached = localCache.get<T>(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return fetcher().then((value) => {
    localCache.set(key, value, ttl);
    return value;
  });
}
```

## Key Naming Convention
```
{service}:{entity}:{id}           → myapp:producer:abc-123
{service}:{entity}:list:{hash}    → myapp:producers:list:tenant-xyz
{service}:{entity}:count:{scope}  → myapp:producers:count:active
```

## TTL Strategy

| Data Type | TTL (seconds) | Rationale |
|-----------|---------------|-----------|
| User session | 1800 | Security, re-auth |
| Entity by ID | 900 | Balances freshness vs load |
| List/search results | 300 | Volatile, frequent changes |
| Config/reference data | 3600+ | Rarely changes |
| Count/aggregate | 120 | Must stay reasonably current |

## Cache Invalidation
```typescript
export async function updateProducer(producer: Producer): Promise<void> {
  await producerRepository.update(producer);
  await redis.del(`producer:${producer.id}`);
}
```

## Express Middleware Caching
```typescript
import { Request, Response, NextFunction } from 'express';

export function cacheMiddleware(ttl: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `route:${req.originalUrl}`;
    const cached = await redis.get(key);
    if (cached) return res.json(JSON.parse(cached));

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      redis.set(key, JSON.stringify(body), 'EX', ttl);
      return originalJson(body);
    };
    next();
  };
}
```

## Anti-Patterns

```
❌ Cache without TTL (stale data forever)
❌ Store non-serializable objects (class instances, functions)
❌ Ignore Redis connection errors (always add error handlers)
❌ Cache user-specific data without user/tenant key prefix
❌ Use cache as primary data store (always treat as ephemeral)
```

## See Also

- `database.instructions.md` — Query optimization, connection pooling
- `performance.instructions.md` — Frozen objects, hot-path lookups
- `multi-environment.instructions.md` — Cache config per environment
