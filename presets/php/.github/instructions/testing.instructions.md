---
description: PHP/Laravel testing patterns — PHPUnit 13, Laravel feature and unit tests, fakes, Testcontainers, coverage, and CI gates.
applyTo: '**/tests/**/*.php,**/*Test.php,**/phpunit.xml,**/pest.php,**/composer.json'
---

# PHP Testing Patterns

## Tech stack

- **Runner**: PHPUnit 13.3+ through `php artisan test`
- **Framework helpers**: Laravel 13 testing utilities
- **Database isolation**: `RefreshDatabase`
- **Authentication**: `Laravel\Sanctum\Sanctum::actingAs`
- **Fakes**: `Queue`, `Event`, `Http`, `Notification`, `Bus`, `Mail`, and `Storage`
- **Containers**: `testcontainers/testcontainers` 1.1.0 for PostgreSQL 18 integration tests
- **Coverage**: PCOV or Xdebug with PHPUnit coverage output

## Test types

| Type | Scope | Database | Command |
|------|-------|----------|---------|
| Unit | Single service/value object | Mocked or none | `php artisan test --testsuite=Unit` |
| Feature | HTTP route through Laravel | Test database | `php artisan test --testsuite=Feature` |
| Integration | Repository + PostgreSQL | Testcontainers | `php artisan test --group=integration` |
| Smoke | Deployed endpoint checks | Staging | `php artisan test --group=smoke` |

## Unit test

```php
namespace Tests\Unit\Services;

use App\Data\CreateOrderData;
use App\Models\Order;
use App\Repositories\Contracts\OrderRepository;
use App\Services\OrderService;
use Mockery;
use PHPUnit\Framework\TestCase;

final class OrderServiceTest extends TestCase
{
    public function testCreatePersistsOrderThroughRepository(): void
    {
        $repository = Mockery::mock(OrderRepository::class);
        $service = new OrderService($repository);
        $data = new CreateOrderData('ORD-1001', 'EUR', null);
        $order = new Order(['reference' => 'ORD-1001', 'currency' => 'EUR', 'notes' => null]);

        $repository->shouldReceive('create')->once()->with($data)->andReturn($order);

        self::assertSame($order, $service->create($data));
    }
}
```

## Feature test

```php
namespace Tests\Feature\Api\V1;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

final class OrderIndexTest extends TestCase
{
    use RefreshDatabase;

    public function testIndexReturnsOnlyAuthenticatedUsersTenantOrders(): void
    {
        $tenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        Order::factory()
            ->count(2)
            ->sequence(['reference' => 'ORD-1001'], ['reference' => 'ORD-1002'])
            ->create(['tenant_id' => $tenant->id]);
        Order::factory()->create(['tenant_id' => $otherTenant->id]);

        Sanctum::actingAs($user);

        $response = $this->getJson('/api/v1/orders')
            ->assertOk()
            ->assertJsonCount(2, 'data');

        self::assertEqualsCanonicalizing(
            ['ORD-1001', 'ORD-1002'],
            array_column($response->json('data'), 'reference'),
        );
    }
}
```

## Fakes

```php
use App\Events\OrderPlaced;
use App\Jobs\SendOrderReceipt;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;

Queue::fake();
Event::fake([OrderPlaced::class]);
Http::fake(['billing.internal/*' => Http::response(['approved' => true])]);
Notification::fake();

$this->postJson('/api/v1/orders', [
    'reference' => 'ORD-1001',
    'currency' => 'EUR',
    'notes' => null,
])->assertCreated();

Queue::assertPushed(SendOrderReceipt::class);
Event::assertDispatched(OrderPlaced::class);
Notification::assertNothingSent();
```

## PostgreSQL integration with Testcontainers

```php
namespace Tests\Integration;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Testcontainers\Modules\PostgresContainer;
use Tests\TestCase;

final class PostgresRepositoryTest extends TestCase
{
    public function testRepositoryUsesRealPostgres(): void
    {
        $container = (new PostgresContainer('18-alpine'))->start();

        config([
            'database.default' => 'pgsql',
            'database.connections.pgsql.host' => $container->getHost(),
            'database.connections.pgsql.port' => $container->getFirstMappedPort(),
            'database.connections.pgsql.database' => 'test',
            'database.connections.pgsql.username' => 'test',
            'database.connections.pgsql.password' => 'test',
        ]);
        DB::purge('pgsql');

        Artisan::call('migrate', ['--force' => true]);

        $this->assertDatabaseCount('orders', 0);

        $container->stop();
    }
}
```

## Conventions

- Test class names end with `Test`.
- Test method names describe behavior: `testIndexReturnsOnlyAuthenticatedUsersTenantOrders`.
- Use `RefreshDatabase` for Laravel feature tests.
- Prefer factories over hand-built model arrays.
- Test Form Request authorization and validation separately from controller tests.
- Do not mock repositories in feature tests; feature tests exercise the HTTP boundary, policies, resources, and database together.

## Validation gates

```markdown
- [ ] `composer install` succeeds
- [ ] `vendor/bin/pint --test` reports no formatting changes
- [ ] `vendor/bin/phpstan analyse` passes at the configured Larastan level
- [ ] `php artisan test` passes
- [ ] `php artisan test --coverage --min=80` meets the project threshold
- [ ] `composer audit` reports no vulnerable production dependencies
```

## Temper guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The controller is thin, skip the feature test" | Feature tests prove routing, middleware, Sanctum, Form Requests, policies, resources, and error rendering work together. |
| "SQLite is close enough" | PostgreSQL-specific constraints, UUIDs, JSON operators, and transaction behavior can differ; use Testcontainers for repository integration. |
| "Queue::fake covers the job" | The dispatch contract and the job behavior are different tests; unit-test `handle()` with its dependencies. |
| "Only the happy path matters" | Validation, authorization, tenant isolation, and not-found cases are where PHP APIs most often regress. |

## Warning signs

- Feature tests authenticate by writing user IDs into headers.
- Tests assert entire JSON payloads when API Resources intentionally hide fields.
- Fakes remain active across unrelated assertions.
- `RefreshDatabase` is missing from tests that write through Eloquent.
- A repository test never talks to PostgreSQL.
