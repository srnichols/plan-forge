---
description: "Scaffold a new Rust database entity end-to-end: SQLx migration, domain type, repository, service, Axum route, and tests."
agent: "agent"
tools: [read, edit, search, execute]
---

# Create New Database Entity

Scaffold a complete entity from PostgreSQL to Axum while preserving the Rust
layering contract: route -> service -> repository -> database.

## Required Steps

1. **Create reversible SQLx migration**:
   ```bash
   sqlx migrate add -r add_{entity_name}_table
   ```

   `migrations/<timestamp>_add_{entity_name}_table.up.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS {entity_name}s (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID NOT NULL,
       reference TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending',
       currency CHAR(3) NOT NULL,
       total_cents BIGINT NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       CONSTRAINT uq_{entity_name}s_tenant_reference UNIQUE (tenant_id, reference)
   );

   CREATE INDEX IF NOT EXISTS idx_{entity_name}s_tenant_created
       ON {entity_name}s (tenant_id, created_at DESC, id DESC);
   ```

   `migrations/<timestamp>_add_{entity_name}_table.down.sql`:
   ```sql
   DROP TABLE IF EXISTS {entity_name}s;
   ```

2. **Create domain type** at `src/domain/{entity_name}.rs`:
   ```rust
   use std::fmt;

   use serde::{Deserialize, Serialize};
   use time::OffsetDateTime;
   use uuid::Uuid;

   use crate::domain::TenantId;

   #[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
   pub struct {EntityName}Id(pub Uuid);

   #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, sqlx::Type)]
   #[serde(rename_all = "snake_case")]
   #[sqlx(type_name = "text", rename_all = "snake_case")]
   pub enum {EntityName}Status {
       Pending,
       Processed,
       Cancelled,
   }

   impl fmt::Display for {EntityName}Status {
       fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
           let value = match self {
               Self::Pending => "pending",
               Self::Processed => "processed",
               Self::Cancelled => "cancelled",
           };
           formatter.write_str(value)
       }
   }

   #[derive(Clone, Debug)]
   pub struct {EntityName} {
       pub id: {EntityName}Id,
       pub tenant_id: TenantId,
       pub reference: String,
       pub status: {EntityName}Status,
       pub currency: String,
       pub total_cents: i64,
       pub created_at: OffsetDateTime,
   }
   ```

3. **Create DTOs** at `src/dto/{entity_name}.rs`:
   ```rust
   use serde::{Deserialize, Serialize};
   use time::OffsetDateTime;
   use validator::Validate;

   #[derive(Debug, Deserialize, Validate)]
   pub struct Create{EntityName}Request {
       #[validate(length(min = 1, max = 64))]
       pub reference: String,
       #[validate(length(equal = 3))]
       pub currency: String,
       pub notes: Option<String>,
   }

   #[derive(Debug, Serialize)]
   pub struct {EntityName}Response {
       pub id: uuid::Uuid,
       pub reference: String,
       pub status: String,
       pub currency: String,
       pub total_cents: i64,
       pub created_at: OffsetDateTime,
   }
   ```

4. **Create repository** at `src/repositories/{entity_name}.rs` using the
   `new-repository` prompt. Every query binds `tenant_id`.

5. **Create service** at `src/services/{entity_name}.rs` using the
   `new-service` prompt. Services own transactions and map conflicts.

6. **Create route** at `src/routes/{entity_name}.rs`:
   - Extract `AuthUser`; use `auth.tenant_id`, never request tenant fields.
   - Use `ValidatedJson<Create{EntityName}Request>`.
   - Return RFC 9457 errors through `AppError`.

7. **Wire application state**:
   - Add `Arc<{EntityName}Service>` to `AppState`.
   - Add any `FromRef<AppState>` implementation required by extractors.
   - Register `routes::{entity_name}::router()` in `app(state)`.

8. **Create tests**:
   - `#[sqlx::test]` repository coverage for create, duplicate name, and tenant isolation.
   - Service unit tests with a fake repository for business rules.
   - Axum integration test that sends an authenticated request.

## Example — Contoso Product

```rust
use axum::{extract::State, Json};

use crate::auth::AuthUser;
use crate::extractors::ValidatedJson;

pub async fn create_product(
    auth: AuthUser,
    State(service): State<ProductService>,
    ValidatedJson(request): ValidatedJson<CreateProductRequest>,
) -> Result<axum::Json<ProductResponse>, crate::error::AppError> {
    let product = service.create(&auth, request).await?;
    Ok(Json(ProductResponse::from(product)))
}
```

## Safety Checks

- Run `sqlx migrate run` against a local PostgreSQL 18 database.
- Run `cargo sqlx prepare --check` after adding SQLx macros.
- Verify unique violations become `AppError::Conflict`.
- Confirm generated list endpoints use keyset pagination.
- Add cache invalidation if the entity is cached.

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
