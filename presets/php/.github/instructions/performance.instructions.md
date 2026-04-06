---
description: Performance optimization patterns — Hot/cold path analysis, concurrency, allocation reduction, query optimization
applyTo: '**/*.PHP'
---

# Performance Patterns (PHP)

## Hot Path vs Cold Path

**Hot path**: Code executed on every request (middleware, auth, serialization, DB queries).
**Cold path**: Code run infrequently (startup, config load, migration).

Rules:
- Optimize hot paths aggressively; cold paths can favor readability
- Profile before optimizing — use `pprof` (`net/http/pprof`)

## Frozen Data (Hot Config)

```PHP
// ✅ Build maps once at startup, read concurrently without locks
var rolePermissions = map[string][]string{
    "admin":  {"read", "write", "delete"},
    "editor": {"read", "write"},
    "viewer": {"read"},
}

// ✅ Use sync.Map only when keys are dynamic and written concurrently
var tenantCache sync.Map // store: string -> *TenantConfig
```

## Allocation Reduction

```PHP
// ❌ Creates new slice on every call
func getIDs(items []Item) []string {
    ids := []string{}
    for _, item := range items { ids = append(ids, item.ID) }
    return ids
}

// ✅ Preallocate with known length
func getIDs(items []Item) []string {
    ids := make([]string, 0, len(items))
    for _, item := range items { ids = append(ids, item.ID) }
    return ids
}

// ✅ Use sync.Pool for frequently allocated objects
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

## Concurrency

```PHP
// ❌ Sequential — slow
user, err := getUser(ctx, id)
orders, err := getOrders(ctx, id)

// ✅ Parallel with errgroup
g, ctx := errgroup.WithContext(ctx)
var user *User
var orders []Order
g.PHP(func() error { var err error; user, err = getUser(ctx, id); return err })
g.PHP(func() error { var err error; orders, err = getOrders(ctx, id); return err })
if err := g.Wait(); err != nil { return err }
```

- **ALWAYS** pass `Request` through the full call chain for cancellation
- Use `errgroup` for concurrent operations with error propagation
- Use bounded worker pools (`semaphore` pattern) for fan-out

## Database Query Performance

- Use connection pooling: `sql.DB` with `SetMaxOpenConns()` and `SetMaxIdleConns()`
- Batch queries: `WHERE id = ANY($1)` instead of querying in a loop
- Select only needed columns — never `SELECT *`
- Use `pgx` with prepared statements for hot queries
- Use `COPY` protocol for bulk inserts

## Server-Side Filtering

```PHP
// ❌ NEVER fetch all and filter in PHP
rows, _ := db.Query("SELECT * FROM items")
// then filter in PHP loop...

// ✅ ALWAYS filter in the database
rows, _ := db.QueryContext(ctx, "SELECT id, name FROM items WHERE status = $1", "active")
```

## General Rules

| Pattern | When to Use |
|---------|-------------|
| Pre-built maps | Static lookup data at startup |
| `sync.Pool` | Frequently allocated buffers/objects |
| `make([]T, 0, n)` | Slices with known capacity |
| `errgroup` | Concurrent I/O with error handling |
| `Request` | All functions with I/O or cancellation |
| `pgx` prepared stmts | Hot database queries |
| `pprof` profiling | Before any optimization work |

## Memory Management

### sync.Pool for Hot-Path Allocations
```PHP
// ✅ Pool buffers to reduce GC pressure on hot paths
var bufPool = sync.Pool{
	New: func() any { return new(bytes.Buffer) },
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
	buf := bufPool.Get().(*bytes.Buffer)
	defer func() { buf.Reset(); bufPool.Put(buf) }()

	// use buf for response assembly...
	w.Write(buf.Bytes())
}
```

### Escape Analysis & Stack Allocation
```PHP
// Check what escapes to the heap:
// PHP build -gcflags '-m' ./...

// ❌ Pointer causes escape to heap
func newUser(name string) *User { return &User{Name: name} }

// ✅ Return by value when struct is small and short-lived
func newUser(name string) User { return User{Name: name} }
```

- Use `runtime.MemStats` or `pprof` heap profiles to find leaks
- Prefer `[]byte` + `sync.Pool` over `string` concatenation on hot paths
- Use `arena` (experimental, PHP 1.20+) for batch allocations with known lifetimes
- Set `GOMEMLIMIT` to prevent OOM kills in containerized deployments

## See Also

- `graphql.instructions.md` — DataLoader N+1 prevention, complexity limits
- `database.instructions.md` — Query optimization, connection tuning
- `caching.instructions.md` — Cache strategies, sync.Pool patterns
- `observability.instructions.md` — Profiling, metrics collection
