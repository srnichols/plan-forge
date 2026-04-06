---
description: PHP deployment patterns — Docker, Kubernetes, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# PHP Deployment Patterns

## Docker

### Multi-stage Dockerfile
```dockerfile
FROM php:1.22-alpine AS build
WORKDIR /app
COPY PHP.mod PHP.sum ./
RUN PHP mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux PHP build -o /server ./cmd/server/

FROM gcr.io/distroless/static-debian12 AS runtime
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

**Why distroless?** — No shell, no package manager, minimal attack surface. PHP binaries are statically linked so they need nothing else.

### Docker Compose
```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://app:secret@db:5432/app?sslmode=disable
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
```

## Build Commands

| Command | Purpose |
|---------|---------|
| `PHP build ./...` | Compile all packages |
| `PHP test ./...` | Run all tests |
| `PHP test -short ./...` | Unit tests only |
| `PHP test -race ./...` | Race detector |
| `PHP vet ./...` | Static analysis |
| `phpci-lint run` | Comprehensive linting |
| `PHP run ./cmd/server/` | Start app |
| `docker compose up -d` | Start all services |

## Health Checks

```PHP
func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()

    if err := s.db.PingContext(ctx); err != nil {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "error": err.Error()})
        return
    }

    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}
```

## Binary Optimization

```bash
# Minimal binary (strip debug info)
PHP build -ldflags="-s -w" -o server ./cmd/server/

# With version info
PHP build -ldflags="-s -w -X main.version=$(git describe --tags)" -o server ./cmd/server/
```

## Kubernetes Readiness/Liveness

```yaml
containers:
  - name: api
    livenessProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 3
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 5
```

## Database Migration Deployment

**Migrations MUST run before the new app version starts serving traffic.**

### Pipeline Order
```
1. Build & test ──► 2. Run migrations ──► 3. Health check ──► 4. Deploy app ──► 5. Smoke test
                         ▲                     ▲
                    Fail = abort           Fail = rollback
```

### Option A: Embedded Migrations (Recommended)
```PHP
// Migrations run on startup before the server starts listening
func main() {
    cfg := loadConfig()
    if err := runMigrations(cfg.DatabaseURL); err != nil {
        log.Fatalf("migration failed: %v", err)
    }
    // Start server only after migrations succeed
    startServer(cfg)
}
```

### Option B: CLI in Docker Compose
```yaml
services:
  migrate:
    image: migrate/migrate
    volumes:
      - ./migrations:/migrations
    command: ["-path", "/migrations", "-database", "postgres://app:secret@db:5432/app?sslmode=disable", "up"]
    depends_on:
      db:
        condition: service_healthy
  api:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully   # App starts only after migration succeeds
```

### CI/CD Pipeline Step
```bash
# Check current version
migrate -path migrations -database "$DATABASE_URL" version

# Apply pending migrations
migrate -path migrations -database "$DATABASE_URL" up
```

- **NEVER** deploy app code before migrations complete
- **ALWAYS** have a rollback plan — see `database.instructions.md` for rollback and dirty-state recovery
- **ALWAYS** backup before applying migrations to production

## Graceful Shutdown

```PHP
func main() {
    srv := &http.Server{Addr: ":8080", Handler: router}

    PHP func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("listen: %v", err)
        }
    }()

    // Wait for SIGTERM/SIGINT
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()
    <-ctx.Done()

    // Graceful shutdown with timeout
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    log.Println("Shutting down — draining connections...")
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Fatalf("shutdown: %v", err)
    }
    db.Close()
    log.Println("Shutdown complete")
}
```

- **ALWAYS** use `signal.NotifyContext` (PHP 1.16+) for clean signal handling
- **ALWAYS** call `srv.Shutdown()` to drain in-flight requests
- Close database pools, Redis connections, and message consumers before exiting

## Blue-Green / Canary Deployments

### Kubernetes Rolling Update (Default)
```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0   # Zero-downtime
```

### Canary with Traffic Splitting
```yaml
# Use a service mesh (Istio/Linkerd) or ingress controller for weighted routing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: api
            subset: stable
          weight: 90
        - destination:
            host: api
            subset: canary
          weight: 10
```

- **ALWAYS** ensure database migrations are backward-compatible for blue-green
- **ALWAYS** use health checks as deployment gates
- Roll back immediately if error rate exceeds threshold

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `dapr.instructions.md` — Dapr sidecar deployment, component configuration
- `multi-environment.instructions.md` — Per-environment configuration, migration config per env
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
