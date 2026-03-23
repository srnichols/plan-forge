---
description: "Scaffold custom exception types with HTTP status mapping, problem details, and a global exception handler."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold a custom exception hierarchy with HTTP status mapping and RFC 7807 Problem Details responses.

## Required Pattern

### Base Application Exception
```csharp
public abstract class AppException : Exception
{
    public int StatusCode { get; }
    public string ErrorCode { get; }

    protected AppException(string message, int statusCode, string errorCode)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }
}
```

### Domain Exception Types
```csharp
public class NotFoundException : AppException
{
    public NotFoundException(string entity, object id)
        : base($"{entity} with id '{id}' was not found.", 404, "NOT_FOUND") { }
}

public class ConflictException : AppException
{
    public ConflictException(string message)
        : base(message, 409, "CONFLICT") { }
}

public class ValidationException : AppException
{
    public IDictionary<string, string[]> Errors { get; }

    public ValidationException(IDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.", 422, "VALIDATION_FAILED")
    {
        Errors = errors;
    }
}

public class ForbiddenException : AppException
{
    public ForbiddenException(string message = "You do not have permission to perform this action.")
        : base(message, 403, "FORBIDDEN") { }
}
```

### Global Exception Handler (Middleware)
```csharp
public class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger)
    {
        _logger = logger;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext context, Exception exception, CancellationToken ct)
    {
        var (statusCode, errorCode, detail) = exception switch
        {
            AppException app => (app.StatusCode, app.ErrorCode, app.Message),
            _ => (500, "INTERNAL_ERROR", "An unexpected error occurred.")
        };

        _logger.LogError(exception, "Unhandled exception: {ErrorCode}", errorCode);

        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = statusCode,
            Title = errorCode,
            Detail = detail,
        }, ct);

        return true;
    }
}
```

### Registration
```csharp
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

// In pipeline
app.UseExceptionHandler();
```

## Rules

- NEVER throw raw `Exception` — always use typed exceptions inheriting `AppException`
- NEVER leak stack traces or internal details in production responses
- Map every exception type to a specific HTTP status code
- Use RFC 7807 Problem Details format for all error responses
- Log the full exception server-side; return sanitized details to the client
- Keep exception classes in an `Exceptions/` folder

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
