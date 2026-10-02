---
description: API patterns for Rust — Axum routes, typed extractors, DTO validation, pagination, RFC 9457 errors
applyTo: '**/routes/**/*.rs,**/dto/**/*.rs,**/src/lib.rs'
---

# Rust API Patterns

## REST Conventions

### Router Structure

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
    domain::ProducerId,
    dto::producer::{CreateProducerRequest, ProducerResponse},
    error::AppError,
    extractors::ValidatedJson,
    pagination::{Page, PageRequest},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/producers", get(list_producers).post(create_producer))
        .route("/producers/{id}", get(get_producer))
}

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub after_created_at: Option<time::OffsetDateTime>,
    pub after_id: Option<Uuid>,
    pub limit: Option<u32>,
}

pub async fn list_producers(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<PageQuery>,
) -> Result<Json<Page<ProducerResponse>>, AppError> {
    let page = PageRequest::new(query.after_created_at, query.after_id, query.limit.unwrap_or(25));
    let entities = state.producers.list(&auth, page).await?;
    Ok(Json(entities.map(ProducerResponse::from)))
}

pub async fn get_producer(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ProducerResponse>, AppError> {
    let entity = state.producers.get(&auth, ProducerId(id)).await?;
    Ok(Json(ProducerResponse::from(entity)))
}

pub async fn create_producer(
    State(state): State<AppState>,
    auth: AuthUser,
    ValidatedJson(request): ValidatedJson<CreateProducerRequest>,
) -> Result<(StatusCode, Json<ProducerResponse>), AppError> {
    let entity = state.producers.create(&auth, request).await?;
    Ok((StatusCode::CREATED, Json(ProducerResponse::from(entity))))
}

```

## Error Handling (RFC 9457 Problem Details)

Use the canonical `AppError` from `src/error.rs`. Its `IntoResponse` implementation returns `application/problem+json` with:

| Field | Source |
|-------|--------|
| `type` | Stable URI per error category |
| `title` | Human-readable category |
| `status` | HTTP status code |
| `detail` | Safe client detail |
| `instance` | Request path when available |
| `errors` | Validation field errors only |

Database and internal errors must log the cause with `tracing::error!` and return a generic 500 response.

## Request Validation

Place this single extractor definition in `src/extractors.rs`; route modules import it as `crate::extractors::ValidatedJson`.

```rust
use axum::{
    extract::{FromRequest, Request},
    Json,
};
use serde::de::DeserializeOwned;
use validator::Validate;

use crate::error::AppError;

pub struct ValidatedJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidatedJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Validate,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(req, state)
            .await
            .map_err(|rejection| AppError::BadRequest(rejection.body_text()))?;
        value.validate()?;
        Ok(Self(value))
    }
}
```

## Pagination

Prefer keyset pagination on `(created_at, id)` for mutable tables.

```rust
#[derive(Debug, Clone, Copy)]
pub struct PageRequest {
    pub after: Option<(time::OffsetDateTime, uuid::Uuid)>,
    pub limit: i64,
}

impl PageRequest {
    pub fn new(
        after_created_at: Option<time::OffsetDateTime>,
        after_id: Option<uuid::Uuid>,
        limit: u32,
    ) -> Self {
        let limit = limit.clamp(1, 100) as i64;
        Self {
            after: after_created_at.zip(after_id),
            limit,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_created_at: Option<time::OffsetDateTime>,
    pub next_id: Option<uuid::Uuid>,
    pub limit: u32,
}
```

Provide a `map` helper when handlers need to convert service entities into response DTOs.

```rust
impl<T> Page<T> {
    pub fn from_items(
        mut items: Vec<T>,
        limit: i64,
        key: impl Fn(&T) -> (time::OffsetDateTime, uuid::Uuid),
    ) -> Self {
        let has_next = items.len() > limit as usize;
        if has_next {
            items.truncate(limit as usize);
        }
        let (next_created_at, next_id) = if has_next {
            items.last().map(key).map_or((None, None), |(created_at, id)| (Some(created_at), Some(id)))
        } else {
            (None, None)
        };
        Self {
            items,
            next_created_at,
            next_id,
            limit: limit as u32,
        }
    }

    pub fn map<U>(self, convert: impl FnMut(T) -> U) -> Page<U> {
        Page {
            items: self.items.into_iter().map(convert).collect(),
            next_created_at: self.next_created_at,
            next_id: self.next_id,
            limit: self.limit,
        }
    }
}
```

Repositories should fetch `limit + 1` rows, return at most `limit`, and derive the next cursor from the extra row.

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success |
| 204 No Content | DELETE success or update without body |
| 400 Bad Request | Malformed request or validation failure |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permission |
| 404 Not Found | Tenant-scoped resource is absent |
| 409 Conflict | Duplicate resource or optimistic concurrency conflict |
| 422 Unprocessable Entity | Syntactically valid request violates semantic constraints |
| 500 Internal Server Error | Sanitized unexpected failure |

## API Versioning

### URL-based Versioning

```rust
use std::{net::SocketAddr, sync::Arc};

use axum::{routing::get, Router};
use tower::ServiceBuilder;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::state::AppState;

pub fn app(state: AppState) -> Router {
    let rate_config = Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(50)
            .burst_size(40)
            .finish()
            .expect("valid rate limit"),
    );

    Router::new()
        .nest("/api/v1", crate::routes::api_v1())
        .route("/health/live", get(crate::health::live))
        .route("/health/ready", get(crate::health::ready))
        .with_state(state)
        .layer(
            ServiceBuilder::new()
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(TraceLayer::new_for_http())
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(GovernorLayer::new(rate_config)),
        )
}

pub async fn serve(listener: tokio::net::TcpListener, state: AppState) -> std::io::Result<()> {
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(crate::shutdown_signal())
    .await
}

// src/routes/mod.rs
pub fn api_v1() -> Router<AppState> {
    Router::new().merge(crate::routes::orders::router())
}

// src/health.rs
pub async fn live() -> axum::http::StatusCode {
    axum::http::StatusCode::NO_CONTENT
}
```

### Version Discovery Endpoint

```rust
#[derive(serde::Serialize)]
struct ApiVersions {
    supported: &'static [&'static str],
    current: &'static str,
    deprecated: &'static [&'static str],
}

async fn versions() -> Json<ApiVersions> {
    Json(ApiVersions {
        supported: &["v1", "v2"],
        current: "v2",
        deprecated: &["v1"],
    })
}
```

### Deprecation Header Layer

Use a tower layer for deprecation headers so it applies consistently to all v1 routes.

```rust
use tower_http::set_header::SetResponseHeaderLayer;

pub fn sunset_layer() -> SetResponseHeaderLayer<http::HeaderValue> {
    SetResponseHeaderLayer::if_not_present(
        http::header::HeaderName::from_static("sunset"),
        http::HeaderValue::from_static("Sat, 01 Jan 2026 00:00:00 GMT"),
    )
}

```

### Non-Negotiable Rules
- Version APIs from the first public endpoint: `/api/v1/...`.
- Add a new version instead of breaking existing consumers.
- Deprecation requires at least a 6-month sunset window.
- Return `410 Gone` after the sunset date.
- Keep OpenAPI schemas versioned with the routes that produce them.

## Anti-Patterns

```
❌ Business rules inside Axum handlers
❌ Tenant ID accepted from request headers, path, query, or body
❌ Unbounded list endpoints
❌ Raw serde_json::Value request bodies for stable APIs
❌ Returning database rows directly as API responses
❌ Mapping errors ad hoc instead of using AppError
```

## API Documentation (OpenAPI)

Use `utoipa` to describe routes and DTOs.

```rust
#[utoipa::path(
    get,
    path = "/api/v1/producers/{id}",
    params(("id" = uuid::Uuid, Path, description = "Producer id")),
    responses(
        (status = 200, description = "Producer found", body = ProducerResponse),
        (status = 404, description = "Producer not found")
    )
)]
async fn get_producer(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ProducerResponse>, AppError> {
    let entity = state.producers.get(&auth, ProducerId(id)).await?;
    Ok(Json(ProducerResponse::from(entity)))
}
```

## See Also

- `version.instructions.md` — API and crate versioning
- `security.instructions.md` — JWT validation and tenant isolation
- `errorhandling.instructions.md` — Canonical `AppError`
- `performance.instructions.md` — Hot path and allocation guidance

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The handler can call SQLx directly" | It collapses HTTP, business rules, and persistence into one untestable function. Route handlers delegate to services. |
| "A header tenant id is easier" | Client-supplied tenant IDs allow cross-tenant access. The only valid tenant source is the verified token. |
| "Offset pagination is simpler" | Large mutable tables skip or duplicate records. Keyset cursors on `(created_at, id)` stay stable. |
| "Serde will validate enough" | Deserialization checks shape, not business constraints. Run `validator::Validate` on request DTOs. |
| "Problem JSON can wait" | Clients need stable error contracts from the first endpoint. `AppError` owns that mapping. |

---

## Warning Signs

- A route module imports `sqlx` or a concrete repository type.
- `tenant_id` appears in an Axum `Path`, `Query`, or request DTO.
- `Router::new()` exposes unversioned `/api/...` paths.
- A list endpoint lacks cursor and limit parameters.
- JSON extractor errors are returned as default text/plain responses.
