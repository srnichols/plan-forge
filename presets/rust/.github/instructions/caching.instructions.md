---
description: Rust caching patterns — Redis cache-aside, moka local cache, TTLs, invalidation
applyTo: '**/src/cache/**/*.rs,**/src/state.rs,**/src/services/**/*.rs,**/Cargo.toml'
---

# Rust Caching Patterns

Use cache-aside by default: read the cache, load from the repository on miss,
then write the serialized response with a TTL. Cache DTOs or immutable
snapshots, not live domain aggregates with hidden invariants.

## Redis Cache-Aside

Use `deadpool-redis` on Tokio. Redis failures should be observable but should
not make read paths unavailable when the database can answer the request.

```rust
use deadpool_redis::{Config, Pool, Runtime};
use redis::AsyncCommands;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

pub fn redis_pool(redis_url: &str) -> Result<Pool, deadpool_redis::CreatePoolError> {
    Config::from_url(redis_url).create_pool(Some(Runtime::Tokio1))
}

pub async fn read_json<T: DeserializeOwned>(pool: &Pool, key: &str) -> anyhow::Result<Option<T>> {
    let mut connection = pool.get().await?;
    let payload: Option<String> = connection.get(key).await?;
    payload
        .map(|body| serde_json::from_str(&body))
        .transpose()
        .map_err(Into::into)
}

pub async fn write_json<T: Serialize>(
    pool: &Pool,
    key: &str,
    value: &T,
    ttl: Duration,
) -> anyhow::Result<()> {
    let mut connection = pool.get().await?;
    let seconds = ttl.as_secs().max(1);
    connection
        .set_ex::<_, _, ()>(key, serde_json::to_string(value)?, seconds)
        .await?;
    Ok(())
}
```

## In-Process Cache Option

Use `moka` for single-process hot data, feature flags, or reference lookups.
Do not use it as the only cache for horizontally scaled mutable data.

```rust
use moka::future::Cache;
use std::time::Duration;

pub fn product_lookup_cache() -> Cache<String, ProductView> {
    Cache::builder()
        .max_capacity(10_000)
        .time_to_live(Duration::from_secs(300))
        .build()
}

#[derive(Clone, Debug)]
pub struct ProductView {
    pub id: uuid::Uuid,
    pub display_name: String,
}
```

`Cache::get_with` coalesces concurrent misses for the same key and is the
preferred local stampede-control primitive.

## Key Naming

Every key starts with the authenticated tenant. Include a schema version when
changing serialized shape.

```rust
use crate::domain::{OrderId, TenantId};

pub fn order_cache_key(tenant_id: TenantId, order_id: OrderId) -> String {
    format!("tenant:{}:orders:v1:{}", tenant_id.0, order_id.0)
}
```

List and search keys include a stable hash of the normalized filters rather
than raw JSON or user text.

## TTL Strategy

| Data | Suggested TTL | Notes |
|------|---------------|-------|
| Entity by id | 5-15 minutes | Evict on update/delete |
| List/search page | 30-120 seconds | Short TTL because filters drift quickly |
| Reference data | 1-6 hours | Add explicit invalidation for admin writes |
| Permission snapshot | 1-5 minutes | Prefer token claims where possible |
| Expensive count | 30-90 seconds | Never cache without tenant prefix |

Jitter Redis TTLs by a small percentage for high-volume keys to avoid
simultaneous expiry waves.

## Invalidation on Write

Write to the database first, commit the transaction, then delete affected keys.
If deletion fails, log it and rely on TTL; do not roll back committed business
data solely because the cache was unavailable. List and search pages should
depend on a per-tenant version key; deleting a prefix does not remove Redis keys
that include a filter hash.

```rust
use deadpool_redis::Pool;
use redis::AsyncCommands;

use crate::domain::{OrderId, TenantId};

pub fn order_list_version_key(tenant_id: TenantId) -> String {
    format!("tenant:{}:orders:list-version", tenant_id.0)
}

pub fn order_list_key(tenant_id: TenantId, version: u64, filter_hash: &str) -> String {
    format!("tenant:{}:orders:list:v{}:{}", tenant_id.0, version, filter_hash)
}

pub async fn invalidate_order(pool: &Pool, tenant_id: TenantId, order_id: OrderId) -> anyhow::Result<()> {
    let mut connection = pool.get().await?;
    redis::pipe()
        .del(order_cache_key(tenant_id, order_id))
        .incr(order_list_version_key(tenant_id), 1_u8)
        .query_async::<()>(&mut connection)
        .await?;
    Ok(())
}
```

List reads load the current version and build `order_list_key(...)`; any write
increments the version so old hashed list pages fall out by TTL without relying
on pattern deletes. Keep invalidation code close to the service method that
performs the write so it cannot be forgotten.

## Stampede Protection

For Redis-backed cache-aside, protect expensive misses with a short lock using
`SET NX PX`. Losers wait briefly and retry the cache before hitting the
database.

```rust
use deadpool_redis::Pool;
use redis::{AsyncCommands, SetExpiry, SetOptions};
use std::time::Duration;

pub async fn try_miss_lock(pool: &Pool, lock_key: &str, token: &str) -> anyhow::Result<bool> {
    let mut connection = pool.get().await?;
    let acquired: Option<String> = connection
        .set_options(
            lock_key,
            token,
            SetOptions::default()
                .conditional_set(redis::ExistenceCheck::NX)
                .with_expiration(SetExpiry::PX(2_000)),
        )
        .await?;

    Ok(acquired.is_some())
}

pub async fn wait_before_retry() {
    tokio::time::sleep(Duration::from_millis(50)).await;
}
```

Use this only around expensive loads. For ordinary entity reads, `moka`
`get_with` or a short Redis TTL is usually enough.

## Cache Tests

- Unit-test key builders so tenant prefixes and schema versions never regress.
- Use `moka` tests with concurrent `get_with` calls to prove one loader runs.
- Run Redis integration tests against `redis:8-alpine` for TTL, invalidation,
  serialization, and lock semantics.
- Include a wrong-tenant test that confirms one tenant cannot read another
  tenant's key.

## Anti-Patterns

```
Do not cache data without a TTL.
Do not serialize with bincode or custom binary formats for cross-service keys.
Do not put raw emails, bearer tokens, or secrets in keys.
Do not share cache entries across tenants, even for identical records.
Do not ignore repeated Redis failures; emit metrics and logs.
```

## See Also

- `database.instructions.md` — write transactions and repository boundaries
- `performance.instructions.md` — hot-path profiling and allocation hygiene
- `multi-environment.instructions.md` — per-environment Redis endpoints
