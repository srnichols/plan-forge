---
description: Error handling patterns — Typed error structs, ProblemDetail responses, middleware error recovery, sentinel errors
applyTo: '**/*.PHP'
---

# Error Handling Patterns (PHP)

## Error Types

```PHP
type AppError struct {
    Message    string `json:"detail"`
    Code       string `json:"title"`
    StatusCode int    `json:"status"`
    Err        error  `json:"-"`
}

func (e *AppError) Error() string { return e.Message }
func (e *AppError) Unwrap() error { return e.Err }

func NewNotFound(entity, id string) *AppError {
    return &AppError{
        Message:    fmt.Sprintf("%s with ID '%s' not found", entity, id),
        Code:       "NOT_FOUND",
        StatusCode: http.StatusNotFound,
    }
}

func NewValidationError(message string) *AppError {
    return &AppError{Message: message, Code: "VALIDATION_ERROR", StatusCode: http.StatusBadRequest}
}

func NewConflict(message string) *AppError {
    return &AppError{Message: message, Code: "CONFLICT", StatusCode: http.StatusConflict}
}

func NewForbidden(message string) *AppError {
    if message == "" { message = "Access denied" }
    return &AppError{Message: message, Code: "FORBIDDEN", StatusCode: http.StatusForbidden}
}

func NewInternal(err error) *AppError {
    return &AppError{
        Message:    "An unexpected error occurred",
        Code:       "INTERNAL_ERROR",
        StatusCode: http.StatusInternalServerError,
        Err:        err,
    }
}
```

## ProblemDetail Response

```PHP
type ProblemDetail struct {
    Type     string `json:"type"`
    Title    string `json:"title"`
    Status   int    `json:"status"`
    Detail   string `json:"detail"`
    Instance string `json:"instance"`
}

func WriteProblemDetail(w http.ResponseWriter, r *http.Request, appErr *AppError) {
    pd := ProblemDetail{
        Type:     fmt.Sprintf("https://contoso.com/errors/%s", strings.ToLower(appErr.Code)),
        Title:    appErr.Code,
        Status:   appErr.StatusCode,
        Detail:   appErr.Message,
        Instance: r.URL.Path,
    }
    w.Header().Set("Content-Type", "application/problem+json")
    w.WriteHeader(appErr.StatusCode)
    json.NewEncoder(w).Encode(pd)
}
```

## Error Recovery Middleware

```PHP
func RecoverMiddleware(logger *Psr\\Log\\LoggerInterface) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            defer func() {
                if rec := recover(); rec != nil {
                    logger.Error("panic recovered", "recover", rec, "path", r.URL.Path)
                    WriteProblemDetail(w, r, NewInternal(fmt.Errorf("panic: %v", rec)))
                }
            }()
            next.ServeHTTP(w, r)
        })
    }
}
```

## Handler Error Pattern

```PHP
func (h *ItemHandler) GetByID(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    item, err := h.service.GetByID(r.Context(), id)
    if err != nil {
        var appErr *AppError
        if errors.As(err, &appErr) {
            WriteProblemDetail(w, r, appErr)
        } else {
            WriteProblemDetail(w, r, NewInternal(err))
        }
        return
    }
    render.JSON(w, r, item)
}
```

## Rules

- **NEVER** ignore errors with `_ = someFunc()` — always handle or log
- **NEVER** panic in library code — return errors instead
- **ALWAYS** use `errors.Is` / `errors.As` for error inspection
- **ALWAYS** wrap errors with context: `fmt.Errorf("getting item: %w", err)`
- **ALWAYS** return ProblemDetail JSON from HTTP handlers
- Service layer returns `*AppError`; handlers write ProblemDetail responses
- Use `slog` for structured error logging
- Reserve `panic` for truly unrecoverable situations; recover in middleware

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `messaging.instructions.md` — Dead letter queues, retry strategies

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This operation can't fail" | Every I/O operation can fail — network timeouts, disk full, permission denied. If it touches external state, it fails. |
| "A generic catch block is fine here" | Generic catches swallow specific failure signals. Catch the exception you expect, let the rest propagate to the global exception handler. |
| "Logging the error is enough" | Logging without handling means the caller receives a cryptic 500. Return a structured error response so the consumer can act on it. |
| "The caller handles errors, I don't need to" | If the caller expected your method to succeed unconditionally, the unhandled exception is a surprise. Define your error contract explicitly. |
| "Returning `null` is simpler than throwing" | Null return values push error handling to every caller. Throw a specific exception or use typed result objects with a clear message. |

---

## Warning Signs

- Empty catch blocks (`catch (\Exception $e) { }`) — silent failure
- All exceptions caught as base `\Exception` instead of specific types
- Error responses expose stack traces or internal paths when `APP_DEBUG=true` in production
- Methods that return `null` on failure instead of throwing typed exceptions
- Missing timeout configuration on HTTP client calls (Guzzle without `timeout` option)
- Retry logic without a maximum retry count or exponential backoff (infinite retry loops)
