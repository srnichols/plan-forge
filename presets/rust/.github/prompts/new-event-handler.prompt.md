---
description: "Scaffold Rust domain events, durable broker handlers, and idempotent processing."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold typed Rust events and handlers for Axum/Tokio services.

## Required Pattern

### Event Type
```rust
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct {EntityName}CreatedEvent {
    pub event_id: Uuid,
    pub tenant_id: Uuid,
    pub {entity_name}_id: Uuid,
    pub occurred_at: OffsetDateTime,
}
```

### Handler Trait
```rust
use crate::messaging::EventHandler;
```

### Durable Handler
```rust
use std::sync::Arc;

use crate::domain::{TenantId, {EntityName}Id};

pub struct {EntityName}CreatedHandler {
    service: Arc<{EntityName}Service>,
}

#[async_trait::async_trait]
impl EventHandler<{EntityName}CreatedEvent> for {EntityName}CreatedHandler {
    async fn handle(&self, event: {EntityName}CreatedEvent) -> Result<(), crate::error::AppError> {
        self.service
            .mark_processed(TenantId(event.tenant_id), {EntityName}Id(event.{entity_name}_id))
            .await
    }
}
```

### Publishing Events
```rust
pub async fn publish_{entity_name}_created<P>(
    publisher: &P,
    event: {EntityName}CreatedEvent,
) -> Result<(), crate::error::AppError>
where
    P: EventPublisher + Send + Sync,
{
    publisher
        .publish_json("events", "{entity_name}.created", &event)
        .await
}
```

### Consumer Loop
```rust
pub async fn run_{entity_name}_consumer<C, H>(
    consumer: C,
    handler: H,
    shutdown: tokio_util::sync::CancellationToken,
) -> Result<(), crate::error::AppError>
where
    C: MessageConsumer<{EntityName}CreatedEvent> + Send + Sync,
    H: EventHandler<{EntityName}CreatedEvent> + 'static,
{
    consumer.run(handler, shutdown).await
}
```

## Rules

- Events are immutable DTOs; never publish SQLx models or Axum request types.
- Every event includes `event_id`, `tenant_id`, and `occurred_at`.
- Handlers must be idempotent with a `processed_messages` row in the same transaction as the side effect.
- Ack broker messages only after handler success.
- Nack transient failures with backoff and send exhausted messages to a dead-letter queue.
- Keep event structs in `src/events/` and durable broker adapters in `src/messaging/`.

## Reference Files

- [Messaging patterns](../instructions/messaging.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
