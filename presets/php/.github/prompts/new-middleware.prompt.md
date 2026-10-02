---
description: "Scaffold Laravel HTTP middleware with request pipeline ordering, service injection, and tenant-safe behavior."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold middleware for cross-cutting HTTP request concerns.

## Required Pattern

```text
app/Http/Middleware/{Name}Middleware.php

final class {Name}Middleware
{
    public function __construct(private readonly {DependencyName} $dependency)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        // Pre-processing.

        $response = $next($request);

        // Post-processing.

        return $response;
    }
}
```

## Tenant Resolution Pattern

`app/Http/Middleware/ResolveTenant.php`

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ForbiddenException;
use App\Support\CurrentTenant;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ResolveTenant
{
    public function __construct(private CurrentTenant $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user() ?? throw new AuthenticationException();
        if ($user->tenant_id === null) {
            throw new ForbiddenException('User is not assigned to a tenant.');
        }
        $this->tenant->set($user->tenant_id);
        try {
            return $next($request);
        } finally {
            $this->tenant->clear();
        }
    }
}
```

## Registration

```text
bootstrap/app.php

->withMiddleware(function (Middleware $middleware): void {
    $middleware->prependToPriorityList(
        \Illuminate\Routing\Middleware\SubstituteBindings::class,
        \App\Http\Middleware\ResolveTenant::class,
    );
})
```

```text
routes/api.php

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        // API routes.
    });
```

## Common Middleware Types

| Type | Purpose | Notes |
|------|---------|-------|
| Correlation ID | Attach trace ID to logs and responses | Must run early |
| Tenant Resolution | Set `CurrentTenant` from authenticated user | Runs after auth |
| Request Logging | Record method, route, status, duration | Never log secrets |
| Deprecation Headers | Mark sunset API versions | Keep timeline in version docs |

## Rules

- Middleware handles cross-cutting concerns only.
- Always call `$next($request)` unless intentionally rejecting the request.
- Never perform domain business decisions in middleware.
- Never resolve tenant from a client-supplied header, query string, or body.
- Store request-scoped tenant in `CurrentTenant`, not static globals.
- Clear request-scoped tenant in a `finally` block after the response pipeline returns.
- Register middleware in `bootstrap/app.php`; do not create a legacy Kernel.

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Cross-cutting concern boundaries](../instructions/architecture-principles.instructions.md)
