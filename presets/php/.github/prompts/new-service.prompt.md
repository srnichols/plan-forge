---
description: "Scaffold a Laravel service with constructor injection, typed DTOs, transactions, exceptions, events, and repository dependencies."
agent: "agent"
tools: [read, edit, search]
---

# Create New Service

Scaffold the business layer for `{EntityName}`. Services orchestrate repositories, policies already checked at the boundary, domain events, transactions, and typed exceptions.

## Fill-In Inputs

- `{EntityName}`: PascalCase aggregate or workflow name.
- `{entityName}`: camelCase variable name.
- `{Action}{EntityName}Data`: DTO produced by a Form Request or job payload.
- `{EntityName}Repository`: persistence contract from `app/Repositories/Contracts/`.

For the running Order example, use `CreateOrderData(string $reference, string $currency, ?string $notes = null)` and `OrderRepository` methods `create(CreateOrderData $data): Order`, `find(string $id): ?Order`, and `paginate(int $perPage = 50): CursorPaginator`.

## Required Pattern

```php
declare(strict_types=1);

namespace App\Services;

use App\Data\CreateOrderData;
use App\Exceptions\NotFoundException;
use App\Models\Order;
use App\Repositories\Contracts\OrderRepository;
use Illuminate\Support\Facades\DB;

final readonly class OrderService
{
    public function __construct(private OrderRepository $orders) {}

    public function get(string $orderId): Order
    {
        $order = $this->orders->find($orderId);

        if ($order === null) {
            throw new NotFoundException('Order', $orderId);
        }

        return $order;
    }

    public function create(CreateOrderData $data): Order
    {
        return DB::transaction(fn (): Order => $this->orders->create($data), attempts: 3);
    }
}
```

## Rules

- Services contain business rules; controllers handle HTTP, repositories handle database access, resources shape responses.
- Constructor-inject every collaborator called by the service.
- Accept DTOs or scalar identifiers, not `Request`, `JsonResource`, or controller-only types.
- Use `DB::transaction()` for workflows that must commit atomically.
- Throw the project exception hierarchy (`NotFoundException`, `ConflictException`, `BusinessRuleException`, `ForbiddenException`).
- Dispatch events after state changes inside the transaction when listeners can tolerate after-commit behavior, or mark listeners/jobs as after-commit where required.
- Keep tenant identity in `CurrentTenant`; services should not accept tenant ids when the repository reads the current tenant.

## Validation and Tests

```php
declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Data\CreateOrderData;
use App\Exceptions\NotFoundException;
use App\Repositories\Contracts\OrderRepository;
use App\Services\OrderService;
use Mockery;
use Tests\TestCase;

final class OrderServiceTest extends TestCase
{
    public function test_get_throws_not_found_when_order_is_missing(): void
    {
        $orders = Mockery::mock(OrderRepository::class);
        $orders->shouldReceive('find')->once()->with('missing-order')->andReturnNull();

        $service = new OrderService($orders);

        $this->expectException(NotFoundException::class);
        $service->get('missing-order');
    }
}
```

Also add a feature test for the controller path so Form Request authorization, validation, service invocation, and API Resource output are covered together.

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
