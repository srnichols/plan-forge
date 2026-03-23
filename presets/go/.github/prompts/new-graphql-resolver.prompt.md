---
description: "Scaffold a gqlgen GraphQL resolver with queries, mutations, dataloaders, and schema-first patterns."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a GraphQL resolver using gqlgen with schema-first design, dataloaders, and separation of concerns.

## Required Pattern

### Schema (schema.graphqls)
```graphql
type {EntityName} {
  id: ID!
  name: String!
  description: String
  createdAt: DateTime!
  updatedAt: DateTime!
}

input Create{EntityName}Input {
  name: String!
  description: String
}

input Update{EntityName}Input {
  name: String!
  description: String
}

extend type Query {
  {entityName}(id: ID!): {EntityName}
  {entityName}s(page: Int = 1, pageSize: Int = 20): {EntityName}Connection!
}

extend type Mutation {
  create{EntityName}(input: Create{EntityName}Input!): {EntityName}!
  update{EntityName}(id: ID!, input: Update{EntityName}Input!): {EntityName}!
  delete{EntityName}(id: ID!): Boolean!
}
```

### Resolver Implementation
```go
package graph

type {entityName}Resolver struct {
    service *service.{EntityName}Service
}

func (r *queryResolver) {EntityName}(ctx context.Context, id string) (*model.{EntityName}, error) {
    entity, err := r.service.FindByID(ctx, id)
    if err != nil {
        return nil, err
    }
    return toGraphQL{EntityName}(entity), nil
}

func (r *queryResolver) {EntityName}s(ctx context.Context, page *int, pageSize *int) (*model.{EntityName}Connection, error) {
    p, ps := 1, 20
    if page != nil { p = *page }
    if pageSize != nil { ps = *pageSize }

    result, err := r.service.FindPaged(ctx, p, ps)
    if err != nil {
        return nil, err
    }
    return toGraphQL{EntityName}Connection(result), nil
}
```

### Mutation Resolver
```go
func (r *mutationResolver) Create{EntityName}(
    ctx context.Context, input model.Create{EntityName}Input,
) (*model.{EntityName}, error) {
    entity, err := r.service.Create(ctx, fromGraphQLCreate(input))
    if err != nil {
        return nil, err
    }
    return toGraphQL{EntityName}(entity), nil
}

func (r *mutationResolver) Update{EntityName}(
    ctx context.Context, id string, input model.Update{EntityName}Input,
) (*model.{EntityName}, error) {
    entity, err := r.service.Update(ctx, id, fromGraphQLUpdate(input))
    if err != nil {
        return nil, err
    }
    return toGraphQL{EntityName}(entity), nil
}
```

### DataLoader (N+1 Prevention)
```go
package dataloader

import (
    "context"
    "github.com/graph-gophers/dataloader/v7"
)

type {EntityName}Loader struct {
    service *service.{EntityName}Service
}

func New{EntityName}Loader(svc *service.{EntityName}Service) *dataloader.Loader[string, *model.{EntityName}] {
    return dataloader.NewBatchedLoader(
        func(ctx context.Context, keys []string) []*dataloader.Result[*model.{EntityName}] {
            entities, _ := svc.FindByIDs(ctx, keys)
            entityMap := make(map[string]*model.{EntityName}, len(entities))
            for _, e := range entities {
                entityMap[e.ID] = e
            }
            results := make([]*dataloader.Result[*model.{EntityName}], len(keys))
            for i, key := range keys {
                results[i] = &dataloader.Result[*model.{EntityName}]{Data: entityMap[key]}
            }
            return results
        },
    )
}

// Middleware to inject loaders into context
func Middleware(svc *service.{EntityName}Service) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx := context.WithValue(r.Context(), loadersKey, &Loaders{
                {EntityName}: New{EntityName}Loader(svc),
            })
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

### Field Resolver Using DataLoader
```go
func (r *orderResolver) {EntityName}(ctx context.Context, obj *model.Order) (*model.{EntityName}, error) {
    loaders := ForContext(ctx)
    thunk := loaders.{EntityName}.Load(ctx, obj.{EntityName}ID)
    return thunk()
}
```

### Mapping Functions
```go
func toGraphQL{EntityName}(e *domain.{EntityName}) *model.{EntityName} {
    return &model.{EntityName}{
        ID:          e.ID,
        Name:        e.Name,
        Description: &e.Description,
        CreatedAt:   e.CreatedAt.Format(time.RFC3339),
        UpdatedAt:   e.UpdatedAt.Format(time.RFC3339),
    }
}
```

## Rules

- ALWAYS use dataloaders for related entity resolution — never query inside field resolvers
- Resolvers should be thin — delegate to services for business logic
- Create a fresh set of dataloaders per request (middleware pattern)
- Use gqlgen schema-first approach — run `go generate` after schema changes
- Map between GraphQL model types and domain types explicitly
- Keep schema in `graph/schema/`, resolvers in `graph/`, dataloaders in `graph/dataloader/`

## Reference Files

- [GraphQL patterns](../instructions/graphql-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
