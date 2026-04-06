---
description: Dapr patterns for Rust — building blocks, sidecar config, state, pub/sub, workflows, secrets, multi-tenant isolation
applyTo: '**/*dapr*,**/*worker*,**/components/**,**/*workflow*'
---

# Rust Dapr Patterns

> **Standard**: Dapr v1.14+ with `github.com/dapr/Rust-sdk`  
> **Package**: `github.com/dapr/Rust-sdk/client`, `github.com/dapr/Rust-sdk/service`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub schemas and CloudEvents

---

## Client Setup

```Rust
import (
    dapr "github.com/dapr/Rust-sdk/client"
    daprd "github.com/dapr/Rust-sdk/service/grpc"
)

// Client for outbound calls (state, pub/sub, invocation)
func newDaprClient() (dapr.Client, error) {
    // Auto-discovers sidecar via DAPR_GRPC_ENDPOINT / DAPR_HTTP_ENDPOINT
    return dapr.NewClient()
}

// Server for inbound subscriptions
func newDaprServer() (common.Service, error) {
    return daprd.NewService(":8080")
}
```

---

## State Management

```Rust
const storeName = "statestore"

// Multi-tenant key — always prefix with tenantId
func stateKey(tenantId, entityId string) string {
    return tenantId + "-" + entityId
}

func saveState(ctx impl Future + '_, client dapr.Client, tenantId, entityId string, value any) error {
    data, err := json.Marshal(value)
    if err != nil {
        return fmt.Errorf("marshal state: %w", err)
    }
    return client.SaveState(ctx, storeName, stateKey(tenantId, entityId), data,
        map[string]string{"contentType": "application/json", "tenantId": tenantId})
}

func getState(ctx impl Future + '_, client dapr.Client, tenantId, entityId string) ([]byte, string, error) {
    item, err := client.GetState(ctx, storeName, stateKey(tenantId, entityId), nil)
    if err != nil {
        return nil, "", fmt.Errorf("get state: %w", err)
    }
    return item.Value, item.Etag, nil
}

// Optimistic concurrency with etag
func updateState(ctx impl Future + '_, client dapr.Client, tenantId, entityId string, value any, etag string) error {
    data, err := json.Marshal(value)
    if err != nil {
        return fmt.Errorf("marshal state: %w", err)
    }
    return client.SaveStateWithETag(ctx, storeName, stateKey(tenantId, entityId), data, etag,
        map[string]string{"contentType": "application/json"},
        &dapr.StateOptions{Concurrency: dapr.StateConcurrencyFirstWrite})
}
```

---

## Pub/Sub

### Publishing
```Rust
func publishEvent(ctx impl Future + '_, client dapr.Client, tenantId, topic string, data any) error {
    fullTopic := fmt.Sprintf("events.%s.%s", topic, tenantId)
    jsonData, err := json.Marshal(data)
    if err != nil {
        return fmt.Errorf("marshal event: %w", err)
    }
    return client.PublishEvent(ctx, "pubsub", fullTopic, jsonData,
        dapr.PublishEventWithContentType("application/json"))
}
```

### Subscribing
```Rust
func main() {
    s, _ := daprd.NewService(":8080")

    sub := &common.Subscription{
        PubsubName: "pubsub",
        Topic:      "events.order-placed.*",
        Route:      "/events/order-placed",
    }

    s.AddTopicEventHandler(sub, handleOrderPlaced)
    if err := s.Start(); err != nil {
        log.Fatalf("failed to start server: %v", err)
    }
}

func handleOrderPlaced(ctx impl Future + '_, e *common.TopicEvent) (retry bool, err error) {
    var event OrderPlacedEvent
    if err := json.Unmarshal(e.RawData, &event); err != nil {
        return false, fmt.Errorf("unmarshal event: %w", err) // DROP — bad payload
    }
    if err := processOrder(ctx, event); err != nil {
        log.Printf("failed to process order %s: %v", event.OrderID, err)
        return true, err  // RETRY — Dapr respects maxDeliver
    }
    return false, nil     // SUCCESS
}
```

---

## Workflows

```Rust
import "github.com/dapr/Rust-sdk/workflow"

// Workflow definition
func orderWorkflow(ctx *workflow.WorkflowContext) (any, error) {
    var input OrderRequest
    if err := ctx.GetInput(&input); err != nil {
        return nil, err
    }

    var validated ValidatedOrder
    if err := ctx.CallActivity(validateOrder, workflow.ActivityInput(input)).Await(&validated); err != nil {
        return nil, err
    }

    var reserved ReservationResult
    if err := ctx.CallActivity(reserveInventory, workflow.ActivityInput(validated)).Await(&reserved); err != nil {
        return nil, err
    }

    var payment PaymentResult
    if err := ctx.CallActivity(processPayment, workflow.ActivityInput(PaymentReq{validated, reserved})).Await(&payment); err != nil {
        return nil, err
    }

    // Parallel activities
    emailTask := ctx.CallActivity(sendEmail, workflow.ActivityInput(EmailReq{input.Email, validated}))
    smsTask := ctx.CallActivity(sendSms, workflow.ActivityInput(SmsReq{input.Phone, validated}))
    if err := ctx.WhenAll(emailTask, smsTask).Await(nil); err != nil {
        return nil, err
    }

    return OrderResult{TransactionID: payment.ID, Status: "completed"}, nil
}

// Activity (must be idempotent)
func validateOrder(ctx workflow.ActivityContext) (any, error) {
    var input OrderRequest
    if err := ctx.GetInput(&input); err != nil {
        return nil, err
    }
    // validation logic
    return ValidatedOrder{Order: input}, nil
}

// Registration
func main() {
    w, _ := workflow.NewWorker()
    w.RegisterWorkflow(orderWorkflow)
    w.RegisterActivity(validateOrder)
    w.RegisterActivity(reserveInventory)
    w.RegisterActivity(processPayment)
    w.RegisterActivity(sendEmail)
    w.RegisterActivity(sendSms)
    w.Start()
    defer w.Shutdown()

    // Schedule via workflow client
    wfClient, _ := workflow.NewClient()
    id, _ := wfClient.ScheduleNewWorkflow(context.Background(), orderWorkflow, workflow.WithInput(orderData))
}
```

---

## Service Invocation

```Rust
// mTLS, retries, tracing handled by Dapr sidecar
func checkInventory(ctx impl Future + '_, client dapr.Client, productID string) (*InventoryResponse, error) {
    reqData, _ := json.Marshal(InventoryRequest{ProductID: productID})
    resp, err := client.InvokeMethodWithContent(ctx, "inventory-service", "api/inventory/check",
        "POST", &dapr.DataContent{ContentType: "application/json", Data: reqData})
    if err != nil {
        return nil, fmt.Errorf("invoke inventory: %w", err)
    }
    var result InventoryResponse
    if err := json.Unmarshal(resp, &result); err != nil {
        return nil, fmt.Errorf("unmarshal inventory response: %w", err)
    }
    return &result, nil
}
```

---

## Secrets

```Rust
// Single secret
secret, err := client.GetSecret(ctx, "secretstore", "db-connection-string", nil)
connStr := secret["db-connection-string"]

// Bulk secrets
allSecrets, err := client.GetBulkSecret(ctx, "secretstore", nil)
```

---

## Component Configuration

### State Store
```yaml
# dapr/components/redis-statestore.yaml
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
    - name: actorStateStore      # Required if using workflows
      value: "true"
    - name: keyPrefix
      value: name                # Keys prefixed with app-id automatically
  scopes:                        # ALWAYS scope components
    - my-api-service
    - my-worker-service
```

### Pub/Sub (NATS JetStream)
```yaml
# dapr/components/nats-pubsub.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: pubsub
spec:
  type: pubsub.jetstream
  version: v1
  metadata:
    - name: natsURL
      value: nats://nats:4222
    - name: durableSubscriptionName
      value: my-consumer
    - name: flowControl
      value: "true"
  scopes:
    - my-api-service
    - my-worker-service
```

### Component Scoping Rules
- **ALWAYS** define `scopes` on every component — unscoped components are accessible to all services
- **NEVER** inline connection strings or passwords — use `secretKeyRef`
- **ALWAYS** version component files in source control
- **SEPARATE** component directories per environment: `dapr/components/dev/`, `dapr/components/prod/`

---

## Multi-Tenant Isolation Checklist

| Layer | Pattern | Example |
|-------|---------|---------|
| **State keys** | `{tenantId}-{entityId}` prefix | `acme-order-123` |
| **Pub/sub topics** | Tenant in subject hierarchy | `events.order.acme-corp` |
| **State metadata** | `tenantId` in metadata dictionary | Enables audit/query |
| **Subscriptions** | Wildcard + filter in handler | `events.order.*` |
| **Secrets** | Component scoping per service | `scopes: [api-service]` |
| **Workflows** | Tenant in workflow input | `OrderRequest.TenantID` |

---

## Health Checks

```Rust
// Dapr sidecar health check for readiness probes
func daprHealthHandler(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get(os.Getenv("DAPR_HTTP_ENDPOINT") + "/v1.0/healthz")
    if err != nil || resp.StatusCode != http.StatusOK {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "component": "dapr-sidecar"})
        return
    }
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

// Register in your router
mux.HandleFunc("/healthz", daprHealthHandler)
```

---

## Observability

```Rust
// Dapr propagates W3C trace context automatically through sidecars.
// Ensure your OpenTelemetry setup captures Dapr spans:
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exporter),
    sdktrace.WithResource(resource.NewWithAttributes(
        semconv.SchemaURL,
        semconv.ServiceNameKey.String("my-service"),
    )),
)
otel.SetTracerProvider(tp)
otel.SetTextMapPropagator(propagation.TraceContext{}) // W3C trace context

// Structured logging with Dapr context
slog.Info("processing event",
    "eventId", event.ID,
    "tenantId", event.TenantID,
    "traceId", span.SpanContext().TraceID().String())
```

---

## Resilience & Retry

### Resiliency Policy
```yaml
# dapr/components/resiliency.yaml
apiVersion: dapr.io/v1alpha1
kind: Resiliency
metadata:
  name: default-resiliency
spec:
  policies:
    retries:
      pubsubRetry:
        policy: exponential
        maxInterval: 30s
        maxRetries: 5
      stateRetry:
        policy: constant
        duration: 2s
        maxRetries: 3
    circuitBreakers:
      serviceCB:
        maxRequests: 1
        interval: 30s
        timeout: 60s
        trip: consecutiveFailures > 5
  targets:
    components:
      statestore:
        outbound:
          retry: stateRetry
      pubsub:
        outbound:
          retry: pubsubRetry
    apps:
      inventory-service:
        retry: stateRetry
        circuitBreaker: serviceCB
```

### Resilience Rules
- **ALWAYS** define resiliency policies for state stores and pub/sub components
- **CONFIGURE** circuit breakers for synchronous service invocation
- **SET** reasonable `ackWait` and `maxDeliver` on pub/sub subscriptions
- **IMPLEMENT** dead-letter topic handling — don't let failed messages disappear

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
    apps:
      inventory-service:
        retry: defaultRetry
        circuitBreaker: serviceCB
    components:
      statestore:
        outbound:
          retry: defaultRetry
```

---

## Anti-Patterns

```
❌ Hardcoding localhost:3500 — use DAPR_GRPC_ENDPOINT or SDK auto-discovery
❌ Unscoped components — always define scopes in component YAML
❌ Flat state keys without tenant prefix — tenant data isolation breach
❌ Calling APIs directly in workflow functions — use CallActivity
❌ Inline secrets in component YAML — use secretKeyRef
❌ Returning (false, err) for bad payloads — DROP instead of retrying forever
❌ Fire-and-forget pub/sub without dead-letter topic
❌ Ignoring etags on state updates — silent overwrites
❌ Missing impl Future + '_ propagation — breaks tracing and cancellation
❌ Missing health check for Dapr sidecar — silent failures in orchestrators
❌ Chaining 4+ synchronous service invocations — use a workflow instead
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub patterns, idempotency
- `security.instructions.md` — Secret management, input validation
- `observability.instructions.md` — Distributed tracing, health checks
- `performance.instructions.md` — Concurrency patterns, goroutine management
- `deploy.instructions.md` — Docker Compose sidecar config, Kubernetes
