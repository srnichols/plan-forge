# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>
> **Stack**: Rust 1.98 / Axum 0.8.9 / Tokio 1.53.1 / SQLx 0.9.0
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent or worker code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Workers orchestrate use cases; business rules stay in services
2. **TDD for Business Logic** — Unit-test service behavior before wiring runtime tasks
3. **Typed Error Handling** — Return `Result<T, AppError>` or task-specific error enums
4. **Runtime Safety** — Use cancellation tokens, `JoinSet`, and bounded concurrency

---

## Background Worker Pattern

### Template: Tokio worker with graceful shutdown

```rust
use std::time::Duration;

use tokio::{task::JoinSet, time};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

use crate::{error::AppError, state::AppState};

pub async fn run_workers(state: AppState, shutdown: CancellationToken) {
    let mut tasks = JoinSet::new();
    tasks.spawn(run_outbox_worker(state, shutdown.clone()));

    while let Some(result) = tasks.join_next().await {
        if let Err(join_error) = result {
            error!(%join_error, "worker task panicked or was cancelled");
        }
    }
}

async fn run_outbox_worker(state: AppState, shutdown: CancellationToken) {
    let mut interval = time::interval(Duration::from_secs(30));

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                info!("outbox worker stopping");
                break;
            }
            _ = interval.tick() => {
                if let Err(error) = process_outbox_once(&state).await {
                    error!(?error, "outbox iteration failed");
                }
            }
        }
    }
}

async fn process_outbox_once(_state: &AppState) -> Result<(), AppError> {
    Ok(())
}
```

### Template: Message payload carries tenant identity

```rust
use uuid::Uuid;

use crate::domain::TenantId;

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct OrderRequestedMessage {
    pub tenant_id: TenantId,
    pub order_id: Uuid,
    pub requested_by: Uuid,
}
```

---

## Agent Categories

| Category | Purpose | Rust pattern |
|----------|---------|--------------|
| **Background Workers** | Polling or outbox processing | Tokio task + `CancellationToken` |
| **Message Consumers** | RabbitMQ, NATS, Redis streams | Typed payload + bounded ack/retry loop |
| **Scheduled Jobs** | Periodic maintenance | `tokio::time::interval` with jitter |
| **Health Monitors** | Dependency readiness | Axum `/health/live` and `/health/ready` handlers |

---

## Communication Patterns

### Event-Driven
```
HTTP handler → Service commits transaction → Outbox row → Worker publishes message
```

### Message Consumer
```
Broker message → Deserialize typed payload → Service method → Ack only after success
```

### Request/Response
```
Axum handler → Service → Repository → PostgreSQL
```

---

## Quick Commands

```bash
cargo build --locked
cargo test
cargo nextest run
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
sqlx migrate run
cargo sqlx prepare --check
docker compose up -d
```

---

## Review Checks

- Workers stop on shutdown and do not orphan tasks.
- CPU-heavy or blocking work uses `tokio::task::spawn_blocking`.
- Retry loops have maximum attempts, backoff, and structured logs.
- Tenant identity in background work comes from the original verified `AuthUser`.
- Message handlers are idempotent before they acknowledge delivery.
- Service calls remain testable without a broker or HTTP server.
