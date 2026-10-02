---
description: "Scaffold Axum middleware as a tower Layer/Service or from_fn_with_state function with state, logging, and safe ordering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware (Tower Layer or Axum Middleware)

Scaffold middleware for the HTTP request pipeline. Use a tower `Layer`/`Service` for reusable cross-cutting behavior and `axum::middleware::from_fn_with_state` when stateful route-local middleware is simpler.

## Required Pattern

### `from_fn_with_state` Middleware

```rust
use axum::{body::Body, extract::{Request, State}, middleware::Next, response::Response, routing::get};
use tracing::warn;

use crate::{auth::{AuthUser, Role}, error::AppError, state::AppState};

pub async fn require_admin(
    State(_state): State<AppState>,
    auth: AuthUser,
    request: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    if !auth.roles.contains(&Role::Admin) {
        warn!(user_id = %auth.user_id, "admin role required");
        return Err(AppError::Forbidden);
    }

    Ok(next.run(request).await)
}

pub fn protected_router(state: AppState) -> axum::Router<AppState> {
    axum::Router::new()
        .route("/admin/health", get(admin_health))
        .route_layer(axum::middleware::from_fn_with_state(state, require_admin))
}

async fn admin_health() -> axum::http::StatusCode {
    axum::http::StatusCode::NO_CONTENT
}
```

### Tower `Layer` and `Service`

```rust
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
    time::Instant,
};

use axum::{body::Body, http::Request};
use tower::{Layer, Service};
use tracing::info;

#[derive(Clone, Default)]
pub struct RequestTimingLayer;

impl<S> Layer<S> for RequestTimingLayer {
    type Service = RequestTimingService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RequestTimingService { inner }
    }
}

#[derive(Clone)]
pub struct RequestTimingService<S> {
    inner: S,
}

impl<S> Service<Request<Body>> for RequestTimingService<S>
where
    S: Service<Request<Body>, Response = axum::response::Response> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let started = Instant::now();
        let method = request.method().clone();
        let path = request.uri().path().to_owned();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            let response = inner.call(request).await?;
            info!(
                %method,
                %path,
                status = response.status().as_u16(),
                duration_ms = started.elapsed().as_millis(),
                "request completed"
            );
            Ok(response)
        })
    }
}
```

## Registration & Ordering

```rust
use axum::Router;
use tower::ServiceBuilder;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

pub fn http_layers<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router.layer(
        ServiceBuilder::new()
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
            .layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id()),
    )
}
```

## Common Middleware Types

| Type | Pattern | Purpose |
|------|---------|---------|
| Request ID | `tower-http` request id layers | Correlate logs and traces |
| Request Logging | `TraceLayer` or custom tower layer | Log method, path, status, latency |
| Authorization Gate | `from_fn_with_state` | Route-group-specific role checks |
| Security Headers | `SetResponseHeaderLayer` | Add deterministic response headers |
| CORS | `tower_http::cors::CorsLayer` | Browser access policy |

## Rules

- Middleware handles cross-cutting concerns only; no business workflows.
- Use `from_fn_with_state` for state-aware checks that are close to routes.
- Use tower `Layer`/`Service` for reusable behavior shared across routers.
- Do not extract tenant identity from headers in middleware; use the verified `AuthUser`.
- Set request IDs before `TraceLayer`; propagate request IDs innermost.
- Never swallow downstream errors; return them or map to `AppError`.

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- Keep cross-cutting middleware aligned with the architecture-principles instruction file.
