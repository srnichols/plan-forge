---
description: "Scaffold ASP.NET Core middleware with request/response pipeline, DI support, structured logging, and proper ordering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold an ASP.NET Core middleware component for the HTTP request pipeline.

## Required Pattern

### Convention-Based Middleware
```csharp
public class {Name}Middleware(
    RequestDelegate next,
    ILogger<{Name}Middleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        // Pre-processing (before the next middleware)
        logger.LogDebug("{Name}Middleware executing for {Path}", context.Request.Path);

        try
        {
            await next(context);
        }
        finally
        {
            // Post-processing (after the response)
        }
    }
}

// Extension method for clean registration
public static class {Name}MiddlewareExtensions
{
    public static IApplicationBuilder Use{Name}(this IApplicationBuilder builder)
        => builder.UseMiddleware<{Name}Middleware>();
}
```

### Scoped-Service Middleware (IMiddleware)
```csharp
// Use when the middleware needs scoped services
public class {Name}Middleware(ILogger<{Name}Middleware> logger) : IMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        // Access scoped services directly via constructor injection
        await next(context);
    }
}

// Must register in DI
builder.Services.AddScoped<{Name}Middleware>();
```

## Registration Order (Program.cs)

```csharp
// Order matters! Follow this sequence:
app.UseExceptionHandler();      // 1. Error handling (outermost)
app.UseCorrelationId();         // 2. Correlation ID
app.UseRequestLogging();        // 3. Request logging
app.UseAuthentication();        // 4. Authentication
app.UseAuthorization();         // 5. Authorization
app.UseRateLimiting();          // 6. Rate limiting
app.Use{Name}();                // 7. Your custom middleware
```

## Common Middleware Types

| Type | Purpose | Example |
|------|---------|---------|
| Correlation ID | Attach trace ID to every request | Read/generate `X-Correlation-Id` header |
| Tenant Resolution | Extract tenant from token/header | Set `ITenantContext.TenantId` |
| Request Logging | Log method, path, status, duration | Structured log with Serilog |
| Exception Handling | Map exceptions to ProblemDetails | Global try/catch with RFC 9457 |

## Rules

- Middleware handles cross-cutting concerns ONLY — no business logic
- Always call `await next(context)` unless short-circuiting intentionally
- Use `finally` blocks for post-processing (guarantees execution on errors)
- Add an extension method `Use{Name}()` for clean `Program.cs` registration
- Use `IMiddleware` interface when scoped DI services are needed

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
