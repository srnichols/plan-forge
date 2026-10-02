---
description: PHP GraphQL patterns — Lighthouse schema-first SDL, guards, policies, tenant-scoped pagination, batching, and production limits
applyTo: 'graphql/**/*.graphql,app/GraphQL/**/*.php,config/lighthouse.php,tests/Feature/**/*GraphQL*.php'
---

# PHP GraphQL Patterns (Lighthouse)

Use Lighthouse 6.71.0 schema-first GraphQL. Resolvers stay thin, delegate to services, and never bypass Laravel policies or tenant scopes.

## Schema-First SDL

Escape PHP namespaces in SDL directive strings with doubled backslashes.

```graphql
type Query {
  order(id: ID! @eq): Order
    @guard(with: ["sanctum"])
    @canFind(ability: "view", find: "id")
    @field(resolver: "App\\GraphQL\\Queries\\OrderQuery")

  orders: [Order!]!
    @guard(with: ["sanctum"])
    @canModel(ability: "viewAny", model: "App\\Models\\Order")
    @paginate(type: CONNECTION, model: "App\\Models\\Order", defaultCount: 25, maxCount: 100)
}

type Mutation {
  createOrder(input: CreateOrderInput! @spread): Order!
    @guard(with: ["sanctum"])
    @canModel(ability: "create", model: "App\\Models\\Order")
    @field(resolver: "App\\GraphQL\\Mutations\\CreateOrder")
}

type Order {
  id: ID!
  reference: String!
  currency: String!
  customer: Customer! @belongsTo
  createdAt: DateTime! @rename(attribute: "created_at")
}

input CreateOrderInput {
  reference: String!
  currency: String!
  notes: String
}
```

Use `@canFind`, `@canModel`, `@canQuery`, `@canResolved`, or `@canRoot`; do not use deprecated `@can`.

## Resolver Shape

Resolvers receive validated arguments and the authenticated user through Lighthouse context. Business rules belong in services.

```php
<?php

declare(strict_types=1);

namespace App\GraphQL\Mutations;

use App\Data\CreateOrderData;
use App\Enums\OrderStatus;
use App\Models\Order;
use App\Services\OrderService;
use Illuminate\Contracts\Auth\Authenticatable;

final readonly class CreateOrder
{
    public function __construct(private OrderService $orders)
    {
    }

    public function __invoke(null $_, array $args, mixed $context): Order
    {
        $user = $context->user();
        assert($user instanceof Authenticatable);

        return $this->orders->create(new CreateOrderData(
            reference: $args['reference'],
            currency: $args['currency'],
            notes: $args['notes'] ?? null,
        ));
    }
}
```

## Tenant-Scoped Pagination

Tenant filtering belongs in the Eloquent `TenantScope` through `BelongsToTenant`. Paginated list fields must cap `maxCount` so clients cannot request unbounded collections.

For custom query builders, add cursor-stable ordering:

```php
<?php

declare(strict_types=1);

use App\Models\Order;
use Illuminate\Database\Eloquent\Builder;

final readonly class OrderList
{
    public function __invoke(): Builder
    {
        return Order::query()
            ->orderByDesc('created_at')
            ->orderByDesc('id');
    }
}
```

## Batch Loading

Use Lighthouse batching or DataLoader-style services for related objects. Batch queries must include tenant scope and return records keyed by requested IDs.

```php
<?php

declare(strict_types=1);

namespace App\GraphQL\Loaders;

use App\Models\Customer;
use Illuminate\Support\Collection;

final readonly class CustomerBatchLoader
{
    public function load(array $ids): Collection
    {
        return Customer::query()
            ->whereIn('id', $ids)
            ->get()
            ->keyBy('id');
    }
}
```

Never call a repository once per field inside a resolver loop.

## Input Validation

Lighthouse validates GraphQL types, but domain validation still belongs in Form Request-equivalent rules or service DTO validation. Mutations must reject unknown state transitions with the same RFC 9457 error model used by REST.

## Depth, Complexity, and Introspection

Disable introspection in production and set query depth/complexity ceilings.

```php
<?php

declare(strict_types=1);

use App\Http\Middleware\ResolveTenant;
use GraphQL\Validator\Rules\DisableIntrospection;
use Nuwave\Lighthouse\Http\Middleware\AttemptAuthentication;

return [
    'route' => [
        'middleware' => [
            AttemptAuthentication::class,
            ResolveTenant::class,
        ],
    ],
    'guards' => ['sanctum'],
    'security' => [
        'max_query_complexity' => (int) env('LIGHTHOUSE_MAX_COMPLEXITY', 300),
        'max_query_depth' => (int) env('LIGHTHOUSE_MAX_DEPTH', 10),
        'disable_introspection' => (bool) env('LIGHTHOUSE_DISABLE_INTROSPECTION', env('APP_ENV') === 'production')
            ? DisableIntrospection::ENABLED
            : DisableIntrospection::DISABLED,
    ],
];
```

This configuration makes the GraphQL endpoint auth-only. Place `ResolveTenant::class` after `AttemptAuthentication::class` in Lighthouse route middleware so Lighthouse has already authenticated the Sanctum user before tenant context is set. If the API later needs anonymous public fields, split them onto a separate route or replace `ResolveTenant` with an optional tenant middleware that only sets context when a user is present and forbids tenant-scoped resolvers without one.

## Testing

Feature tests should cover auth, ability, tenant isolation, pagination limits, and batching behavior.

```php
<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Nuwave\Lighthouse\Testing\MakesGraphQLRequests;
use Tests\TestCase;

final class OrderGraphQLTest extends TestCase
{
    use MakesGraphQLRequests;
    use RefreshDatabase;

    public function test_scope_filters_another_tenants_order(): void
    {
        $userTenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        $user = User::factory()->create(['tenant_id' => $userTenant->id]);
        $order = Order::factory()->create(['tenant_id' => $otherTenant->id]);

        Sanctum::actingAs($user, ['orders:read']);

        $this->graphQL('query ($id: ID!) { order(id: $id) { id } }', ['id' => $order->id])
            ->assertJsonPath('data.order', null);
    }
}
```

## Rules

- Keep SDL in `graphql/` and resolvers under `app/GraphQL/{Queries,Mutations}`.
- Use `@guard` on every non-public field and policy directives on every tenant resource field.
- Cap every list query with `@paginate(... maxCount: ...)`.
- Escape namespaces in directive strings as `App\\GraphQL\\...`.
- Create per-request batch loaders; do not share cached relation data across tenants.

## Anti-Patterns

```text
Using deprecated @can directives.
Returning Eloquent models from services that already include authorization decisions.
Accepting tenant_id in mutation input.
Letting GraphQL introspection run in production.
Resolving child objects with one query per parent row.
Exposing unpaginated list fields.
```

## See Also

- `auth.instructions.md` — Sanctum abilities, policies, and tenant context
- `security.instructions.md` — validation, output safety, and secrets
- `database.instructions.md` — tenant scopes, eager loading, cursor pagination
