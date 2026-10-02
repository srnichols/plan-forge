---
description: "Scaffold a SQLx repository with tenant-scoped queries, keyset pagination, QueryBuilder filters, and repository tests."
agent: "agent"
tools: [read, edit, search, execute]
---

# Create New Repository

Scaffold a data-access repository for PostgreSQL using SQLx. The repository owns
SQL and persistence mapping only; it does not parse HTTP requests or enforce
business policy beyond database constraints.

## Required Pattern

```rust
use async_trait::async_trait;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::{TenantId, {EntityName}, {EntityName}Id, {EntityName}Status};
use crate::error::AppError;
use crate::pagination::{Page, PageRequest};

#[derive(Debug, FromRow)]
struct {EntityName}Row {
    id: Uuid,
    tenant_id: Uuid,
    reference: String,
    status: {EntityName}Status,
    currency: String,
    total_cents: i64,
    created_at: OffsetDateTime,
}

impl From<{EntityName}Row> for {EntityName} {
    fn from(row: {EntityName}Row) -> Self {
        Self {
            id: {EntityName}Id(row.id),
            tenant_id: TenantId(row.tenant_id),
            reference: row.reference,
            status: row.status,
            currency: row.currency,
            total_cents: row.total_cents,
            created_at: row.created_at,
        }
    }
}

pub struct New{EntityName} {
    pub reference: String,
    pub currency: String,
    pub notes: Option<String>,
}

#[cfg_attr(test, mockall::automock)]
#[async_trait]
pub trait {EntityName}Repository: Send + Sync {
    async fn insert(
        &self,
        tenant: TenantId,
        new: New{EntityName},
    ) -> Result<{EntityName}, AppError>;

    async fn find(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<Option<{EntityName}>, AppError>;

    async fn list(&self, tenant: TenantId, page: PageRequest) -> Result<Page<{EntityName}>, AppError>;

    async fn find_many(
        &self,
        tenant: TenantId,
        ids: &[{EntityName}Id],
    ) -> Result<Vec<{EntityName}>, AppError>;

    async fn mark_processed(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<(), AppError>;

    async fn delete(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<bool, AppError>;
}

#[derive(Clone)]
pub struct Pg{EntityName}Repository {
    pool: PgPool,
}

impl Pg{EntityName}Repository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl {EntityName}Repository for Pg{EntityName}Repository {
    async fn insert(
        &self,
        tenant: TenantId,
        new: New{EntityName},
    ) -> Result<{EntityName}, AppError> {
        let row = sqlx::query_as::<_, {EntityName}Row>(
            "INSERT INTO {entity_name}s (tenant_id, reference, currency) VALUES ($1, $2, $3) \
             RETURNING id, tenant_id, reference, status, currency, total_cents, created_at",
        )
        .bind(tenant.0)
        .bind(&new.reference)
        .bind(&new.currency)
        .fetch_one(&self.pool)
        .await
        .map_err(map_insert_error)?;

        Ok(row.into())
    }

    async fn find(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<Option<{EntityName}>, AppError> {
        let row = sqlx::query_as::<_, {EntityName}Row>(
            "SELECT id, tenant_id, reference, status, currency, total_cents, created_at \
             FROM {entity_name}s WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant.0)
        .bind(id.0)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn list(&self, tenant: TenantId, page: PageRequest) -> Result<Page<{EntityName}>, AppError> {
        list_after(&self.pool, tenant, page).await
    }

    async fn find_many(
        &self,
        tenant: TenantId,
        ids: &[{EntityName}Id],
    ) -> Result<Vec<{EntityName}>, AppError> {
        let raw_ids: Vec<Uuid> = ids.iter().map(|id| id.0).collect();
        let rows = sqlx::query_as::<_, {EntityName}Row>(
            "SELECT id, tenant_id, reference, status, currency, total_cents, created_at \
             FROM {entity_name}s WHERE tenant_id = $1 AND id = ANY($2)",
        )
        .bind(tenant.0)
        .bind(&raw_ids)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn mark_processed(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE {entity_name}s SET status = 'processed' WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant.0)
        .bind(id.0)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn delete(
        &self,
        tenant: TenantId,
        id: {EntityName}Id,
    ) -> Result<bool, AppError> {
        let rows = sqlx::query("DELETE FROM {entity_name}s WHERE tenant_id = $1 AND id = $2")
            .bind(tenant.0)
            .bind(id.0)
            .execute(&self.pool)
            .await?
            .rows_affected();

        Ok(rows == 1)
    }
}

fn map_insert_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|db| db.is_unique_violation())
    {
        return AppError::Conflict("{EntityName} reference already exists".to_owned());
    }

    AppError::Database(error)
}
```

## Keyset List Query

```rust
pub async fn list_after(
    pool: &PgPool,
    tenant: TenantId,
    page: PageRequest,
) -> Result<Page<{EntityName}>, AppError> {
    let mut builder = QueryBuilder::<Postgres>::new(
        "SELECT id, tenant_id, reference, status, currency, total_cents, created_at \
         FROM {entity_name}s WHERE tenant_id = ",
    );
    builder.push_bind(tenant.0);

    if let Some((created_at, id)) = page.after {
        builder.push(" AND (created_at, id) < (");
        builder.push_bind(created_at);
        builder.push(", ");
        builder.push_bind(id);
        builder.push(")");
    }

    let rows = builder
        .push(" ORDER BY created_at DESC, id DESC LIMIT ")
        .push_bind(page.limit + 1)
        .build_query_as::<{EntityName}Row>()
        .fetch_all(pool)
        .await?;

    Ok(Page::from_items(
        rows.into_iter().map(Into::into).collect(),
        page.limit,
        |entity: &{EntityName}| (entity.created_at, entity.id.0),
    ))
}
```

## Rules

- Repositories take `TenantId` explicitly and bind it in every statement.
- Use `query!` or `query_as!` plus `.sqlx/` metadata for static application SQL.
- Use `query_as::<_, T>()` for testable examples or where offline metadata is unavailable.
- Use `QueryBuilder::push_bind` for optional filters; never interpolate user values.
- Return `Option<T>` for lookups and let the service decide the resource-specific `NotFound`.
- Add `#[sqlx::test]` tests for tenant isolation, pagination order, and unique conflicts.

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
