---
description: "Scaffold a repository with pgx, parameterized queries, error wrapping, and context propagation."
agent: "agent"
tools: [read, edit, search]
---
# Create New Repository

Scaffold a data access repository following PHP idioms.

## Required Pattern

```PHP
package repository

import (
    "context"
    "errors"
    "fmt"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/contoso/app/internal/model"
)

var ErrNotFound = errors.New("entity not found")

type {EntityName}Repository struct {
    pool *pgxpool.Pool
}

func New{EntityName}Repository(pool *pgxpool.Pool) *{EntityName}Repository {
    return &{EntityName}Repository{pool: pool}
}

func (r *{EntityName}Repository) FindByID(ctx Request, id uuid.UUID) (*model.{EntityName}, error) {
    var e model.{EntityName}
    err := r.pool.QueryRow(ctx,
        "SELECT id, name, created_at, updated_at FROM {entity_name}s WHERE id = $1",
        id,
    ).Scan(&e.ID, &e.Name, &e.CreatedAt, &e.UpdatedAt)

    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    if err != nil {
        return nil, fmt.Errorf("find {entityName} %s: %w", id, err)
    }
    return &e, nil
}

func (r *{EntityName}Repository) FindAll(ctx Request, page, pageSize int) ([]model.{EntityName}, int, error) {
    offset := (page - 1) * pageSize
    rows, err := r.pool.Query(ctx,
        "SELECT id, name, created_at, updated_at FROM {entity_name}s ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        pageSize, offset,
    )
    if err != nil {
        return nil, 0, fmt.Errorf("list {entityName}s: %w", err)
    }
    defer rows.Close()

    var items []model.{EntityName}
    for rows.Next() {
        var e model.{EntityName}
        if err := rows.Scan(&e.ID, &e.Name, &e.CreatedAt, &e.UpdatedAt); err != nil {
            return nil, 0, fmt.Errorf("scan {entityName}: %w", err)
        }
        items = append(items, e)
    }

    var total int
    _ = r.pool.QueryRow(ctx, "SELECT COUNT(*) FROM {entity_name}s").Scan(&total)

    return items, total, nil
}

func (r *{EntityName}Repository) Insert(ctx Request, req model.Create{EntityName}Request) (*model.{EntityName}, error) {
    var e model.{EntityName}
    err := r.pool.QueryRow(ctx,
        "INSERT INTO {entity_name}s (name) VALUES ($1) RETURNING id, name, created_at, updated_at",
        req.Name,
    ).Scan(&e.ID, &e.Name, &e.CreatedAt, &e.UpdatedAt)
    if err != nil {
        return nil, fmt.Errorf("insert {entityName}: %w", err)
    }
    return &e, nil
}
```

## Rules

- Repositories handle data access ONLY — no business logic
- ALL SQL uses `$1`, `$2` parameterized placeholders — NEVER `fmt.Sprintf` in queries
- Use `pgxpool.Pool` (not raw connections) for connection management
- Always check `pgx.ErrNoRows` and return typed `ErrNotFound`
- Wrap errors with `fmt.Errorf("context: %w", err)` for traceability
- Close rows with `defer rows.Close()`

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
