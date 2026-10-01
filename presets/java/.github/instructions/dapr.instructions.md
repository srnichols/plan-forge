---
description: Dapr patterns for Java/Spring Boot — building blocks, sidecar config, state, pub/sub, workflows, secrets, multi-tenant isolation
applyTo: '**/*Dapr*,**/*Worker*,**/components/**,**/*Workflow*,**/*Activity*'
---

# Java Dapr Patterns

> **Standard**: Dapr v1.18+ with `io.dapr:dapr-sdk-springboot`
> **Packages**: `dapr-sdk`, `dapr-sdk-springboot`, `dapr-sdk-workflows`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub schemas and CloudEvents

---

## Client Setup

```java
// Spring Boot auto-configuration via dapr-sdk-springboot
@Configuration
public class DaprConfig {

    @Bean
    public DaprClient daprClient() {
        return new DaprClientBuilder()
            .withObjectSerializer(new JacksonObjectSerializer())
            .build();
    }
}
```

---

## State Management

```java
@Service
public class TenantStateRepository {

    private static final String STORE_NAME = "statestore";
    private final DaprClient daprClient;

    // Multi-tenant key — always prefix with tenantId
    private String stateKey(String tenantId, String entityId) {
        return tenantId + "-" + entityId;
    }

    public Mono<Void> saveState(String tenantId, String entityId, Object value) {
        var metadata = Map.of("contentType", "application/json", "tenantId", tenantId);
        return daprClient.saveState(STORE_NAME, stateKey(tenantId, entityId), value, metadata);
    }

    public <T> Mono<T> getState(String tenantId, String entityId, Class<T> clazz) {
        return daprClient.getState(STORE_NAME, stateKey(tenantId, entityId), clazz)
            .map(State::getValue);
    }

    // Optimistic concurrency with etag
    public <T> Mono<Boolean> updateState(String tenantId, String entityId, T value, String etag) {
        var stateOptions = new StateOptions(StateOptions.Consistency.STRONG, StateOptions.Concurrency.FIRST_WRITE);
        return daprClient.saveState(STORE_NAME, stateKey(tenantId, entityId), etag, value, stateOptions)
            .thenReturn(true)
            .onErrorReturn(false);
    }
}
```

---

## Pub/Sub

### Publishing
```java
@Service
public class EventPublisher {

    private final DaprClient daprClient;

    public Mono<Void> publishOrderPlaced(String tenantId, String orderId) {
        var event = Map.of("orderId", orderId, "tenantId", tenantId,
            "occurredAt", Instant.now().toString());
        return daprClient.publishEvent("pubsub", "events.order-placed." + tenantId, event);
    }
}
```

### Subscribing (Spring Boot Controller)
```java
@RestController
public class OrderEventsController {

    @Topic(name = "events.order-placed.*", pubsubName = "pubsub")
    @PostMapping("/events/order-placed")
    public ResponseEntity<Void> handleOrderPlaced(@RequestBody CloudEvent<OrderPlacedEvent> event) {
        try {
            orderProcessor.process(event.getData());
            return ResponseEntity.ok().build();           // 200 = ACK
        } catch (Exception e) {
            log.error("Failed to process order event", e);
            return ResponseEntity.status(500).build();    // 500 = NACK (Dapr retries)
        }
    }
}
```

---

## Workflows

```java
// Workflow definition
public class OrderFulfillmentWorkflow extends Workflow {

    @Override
    public WorkflowStub create() {
        return ctx -> {
            var input = ctx.getInput(OrderRequest.class);
            var validated = ctx.callActivity(ValidateOrderActivity.class, input, ValidatedOrder.class).await();
            var reserved = ctx.callActivity(ReserveInventoryActivity.class, validated, ReservationResult.class).await();
            var payment = ctx.callActivity(ProcessPaymentActivity.class,
                new PaymentRequest(validated, reserved), PaymentResult.class).await();

            // Parallel activities
            ctx.allOf(List.of(
                ctx.callActivity(SendEmailActivity.class, new EmailReq(input.email(), validated), Boolean.class),
                ctx.callActivity(SendSmsActivity.class, new SmsReq(input.phone(), validated), Boolean.class)
            )).await();

            ctx.complete(new OrderResult(payment.transactionId(), "completed"));
        };
    }
}

// Activity (must be idempotent)
public class ValidateOrderActivity implements WorkflowActivity {

    @Override
    public Object run(WorkflowActivityContext ctx) {
        var input = ctx.getInput(OrderRequest.class);
        // validation logic
        return new ValidatedOrder(input);
    }
}

// Registration
@Configuration
public class WorkflowConfig {

    @Bean
    public WorkflowRuntimeBuilder workflowRuntime() {
        return new WorkflowRuntimeBuilder()
            .registerWorkflow(OrderFulfillmentWorkflow.class)
            .registerActivity(ValidateOrderActivity.class)
            .registerActivity(ReserveInventoryActivity.class)
            .registerActivity(ProcessPaymentActivity.class)
            .registerActivity(SendEmailActivity.class)
            .registerActivity(SendSmsActivity.class);
    }
}
```

---

## Service Invocation

```java
// mTLS, retries, and tracing handled by Dapr sidecar
public Mono<InventoryResponse> checkInventory(String productId) {
    return daprClient.invokeMethod(
        "inventory-service",                    // target app-id
        "api/inventory/check",                  // method
        new InventoryRequest(productId),
        HttpExtension.POST,
        InventoryResponse.class);
}
```

---

## Secrets

```java
// Single secret
Map<String, String> secret = daprClient.getSecret("secretstore", "db-connection-string").block();
String connStr = secret.get("db-connection-string");

// Bulk secrets
Map<String, Map<String, String>> allSecrets = daprClient.getBulkSecret("secretstore").block();
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

### Rules
- **ALWAYS** define `scopes` on every component — unscoped = accessible to all services
- **NEVER** inline connection strings or passwords — use `secretKeyRef`
- **SEPARATE** component directories per environment

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

## Multi-Tenant Isolation Checklist

| Layer | Pattern | Example |
|-------|---------|---------|
| **State keys** | `{tenantId}-{entityId}` prefix | `acme-order-123` |
| **Pub/sub topics** | Tenant in subject hierarchy | `events.order.acme-corp` |
| **State metadata** | `tenantId` in metadata | Enables audit/query |
| **Subscriptions** | Wildcard + filter in handler | `events.order.*` |
| **Secrets** | Component scoping per service | `scopes: [api-service]` |
| **Workflows** | Tenant in workflow input | `OrderRequest.tenantId()` |

---

## Health Checks

```java
@Component
public class DaprHealthIndicator extends AbstractHealthIndicator {
    @Override
    protected void doHealthCheck(Health.Builder builder) throws Exception {
        var endpoint = System.getenv().getOrDefault("DAPR_HTTP_ENDPOINT", "http://localhost:3500");
        var client = HttpClient.newHttpClient();
        var request = HttpRequest.newBuilder(URI.create(endpoint + "/v1.0/healthz")).GET().build();
        var response = client.send(request, HttpResponse.BodyHandlers.discarding());
        if (response.statusCode() == 200) {
            builder.up().withDetail("dapr-sidecar", "healthy");
        } else {
            builder.down().withDetail("dapr-sidecar", "unhealthy");
        }
    }
}
```

---

## Anti-Patterns

```
❌ Hardcoding localhost:3500 — use DAPR_HTTP_ENDPOINT or SDK auto-discovery
❌ Unscoped components — always define scopes in component YAML
❌ Flat state keys without tenant prefix — tenant data isolation breach
❌ Calling APIs directly in workflow create() — use callActivity
❌ Inline secrets in component YAML — use secretKeyRef
❌ Blocking on Mono with .block() in reactive chain — subscribe or compose
❌ Fire-and-forget pub/sub without dead-letter topic
❌ Returning raw 500 without logging context — log eventId and tenantId
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub patterns, idempotency
- `security.instructions.md` — Spring Security, secret management
- `observability.instructions.md` — Distributed tracing, health checks
- `performance.instructions.md` — Reactive patterns, connection management
- `deploy.instructions.md` — Docker Compose sidecar config, Kubernetes
