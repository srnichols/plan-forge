---
description: .NET authentication & authorization — JWT/OIDC, policy-based auth, multi-tenant isolation, API keys, testing
applyTo: '**/*.cs'
---

# .NET Authentication & Authorization

## Middleware Pipeline Order

```csharp
// ⚠️ ORDER MATTERS — incorrect ordering breaks auth silently
var app = builder.Build();

app.UseHttpsRedirection();
app.UseCors();
app.UseAuthentication();   // 1. WHO are you? (parses token → ClaimsPrincipal)
app.UseAuthorization();    // 2. CAN you do this? (checks policies/roles)
app.UseRateLimiter();
app.MapControllers();
```

## JWT / OpenID Connect Setup

### OIDC with Identity Provider (Entra ID / Auth0 / Keycloak)
```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Auth:Authority"];
        options.Audience = builder.Configuration["Auth:Audience"];
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1), // Default 5 min is too generous
            NameClaimType = "name",
            RoleClaimType = "roles",
        };

        // Map external claims to internal user context
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                var tenantId = context.Principal?.FindFirst("tenant_id")?.Value;
                if (!string.IsNullOrEmpty(tenantId))
                {
                    var identity = (ClaimsIdentity)context.Principal!.Identity!;
                    identity.AddClaim(new Claim("tenant_id", tenantId));
                }
                return Task.CompletedTask;
            },
        };
    });
```

### Configuration (appsettings.json)
```json
{
  "Auth": {
    "Authority": "https://login.microsoftonline.com/{tenant-id}/v2.0",
    "Audience": "api://{client-id}"
  }
}
```

## Policy-Based Authorization

### Define Policies at Startup
```csharp
builder.Services.AddAuthorization(options =>
{
    // Role-based
    options.AddPolicy("RequireAdmin", policy =>
        policy.RequireRole("Admin"));

    // Claim-based
    options.AddPolicy("RequireVerifiedEmail", policy =>
        policy.RequireClaim("email_verified", "true"));

    // Scope-based (OAuth2 scopes)
    options.AddPolicy("ReadProducts", policy =>
        policy.RequireClaim("scope", "products.read"));

    options.AddPolicy("WriteProducts", policy =>
        policy.RequireClaim("scope", "products.write"));

    // Multi-requirement
    options.AddPolicy("RequireOrgAdmin", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireRole("Admin");
        policy.RequireClaim("org_id");
    });

    // Custom requirement
    options.AddPolicy("MinimumAge", policy =>
        policy.AddRequirements(new MinimumAgeRequirement(18)));
});
```

### Custom Authorization Requirement
```csharp
public class MinimumAgeRequirement : IAuthorizationRequirement
{
    public int MinimumAge { get; }
    public MinimumAgeRequirement(int minimumAge) => MinimumAge = minimumAge;
}

public class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, MinimumAgeRequirement requirement)
    {
        var dob = context.User.FindFirst("date_of_birth")?.Value;
        if (dob != null && DateTime.TryParse(dob, out var dateOfBirth))
        {
            var age = DateTime.Today.Year - dateOfBirth.Year;
            if (age >= requirement.MinimumAge)
                context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

// Register
builder.Services.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>();
```

### Apply to Endpoints
```csharp
[Authorize(Policy = "ReadProducts")]
[HttpGet]
public async Task<IActionResult> GetProducts(CancellationToken ct) { ... }

[Authorize(Policy = "WriteProducts")]
[HttpPost]
public async Task<IActionResult> CreateProduct(
    CreateProductRequest request, CancellationToken ct) { ... }

// Minimal API
app.MapGet("/products", GetProducts).RequireAuthorization("ReadProducts");
```

## Multi-Tenant Isolation

### Extracting Tenant Context
```csharp
public interface ITenantContext
{
    string TenantId { get; }
}

public class TenantContext : ITenantContext
{
    public string TenantId { get; set; } = string.Empty;
}

// Middleware to extract tenant from JWT
public class TenantMiddleware
{
    private readonly RequestDelegate _next;

    public TenantMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ITenantContext tenantContext)
    {
        var tenantId = context.User.FindFirst("tenant_id")?.Value
            ?? context.Request.Headers["X-Tenant-Id"].FirstOrDefault();

        if (string.IsNullOrEmpty(tenantId) && context.User.Identity?.IsAuthenticated == true)
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new { error = "Missing tenant context" });
            return;
        }

        ((TenantContext)tenantContext).TenantId = tenantId ?? string.Empty;
        await _next(context);
    }
}

// Registration
builder.Services.AddScoped<ITenantContext, TenantContext>();
app.UseAuthentication();
app.UseMiddleware<TenantMiddleware>(); // After auth, before authorization
app.UseAuthorization();
```

### Tenant-Scoped Queries
```csharp
// ✅ Repository ALWAYS filters by tenant
public async Task<Product?> GetByIdAsync(Guid id, CancellationToken ct)
{
    return await _context.Products
        .Where(p => p.TenantId == _tenantContext.TenantId)
        .FirstOrDefaultAsync(p => p.Id == id, ct);
}

// ❌ NEVER: Query without tenant filter
public async Task<Product?> GetByIdAsync(Guid id, CancellationToken ct)
{
    return await _context.Products.FindAsync(id, ct); // Cross-tenant data leak!
}
```

## API Key Authentication (Machine-to-Machine)

```csharp
public class ApiKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private const string ApiKeyHeader = "X-API-Key";

    public ApiKeyAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger, UrlEncoder encoder) : base(options, logger, encoder) { }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(ApiKeyHeader, out var extractedKey))
            return AuthenticateResult.NoResult(); // Fall through to other schemes

        var apiKeyService = Context.RequestServices.GetRequiredService<IApiKeyService>();
        var client = await apiKeyService.ValidateKeyAsync(extractedKey!);

        if (client is null)
            return AuthenticateResult.Fail("Invalid API key.");

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, client.ClientId),
            new Claim("client_name", client.Name),
            new Claim("tenant_id", client.TenantId),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }
}

// Register alongside JWT
builder.Services.AddAuthentication()
    .AddJwtBearer()
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>("ApiKey", null);

builder.Services.AddAuthorization(options =>
{
    options.DefaultPolicy = new AuthorizationPolicyBuilder()
        .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme, "ApiKey")
        .RequireAuthenticatedUser()
        .Build();
});
```

## Current User Service

```csharp
public interface ICurrentUser
{
    string Id { get; }
    string Email { get; }
    string TenantId { get; }
    IReadOnlyList<string> Roles { get; }
    bool IsInRole(string role);
    bool HasScope(string scope);
}

public class CurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _accessor;

    public CurrentUser(IHttpContextAccessor accessor) => _accessor = accessor;

    private ClaimsPrincipal User => _accessor.HttpContext?.User
        ?? throw new InvalidOperationException("No HTTP context");

    public string Id => User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty;
    public string Email => User.FindFirst(ClaimTypes.Email)?.Value ?? string.Empty;
    public string TenantId => User.FindFirst("tenant_id")?.Value ?? string.Empty;
    public IReadOnlyList<string> Roles => User.FindAll(ClaimTypes.Role).Select(c => c.Value).ToList();
    public bool IsInRole(string role) => User.IsInRole(role);
    public bool HasScope(string scope) => User.HasClaim("scope", scope);
}

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
```

## Testing Auth

### Unit Test with Fake ClaimsPrincipal
```csharp
public static ClaimsPrincipal CreateTestUser(
    string userId = "test-user-id",
    string tenantId = "test-tenant",
    params string[] roles)
{
    var claims = new List<Claim>
    {
        new(ClaimTypes.NameIdentifier, userId),
        new("tenant_id", tenantId),
    };
    claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));

    return new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
}
```

### Integration Test with WebApplicationFactory
```csharp
public class AuthenticatedApiFixture : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            // Replace JWT auth with a test scheme
            services.AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", null);

            services.PostConfigure<JwtBearerOptions>(
                JwtBearerDefaults.AuthenticationScheme, o => { });
        });
    }
}

public class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger, UrlEncoder encoder) : base(options, logger, encoder) { }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // Extract test claims from a custom header
        var userId = Request.Headers["X-Test-UserId"].FirstOrDefault() ?? "test-user";
        var tenantId = Request.Headers["X-Test-TenantId"].FirstOrDefault() ?? "test-tenant";

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId),
            new Claim("tenant_id", tenantId),
            new Claim(ClaimTypes.Role, "User"),
        };

        var identity = new ClaimsIdentity(claims, "Test");
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
    }
}
```

## Rules

- ALWAYS place `UseAuthentication()` before `UseAuthorization()` in the pipeline
- NEVER trust client-provided tenant IDs without validating against the JWT
- NEVER skip tenant filtering in repositories — every query must be scoped
- ALWAYS use policy-based authorization over role checks in services
- ALWAYS validate `audience` and `issuer` — never disable validation
- NEVER store tokens in localStorage — use HttpOnly secure cookies for web apps
- Use `ICurrentUser` service abstraction — never access `HttpContext.User` directly in services
- Keep `ClockSkew` minimal (1-2 minutes) — the default 5 minutes is too generous
- API keys are for M2M only — never use for user authentication

## See Also

- `security.instructions.md` — Input validation, secrets management, CORS, rate limiting
- `graphql.instructions.md` — GraphQL resolver-level authorization
- `api-patterns.instructions.md` — Auth middleware in controller pipelines
