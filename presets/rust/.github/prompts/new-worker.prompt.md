---
description: "Scaffold a Rust Tokio background worker with CancellationToken, JoinSet, health state, and graceful shutdown."
agent: "agent"
tools: [read, edit, search]
---
# Create New Background Worker

Scaffold a long-running Rust worker that cooperates with Tokio shutdown.

## Periodic Worker Pattern

```rust
use std::{sync::Arc, time::Duration};
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

pub struct {EntityName}Worker {
    service: Arc<{EntityName}Service>,
    tenant: crate::domain::TenantId,
    batch: Vec<crate::domain::{EntityName}Id>,
    interval: Duration,
}

impl {EntityName}Worker {
    pub fn new(
        service: Arc<{EntityName}Service>,
        tenant: crate::domain::TenantId,
        batch: Vec<crate::domain::{EntityName}Id>,
        interval: Duration,
    ) -> Self {
        Self { service, tenant, batch, interval }
    }

    pub async fn run(self, shutdown: CancellationToken) {
        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        info!(worker = "{entity_name}", "worker started");

        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                _ = ticker.tick() => {
                    for id in &self.batch {
                        if let Err(error) = self.service.mark_processed(self.tenant, *id).await {
                            error!(worker = "{entity_name}", {entity_name}_id = %id.0, ?error, "worker item failed");
                        }
                    }
                }
            }
        }

        info!(worker = "{entity_name}", "worker stopped");
    }
}
```

## Worker Supervisor

```rust
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

pub async fn start_workers(
    state: AppState,
    shutdown: CancellationToken,
    tenant: crate::domain::TenantId,
    batch: Vec<crate::domain::{EntityName}Id>,
    interval: std::time::Duration,
) -> JoinSet<()> {
    let mut workers = JoinSet::new();
    let {entity_name}_shutdown = shutdown.child_token();

    workers.spawn(async move {
        {EntityName}Worker::new(
            state.{entity_name}s.clone(),
            tenant,
            batch,
            interval,
        )
            .run({entity_name}_shutdown)
            .await;
    });

    workers
}
```

## Health State

```rust
use std::sync::atomic::{AtomicI64, Ordering};

#[derive(Default)]
pub struct WorkerHealth {
    last_success_epoch_seconds: AtomicI64,
}

impl WorkerHealth {
    pub fn record_success(&self, unix_time: i64) {
        self.last_success_epoch_seconds.store(unix_time, Ordering::Relaxed);
    }

    pub fn last_success(&self) -> i64 {
        self.last_success_epoch_seconds.load(Ordering::Relaxed)
    }
}
```

## Rules

- Workers catch and log iteration errors; one failed item must not kill the loop.
- Use `CancellationToken` for shutdown, not global mutable flags.
- Use `JoinSet` or stored `JoinHandle`s so startup code can await worker completion.
- Put blocking filesystem or CPU-heavy work inside `tokio::task::spawn_blocking`.
- Expose health based on last successful run and queue lag.
- Carry `tenant_id` through all background jobs and repository calls.

## Reference Files

- [Messaging instructions](../instructions/messaging.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
