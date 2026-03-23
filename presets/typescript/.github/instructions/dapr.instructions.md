---
description: Dapr patterns for TypeScript/Node.js — building blocks, sidecar config, state, pub/sub, workflows, secrets, multi-tenant isolation
applyTo: '**/*dapr*,**/*worker*,**/components/**,**/*workflow*'
---

# TypeScript Dapr Patterns

> **Standard**: Dapr v1.14+ with `@dapr/dapr` SDK  
> **Package**: `@dapr/dapr`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub schemas and CloudEvents

---

## Client Setup

```typescript
import { DaprClient, DaprServer, CommunicationProtocolEnum } from "@dapr/dapr";

// Client for outbound calls (state, pub/sub publish, service invocation)
const daprClient = new DaprClient({
  daprHost: process.env.DAPR_HOST ?? "localhost",
  daprPort: process.env.DAPR_HTTP_PORT ?? "3500",
});

// Server for inbound subscriptions
const daprServer = new DaprServer({
  serverHost: "0.0.0.0",
  serverPort: process.env.APP_PORT ?? "3000",
  clientOptions: {
    daprHost: process.env.DAPR_HOST ?? "localhost",
    daprPort: process.env.DAPR_HTTP_PORT ?? "3500",
  },
});
```

---

## State Management

```typescript
const STORE_NAME = "statestore";

// Multi-tenant key pattern
function stateKey(tenantId: string, entityId: string): string {
  return `${tenantId}-${entityId}`;
}

// Save with metadata
async function saveState<T>(tenantId: string, entityId: string, value: T): Promise<void> {
  await daprClient.state.save(STORE_NAME, [
    {
      key: stateKey(tenantId, entityId),
      value,
      metadata: { contentType: "application/json", tenantId },
    },
  ]);
}

// Get with etag for optimistic concurrency
async function getState<T>(tenantId: string, entityId: string): Promise<{ value: T; etag: string }> {
  const result = await daprClient.state.get(STORE_NAME, stateKey(tenantId, entityId));
  return { value: result as T, etag: result?.__etag ?? "" };
}
```

---

## Pub/Sub

### Publishing
```typescript
async function publishEvent(topic: string, data: Record<string, unknown>): Promise<void> {
  await daprClient.pubsub.publish("pubsub", topic, data, {
    metadata: { contentType: "application/cloudevents+json" },
  });
}

// Multi-tenant topic
await publishEvent(`events.order-placed.${tenantId}`, { orderId, tenantId, occurredAt: new Date().toISOString() });
```

### Subscribing
```typescript
// Programmatic subscription
await daprServer.pubsub.subscribe("pubsub", "events.order-placed.*", async (data) => {
  const event = data as OrderPlacedEvent;
  await processOrder(event);
});

await daprServer.start();
```

### Declarative Subscription (Recommended)
```yaml
# dapr/components/order-subscription.yaml
apiVersion: dapr.io/v2alpha1
kind: Subscription
metadata:
  name: order-placed-sub
spec:
  pubsubname: pubsub
  topic: events.order-placed.>
  route: /events/order-placed
  deadLetterTopic: deadletter.order-placed
  metadata:
    maxDeliver: "3"
    ackWait: "30s"
```

---

## Workflows

```typescript
import { WorkflowRuntime, DaprWorkflowClient } from "@dapr/dapr";

// Define workflow
async function orderWorkflow(ctx: any, input: OrderRequest): Promise<OrderResult> {
  const validated = await ctx.callActivity(validateOrder, input);
  const reserved = await ctx.callActivity(reserveInventory, validated);
  const payment = await ctx.callActivity(processPayment, { validated, reserved });

  // Parallel notifications
  await Promise.all([
    ctx.callActivity(sendEmail, { to: input.email, order: validated }),
    ctx.callActivity(sendSms, { to: input.phone, order: validated }),
  ]);

  return { transactionId: payment.id, status: "completed" };
}

// Define activities (must be idempotent)
async function validateOrder(ctx: any, input: OrderRequest): Promise<ValidatedOrder> {
  // validation logic
}

// Register and start
const workflowRuntime = new WorkflowRuntime();
workflowRuntime.registerWorkflow(orderWorkflow);
workflowRuntime.registerActivity(validateOrder);
workflowRuntime.registerActivity(reserveInventory);
workflowRuntime.registerActivity(processPayment);
workflowRuntime.registerActivity(sendEmail);
workflowRuntime.registerActivity(sendSms);
await workflowRuntime.start();

// Schedule a workflow
const workflowClient = new DaprWorkflowClient();
const instanceId = await workflowClient.scheduleNewWorkflow(orderWorkflow, input);
```

---

## Service Invocation

```typescript
// Call another Dapr service (gets mTLS, retries, tracing automatically)
const inventory = await daprClient.invoker.invoke(
  "inventory-service",          // target app-id
  "api/inventory/check",        // method
  HttpMethod.POST,
  { productId: "abc-123" },
);
```

---

## Secrets

```typescript
// Single secret
const secret = await daprClient.secret.get("secretstore", "db-connection-string");
const connStr = secret["db-connection-string"];

// Bulk secrets (startup config)
const allSecrets = await daprClient.secret.getBulk("secretstore");
```

---

## Component Scoping

```yaml
# dapr/components/statestore.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: statestore
spec:
  type: state.redis
  version: v1
  metadata:
    - name: redisHost
      value: redis:6379
    - name: keyPrefix
      value: name
  scopes:                        # ALWAYS scope
    - my-api-service
    - my-worker-service
```

---

## Resiliency

```yaml
# dapr/components/resiliency.yaml
apiVersion: dapr.io/v1alpha1
kind: Resiliency
metadata:
  name: default
spec:
  policies:
    retries:
      defaultRetry:
        policy: exponential
        maxInterval: 30s
        maxRetries: 5
    circuitBreakers:
      serviceCB:
        maxRequests: 1
        timeout: 60s
        trip: consecutiveFailures > 5
  targets:
    components:
      statestore:
        outbound:
          retry: defaultRetry
```

---

## Anti-Patterns

```
❌ Hardcoding localhost:3500 — use DAPR_HOST / DAPR_HTTP_PORT env vars
❌ Unscoped components — always add scopes to every component YAML
❌ Flat state keys without tenant prefix — data isolation breach
❌ Calling APIs directly in workflows — use callActivity for replay safety
❌ Inline secrets in component YAML — use secretKeyRef
❌ Fire-and-forget without dead-letter topic — lost messages
❌ Chaining 4+ sync service invocations — use a workflow instead
❌ Ignoring etags on state updates — silent overwrites
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub patterns, idempotency
- `security.instructions.md` — Secret management, input validation
- `observability.instructions.md` — Distributed tracing, health checks
- `performance.instructions.md` — Async patterns, connection management
- `deploy.instructions.md` — Docker Compose sidecar config, Kubernetes
