---
description: "Scaffold typed events, async event handlers, and an EventEmitter-based pub/sub system."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold typed domain events with async handlers using a typed EventEmitter.

## Required Pattern

### Event Types
```typescript
export interface DomainEvent {
  eventId: string;
  occurredAt: string;  // ISO 8601
}

export interface OrderPlacedEvent extends DomainEvent {
  type: 'OrderPlaced';
  orderId: string;
  customerId: string;
  totalAmount: number;
}

// Union type for all events
export type AppEvent = OrderPlacedEvent | OrderCancelledEvent;
```

### Typed Event Bus
```typescript
type EventHandler<T extends DomainEvent> = (event: T) => Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler<any>[]>();

  on<T extends DomainEvent>(type: string, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish<T extends DomainEvent>(type: string, event: T): Promise<void> {
    const list = this.handlers.get(type) ?? [];
    await Promise.allSettled(
      list.map((handler) => handler(event)),
    );
  }
}

export const eventBus = new EventBus();
```

### Event Handler
```typescript
export async function onOrderPlaced(event: OrderPlacedEvent): Promise<void> {
  logger.info({ orderId: event.orderId }, 'Handling OrderPlaced');
  await emailService.sendOrderConfirmation(event.orderId);
}

// Register
eventBus.on<OrderPlacedEvent>('OrderPlaced', onOrderPlaced);
```

### Publishing Events
```typescript
export class OrderService {
  async placeOrder(request: CreateOrderRequest): Promise<Order> {
    const order = await this.repository.create(request);

    await eventBus.publish<OrderPlacedEvent>('OrderPlaced', {
      type: 'OrderPlaced',
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      orderId: order.id,
      customerId: order.customerId,
      totalAmount: order.totalAmount,
    });

    return order;
  }
}
```

### External Broker Handler (Bull/BullMQ)
```typescript
import { Worker } from 'bullmq';

const worker = new Worker('order-events', async (job) => {
  const event = job.data as OrderPlacedEvent;
  logger.info({ eventId: event.eventId }, 'Processing order event');
  await processOrder(event);
}, { connection: redis });
```

## Rules

- Events are plain objects — NEVER mutate after creation
- Event handlers MUST be idempotent — the same event may be delivered more than once
- Use `Promise.allSettled()` — one handler failure must not break others
- NEVER throw from event handlers — catch, log, and continue
- Keep events in `src/events/`, handlers in `src/event-handlers/`
- For durable delivery, use a message broker (BullMQ, RabbitMQ) — not in-memory

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging.instructions.md)
