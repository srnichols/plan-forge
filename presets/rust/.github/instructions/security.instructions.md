---
description: Rust security patterns — validation, CORS, body limits, timeouts, secrets, SQL safety, unsafe-code policy, dependency scans
applyTo: '**/src/**/*.rs,**/Cargo.toml,**/deny.toml,**/migrations/**/*.sql'
---

# Rust Security Patterns

## Input Validation

Deserialize into DTOs and validate before a handler calls a service. Import the shared extractor from `crate::extractors`; do not define a second `ValidatedJson`.

```rust
use axum::routing::post;
use serde::Deserialize;
use validator::Validate;

use crate::{extractors::ValidatedJson, routes};

#[derive(Debug, Deserialize, Validate)]
pub struct CreateUserRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1, max = 100))]
    pub display_name: String,
}

pub fn user_routes() -> axum::Router<crate::state::AppState> {
    axum::Router::new().route("/users", post(routes::users::create))
}

pub async fn create_user(
    auth: crate::auth::AuthUser,
    ValidatedJson(request): ValidatedJson<CreateUserRequest>,
) -> Result<(), crate::error::AppError> {
    crate::services::users::create(&auth, auth.tenant_id, request).await
}
```

Use `validator` on DTOs, not domain entities, so external input rules stay at the boundary. The shared extractor maps malformed JSON to `AppError::BadRequest`, not a 500.

## SQL Injection Prevention

SQLx binds values; never concatenate user input into SQL. Use `query!` / `query_as!` with offline metadata when the SQL is static, and `QueryBuilder::push_bind` for optional filters.

```rust
use sqlx::{Postgres, QueryBuilder};

use crate::domain::TenantId;

pub fn search_users_sql<'a>(
    tenant_id: TenantId,
    email_prefix: Option<&'a str>,
) -> QueryBuilder<Postgres> {
    let mut builder = QueryBuilder::new(
        "SELECT id, email, display_name FROM users WHERE tenant_id = ",
    );
    builder.push_bind(tenant_id.0);

    if let Some(prefix) = email_prefix {
        builder.push(" AND email ILIKE ");
        builder.push_bind(format!("{prefix}%"));
    }

    builder.push(" ORDER BY created_at DESC, id DESC LIMIT 50");
    builder
}
```

## CORS Configuration

`tower_http::cors::CorsLayer` must list origins from configuration. Wildcards are only acceptable for public, credential-free assets.

```rust
use axum::http::{HeaderValue, Method};
use tower_http::cors::CorsLayer;

pub fn cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = allowed_origins
        .iter()
        .map(|origin| origin.parse().expect("validated origin URL"))
        .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ])
        .allow_credentials(true)
}
```

## Request Body Limits and Timeouts

Set global limits for safety and tighter route-specific limits for auth and upload endpoints.

```rust
use std::time::Duration;
use axum::{http::StatusCode, routing::post, Router};
use tower::ServiceBuilder;
use tower_http::{limit::RequestBodyLimitLayer, timeout::TimeoutLayer};

use crate::{routes, state::AppState};

pub fn secured_router(state: AppState) -> Router {
    Router::new()
        .route("/api/users", post(routes::users::create))
        .with_state(state)
        .layer(
            ServiceBuilder::new()
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::REQUEST_TIMEOUT,
                    Duration::from_secs(15),
                ))
                .layer(RequestBodyLimitLayer::new(64 * 1024)),
        )
}
```

## Secrets Management

Configuration should parse secrets into `secrecy::SecretString` and expose them only at the call site that needs bytes.

```rust
use secrecy::SecretString;

#[derive(Clone)]
pub struct Settings {
    pub database: DatabaseSettings,
    pub auth: AuthSettings,
}
```

Do not place secret values in `tracing` fields, error strings, test snapshots, or generated docs. Mask by default and expose through `ExposeSecret` only inside the database, HTTP, or crypto client setup.

## Unsafe-Code Policy

Application crates should start with:

```rust
#![forbid(unsafe_code)]
```

If a low-level adapter truly needs unsafe code, isolate it in a tiny crate, document the invariant above the unsafe block, and require code owner approval. Business logic, routes, services, repositories, GraphQL, and workers do not need unsafe.

## Dependency and Supply-Chain Scans

Run these before release and after dependency changes:

```bash
cargo audit
cargo deny check
cargo outdated
cargo build --locked
```

Use `Cargo.lock` for applications. Configure `deny.toml` to block duplicate crypto/TLS stacks, rejected licenses, yanked crates, and unmaintained advisories unless a documented exception exists.

## Common Vulnerabilities to Prevent

| Vulnerability | Rust Pattern |
| --- | --- |
| Broken access control | `AuthUser` extractor plus service-level permission checks |
| SQL injection | SQLx binds, macros, and `QueryBuilder::push_bind` |
| Secret exposure | `secrecy::SecretString`; no debug output of secrets |
| Request smuggling / DoS | body limits, timeouts, and reverse proxy limits |
| CORS misconfiguration | explicit configured origins; no wildcard with credentials |
| Deserialization abuse | typed DTOs with validation; no untrusted `bincode` / `postcard` |
| Command injection | `tokio::process::Command` with argument arrays only |

## OWASP Top 10 Alignment

| Category | Required Control |
| --- | --- |
| A01 Broken Access Control | Tenant from token only; repository methods bind tenant |
| A02 Cryptographic Failures | Argon2id for passwords; TLS clients use rustls |
| A03 Injection | Parameterized SQLx queries and DTO validation |
| A04 Insecure Design | Service-layer authorization and rate limits on auth paths |
| A05 Misconfiguration | no unsafe code, CORS allowlist, generic production errors |
| A07 Auth Failures | validated JWT claims and cached JWKS |
| A08 Integrity Failures | `cargo audit`, `cargo deny`, locked builds |

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "The type system validates this already" | Types prove shape, not business constraints; length, format, and enum rules still need `Validate`. |
| "Wildcard CORS is fine during development" | Development defaults get copied to production; use environment-specific explicit origins. |
| "This SQL fragment is from a dropdown" | Dropdown values can be tampered with; bind or map to an allowlisted enum. |
| "Unsafe makes this faster" | Most web/API code is I/O-bound; unsafe shifts memory safety proof to humans. |
| "We'll run cargo audit in CI later" | Vulnerable crates can be merged before CI exists; run the audit locally when versions change. |

## Warning Signs

- handlers accept `Json<Value>` or `HashMap<String, Value>` for business input
- `format!` builds a SQL clause
- `CorsLayer::permissive()` appears in application code
- secrets are `String` fields in shared config structs
- `unwrap()` handles request, token, database, or network failures
- `unsafe` appears outside a reviewed infrastructure adapter

## See Also

- `auth.instructions.md` — JWT/OIDC validation and permission checks
- `database.instructions.md` — SQLx transactions, migrations, and RLS
- `deploy.instructions.md` — TLS, runtime images, and environment separation
