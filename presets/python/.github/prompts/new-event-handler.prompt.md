---
description: "Scaffold domain events, async handlers, and a simple in-process event dispatcher."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold typed domain events with async handlers.

## Required Pattern

### Event Types
```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4

@dataclass(frozen=True)
class DomainEvent:
    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

@dataclass(frozen=True)
class OrderPlacedEvent(DomainEvent):
    order_id: UUID = field(default_factory=uuid4)
    customer_id: UUID = field(default_factory=uuid4)
    total_amount: float = 0.0
```

### Event Dispatcher
```python
from collections import defaultdict
from typing import Callable, Awaitable

EventHandler = Callable[[DomainEvent], Awaitable[None]]

class EventDispatcher:
    def __init__(self) -> None:
        self._handlers: dict[type, list[EventHandler]] = defaultdict(list)

    def on(self, event_type: type, handler: EventHandler) -> None:
        self._handlers[event_type].append(handler)

    async def publish(self, event: DomainEvent) -> None:
        for handler in self._handlers.get(type(event), []):
            try:
                await handler(event)
            except Exception:
                import logging
                logging.exception("Event handler failed for %s", type(event).__name__)

dispatcher = EventDispatcher()
```

### Event Handler
```python
async def on_order_placed(event: OrderPlacedEvent) -> None:
    logger.info("Handling OrderPlaced: %s", event.order_id)
    await email_service.send_order_confirmation(event.order_id)

# Register
dispatcher.on(OrderPlacedEvent, on_order_placed)
```

### Publishing Events
```python
class OrderService:
    def __init__(self, repository, dispatcher: EventDispatcher) -> None:
        self._repository = repository
        self._dispatcher = dispatcher

    async def place_order(self, request: CreateOrderRequest) -> Order:
        order = await self._repository.create(request)

        await self._dispatcher.publish(OrderPlacedEvent(
            order_id=order.id,
            customer_id=order.customer_id,
            total_amount=order.total_amount,
        ))

        return order
```

### External Broker Handler (Celery)
```python
from celery import Celery

app = Celery("tasks", broker="redis://localhost:6379/0")

@app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_order_event(self, event_data: dict) -> None:
    try:
        # Process the event
        pass
    except Exception as exc:
        self.retry(exc=exc)
```

## Rules

- Events are frozen dataclasses — NEVER mutate after creation
- Event handlers MUST be idempotent — the same event may be delivered more than once
- Catch exceptions in `publish()` — one handler failure must not break others
- NEVER raise from event handlers — log and continue
- Keep events in `src/events/`, handlers in `src/event_handlers/`
- For durable delivery, use a message broker (Celery, RabbitMQ) — not in-memory

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging-patterns.instructions.md)
