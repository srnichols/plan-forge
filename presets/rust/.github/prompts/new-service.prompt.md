---
description: "Scaffold a Rust service with trait-backed dependencies, typed errors, transactions, tracing, and cache invalidation hooks."
agent: "agent"
tools: [read, edit, search, execute]
---

# Create New Service

Scaffold a service that owns business rules and transaction boundaries. Services
do not import Axum request/response types and do not build SQL.

## Required Pattern

```rust
use std::sync::Arc;

use tracing::instrument;

use crate::auth::{AuthUser, Role};
use crate::domain::{TenantId, {EntityName}, {EntityName}Id};
use crate::dto::Create{EntityName}Request;
use crate::error::AppError;
use crate::pagination::{Page, PageRequest};
use crate::repositories::{EntityName}Repository;
use crate::repositories::New{EntityName};

#[derive(Clone)]
pub struct {EntityName}Service {
    orders: Arc<dyn {EntityName}Repository>,
}

impl {EntityName}Service {
    pub fn new(orders: Arc<dyn {EntityName}Repository>) -> Self {
        Self { orders }
    }

    #[instrument(skip(self, user), fields(tenant_id = %user.tenant_id.0, {entity_name}_id = %id.0))]
    pub async fn get(
        &self,
        user: &AuthUser,
        id: {EntityName}Id,
    ) -> Result<{EntityName}, AppError> {
        self.orders
            .find(user.tenant_id, id)
            .await?
            .ok_or_else(|| AppError::not_found("{entity_name}", id.0))
    }

    #[instrument(skip(self, user, request), fields(tenant_id = %user.tenant_id.0))]
    pub async fn create(
        &self,
        user: &AuthUser,
        request: Create{EntityName}Request,
    ) -> Result<{EntityName}, AppError> {
        self.orders
            .insert(
                user.tenant_id,
                New{EntityName} {
                    reference: request.reference.trim().to_owned(),
                    currency: request.currency.to_ascii_uppercase(),
                    notes: request.notes,
                },
            )
            .await
    }

    pub async fn list(&self, user: &AuthUser, page: PageRequest) -> Result<Page<{EntityName}>, AppError> {
        self.orders.list(user.tenant_id, page).await
    }

    pub async fn mark_processed(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<(), AppError> {
        self.orders.mark_processed(tenant, id).await
    }

    pub async fn find_many(
        &self,
        tenant: TenantId,
        ids: &[{EntityName}Id],
    ) -> Result<Vec<{EntityName}>, AppError> {
        self.orders.find_many(tenant, ids).await
    }

    pub async fn delete(
        &self,
        user: &AuthUser,
        id: {EntityName}Id,
    ) -> Result<(), AppError> {
        if !user.roles.contains(&Role::Admin) {
            return Err(AppError::Forbidden);
        }
        if self.orders.delete(user.tenant_id, id).await? {
            Ok(())
        } else {
            Err(AppError::not_found("{entity_name}", id.0))
        }
    }
}
```

## Transactional Method

When one operation writes multiple tables, the service starts the transaction
and calls repository helpers that accept `&mut Transaction<'_, Postgres>`.

```rust
use sqlx::{PgPool, Postgres, Transaction};

pub struct TransferService {
    pool: PgPool,
}

impl TransferService {
    pub async fn complete_transfer(&self, tenant_id: TenantId, transfer_id: uuid::Uuid) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        reserve_funds(&mut tx, tenant_id, transfer_id).await?;
        mark_transfer_complete(&mut tx, tenant_id, transfer_id).await?;
        tx.commit().await?;
        Ok(())
    }
}

async fn reserve_funds(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: TenantId,
    transfer_id: uuid::Uuid,
) -> Result<(), AppError> {
    sqlx::query("UPDATE transfers SET reserved_at = now() WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id.0)
        .bind(transfer_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
```

## Cache Coordination

If the entity is cached, invalidate after the write transaction commits.
Log invalidation failures with enough context to repair, but keep the committed
database state as the source of truth.

## Rules

- Business validation, duplicate checks, and cross-repository orchestration live here.
- Services accept `&AuthUser` and read `user.tenant_id`; callers never pass tenant ids from request data.
- Background and event callers use explicit tenant-scoped methods such as `mark_processed` and `find_many`.
- Use typed `AppError` variants: `NotFound`, `Validation`, `Conflict`, `Forbidden`.
- Add `tracing::instrument` on public methods and skip large request bodies.
- Keep services stateless other than injected repositories, pools, caches, and clients.
- Unit-test services with fake repositories before adding integration tests.

## Dependency Injection

Construct services in startup code after the `PgPool` and repositories exist:

```rust
let repository = Arc::new(Pg{EntityName}Repository::new(pool.clone()));
let service = {EntityName}Service::new(repository);
```

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
- [Caching instructions](../instructions/caching.instructions.md)
