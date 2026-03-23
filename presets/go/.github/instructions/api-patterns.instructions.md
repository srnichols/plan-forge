---
description: API patterns for Go — REST conventions, Chi/Gin handlers, validation, pagination, error responses
applyTo: '**/*handler*,**/*Handler*,**/*route*,**/*Route*,**/handler/**,**/api/**'
---

# Go API Patterns

## REST Conventions

### Handler Structure (Chi Router)
```go
func (h *ProducerHandler) Routes() chi.Router {
    r := chi.NewRouter()
    r.Get("/", h.List)
    r.Post("/", h.Create)
    r.Get("/{id}", h.GetByID)
    r.Put("/{id}", h.Update)
    r.Delete("/{id}", h.Delete)
    return r
}

// GET /api/producers
func (h *ProducerHandler) List(w http.ResponseWriter, r *http.Request) {
    page, _ := strconv.Atoi(r.URL.Query().Get("page"))
    if page < 1 { page = 1 }
    pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
    if pageSize < 1 || pageSize > 100 { pageSize = 25 }

    result, err := h.service.GetPaged(r.Context(), page, pageSize)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "Failed to fetch producers")
        return
    }
    writeJSON(w, http.StatusOK, result)
}

// GET /api/producers/{id}
func (h *ProducerHandler) GetByID(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    producer, err := h.service.GetByID(r.Context(), id)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "Internal error")
        return
    }
    if producer == nil {
        writeError(w, http.StatusNotFound, "Producer not found")
        return
    }
    writeJSON(w, http.StatusOK, producer)
}

// POST /api/producers
func (h *ProducerHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateProducerRequest
    if err := decodeAndValidate(r, &req); err != nil {
        writeError(w, http.StatusBadRequest, err.Error())
        return
    }
    created, err := h.service.Create(r.Context(), &req)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "Failed to create producer")
        return
    }
    w.Header().Set("Location", fmt.Sprintf("/api/producers/%s", created.ID))
    writeJSON(w, http.StatusCreated, created)
}
```

## Error Responses (RFC 9457 Problem Details)
```go
type ProblemDetail struct {
    Type   string `json:"type"`
    Title  string `json:"title"`
    Status int    `json:"status"`
    Detail string `json:"detail,omitempty"`
}

func writeError(w http.ResponseWriter, status int, detail string) {
    pd := ProblemDetail{
        Type:   fmt.Sprintf("https://tools.ietf.org/html/rfc9110#section-15.5.%d", status-399),
        Title:  http.StatusText(status),
        Status: status,
        Detail: detail,
    }
    w.Header().Set("Content-Type", "application/problem+json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(pd)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}
```

## Request Validation
```go
type CreateProducerRequest struct {
    Name         string   `json:"name" validate:"required,max=200"`
    ContactEmail string   `json:"contact_email" validate:"required,email"`
    Latitude     *float64 `json:"latitude" validate:"omitempty,min=-90,max=90"`
    Longitude    *float64 `json:"longitude" validate:"omitempty,min=-180,max=180"`
}

func (r *CreateProducerRequest) Validate() error {
    if r.Name == "" {
        return errors.New("name is required")
    }
    if len(r.Name) > 200 {
        return errors.New("name must be 200 characters or fewer")
    }
    // ... additional validation
    return nil
}

func decodeAndValidate(r *http.Request, dst any) error {
    if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
        return fmt.Errorf("invalid JSON: %w", err)
    }
    if v, ok := dst.(interface{ Validate() error }); ok {
        return v.Validate()
    }
    return nil
}
```

## Pagination
```go
type PagedResult[T any] struct {
    Items       []T  `json:"items"`
    Page        int  `json:"page"`
    PageSize    int  `json:"page_size"`
    TotalCount  int  `json:"total_count"`
    TotalPages  int  `json:"total_pages"`
    HasNext     bool `json:"has_next"`
    HasPrevious bool `json:"has_previous"`
}

func NewPagedResult[T any](items []T, page, pageSize, totalCount int) PagedResult[T] {
    totalPages := int(math.Ceil(float64(totalCount) / float64(pageSize)))
    return PagedResult[T]{
        Items: items, Page: page, PageSize: pageSize,
        TotalCount: totalCount, TotalPages: totalPages,
        HasNext: page < totalPages, HasPrevious: page > 1,
    }
}
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success (include Location header) |
| 204 No Content | PUT/DELETE success, no body |
| 400 Bad Request | Validation failure, malformed JSON |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource |
| 422 Unprocessable | Valid syntax but business rule violation |
| 500 Internal Server | Unhandled error (never expose internals) |

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose error internals to clients (log details server-side only)
❌ Business logic in handlers (delegate to service layer)
❌ Decode into map[string]interface{} (always use typed structs)
❌ Ignore Decode errors (always validate and return 400)
❌ Missing Content-Type header on responses
```

## See Also

- `security.instructions.md` — JWT middleware, input validation
- `errorhandling.instructions.md` — Error response format, ProblemDetail
- `performance.instructions.md` — Hot-path optimization, concurrency patterns
