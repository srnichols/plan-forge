---
description: "Scaffold Rust request/response DTOs with serde, validator, utoipa schemas, keyset pagination, and mapping from domain entities."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Rust)

Scaffold request and response DTOs that separate API contracts from domain entities and SQLx rows.

## Required Pattern

### Response DTO

```rust
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, ToSchema)]
pub struct {EntityName}Response {
    pub id: Uuid,
    pub reference: String,
    pub status: String,
    pub currency: String,
    pub total_cents: i64,
    pub created_at: OffsetDateTime,
}
```

### Create Request DTO

```rust
use validator::Validate;

#[derive(Debug, Clone, serde::Deserialize, Validate, utoipa::ToSchema)]
pub struct Create{EntityName}Request {
    #[validate(length(min = 1, max = 64))]
    pub reference: String,
    #[validate(length(equal = 3))]
    pub currency: String,
    #[validate(length(max = 2000))]
    pub notes: Option<String>,
}
```

### Custom Validation

```rust
use validator::{Validate, ValidationError};

fn valid_slug(value: &str) -> Result<(), ValidationError> {
    if value
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        Ok(())
    } else {
        Err(ValidationError::new("slug"))
    }
}

#[derive(Debug, serde::Deserialize, Validate)]
pub struct CreateCategoryRequest {
    #[validate(custom(function = "valid_slug"))]
    pub slug: String,
}
```

### Mapping

```rust
use crate::domain::{EntityName, {EntityName}Id};

impl From<{EntityName}> for {EntityName}Response {
    fn from(entity: {EntityName}) -> Self {
        Self {
            id: entity.id.0,
            reference: entity.reference,
            status: entity.status.to_string(),
            currency: entity.currency,
            total_cents: entity.total_cents,
            created_at: entity.created_at,
        }
    }
}
```

## Paged Response Wrapper

```rust
pub type {EntityName}Page = crate::pagination::Page<{EntityName}Response>;
```

Define `Page<T>` and `PageRequest` once in `crate::pagination`; DTO modules reuse that wrapper rather than declaring a second pagination type.

## Rules

- Never return SQLx row structs or domain entities directly from handlers.
- Never accept domain entities as JSON input.
- Derive `serde::Deserialize` on request DTOs and `serde::Serialize` on response DTOs.
- Derive `validator::Validate` for write requests and run it through `ValidatedJson<T>`.
- Keep DTOs under `src/dto/`, separate from domain and repository rows.
- Use `Option<T>` only for truly optional fields; missing required fields should fail deserialization or validation.

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- Follow the architecture-principles instruction file for DTO/domain separation.
