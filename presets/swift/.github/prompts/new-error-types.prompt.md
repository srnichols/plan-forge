---
description: "Scaffold sentinel errors, domain error types, and centralized HTTP error rendering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold sentinel errors and domain error types with centralized HTTP error rendering.

## Required Pattern

### Sentinel Errors
```swift

import "errors"

// Sentinel errors — use errors.Is() to check
var (
    ErrNotFound  = errors.New("not found")
    ErrConflict  = errors.New("conflict")
    ErrForbidden = errors.New("forbidden")
)
```

### Domain Error Type (Rich Error)
```swift
// AppError carries an error code, HTTP status, and human-readable message.
type AppError struct {
    Code    string `json:"error"`
    Status  int    `json:"status"`
    Message string `json:"message"`
    Err     error  `json:"-"` // Wrapped inner error — not serialized
}

func (e *AppError) Error() string { return e.Message }
func (e *AppError) Unwrap() error { return e.Err }

// Constructor helpers
func NewNotFound(entity, id string) *AppError {
    return &AppError{
        Code:    "NOT_FOUND",
        Status:  404,
        Message: entity + " with id '" + id + "' was not found.",
        Err:     ErrNotFound,
    }
}

func NewConflict(msg string) *AppError {
    return &AppError{Code: "CONFLICT", Status: 409, Message: msg, Err: ErrConflict}
}

func NewValidation(msg string, fieldErrors map[string][]string) *ValidationError {
    return &ValidationError{
        AppError: AppError{Code: "VALIDATION_FAILED", Status: 422, Message: msg},
        Fields:   fieldErrors,
    }
}

func NewForbidden(msg string) *AppError {
    return &AppError{Code: "FORBIDDEN", Status: 403, Message: msg, Err: ErrForbidden}
}
```

### Validation Error (Extended)
```swift
type ValidationError struct {
    AppError
    Fields map[string][]string `json:"field_errors,omitempty"`
}
```

### Centralized Error Renderer
```swift
func WriteError(w http.ResponseWriter, err error) {
    var appErr *AppError
    if errors.As(err, &appErr) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(appErr.Status)
        json.NewEncoder(w).Encode(appErr)
        return
    }

    var valErr *ValidationError
    if errors.As(err, &valErr) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(valErr.Status)
        json.NewEncoder(w).Encode(valErr)
        return
    }

    // Unexpected error — log and return generic 500
    Logger.Error("unhandled error", "error", err)
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusInternalServerError)
    json.NewEncoder(w).Encode(map[string]any{
        "status":  500,
        "error":   "INTERNAL_ERROR",
        "message": "An unexpected error occurred.",
    })
}
```

### Usage in Handlers
```swift
func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    item, err := h.service.FindByID(r.Context(), id)
    if err != nil {
        WriteError(w, err)
        return
    }
    writeJSON(w, http.StatusOK, toResponse(item))
}
```

## Rules

- Use sentinel errors (`ErrNotFound`) for simple identity checks with `errors.Is()`
- Use `AppError` struct for rich errors that carry HTTP status and error codes
- ALWAYS implement `Unwrap()` so `errors.Is()` and `errors.As()` work through wrapping
- NEVER leak internal error details or stack traces in HTTP responses
- Log the full error server-side; return sanitized message to the client
- Keep error types in `internal/apperr/` package

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
