---
description: "Fix a Laravel bug with TDD: reproduce with a failing PHPUnit test, implement the smallest correct fix, then verify."
agent: "agent"
tools: [read, edit, search, execute]
---
# Fix Bug with TDD

Follow Red-Green-Refactor for Laravel 13.

## Process

### Step 1: Understand the bug

- Read the route, controller, Form Request, service, repository, model, policy, and resource involved.
- Identify the layer that owns the defect: HTTP boundary, business rule, query, authorization, queue, or serialization.
- Confirm whether tenant isolation, authentication, or problem-details rendering is part of the failure.

### Step 2: RED — write a failing test

```php
namespace Tests\Feature\Api\V1\Orders;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

final class ShowOrderTest extends TestCase
{
    use RefreshDatabase;

    public function testShowWhenOrderBelongsToAnotherTenantShouldReturnNotFound(): void
    {
        $tenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $order = Order::factory()->create(['tenant_id' => $otherTenant->id]);

        Sanctum::actingAs($user);

        $this->getJson("/api/v1/orders/{$order->id}")->assertNotFound();
    }
}
```

Run the narrow failure:

```bash
php artisan test --filter=ShowOrderTest
```

The new test must fail for the bug, not because of a typo or missing fixture.

### Step 3: GREEN — implement the fix

- Put HTTP validation in a Form Request.
- Put authorization in a policy or Gate.
- Put business rules in a service.
- Put query changes in the repository or Eloquent scope.
- Use `DB::transaction()` around multi-write business operations.

### Step 4: REFACTOR — clean up

- Rename unclear tests or helpers.
- Remove duplicate fixture setup.
- Keep factories expressive.
- Do not broaden the fix into unrelated refactors.

### Step 5: Verify

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
php artisan test
```

## Architecture rules

- No business logic in controllers.
- No direct SQL in services.
- No tenant or user identity from client-controlled headers.
- Parameterize raw SQL if raw SQL is unavoidable.
- Preserve RFC 9457 problem-details responses from `bootstrap/app.php`.

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
