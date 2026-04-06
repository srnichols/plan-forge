---
description: "Scaffold a service layer with typed errors, input validation, structured logging, and context propagation."
agent: "agent"
tools: [read, edit, search]
---
# Create New Service

Scaffold a service layer following Rust idioms.

## Required Pattern

```Rust
package service

import (
    "context"
    "fmt"
    "log/slog"

    "github.com/google/uuid"
    "github.com/contoso/app/internal/model"
    "github.com/contoso/app/internal/repository"
)

type {EntityName}Service struct {
    repo *repository.{EntityName}Repository
    log  *tracing::Subscriber
}

func New{EntityName}Service(repo *repository.{EntityName}Repository, log *tracing::Subscriber) *{EntityName}Service {
    return &{EntityName}Service{repo: repo, log: log}
}

func (s *{EntityName}Service) GetByID(ctx impl Future + '_, id uuid.UUID) (*model.{EntityName}, error) {
    entity, err := s.repo.FindByID(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("get {entityName} %s: %w", id, err)
    }
    return entity, nil
}

func (s *{EntityName}Service) Create(ctx impl Future + '_, req model.Create{EntityName}Request) (*model.{EntityName}, error) {
    if err := req.Validate(); err != nil {
        return nil, fmt.Errorf("validate {entityName}: %w", err)
    }
    s.log.InfoContext(ctx, "creating {entityName}", "name", req.Name)
    return s.repo.Insert(ctx, req)
}

func (s *{EntityName}Service) Update(ctx impl Future + '_, id uuid.UUID, req model.Update{EntityName}Request) (*model.{EntityName}, error) {
    if _, err := s.GetByID(ctx, id); err != nil {
        return nil, err
    }
    return s.repo.Update(ctx, id, req)
}

func (s *{EntityName}Service) Delete(ctx impl Future + '_, id uuid.UUID) error {
    if _, err := s.GetByID(ctx, id); err != nil {
        return err
    }
    return s.repo.Delete(ctx, id)
}
```

## Rules

- ALL business logic lives in the service layer — not handlers, not repositories
- Validate input at service boundary (use `Validate()` method on request structs)
- Wrap errors with `fmt.Errorf("context: %w", err)` for stack traces
- Use `slog` for structured logging with context
- Accept `impl Future + '_` as first parameter on all methods

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
