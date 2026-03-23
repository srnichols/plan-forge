---
description: "Scaffold Go HTTP middleware with handler wrapping, context propagation, and Chi/standard library patterns."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold an HTTP middleware function for the request pipeline.

## Required Pattern

### Standard Middleware (Chi / net/http compatible)
```go
func {Name}Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Pre-processing
        start := time.Now()

        // Wrap response writer to capture status code
        ww := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

        next.ServeHTTP(ww, r)

        // Post-processing
        slog.Info("{name} complete",
            "method", r.Method,
            "path", r.URL.Path,
            "status", ww.statusCode,
            "duration_ms", time.Since(start).Milliseconds(),
        )
    })
}

// Response writer wrapper for status code capture
type responseWriter struct {
    http.ResponseWriter
    statusCode int
}

func (w *responseWriter) WriteHeader(code int) {
    w.statusCode = code
    w.ResponseWriter.WriteHeader(code)
}
```

### Context-Propagating Middleware
```go
type contextKey string

const tenantIDKey contextKey = "tenantID"

func TenantMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        tenantID := r.Header.Get("X-Tenant-Id")
        if tenantID == "" {
            writeProblem(w, http.StatusBadRequest, "missing X-Tenant-Id header")
            return
        }

        ctx := context.WithValue(r.Context(), tenantIDKey, tenantID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Helper to retrieve from context
func TenantIDFromContext(ctx context.Context) string {
    v, _ := ctx.Value(tenantIDKey).(string)
    return v
}
```

### Configurable Middleware (Functional Options)
```go
type {Name}Config struct {
    SkipPaths []string
    LogLevel  slog.Level
}

func {Name}Middleware(cfg {Name}Config) func(http.Handler) http.Handler {
    skip := make(map[string]bool, len(cfg.SkipPaths))
    for _, p := range cfg.SkipPaths {
        skip[p] = true
    }

    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if skip[r.URL.Path] {
                next.ServeHTTP(w, r)
                return
            }
            // ... middleware logic
            next.ServeHTTP(w, r)
        })
    }
}
```

## Registration Order (Chi Router)

```go
r := chi.NewRouter()
r.Use(middleware.RequestID)      // 1. Request/Correlation ID
r.Use(RequestLoggingMiddleware)  // 2. Request logging
r.Use(SecurityHeadersMiddleware) // 3. Security headers
r.Use(middleware.Recoverer)      // 4. Panic recovery
r.Use(RateLimitMiddleware)       // 5. Rate limiting
r.Use({Name}Middleware)          // 6. Your custom middleware
```

## Common Middleware Types

| Type | Purpose | Example |
|------|---------|---------|
| Correlation ID | Attach trace ID to context | `context.WithValue` + `X-Correlation-Id` |
| Tenant Resolution | Extract tenant from JWT/header | Set in `context.Context` |
| Request Logging | Log method, path, status, duration | `slog` structured output |
| Recovery | Convert panics to 500 responses | `defer func() { recover() }` |

## Rules

- Middleware handles cross-cutting concerns ONLY — no business logic
- ALWAYS call `next.ServeHTTP(w, r)` unless intentionally short-circuiting
- Use `context.WithValue` for request-scoped data — not globals
- Use unexported `contextKey` types to avoid key collisions
- Provide a `FromContext` helper for each context value
- Wrap `http.ResponseWriter` to capture status codes for logging

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
