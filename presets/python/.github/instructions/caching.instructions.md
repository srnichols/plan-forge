---
description: Caching patterns for Python — redis-py, cachetools, FastAPI cache, TTL strategies
applyTo: '**/*cache*,**/*Cache*,**/services/**,**/deps/**'
---

# Python Caching Patterns

## Cache Strategy

### Cache-Aside Pattern (Default)
```python
import redis
import json
from typing import Optional

r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

async def get_producer(producer_id: str) -> Optional[dict]:
    cache_key = f"producer:{producer_id}"
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    producer = await producer_repo.get_by_id(producer_id)
    if producer:
        r.setex(cache_key, 900, json.dumps(producer))  # 15 min
    return producer
```

### Redis Client Setup
```python
# core/cache.py
import redis

redis_client = redis.Redis.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=5,
    retry_on_timeout=True,
)
```

### In-Memory Cache (Single-Process)
```python
from functools import lru_cache
from cachetools import TTLCache

# Simple LRU (no expiry — use for pure functions)
@lru_cache(maxsize=256)
def parse_config(path: str) -> dict:
    ...

# TTL cache (thread-safe with lock)
from cachetools import cached, TTLCache
from threading import Lock

_cache = TTLCache(maxsize=1024, ttl=300)
_lock = Lock()

@cached(cache=_cache, lock=_lock)
def get_reference_data(key: str) -> dict:
    ...
```

### FastAPI Dependency Cache
```python
from fastapi import Depends, Request

async def get_cached_settings(request: Request) -> Settings:
    cache_key = "app:settings"
    cached = r.get(cache_key)
    if cached:
        return Settings.model_validate_json(cached)

    settings = await load_settings()
    r.setex(cache_key, 3600, settings.model_dump_json())
    return settings
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
```python
async def update_producer(producer: ProducerUpdate) -> None:
    await producer_repo.update(producer)
    r.delete(f"producer:{producer.id}")
```

## Anti-Patterns

```
❌ Cache without TTL (stale data forever)
❌ Pickle for cache serialization (security risk — use JSON)
❌ Ignore redis.ConnectionError (wrap in try/except, fall through to DB)
❌ Cache user-specific data without tenant/user key prefix
❌ Use global mutable dict as cache (no TTL, no size limit, memory leak)
```

## See Also

- `database.instructions.md` — Query optimization, connection pooling
- `performance.instructions.md` — lru_cache, TTLCache, frozen data
- `multi-environment.instructions.md` — Cache config per environment
