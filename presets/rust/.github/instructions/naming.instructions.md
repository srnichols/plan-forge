---
description: Naming conventions — Rust modules, code symbols, database, APIs, integration prefixing
applyTo: '**/*.rs,**/Cargo.toml,**/migrations/**/*.sql'
---

# Naming Conventions

> **Priority**: Apply consistently across all new Rust code

---

## Universal Rules

### Folder & File Naming

| Context | Convention | Example |
|---------|------------|---------|
| Project folders | `kebab-case` | `order-api/`, `billing-worker/` |
| Rust modules | `snake_case` | `order_service.rs`, `tenant_context.rs` |
| Third-party tooling folders | Prefix with tool/org name | `pforge-mcp/`, `grafana-dashboards/` |
| Config files | Dot-prefix for hidden | `.env.example`, `.cargo/config.toml` |

### Third-Party Integration Prefixing

Use a specific prefix for external tooling folders so brownfield projects do not collide with generic names.

```
✅ pforge-mcp/          — Plan Forge MCP integration
✅ otel-collector/       — OpenTelemetry Collector config
❌ mcp/                  — too generic
❌ tools/                — unclear owner and purpose
```

### Database Naming

| Context | Convention | Example |
|---------|------------|---------|
| Tables | `snake_case`, plural | `orders`, `user_profiles` |
| Columns | `snake_case` | `tenant_id`, `created_at` |
| Primary keys | `id` or `{table}_id` | `id`, `order_id` |
| Foreign keys | `{referenced_table}_id` | `customer_id` |
| Indexes | `idx_{table}_{columns}` | `idx_orders_tenant_created_at_id` |
| Constraints | `{table}_{columns}_{kind}` | `orders_tenant_external_id_key` |

### API Endpoint Naming

| Convention | Example |
|------------|---------|
| Versioned prefix | `/api/v1/orders` |
| Plural nouns, kebab-case | `/api/v1/time-entries` |
| Nested resources when ownership is real | `/api/v1/customers/{customer_id}/orders` |

---

## Rust Conventions

| Context | Convention | Example |
|---------|------------|---------|
| Crate names | `kebab-case` in `Cargo.toml` | `order-api` |
| Modules/files | `snake_case` | `payment_gateway.rs` |
| Types/traits/enums | `PascalCase` | `OrderService`, `OrderRepository` |
| Functions/methods | `snake_case` | `get_by_id`, `calculate_total` |
| Variables/params | `snake_case` | `tenant_id`, `created_after` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_PAGE_SIZE` |
| Statics | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT` |
| Lifetimes | Short lowercase | `'a`, `'db` |
| Generic types | Uppercase, descriptive when helpful | `T`, `Repo`, `Body` |
| Error enums | `{Domain}Error` only for non-HTTP internals | `BillingError` |
| Tests | `test_{scenario}` | `test_create_rejects_empty_name` |

### Domain Newtypes

Name identifiers by the domain concept, not by storage type.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
pub struct TenantId(pub uuid::Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
pub struct OrderId(pub uuid::Uuid);
```

### Module Names

| Layer | File pattern | Example |
|-------|--------------|---------|
| Routes | `src/routes/{entity}.rs` | `src/routes/orders.rs` |
| Services | `src/services/{entity}.rs` | `src/services/orders.rs` |
| Repositories | `src/repositories/{entity}.rs` | `src/repositories/orders.rs` |
| Domain | `src/domain/{entity}.rs` | `src/domain/order.rs` |
| DTOs | `src/dto/{entity}.rs` | `src/dto/order.rs` |

---

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** If it is generic, add a domain or vendor prefix.
2. **Can someone infer the layer?** `OrderRepository` communicates persistence; `OrderHandler` communicates HTTP.
3. **Is the storage type hidden?** Domain code should see `TenantId`, not a loose `Uuid`.
4. **Is it searchable?** Avoid abbreviations except established names such as `db`, `tx`, and `id`.
5. **Does it match SQL and route vocabulary?** Use one noun across API, domain, and table names.

---

## Warning Signs

- `utils.rs` contains unrelated helpers.
- A DTO, SQL table, and route use different words for the same concept.
- A repository trait starts with `I` or ends with `Impl`.
- Business code accepts raw `String` for known identifiers.
- A migration creates singular table names for aggregate collections.
