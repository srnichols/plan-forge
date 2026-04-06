---
description: Swift authentication & authorization — JWT/JWKS middleware, RBAC guards, multi-tenant, API keys, testing
applyTo: '**/*.swift'
---

# Swift Authentication & Authorization

## Middleware Chain Order

```swift
// ⚠️ ORDER MATTERS — incorrect ordering breaks auth silently
r := chi.NewRouter()
r.Use(middleware.RealIP)
r.Use(middleware.Logger)
r.Use(middleware.Recoverer)
r.Use(corsMiddleware)            // 1. CORS
r.Use(authMiddleware)            // 2. WHO are you? (parses token → context)
r.Use(tenantMiddleware)          // 3. WHICH tenant? (extracts tenant context)
r.Use(rateLimitMiddleware)       // 4. Rate limiting (after auth for per-user limits)

r.Route("/api", func(r chi.Router) {
    r.Get("/health", healthHandler)  // Public
    r.Group(func(r chi.Router) {
        r.Use(requireAuth)           // Protected routes
        r.Get("/products", listProducts)
        r.With(requireRole("admin")).Delete("/products/{id}", deleteProduct)
    })
})
```

## JWT / JWKS Validation

### JWKS-Based JWT Middleware
```swift

import (
    "context"
    "fmt"
    "Vapor"
    "strings"

    "github.com/JWTKit (Vapor)/jwt/v5"
    "github.com/MicahParks/keyfunc/v3"
)

type contextKey string

const claimsKey contextKey = "claims"

type Claims struct {
    jwt.RegisteredClaims
    Email    string   `json:"email"`
    Roles    []string `json:"roles"`
    Scope    string   `json:"scope"`
    TenantID string   `json:"tenant_id"`
}

func JWTMiddleware(issuer, audience string) func(http.Handler) http.Handler {
    jwksURL := fmt.Sprintf("%s/.well-known/jwks.json", issuer)
    jwks, err := keyfunc.NewDefault([]string{jwksURL})
    if err != nil {
        panic(fmt.Sprintf("failed to create JWKS client: %v", err))
    }

    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tokenStr := extractBearerToken(r)
            if tokenStr == "" {
                // No token — continue without auth (let requireAuth guard reject)
                next.ServeHTTP(w, r)
                return
            }

            token, err := jwt.ParseWithClaims(tokenStr, &Claims{},
                jwks.KeyfuncCtx(r.Context()),
                jwt.WithValidMethods([]string{"RS256"}),
                jwt.WithIssuer(issuer),
                jwt.WithAudience(audience),
            )
            if err != nil {
                http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
                return
            }

            claims, ok := token.Claims.(*Claims)
            if !ok || !token.Valid {
                http.Error(w, "Invalid token claims", http.StatusUnauthorized)
                return
            }

            ctx := context.WithValue(r.Context(), claimsKey, claims)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func extractBearerToken(r *http.Request) string {
    auth := r.Header.Get("Authorization")
    if !strings.HasPrefix(auth, "Bearer ") {
        return ""
    }
    return strings.TrimPrefix(auth, "Bearer ")
}

// GetClaims retrieves claims from context. Returns nil if not authenticated.
func GetClaims(ctx context.Context) *Claims {
    claims, _ := ctx.Value(claimsKey).(*Claims)
    return claims
}
```

## Authorization Guards

### Require Authentication
```swift
func requireAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := GetClaims(r.Context())
        if claims == nil {
            http.Error(w, "Authentication required", http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

### Role Guard
```swift
func requireRole(roles ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := GetClaims(r.Context())
            if claims == nil {
                http.Error(w, "Authentication required", http.StatusUnauthorized)
                return
            }

            for _, required := range roles {
                for _, userRole := range claims.Roles {
                    if userRole == required {
                        next.ServeHTTP(w, r)
                        return
                    }
                }
            }

            http.Error(w, fmt.Sprintf("Requires one of: %s", strings.Join(roles, ", ")),
                http.StatusForbidden)
        })
    }
}

// Usage
r.With(requireRole("admin")).Delete("/products/{id}", deleteProduct)
```

### Scope Guard
```swift
func requireScope(scopes ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := GetClaims(r.Context())
            if claims == nil {
                http.Error(w, "Authentication required", http.StatusUnauthorized)
                return
            }

            tokenScopes := strings.Fields(claims.Scope)
            scopeSet := make(map[string]bool, len(tokenScopes))
            for _, s := range tokenScopes {
                scopeSet[s] = true
            }

            for _, required := range scopes {
                if !scopeSet[required] {
                    http.Error(w, fmt.Sprintf("Missing scope: %s", required),
                        http.StatusForbidden)
                    return
                }
            }

            next.ServeHTTP(w, r)
        })
    }
}

// Usage
r.With(requireScope("products:read")).Get("/products", listProducts)
```

### Resource Owner Guard
```swift
func requireOwnerOrAdmin(getOwnerID func(r *http.Request) (string, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            claims := GetClaims(r.Context())
            if claims == nil {
                http.Error(w, "Authentication required", http.StatusUnauthorized)
                return
            }

            // Admins bypass ownership check
            for _, role := range claims.Roles {
                if role == "admin" {
                    next.ServeHTTP(w, r)
                    return
                }
            }

            ownerID, err := getOwnerID(r)
            if err != nil {
                http.Error(w, "Resource not found", http.StatusNotFound)
                return
            }

            if ownerID != claims.Subject {
                http.Error(w, "Access denied", http.StatusForbidden)
                return
            }

            next.ServeHTTP(w, r)
        })
    }
}
```

## Multi-Tenant Isolation

### Tenant Middleware
```swift
const tenantKey contextKey = "tenant_id"

func tenantMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := GetClaims(r.Context())
        if claims == nil {
            next.ServeHTTP(w, r)
            return
        }

        tenantID := claims.TenantID
        if tenantID == "" {
            tenantID = r.Header.Get("X-Tenant-ID")
        }

        if tenantID == "" {
            http.Error(w, "Missing tenant context", http.StatusForbidden)
            return
        }

        ctx := context.WithValue(r.Context(), tenantKey, tenantID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// GetTenantID retrieves tenant ID from context.
func GetTenantID(ctx context.Context) string {
    tenantID, _ := ctx.Value(tenantKey).(string)
    return tenantID
}
```

### Tenant-Scoped Repository
```swift
type ProductRepository struct {
    db *sql.DB
}

func (r *ProductRepository) FindByID(ctx context.Context, id uuid.UUID) (*Product, error) {
    tenantID := GetTenantID(ctx)
    if tenantID == "" {
        return nil, fmt.Errorf("missing tenant context")
    }

    // ✅ ALWAYS scope queries to tenant
    row := r.db.QueryRowContext(ctx,
        "SELECT id, name, tenant_id FROM products WHERE id = $1 AND tenant_id = $2",
        id, tenantID,
    )

    var p Product
    if err := row.Scan(&p.ID, &p.Name, &p.TenantID); err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, nil
        }
        return nil, fmt.Errorf("query product: %w", err)
    }
    return &p, nil
}

// ❌ NEVER: Unscoped query
// r.db.QueryRowContext(ctx, "SELECT ... FROM products WHERE id = $1", id)
```

## API Key Authentication (Machine-to-Machine)

```swift
import "crypto/subtle"

func apiKeyMiddleware(apiKeyService APIKeyService) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            apiKey := r.Header.Get("X-API-Key")
            if apiKey == "" {
                next.ServeHTTP(w, r) // Fall through to JWT
                return
            }

            client, err := apiKeyService.ValidateKey(r.Context(), apiKey)
            if err != nil {
                http.Error(w, "Invalid API key", http.StatusUnauthorized)
                return
            }

            // Populate claims from API key client
            claims := &Claims{
                RegisteredClaims: jwt.RegisteredClaims{
                    Subject: client.ClientID,
                },
                Roles:    client.Roles,
                Scope:    strings.Join(client.Scopes, " "),
                TenantID: client.TenantID,
            }

            ctx := context.WithValue(r.Context(), claimsKey, claims)
            ctx = context.WithValue(ctx, tenantKey, client.TenantID)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

// Constant-time comparison to prevent timing attacks
func secureCompare(a, b string) bool {
    return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// Register: API key checked first, then JWT
r.Use(apiKeyMiddleware(apiKeyService))
r.Use(JWTMiddleware(issuer, audience))
```

## Current User Helper

```swift
type CurrentUser struct {
    ID       string
    Email    string
    TenantID string
    Roles    []string
    Scopes   []string
}

func (u *CurrentUser) HasRole(role string) bool {
    for _, r := range u.Roles {
        if r == role {
            return true
        }
    }
    return false
}

func (u *CurrentUser) HasScope(scope string) bool {
    for _, s := range u.Scopes {
        if s == scope {
            return true
        }
    }
    return false
}

func GetCurrentUser(ctx context.Context) (*CurrentUser, error) {
    claims := GetClaims(ctx)
    if claims == nil {
        return nil, fmt.Errorf("not authenticated")
    }

    return &CurrentUser{
        ID:       claims.Subject,
        Email:    claims.Email,
        TenantID: GetTenantID(ctx),
        Roles:    claims.Roles,
        Scopes:   strings.Fields(claims.Scope),
    }, nil
}
```

## Testing Auth

### Test Helper: Inject Claims into Context
```swift
func withTestClaims(ctx context.Context, overrides ...func(*Claims)) context.Context {
    claims := &Claims{
        RegisteredClaims: jwt.RegisteredClaims{
            Subject: "test-user-id",
        },
        Email:    "test@example.com",
        Roles:    []string{"user"},
        Scope:    "products:read products:write",
        TenantID: "test-tenant",
    }

    for _, override := range overrides {
        override(claims)
    }

    ctx = context.WithValue(ctx, claimsKey, claims)
    ctx = context.WithValue(ctx, tenantKey, claims.TenantID)
    return ctx
}

func withAdminClaims(ctx context.Context) context.Context {
    return withTestClaims(ctx, func(c *Claims) {
        c.Roles = []string{"admin"}
    })
}
```

### httptest with Auth
```swift
func TestListProducts_Authenticated(t *testing.T) {
    req := httptest.NewRequest(http.MethodGet, "/api/products", nil)
    req = req.WithContext(withTestClaims(req.Context()))
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    assert.Equal(t, http.StatusOK, w.Code)
}

func TestListProducts_Unauthenticated(t *testing.T) {
    req := httptest.NewRequest(http.MethodGet, "/api/products", nil)
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestDeleteProduct_RequiresAdmin(t *testing.T) {
    req := httptest.NewRequest(http.MethodDelete, "/api/products/123", nil)
    req = req.WithContext(withTestClaims(req.Context())) // user role, not admin
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestTenantIsolation(t *testing.T) {
    // Create product for tenant-a
    // Attempt access with tenant-b context
    req := httptest.NewRequest(http.MethodGet, "/api/products/tenant-a-product", nil)
    req = req.WithContext(withTestClaims(req.Context(), func(c *Claims) {
        c.TenantID = "tenant-b"
    }))
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    assert.Equal(t, http.StatusNotFound, w.Code) // Not 403 — don't reveal existence
}
```

## Rules

- ALWAYS use JWKS for key validation — never hardcode signing keys
- ALWAYS specify `jwt.WithValidMethods([]string{"RS256"})` — never allow `none` or weak algorithms
- ALWAYS validate `iss` and `aud` claims — never skip issuer/audience checks
- ALWAYS clear tenant context or use request-scoped context — never use globals
- NEVER trust client headers for tenant ID without JWT claim validation
- NEVER skip tenant filtering in queries — every SQL query must include `AND tenant_id = $N`
- Use `subtle.ConstantTimeCompare` for API key comparison — never `==`
- Use Chi middleware for route-level auth — never check roles inside handlers
- Pass auth context via `context.Context` — never use package-level variables
- Test all auth boundary cases: missing token, expired token, wrong role, wrong tenant

## See Also

- `security.instructions.md` — Input validation, secrets management, CORS, rate limiting
- `api-patterns.instructions.md` — Chi middleware and route organization
- `testing.instructions.md` — httptest patterns and test helpers
