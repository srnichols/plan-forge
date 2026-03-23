---
description: Dapr patterns for Python — building blocks, sidecar config, state, pub/sub, workflows, secrets, multi-tenant isolation
applyTo: '**/*dapr*,**/*worker*,**/components/**,**/*workflow*'
---

# Python Dapr Patterns

> **Standard**: Dapr v1.14+ with `dapr-ext-grpc` / `dapr-ext-fastapi`  
> **Packages**: `dapr`, `dapr-ext-grpc`, `dapr-ext-fastapi`, `dapr-ext-workflow`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub schemas and CloudEvents

---

## Client Setup

```python
from dapr.clients import DaprClient

# DaprClient auto-discovers sidecar via DAPR_HTTP_ENDPOINT / DAPR_GRPC_ENDPOINT
with DaprClient() as client:
    # All building block calls go through here
    pass

# FastAPI integration
from dapr.ext.fastapi import DaprApp
from fastapi import FastAPI

app = FastAPI()
dapr_app = DaprApp(app)
```

---

## State Management

```python
from dapr.clients import DaprClient
from dapr.clients.grpc._state import StateItem

STORE_NAME = "statestore"

def state_key(tenant_id: str, entity_id: str) -> str:
    """Multi-tenant key — always prefix with tenant_id."""
    return f"{tenant_id}-{entity_id}"

async def save_state(tenant_id: str, entity_id: str, value: dict) -> None:
    with DaprClient() as client:
        client.save_state(
            store_name=STORE_NAME,
            key=state_key(tenant_id, entity_id),
            value=json.dumps(value),
            state_metadata={"contentType": "application/json", "tenantId": tenant_id},
        )

async def get_state(tenant_id: str, entity_id: str) -> dict | None:
    with DaprClient() as client:
        resp = client.get_state(STORE_NAME, state_key(tenant_id, entity_id))
        return json.loads(resp.data) if resp.data else None

# Optimistic concurrency
async def update_state(tenant_id: str, entity_id: str, value: dict, etag: str) -> bool:
    with DaprClient() as client:
        try:
            client.save_state(
                store_name=STORE_NAME,
                key=state_key(tenant_id, entity_id),
                value=json.dumps(value),
                etag=etag,
            )
            return True
        except Exception:
            return False  # Etag mismatch — concurrent modification
```

---

## Pub/Sub

### Publishing
```python
with DaprClient() as client:
    client.publish_event(
        pubsub_name="pubsub",
        topic_name=f"events.order-placed.{tenant_id}",
        data=json.dumps({"order_id": order_id, "tenant_id": tenant_id}),
        data_content_type="application/json",
    )
```

### Subscribing (FastAPI)
```python
@dapr_app.subscribe(pubsub="pubsub", topic="events.order-placed.*")
@app.post("/events/order-placed")
async def handle_order_placed(event: dict):
    try:
        await process_order(event["data"])
        return {"status": "SUCCESS"}
    except Exception as e:
        logger.error("Failed to process order event: %s", e)
        return {"status": "RETRY"}  # Dapr retries per maxDeliver
```

---

## Workflows

```python
from dapr.ext.workflow import WorkflowRuntime, DaprWorkflowContext, WorkflowActivityContext

# Workflow definition
def order_workflow(ctx: DaprWorkflowContext, input: dict) -> dict:
    validated = yield ctx.call_activity(validate_order, input=input)
    reserved = yield ctx.call_activity(reserve_inventory, input=validated)
    payment = yield ctx.call_activity(process_payment, input={"order": validated, "reservation": reserved})

    # Parallel activities
    yield ctx.when_all([
        ctx.call_activity(send_email, input={"to": input["email"], "order": validated}),
        ctx.call_activity(send_sms, input={"to": input["phone"], "order": validated}),
    ])

    return {"transaction_id": payment["id"], "status": "completed"}

# Activity (must be idempotent)
def validate_order(ctx: WorkflowActivityContext, input: dict) -> dict:
    # validation logic
    return {"validated": True, **input}

# Registration
runtime = WorkflowRuntime()
runtime.register_workflow(order_workflow)
runtime.register_activity(validate_order)
runtime.register_activity(reserve_inventory)
runtime.register_activity(process_payment)
runtime.register_activity(send_email)
runtime.register_activity(send_sms)
runtime.start()

# Schedule a workflow
from dapr.ext.workflow import DaprWorkflowClient
client = DaprWorkflowClient()
instance_id = client.schedule_new_workflow(order_workflow, input=order_data)
```

---

## Service Invocation

```python
with DaprClient() as client:
    result = client.invoke_method(
        app_id="inventory-service",
        method_name="api/inventory/check",
        data=json.dumps({"product_id": "abc-123"}),
        content_type="application/json",
        http_verb="POST",
    )
    inventory = json.loads(result.data)
```

---

## Secrets

```python
with DaprClient() as client:
    secret = client.get_secret("secretstore", "db-connection-string")
    conn_str = secret.secret["db-connection-string"]

    # Bulk secrets
    all_secrets = client.get_bulk_secret("secretstore")
```

---

## Anti-Patterns

```
❌ Hardcoding localhost:3500 — use DAPR_HTTP_ENDPOINT or let SDK auto-discover
❌ Unscoped components — always define scopes in component YAML
❌ Flat state keys without tenant prefix — tenant data isolation breach
❌ Calling APIs in workflow definition — use call_activity for replay safety
❌ Inline secrets in component YAML — use secretKeyRef
❌ Fire-and-forget pub/sub without dead-letter topic
❌ Returning raw 500 from subscription handlers — use {"status": "RETRY"} or {"status": "DROP"}
❌ Logging secret values at any level
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub patterns, idempotency
- `security.instructions.md` — Secret management, input validation
- `observability.instructions.md` — Distributed tracing, health checks
- `performance.instructions.md` — Async patterns, connection management
- `deploy.instructions.md` — Docker Compose sidecar config, Kubernetes
