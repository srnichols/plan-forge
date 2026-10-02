---
description: Rust GraphQL patterns — async-graphql, async-graphql-axum, DataLoader, guards, complexity limits, tenant-scoped resolvers
applyTo: '**/src/graphql/**,**/*graphql*.rs,**/*resolver*.rs,**/*schema*.rs'
---

# Rust GraphQL Patterns (async-graphql)

## Schema Design

Use `async-graphql = { version = "7.2.1", features = ["uuid", "dataloader"] }` with `async-graphql-axum` 7.2.1 for Axum 0.8. Keep resolvers thin and delegate business rules to services.

```rust
use async_graphql::{Context, ErrorExtensions, Object, Result, SimpleObject};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    domain::{ProducerId, TenantId},
    dto::producer::CreateProducerRequest,
    error::AppError,
    services::ProducerService,
};

pub fn gql_error(err: AppError) -> async_graphql::Error {
    match err {
        AppError::Database(error) => {
            tracing::error!(?error, "GraphQL database error");
            async_graphql::Error::new("internal error").extend_with(|_, extensions| {
                extensions.set("code", "INTERNAL");
            })
        }
        AppError::Internal(error) => {
            tracing::error!(?error, "GraphQL internal error");
            async_graphql::Error::new("internal error").extend_with(|_, extensions| {
                extensions.set("code", "INTERNAL");
            })
        }
        AppError::Unauthorized => async_graphql::Error::new("unauthorized").extend_with(|_, extensions| {
            extensions.set("code", "UNAUTHORIZED");
        }),
        AppError::Forbidden => async_graphql::Error::new("forbidden").extend_with(|_, extensions| {
            extensions.set("code", "FORBIDDEN");
        }),
        AppError::Validation(error) => async_graphql::Error::new(error.to_string()).extend_with(|_, extensions| {
            extensions.set("code", "VALIDATION");
        }),
        other => async_graphql::Error::new(other.to_string()).extend_with(|_, extensions| {
            extensions.set("code", "BAD_REQUEST");
        }),
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct Producer {
    pub id: Uuid,
    pub reference: String,
    pub status: String,
    pub currency: String,
}

impl From<crate::domain::Producer> for Producer {
    fn from(entity: crate::domain::Producer) -> Self {
        Self {
            id: entity.id.0,
            reference: entity.reference,
            status: entity.status.to_string(),
            currency: entity.currency,
        }
    }
}

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn producer(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<Producer>> {
        let user = ctx.data::<AuthUser>()?;
        let service = ctx.data::<ProducerService>()?;
        service
            .get(user, ProducerId(id))
            .await
            .map(Into::into)
            .map(Some)
            .map_err(gql_error)
    }
}
```

## Axum Integration

Build the schema once at startup and inject request-scoped auth data in the handler.

```rust
use async_graphql::{EmptySubscription, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::Extension;

use crate::{auth::AuthUser, graphql::{MutationRoot, QueryRoot}, state::AppState};

pub type AppSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    Extension(schema): Extension<AppSchema>,
    user: AuthUser,
    request: GraphQLRequest,
) -> GraphQLResponse {
    GraphQLResponse::from(schema
        .execute(request.into_inner().data(user))
        .await)
}
```

## Mutations and Input Validation

Validate inputs before invoking services. Do not accept `tenant_id` as a GraphQL argument for tenant-owned data.

```rust
use async_graphql::{InputObject, Object, Result};
use validator::Validate;

#[derive(InputObject, Validate)]
pub struct CreateProducerInput {
    #[validate(length(min = 1, max = 64))]
    pub reference: String,
    #[validate(length(equal = 3))]
    pub currency: String,
    #[validate(length(max = 2000))]
    pub notes: Option<String>,
}

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    async fn create_producer(
        &self,
        ctx: &async_graphql::Context<'_>,
        input: CreateProducerInput,
    ) -> Result<Producer> {
        input.validate().map_err(|err| async_graphql::Error::new(err.to_string()))?;
        let user = ctx.data::<AuthUser>()?;
        let service = ctx.data::<ProducerService>()?;
        let request = CreateProducerRequest {
            reference: input.reference,
            currency: input.currency,
            notes: input.notes,
        };
        service.create(user, request).await.map(Into::into).map_err(gql_error)
    }
}
```

## DataLoader for N+1 Prevention

Create DataLoaders per schema/request context and batch by tenant. Returned values must line up with the requested keys.

```rust
use async_graphql::dataloader::Loader;
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

use crate::{domain::{ProducerId, TenantId}, repositories::ProducerRepository};

pub struct ProducerLoader<R> {
    pub repository: Arc<R>,
    pub tenant_id: TenantId,
}

impl<R> Loader<Uuid> for ProducerLoader<R>
where
    R: ProducerRepository + Send + Sync + 'static,
{
    type Value = Producer;
    type Error = Arc<anyhow::Error>;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        self.repository
            .find_many(self.tenant_id, &keys.iter().copied().map(ProducerId).collect::<Vec<_>>())
            .await
            .map(|items| items.into_iter().map(|item| (item.id.0, item.into())).collect())
            .map_err(|err| Arc::new(err.into()))
    }
}
```

## Authorization Guards

Use guards for schema-level clarity, then repeat critical checks in services.

```rust
use async_graphql::{Context, Guard, Result};

pub struct RequireRole(pub crate::auth::Role);

impl Guard for RequireRole {
    async fn check(&self, ctx: &Context<'_>) -> Result<()> {
        let user = ctx.data::<crate::auth::AuthUser>()?;
        if user.roles.iter().any(|role| role == &self.0) {
            Ok(())
        } else {
            Err("forbidden".into())
        }
    }
}
```

Use on a field:

```rust
#[Object]
impl MutationRoot {
    #[graphql(guard = "RequireRole(crate::auth::Role::Admin)")]
    async fn delete_producer(&self, ctx: &async_graphql::Context<'_>, id: Uuid) -> Result<bool> {
        let user = ctx.data::<AuthUser>()?;
        ctx.data::<ProducerService>()?.delete(user, ProducerId(id)).await.map_err(gql_error)?;
        Ok(true)
    }
}
```

## Depth, Complexity, and Introspection

Set schema limits and disable introspection outside development.

```rust
use async_graphql::{EmptySubscription, Schema};

pub fn build_schema(is_production: bool) -> AppSchema {
    let mut builder = Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .limit_depth(12)
        .limit_complexity(256);

    if is_production {
        builder = builder.disable_introspection();
    }

    builder.finish()
}
```

## Error Handling

Map domain errors to GraphQL errors without exposing database internals. Log internal causes with `tracing::error!` in the `AppError` conversion layer and return stable messages to clients.

## Anti-Patterns

```text
Do not put business logic in resolver methods.
Do not create global DataLoader instances.
Do not accept tenant_id as mutation input.
Do not resolve child objects with one query per parent.
Do not enable production introspection by default.
Do not return SQLx model structs as the public GraphQL contract.
```

## See Also

- `auth.instructions.md` — request-scoped `AuthUser`
- `database.instructions.md` — batch repository queries
- `security.instructions.md` — validation and production error handling
