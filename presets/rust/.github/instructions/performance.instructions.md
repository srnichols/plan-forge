---
description: Rust performance patterns — Tokio runtime health, profiling, allocations, pools
applyTo: '**/src/**/*.rs,**/benches/**/*.rs,**/Cargo.toml,**/.cargo/**/*.toml'
---

# Rust Performance Patterns

Measure before optimizing. For Rust services, the main risks are blocking the
Tokio runtime, over-fetching from PostgreSQL, unbounded queues, accidental
clones on hot paths, and release builds without production profile settings.

## Hot Path vs Cold Path

Hot paths run on every request: extractors, auth, validation, repository calls,
serialization, cache lookup, and logging fields. Cold paths include startup
configuration, migration checks, and one-time cache warming.

Rules:

- Benchmark the hot path before rewriting it.
- Keep cold path code readable unless startup time is an objective metric.
- Add tracing spans before profiling so flamegraphs are interpretable.

## Runtime Health

Use `tokio-console` through the `console-subscriber` crate when diagnosing
stalls, long polls, or tasks that never yield.

```rust
pub fn init_console_layer() {
    console_subscriber::init();
}
```

Enable Tokio runtime instrumentation in development builds used for console
sessions:

```toml
tokio = { version = "1.53.1", features = ["full", "tracing"] }
console-subscriber = "0.5.0"
```

Run console-enabled builds with `RUSTFLAGS="--cfg tokio_unstable"`, for example
`$env:RUSTFLAGS='--cfg tokio_unstable'; cargo run` in PowerShell or
`set RUSTFLAGS=--cfg tokio_unstable && cargo run` in `cmd.exe`.

Do not enable console collection in production unless the operational risk and
data exposure have been reviewed.

## Blocking Work

Never run blocking file I/O, compression, password hashing, CPU-heavy parsing,
or synchronous SDK calls directly in an async handler.

```rust
pub async fn hash_password(password: String) -> anyhow::Result<String> {
    tokio::task::spawn_blocking(move || {
        expensive_hash(password)
    })
    .await?
}

fn expensive_hash(password: String) -> anyhow::Result<String> {
    Ok(format!("hashed:{password}"))
}
```

For repeated CPU-heavy work, prefer a bounded worker pool or queue over
unlimited `spawn_blocking` calls.

## Database Throughput

- Size `PgPoolOptions::max_connections` from load tests, not CPU count alone.
- Select only response columns; do not hydrate full rows for list endpoints.
- Use keyset pagination for large tables.
- Batch related lookups with `WHERE id = ANY($1)`.
- Run `EXPLAIN (ANALYZE, BUFFERS)` for slow queries and commit the index that
  fixes the measured plan.

Connection starvation usually appears as high acquire latency before high CPU.
Instrument pool wait time separately from query execution.

## Allocation and Clone Hygiene

Prefer borrowing and `Arc` state cloning over deep clones. Clone request DTOs
only when ownership is required beyond the current await point.

```rust
use std::sync::Arc;

#[derive(Clone)]
pub struct PricingService {
    rules: Arc<PricingRules>,
}

pub struct PricingRules {
    pub default_currency: String,
}

impl PricingService {
    pub fn currency(&self) -> &str {
        &self.rules.default_currency
    }
}
```

Watch for:

- `to_string()` inside loops when `&str` would work.
- `Vec` collection before streaming a response.
- `serde_json::Value` used where a typed DTO is known.
- cloning large DTOs to satisfy a layer boundary instead of changing the
  boundary to accept a reference.

## Profiling Toolkit

| Tool | Use it for | Command |
|------|------------|---------|
| `tokio-console` | task stalls, busy tasks, resource waits | `tokio-console` |
| `cargo flamegraph` | CPU hotspots in a realistic run | `cargo flamegraph --bin app` |
| `criterion` | microbenchmarks for pure functions | `cargo bench` |
| `cargo llvm-cov` | coverage during performance-safe refactors | `cargo llvm-cov nextest` |

Criterion belongs in `benches/` and should benchmark a stable public function,
not a private implementation detail that changes every refactor.

```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn normalize_key(input: &str) -> String {
    input.trim().to_ascii_lowercase()
}

fn bench_normalize_key(c: &mut Criterion) {
    c.bench_function("normalize_key", |b| b.iter(|| normalize_key("  PRODUCT-42  ")));
}

criterion_group!(benches, bench_normalize_key);
criterion_main!(benches);
```

## Release Profile

Production binaries should use link-time optimization and fewer codegen units
once release build time is acceptable.

```toml
[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
```

Measure binary size, cold start, and request latency before and after changing
profile settings. Do not set `panic = "abort"` for a multi-tenant server:
unwinding lets Tower/Axum catch-panic middleware convert an isolated panic into
a failed request instead of terminating every tenant's traffic.

## Caching and Backpressure

Cache only data with a clear invalidation story. Add bounded queues for
background work; unbounded channels convert traffic spikes into memory outages.

```rust
let (sender, mut receiver) = tokio::sync::mpsc::channel::<WorkItem>(512);

while let Some(item) = receiver.recv().await {
    process_item(item).await?;
}
```

## Review Checklist

- No blocking call runs on a Tokio worker thread.
- Slow paths have spans and can be located in traces.
- SQL list endpoints use keyset pagination or a documented small bound.
- Cache changes include invalidation and stampede behavior.
- Pool sizes, queue sizes, and timeouts are explicit configuration.
- Release profile changes are benchmarked before they ship.

## See Also

- `database.instructions.md` — query plans, pool setup, keyset pagination
- `caching.instructions.md` — Redis and moka cache behavior
- `observability.instructions.md` — tracing and metrics collection
