# Instructions for Copilot — Rust Project

> **Stack**: Rust 1.98 (edition 2024) / Axum 0.8.9 / Tokio 1.53.1 / SQLx 0.9.0 / PostgreSQL 18
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Handler → Service → Repository (strict)
3. **Best Practices Over Speed** — Prefer explicit, testable Rust over shortcuts
4. **TDD for Business Logic** — Red-Green-Refactor in services and repositories
5. **Type Safety** — Domain newtypes over raw `Uuid`/`String` in business code

### Red Flags
```
❌ "unwrap is fine here"       → STOP, return or map the error
❌ "tenant_id from a header"   → STOP, tenant comes only from verified AuthUser
❌ "string-built SQL"          → STOP, use sqlx query macros or QueryBuilder::push_bind
❌ "we'll split layers later"  → STOP, put the code in the right module now
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- Rust 1.98 with edition 2024
- Axum 0.8.9 on Tokio 1.53.1
- PostgreSQL 18 with SQLx 0.9.0 and committed `.sqlx/` offline metadata
- `tower` 0.5.3 and `tower-http` 0.7.1 for HTTP layers
- `serde`, `validator`, `thiserror`, `anyhow`, `tracing`, `tracing-subscriber`
- Docker images: build with `rust:1.98-slim-bookworm`; run on `debian:bookworm-slim`; local services use `postgres:18-alpine` and `redis:8-alpine`

---

## Crate Layout

| Path | Responsibility |
|------|----------------|
| `src/main.rs` | Load config, initialize telemetry, build pools, run migrations, serve with graceful shutdown |
| `src/lib.rs` | Expose `pub fn app(state: AppState) -> Router` for runtime and tests |
| `src/config.rs` | `Settings` loaded from environment; secrets use `secrecy::SecretString` |
| `src/state.rs` | `AppState` and `FromRef` projections for handlers and middleware |
| `src/error.rs` | Canonical `AppError` and RFC 9457 `IntoResponse` |
| `src/auth.rs` | `AuthUser` extractor from verified JWT; tenant comes from token claims only |
| `src/routes/` | Thin Axum handlers plus `pub fn router() -> Router<AppState>` |
| `src/services/` | Business rules and transactions; no Axum types |
| `src/repositories/` | Async repository traits and SQLx implementations; every query binds tenant |
| `src/domain/` | Entities and newtype identifiers |
| `src/dto/` | Request/response DTOs |
| `src/extractors.rs` | Shared extractors such as `ValidatedJson<T>` |
| `migrations/` | SQLx reversible migrations |
| `tests/` | Integration tests that call `app(state)` |

---

## Coding Standards

### Rust Style
- Use `Result<T, AppError>` at API boundaries and service/repository seams.
- Use `#[derive(Clone)]` state with `Arc<dyn Trait + Send + Sync>` for shared services or repositories.
- Use domain newtypes such as `TenantId(pub Uuid)` and `OrderId(pub Uuid)`.
- Avoid `.unwrap()` and `.expect()` outside tests and startup invariants.
- Keep handlers small: extract path/query/body/auth, call one service method, return a typed response.

### Axum Conventions
```rust
use axum::{extract::State, Json};

use crate::{auth::AuthUser, error::AppError, state::AppState};

pub async fn health(State(_state): State<AppState>) -> Result<Json<HealthResponse>, AppError> {
    Ok(Json(HealthResponse { status: "ok" }))
}

#[derive(serde::Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}
```

### Database
- Use `sqlx::query!` / `query_as!` with committed offline metadata when schemas are known.
- Set `SQLX_OFFLINE=true` in CI and container builds.
- Use `QueryBuilder::push_bind` for dynamic filters; never concatenate user input into SQL.
- Start transactions in services with `pool.begin()` and pass `&mut *tx` to SQLx calls.
- Every tenant-scoped repository method takes `tenant_id: TenantId` and binds it.

### Configuration
- Load typed `Settings` at startup and fail fast on invalid environment variables.
- Store secrets in environment variables or a secret manager, never in source or committed `.env` files.
- Represent secrets as `SecretString` and avoid logging them.

### Testing
- Unit-test service rules without HTTP.
- Integration-test routes by building the same `app(state)` used in production.
- Prefer Testcontainers for PostgreSQL integration tests.
- Keep migrations and `.sqlx/` metadata in sync.

---

## Quick Commands

```bash
cargo build --locked
cargo test
cargo nextest run
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
cargo audit
cargo deny check
cargo outdated
sqlx migrate run
sqlx migrate info
cargo sqlx prepare --check
cargo llvm-cov
docker compose up -d
```

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Instructions**: `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `architecture-principles.instructions.md` | Core architecture rules |
| `api-patterns.instructions.md` | Axum routes, DTOs, pagination, OpenAPI |
| `database.instructions.md` | SQLx, migrations, tenant-scoped repositories |
| `errorhandling.instructions.md` | `AppError`, RFC 9457 responses |
| `security.instructions.md` | JWT validation, tenant isolation, secrets |
| `testing.instructions.md` | Cargo, nextest, Testcontainers |
| `deploy.instructions.md` | Containers, migrations, runtime health checks |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

- [ ] Tenant ID comes from `AuthUser.tenant_id`, never from headers, path, or body
- [ ] Handlers contain no business logic
- [ ] Services contain no Axum extractor or response types
- [ ] Repositories bind `tenant_id` on every tenant-scoped query
- [ ] SQL uses `query!`, `query_as!`, or `QueryBuilder::push_bind`
- [ ] API inputs use typed DTOs and `validator::Validate`
- [ ] Errors map through the canonical `AppError`
- [ ] No hardcoded secrets or logged secret values
- [ ] `cargo fmt`, `clippy`, tests, migrations, and SQLx prepare checks pass
