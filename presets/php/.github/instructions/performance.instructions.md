---
description: PHP/Laravel performance patterns — profiling, query budgets, indexes, OPcache, memory-safe batches, and Octane cautions
applyTo: 'app/**/*.php,config/{app,cache,database,octane,opcache}.php,routes/**/*.php,tests/**/*Performance*.php,tests/Feature/**/*.php'
---

# PHP Performance Patterns

## Hot Path vs Cold Path

**Hot path**: middleware, authentication, route model binding, Form Requests, repositories, API Resources, serialization, and cache lookups.
**Cold path**: migrations, config loading, deployment scripts, seeders, and one-off maintenance commands.

Rules:

- Profile before optimizing. Use Laravel Telescope or Debugbar in development, and OpenTelemetry/APM spans in production.
- Set explicit query-count budgets for API endpoints that return collections.
- Move slow external work to queues when the caller does not need the result synchronously.
- Keep tenant, authorization, and validation checks in the path even when optimizing.

## Profiling

```php
declare(strict_types=1);

namespace App\Providers;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;

final class QueryProfileServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        if (! app()->isLocal()) {
            return;
        }

        DB::listen(function (QueryExecuted $query): void {
            Log::debug('sql.query', [
                'time_ms' => $query->time,
                'sql' => $query->toRawSql(),
            ]);
        });
    }
}
```

Use Telescope/Debugbar for local query traces and request timelines. In production, emit OpenTelemetry spans or APM transactions without logging SQL values that may contain sensitive data.

## Query Count Budgets

```php
declare(strict_types=1);

namespace Tests\Feature\Api;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase as RefreshesSchema;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class ProductIndexPerformanceTest extends TestCase
{
    use RefreshesSchema;

    public function test_index_stays_under_query_budget(): void
    {
        $queries = 0;
        DB::listen(function (QueryExecuted $event) use (&$queries): void {
            $queries++;
        });

        $this->actingAs($this->tenantUser())->getJson('/api/v1/products')->assertOk();

        $this->assertLessThanOrEqual(6, $queries);
    }
}
```

Budgets should include authorization and tenant-scope queries. Raise a budget only with evidence from a profiler or an intentional feature change.

## Eloquent Efficiency

```php
declare(strict_types=1);

use App\Models\Product;

function productPage(string $tenantId): \Illuminate\Contracts\Pagination\CursorPaginator
{
    return Product::query()
        ->select(['id', 'tenant_id', 'category_id', 'name', 'price_cents', 'created_at'])
        ->with(['category:id,name'])
        ->where('tenant_id', $tenantId)
        ->orderByDesc('created_at')
        ->orderByDesc('id')
        ->cursorPaginate(50);
}
```

- Select only the columns the response needs.
- Eager-load relations in the repository; do not rely on API Resources to trigger queries.
- Use cursor pagination with a unique order for large API lists.
- Batch imports with `upsert()` and maintenance jobs with `chunkById()` or `lazyById()`.

## Indexes and EXPLAIN

Every new list endpoint should name the supporting index and verify it with `EXPLAIN (ANALYZE, BUFFERS)` against representative data.

```sql
CREATE INDEX CONCURRENTLY idx_products_tenant_created_id
    ON products (tenant_id, created_at DESC, id DESC);

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM products
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Use concurrent index creation for PostgreSQL production migrations when the table is large and the operation can run outside a transaction.

## Cache and Queue Choices

| Workload | Preferred tool | Notes |
|----------|----------------|-------|
| Frequently-read DTO | Redis cache-aside | TTL plus domain-event invalidation |
| Expensive aggregate | `Cache::flexible()` | Serve stale data briefly while rebuilding |
| Slow outbound call | Queue job | Persist tenant id in payload and set `CurrentTenant` in `handle()` |
| Large export | `lazyById()` + streamed response or job | Avoid holding all models in memory |
| Periodic calculation | Scheduled command | Store results in a read model or cache |

## OPcache and JIT

OPcache is built into PHP 8.5; do not install it as an extension. Production containers should enable OPcache and preload only code that is safe for the deployment model.

```ini
opcache.enable=1
opcache.enable_cli=0
opcache.validate_timestamps=0
opcache.memory_consumption=256
opcache.interned_strings_buffer=32
opcache.max_accelerated_files=32531
opcache.jit=tracing
opcache.jit_buffer_size=64M
```

Benchmark JIT before enabling it for web traffic. Many Laravel apps are I/O-bound and gain more from query reduction, cache hits, and optimized autoloading than from JIT.

## Octane Caveats

Octane can improve request throughput, but long-lived workers change Laravel's lifecycle assumptions.

- Do not store request, tenant, user, or correlation ids in static properties.
- Reset scoped services between requests; confirm `CurrentTenant` does not leak.
- Avoid keeping mutable Eloquent models on singleton services.
- Re-test cache, queue, and database reconnection behavior under worker reloads.

## General Rules

| Pattern | When to Use |
|---------|-------------|
| Telescope/Debugbar | Development profiling and query timeline inspection |
| OpenTelemetry/APM | Production traces, spans, and latency percentiles |
| DTO projections | Read-heavy endpoints that do not need full models |
| `chunkById()` | Maintenance updates over many rows |
| `upsert()` | Idempotent bulk imports |
| Redis locks | Single-flight rebuild of expensive cached values |

## Warning Signs

- `foreach` loop that runs a query per row.
- API Resource accesses a relation not eager-loaded by the repository.
- Endpoint fetches all rows and filters in PHP.
- Missing composite index for tenant filter plus sort order.
- Query budgets absent for high-traffic list endpoints.
- OPcache disabled in production containers.
- Octane introduced without tests for singleton state leakage.
