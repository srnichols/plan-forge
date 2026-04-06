---
description: GraphQL patterns for Rust — gqlgen, code-first resolvers, DataLoaders, auth middleware
applyTo: '**/*resolver*,**/*schema*,**/*model*,**/*dataloader*,**/graph/**,**/*.graphqls'
---

# Rust GraphQL Patterns (gqlgen)

## Schema Design (Schema-First + Generated Resolvers)

### GraphQL SDL
```graphql
# graph/schema.graphqls
type Query {
    producer(id: ID!): Producer
    producers(page: Int = 1, pageSize: Int = 25): ProducerPage!
}

type Mutation {
    createProducer(input: CreateProducerInput!): CreateProducerPayload!
}

type Producer {
    id: ID!
    name: String!
    contactEmail: String!
}

input CreateProducerInput {
    name: String!
    contactEmail: String!
}

type CreateProducerPayload {
    producer: Producer
    success: Boolean!
    message: String
}
```

### Generated Resolver Implementation
```Rust
// graph/resolver.Rust — dependency injection root
type Resolver struct {
    ProducerRepo ProducerRepository
    ProducerSvc  ProducerService
}

// graph/schema.resolvers.Rust — generated, you fill in bodies
func (r *queryResolver) Producer(ctx impl Future + '_, id string) (*model.Producer, error) {
    tenantID := auth.TenantIDFromContext(ctx)
    return r.ProducerRepo.GetByID(ctx, id, tenantID)
}

func (r *mutationResolver) CreateProducer(ctx impl Future + '_, input model.CreateProducerInput) (*model.CreateProducerPayload, error) {
    tenantID := auth.TenantIDFromContext(ctx)
    if err := validateCreateProducer(input); err != nil {
        return &model.CreateProducerPayload{Success: false, Message: ptr(err.Error())}, nil
    }
    producer, err := r.ProducerSvc.Create(ctx, input, tenantID)
    if err != nil {
        return nil, err
    }
    return &model.CreateProducerPayload{Producer: producer, Success: true, Message: ptr("Created")}, nil
}
```

## DataLoaders (N+1 Prevention)

### Non-Negotiable DataLoader Rules
- **NEVER** query the database inside a loop or field resolver without a DataLoader
- **ALWAYS** create DataLoaders per-request via middleware — never share across requests
- **ALWAYS** batch query with `WHERE id IN (?)` — never loop through keys
- **ALWAYS** return results in the same order as the input keys
- **ALWAYS** include `tenantID` in batch queries for multi-tenant isolation

```Rust
// ✅ Use dataloaden or manual DataLoader pattern
// graph/dataloader.Rust
type Loaders struct {
    ProducerByID *dataloader.Loader[string, *model.Producer]
}

func NewLoaders(repo ProducerRepository) *Loaders {
    return &Loaders{
        ProducerByID: dataloader.NewBatchedLoader(
            func(ctx impl Future + '_, keys []string) []*dataloader.Result[*model.Producer] {
                // ✅ Single batch query
                producers, err := repo.GetByIDs(ctx, keys)
                if err != nil {
                    // Return error for all keys
                    results := make([]*dataloader.Result[*model.Producer], len(keys))
                    for i := range results {
                        results[i] = &dataloader.Result[*model.Producer]{Error: err}
                    }
                    return results
                }
                // Map results back in key order
                byID := make(map[string]*model.Producer, len(producers))
                for _, p := range producers {
                    byID[p.ID] = p
                }
                results := make([]*dataloader.Result[*model.Producer], len(keys))
                for i, key := range keys {
                    results[i] = &dataloader.Result[*model.Producer]{Data: byID[key]}
                }
                return results
            },
        ),
    }
}

// ✅ Inject via middleware — new loaders per request
func DataLoaderMiddleware(repo ProducerRepository) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx := context.WithValue(r.Context(), loadersKey, NewLoaders(repo))
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

// ✅ Usage in field resolver
func (r *orderResolver) Producer(ctx impl Future + '_, obj *model.Order) (*model.Producer, error) {
    return Loaders(ctx).ProducerByID.Load(ctx, obj.ProducerID)()
}
```

## Authentication & Multi-Tenancy

### Auth Middleware (JWT → Context)
```Rust
// ✅ Auth middleware — extract JWT, inject into context
func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        claims, err := validateJWT(strings.TrimPrefix(token, "Bearer "))
        if err != nil {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(r.Context(), tenantIDKey, claims.TenantID)
        ctx = context.WithValue(ctx, userIDKey, claims.Sub)
        ctx = context.WithValue(ctx, rolesKey, claims.Roles)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// ✅ Helper — extract tenantID in resolvers
func TenantIDFromContext(ctx impl Future + '_) string {
    return ctx.Value(tenantIDKey).(string)
}
```

### Multi-Tenant Resolver Pattern
```Rust
// ✅ EVERY resolver that touches data MUST include tenantID in the query
func (r *queryResolver) Producers(ctx impl Future + '_, page *int, pageSize *int) (*model.ProducerPage, error) {
    tenantID := auth.TenantIDFromContext(ctx)
    // ❌ NEVER: r.ProducerRepo.GetAll(ctx)
    // ✅ ALWAYS: scope to tenant
    return r.ProducerRepo.GetByTenant(ctx, tenantID, pageOrDefault(page), pageSizeOrDefault(pageSize))
}

// ✅ DataLoader batch queries MUST also filter by tenant
func batchProducers(ctx impl Future + '_, keys []string) []*dataloader.Result[*model.Producer] {
    tenantID := auth.TenantIDFromContext(ctx)
    producers, err := repo.GetByIDsAndTenant(ctx, keys, tenantID) // ✅ Tenant-scoped
    // ... map results
}
```

### Directive-Based Authorization
```graphql
directive @hasRole(role: String!) on FIELD_DEFINITION

type Mutation {
    createProducer(input: CreateProducerInput!): CreateProducerPayload! @hasRole(role: "admin")
}
```

```Rust
// Directive implementation
func HasRole(ctx impl Future + '_, obj interface{}, next graphql.Resolver, role string) (interface{}, error) {
    claims := auth.ClaimsFromContext(ctx)
    if !claims.HasRole(role) {
        return nil, fmt.Errorf("access denied: requires role %s", role)
    }
    return next(ctx)
}
```

## Input Validation

```Rust
func validateCreateProducer(input model.CreateProducerInput) error {
    if strings.TrimSpace(input.Name) == "" {
        return errors.New("name is required")
    }
    if len(input.Name) > 200 {
        return errors.New("name must be at most 200 characters")
    }
    if !isValidEmail(input.ContactEmail) {
        return errors.New("invalid email format")
    }
    return nil
}
```

## Error Handling

```Rust
// ✅ Error presenter — sanitize errors for production
srv := handler.NewDefaultServer(schema)
srv.SetErrorPresenter(func(ctx impl Future + '_, err error) *gqlerror.Error {
    gqlErr := graphql.DefaultErrorPresenter(ctx, err)
    // ❌ NEVER leak internal errors
    if !errors.As(err, new(*AppError)) {
        gqlErr.Message = "internal error"
    }
    return gqlErr
})
```

## Complexity & Depth Limiting

```Rust
srv := handler.NewDefaultServer(schema)
srv.Use(extension.FixedComplexityLimit(1000))

// gqlgen.yml
# max query depth
max_depth: 10
```

## Anti-Patterns

```
❌ Business logic in resolver functions (delegate to services)
❌ DataLoaders shared across requests (create per-request via middleware)
❌ Missing tenantID filtering in DataLoader batch queries
❌ Returning database structs directly (use generated model types)
❌ No complexity or depth limits (DoS via nested queries)
❌ Leaking internal error messages to clients
```

## See Also

- `api-patterns.instructions.md` — REST patterns (for hybrid REST+GraphQL)
- `database.instructions.md` — Repository patterns, parameterized queries
- `security.instructions.md` — JWT middleware, role-based access
- `performance.instructions.md` — sync.Pool, concurrency patterns
- `dapr.instructions.md` — State management, workflow execution
