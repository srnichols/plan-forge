---
description: PHP/Laravel caching patterns — Redis 8 cache-aside, TTLs, locks, invalidation, tenant keys, and tests
applyTo: 'app/Services/**/*Cache*.php,app/Repositories/**/*.php,app/Listeners/**/*Cache*.php,config/cache.php,tests/**/*Cache*.php,tests/Feature/**/*Caching*.php'
---

# PHP Caching Patterns

## Cache Strategy

Use Redis 8 as the shared cache store for multi-process Laravel deployments. Apply cache-aside in the layer that owns the read model, cache arrays or scalar payloads by default, and set explicit TTLs. Laravel 13 sets `serializable_classes` to `false`, so cached DTO objects can hydrate as `__PHP_Incomplete_Class` unless the cache configuration explicitly allow-lists them.

### Cache-Aside Service

```php
declare(strict_types=1);

namespace App\Services;

use App\Repositories\Contracts\ProductRepository;
use Illuminate\Support\Facades\Cache;

final readonly class ProductLookupService
{
    public function __construct(private ProductRepository $products) {}

    public function summary(string $tenantId, string $productId): array
    {
        $key = $this->productSummaryKey($tenantId, $productId);

        return Cache::remember(
            $key,
            now()->addMinutes(15),
            fn (): array => $this->products->summaryForTenant($tenantId, $productId),
        );
    }

    public function forgetSummary(string $tenantId, string $productId): void
    {
        Cache::forget($this->productSummaryKey($tenantId, $productId));
    }

    private function productSummaryKey(string $tenantId, string $productId): string
    {
        return "tenant:{$tenantId}:product:{$productId}:summary:v1";
    }
}
```

Invalidation must remove the exact key written. If cache tags are enabled for the selected Redis store, flush the tag set that contains those keys; do not call `flush()` for an application-wide cache.

### Stampede Protection

Prefer `Cache::flexible()` for stale-while-revalidate reads where stale data is acceptable for a short window.

```php
declare(strict_types=1);

use App\Repositories\Contracts\CatalogRepository;
use Illuminate\Support\Facades\Cache;

function cachedCatalog(string $tenantId, CatalogRepository $catalog): array
{
    return Cache::flexible(
        "tenant:{$tenantId}:catalog:homepage:v3",
        [300, 900],
        fn (): array => $catalog->homepageForTenant($tenantId),
    );
}
```

Use locks when only one worker should rebuild an expensive value and callers can wait briefly.

```php
declare(strict_types=1);

use App\Repositories\Contracts\RevenueRepository;
use Illuminate\Support\Facades\Cache;

function monthlyRevenue(string $tenantId, RevenueRepository $revenue): array
{
    $key = "tenant:{$tenantId}:revenue:month:v2";

    return Cache::lock("lock:{$key}", 10)->block(
        3,
        fn (): array => Cache::remember(
            $key,
            now()->addMinutes(10),
            fn (): array => $revenue->currentMonth($tenantId),
        ),
    );
}
```

## Key Naming Convention

```
tenant:{tenantId}:{entity}:{id}:v{shape}          -> tenant:acme:product:01HV:summary:v1
tenant:{tenantId}:{entity}:list:{hash}:v{shape}   -> tenant:acme:orders:list:9fd2:v2
tenant:{tenantId}:{metric}:{window}:v{shape}      -> tenant:acme:revenue:month:v2
```

- Prefix every application data key with tenant id.
- Add a shape version when the serialized DTO changes.
- Hash long filter sets rather than embedding raw JSON in keys.
- Do not include secrets, bearer tokens, emails, or untrusted header values in keys.

## TTL Strategy

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Entity summary array | 15 minutes | Moderate freshness and high read reuse |
| Search/list result | 2-5 minutes | Filters and membership change often |
| Reference/config value | 1 hour | Rare writes; explicit invalidation on admin changes |
| Aggregate/count | 1-2 minutes | Keeps dashboards fresh without repeated scans |
| Authorization-sensitive value | Short and explicit | Prefer re-checking policy state on mutation |

## Redis Configuration

```php
declare(strict_types=1);

return [
    'default' => env('CACHE_STORE', 'redis'),
    'serializable_classes' => false,
    'stores' => [
        'redis' => [
            'driver' => 'redis',
            'connection' => 'cache',
            'lock_connection' => 'default',
        ],
    ],
    'prefix' => env(
        'CACHE_PREFIX',
        \Illuminate\Support\Str::slug((string) env('APP_NAME', 'laravel'), '_').'_cache_',
    ),
];
```

Use `redis:8-alpine` for local integration and CI containers. Keep cache, queue, and session Redis connections separately configurable when traffic or retention patterns differ.

## Cache Invalidation

```php
declare(strict_types=1);

namespace App\Listeners;

use App\Events\ProductChanged;
use Illuminate\Support\Facades\Cache;

final readonly class ForgetProductCache
{
    public function handle(ProductChanged $event): void
    {
        Cache::forget("tenant:{$event->tenantId}:product:{$event->productId}:summary:v1");
    }
}
```

Only flush tags that were used to write the cached values. If a store does not support tags, keep a small key registry per tenant/list shape or forget individual keys from emitted domain events.

## Cache Tests

```php
declare(strict_types=1);

namespace Tests\Feature\Services;

use App\Events\ProductChanged;
use App\Listeners\ForgetProductCache;
use Illuminate\Foundation\Testing\RefreshDatabase as ResetsDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

final class ProductLookupCacheTest extends TestCase
{
    use ResetsDatabase;

    public function test_product_summary_is_forgotten_after_change_event(): void
    {
        config(['cache.default' => 'array']);

        Cache::put(
            'tenant:t1:product:p1:summary:v1',
            ['id' => 'p1', 'name' => 'Widget', 'price_cents' => 1299],
            now()->addMinutes(15),
        );

        (new ForgetProductCache())->handle(new ProductChanged('t1', 'p1'));

        $this->assertNull(Cache::get('tenant:t1:product:p1:summary:v1'));
    }
}
```

Test cache miss, hit, invalidation, lock timeout behavior, and tenant separation. Prefer the `array` store for unit-level checks and Redis-backed integration tests for locks, tags, and serialization.

## Anti-Patterns

```
No TTL on tenant data
Cache key omits tenant id
Cache invalidation forgets a different key than the read path writes
Caching Eloquent models with loaded relations and hidden lazy-load risk
Using Cache::flush() in application code
Swallowing Redis outages without logging or a typed degradation path
```

## See Also

- `database.instructions.md` — N+1 prevention and repository query shape.
- `performance.instructions.md` — Query budgets, profiling, and OPcache settings.
- `multi-environment.instructions.md` — Environment-specific Redis hosts and prefixes.
