---
description: "Scaffold the canonical Rust AppError with Axum IntoResponse, RFC 9457 Problem Details, and SQLx conversion helpers."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold the canonical application error type and its HTTP mapping.

## Required Pattern

### Canonical `AppError`

```rust
pub mod error {
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
}
```

### HTTP Mapping

Use the single `impl IntoResponse for AppError` from `errorhandling.instructions.md`. It owns the RFC 9457 body shape, problem URIs, `WWW-Authenticate: Bearer` on 401, and sanitized 500 logging.

### SQLx Helpers

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

Lookups should use `fetch_optional(...).await?.ok_or_else(|| AppError::not_found("order", id.0))` so missing and other-tenant rows both map to 404.

## Rules

- Define exactly the canonical `AppError` variants shown above.
- Never return stack traces or raw database messages to API clients.
- Log `Database` and `Internal` causes server-side with `tracing::error!`.
- Convert missing rows to `NotFound` with `fetch_optional` where the resource and ID are known.
- Keep error code and status mapping in one module: `src/error.rs`.
- Use `anyhow::Error` for internal context, then convert through `AppError::Internal`.

## Reference Files

- [Error handling](../instructions/errorhandling.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- Apply the architecture-principles guidance when deciding where errors are raised.
