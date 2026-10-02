---
description: Error handling patterns — Laravel exception hierarchy, bootstrap/app.php rendering, RFC 9457 responses
applyTo: 'app/Exceptions/**/*.php,bootstrap/app.php'
---

# Error Handling Patterns (PHP/Laravel)

## Exception Hierarchy

```php
<?php

declare(strict_types=1);

namespace App\Exceptions;

abstract class AppException extends \RuntimeException
{
    abstract public function status(): int;

    abstract public function type(): string;

    abstract public function title(): string;
}

final class InventoryConflictException extends AppException
{
    public function __construct(string $sku)
    {
        parent::__construct("Inventory for SKU {$sku} was modified by another request.");
    }

    public function status(): int
    {
        return 409;
    }

    public function type(): string
    {
        return 'https://example.com/problems/inventory-conflict';
    }

    public function title(): string
    {
        return 'Inventory conflict';
    }
}
```

Required domain exception types:

| Class | HTTP Status | When |
|-------|-------------|------|
| `NotFoundException` | 404 | Entity absent or hidden by tenant scope |
| `ConflictException` | 409 | Unique constraint or state conflict |
| `BusinessRuleException` | 422 | Valid input violates a domain rule |
| `ForbiddenException` | 403 | Policy denial that should be raised from domain code |

## Problem Details Rendering

Register renderers in `bootstrap/app.php`; Laravel 13 applications do not use `app/Exceptions/Handler.php`.

```php
<?php

declare(strict_types=1);

use App\Exceptions\AppException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (ValidationException $exception, Request $request): JsonResponse {
            return problem($request, 422, 'https://example.com/problems/validation', 'Validation failed', 'The request body is invalid.', [
                'errors' => $exception->errors(),
            ]);
        });

        $exceptions->render(function (AuthenticationException $exception, Request $request): JsonResponse {
            return problem($request, 401, 'https://example.com/problems/authentication', 'Unauthenticated', 'Authentication is required.');
        });

        $exceptions->render(function (AppException $exception, Request $request): JsonResponse {
            return problem($request, $exception->status(), $exception->type(), $exception->title(), $exception->getMessage());
        });

        $exceptions->render(function (UniqueConstraintViolationException $exception, Request $request): JsonResponse {
            return problem($request, 409, 'https://example.com/problems/conflict', 'Conflict', 'A resource with the same unique value already exists.');
        });

        $exceptions->render(function (HttpExceptionInterface $exception, Request $request): JsonResponse {
            return problem(
                $request,
                $exception->getStatusCode(),
                'https://example.com/problems/http-'.$exception->getStatusCode(),
                Response::$statusTexts[$exception->getStatusCode()] ?? 'HTTP error',
                $exception->getMessage() !== '' ? $exception->getMessage() : 'The request could not be completed.',
            )->withHeaders($exception->getHeaders());
        });

        $exceptions->render(function (Throwable $exception, Request $request): JsonResponse {
            return problem($request, 500, 'https://example.com/problems/internal', 'Internal Server Error', 'An unexpected error occurred.');
        });
    })
    ->create();
```

## Problem Response Helper

Place `problem()` in `app/Support/helpers.php` and register it with Composer:

```json
{
  "autoload": {
    "files": [
      "app/Support/helpers.php"
    ]
  }
}
```

```php
<?php

declare(strict_types=1);

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

function problem(
    Request $request,
    int $status,
    string $type,
    string $title,
    string $detail,
    array $extensions = [],
): JsonResponse {
    if ($status >= 500) {
        $detail = 'An unexpected error occurred.';
    }

    return response()
        ->json([
            'type' => $type,
            'title' => $title,
            'status' => $status,
            'detail' => $detail,
            'instance' => '/' . ltrim($request->path(), '/'),
            ...$extensions,
        ], $status)
        ->withHeaders(['Content-Type' => 'application/problem+json']);
}
```

## Rules

- Never use empty `catch` blocks; log with context or rethrow.
- Never leak stack traces, SQL, paths, tokens, or internal exception messages to clients.
- Service layer raises typed exceptions; HTTP rendering belongs in `bootstrap/app.php`.
- Laravel validation errors return 422 with an `errors` member.
- Authentication errors return 401; converted HTTP exceptions cover authorization, missing routes, methods and throttling.
- Only `UniqueConstraintViolationException` maps database failures to 409.
- Unexpected exceptions return sanitized 500 Problem Details.

## Exception-to-HTTP Mapping

| Exception | HTTP Status | Response Notes |
|-----------|-------------|----------------|
| `ValidationException` | 422 | Include field errors |
| `AuthenticationException` | 401 | No auth detail beyond required authentication |
| `HttpExceptionInterface` | 403/404/405/429 | Laravel-converted HTTP errors, including policy denial |
| `NotFoundException` | 404 | Avoid revealing cross-tenant existence |
| `ConflictException` | 409 | Domain conflict |
| `BusinessRuleException` | 422 | Valid shape, invalid business state |
| `UniqueConstraintViolationException` | 409 | Duplicate unique value |
| `Throwable` | 500 | Sanitized detail, logged server-side |

## See Also

- `observability.instructions.md` — Structured logs and trace correlation
- `api-patterns.instructions.md` — Status code guide and Resource responses
- `messaging.instructions.md` — Queue retries and failed-job handling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Let Laravel render the default JSON" | Defaults vary by debug mode and can leak internals. Own the Problem Details contract. |
| "Catch everything in the service" | Broad catches hide policy, validation, and database failure semantics. Catch only expected exceptions. |
| "A string message is enough" | Clients need stable `type`, `title`, and `status` fields to branch safely. |
| "Every database exception is a conflict" | Deadlocks, timeouts, and connection errors are not client conflicts. Only unique constraints map to 409. |
| "A shared helper is overkill" | Hand-built error arrays drift across handlers. Keep the response shape in `app/Support/helpers.php`. |

---

## Warning Signs

- `bootstrap/app.php` lacks `withExceptions(...)`
- A custom exception extends bare `Exception` instead of `AppException`
- Error responses use `application/json` instead of `application/problem+json`
- 500 responses include `$exception->getMessage()` instead of the generic detail
- A repository catches all database exceptions and throws `ConflictException`
- Validation errors are flattened into a single string
