---
name: api-doc-gen
description: Generate or update OpenAPI documentation from Rust/Axum handlers using utoipa and Swagger UI. Validate documented paths, schemas, auth, and RFC 9457 errors against the code.
argument-hint: "[optional: specific route module to document]"
tools:
  - run_in_terminal
  - read_file
  - forge_analyze
---

# API Documentation Generation Skill

## Trigger
"Generate API docs" / "Update OpenAPI spec" / "Document this endpoint"

## Steps

### 1. Discover Axum Routes
```bash
grep -rnE 'route\(|Router::new|#\[utoipa::path' --include='*.rs' src/
```
> **If this step fails** (no matches): Search for `pub fn router()` and route modules under `src/routes/`.

> **If no *.rs files found**: Stop and report "No Rust project found in this directory."

### 2. Extract Endpoint Details
For each route, document:
- HTTP method and path from `route("/path", get(handler))` or route nesting.
- Request body schema from DTOs deriving `serde::Deserialize` and `utoipa::ToSchema`.
- Query and path parameters from Axum extractors.
- Response schema and status codes from handler return types.
- Authentication from extractors such as `AuthUser`; tenant is from the verified token only.
- Error payloads using the project's RFC 9457 `AppError` response shape.

### 3. Generate or Update utoipa Wiring
Use `utoipa = { version = "6.0.0", features = ["uuid", "time"] }` with `utoipa-swagger-ui = { version = "10.0.1", features = ["axum", "vendored"] }`. The vendored feature keeps builds hermetic in slim Rust containers that do not install `curl`.

```rust
use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateOrderRequest {
    pub sku: String,
    pub quantity: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OrderResponse {
    pub id: uuid::Uuid,
    pub sku: String,
}

#[utoipa::path(
    post,
    path = "/api/orders",
    request_body = CreateOrderRequest,
    responses((status = 201, description = "Order created", body = OrderResponse))
)]
async fn create_order(Json(request): Json<CreateOrderRequest>) -> Json<OrderResponse> {
    Json(OrderResponse { id: uuid::Uuid::new_v4(), sku: request.sku })
}

#[derive(OpenApi)]
#[openapi(paths(create_order), components(schemas(CreateOrderRequest, OrderResponse)))]
struct ApiDoc;

pub fn documented_router() -> Router {
    Router::new()
        .route("/api/orders", post(create_order))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
}
```

### 4. Validate Consistency
Use `forge_analyze` for spec-to-code consistency:
- [ ] Every public route has a `#[utoipa::path]` entry.
- [ ] No documented path is missing from the Axum router.
- [ ] DTOs derive `ToSchema` and match the actual request/response types.
- [ ] Error responses include 400/401/403/404/409/500 where handlers can return them.
- [ ] Auth and tenant requirements are stated accurately.

### 5. Report
```
API Documentation Status:
  Routes in code:      N
  utoipa paths:        N
  Missing docs:        N
  Ghost docs:          N
  Schema mismatches:   N
  Error gaps:          N

Overall: PASS / FAIL
```

## Safety Rules
- Never invent routes, schemas, or status codes not present in Rust code.
- Preserve handwritten descriptions and examples when regenerating docs.
- Document tenant behavior from `AuthUser`, not from client-provided tenant headers.
- Flag removed routes and schema changes as possible breaking changes.
- Run `cargo check --all-targets` after adding utoipa derives or Swagger UI routing.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The Axum router is enough documentation" | Consumers need stable contracts, examples, and error shapes without reading handler code. |
| "Only success responses matter" | Client behavior depends on 400/401/403/404/409/500 payloads just as much as 2xx payloads. |
| "Schemas can be described by hand" | Manual schemas drift from Rust DTOs; derive `ToSchema` where the DTO is defined. |
| "Swagger UI is a dev-only toy" | Interactive docs expose auth and request-shape mistakes before client teams discover them. |

## Warning Signs

- Route modules contain handlers without `#[utoipa::path]`.
- `Json<T>` response types do not derive `ToSchema`.
- Problem details responses are absent from the OpenAPI components.
- Swagger UI route is mounted only in a local-only branch with no staging verification.
- API docs mention tenant headers as an input.

## Exit Proof

After completing this skill, confirm:
- [ ] utoipa annotations or generated spec updated for every changed route
- [ ] Swagger UI or Scalar route serves the generated OpenAPI JSON
- [ ] Request, response, and problem schemas derive from Rust DTOs
- [ ] `cargo check --all-targets` succeeds after doc changes
- [ ] Removed or changed endpoints are reported as breaking or non-breaking

## Persistent Memory — API docs

- **Before generating docs**: recall API naming, pagination, auth, and problem-response conventions.
- **After spec update**: capture endpoints added, endpoints changed, and any breaking-contract decisions.
