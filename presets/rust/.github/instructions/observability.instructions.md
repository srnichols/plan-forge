---
description: Rust observability patterns — tracing JSON logs, OpenTelemetry OTLP, request IDs, metrics, TraceLayer, readiness, and shutdown flushing
applyTo: '**/telemetry*.rs,**/*tracing*.rs,**/*health*.rs,**/middleware/**,**/src/main.rs'
---

# Rust Observability Patterns

## Structured Logging

Use `tracing` spans and fields instead of string-built messages. The default subscriber writes JSON and respects `RUST_LOG` through `EnvFilter`.

```rust
use tracing::{info, instrument};
use uuid::Uuid;

#[instrument(skip(repository), fields(tenant.id = %tenant_id, order.id = %order_id))]
pub async fn reserve_order(
    repository: &dyn OrderRepository,
    tenant_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<()> {
    repository.reserve(tenant_id, order_id).await?;
    info!(event = "order_reserved");
    Ok(())
}
```

Do not log tokens, passwords, full authorization headers, or raw personally identifiable information. Tenant IDs may appear only when they came from verified authentication state, not from a client-supplied header.

## OpenTelemetry Setup

Use mutually compatible telemetry crates: `opentelemetry = "0.33.0"`, `opentelemetry_sdk = "0.33.0"`, `opentelemetry-otlp = "0.33.0"`, and `tracing-opentelemetry = "0.34.0"`.

```rust
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct TelemetryGuard {
    provider: Option<SdkTracerProvider>,
}

impl TelemetryGuard {
    pub fn shutdown(mut self) {
        if let Some(provider) = self.provider.take() {
            if let Err(error) = provider.shutdown() {
                tracing::warn!(?error, "failed to flush OpenTelemetry spans during shutdown");
            }
        }
    }
}

pub fn init_telemetry(service_name: &'static str, otlp_endpoint: Option<String>) -> anyhow::Result<TelemetryGuard> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug,sqlx=warn"));
    let json = tracing_subscriber::fmt::layer()
        .json()
        .with_current_span(true)
        .with_span_list(true);

    if let Some(endpoint) = otlp_endpoint {
        let exporter = SpanExporter::builder()
            .with_tonic()
            .with_endpoint(endpoint)
            .build()?;
        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .build();
        let tracer = provider.tracer(service_name);

        tracing_subscriber::registry()
            .with(filter)
            .with(json)
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .init();

        Ok(TelemetryGuard { provider: Some(provider) })
    } else {
        tracing_subscriber::registry().with(filter).with(json).init();
        Ok(TelemetryGuard { provider: None })
    }
}
```

Hold the returned guard in `main` and call `shutdown()` after `axum::serve(...).await` completes. That explicit flush prevents the final spans from being lost during container shutdown.

## Request Middleware

Install request IDs and tracing in the canonical order: `SetRequestIdLayer` outermost, then `TraceLayer`, then `PropagateRequestIdLayer`.

```rust
use axum::Router;
use tower::ServiceBuilder;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

pub fn telemetry_layers<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router.layer(
        ServiceBuilder::new()
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
            .layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id()),
    )
}
```

If a gateway already supplies `x-request-id`, propagate it; otherwise `SetRequestIdLayer` creates one. Never use request IDs for authentication or tenancy decisions.

Axum serving code should retain peer address information for IP-keyed middleware by serving `app(state).into_make_service_with_connect_info::<SocketAddr>()`; see `deploy.instructions.md` for the full startup snippet.

## Metrics

Expose low-cardinality metrics. Use route templates and outcomes; do not tag by user ID, tenant ID, raw URL, or database record ID.

```rust
use opentelemetry::{global, KeyValue};

pub fn record_order_accepted() {
    let meter = global::meter("checkout-api");
    let counter = meter.u64_counter("orders_accepted_total").build();
    counter.add(1, &[KeyValue::new("outcome", "accepted")]);
}
```

Pair custom metrics with `TraceLayer` latency spans and infrastructure metrics from the orchestrator. High-cardinality dimensions belong in logs or traces, not metric labels.

## Health and Readiness

- `/health/live`: no dependency checks; returns quickly if the process can serve.
- `/health/ready`: checks PostgreSQL, Redis, migrations, and any required downstreams.
- Return `204` for healthy probes and `503` for readiness failure.
- Log dependency failures once per probe interval, not once per failed SQL row or Redis retry.

## Audit Logging

Audit entries should be structured domain events saved through an audit repository and mirrored as logs.

```rust
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub actor_id: Uuid,
    pub tenant_id: Uuid,
    pub action: &'static str,
    pub entity: &'static str,
    pub entity_id: String,
}

pub fn write_audit_log(entry: &AuditEntry) {
    tracing::info!(
        audit = true,
        actor.id = %entry.actor_id,
        tenant.id = %entry.tenant_id,
        action = entry.action,
        entity = entry.entity,
        entity.id = entry.entity_id,
    );
}
```

## Anti-Patterns

```
❌ println! or dbg! in request paths
❌ logging Authorization, cookies, passwords, or raw JWT claims
❌ deriving tenant identity from x-tenant-id or another client header
❌ using user IDs, order IDs, or full URLs as metric labels
❌ initializing tracing in library modules instead of main
❌ forgetting to flush the tracer provider during graceful shutdown
```

## See Also

- `deploy.instructions.md` — liveness/readiness probes and graceful shutdown
- `errorhandling.instructions.md` — RFC 9457 responses and error logging
- `performance.instructions.md` — latency histograms and hot path measurement
