---
description: "Scaffold Go test files with table-driven tests, testify assertions, testcontainers, and proper naming."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files following Go testing conventions.

## Test Naming Convention

```
Test{Function}_{Condition}
```

Examples:
- `TestCreateProduct_WithEmptyName`
- `TestGetByID_WhenNotFound`
- `TestCalculateTotal_WithDiscount`

## Unit Test Pattern (Table-Driven)

```go
func Test{EntityName}Service_GetByID(t *testing.T) {
    tests := []struct {
        name      string
        id        uuid.UUID
        mockSetup func(*mockRepo)
        want      *model.{EntityName}
        wantErr   error
    }{
        {
            name: "returns entity when found",
            id:   uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"),
            mockSetup: func(m *mockRepo) {
                m.findByIDResult = &model.{EntityName}{ID: uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"), Name: "Test"}
            },
            want: &model.{EntityName}{ID: uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"), Name: "Test"},
        },
        {
            name: "returns error when not found",
            id:   uuid.New(),
            mockSetup: func(m *mockRepo) {
                m.findByIDErr = repository.ErrNotFound
            },
            wantErr: repository.ErrNotFound,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            repo := &mockRepo{}
            tt.mockSetup(repo)
            svc := service.New{EntityName}Service(repo, slog.Default())

            got, err := svc.GetByID(context.Background(), tt.id)

            if tt.wantErr != nil {
                assert.ErrorIs(t, err, tt.wantErr)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want.Name, got.Name)
        })
    }
}
```

## Integration Test Pattern (Testcontainers)

```go
func TestRepository_Integration(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test in short mode")
    }

    ctx := context.Background()

    // Start PostgreSQL container
    postgres, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Image:        "postgres:16-alpine",
            ExposedPorts: []string{"5432/tcp"},
            Env: map[string]string{
                "POSTGRES_DB":       "test",
                "POSTGRES_USER":     "test",
                "POSTGRES_PASSWORD": "test",
            },
            WaitingFor: wait.ForAll(
                wait.ForListeningPort("5432/tcp"),
                wait.ForLog("database system is ready to accept connections"),
            ).WithDeadline(60 * time.Second),
        },
        Started: true,
    })
    require.NoError(t, err)
    t.Cleanup(func() { _ = postgres.Terminate(ctx) })

    // Build connection string
    host, _ := postgres.Host(ctx)
    port, _ := postgres.MappedPort(ctx, "5432")
    dsn := fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable", host, port.Port())

    // Connect
    pool, err := pgxpool.New(ctx, dsn)
    require.NoError(t, err)
    t.Cleanup(func() { pool.Close() })

    // Run migrations
    err = runMigrations(dsn, "../../migrations")
    require.NoError(t, err)

    // Create repository under test
    repo := repository.NewProductRepository(pool)

    t.Run("Create and FindByID", func(t *testing.T) {
        created, err := repo.Create(ctx, model.CreateProductRequest{Name: "Test Product"})
        require.NoError(t, err)
        assert.NotEqual(t, uuid.Nil, created.ID)

        found, err := repo.FindByID(ctx, created.ID)
        require.NoError(t, err)
        assert.Equal(t, "Test Product", found.Name)
    })

    t.Run("FindByID returns ErrNotFound for missing entity", func(t *testing.T) {
        _, err := repo.FindByID(ctx, uuid.New())
        assert.ErrorIs(t, err, repository.ErrNotFound)
    })
}
```

## Migration Helper for Tests
```go
func runMigrations(dsn, migrationsPath string) error {
    m, err := migrate.New("file://"+migrationsPath, dsn)
    if err != nil {
        return fmt.Errorf("create migrator: %w", err)
    }
    if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
        return fmt.Errorf("run migrations: %w", err)
    }
    return nil
}
```

## HTTP Handler Test Pattern
```go
func TestProductHandler_GetByID(t *testing.T) {
    tests := []struct {
        name       string
        id         string
        mockSetup  func(*mockService)
        wantStatus int
    }{
        {
            name: "returns 200 for existing product",
            id:   "550e8400-e29b-41d4-a716-446655440000",
            mockSetup: func(m *mockService) {
                m.result = &model.Product{Name: "Test"}
            },
            wantStatus: http.StatusOK,
        },
        {
            name:       "returns 400 for invalid UUID",
            id:         "not-a-uuid",
            mockSetup:  func(m *mockService) {},
            wantStatus: http.StatusBadRequest,
        },
        {
            name: "returns 404 when not found",
            id:   uuid.NewString(),
            mockSetup: func(m *mockService) {
                m.err = repository.ErrNotFound
            },
            wantStatus: http.StatusNotFound,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := &mockService{}
            tt.mockSetup(svc)
            handler := NewProductHandler(svc)

            req := httptest.NewRequest(http.MethodGet, "/products/"+tt.id, nil)
            rctx := chi.NewRouteContext()
            rctx.URLParams.Add("id", tt.id)
            req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

            rec := httptest.NewRecorder()
            handler.GetByID(rec, req)

            assert.Equal(t, tt.wantStatus, rec.Code)
        })
    }
}
```

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
