---
description: "Scaffold Rust tests with cargo nextest, Axum oneshot router checks, SQLx fixtures, Testcontainers PostgreSQL, and mockall repositories."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files that match the Rust Axum/Tokio/SQLx architecture.

## Test Naming Convention

```
{function}_when_{condition}_returns_{outcome}
```

Examples:
- `create_order_when_name_is_blank_returns_validation_error`
- `get_order_when_missing_returns_problem_json`
- `ready_probe_when_database_down_returns_service_unavailable`

## Unit Test Pattern

```rust
#[tokio::test]
async fn calculate_total_when_discount_applies_returns_reduced_amount() {
    let total = OrderTotal::new(100_00).apply_percent_discount(15);

    assert_eq!(total.cents(), 85_00);
}
```

## Service Test with Repository Mock

```rust
use mockall::predicate::eq;
use uuid::Uuid;

#[tokio::test]
async fn load_order_when_repository_returns_none_maps_not_found() {
    let tenant_id = TenantId(Uuid::new_v4());
    let order_id = OrderId(Uuid::new_v4());
    let mut repo = MockOrderRepository::new();
    repo.expect_find()
        .with(eq(tenant_id), eq(order_id))
        .returning(|_, _| Ok(None));

    let service = OrderService::new(std::sync::Arc::new(repo));
    let user = AuthUser {
        user_id: Uuid::new_v4(),
        tenant_id,
        roles: vec![Role::Member],
    };
    let result = service.get(&user, order_id).await;

    assert!(result.is_err());
}
```

## Router Test Pattern

```rust
use axum::{body::Body, http::{Request, StatusCode}};
use tower::ServiceExt;

#[tokio::test]
async fn get_{entity_name}_when_authorized_returns_ok() {
    let state = test_state().await;
    let app = crate::app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/{entity_slug}")
                .header("authorization", "Bearer {TestJwt}")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

## SQLx Repository Test

```rust
#[sqlx::test(migrations = "./migrations")]
async fn insert_{entity_name}_stores_tenant_scoped_row(pool: sqlx::PgPool) -> Result<(), AppError> {
    let tenant = TenantId(uuid::Uuid::new_v4());
    let repository = Pg{EntityName}Repository::new(pool);
    let new = New{EntityName} {
        reference: "sample".to_owned(),
        currency: "USD".to_owned(),
        notes: None,
    };

    let saved = repository.insert(tenant, new).await?;

    assert_eq!(saved.tenant_id, tenant);
    Ok(())
}
```

## Testcontainers Pattern

```rust
use testcontainers::{runners::AsyncRunner, ImageExt};
use testcontainers_modules::postgres::Postgres;

#[tokio::test]
async fn migrations_apply_to_postgres_18() -> anyhow::Result<()> {
    let container = Postgres::default().with_tag("18-alpine").start().await?;
    let port = container.get_host_port_ipv4(5432).await?;
    let database_url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    sqlx::migrate!("./migrations").run(&sqlx::PgPool::connect(&database_url).await?).await?;
    Ok(())
}
```

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Database instructions](../instructions/database.instructions.md)
