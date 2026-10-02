---
description: Caching patterns for Swift — Vapor Redis, actor-isolated in-process caches, cache-aside, TTL strategies
applyTo: '**/*.swift,Package.swift'
---

# Swift Caching Patterns

## Cache Strategy

### Cache-Aside Pattern (Default)
```swift
import Foundation
import Vapor

struct ProducerResponse: Content, Sendable {
    let id: UUID
    let name: String
}

protocol ProducerRepository: Sendable {
    func find(id: UUID, tenantID: UUID, on db: Database) async throws -> ProducerResponse?
    func save(_ producer: ProducerResponse, tenantID: UUID, on db: Database) async throws
}

struct ProducerService: Sendable {
    let repository: ProducerRepository
    let logger: Logger

    func getByID(_ id: UUID, tenantID: UUID, req: Request) async throws -> ProducerResponse? {
        let cacheKey = RedisKey(CacheKey.producer(id: id, tenantID: tenantID))

        do {
            if let cached = try await req.redis.get(cacheKey, asJSON: ProducerResponse.self).get() {
                return cached
            }
        } catch {
            logger.warning("Redis cache read failed", metadata: ["key": "\(cacheKey)", "error": "\(error)"])
        }

        guard let producer = try await repository.find(id: id, tenantID: tenantID, on: req.db) else {
            return nil
        }

        do {
            try await req.redis.setex(cacheKey, toJSON: producer, expirationInSeconds: 900).get()
        } catch {
            logger.warning("Redis cache write failed", metadata: ["key": "\(cacheKey)", "error": "\(error)"])
        }

        return producer
    }
}
```

### Redis Client Setup (vapor/redis 4.14)
```swift
import Redis
import Vapor

func configureRedis(_ app: Application) throws {
    let redisURL = Environment.get("REDIS_URL") ?? "redis://localhost:6379"
    app.redis.configuration = try RedisConfiguration(url: redisURL)
}
```

### In-Process Cache (Single-Instance)
```swift
import Foundation

actor ExpiringCache<Value: Sendable> {
    private struct Entry: Sendable {
        let value: Value
        let expiresAt: ContinuousClock.Instant
    }

    private let clock = ContinuousClock()
    private var entries: [String: Entry] = [:]
    private let maxEntries: Int

    init(maxEntries: Int = 1_000) {
        self.maxEntries = maxEntries
    }

    func value(forKey key: String) -> Value? {
        guard let entry = entries[key] else { return nil }
        guard entry.expiresAt > clock.now else {
            entries.removeValue(forKey: key)
            return nil
        }
        return entry.value
    }

    func set(_ value: Value, forKey key: String, ttl: Duration) {
        if entries.count >= maxEntries, let firstKey = entries.keys.first {
            entries.removeValue(forKey: firstKey)
        }
        entries[key] = Entry(value: value, expiresAt: clock.now.advanced(by: ttl))
    }

    func removeValue(forKey key: String) {
        entries.removeValue(forKey: key)
    }
}
```

### NSCache for Foundation Objects
```swift
import Foundation

final class ImageCache: @unchecked Sendable {
    private let cache = NSCache<NSString, NSData>()

    init(maxBytes: Int = 50 * 1024 * 1024) {
        cache.totalCostLimit = maxBytes
    }

    func data(forKey key: String) -> Data? {
        cache.object(forKey: key as NSString) as Data?
    }

    func set(_ data: Data, forKey key: String) {
        cache.setObject(data as NSData, forKey: key as NSString, cost: data.count)
    }
}
```

## Key Naming Convention

```
{service}:{tenantID}:{entity}:{id}        → myapp:tenant-123:producer:abc-123
{service}:{tenantID}:{entity}:list:{hash} → myapp:tenant-123:producers:list:active
{service}:{tenantID}:{entity}:count       → myapp:tenant-123:producers:count
```

```swift
enum CacheKey {
    static func producer(id: UUID, tenantID: UUID) -> String {
        "myapp:\(tenantID.uuidString):producer:\(id.uuidString)"
    }

    static func producerList(tenantID: UUID, queryHash: String) -> String {
        "myapp:\(tenantID.uuidString):producers:list:\(queryHash)"
    }
}
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
```swift
struct ProducerWriterService: Sendable {
    let repository: ProducerRepository

    func update(_ producer: ProducerResponse, tenantID: UUID, req: Request) async throws {
        try await repository.save(producer, tenantID: tenantID, on: req.db)
        _ = try await req.redis.delete(RedisKey(CacheKey.producer(id: producer.id, tenantID: tenantID))).get()
    }
}
```

## Multi-Tenant Caching

```swift
// ✅ ALWAYS include tenantID in cache keys — never share cache across tenants.
let key = CacheKey.producer(id: producerID, tenantID: tenantID)

// ✅ Invalidate within tenant scope only.
_ = try await req.redis.delete(RedisKey(key)).get()
```

## Anti-Patterns

```
❌ Shared Dictionary cache from multiple tasks — use an actor or NSCache
❌ Cache without TTL (stale data forever, memory leak)
❌ Force-unwrapping decoded cache values — treat cache as best-effort
❌ Cache user-specific data without tenant prefix in key
❌ Let Redis outage fail a read path that can fall through to Postgres
❌ Store non-Sendable mutable reference types in actor-isolated caches
```

## See Also

- `database.instructions.md` — Query optimization, connection pooling
- `performance.instructions.md` — NSCache, pre-built maps, allocation reduction
- `multi-environment.instructions.md` — Cache config per environment
