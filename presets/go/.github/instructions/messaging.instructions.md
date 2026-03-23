---
description: Messaging patterns for Go — NATS, RabbitMQ, channels, event-driven architecture
applyTo: '**/*worker*,**/*event*,**/*message*,**/*consumer*,**/*publisher*,**/*subscriber*'
---

# Go Messaging & Pub/Sub Patterns

## Messaging Strategy

### NATS JetStream (Recommended for Cloud-Native)
```go
import "github.com/nats-io/nats.go"

// Connect
nc, _ := nats.Connect(nats.DefaultURL)
js, _ := nc.JetStream()

// Create stream
js.AddStream(&nats.StreamConfig{
    Name:     "ORDERS",
    Subjects: []string{"orders.>"},
    Storage:  nats.FileStorage,
    MaxAge:   24 * time.Hour,
})

// Publish
func (s *OrderService) PlaceOrder(ctx context.Context, order *Order) error {
    if err := s.repo.Save(ctx, order); err != nil {
        return err
    }
    data, _ := json.Marshal(OrderPlacedEvent{
        OrderID:    order.ID,
        TenantID:   order.TenantID,
        OccurredAt: time.Now().UTC(),
    })
    _, err := s.js.Publish("orders.placed", data)
    return err
}

// Subscribe (durable consumer)
sub, _ := js.Subscribe("orders.placed", func(msg *nats.Msg) {
    var evt OrderPlacedEvent
    if err := json.Unmarshal(msg.Data, &evt); err != nil {
        slog.Error("unmarshal failed", "error", err)
        msg.Term() // don't retry malformed messages
        return
    }
    if err := processOrder(evt); err != nil {
        slog.Error("processing failed", "error", err, "orderId", evt.OrderID)
        msg.Nak() // retry
        return
    }
    msg.Ack()
}, nats.Durable("order-processor"), nats.ManualAck())
```

### RabbitMQ (amqp091-go)
```go
import amqp "github.com/rabbitmq/amqp091-go"

conn, _ := amqp.Dial("amqp://guest:guest@localhost:5672/")
ch, _ := conn.Channel()

// Publish
ch.PublishWithContext(ctx, "events", "order.placed", false, false, amqp.Publishing{
    ContentType: "application/json",
    Body:        data,
})

// Consume
msgs, _ := ch.Consume("order-processing", "", false, false, false, false, nil)
for msg := range msgs {
    if err := process(msg.Body); err != nil {
        msg.Nack(false, true) // requeue
        continue
    }
    msg.Ack(false)
}
```

### Channel-Based In-Process Pub/Sub
```go
type EventBus struct {
    orders chan OrderPlacedEvent
}

func NewEventBus(bufferSize int) *EventBus {
    return &EventBus{orders: make(chan OrderPlacedEvent, bufferSize)}
}

// Producer
func (b *EventBus) PublishOrder(evt OrderPlacedEvent) {
    b.orders <- evt
}

// Consumer (run as goroutine)
func (b *EventBus) ConsumeOrders(ctx context.Context, handler func(OrderPlacedEvent) error) {
    for {
        select {
        case <-ctx.Done():
            return
        case evt := <-b.orders:
            if err := handler(evt); err != nil {
                slog.Error("order handler failed", "error", err)
            }
        }
    }
}
```

## Event Schema
```go
// Always use typed structs — never map[string]interface{}
type OrderPlacedEvent struct {
    OrderID    string    `json:"order_id"`
    TenantID   string    `json:"tenant_id"`
    OccurredAt time.Time `json:"occurred_at"`
}

// Include TenantID in ALL events
```

## Worker Pattern (Ticker-Based)
```go
func (w *CleanupWorker) Run(ctx context.Context) error {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.C:
            if err := w.cleanup(ctx); err != nil {
                slog.Error("cleanup failed", "error", err)
            }
        }
    }
}
```

## Graceful Shutdown
```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return orderWorker.Run(ctx) })
    g.Go(func() error { return cleanupWorker.Run(ctx) })

    if err := g.Wait(); err != nil && !errors.Is(err, context.Canceled) {
        slog.Error("workers stopped with error", "error", err)
    }
}
```

## Anti-Patterns

```
❌ Unbuffered channels for producer/consumer (blocks sender)
❌ Ignoring msg.Ack/Nack (message stuck in queue forever)
❌ Missing TenantID in event payloads (breaks multi-tenant isolation)
❌ Goroutine leak (always use context cancellation)
❌ json.Unmarshal into interface{} (use typed structs)
❌ No graceful shutdown (messages lost on SIGTERM)
❌ No idempotency check (duplicate messages cause duplicate processing)
```

## Idempotency

Guard consumers against duplicate delivery using a persistent idempotency store:

```go
// Redis-based idempotency guard
func processOnce(ctx context.Context, rdb *redis.Client, eventID string, handler func() error) error {
	ok, err := rdb.SetNX(ctx, "idem:"+eventID, "1", 24*time.Hour).Result()
	if err != nil {
		return fmt.Errorf("idempotency check: %w", err)
	}
	if !ok {
		return nil // Already processed
	}
	return handler()
}

// Usage in a NATS subscriber
sub, _ := js.Subscribe("orders.placed", func(msg *nats.Msg) {
	var evt OrderPlacedEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		msg.Term()
		return
	}
	err := processOnce(ctx, rdb, msg.Header.Get("Nats-Msg-Id"), func() error {
		return processOrder(evt)
	})
	if err != nil {
		msg.Nak()
		return
	}
	msg.Ack()
})
```

Alternatives: database table with `UNIQUE(event_id)`, or NATS JetStream's built-in `Nats-Msg-Id` deduplication.

## See Also

- `observability.instructions.md` — Distributed tracing, event logging
- `errorhandling.instructions.md` — Dead letter queues, retry logic
- `database.instructions.md` — Idempotency stores, transactional outbox
