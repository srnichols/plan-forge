---
description: Error handling patterns — canonical AppError, Axum IntoResponse, RFC 9457 responses, SQLx mapping
applyTo: '**/error.rs,**/errors/**/*.rs,**/routes/**/*.rs,**/services/**/*.rs,**/repositories/**/*.rs'
---

# Error Handling Patterns (Rust/Axum)

## Canonical Error Type

Use this `AppError` shape exactly in `src/error.rs`.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{resource} {id} not found")]
    NotFound { resource: &'static str, id: String },
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("validation failed")]
    Validation(#[from] validator::ValidationErrors),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error(transparent)]
    Database(sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
```

## Axum `IntoResponse` Mapping

```rust
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;
use tracing::error;

#[derive(Debug, Serialize)]
struct ProblemDetails {
    #[serde(rename = "type")]
    type_uri: &'static str,
    title: &'static str,
    status: u16,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    errors: Option<serde_json::Value>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, type_uri, title, detail, errors) = match &self {
            AppError::NotFound { resource, id } => (
                StatusCode::NOT_FOUND,
                "https://example.com/problems/not-found",
                "Not Found",
                format!("{resource} {id} not found"),
                None,
            ),
            AppError::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                "https://example.com/problems/bad-request",
                "Bad Request",
                message.clone(),
                None,
            ),
            AppError::Conflict(message) => (
                StatusCode::CONFLICT,
                "https://example.com/problems/conflict",
                "Conflict",
                message.clone(),
                None,
            ),
            AppError::Validation(validation_errors) => (
                StatusCode::BAD_REQUEST,
                "https://example.com/problems/validation",
                "Validation Failed",
                "validation failed".to_owned(),
                Some(json!(validation_errors)),
            ),
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "https://example.com/problems/unauthorized",
                "Unauthorized",
                "authentication is required".to_owned(),
                None,
            ),
            AppError::Forbidden => (
                StatusCode::FORBIDDEN,
                "https://example.com/problems/forbidden",
                "Forbidden",
                "permission denied".to_owned(),
                None,
            ),
            AppError::Database(error) => {
                error!(?error, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "https://example.com/problems/internal",
                    "Internal Server Error",
                    "an unexpected error occurred".to_owned(),
                    None,
                )
            }
            AppError::Internal(error) => {
                error!(?error, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "https://example.com/problems/internal",
                    "Internal Server Error",
                    "an unexpected error occurred".to_owned(),
                    None,
                )
            }
        };

        let mut response = Json(ProblemDetails {
            type_uri,
            title,
            status: status.as_u16(),
            detail,
            instance: None,
            errors,
        })
        .into_response();
        *response.status_mut() = status;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        if status == StatusCode::UNAUTHORIZED {
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                HeaderValue::from_static("Bearer"),
            );
        }
        response
    }
}
```

## SQLx Conversion

```rust
impl AppError {
    pub fn not_found(resource: &'static str, id: impl ToString) -> Self {
        Self::NotFound {
            resource,
            id: id.to_string(),
        }
    }

}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        if error
            .as_database_error()
            .map(|database_error| database_error.is_unique_violation())
            .unwrap_or(false)
        {
            return Self::Conflict("unique constraint violation".to_owned());
        }
        Self::Database(error)
    }
}
```

Use `fetch_optional(...).await?.ok_or_else(|| AppError::not_found("order", id.0))` for lookups. A missing row and a row belonging to another tenant both return 404.

## Rules

- Never throw away an error with `_` or `let _ =`.
- Never leak database details, stack traces, or internal paths in API responses.
- Use `AppError::NotFound` only when the caller supplies the resource name and ID.
- Convert unique constraint failures to `Conflict`.
- Log `Database` and `Internal` causes with `tracing::error!`.
- Services return domain-specific `AppError` variants; handlers do not remap them.
- Prefer `anyhow::Context` inside startup code, then convert to `AppError::Internal` at the boundary.

## Exception-to-HTTP Mapping

| Variant | HTTP Status | When |
|---------|-------------|------|
| `BadRequest` | 400 | Malformed JSON or request shape rejected before validation |
| `Validation` | 400 | `validator::Validate` failure |
| `Unauthorized` | 401 | Missing or invalid token |
| `Forbidden` | 403 | Authenticated but lacking permission |
| `NotFound` | 404 | Tenant-scoped resource is absent |
| `Conflict` | 409 | Unique violation or business conflict |
| `Database` | 500 | Sanitized persistence failure |
| `Internal` | 500 | Sanitized unexpected failure |

## See Also

- `observability.instructions.md` — Structured logs and trace fields
- `api-patterns.instructions.md` — Problem response contract
- `security.instructions.md` — Auth and tenant error boundaries

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll map this error in the handler" | Scattered mappings drift. `AppError` is the one HTTP error contract. |
| "RowNotFound always means 404" | Without resource context the message is useless. Map it where the resource and id are known. |
| "Internal details help API clients debug" | They leak table names, paths, and stack traces. Log internals server-side only. |
| "A string error is enough" | Strings lose status, category, and validation details. Use the typed variant. |
| "Validation can return 500 during early development" | Client input failures are not server failures; use the validation variant immediately. |

---

## Warning Signs

- A route returns `StatusCode::INTERNAL_SERVER_ERROR` manually.
- `sqlx::Error::RowNotFound` is converted without naming the resource.
- `tracing::error!` includes request bodies, secrets, or token values.
- A service returns `anyhow::Error` directly to a handler.
- Error JSON lacks `type`, `title`, `status`, and `detail`.
