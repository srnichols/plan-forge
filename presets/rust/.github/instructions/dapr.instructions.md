---
description: Rust Dapr patterns — sidecar HTTP API, state, pub/sub, secrets, component YAML, tenant isolation, resiliency
applyTo: '**/*dapr*.rs,**/src/dapr/**,**/components/**/*.yaml,**/components/**/*.yml,**/*workflow*.rs'
---

# Rust Dapr Patterns

> Standard: Dapr v1.18+ sidecar APIs. The preset uses `reqwest` against the sidecar HTTP API because `dapr` 0.19 depends on Axum 0.7 while this stack is pinned to Axum 0.8.

## Client Setup

Read `DAPR_HTTP_ENDPOINT` from configuration and keep a single `reqwest::Client` in state.

```rust
use reqwest::Url;

#[derive(Clone)]
pub struct DaprHttpClient {
    base_url: Url,
    client: reqwest::Client,
}

impl DaprHttpClient {
    pub fn from_endpoint(endpoint: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self {
            base_url: Url::parse(endpoint)?,
            client: reqwest::Client::new(),
        })
    }
}
```

## State Management

Prefix keys with the tenant ID and include tenant metadata so sidecar logs and backend stores can be audited.

```rust
use serde::Serialize;

impl DaprHttpClient {
    pub async fn save_tenant_state<T: Serialize>(
        &self,
        store: &str,
        tenant_id: &str,
        entity_id: &str,
        value: T,
    ) -> Result<(), reqwest::Error> {
        let url = self.base_url.join(&format!("/v1.0/state/{store}")).expect("valid state path");
        let key = format!("{tenant_id}-{entity_id}");
        let body = serde_json::json!([{
            "key": key,
            "value": value,
            "metadata": {
                "contentType": "application/json",
                "tenantId": tenant_id
            }
        }]);

        self.client.post(url).json(&body).send().await?.error_for_status()?;
        Ok(())
    }
}
```

For optimistic concurrency, pass the current etag in the state item and set Dapr's concurrency option to first-write. Return a conflict to the caller if Dapr rejects the etag.

## Pub/Sub

Publishing goes through the sidecar; durable retry and dead-letter behavior belongs in the component/resiliency YAML.

```rust
use serde::Serialize;

impl DaprHttpClient {
    pub async fn publish_event<T: Serialize>(
        &self,
        pubsub: &str,
        topic: &str,
        event: &T,
    ) -> Result<(), reqwest::Error> {
        let url = self.base_url
            .join(&format!("/v1.0/publish/{pubsub}/{topic}"))
            .expect("valid publish path");

        self.client
            .post(url)
            .header("content-type", "application/json")
            .json(event)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
```

Subscriptions are normal Axum routes. Return `2xx` only after idempotent processing succeeds; return a retryable error for transient failures.

```rust
use axum::{extract::State, http::HeaderMap, Json};
use serde::Deserialize;
use secrecy::ExposeSecret;
use uuid::Uuid;

use crate::{domain::{OrderId, TenantId}, error::AppError, state::AppState};

#[derive(Debug, Deserialize)]
pub struct DaprCloudEvent<T> {
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: T,
}

#[derive(Debug, Deserialize)]
pub struct OrderPlacedData {
    pub event_id: Uuid,
    pub tenant_id: Uuid,
    pub order_id: Uuid,
}

pub async fn order_placed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<DaprCloudEvent<OrderPlacedData>>,
) -> Result<(), AppError> {
    let token = headers
        .get("dapr-api-token")
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let expected = state
        .settings
        .api_token
        .as_ref()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("APP_API_TOKEN is required for Dapr subscriptions")))?;

    if !constant_time_eq(token, expected.expose_secret()) {
        return Err(AppError::Unauthorized);
    }

    state.orders
        .mark_processed(TenantId(event.data.tenant_id), OrderId(event.data.order_id))
        .await
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut diff = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        diff |= (*left.get(index).unwrap_or(&0) ^ *right.get(index).unwrap_or(&0)) as usize;
    }
    diff == 0
}
```

## Service Invocation

Let Dapr handle mTLS, retries, and tracing between services, but keep request and response DTOs typed in Rust.

```rust
impl DaprHttpClient {
    pub async fn invoke_json<T, R>(
        &self,
        app_id: &str,
        method: &str,
        request: &T,
    ) -> Result<R, reqwest::Error>
    where
        T: serde::Serialize + ?Sized,
        R: serde::de::DeserializeOwned,
    {
        let url = self.base_url
            .join(&format!("/v1.0/invoke/{app_id}/method/{method}"))
            .expect("valid invocation path");
        self.client.post(url).json(request).send().await?.error_for_status()?.json().await
    }
}
```

## Secrets

Use Dapr secret stores for platform secrets, then wrap returned values in `SecretString` before passing them deeper into the application.

```rust
use anyhow::anyhow;
use secrecy::SecretString;
use std::collections::HashMap;

use crate::error::AppError;

fn dapr_transport_error(error: reqwest::Error) -> AppError {
    AppError::Internal(error.into())
}

impl DaprHttpClient {
    pub async fn get_secret(
        &self,
        store: &str,
        name: &str,
    ) -> Result<SecretString, AppError> {
        let url = self.base_url
            .join(&format!("/v1.0/secrets/{store}/{name}"))
            .expect("valid secret path");
        let values: HashMap<String, String> = self.client
            .get(url)
            .send()
            .await
            .map_err(dapr_transport_error)?
            .error_for_status()
            .map_err(dapr_transport_error)?
            .json()
            .await
            .map_err(dapr_transport_error)?;
        values
            .get(name)
            .cloned()
            .map(SecretString::from)
            .ok_or_else(|| AppError::Internal(anyhow!("Dapr secret {name} missing")))
    }
}
```

Never log the map returned by the sidecar; even debug logs can leak secret values.

## Component Scoping

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: pubsub
spec:
  type: pubsub.rabbitmq
  version: v1
  metadata:
    - name: host
      secretKeyRef:
        name: rabbitmq-connection-string
        key: value
    - name: durable
      value: "true"
scopes:
  - orders-api
  - orders-worker
```

## Resiliency

```yaml
apiVersion: dapr.io/v1alpha1
kind: Resiliency
metadata:
  name: orders-resiliency
spec:
  policies:
    retries:
      pubsubRetry:
        policy: exponential
        maxInterval: 30s
        maxRetries: 5
    circuitBreakers:
      inventoryBreaker:
        maxRequests: 1
        timeout: 60s
        trip: consecutiveFailures > 5
  targets:
    apps:
      inventory-service:
        retry: pubsubRetry
        circuitBreaker: inventoryBreaker
    components:
      pubsub:
        outbound:
          retry: pubsubRetry
```

## Multi-Tenant Isolation Checklist

| Layer | Rust/Dapr Pattern |
| --- | --- |
| State keys | `{tenant_id}-{entity_id}` prefix |
| Pub/sub topics | tenant in the event data; topic partitioning only when needed |
| Metadata | include `tenantId` on state writes |
| Subscriptions | validate CloudEvent data before service calls |
| Secrets | scoped components and `secretKeyRef` |
| Workflows | tenant ID in workflow input and activity DTOs |

## Health Check

Call `/v1.0/healthz` from a readiness endpoint and include a short timeout. A down sidecar should fail readiness for code paths that require Dapr.

## Anti-Patterns

```text
Do not hardcode localhost:3500; use DAPR_HTTP_ENDPOINT.
Do not create unscoped components.
Do not put tenant data in flat state keys.
Do not inline connection strings in component YAML.
Do not publish events without a dead-letter or retry policy.
Do not log Dapr secret responses.
```

## See Also

- `messaging.instructions.md` — event schemas and idempotent consumers
- `security.instructions.md` — secret handling and validation
- `observability.instructions.md` — health checks, request IDs, and traces
