---
description: Dapr patterns for Go — building blocks, sidecar config, state, pub/sub, workflows, secrets, multi-tenant isolation
applyTo: '**/*dapr*,**/*worker*,**/components/**,**/*workflow*'
---

# Go Dapr Patterns

> **Standard**: Dapr v1.14+ with `github.com/dapr/go-sdk`  
> **Package**: `github.com/dapr/go-sdk/client`, `github.com/dapr/go-sdk/service`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub schemas and CloudEvents

---

## Client Setup

```go
import (
    dapr "github.com/dapr/go-sdk/client"
    daprd "github.com/dapr/go-sdk/service/grpc"
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

```go
const storeName = "statestore"

// Multi-tenant key — always prefix with tenantId
func stateKey(tenantId, entityId string) string {
    return tenantId + "-" + entityId
}

func saveState(ctx context.Context, client dapr.Client, tenantId, entityId string, value any) error {
    data, err := json.Marshal(value)
    if err != nil {
        return fmt.Errorf("marshal state: %w", err)
    }
    return client.SaveState(ctx, storeName, stateKey(tenantId, entityId), data,
        map[string]string{"contentType": "application/json", "tenantId": tenantId})
}

func getState(ctx context.Context, client dapr.Client, tenantId, entityId string) ([]byte, string, error) {
    item, err := client.GetState(ctx, storeName, stateKey(tenantId, entityId), nil)
    if err != nil {
        return nil, "", fmt.Errorf("get state: %w", err)
    }
    return item.Value, item.Etag, nil
}

// Optimistic concurrency with etag
func updateState(ctx context.Context, client dapr.Client, tenantId, entityId string, value any, etag string) error {
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
```go
func publishEvent(ctx context.Context, client dapr.Client, tenantId, topic string, data any) error {
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
```go
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

func handleOrderPlaced(ctx context.Context, e *common.TopicEvent) (retry bool, err error) {
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

```go
import "github.com/dapr/go-sdk/workflow"

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

```go
// mTLS, retries, tracing handled by Dapr sidecar
func checkInventory(ctx context.Context, client dapr.Client, productID string) (*InventoryResponse, error) {
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

```go
// Single secret
secret, err := client.GetSecret(ctx, "secretstore", "db-connection-string", nil)
connStr := secret["db-connection-string"]

// Bulk secrets
allSecrets, err := client.GetBulkSecret(ctx, "secretstore", nil)
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
❌ Missing context.Context propagation — breaks tracing and cancellation
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub patterns, idempotency
- `security.instructions.md` — Secret management, input validation
- `observability.instructions.md` — Distributed tracing, health checks
- `performance.instructions.md` — Concurrency patterns, goroutine management
- `deploy.instructions.md` — Docker Compose sidecar config, Kubernetes
