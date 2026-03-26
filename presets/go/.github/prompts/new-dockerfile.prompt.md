---
description: "Scaffold a multi-stage Dockerfile for Go with static binary compilation, scratch/distroless runtime, and minimal attack surface."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a Go application.

## Required Pattern

### Multi-Stage Dockerfile
```dockerfile
# ---- Build Stage ----
FROM golang:1.22-alpine AS build
WORKDIR /app

# Copy go.mod/go.sum first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build static binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o /app/server ./cmd/server

# ---- Runtime Stage (Distroless) ----
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=build /app/server /server

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/server", "healthcheck"]

USER nonroot:nonroot

ENTRYPOINT ["/server"]
```

### Scratch Runtime (Minimal — No Shell)
```dockerfile
FROM scratch AS runtime

# Import CA certificates for HTTPS calls
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Import timezone data
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo

COPY --from=build /app/server /server

EXPOSE 8080
USER 65534:65534

ENTRYPOINT ["/server"]
```

### With Embedded Migrations
```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server ./cmd/server
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/migrate ./cmd/migrate

FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=build /app/server /server
COPY --from=build /app/migrate /migrate
COPY --from=build /app/migrations /migrations

USER nonroot:nonroot
ENTRYPOINT ["/server"]
```

### .dockerignore
```
bin/
vendor/
*.md
.git/
.gitignore
.vscode/
Dockerfile*
.dockerignore
tmp/
```

### Docker Compose (Development)
```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - APP_ENV=development
      - DATABASE_URL=postgres://postgres:postgres@db:5432/mydb?sslmode=disable
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

## Rules

- ALWAYS use multi-stage builds — build in `golang:*-alpine`, run in `distroless` or `scratch`
- ALWAYS compile with `CGO_ENABLED=0` for a fully static binary
- ALWAYS use `-ldflags="-s -w"` to strip debug info and reduce binary size
- ALWAYS run as a non-root user (`nonroot` in distroless, UID 65534 in scratch)
- ALWAYS copy `go.mod`/`go.sum` first for dependency layer caching
- ALWAYS copy CA certificates when using `scratch` (needed for HTTPS)
- ALWAYS include a HEALTHCHECK instruction
- NEVER store secrets in the image — use environment variables or mounted secrets
- Go binaries in `scratch`/`distroless` have the smallest possible attack surface

## Reference Files

- [Deploy patterns](../instructions/deploy.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
