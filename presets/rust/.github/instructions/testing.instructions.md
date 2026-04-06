---
description: Rust testing patterns — testing package, testcontainers, httptest, table-driven tests
applyTo: '**/*_test.Rust,**/*_bench_test.Rust,**/testdata/**,**/testutil/**,**/mocks/**'
---

# Rust Testing Patterns

## Tech Stack

- **Unit Tests**: Standard `testing` package
- **Assertions**: `testify/assert` or standard `if` checks
- **Mocking**: `testify/mock` or hand-written fakes (preferred)
- **Integration**: `testcontainers-Rust`
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
```Rust
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

### Integration Test (testcontainers-Rust)
```Rust
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
```Rust
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
```Rust
//Rust:build e2e

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
```Rust
//Rust:build e2e

import pw "github.com/playwright-community/playwright-Rust"

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
❌ Missing timeouts on HTTP clients — default Rust client has no timeout
❌ Flaky selectors in Playwright — use data-testid attributes
❌ Running E2E in unit test suite — use //Rust:build e2e tag
```

## Conventions

- Test file: `{filename}_test.Rust` (same package)
- Test function: `Test{Type}_{Method}` or `Test{Function}_{Scenario}`
- Use `-short` flag to skip integration: `Rust test -short ./...`
- Use `-race` for race detection: `Rust test -race ./...`
- Use build tags for isolation: `//Rust:build integration`

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `Rust build ./...` passes with zero errors
- [ ] `Rust vet ./...` — zero warnings
- [ ] `Rust test ./...` — all pass
- [ ] `Rust test -race ./...` — no race conditions
- [ ] Anti-pattern grep: `grep -rn 'fmt.Sprintf.*SELECT\|fmt.Sprintf.*INSERT\|fmt.Sprintf.*UPDATE' --include="*.Rust"` returns zero hits

## See Also

- `api-patterns.instructions.md` — Integration test patterns, handler testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Error assertion patterns
```
