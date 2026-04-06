# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>  
> **Stack**: Rust  
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Follow proper layering (no business logic in handlers)
2. **TDD for Business Logic** — Red-Green-Refactor
3. **Error Handling** — Use `Result<T, E>` with `thiserror` / `anyhow`; no `.unwrap()` in production
4. **Ownership & Borrowing** — Leverage the borrow checker, avoid unnecessary cloning

---

## Background Worker Pattern

### Template: Tokio Task with Interval

```rust
use tokio::time::{self, Duration};
use tracing::{info, error};

pub async fn run_worker(service: Arc<dyn MyService>, cancel: CancellationToken) {
    let mut interval = time::interval(Duration::from_secs(300));
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                info!("worker shutting down");
                break;
            }
            _ = interval.tick() => {
                if let Err(e) = service.process_pending().await {
                    error!(error = %e, "worker iteration failed");
                }
            }
        }
    }
}
```

### Template: Channel Consumer (mpsc)

```rust
use tokio::sync::mpsc;

pub async fn consume(mut rx: mpsc::Receiver<Event>, cancel: CancellationToken) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            event = rx.recv() => match event {
                Some(event) => {
                    if let Err(e) = process_event(&event).await {
                        error!(event_id = %event.id, error = %e, "failed to process");
                    }
                }
                None => break,
            }
        }
    }
}
```

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Interval Workers** | Periodic processing | `tokio::select!` + `time::interval` |
| **Channel Consumers** | Event/message processing | `mpsc::Receiver` + `tokio::select!` |
| **HTTP Handlers** | Request handling | `axum::Router` / `actix-web` |
| **Health Monitors** | System health checks | `/health` + `/ready` endpoints |

---

## Quick Commands

```bash
cargo run --bin server
cargo test
cargo build
cargo clippy -- -D warnings
cargo fmt
```
