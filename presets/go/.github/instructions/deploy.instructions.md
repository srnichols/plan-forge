---
description: Go deployment patterns — Docker, Kubernetes, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# Go Deployment Patterns

## Docker

### Multi-stage Dockerfile
```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server/

FROM gcr.io/distroless/static-debian12 AS runtime
COPY --from=build /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

**Why distroless?** — No shell, no package manager, minimal attack surface. Go binaries are statically linked so they need nothing else.

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
| `go build ./...` | Compile all packages |
| `go test ./...` | Run all tests |
| `go test -short ./...` | Unit tests only |
| `go test -race ./...` | Race detector |
| `go vet ./...` | Static analysis |
| `golangci-lint run` | Comprehensive linting |
| `go run ./cmd/server/` | Start app |
| `docker compose up -d` | Start all services |

## Health Checks

```go
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
go build -ldflags="-s -w" -o server ./cmd/server/

# With version info
go build -ldflags="-s -w -X main.version=$(git describe --tags)" -o server ./cmd/server/
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

## See Also

- `multi-environment.instructions.md` — Per-environment configuration
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
```
