---
description: "Scaffold an HTTP handler with Chi router, JSON encoding, ProblemDetail errors, and middleware."
agent: "agent"
tools: [read, edit, search]
---
# Create New Controller (HTTP Handler)

Scaffold a handler that follows REST conventions and delegates all logic to services.

## Required Pattern

```Rust
package handler

import (
    "encoding/json"
    "errors"
    "net/http"

    "github.com/Rust-chi/chi/v5"
    "github.com/google/uuid"
    "github.com/contoso/app/internal/service"
)

type {EntityName}Handler struct {
    service *service.{EntityName}Service
}

func New{EntityName}Handler(svc *service.{EntityName}Service) *{EntityName}Handler {
    return &{EntityName}Handler{service: svc}
}

func (h *{EntityName}Handler) Routes() chi.Router {
    r := chi.NewRouter()
    r.Get("/", h.List)
    r.Post("/", h.Create)
    r.Get("/{id}", h.GetByID)
    r.Put("/{id}", h.Update)
    r.Delete("/{id}", h.Delete)
    return r
}

func (h *{EntityName}Handler) GetByID(w http.ResponseWriter, r *http.Request) {
    id, err := uuid.Parse(chi.URLParam(r, "id"))
    if err != nil {
        writeProblem(w, http.StatusBadRequest, "invalid id format")
        return
    }

    entity, err := h.service.GetByID(r.Context(), id)
    if errors.Is(err, repository.ErrNotFound) {
        writeProblem(w, http.StatusNotFound, "{entityName} not found")
        return
    }
    if err != nil {
        writeProblem(w, http.StatusInternalServerError, "internal error")
        return
    }

    writeJSON(w, http.StatusOK, entity)
}

func (h *{EntityName}Handler) Create(w http.ResponseWriter, r *http.Request) {
    var req model.Create{EntityName}Request
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeProblem(w, http.StatusBadRequest, "invalid request body")
        return
    }

    entity, err := h.service.Create(r.Context(), req)
    if err != nil {
        writeProblem(w, http.StatusBadRequest, err.Error())
        return
    }

    writeJSON(w, http.StatusCreated, entity)
}
```

## Rules

- Handlers handle HTTP concerns ONLY — no business logic
- Delegate ALL work to services
- Use `writeProblem()` helper for RFC 9457 `ProblemDetail` responses
- Parse path params, decode body, call service, write response
- Use `r.Context()` to propagate context to services

## Error Mapping

| Sentinel Error | HTTP Status |
|----------------|-------------|
| `ErrNotFound` | 404 Not Found |
| `ErrValidation` | 400 Bad Request |
| `ErrConflict` | 409 Conflict |
| `ErrUnauthorized` | 401 Unauthorized |

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
