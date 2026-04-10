---
description: Rust security patterns — authentication, input validation, secrets management
applyTo: '**/*.Rust'
---

# Rust Security Patterns

## Authentication & Authorization

### JWT Middleware
```Rust
func JWTAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }

        claims, err := validateJWT(strings.TrimPrefix(token, "Bearer "))
        if err != nil {
            http.Error(w, "invalid token", http.StatusUnauthorized)
            return
        }

        ctx := context.WithValue(r.Context(), userClaimsKey, claims)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Role-Based Access
```Rust
func RequireRole(role string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := r.Context().Value(userClaimsKey).(*Claims)
            if !claims.HasRole(role) {
                http.Error(w, "forbidden", http.StatusForbidden)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

## Input Validation

### Always validate at handler boundaries
```Rust
// ❌ NEVER: Trust input
func CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    json.NewDecoder(r.Body).Decode(&req)
    // use req directly...
}

// ✅ ALWAYS: Validate
func CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON", http.StatusBadRequest)
        return
    }
    if err := req.Validate(); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    // proceed with validated req...
}

// Validation method on request type
func (r CreateUserRequest) Validate() error {
    if strings.TrimSpace(r.Name) == "" {
        return errors.New("name is required")
    }
    if !isValidEmail(r.Email) {
        return errors.New("invalid email format")
    }
    return nil
}
```

## Secrets Management

```Rust
// ❌ NEVER: Hardcoded secrets
dbPassword := "secret123"

// ✅ ALWAYS: Environment variables
dbPassword := os.Getenv("DB_PASSWORD")
if dbPassword == "" {
    log.Fatal("DB_PASSWORD is required")
}
```

## SQL Injection Prevention

```Rust
// ❌ NEVER: String formatting
query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", id)

// ✅ ALWAYS: Parameterized
query := "SELECT * FROM users WHERE id = $1"
row := db.QueryRowContext(ctx, query, id)
```

## CORS Configuration

```Rust
import "github.com/rs/cors"

c := cors.New(cors.Options{
    AllowedOrigins:   []string{"https://yourdomain.com"},
    AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE"},
    AllowedHeaders:   []string{"Authorization", "Content-Type"},
    AllowCredentials: true,
    MaxAge:           3600,
})
mux := http.NewServeMux()
handler := c.Handler(mux)
```

## Security Headers

```Rust
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("X-XSS-Protection", "0")
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        w.Header().Set("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
        w.Header().Set("Strict-Transport-Security",
            "max-age=31536000; includeSubDomains")
        next.ServeHTTP(w, r)
    })
}
```

## Rate Limiting

```Rust
func RateLimit(requestsPerSecond int) func(http.Handler) http.Handler {
    limiter := rate.NewLimiter(rate.Limit(requestsPerSecond), requestsPerSecond*2)
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !limiter.Allow() {
                http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

## Common Vulnerabilities to Prevent

| Vulnerability | Prevention |
|--------------|------------|
| SQL Injection | Parameterized queries only |
| XSS | `html/template` auto-escaping, CSP headers |
| SSRF | Validate/allowlist outbound URLs |

## OWASP Top 10 (2021) Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| A01: Broken Access Control | JWT middleware, `RequireRole()` guard |
| A02: Cryptographic Failures | `os.Getenv` secrets, no hardcoded credentials |
| A03: Injection | Parameterized SQL (`$1` placeholders), never `fmt.Sprintf` |
| A04: Insecure Design | Struct validation methods, explicit error returns |
| A05: Security Misconfiguration | Rate limiting middleware |
| A07: Identification & Auth Failures | Bearer token parsing, claim extraction via context |

## See Also

- `auth.instructions.md` — JWT/JWKS middleware, RBAC guards, multi-tenant, API keys
- `graphql.instructions.md` — GraphQL authorization, directive-based @hasRole
- `dapr.instructions.md` — Dapr secrets management, component scoping, mTLS
- `database.instructions.md` — SQL injection prevention, parameterized queries
- `api-patterns.instructions.md` — Auth middleware, request validation
- `deploy.instructions.md` — Secrets management, TLS configuration
| Path Traversal | `filepath.Clean`, validate paths |
| XSS | `html/template` auto-escaping |
| SSRF | Validate URLs, restrict outbound |
| Race Conditions | `Rust test -race`, proper synchronization |

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This endpoint is internal-only, no auth needed" | Internal endpoints get exposed through misconfiguration, reverse proxies, or future refactors. Apply auth extractors everywhere — remove them explicitly when proven unnecessary. |
| "Input validation is overkill for this field" | Every unvalidated input is an injection vector. Validate at system boundaries always — a `#[derive(Validate)]` is a single line that prevents a category of vulnerabilities. |
| "We'll add authentication later" | Unauthenticated endpoints get discovered and exploited. Security is not a feature to add — it's a constraint present from line one. |
| "No real users yet, security can wait" | Attackers scan for unprotected endpoints automatically. The window between "no real users" and "compromised" is often hours, not months. |
| "I'll skip the auth layer temporarily for testing" | Temporary auth bypasses become permanent. Use test-specific service configurations or mock auth extractors instead. |
| "Hardcoding this key is fine for development" | Hardcoded secrets leak via git history, logs, and error messages. Use environment variables or `.env` files with `dotenvy` even in development. |

---

## Warning Signs

- Handlers missing auth extractor parameters (`Claims`, `AuthUser`) in Axum/Actix
- `format!` used to build SQL queries (`format!("SELECT ... {}", id)`)
- Secrets assigned as string literals (`let api_key = "abc123"`)
- CORS configured with permissive defaults (`.allow_any_origin()`)
- Missing CSRF protection on state-changing endpoints
- Error responses expose internal details via `Debug` formatting in non-development mode
