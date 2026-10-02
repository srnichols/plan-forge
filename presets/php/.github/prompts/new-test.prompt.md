---
description: "Scaffold PHPUnit 13 tests for Laravel 13 with RefreshDatabase, Sanctum authentication, fakes, and Testcontainers where needed."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold Laravel tests that match the layer under test and use PHPUnit 13.

## Test naming convention

```
test{Action}When{Condition}Should{Expected}
```

Examples:

- `testIndexWhenAuthenticatedShouldReturnTenantOrders`
- `testStoreWhenPayloadInvalidShouldReturnValidationProblem`
- `testHandleWhenProviderTimesOutShouldReleaseJob`

## Feature test template

Use this shape for authenticated JSON API routes:

```text
tests/Feature/Api/V1/{EntityName}/{Action}{EntityName}Test.php

class {Action}{EntityName}Test extends TestCase
{
    use RefreshDatabase;

    public function test{Action}WhenAuthorizedShouldSucceed(): void
    {
        // Arrange: create tenant user and fixtures with factories.
        // Authenticate with Sanctum::actingAs($user).
        // Act: call $this->{method}Json('/api/v1/{resource}', $payload).
        // Assert: status, API Resource shape, database state, and dispatched side effects.
    }
}
```

## Unit test example

```php
namespace Tests\Unit\Data;

use App\Data\CreateOrderData;
use PHPUnit\Framework\TestCase;

final class CreateOrderDataTest extends TestCase
{
    public function testConstructorStoresImmutableValues(): void
    {
        $data = new CreateOrderData('ORD-1001', 'EUR', null);

        self::assertSame('ORD-1001', $data->reference);
        self::assertSame('EUR', $data->currency);
        self::assertNull($data->notes);
    }
}
```

## Feature test requirements

- Use `RefreshDatabase`.
- Authenticate with `Sanctum::actingAs($user)`.
- Never pass tenant identity through headers, query string, or body.
- Assert policy failures with `assertForbidden()`.
- Assert validation failures with `assertUnprocessable()` and `assertJsonValidationErrors()`.
- Use `Queue::fake()`, `Event::fake()`, `Http::fake()`, and `Notification::fake()` only for external effects.

## Integration test requirements

- Use `testcontainers/testcontainers` for PostgreSQL-specific repository behavior.
- Use `new \Testcontainers\Modules\PostgresContainer('18-alpine')`.
- Read host and port from the started container with `getHost()` and `getFirstMappedPort()`.
- Run migrations before repository assertions.

## Commands

```bash
php artisan test --filter={TestClass}
php artisan test --testsuite=Feature
php artisan test --group=integration
php artisan test --coverage --min=80
```

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
