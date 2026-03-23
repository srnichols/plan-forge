---
description: Messaging patterns for Python — Celery, Redis Pub/Sub, RabbitMQ, async task queues
applyTo: '**/*task*,**/*worker*,**/*event*,**/*celery*,**/*queue*'
---

# Python Messaging & Pub/Sub Patterns

## Messaging Strategy

### Celery (Distributed Task Queue — Recommended)
```python
# celery_app.py
from celery import Celery

app = Celery("myapp", broker=settings.CELERY_BROKER_URL, backend=settings.CELERY_RESULT_BACKEND)
app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# tasks.py
@app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_order(self, order_id: str, tenant_id: str) -> None:
    try:
        order = order_repo.get_by_id(order_id, tenant_id)
        # ... process
    except TransientError as exc:
        raise self.retry(exc=exc)

# Publishing
process_order.delay(order_id="abc-123", tenant_id="tenant-xyz")
```

### Redis Pub/Sub (Real-Time Notifications)
```python
import redis

r = redis.Redis.from_url(settings.REDIS_URL)

# Publish
def publish_event(topic: str, payload: dict) -> None:
    r.publish(topic, json.dumps(payload))

# Subscribe
pubsub = r.pubsub()
pubsub.subscribe("order-placed", "order-completed")
for message in pubsub.listen():
    if message["type"] == "message":
        data = json.loads(message["data"])
        handle_event(message["channel"], data)
```

### FastAPI Background Tasks (Lightweight)
```python
from fastapi import BackgroundTasks

@app.post("/orders")
async def create_order(order: OrderCreate, bg: BackgroundTasks):
    saved = await order_repo.create(order)
    bg.add_task(send_order_confirmation, saved.id, saved.tenant_id)
    return saved
```

### asyncio Task Worker
```python
import asyncio

class OrderWorker:
    def __init__(self, queue: asyncio.Queue):
        self.queue = queue

    async def run(self) -> None:
        while True:
            event = await self.queue.get()
            try:
                await self.process(event)
            except Exception:
                logger.exception("Failed to process event: %s", event)
            finally:
                self.queue.task_done()
```

## Event Schema
```python
from pydantic import BaseModel
from datetime import datetime

class OrderPlacedEvent(BaseModel):
    order_id: str
    tenant_id: str
    occurred_at: datetime

# Always use Pydantic models — never raw dicts for events
```

## Celery Beat (Scheduled Tasks)
```python
app.conf.beat_schedule = {
    "daily-report": {
        "task": "tasks.generate_daily_report",
        "schedule": crontab(hour=8, minute=0),
    },
    "cleanup-expired": {
        "task": "tasks.cleanup_expired_sessions",
        "schedule": timedelta(minutes=30),
    },
}
```

## Dead Letter & Retry Strategy
```python
# Celery retry with exponential backoff
@app.task(bind=True, max_retries=5, autoretry_for=(TransientError,))
def process_event(self, event_data: dict) -> None:
    self.retry(countdown=2 ** self.request.retries)
```

## Anti-Patterns

```
❌ Passing ORM objects to Celery tasks (not serializable — pass IDs)
❌ Missing tenant_id in task arguments (breaks multi-tenant isolation)
❌ Celery task without max_retries (infinite retry loop)
❌ Blocking sync calls in async workers (use run_in_executor)
❌ Untyped event payloads (use Pydantic models for validation)
❌ Catching bare Exception without logging (silent failures)
```

## Idempotency

Guard task handlers against duplicate execution:

```python
import redis

_redis = redis.Redis.from_url(settings.REDIS_URL)

def idempotent(ttl: int = 86400):
    """Decorator that skips duplicate task executions using Redis SET NX."""
    def decorator(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            key = f"idem:{self.request.id}"
            if not _redis.set(key, "1", ex=ttl, nx=True):
                return  # Already processed
            return func(self, *args, **kwargs)
        return wrapper
    return decorator

@app.task(bind=True, max_retries=3)
@idempotent()
def process_order(self, order_id: str, tenant_id: str) -> None:
    order = order_repo.get_by_id(order_id, tenant_id)
    # ... process
```

Alternatives: database table with `UNIQUE(task_id)`, or Celery's `task_reject_on_worker_lost=True`.

## See Also

- `observability.instructions.md` — Distributed tracing, event logging
- `errorhandling.instructions.md` — Dead letter queues, retry logic
- `database.instructions.md` — Idempotency stores, transactional outbox
```
