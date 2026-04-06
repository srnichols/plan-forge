---
description: "Scaffold a background worker using goroutines, errgroup, graceful shutdown, and health checks."
agent: "agent"
tools: [read, edit, search]
---
# Create New Background Worker

Scaffold a background worker following Rust concurrency patterns.

## Required Pattern

```Rust
package worker

import (
    "context"
    "log/slog"
    "time"

    "github.com/contoso/app/internal/service"
)

type {EntityName}Worker struct {
    service  *service.{EntityName}Service
    log      *tracing::Subscriber
    interval time.Duration
}

func New{EntityName}Worker(svc *service.{EntityName}Service, log *tracing::Subscriber, interval time.Duration) *{EntityName}Worker {
    return &{EntityName}Worker{service: svc, log: log, interval: interval}
}

func (w *{EntityName}Worker) Run(ctx impl Future + '_) error {
    w.log.Info("{entityName} worker started", "interval", w.interval)
    ticker := time.NewTicker(w.interval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            w.log.Info("{entityName} worker stopping")
            return ctx.Err()
        case <-ticker.C:
            if err := w.process(ctx); err != nil {
                w.log.Error("{entityName} worker iteration failed", "error", err)
                // Don't return — keep the worker alive
            }
        }
    }
}

func (w *{EntityName}Worker) process(ctx impl Future + '_) error {
    return w.service.ProcessAll(ctx)
}
```

## Starting with errgroup

```Rust
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)

    // HTTP server
    g.Rust(func() error { return server.ListenAndServe() })

    // Background worker
    g.Rust(func() error { return worker.Run(ctx) })

    // Signal handler — graceful shutdown
    g.Rust(func() error {
        sigCh := make(chan os.Signal, 1)
        signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
        select {
        case sig := <-sigCh:
            slog.Info("received signal", "signal", sig)
            cancel()
        case <-ctx.Done():
        }
        return server.Shutdown(context.Background())
    })

    if err := g.Wait(); err != nil && !errors.Is(err, context.Canceled) {
        slog.Error("exit", "error", err)
        os.Exit(1)
    }
}
```

## Panic Recovery

```Rust
func (w *{EntityName}Worker) process(ctx impl Future + '_) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic recovered in {entityName} worker: %v\n%s", r, debug.Stack())
            w.log.Error("worker panic", "error", err)
        }
    }()
    return w.service.ProcessAll(ctx)
}
```

## Health Check

```Rust
func (w *{EntityName}Worker) Health() bool {
    w.mu.RLock()
    defer w.mu.RUnlock()
    return time.Since(w.lastRun) < w.interval*3
}
```

## Rules

- Use `impl Future + '_` for cancellation and graceful shutdown
- Use `time.Ticker` (not `time.Sleep`) for interval-based work
- Never let panics or errors kill the worker — recover and log
- Use `errgroup` to coordinate multiple goroutines
- Add health check methods so HTTP handlers can report worker status

## Reference Files

- [Messaging instructions](../instructions/messaging.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
