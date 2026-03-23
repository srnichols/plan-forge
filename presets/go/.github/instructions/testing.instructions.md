---
description: Go testing patterns — testing package, testcontainers, httptest, table-driven tests
applyTo: '**/*_test.go'
---

# Go Testing Patterns

## Tech Stack

- **Unit Tests**: Standard `testing` package
- **Assertions**: `testify/assert` or standard `if` checks
- **Mocking**: `testify/mock` or hand-written fakes (preferred)
- **Integration**: `testcontainers-go`
- **HTTP Tests**: `net/http/httptest`
- **E2E**: Playwright or custom HTTP client tests

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single function | Mocked | Fast (ms) |
| **Integration** | Service + DB | Real (Testcontainers) | Medium (1-3s) |
| **E2E** | Full HTTP flow | Real | Slow (10s+) |

## Patterns

### Table-Driven Unit Test
```go
func TestUserService_GetUser(t *testing.T) {
    tests := []struct {
        name    string
        userID  uuid.UUID
        want    *User
        wantErr error
    }{
        {
            name:   "valid user",
            userID: uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"),
            want:   &User{Name: "Test User"},
        },
        {
            name:    "not found",
            userID:  uuid.New(),
            wantErr: ErrNotFound,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            repo := &fakeUserRepo{users: map[uuid.UUID]*User{
                uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"): {Name: "Test User"},
            }}
            svc := NewUserService(repo)

            got, err := svc.GetUser(context.Background(), tt.userID)

            if !errors.Is(err, tt.wantErr) {
                t.Errorf("error = %v, want %v", err, tt.wantErr)
            }
            if tt.want != nil && got.Name != tt.want.Name {
                t.Errorf("name = %q, want %q", got.Name, tt.want.Name)
            }
        })
    }
}
```

### Integration Test (testcontainers-go)
```go
func TestUsersAPI_Integration(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }

    ctx := context.Background()
    pgContainer, err := postgres.Run(ctx,
        "postgres:16",
        postgres.WithDatabase("testdb"),
        testcontainers.WithWaitStrategy(
            wait.ForListeningPort("5432/tcp"),
        ),
    )
    t.Cleanup(func() { pgContainer.Terminate(ctx) })
    require.NoError(t, err)

    connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
    require.NoError(t, err)

    // Wire up app with test DB...
    app := setupApp(connStr)
    srv := httptest.NewServer(app.Handler())
    defer srv.Close()

    resp, err := http.Get(srv.URL + "/api/users")
    require.NoError(t, err)
    assert.Equal(t, http.StatusOK, resp.StatusCode)
}
```

### HTTP Handler Test (httptest)
```go
func TestGetUserHandler(t *testing.T) {
    svc := &fakeUserService{
        user: &User{Name: "Test"},
    }
    handler := NewUserHandler(svc)

    req := httptest.NewRequest(http.MethodGet, "/api/users/123", nil)
    rec := httptest.NewRecorder()

    handler.GetUser(rec, req)

    assert.Equal(t, http.StatusOK, rec.Code)
    assert.Contains(t, rec.Body.String(), "Test")
}
```

## Conventions

- Test file: `{filename}_test.go` (same package)
- Test function: `Test{Type}_{Method}` or `Test{Function}_{Scenario}`
- Use `-short` flag to skip integration: `go test -short ./...`
- Use `-race` for race detection: `go test -race ./...`
- Use build tags for isolation: `//go:build integration`

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `go build ./...` passes with zero errors
- [ ] `go vet ./...` — zero warnings
- [ ] `go test ./...` — all pass
- [ ] `go test -race ./...` — no race conditions
- [ ] Anti-pattern grep: `grep -rn 'fmt.Sprintf.*SELECT\|fmt.Sprintf.*INSERT\|fmt.Sprintf.*UPDATE' --include="*.go"` returns zero hits

## See Also

- `api-patterns.instructions.md` — Integration test patterns, handler testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Error assertion patterns
```
