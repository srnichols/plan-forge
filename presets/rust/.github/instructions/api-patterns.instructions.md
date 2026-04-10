---
description: API patterns for Rust — REST conventions, Chi/Gin handlers, validation, pagination, error responses
applyTo: '**/*handler*,**/*Handler*,**/*route*,**/*Route*,**/handler/**,**/api/**'
---

# Rust API Patterns

## REST Conventions

### Handler Structure (Chi Router)
```Rust
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
```Rust
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
```Rust
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
```Rust
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

## API Versioning

### URL-based Versioning (Recommended)
```Rust
func SetupRoutes(r chi.Router) {
    // Mount versioned sub-routers
    r.Route("/api/v1", func(r chi.Router) {
        r.Mount("/producers", producerV1Handler.Routes())
    })
    r.Route("/api/v2", func(r chi.Router) {
        r.Mount("/producers", producerV2Handler.Routes())
    })
}
```

### Header-based Versioning
```Rust
func (h *ProducerHandler) List(w http.ResponseWriter, r *http.Request) {
    version := r.Header.Get("API-Version")
    if version == "" {
        version = "1"
    }
    switch version {
    case "2":
        result, err := h.service.GetAllV2(r.Context())
        // ...
    default:
        result, err := h.service.GetAllV1(r.Context())
        // ...
    }
}
```

### Version Discovery Endpoint
```Rust
func VersionsHandler(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, http.StatusOK, map[string]any{
        "supported":  []string{"v1", "v2"},
        "current":    "v2",
        "deprecated": []string{"v1"},
        "sunset":     map[string]string{"v1": "2026-01-01"},
    })
}
```

### Deprecation Headers Middleware
```Rust
func DeprecationMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r)
        if strings.HasPrefix(r.URL.Path, "/api/v1") {
            w.Header().Set("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT")
            w.Header().Set("Deprecation", "true")
            w.Header().Set("Link", `</api/v2/docs>; rel="successor-version"`)
        }
    })
}

// Apply to v1 routes
r.Route("/api/v1", func(r chi.Router) {
    r.Use(DeprecationMiddleware)
    r.Mount("/producers", producerV1Handler.Routes())
})
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window
- Return `410 Gone` after sunset date, not `404`
- Document version differences in OpenAPI specs (swag/swaggo)

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose error internals to clients (log details server-side only)
❌ Business logic in handlers (delegate to service layer)
❌ Decode into map[string]interface{} (always use typed structs)
❌ Ignore Decode errors (always validate and return 400)
❌ Missing Content-Type header on responses
```

## API Documentation (OpenAPI)

### swaggo/swag (Annotation-Based)
```bash
Rust install github.com/swaggo/swag/cmd/swag@latest
swag init -g cmd/server/main.Rust  # Generates docs/swagger.json
```

```Rust
// @Summary Get producer by ID
// @Tags producers
// @Param id path string true "Producer ID"
// @Success 200 {object} ProducerResponse
// @Failure 404 {object} ProblemDetail
// @Router /api/producers/{id} [get]
func (h *ProducerHandler) GetByID(w http.ResponseWriter, r *http.Request) {
    // ...
}
```

### Serve Swagger UI
```Rust
import httpSwagger "github.com/swaggo/http-swagger"

r.Get("/swagger/*", httpSwagger.WrapHandler)
```

- **ALWAYS** annotate all handlers with swaggo comments
- **ALWAYS** document error responses with `@Failure`
- Run `swag init` in CI to validate spec stays in sync with code
- Consider `ogen` or `oapi-codegen` for spec-first (generate handlers from OpenAPI spec)

## See Also

- `version.instructions.md` — Semantic versioning, pre-release, deprecation timelines
- `graphql.instructions.md` — gqlgen schema, resolvers, DataLoaders (for GraphQL APIs)
- `security.instructions.md` — JWT middleware, input validation
- `errorhandling.instructions.md` — Error response format, ProblemDetail
- `performance.instructions.md` — Hot-path optimization, concurrency patterns

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Nobody uses pagination yet" | Unbounded queries return all rows. The first large dataset crashes the client or times out. Add `?page=1&page_size=20` from the first endpoint. |
| "API versioning can wait until v2" | Unversioned APIs break all consumers on the first change. Add `/api/v1/` route nesting from day one — it costs zero lines of logic. |
| "Error codes aren't needed for MVP" | API consumers parse error codes programmatically. Returning only string messages forces consumers to regex-match errors — brittle and untranslatable. |
| "Returning 200 OK for all responses simplifies the client" | HTTP semantics exist for a reason. Returning 200 for errors breaks caching, monitoring, and every HTTP-aware tool in the pipeline. |
| "This endpoint doesn't need request validation" | Every endpoint accepting input is an attack surface. Validate shape and constraints at the API boundary — `#[derive(Validate)]` with `validator` handles this with minimal code. |

---

## Warning Signs

- An endpoint returns an unbounded collection without pagination parameters
- No `utoipa` or `aide` annotations on handler functions (undocumented API contract)
- Route paths don't include a version segment (`/api/users` instead of `/api/v1/users`)
- HTTP 200 returned for error conditions instead of 4xx/5xx
- Request body extracted as `serde_json::Value` instead of a typed `Deserialize` struct
- Missing `Content-Type` header on responses (clients can't parse reliably)
