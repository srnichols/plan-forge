---
description: "Scaffold an async-graphql resolver with queries, mutations, DataLoader, guards, and tenant scoping."
agent: "agent"
tools: [read, edit, search]
---
# Create New GraphQL Resolver

Scaffold a Rust resolver using `async-graphql` and `async-graphql-axum`.

## GraphQL Types

```rust
use async_graphql::{InputObject, SimpleObject};
use uuid::Uuid;

#[derive(Debug, Clone, SimpleObject)]
pub struct {EntityName}Type {
    pub id: Uuid,
    pub reference: String,
    pub status: String,
    pub currency: String,
    pub description: Option<String>,
}

impl From<crate::domain::{EntityName}> for {EntityName}Type {
    fn from(entity: crate::domain::{EntityName}) -> Self {
        Self {
            id: entity.id.0,
            reference: entity.reference,
            status: entity.status.to_string(),
            currency: entity.currency,
            description: None,
        }
    }
}

#[derive(InputObject)]
pub struct Create{EntityName}Input {
    pub reference: String,
    pub currency: String,
    pub notes: Option<String>,
}
```

## Query Resolver

```rust
use async_graphql::{Context, Object, Result};
use uuid::Uuid;

pub struct {EntityName}Query;

#[Object]
impl {EntityName}Query {
    async fn {entity_name}(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<{EntityName}Type>> {
        let user = ctx.data::<crate::auth::AuthUser>()?;
        let service = ctx.data::<{EntityName}Service>()?;
        let entity = service.get(user, crate::domain::{EntityName}Id(id)).await.map_err(crate::graphql::gql_error)?;
        Ok(Some(entity.into()))
    }
}
```

## Mutation Resolver

```rust
pub struct {EntityName}Mutation;

#[Object]
impl {EntityName}Mutation {
    #[graphql(guard = "RequireRole(crate::auth::Role::Admin)")]
    async fn create_{entity_name}(
        &self,
        ctx: &Context<'_>,
        input: Create{EntityName}Input,
    ) -> Result<{EntityName}Type> {
        let user = ctx.data::<crate::auth::AuthUser>()?;
        let service = ctx.data::<{EntityName}Service>()?;
        let request = Create{EntityName}Request {
            reference: input.reference,
            currency: input.currency,
            notes: input.notes,
        };
        service.create(user, request).await.map_err(crate::graphql::gql_error).map(Into::into)
    }
}
```

## DataLoader

```rust
use async_graphql::dataloader::Loader;
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

pub struct {EntityName}Loader<R> {
    pub repository: Arc<R>,
    pub tenant_id: crate::domain::TenantId,
}

impl<R> Loader<Uuid> for {EntityName}Loader<R>
where
    R: {EntityName}Repository + Send + Sync + 'static,
{
    type Value = {EntityName}Type;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        self.repository
            .find_many(
                self.tenant_id,
                &keys.iter().copied().map(crate::domain::{EntityName}Id).collect::<Vec<_>>(),
            )
            .await
            .map(|rows| rows.into_iter().map(|row| (row.id.0, row.into())).collect())
            .map_err(|error| Arc::new(error.into()))
    }
}
```

## Schema Registration

```rust
use async_graphql::{EmptySubscription, Schema};

pub type {EntityName}Schema = Schema<{EntityName}Query, {EntityName}Mutation, EmptySubscription>;

pub fn build_{entity_name}_schema(production: bool) -> {EntityName}Schema {
    let builder = Schema::build({EntityName}Query, {EntityName}Mutation, EmptySubscription)
        .limit_depth(12)
        .limit_complexity(256);

    if production {
        builder.disable_introspection().finish()
    } else {
        builder.finish()
    }
}
```

## Rules

- Resolvers stay thin and call services for business logic.
- Use guards for GraphQL authorization and services for final enforcement.
- Never accept `tenant_id` in GraphQL input for tenant-owned records.
- Batch related object loading with `DataLoader`.
- Set depth and complexity limits on every schema.
- Disable introspection in production.
- Keep GraphQL modules under `src/graphql/`.

## Reference Files

- [GraphQL patterns](../instructions/graphql.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
