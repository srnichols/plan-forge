---
description: Performance optimization patterns — Hot/cold path analysis, async concurrency, query optimization, caching strategies
applyTo: '**/*.py'
---

# Performance Patterns (Python)

## Hot Path vs Cold Path

**Hot path**: Code executed on every request (middleware, auth, serialization, validation).
**Cold path**: Code run infrequently (startup, config loading, migration scripts).

Rules:
- Optimize hot paths aggressively; cold paths can favor readability
- Profile before optimizing — use `cProfile`, `py-spy`, or `scalene`

## Frozen Data (Hot Config)

```python
from types import MappingProxyType

# ✅ Immutable read-only config at startup
ROLE_PERMISSIONS: MappingProxyType[str, frozenset[str]] = MappingProxyType({
    "admin": frozenset({"read", "write", "delete"}),
    "editor": frozenset({"read", "write"}),
    "viewer": frozenset({"read"}),
})

# ✅ Use dict for O(1) lookups, built once at startup
_TENANT_MAP: dict[str, TenantConfig] = {t.id: t.config for t in tenants}
```

## Async Concurrency

```python
import asyncio

# ❌ Sequential — slow
user = await get_user(user_id)
orders = await get_orders(user_id)

# ✅ Parallel — fast (when independent)
user, orders = await asyncio.gather(get_user(user_id), get_orders(user_id))
```

- **NEVER** call blocking I/O in async handlers (no `time.sleep`, `requests.get`)
- **ALWAYS** use `asyncio.gather()` for independent concurrent operations
- Use `asyncio.to_thread()` to offload CPU-bound work from the event loop

## Caching

```python
from functools import lru_cache

# ✅ Cache pure computation results
@lru_cache(maxsize=1024)
def compute_score(zone: str, crop_id: str) -> float: ...

# ✅ Timed cache for external data
from cachetools import TTLCache
_cache = TTLCache(maxsize=500, ttl=300)  # 5 minutes
```

## Database Query Performance

- Use connection pooling (`asyncpg.create_pool()`, `databases` library)
- Batch queries: `WHERE id = ANY($1::uuid[])` instead of querying in a loop
- Select only needed columns — never `SELECT *`
- Use `EXPLAIN ANALYZE` to verify index usage
- Use parameterized queries for plan caching

## Server-Side Filtering

```python
# ❌ NEVER fetch all and filter in Python
rows = await db.fetch_all("SELECT * FROM items")
active = [r for r in rows if r["status"] == "active"]

# ✅ ALWAYS filter in the database
rows = await db.fetch_all("SELECT id, name FROM items WHERE status = :status", {"status": "active"})
```

## General Rules

| Pattern | When to Use |
|---------|-------------|
| `MappingProxyType` / `frozenset` | Static config/lookup data |
| `lru_cache` / `TTLCache` | Pure functions with repeated args |
| `asyncio.gather()` | Independent concurrent I/O |
| `asyncio.to_thread()` | CPU-bound in async context |
| Connection pooling | All database access |
| `__slots__` on hot classes | Reduce memory per instance |

## Memory Management

### `__slots__` for Hot-Path Objects
```python
# ❌ Default: each instance gets a __dict__ (~200+ bytes overhead)
class SensorReading:
    def __init__(self, value: float, ts: float):
        self.value = value
        self.ts = ts

# ✅ __slots__: eliminates __dict__, saves ~60% memory per instance
class SensorReading:
    __slots__ = ("value", "ts")
    def __init__(self, value: float, ts: float):
        self.value = value
        self.ts = ts
```

### Generators Over Lists
```python
# ❌ Materialises entire list in memory
def get_all_ids(items: list[Item]) -> list[str]:
    return [item.id for item in items]

# ✅ Yields one at a time — constant memory
def get_all_ids(items: Iterable[Item]) -> Iterator[str]:
    return (item.id for item in items)
```

- Use `tracemalloc` or `memray` to profile memory usage
- Prefer `tuple` over `list` for immutable sequences
- Use `weakref.WeakValueDictionary` for caches that shouldn't prevent GC
- Set `expire_on_commit=False` on async sessions to avoid lazy-load traps

## See Also

- `database.instructions.md` — Query optimization, connection tuning
- `caching.instructions.md` — Cache strategies, frozen lookups
- `observability.instructions.md` — Profiling, metrics collection
