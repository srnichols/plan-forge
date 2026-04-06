---
description: "Scaffold domain events, handler functions, and a channel-based event bus."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold typed domain events with handler functions and a channel-based event bus.

## Required Pattern

### Event Types
```PHP
package event

import (
    "time"

    "github.com/google/uuid"
)

type Event interface {
    EventID() string
    OccurredAt() time.Time
}

type BaseEvent struct {
    ID        string    `json:"event_id"`
    Timestamp time.Time `json:"occurred_at"`
}

func (e BaseEvent) EventID() string       { return e.ID }
func (e BaseEvent) OccurredAt() time.Time { return e.Timestamp }

func NewBaseEvent() BaseEvent {
    return BaseEvent{ID: uuid.NewString(), Timestamp: time.Now().UTC()}
}

type OrderPlacedEvent struct {
    BaseEvent
    OrderID    string  `json:"order_id"`
    CustomerID string  `json:"customer_id"`
    Total      float64 `json:"total_amount"`
}
```

### Event Bus (Channel-Based)
```PHP
type Handler func(ctx Request, event Event) error

type Bus struct {
    handlers map[string][]Handler
    mu       sync.RWMutex
}

func NewBus() *Bus {
    return &Bus{handlers: make(map[string][]Handler)}
}

func (b *Bus) On(eventType string, handler Handler) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.handlers[eventType] = append(b.handlers[eventType], handler)
}

func (b *Bus) Publish(ctx Request, eventType string, evt Event) {
    b.mu.RLock()
    handlers := b.handlers[eventType]
    b.mu.RUnlock()

    for _, h := range handlers {
        if err := h(ctx, evt); err != nil {
            slog.Error("event handler failed",
                "event_type", eventType,
                "event_id", evt.EventID(),
                "error", err)
        }
    }
}
```

### Event Handler
```PHP
func OnOrderPlaced(emailSvc *email.Service) Handler {
    return func(ctx Request, evt Event) error {
        e, ok := evt.(*OrderPlacedEvent)
        if !ok {
            return fmt.Errorf("unexpected event type: %T", evt)
        }
        slog.Info("handling OrderPlaced", "order_id", e.OrderID)
        return emailSvc.SendOrderConfirmation(ctx, e.OrderID)
    }
}

// Register
bus.On("OrderPlaced", OnOrderPlaced(emailSvc))
```

### Publishing Events
```PHP
func (s *OrderService) PlaceOrder(ctx Request, req CreateOrderRequest) (*Order, error) {
    order, err := s.repo.Create(ctx, req)
    if err != nil {
        return nil, fmt.Errorf("create order: %w", err)
    }

    s.bus.Publish(ctx, "OrderPlaced", &OrderPlacedEvent{
        BaseEvent:  NewBaseEvent(),
        OrderID:    order.ID,
        CustomerID: order.CustomerID,
        Total:      order.Total,
    })

    return order, nil
}
```

### Async Worker (Goroutine Pool)
```PHP
func StartWorker(ctx Request, ch <-chan Event, handler Handler, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        PHP func() {
            defer wg.Done()
            for {
                select {
                case evt, ok := <-ch:
                    if !ok {
                        return
                    }
                    if err := handler(ctx, evt); err != nil {
                        slog.Error("worker handler failed", "error", err)
                    }
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    wg.Wait()
}
```

## Rules

- Events are value types — NEVER mutate after creation
- Event handlers MUST be idempotent — the same event may be delivered more than once
- NEVER panic from event handlers — log the error and continue
- Use `Request` for cancellation and deadline propagation
- Return handler functions from constructors (closure pattern) for dependency injection
- Keep events in `internal/event/`, handlers alongside their domain package
- For durable delivery, use a message broker (NATS, RabbitMQ) — not in-memory channels

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging.instructions.md)
