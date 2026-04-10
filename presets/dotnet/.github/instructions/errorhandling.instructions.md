---
description: Error handling patterns — Exception hierarchy, ProblemDetails responses, error boundaries, global exception middleware
applyTo: '**/*.cs'
---

# Error Handling Patterns (.NET)

## Exception Hierarchy

Define a base exception and derive specific types:

```csharp
public abstract class AppException : Exception
{
    public string Code { get; }
    public int StatusCode { get; }
    
    protected AppException(string message, string code, int statusCode)
        : base(message) { Code = code; StatusCode = statusCode; }
}

public class NotFoundException : AppException
{
    public NotFoundException(string entity, string id)
        : base($"{entity} with ID '{id}' not found", "NOT_FOUND", 404) { }
}

public class ValidationException : AppException
{
    public IDictionary<string, string[]> Errors { get; }
    
    public ValidationException(IDictionary<string, string[]> errors)
        : base("Validation failed", "VALIDATION_ERROR", 400) { Errors = errors; }
}

public class ConflictException : AppException
{
    public ConflictException(string message)
        : base(message, "CONFLICT", 409) { }
}

public class ForbiddenException : AppException
{
    public ForbiddenException(string message = "Access denied")
        : base(message, "FORBIDDEN", 403) { }
}
```

## Global Exception Middleware

Map exceptions to RFC 9457 ProblemDetails:

```csharp
public class GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try { await next(context); }
        catch (AppException ex)
        {
            logger.LogWarning(ex, "Application error: {Code}", ex.Code);
            await WriteProblemDetailsAsync(context, ex.StatusCode, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception");
            await WriteProblemDetailsAsync(context, 500, "INTERNAL_ERROR", "An unexpected error occurred");
        }
    }
}
```

## Rules

- **NEVER** use empty catch blocks — always log with context
- **NEVER** leak stack traces to clients in production
- **ALWAYS** use typed exceptions — no bare `throw new Exception()`
- **ALWAYS** return ProblemDetails (RFC 9457) from API endpoints
- **ALWAYS** include correlation IDs in error responses
- Service layer throws typed exceptions; controllers map to HTTP status codes
- Log at Warning for client errors (4xx), Error for server errors (5xx)

## Exception-to-HTTP Mapping

| Exception | HTTP Status | When |
|-----------|-------------|------|
| `ValidationException` | 400 | Invalid input |
| `UnauthorizedAccessException` | 401 | Missing/invalid auth |
| `ForbiddenException` | 403 | Insufficient permissions |
| `NotFoundException` | 404 | Entity not found |
| `ConflictException` | 409 | Duplicate/conflict |
| `InvalidOperationException` | 422 | Business rule violation |
| `Exception` (unhandled) | 500 | Unexpected error |

## Error Boundaries (Blazor/UI)

Wrap page content in error boundaries to prevent full-page crashes:

```csharp
<ErrorBoundary @ref="errorBoundary">
    <ChildContent>@Body</ChildContent>
    <ErrorContent Context="ex">
        <div class="alert alert-danger">Something went wrong. <button @onclick="Recover">Retry</button></div>
    </ErrorContent>
</ErrorBoundary>
```

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `messaging.instructions.md` — Dead letter queues, retry strategies
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This operation can't fail" | Every I/O operation can fail — network timeouts, disk full, permission denied, null reference. If it touches external state, it fails. |
| "A generic catch block is fine here" | Generic catches swallow specific failure signals. Catch the exception you expect, let the rest propagate to the global handler. |
| "Logging the error is enough" | Logging without handling means the caller receives a cryptic 500. Return a structured ProblemDetails response so the consumer can act on it. |
| "The caller handles errors, I don't need to" | If the caller expected your method to succeed unconditionally, the unhandled exception is a surprise. Define your error contract explicitly. |
| "Returning null is simpler than throwing" | Null return values push error handling to every caller. Use typed results (`Result<T>`) or throw a specific exception with a clear message. |

---

## Warning Signs

- Empty catch blocks (`catch { }` or `catch (Exception) { }`) — silent failure
- All exceptions caught as base `Exception` instead of specific types
- Error responses expose stack traces or internal paths to API consumers
- Methods that return `null` on failure instead of throwing or using Result types
- Missing `CancellationToken` parameter on async methods (no way to cancel on timeout)
- Retry logic without a maximum retry count or exponential backoff (infinite retry loops)
