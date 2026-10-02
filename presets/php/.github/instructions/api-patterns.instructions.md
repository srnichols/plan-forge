---
description: API patterns for PHP — Laravel routes, Form Requests, API Resources, cursor pagination, Problem Details
applyTo: 'app/Http/Controllers/**/*.php,app/Http/Requests/**/*.php,app/Http/Resources/**/*.php,routes/api.php'
---

# PHP API Patterns

## REST Conventions

### Controller Structure

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreOrderRequest;
use App\Http\Resources\OrderResource;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

final class OrderController extends Controller
{
    public function __construct(private readonly OrderService $orders)
    {
    }

    public function show(string $id): OrderResource
    {
        return OrderResource::make($this->orders->get($id));
    }

    public function store(StoreOrderRequest $request): JsonResponse
    {
        return OrderResource::make($this->orders->create($request->toData()))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

}
```

## Request Validation and Authorization

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Data\CreateOrderData;
use App\Models\Order;
use Illuminate\Foundation\Http\FormRequest;

final class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', Order::class) === true;
    }

    public function rules(): array
    {
        return [
            'reference' => ['required', 'string', 'max:64'],
            'currency' => ['required', 'string', 'size:3'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function toData(): CreateOrderData
    {
        return new CreateOrderData(
            reference: (string) $this->validated('reference'),
            currency: strtoupper((string) $this->validated('currency')),
            notes: $this->validated('notes'),
        );
    }
}
```

## API Resource Shape

```php
<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'status' => $this->status->value,
            'currency' => $this->currency,
            'totalCents' => $this->total_cents,
            'notes' => $this->notes,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
```

## Rate Limiter and Route Versioning

Define the `api` limiter in `App\Providers\AppServiceProvider::boot()` before using `throttle:api`:

```php
<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(60)->by($request->user()?->id ?: $request->ip()));
    }
}
```

```php
<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        Route::get('orders', [OrderController::class, 'index']);
        Route::get('orders/{id}', [OrderController::class, 'show']);
        Route::post('orders', [OrderController::class, 'store']);
    });
```

## Pagination

Use cursor pagination for collection endpoints that can grow:

```php
<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Models\Order;
use Illuminate\Contracts\Pagination\CursorPaginator;

final class EloquentOrderRepository
{
    public function paginate(int $perPage = 50): CursorPaginator
    {
        return Order::query()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage);
    }
}
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, update success with a body |
| 201 Created | POST success |
| 204 No Content | DELETE success or update with no body |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but policy denies the action |
| 404 Not Found | Resource does not exist in the current tenant |
| 409 Conflict | Unique constraint or concurrent state conflict |
| 422 Unprocessable Content | Form Request validation or business rule failure |
| 500 Internal Server Error | Unexpected failure; never expose internals |

## API Versioning Rules

- Version APIs from day one with `/api/v1`.
- Add a new version for breaking contract changes; do not silently alter v1.
- Deprecation needs a documented sunset window and response headers.
- Return `410 Gone` after a sunset date instead of repurposing `404`.
- Keep OpenAPI or route documentation aligned with Form Requests and Resources.

## Anti-Patterns

```
❌ Business logic in controllers
❌ Returning Eloquent models directly
❌ Reading tenant IDs from headers, query strings, or request bodies
❌ Accepting untyped arrays instead of Form Requests and DTOs
❌ Offset pagination for high-volume endpoints
❌ Mapping every exception to 200 OK with an error payload
```

## See Also

- `version.instructions.md` — API deprecation timelines and release tagging
- `security.instructions.md` — Sanctum, policies, and tenant resolution
- `errorhandling.instructions.md` — RFC 9457 response format
- `performance.instructions.md` — Cursor pagination and N+1 prevention

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The controller can just call the model" | Controllers become untestable and bypass repository tenant checks. Delegate to services and repositories. |
| "The client already knows the model fields" | Eloquent models expose implementation details and relationships. API Resources are the contract. |
| "Header tenancy is easier for tests" | Client-supplied tenant IDs are privilege-escalation inputs. Tests should authenticate a user with a tenant. |
| "Offset pagination is fine for now" | Inserts between pages cause duplicates and gaps. Cursor pagination with a unique order is stable. |
| "Validation belongs in the service" | Boundary validation must reject bad HTTP input before business rules run. Use Form Requests. |

---

## Warning Signs

- A controller imports an Eloquent model only to query or persist it
- A route path is missing the `v1` prefix
- A collection endpoint returns an unpaginated array
- A Form Request lacks `authorize()`
- An API Resource exposes snake_case database columns without intentional API naming
- `response()->json()` manually duplicates the Problem Details error shape
