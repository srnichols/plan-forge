---
description: "Fix a Rust bug using TDD: reproduce with a failing unit, router, or SQLx test first; then implement the smallest correct fix."
agent: "agent"
tools: [read, edit, search, execute]
---
# Fix Bug with TDD

Follow Red-Green-Refactor for Rust services. The regression test determines the layer: router for extractor/response bugs, service for business rules, repository for SQL or tenancy mistakes.

## Process

### Step 1: Understand the Bug
- Read the failing path from handler to service to repository.
- Identify whether the tenant comes from verified `AuthUser` state; never accept a tenant from headers, paths, or bodies.
- Check for async shutdown, transaction, and error mapping side effects.

### Step 2: RED — Write Failing Test

```rust
#[tokio::test]
async fn reserve_order_when_quantity_is_zero_returns_validation_error() {
    let tenant_id = uuid::Uuid::new_v4();
    let mut repository = MockOrderRepository::new();
    repository.expect_reserve().never();

    let error = reserve_order(&repository, tenant_id, ReserveOrder { quantity: 0 })
        .await
        .unwrap_err();

    match error {
        AppError::Validation(errors) => {
            assert!(errors.field_errors().contains_key("quantity"));
        }
        other => panic!("expected validation error, got {other:?}"),
    }
}
```

Run the narrowest test and confirm it fails for the expected reason:

```bash
cargo nextest run reserve_order_when_quantity_is_zero_returns_validation_error
```

### Step 3: GREEN — Implement the Fix
- Put validation in DTO extractors or services, not in repositories.
- Keep handlers thin: parse request, call service, map response.
- Keep repository fixes parameterized with `query!`, `query_as!`, or `QueryBuilder::push_bind`.

### Step 4: REFACTOR — Clean Up
- Remove temporary logging and dead branches.
- Keep functions small enough for clippy and code review to reason about.
- Preserve typed errors and RFC 9457 response mapping.

### Step 5: Verify

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo nextest run --all-targets
cargo check --all-targets --locked
```

## Architecture Rules

- NO business logic in Axum handlers.
- NO SQL or pool access in service modules.
- ALL SQL is parameterized and tenant-scoped.
- NO blocking I/O on the Tokio runtime.
- NO `.unwrap()` or `.expect()` in production code except startup invariants with clear messages.

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
