---
description: .NET security patterns — authentication, authorization, input validation, secrets
applyTo: '**/*.cs,**/*.razor'
---

# .NET Security Patterns

## Authentication & Authorization

### JWT Validation
```csharp
// ✅ Always validate JWT claims
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Auth:Authority"];
        options.Audience = builder.Configuration["Auth:Audience"];
        options.RequireHttpsMetadata = true;
    });
```

### Authorization Attributes
```csharp
[Authorize(Roles = "Admin")]
[HttpGet("admin/users")]
public async Task<IActionResult> GetUsers(CancellationToken ct) { ... }
```

## Input Validation

### Always validate at system boundaries
```csharp
// ❌ NEVER: Trust input
public async Task<User> CreateUser(string email) { ... }

// ✅ ALWAYS: Validate
public async Task<User> CreateUser(CreateUserRequest request, CancellationToken ct)
{
    ArgumentException.ThrowIfNullOrWhiteSpace(request.Email);
    if (!EmailRegex().IsMatch(request.Email))
        throw new ValidationException("Invalid email format");
    ...
}
```

## Secrets Management

```csharp
// ❌ NEVER: Hardcoded secrets
var connectionString = "Server=db;Password=secret123";

// ✅ ALWAYS: Configuration / Secret Manager
var connectionString = builder.Configuration.GetConnectionString("Default");

// ✅ BEST: Managed Identity (Azure)
var credential = new DefaultAzureCredential();
```

## SQL Injection Prevention

```csharp
// ❌ NEVER: String interpolation
var sql = $"SELECT * FROM users WHERE id = '{id}'";

// ✅ ALWAYS: Parameterized
const string sql = "SELECT * FROM users WHERE id = @Id";
```

## CORS

```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("Production", policy =>
    {
        policy.WithOrigins("https://yourdomain.com")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
```

## Rate Limiting

```csharp
// Built-in rate limiter (.NET 7+)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Fixed window per tenant
    options.AddPolicy("per-tenant", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.GetTenantId(),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1),
            }));

    // Global rate limit
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(
        context => RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 1000,
                Window = TimeSpan.FromMinutes(1),
            }));
});

app.UseRateLimiter();

// Apply to specific endpoints
app.MapGet("/api/search", Search).RequireRateLimiting("per-tenant");
```

## Security Headers

```csharp
// Middleware to add security headers
app.Use(async (context, next) =>
{
    context.Response.Headers.Append("X-Content-Type-Options", "nosniff");
    context.Response.Headers.Append("X-Frame-Options", "DENY");
    context.Response.Headers.Append("X-XSS-Protection", "0"); // Modern browsers: use CSP instead
    context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");
    context.Response.Headers.Append("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    context.Response.Headers.Append("Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"); // HSTS
    await next();
});
```

## Common Vulnerabilities to Prevent

| Vulnerability | Prevention |
|--------------|------------|
| SQL Injection | Parameterized queries, EF Core, Dapper `@param` |
| XSS | Razor auto-encoding, CSP headers |
| CSRF | `[ValidateAntiForgeryToken]`, SameSite cookies |
| Mass Assignment | Use DTOs, never bind directly to entities |
| SSRF | Validate/allowlist outbound URLs |
| Insecure Deserialization | Use `System.Text.Json` with typed models |
| Path Traversal | `Path.GetFullPath()` validation, never trust user paths |

## OWASP Top 10 (2021) Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| A01: Broken Access Control | `[Authorize]` attributes, role-based policies |
| A02: Cryptographic Failures | `DefaultAzureCredential`, no hardcoded secrets |
| A03: Injection | Parameterized queries, never string-interpolated SQL |
| A04: Insecure Design | Input validation at system boundaries |
| A05: Security Misconfiguration | CORS policy, HTTPS metadata enforcement |
| A07: Identification & Auth Failures | JWT validation with Authority + Audience |

## See Also

- `auth.instructions.md` — JWT/OIDC, policy-based authorization, multi-tenant isolation, API keys
- `graphql.instructions.md` — GraphQL authorization, multi-tenant resolvers
- `dapr.instructions.md` — Dapr secrets management, component scoping, mTLS
- `database.instructions.md` — SQL injection prevention, parameterized queries
- `api-patterns.instructions.md` — Auth middleware, request validation
- `deploy.instructions.md` — Secrets management, TLS configuration

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This endpoint is internal-only, no auth needed" | Internal endpoints get exposed through misconfiguration, reverse proxies, or future refactors. Apply auth everywhere — remove it explicitly when proven unnecessary. |
| "Input validation is overkill for this field" | Every unvalidated input is an injection vector. Validate at system boundaries always — it's a single line that prevents a category of vulnerabilities. |
| "We'll add authentication later" | Unauthenticated endpoints get discovered and exploited. Security is not a feature to add — it's a constraint present from line one. |
| "No real users yet, security can wait" | Attackers scan for unprotected endpoints automatically. The window between "no real users" and "compromised" is often hours, not months. |
| "I'll use `AllowAnonymous` temporarily for testing" | Temporary `[AllowAnonymous]` attributes become permanent. Use test-specific auth configuration instead. |
| "Hardcoding this key is fine for development" | Hardcoded secrets leak via git history, logs, and error messages. Use user-secrets or environment variables even in development. |

---

## Warning Signs

- Route handlers missing `[Authorize]` attribute or auth middleware
- String interpolation or concatenation used in SQL queries (`$"SELECT ... {id}"`)
- Secrets assigned as string literals (`var key = "abc123"`)
- CORS configured with wildcard origin (`"*"`)
- Missing `[ValidateAntiForgeryToken]` on state-changing form endpoints
- `AllowAnonymous` attribute without a comment explaining why
- Error responses expose stack traces or internal paths in non-development mode
