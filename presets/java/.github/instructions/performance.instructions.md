---
description: Performance optimization patterns — Hot/cold path analysis, JVM tuning hints, query optimization, caching strategies
applyTo: '**/*.java'
---

# Performance Patterns (Java/Spring Boot)

## Hot Path vs Cold Path

**Hot path**: Code executed on every request (filters, serialization, validation, DB queries).
**Cold path**: Code run infrequently (startup, bean init, schema migration).

Rules:
- Optimize hot paths aggressively; cold paths can favor readability
- Profile before optimizing — use JFR (Java Flight Recorder) or VisualVM

## Immutable Lookups (Hot Config)

```java
// ✅ Use unmodifiable maps for static config loaded at startup
private static final Map<String, Set<String>> ROLE_PERMISSIONS = Map.ofEntries(
    Map.entry("admin", Set.of("read", "write", "delete")),
    Map.entry("editor", Set.of("read", "write")),
    Map.entry("viewer", Set.of("read"))
);

// ✅ Use ConcurrentHashMap for hot caches that evolve
private final ConcurrentHashMap<String, TenantConfig> tenantCache = new ConcurrentHashMap<>();
```

## Spring Caching

```java
// ✅ Cache frequently-read, rarely-changed data
@Cacheable(value = "tenants", key = "#tenantId")
public TenantConfig getTenantConfig(String tenantId) { ... }

// ✅ Invalidate on writes
@CacheEvict(value = "tenants", key = "#tenantId")
public void updateTenantConfig(String tenantId, TenantConfig config) { ... }
```

## Async & Concurrency

```java
// ❌ Sequential — slow
var user = userService.getById(userId);
var orders = orderService.getByUserId(userId);

// ✅ Parallel with virtual threads (Java 21+)
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var userTask = scope.fork(() -> userService.getById(userId));
    var ordersTask = scope.fork(() -> orderService.getByUserId(userId));
    scope.join().throwIfFailed();
    return new UserWithOrders(userTask.get(), ordersTask.get());
}
```

- Use `@Async` with a bounded thread pool for fire-and-forget work
- Use virtual threads (Java 21+) for high-concurrency I/O
- Avoid `synchronized` blocks on hot paths — use lock-free structures

## Database Query Performance

- Use HikariCP connection pooling (default in Spring Boot)
- Batch queries: `WHERE id IN (:ids)` instead of querying in a loop
- Select only needed columns — never `SELECT *`
- Use `@Query` with projections or DTOs for read paths
- Enable query logging in dev: `spring.jpa.show-sql=true`

## Server-Side Filtering

```java
// ❌ NEVER fetch all and filter in Java
List<Item> allItems = repository.findAll();
List<Item> active = allItems.stream().filter(i -> "active".equals(i.getStatus())).toList();

// ✅ ALWAYS filter in the database
List<Item> active = repository.findByStatus("active");
```

## General Rules

| Pattern | When to Use |
|---------|-------------|
| `Map.of()` / `Set.of()` | Static immutable config |
| `@Cacheable` / Caffeine | Frequently-read data |
| Virtual threads | High-concurrency I/O handlers |
| HikariCP tuning | Match pool size to load |
| DTO projections | Read-only query paths |
| `record` types | Immutable DTOs (less GC pressure) |

## Memory Management

### Record Types for GC Reduction
```java
// ✅ Records are compact, immutable, and ideal for short-lived DTOs
public record UserSummary(UUID id, String name, String email) {}

// ✅ Return records from queries instead of full entities
@Query("SELECT new com.example.dto.UserSummary(u.id, u.name, u.email) FROM User u WHERE u.tenantId = :tenantId")
List<UserSummary> findSummariesByTenant(@Param("tenantId") String tenantId);
```

### JVM & GC Tuning Hints
```
# G1GC (default Java 17+) — good for most workloads
-XX:+UseG1GC -XX:MaxGCPauseMillis=200

# ZGC — sub-millisecond pauses (Java 21+, large heaps)
-XX:+UseZGC -XX:+ZGenerational

# Escape Analysis — keep short-lived objects on stack (enabled by default)
# Verify with: -XX:+PrintEscapeAnalysis (debug builds)
```

- Use `jcmd <pid> GC.heap_info` to monitor heap usage
- Prefer `List.of()` / `Map.of()` for small immutable collections (no backing array resize)
- Use `byte[]` / `ByteBuffer` pooling for I/O-heavy services
- Profile with JFR: `java -XX:StartFlightRecording=filename=recording.jfr`

## See Also

- `database.instructions.md` — Query optimization, connection tuning
- `caching.instructions.md` — Cache strategies, @Cacheable patterns
- `observability.instructions.md` — Profiling, metrics collection
