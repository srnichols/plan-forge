---
description: "Scaffold Laravel AppException subclasses and bootstrap/app.php Problem Details rendering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold typed domain exceptions that render as RFC 9457 Problem Details.

## Required Pattern

### Base Exception

```text
app/Exceptions/AppException.php

abstract class AppException extends RuntimeException
{
    abstract public function status(): int;
    abstract public function type(): string;
    abstract public function title(): string;
}
```

### Domain Exception Types

```text
app/Exceptions/NotFoundException.php

final class NotFoundException extends AppException
{
    public function __construct(string $entity, string $id)
    {
        parent::__construct("{$entity} with id '{$id}' was not found.");
    }

    public function status(): int { return 404; }
    public function type(): string { return 'https://example.com/problems/not-found'; }
    public function title(): string { return 'Not found'; }
}
```

Create these standard classes before adding domain-specific subclasses:

| Class | Status | Purpose |
|-------|--------|---------|
| `NotFoundException` | 404 | Missing resource or tenant-hidden resource |
| `ConflictException` | 409 | Duplicate unique value or state conflict |
| `BusinessRuleException` | 422 | Valid request violates a business rule |
| `ForbiddenException` | 403 | Domain authorization failure |

### Renderer Registration

```text
bootstrap/app.php

->withExceptions(function (Exceptions $exceptions): void {
    $exceptions->render(function (AppException $exception, Request $request): JsonResponse {
        return problem(
            request: $request,
            status: $exception->status(),
            type: $exception->type(),
            title: $exception->title(),
            detail: $exception->getMessage(),
        );
    });
})
```

## Rules

- Never raise raw `Exception` or `RuntimeException` from domain code.
- Keep HTTP status mapping on the exception class.
- Render all errors centrally from `bootstrap/app.php`.
- Keep the Problem Details shape consistent with the global `problem()` helper.
- Log unexpected exceptions server-side and return sanitized 500 responses.
- Map only `UniqueConstraintViolationException` to 409.

## Reference Files

- [Error handling](../instructions/errorhandling.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Exception layering guidance](../instructions/architecture-principles.instructions.md)
