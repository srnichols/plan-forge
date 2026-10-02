---
description: "Scaffold a Laravel repository contract and Eloquent implementation with tenant scope, eager loading, cursor pagination, and tests."
agent: "agent"
tools: [read, edit, search]
---

# Create New Repository

Scaffold data access behind an interface so services do not depend on Eloquent query details.

## Fill-In Inputs

- `{EntityName}`: PascalCase model and contract stem.
- `{entityName}`: camelCase parameter name.
- `{table}`: database table.
- `{RepositoryMethod}`: verb phrase that describes a persistence operation.

## Required Pattern

```php
declare(strict_types=1);

namespace App\Repositories\Contracts;

use App\Data\CreateOrderData;
use App\Models\Order;
use Illuminate\Contracts\Pagination\CursorPaginator;

interface OrderRepository
{
    public function create(CreateOrderData $data): Order;

    public function find(string $id): ?Order;

    public function paginate(int $perPage = 50): CursorPaginator;
}
```

```php
declare(strict_types=1);

namespace App\Repositories;

use App\Data\CreateOrderData;
use App\Enums\OrderStatus;
use App\Models\Order;
use App\Repositories\Contracts\OrderRepository;
use App\Support\CurrentTenant;
use Illuminate\Contracts\Pagination\CursorPaginator;

final readonly class EloquentOrderRepository implements OrderRepository
{
    public function __construct(private CurrentTenant $tenant) {}

    public function create(CreateOrderData $data): Order
    {
        return Order::query()->create([
            'tenant_id' => $this->tenant->id(),
            'reference' => $data->reference,
            'status' => OrderStatus::Pending,
            'currency' => $data->currency,
            'total_cents' => 0,
            'notes' => $data->notes,
        ]);
    }

    public function find(string $id): ?Order
    {
        return Order::query()->whereKey($id)->first();
    }

    public function paginate(int $perPage = 50): CursorPaginator
    {
        return Order::query()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage);
    }
}
```

## Binding

```php
declare(strict_types=1);

namespace App\Providers;

use App\Repositories\Contracts\OrderRepository;
use App\Repositories\EloquentOrderRepository;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderRepository::class, EloquentOrderRepository::class);
    }
}
```

## Rules

- Repositories handle persistence and query shape only; they do not authorize, validate HTTP input, or apply business decisions.
- Tenant-scoped repositories read the tenant from `CurrentTenant`; services do not accept tenant ids for current-user operations.
- Use `with()` or explicit select lists for read models to prevent N+1 and over-fetching.
- Use cursor pagination for API list reads; pair sort columns with a unique key.
- Prefer Eloquent builder bindings. If raw SQL is required, pass bindings as method arguments.
- Add repository tests with `RefreshDatabase`; do not mock Eloquent for behavior that depends on scopes or migrations.

## Repository Test Skeleton

```php
declare(strict_types=1);

namespace Tests\Feature\Repositories;

use App\Models\Order;
use App\Models\Tenant;
use App\Repositories\EloquentOrderRepository;
use App\Support\CurrentTenant;
use Illuminate\Foundation\Testing\RefreshDatabase as UsesFreshDatabase;
use Tests\TestCase;

final class EloquentOrderRepositoryTest extends TestCase
{
    use UsesFreshDatabase;

    public function test_paginate_excludes_other_tenants(): void
    {
        $tenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        Order::factory()->create(['tenant_id' => $tenant->id]);
        Order::factory()->create(['tenant_id' => $otherTenant->id]);
        app(CurrentTenant::class)->set($tenant->id);

        $page = app(EloquentOrderRepository::class)->paginate(15);

        $this->assertCount(1, $page->items());
        $this->assertSame($tenant->id, $page->items()[0]->tenant_id);
    }
}
```

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
