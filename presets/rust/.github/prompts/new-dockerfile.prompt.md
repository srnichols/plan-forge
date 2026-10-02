---
description: "Scaffold a production Dockerfile for Rust/Axum using cargo-chef, SQLx offline metadata, a non-root slim runtime, and compose services."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold the standard production Dockerfile for a Rust 1.98 Axum/Tokio/SQLx service.

## Required Pattern

### Multi-Stage Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7
FROM rust:1.98-slim-bookworm AS chef
RUN cargo install cargo-chef --version 0.1.78 --locked
WORKDIR /workspace

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
ENV SQLX_OFFLINE=true
COPY --from=planner /workspace/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx
COPY config ./config
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release --locked --bin {BinaryName}

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /srv/app --shell /usr/sbin/nologin app
WORKDIR /srv/app
COPY --from=builder /workspace/target/release/{BinaryName} /srv/app/server
COPY --from=builder /workspace/config /srv/app/config
ENV RUST_LOG=info
ENV APP_ENVIRONMENT=production
EXPOSE 8080
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["curl", "-fsS", "http://127.0.0.1:8080/health/live"]
ENTRYPOINT ["/srv/app/server"]
```

Replace `{BinaryName}` with the `[[bin]]` name or package binary name from `Cargo.toml`. Keep `SQLX_OFFLINE=true` in the builder and commit `.sqlx/` with `cargo sqlx prepare`.

### .dockerignore

```dockerignore
target/
.git/
.env
.env.*
.idea/
.vscode/
*.log
Dockerfile*
docker-compose*.yml
```

### Compose with PostgreSQL and Redis

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      APP_ENVIRONMENT: development
      APP_DATABASE__URL: postgres://app:app@postgres:5432/app
      REDIS_URL: redis://redis:6379
      RUST_LOG: info,tower_http=debug
      SQLX_OFFLINE: "true"
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 6

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      PGDATA: /var/lib/postgresql/data
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

## Rules

- ALWAYS use cargo-chef so dependency layers are stable between source edits.
- ALWAYS run `cargo build --release --locked`; never build release images from an unlocked dependency graph.
- ALWAYS set `SQLX_OFFLINE=true` during the production image build.
- ALWAYS run the runtime image as a non-root user.
- ALWAYS provide `/health/live` and `/health/ready`; Compose and orchestrators use readiness for rollout gates.
- NEVER copy `.env` or secret material into the image.
- NEVER use Alpine for the Rust build stage unless every native dependency is proven on musl.

## Reference Files

- [Deploy patterns](../instructions/deploy.instructions.md)
- [Observability patterns](../instructions/observability.instructions.md)
