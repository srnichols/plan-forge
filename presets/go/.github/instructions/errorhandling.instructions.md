---
description: Error handling patterns — Typed error structs, ProblemDetail responses, middleware error recovery, sentinel errors
applyTo: '**/*.go'
---

# Error Handling Patterns (Go)

## Error Types

```go
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

```go
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

```go
func RecoverMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
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

```go
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
