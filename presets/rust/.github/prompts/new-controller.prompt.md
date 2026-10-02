---
description: "Scaffold an Axum handler module and router with typed extractors, DTO validation, AppError, and tenant-safe service delegation."
agent: "agent"
tools: [read, edit, search]
---
# Create New Controller (Axum Handler Module)

Scaffold an Axum route module that follows REST conventions and delegates all work to services.

## Required Pattern

```rust
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    domain::{EntityName}Id,
    dto::{
        {entity_name}::{Create{EntityName}Request, {EntityName}Response},
    },
    error::AppError,
    extractors::ValidatedJson,
    pagination::{Page, PageRequest},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{entity_name}s", get(list_{entity_name}s).post(create_{entity_name}))
        .route("/{entity_name}s/{id}", get(get_{entity_name}))
}

#[derive(Debug, Deserialize)]
pub struct List{EntityName}sQuery {
    pub after_created_at: Option<time::OffsetDateTime>,
    pub after_id: Option<Uuid>,
    pub limit: Option<u32>,
}

pub async fn list_{entity_name}s(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<List{EntityName}sQuery>,
) -> Result<Json<Page<{EntityName}Response>>, AppError> {
    let page_request = PageRequest::new(query.after_created_at, query.after_id, query.limit.unwrap_or(25));
    let page = state.{entity_name}s.list(&auth, page_request).await?;
    Ok(Json(page.map({EntityName}Response::from)))
}

pub async fn get_{entity_name}(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<{EntityName}Response>, AppError> {
    let entity = state.{entity_name}s.get(&auth, {EntityName}Id(id)).await?;
    Ok(Json({EntityName}Response::from(entity)))
}

pub async fn create_{entity_name}(
    State(state): State<AppState>,
    auth: AuthUser,
    ValidatedJson(request): ValidatedJson<Create{EntityName}Request>,
) -> Result<(StatusCode, Json<{EntityName}Response>), AppError> {
    let entity = state.{entity_name}s.create(&auth, request).await?;
    Ok((StatusCode::CREATED, Json({EntityName}Response::from(entity))))
}

```

## Rules

- Handler modules handle HTTP concerns only: extract state/auth/path/query/body, call service, shape response.
- Delegate all business decisions to services.
- Use `AuthUser.tenant_id`; never accept tenant ID from a path, query, header, or request body.
- Use `ValidatedJson<T>` for write request bodies.
- Return proper status codes: 200, 201, 204, 400, 401, 403, 404, 409.
- Expose `pub fn router() -> Router<AppState>` from each route module.
- Keep handler functions `pub` when `app()` or route composition references them directly.

## Error Mapping (`AppError`)

| Variant | HTTP Status |
|---------|-------------|
| `Validation` | 400 Bad Request |
| `Unauthorized` | 401 Unauthorized |
| `Forbidden` | 403 Forbidden |
| `NotFound` | 404 Not Found |
| `Conflict` | 409 Conflict |
| `Database` / `Internal` | 500 Internal Server Error |

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
- Review `.github/instructions/architecture-principles.instructions.md` before placing handler logic.
