---
description: "Scaffold a multi-stage Dockerfile for Swift 6.4 and Vapor 4.x with a slim runtime image and minimal attack surface."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a Swift 6.4 / Vapor 4.x application.

## Required Pattern

### Multi-Stage Dockerfile
```dockerfile
FROM swift:6.4-noble AS build
WORKDIR /build
COPY Package.swift Package.resolved ./
RUN swift package resolve
COPY . .
RUN swift build -c release --disable-sandbox

FROM swift:6.4-noble-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 vapor
WORKDIR /app
COPY --from=build /build/.build/release/App ./App
COPY --from=build /build/Public ./Public
COPY --from=build /build/Resources ./Resources
ENV PORT=8080 LOG_LEVEL=info
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
USER vapor:vapor
ENTRYPOINT ["./App", "serve", "--env", "production", "--hostname", "0.0.0.0", "--port", "8080"]
```

### Ubuntu Runtime (When You Need OS Packages)
```dockerfile
FROM swift:6.4-noble AS build
WORKDIR /build
COPY Package.swift Package.resolved ./
RUN swift package resolve
COPY . .
RUN swift build -c release --disable-sandbox

FROM ubuntu:noble AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libjemalloc2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 vapor
WORKDIR /app
COPY --from=build /usr/lib/swift/linux /usr/lib/swift/linux
COPY --from=build /build/.build/release/App ./App
COPY --from=build /build/Public ./Public
COPY --from=build /build/Resources ./Resources
ENV LD_LIBRARY_PATH=/usr/lib/swift/linux
EXPOSE 8080
USER vapor:vapor
ENTRYPOINT ["./App", "serve", "--env", "production", "--hostname", "0.0.0.0"]
```

### With Embedded Migrations
```dockerfile
FROM swift:6.4-noble AS build
WORKDIR /build
COPY Package.swift Package.resolved ./
RUN swift package resolve
COPY . .
RUN swift build -c release --disable-sandbox

FROM swift:6.4-noble-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 vapor
WORKDIR /app
COPY --from=build /build/.build/release/App ./App
COPY --from=build /build/Public ./Public
COPY --from=build /build/Resources ./Resources
USER vapor:vapor
ENTRYPOINT ["./App"]
# Run migrations as a separate release step:
# ./App migrate --yes --env production
# ./App serve --env production --hostname 0.0.0.0
```

### .dockerignore
```
.build/
.swiftpm/
DerivedData/
.env
.env.*
!.env.example
.git/
.vscode/
Dockerfile*
.dockerignore
Tests/
*.md
```

### docker compose (Development)
```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      APP_ENV: development
      DATABASE_URL: postgres://vapor:vapor@db:5432/vapor
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: debug
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: vapor
      POSTGRES_USER: vapor
      POSTGRES_PASSWORD: vapor
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vapor -d vapor"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

## Rules

- ALWAYS use multi-stage builds — build in `swift:6.4-noble`, run in `swift:6.4-noble-slim` unless you need a custom `ubuntu:noble` runtime
- ALWAYS copy `Package.swift`/`Package.resolved` first for dependency layer caching
- ALWAYS run as a non-root user
- ALWAYS include a `/healthz` endpoint and Docker `HEALTHCHECK`
- ALWAYS run `swift test` and `swift build -c release` in CI before publishing the image
- ALWAYS run `./App migrate --yes --env production` as a gated release step before starting the web process
- NEVER store secrets in the image — use environment variables, mounted secrets, or the platform secret store
- NEVER use Vapor 5 beta images or APIs for this preset; target Vapor 4.x

## Reference Files

- [Deploy patterns](../instructions/deploy.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
