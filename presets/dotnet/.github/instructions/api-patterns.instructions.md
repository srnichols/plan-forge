---
description: API patterns for .NET — REST conventions, ProblemDetails, pagination, versioning, error responses
applyTo: '**/*Controller*.cs,**/*Endpoint*.cs,**/Controllers/**,**/Endpoints/**'
---

# .NET API Patterns

## REST Conventions

### Controller Structure
```csharp
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class ProducersController(IProducerService service) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<ProducerDto>>> GetAll(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
    {
        var result = await service.GetPagedAsync(page, pageSize, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProducerDto>> GetById(Guid id, CancellationToken ct = default)
    {
        var producer = await service.GetByIdAsync(id, ct);
        return producer is null ? NotFound() : Ok(producer);
    }

    [HttpPost]
    public async Task<ActionResult<ProducerDto>> Create(
        [FromBody] CreateProducerRequest request, CancellationToken ct = default)
    {
        var created = await service.CreateAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id, [FromBody] UpdateProducerRequest request, CancellationToken ct = default)
    {
        await service.UpdateAsync(id, request, ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct = default)
    {
        await service.DeleteAsync(id, ct);
        return NoContent();
    }
}
```

## Error Responses (ProblemDetails — RFC 9457)
```csharp
// Automatic via app.UseExceptionHandler + ProblemDetails
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
    };
});

// Manual ProblemDetails
return Problem(
    title: "Producer not found",
    detail: $"No producer with ID {id} exists",
    statusCode: StatusCodes.Status404NotFound,
    type: "https://tools.ietf.org/html/rfc9110#section-15.5.5");
```

## Pagination
```csharp
public record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount)
{
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrevious => Page > 1;
}

// SQL pattern
const string sql = """
    SELECT * FROM producers WHERE tenant_id = @TenantId
    ORDER BY created_at DESC
    LIMIT @PageSize OFFSET @Offset
    """;
```

## Request Validation
```csharp
// Use FluentValidation or DataAnnotations
public record CreateProducerRequest(
    [Required, StringLength(200)] string Name,
    [Required, EmailAddress] string ContactEmail,
    [Range(-90, 90)] decimal? Latitude,
    [Range(-180, 180)] decimal? Longitude);
```

## API Versioning

### URL-based Versioning (Recommended)
```csharp
builder.Services.AddApiVersioning(options =>
{
    options.DefaultApiVersion = new ApiVersion(1, 0);
    options.AssumeDefaultVersionWhenUnspecified = true;
    options.ReportApiVersions = true;
    options.ApiVersionReader = new UrlSegmentApiVersionReader();
});

[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class ProducersController : ControllerBase { }
```

### Header-based Versioning (Alternative)
```csharp
// Read version from custom header instead of URL
options.ApiVersionReader = ApiVersionReader.Combine(
    new UrlSegmentApiVersionReader(),
    new HeaderApiVersionReader("API-Version"));
```

### Version Discovery Endpoint
```csharp
app.MapGet("/api/versions", () => new
{
    Supported = new[] { "v1", "v2" },
    Current = "v2",
    Deprecated = new[] { "v1" },
    Sunset = new Dictionary<string, string> { ["v1"] = "2026-01-01" }
});
```

### Deprecation Headers Middleware
```csharp
app.Use(async (context, next) =>
{
    await next();
    if (context.Request.Path.StartsWithSegments("/api/v1"))
    {
        context.Response.Headers.Append("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT");
        context.Response.Headers.Append("Deprecation", "true");
        context.Response.Headers.Append("Link",
            "</api/v2/docs>; rel=\"successor-version\"");
    }
});
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window
- Return `410 Gone` after sunset date, not `404`
- Document version differences in OpenAPI specs (Swashbuckle/NSwag)

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success (include Location header) |
| 204 No Content | PUT/DELETE success, no body |
| 400 Bad Request | Validation failure, malformed request |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource, concurrent update |
| 422 Unprocessable | Valid syntax but business rule violation |
| 500 Internal Server | Unhandled exception (never expose details) |

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose stack traces to clients (use ProblemDetails)
❌ Business logic in controllers (delegate to services)
❌ Accept raw strings for IDs (use Guid or typed IDs)
❌ Missing CancellationToken on async actions
❌ Return full entity from Create (return DTO only)
```

## See Also

- `version.instructions.md` — Semantic versioning, pre-release, deprecation timelines
- `graphql.instructions.md` — GraphQL schema, resolvers, DataLoaders (for GraphQL APIs)
- `security.instructions.md` — Auth middleware, input validation, CORS
- `errorhandling.instructions.md` — Error response format, ProblemDetails
- `performance.instructions.md` — Hot-path optimization, async patterns
