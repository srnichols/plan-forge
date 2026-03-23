---
description: Performance optimization patterns — Hot/cold path analysis, memory management, async patterns, query optimization
applyTo: '**/*.{ts,tsx}'
---

# Performance Patterns (TypeScript/Node.js)

## Hot Path vs Cold Path

**Hot path**: Code executed on every request (middleware, auth, serialization, validation).
**Cold path**: Code run infrequently (startup, config load, migration scripts).

Rules:
- Optimize hot paths aggressively; cold paths can favor readability
- Profile before optimizing — use Node.js `--inspect` and Chrome DevTools

## Frozen Objects (Hot Config)

```typescript
// ✅ Freeze read-only lookup data at startup
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['read', 'write', 'delete']),
  editor: Object.freeze(['read', 'write']),
  viewer: Object.freeze(['read']),
} as const);

// ✅ Use Map for O(1) lookups on hot paths
const tenantConfigMap = new Map(tenants.map(t => [t.id, t.config]));
```

## Async Best Practices

- **NEVER** mix sync and async (no `fs.readFileSync` in request handlers)
- **ALWAYS** use `Promise.all()` for independent concurrent operations
- **AVOID** creating promises in loops — batch instead
- Use `AbortController` / `AbortSignal` for cancellation

```typescript
// ❌ Sequential — slow
const user = await getUser(id);
const orders = await getOrders(id);

// ✅ Parallel — fast (when independent)
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```

## Memory & GC

- Avoid large closures that retain references to request objects
- Use `WeakRef` / `WeakMap` for caches that shouldn't prevent GC
- Stream large responses instead of buffering: `res.write()` chunks
- Limit JSON body parsing size: `express.json({ limit: '1mb' })`

## Database Query Performance

- Use connection pooling (pool size = `os.cpus().length * 2`)
- Batch queries: `WHERE id = ANY($1)` instead of querying in a loop
- Select only needed columns — never `SELECT *`
- Use `EXPLAIN ANALYZE` to verify index usage
- Add `.lean()` in Mongoose or use raw queries for read-heavy paths

## Server-Side Filtering

```typescript
// ❌ NEVER fetch all records and filter in JS
const items = await db.query('SELECT * FROM items');
return items.filter(i => i.status === 'active');

// ✅ ALWAYS filter in the database
const items = await db.query('SELECT id, name FROM items WHERE status = $1', ['active']);
```

## General Rules

| Pattern | When to Use |
|---------|-------------|
| `Object.freeze()` | Static config/lookup data |
| `Map` over plain object | Hot-path key lookups |
| `Promise.all()` | Independent concurrent operations |
| Streaming responses | Large payloads (>1MB) |
| Connection pooling | All database access |
| `AbortSignal` | Cancellable async operations |

## Memory Management

### WeakRef / WeakMap Caching
```typescript
// ✅ Cache that doesn't prevent garbage collection
const tenantCache = new WeakMap<object, TenantConfig>();

// ✅ WeakRef for expensive objects with manual expiry
const cache = new Map<string, WeakRef<ExpensiveResult>>();
function getCached(key: string): ExpensiveResult | undefined {
  const ref = cache.get(key);
  const val = ref?.deref();
  if (!val) cache.delete(key);
  return val;
}
```

### Streaming & Buffer Limits
```typescript
// ✅ Stream large responses instead of buffering
app.get('/export', (req, res) => {
  const stream = db.query('SELECT * FROM large_table').stream();
  stream.pipe(JSONStream.stringify()).pipe(res);
});

// ✅ Limit body parser to prevent OOM
app.use(express.json({ limit: '1mb' }));
```

- Avoid large closures that retain references to request objects
- Use `setImmediate()` to break up CPU-intensive synchronous work
- Monitor heap with `process.memoryUsage()` and `--max-old-space-size` flag

## See Also

- `database.instructions.md` — Query optimization, connection tuning
- `caching.instructions.md` — Cache strategies, frozen lookups
- `observability.instructions.md` — Profiling, metrics collection
