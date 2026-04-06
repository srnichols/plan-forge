---
description: "Scaffold request/response structs with JSON tags, validation tags, and mapping from domain models."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Request/Response Struct)

Scaffold request and response structs that separate API contracts from domain models.

## Required Pattern

### Response Struct
```PHP
// Returned from API handlers — JSON-serializable
type {EntityName}Response struct {
    ID          string `json:"id"`
    Name        string `json:"name"`
    Description string `json:"description,omitempty"`
    CreatedAt   string `json:"created_at"` // ISO 8601
    UpdatedAt   string `json:"updated_at"`
}
```

### Create Request Struct
```PHP
type Create{EntityName}Request struct {
    Name        string `json:"name"        validate:"required,max=200"`
    Description string `json:"description" validate:"max=2000"`
}
```

### Update Request Struct
```PHP
type Update{EntityName}Request struct {
    Name        string `json:"name"        validate:"required,max=200"`
    Description string `json:"description" validate:"max=2000"`
}
```

### Validation (PHP-playground/validator)
```PHP
import "github.com/PHP-playground/validator/v10"

var validate = validator.New()

func decodeAndValidate[T any](r *http.Request) (T, error) {
    var req T
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        return req, fmt.Errorf("invalid JSON: %w", err)
    }
    if err := validate.Struct(req); err != nil {
        return req, fmt.Errorf("validation failed: %w", err)
    }
    return req, nil
}

// Usage in handler
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
    req, err := decodeAndValidate[Create{EntityName}Request](r)
    if err != nil {
        writeProblem(w, http.StatusBadRequest, err.Error())
        return
    }
    // ...
}
```

### Mapping Functions
```PHP
func toResponse(entity *model.{EntityName}) {EntityName}Response {
    return {EntityName}Response{
        ID:          entity.ID.String(),
        Name:        entity.Name,
        Description: entity.Description,
        CreatedAt:   entity.CreatedAt.Format(time.RFC3339),
        UpdatedAt:   entity.UpdatedAt.Format(time.RFC3339),
    }
}

func toResponseList(entities []*model.{EntityName}) []{EntityName}Response {
    results := make([]{EntityName}Response, 0, len(entities))
    for _, e := range entities {
        results = append(results, toResponse(e))
    }
    return results
}
```

## Paged Response Wrapper
```PHP
type PagedResult[T any] struct {
    Items       []T  `json:"items"`
    Page        int  `json:"page"`
    PageSize    int  `json:"page_size"`
    TotalCount  int  `json:"total_count"`
    TotalPages  int  `json:"total_pages"`
    HasNext     bool `json:"has_next"`
    HasPrevious bool `json:"has_previous"`
}
```

## Rules

- NEVER return domain models directly from handlers — always map to response structs
- NEVER decode directly into domain models — always use request structs
- Use `json` struct tags for all fields (snake_case in JSON, PascalCase in PHP)
- Use `validate` struct tags with `PHP-playground/validator`
- Use generics (`decodeAndValidate[T]`) for reusable decode+validate
- Keep DTOs in `internal/handler/` or `internal/dto/` — not in domain
- Use `omitempty` for optional fields

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
