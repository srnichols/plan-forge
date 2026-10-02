---
description: Rust messaging patterns — RabbitMQ with lapin, NATS JetStream, durable consumers, idempotency, retries, dead-letter, graceful shutdown
applyTo: '**/src/**/*event*.rs,**/src/**/*message*.rs,**/src/**/*worker*.rs,**/src/messaging/**,**/migrations/**/*message*.sql'
---

# Rust Messaging & Pub/Sub Patterns

## Messaging Strategy

Use the broker your platform already runs. For RabbitMQ, `lapin` 4.12.0 is mature and pure Rust-friendly. For NATS, `async-nats` 0.50.0 supports JetStream. Avoid Kafka/`rdkafka` as the default because it introduces native `librdkafka` build and runtime requirements; choose it only when Kafka is already a hard platform requirement.

## Event Schema

Events are DTOs, not domain entities. Include `event_id`, `tenant_id`, and `occurred_at` on every cross-process message.

```rust
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderPlacedEvent {
    pub event_id: Uuid,
    pub tenant_id: Uuid,
    pub order_id: Uuid,
    pub occurred_at: OffsetDateTime,
}
```

## Messaging Traits

Use one publisher and one consumer trait in `src/messaging/mod.rs`; event handlers and workers depend on these traits rather than concrete brokers.

```rust
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

#[async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish_json<T>(
        &self,
        exchange: &str,
        routing_key: &str,
        event: &T,
    ) -> Result<(), AppError>
    where
        T: Serialize + Send + Sync;
}

#[async_trait]
pub trait EventHandler<E>: Send + Sync {
    async fn handle(&self, event: E) -> Result<(), AppError>;
}

#[async_trait]
pub trait MessageConsumer<E>: Send + Sync
where
    E: DeserializeOwned + Send + 'static,
{
    async fn run<H>(self, handler: H, shutdown: CancellationToken) -> Result<(), AppError>
    where
        H: EventHandler<E> + Send + Sync + 'static;
}
```

## RabbitMQ Publishing with Confirms

Declare durable topology on startup and require publisher confirms before returning success from the outbox dispatcher.

```rust
use lapin::{
    options::{BasicPublishOptions, ConfirmSelectOptions},
    BasicProperties, Channel,
};

pub async fn publish_order_event(
    channel: &Channel,
    payload: Vec<u8>,
    event_id: &str,
) -> anyhow::Result<()> {
    channel.confirm_select(ConfirmSelectOptions::default()).await?;

    let publisher_confirm = channel.basic_publish(
        "events".into(),
        "order.placed".into(),
        BasicPublishOptions::default(),
        &payload,
        BasicProperties::default()
            .with_message_id(event_id.into())
            .with_content_type("application/json".into())
            .with_delivery_mode(2),
    ).await?;

    let confirmation = publisher_confirm.await?;
    if confirmation.is_ack() {
        Ok(())
    } else {
        anyhow::bail!("broker rejected published message")
    }
}
```

## RabbitMQ Consumer with Ack/Nack

Consumers explicitly ack only after the service transaction commits. Transient failures nack for retry; permanent validation failures route to dead-letter by rejecting without requeue.

```rust
use futures_util::StreamExt;
use lapin::{
    message::Delivery,
    options::{BasicAckOptions, BasicConsumeOptions, BasicNackOptions},
    types::FieldTable,
    Channel,
};
use tokio_util::sync::CancellationToken;

use crate::{error::AppError, services::OrderProcessor};

pub async fn run_order_consumer(
    channel: Channel,
    processor: OrderProcessor,
    shutdown: CancellationToken,
) -> Result<(), AppError> {
    let mut consumer = channel
        .basic_consume(
            "order-processing".into(),
            "order-worker".into(),
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await
        .map_err(|err| AppError::Internal(err.into()))?;

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            delivery = consumer.next() => {
                let Some(delivery) = delivery else { break };
                match delivery {
                    Ok(delivery) => {
                        if let Err(error) = handle_delivery(delivery, &processor).await {
                            tracing::error!(?error, "message handling failed");
                        }
                    }
                    Err(error) => tracing::error!(?error, "consumer delivery failed"),
                }
            }
        }
    }
    Ok(())
}

async fn handle_delivery(delivery: Delivery, processor: &OrderProcessor) -> Result<(), AppError> {
    let outcome = processor.process_message(&delivery.data).await;
    match outcome {
        Ok(()) => {
            delivery.ack(BasicAckOptions::default()).await
                .map_err(|err| AppError::Internal(err.into()))?;
        }
        Err(AppError::Validation(_)) => {
            delivery.nack(BasicNackOptions { multiple: false, requeue: false, ..Default::default() }).await
                .map_err(|err| AppError::Internal(err.into()))?;
        }
        Err(err) => {
            delivery.nack(BasicNackOptions { multiple: false, requeue: true, ..Default::default() }).await
                .map_err(|nack_err| AppError::Internal(nack_err.into()))?;
            return Err(err);
        }
    };
    Ok(())
}
```

## Retry and Dead-Letter Topology

Create the broker policy or queue arguments in infrastructure:

```text
exchange events              -> queue order-processing
queue order-processing       -> x-dead-letter-exchange events.dlx
exchange events.retry        -> per-delay retry queues with x-message-ttl
exchange events.dlx          -> queue order-processing.dead
```

Use exponential backoff in the publisher or retry scheduler. Keep retry count in headers; move to dead-letter when attempts are exhausted.

## Idempotency in One Transaction

Duplicate detection must be durable and atomic with the side effect. Insert into `processed_messages` in the same database transaction that performs the business work. Only a unique-constraint violation on `(consumer_name, message_id)` counts as a duplicate.

```rust
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::error::AppError;

pub async fn process_once(
    pool: &PgPool,
    consumer_name: &str,
    message_id: Uuid,
    tenant_id: Uuid,
    order_id: Uuid,
) -> Result<bool, AppError> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;

    let inserted = sqlx::query(
        "INSERT INTO processed_messages (consumer_name, message_id, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (consumer_name, message_id) DO NOTHING",
    )
    .bind(consumer_name)
    .bind(message_id)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if inserted == 0 {
        tx.rollback().await?;
        return Ok(false);
    }

    sqlx::query("UPDATE orders SET status = 'processed' WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id)
        .bind(order_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}
```

## NATS JetStream Alternative

Use JetStream for lightweight event streams where the platform already runs NATS.

```rust
use async_nats::jetstream::{self, consumer::pull::Config};

pub async fn ensure_pull_consumer(client: async_nats::Client) -> Result<(), async_nats::Error> {
    let context = jetstream::new(client);
    let stream = context.get_stream("ORDERS").await?;
    stream.create_consumer(Config {
        durable_name: Some("order-worker".to_string()),
        ack_policy: jetstream::consumer::AckPolicy::Explicit,
        max_deliver: 5,
        ..Default::default()
    }).await?;
    Ok(())
}
```

## Graceful Shutdown

- Pass a `CancellationToken` to every worker loop.
- Stop pulling new messages when cancellation fires.
- Allow in-flight handlers to finish within the process shutdown budget.
- Ack after commit; nack/requeue when cancellation interrupts before the side effect commits.
- Track workers with `JoinSet` and log join failures.

## Anti-Patterns

```text
Do not publish full SQLx models; publish event DTOs.
Do not omit tenant_id from payloads.
Do not auto-ack before the service transaction commits.
Do not treat every database error as duplicate delivery.
Do not use in-memory idempotency for broker consumers.
Do not spin forever after shutdown has been requested.
```

## See Also

- `dapr.instructions.md` — Dapr pub/sub sidecar patterns
- `observability.instructions.md` — tracing message IDs and consumer lag
- `database.instructions.md` — transactional outbox and SQLx transactions
