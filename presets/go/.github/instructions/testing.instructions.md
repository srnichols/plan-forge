---
description: Go testing patterns — testing package, testcontainers, httptest, table-driven tests
applyTo: '**/*_test.go,**/*_bench_test.go,**/testdata/**,**/testutil/**,**/mocks/**'
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

### E2E Tests (Full HTTP Flow)
```go
//go:build e2e

func TestE2E_CreateAndGetProducer(t *testing.T) {
    // Use a real running server (started via docker-compose or test setup)
    baseURL := os.Getenv("E2E_BASE_URL")
    if baseURL == "" {
        baseURL = "http://localhost:8080"
    }
    client := &http.Client{Timeout: 10 * time.Second}

    // Create
    body := `{"name":"Test Farm","contactEmail":"test@example.com"}`
    resp, err := client.Post(baseURL+"/api/producers", "application/json", strings.NewReader(body))
    require.NoError(t, err)
    require.Equal(t, http.StatusCreated, resp.StatusCode)

    var created struct {
        ID string `json:"id"`
    }
    require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
    resp.Body.Close()

    // Verify
    resp, err = client.Get(baseURL + "/api/producers/" + created.ID)
    require.NoError(t, err)
    require.Equal(t, http.StatusOK, resp.StatusCode)
    resp.Body.Close()
}
```

### E2E with Playwright (Browser Tests)
```go
//go:build e2e

import pw "github.com/playwright-community/playwright-go"

func TestE2E_LoginFlow(t *testing.T) {
    err := pw.Install()
    require.NoError(t, err)

    browser, err := pw.Run()
    require.NoError(t, err)
    defer browser.Stop()

    bw, err := browser.Chromium.Launch(pw.BrowserTypeLaunchOptions{Headless: pw.Bool(true)})
    require.NoError(t, err)
    defer bw.Close()

    page, err := bw.NewPage()
    require.NoError(t, err)

    _, err = page.Goto(os.Getenv("E2E_BASE_URL") + "/login")
    require.NoError(t, err)

    require.NoError(t, page.Fill("#email", "admin@test.com"))
    require.NoError(t, page.Fill("#password", "testpass"))
    require.NoError(t, page.Click("#login-btn"))

    // Wait for redirect
    err = page.WaitForURL("**/dashboard")
    require.NoError(t, err)

    title, err := page.Title()
    require.NoError(t, err)
    assert.Contains(t, title, "Dashboard")
}
```

### E2E Anti-Patterns
```
❌ Hardcoded URLs — use E2E_BASE_URL env var
❌ Tests that depend on execution order — each test must be self-contained
❌ No cleanup — always delete test data or use isolated tenant
❌ Missing timeouts on HTTP clients — default Go client has no timeout
❌ Flaky selectors in Playwright — use data-testid attributes
❌ Running E2E in unit test suite — use //go:build e2e tag
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

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple functions get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Write the test function before the implementation — table-driven tests make this fast. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and require external dependencies. Unit tests with interfaces are the foundation of the test pyramid. |
| "This is just a struct — no logic to test" | Validation methods, constructors, and interface implementations are logic. Test that factory functions reject invalid input, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Define a small interface at the call site — don't skip the test. |
| "One test case in the table is enough" | Edge cases cause production incidents. Add table cases for nil inputs, empty slices, boundary values, and concurrent access with `-race`. |

---

## Warning Signs

- A `_test.go` file has fewer `Test` functions than the package has exported functions (coverage gap)
- Test names describe implementation (`TestCallsRepository`) instead of behavior (`TestGetUser_InvalidID_ReturnsNotFound`)
- Tests use `time.Sleep` instead of channels, `t.Deadline()`, or `testify` assertions
- No `testing.Short()` checks — unable to skip slow integration tests in CI with `-short`
- Table-driven test setup has more than 10 fields per case (test struct needs simplification)
- Tests create real database connections instead of using interface mocks or `sqlmock`
