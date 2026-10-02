---
description: Rust deployment patterns — cargo-chef Docker builds, SQLx offline mode, PostgreSQL 18, Redis 8, health probes, and staged rollout gates
applyTo: '**/Dockerfile,**/docker-compose*.yml,**/docker-compose*.yaml,**/k8s/**,**/.dockerignore'
---

# Rust Deployment Patterns

## Docker

### Production Dockerfile

Use one production Dockerfile pattern for Axum/Tokio services. The runtime may be distroless or slim; the pattern below uses `debian:bookworm-slim` so Docker and Compose can run an HTTP health check inside the container. If you switch to `gcr.io/distroless/cc-debian12:nonroot`, move health checks to Kubernetes or Compose probes because distroless has no shell or curl.

```dockerfile
# syntax=docker/dockerfile:1.7
FROM rust:1.98-slim-bookworm AS chef
RUN cargo install cargo-chef --version 0.1.78 --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
ENV SQLX_OFFLINE=true
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --bin checkout-api

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin appuser
WORKDIR /app
COPY --from=builder /app/target/release/checkout-api /app/checkout-api
COPY --from=builder /app/config /app/config
ENV RUST_LOG=info
ENV APP_ENVIRONMENT=production
EXPOSE 8080
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["curl", "-fsS", "http://127.0.0.1:8080/health/live"]
ENTRYPOINT ["/app/checkout-api"]
```

### .dockerignore

```dockerignore
target/
.git/
.github/
.env
.env.*
.sqlx/query-*.json.tmp
Dockerfile*
docker-compose*.yml
```

### Docker Compose

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      APP_ENVIRONMENT: development
      RUST_LOG: info,tower_http=debug
      APP_DATABASE__URL: postgres://app:app@db:5432/app
      REDIS_URL: redis://cache:6379
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      SQLX_OFFLINE: "true"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 6

  db:
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

  cache:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
  redisdata:
```

## Build Commands

| Command | Purpose |
|---------|---------|
| `cargo build --locked` | Compile in debug mode with locked dependencies |
| `cargo check --all-targets --locked` | Build gate that works with `.cargo/config.toml` SQLx offline defaults |
| `cargo nextest run --all-targets` | Run the normal test gate |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | Treat lints as deploy blockers |
| `sqlx migrate run` | Apply PostgreSQL migrations with `DATABASE_URL` set |
| `cargo sqlx prepare --check` | Verify SQLx metadata freshness with `DATABASE_URL` set |
| `docker compose up -d --build` | Start the API with PostgreSQL and Redis |

## Health Checks

Axum services expose separate liveness and readiness routes. Liveness proves the process is alive; readiness checks dependencies and can return `503` during startup, migration, or dependency failure.

```rust
use axum::{extract::State, http::StatusCode};

use crate::state::AppState;

pub async fn live() -> StatusCode {
    StatusCode::NO_CONTENT
}

pub async fn ready(State(state): State<AppState>) -> Result<StatusCode, StatusCode> {
    let ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    if ok == 1 {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::SERVICE_UNAVAILABLE)
    }
}
```

Kubernetes probes should hit `/health/live` for `livenessProbe` and `/health/ready` for `readinessProbe`. Do not use business endpoints as probes because auth, rate limiting, and downstream dependencies can hide process health.

## Database Migration Deployment

SQLx migrations run before the new container accepts traffic:

1. Build and test the candidate image.
2. Run `sqlx migrate info` against staging or production.
3. Apply backward-compatible migrations with `sqlx migrate run`.
4. Start the new deployment and wait for `/health/ready`.
5. Run smoke tests, then increase traffic.

Rollback requires a compatible binary and an explicit data plan. Never edit an applied migration; add a forward corrective migration instead.

## Graceful Shutdown

Use `into_make_service_with_connect_info::<SocketAddr>()` so IP-keyed rate limiting receives `ConnectInfo`.

```rust
use std::net::SocketAddr;

axum::serve(
    listener,
    app(state).into_make_service_with_connect_info::<SocketAddr>(),
)
.with_graceful_shutdown(shutdown_signal())
.await?;
```

Close database pools, stop background tasks with a `CancellationToken`, and flush telemetry before process exit. Kubernetes sends SIGTERM first, so keep shutdown under the pod `terminationGracePeriodSeconds`.

## Blue-Green / Canary

- Keep migrations expand-contract so both old and new binaries can run at the same time.
- Gate traffic increases on readiness, error rate, latency, and log noise.
- Roll back with `kubectl rollout undo deployment/<name>` or by retagging the previous image.
- Do not promote a candidate image that was built without `--locked` or with `SQLX_OFFLINE=false`.

## See Also

- `database.instructions.md` — SQLx migration discipline and repository boundaries
- `observability.instructions.md` — probe instrumentation, TraceLayer, metrics, and shutdown flushing
- `security.instructions.md` — secrets, tenant identity, and container hardening
