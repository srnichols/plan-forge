---
description: Rust testing patterns — cargo nextest, Axum router tests, SQLx fixtures, testcontainers PostgreSQL, mockall, and llvm-cov
applyTo: '**/tests/**,**/*_test.rs,**/*tests.rs,**/Cargo.toml,**/.config/nextest.toml'
---

# Rust Testing Patterns

## Tech Stack

- **Unit tests**: `#[tokio::test]`, `cargo test`, and `cargo nextest run`
- **HTTP tests**: Axum `Router` exercised with `tower::ServiceExt::oneshot`
- **Database tests**: `#[sqlx::test]` with migrations and committed `.sqlx/` metadata
- **Container tests**: `testcontainers = "0.27.3"` plus `testcontainers-modules = "0.15.0"`; `testcontainers-modules` 0.15 depends on the 0.27 line.
- **Mocking**: `mockall = "0.15.0"` on repository traits
- **Coverage**: `cargo llvm-cov` 0.9.1

## SQLx Offline Default

Commit this project-level default so normal builds use committed SQLx metadata without requiring inline environment-variable syntax:

```toml
# .cargo/config.toml
[env]
SQLX_OFFLINE = { value = "true", force = false }
```

Do not use `SQLX_OFFLINE=true cargo ...` in skills or CI steps. SQLx metadata staleness is checked with a real `DATABASE_URL`: run migrations, then run `cargo sqlx prepare --check`.

## Test Types

| Type | Scope | External systems | Speed |
|------|-------|------------------|-------|
| Unit | Service, validator, mapper, pure domain rule | Mocked repository traits | Fast |
| Router | Axum routes and extractors through `app(state)` | Usually mocked state | Fast to medium |
| Repository | SQLx queries and migrations | PostgreSQL 18 | Medium |
| Smoke | Built service against real dependencies | Docker Compose or staging | Slow |

## Patterns

### Unit Test with Mocked Repository

```rust
use async_trait::async_trait;
use mockall::automock;
use uuid::Uuid;

use crate::domain::{OrderId, TenantId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: OrderId,
}

#[automock]
#[async_trait]
pub trait OrderRepository: Send + Sync {
    async fn find(&self, tenant_id: TenantId, order_id: OrderId) -> anyhow::Result<Option<Order>>;
}

pub async fn load_order(repo: &dyn OrderRepository, tenant_id: TenantId, order_id: OrderId) -> anyhow::Result<Order> {
    repo.find(tenant_id, order_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("order not found"))
}
```

### Router Test with `oneshot`

```rust
use axum::{body::Body, http::{Request, StatusCode}, routing::get, Router};
use tower::ServiceExt;

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

#[tokio::test]
async fn live_probe_returns_no_content() {
    let app = Router::new().route("/health/live", get(health));
    let response = app
        .oneshot(Request::builder().uri("/health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}
```

### SQLx Test

```rust
use sqlx::{PgPool, Row};

#[sqlx::test]
async fn database_accepts_basic_query(pool: PgPool) -> sqlx::Result<()> {
    let row = sqlx::query("SELECT 1 AS value").fetch_one(&pool).await?;
    assert_eq!(row.try_get::<i32, _>("value")?, 1);
    Ok(())
}
```

### PostgreSQL 18 with Testcontainers

```rust
use testcontainers::{runners::AsyncRunner, ImageExt};
use testcontainers_modules::postgres::Postgres;

#[tokio::test]
async fn starts_postgres_18_for_repository_tests() -> anyhow::Result<()> {
    let node = Postgres::default().with_tag("18-alpine").start().await?;
    let port = node.get_host_port_ipv4(5432).await?;
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    sqlx::PgPool::connect(&url).await?.close().await;
    Ok(())
}
```

## Conventions

- Put integration tests in `tests/` and unit tests beside the module under `#[cfg(test)]`.
- Name tests as `function_when_condition_returns_outcome`.
- Use `cargo nextest run --all-targets` for the default suite.
- Keep SQLx query macros buildable with `cargo check --all-targets --locked`; check metadata staleness with `sqlx migrate run` and `cargo sqlx prepare --check` while `DATABASE_URL` points at PostgreSQL 18.
- Do not use `tokio::time::sleep` for synchronization; prefer channels, `Notify`, or controlled time.

## Validation Gates

```markdown
- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- [ ] `cargo nextest run --all-targets`
- [ ] `cargo test --doc`
- [ ] `cargo check --all-targets --locked`
- [ ] `sqlx migrate run` with `DATABASE_URL` set
- [ ] `cargo sqlx prepare --check` with the same `DATABASE_URL`
- [ ] `cargo llvm-cov --all-features --workspace --fail-under-lines 80`
```

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The service is simple enough to skip tests" | Services hold tenant, transaction, and error mapping rules; tests document those contracts before handlers depend on them. |
| "Router tests can call handlers directly" | Direct handler calls bypass extractors, middleware, request IDs, and response conversion. Exercise the `Router` with `oneshot`. |
| "SQLx macros compile, so repository tests are optional" | Compile-time SQL checks do not prove migrations, constraints, transactions, or tenant filters behave correctly. |
| "Sleeping fixes async flakiness" | Sleeps slow the suite and still race under load. Use deterministic synchronization or virtual time. |
| "Mocks are easier than Testcontainers everywhere" | Repository code needs real PostgreSQL semantics, while service code should mock repositories. Use the right seam. |

## Warning Signs

- A repository method has no test proving it binds `tenant_id`.
- Tests assert implementation details such as SQL strings instead of behavior and returned data.
- `#[ignore]` appears without a linked issue and a cleanup date.
- `cargo nextest run` is absent from CI or local verification.
- Coverage excludes the changed module without a documented reason.
