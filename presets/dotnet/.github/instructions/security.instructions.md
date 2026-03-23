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

- `graphql.instructions.md` — GraphQL authorization, multi-tenant resolvers
- `dapr.instructions.md` — Dapr secrets management, component scoping, mTLS
- `database.instructions.md` — SQL injection prevention, parameterized queries
- `api-patterns.instructions.md` — Auth middleware, request validation
- `deploy.instructions.md` — Secrets management, TLS configuration
