---
description: Caching patterns for Java — Spring Cache, Redis, Caffeine, @Cacheable, TTL strategies
applyTo: '**/*Cache*.java,**/*Caching*.java,**/service/**,**/config/**'
---

# Java Caching Patterns

## Cache Strategy

### Spring Cache Abstraction (Default)
```java
@Service
public class ProducerService {

    @Cacheable(value = "producers", key = "#id")
    public Producer getById(String id) {
        return producerRepository.findById(id)
            .orElseThrow(() -> new NotFoundException("Producer not found: " + id));
    }

    @CacheEvict(value = "producers", key = "#producer.id")
    public Producer update(Producer producer) {
        return producerRepository.save(producer);
    }

    @CacheEvict(value = "producers", allEntries = true)
    public void refreshAll() {
        // Clears entire producers cache
    }
}
```

### Redis Cache Configuration
```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(15))
            .serializeValuesWith(
                SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer()));

        Map<String, RedisCacheConfiguration> perCache = Map.of(
            "producers", defaults.entryTtl(Duration.ofMinutes(15)),
            "config", defaults.entryTtl(Duration.ofHours(1)),
            "counts", defaults.entryTtl(Duration.ofMinutes(2))
        );

        return RedisCacheManager.builder(factory)
            .cacheDefaults(defaults)
            .withInitialCacheConfigurations(perCache)
            .build();
    }
}
```

### Caffeine Local Cache (Single-Instance Hot Cache)
```java
@Bean
public CaffeineCacheManager localCacheManager() {
    CaffeineCacheManager manager = new CaffeineCacheManager();
    manager.setCaffeine(Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(5))
        .recordStats());
    return manager;
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
```java
// Evict on write
@CacheEvict(value = "producers", key = "#producer.id")
public Producer update(Producer producer) { ... }

// Evict multiple caches
@Caching(evict = {
    @CacheEvict(value = "producers", key = "#id"),
    @CacheEvict(value = "producerLists", allEntries = true)
})
public void delete(String id) { ... }
```

## Anti-Patterns

```
❌ @Cacheable on private methods (Spring proxies only intercept public calls)
❌ Cache mutable entities (always cache DTOs/records)
❌ Self-invocation cache bypass (calling @Cacheable from same class skips proxy)
❌ Missing @EnableCaching (annotations silently do nothing)
❌ Cache without TTL (stale data forever)
❌ Store non-serializable objects in Redis cache
```
