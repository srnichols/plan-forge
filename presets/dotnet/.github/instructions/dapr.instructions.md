---
description: Dapr patterns for .NET — building blocks, component config, sidecar architecture, multi-tenant isolation, workflows, state management, secrets
applyTo: '**/*Dapr*.cs,**/*Worker*.cs,**/dapr/**,**/components/**,**/*Workflow*.cs,**/*Activity*.cs'
---

# .NET Dapr Patterns

> **Standard**: Dapr v1.14+ with .NET Aspire / Docker Compose  
> **Packages**: `Dapr.AspNetCore`, `Dapr.Client`, `Dapr.Workflow`  
> **Cross-ref**: `messaging.instructions.md` covers pub/sub message schemas and CloudEvents in detail

---

## Sidecar Architecture

### Non-Negotiable Rules
- **NEVER** call external services directly — always go through the Dapr sidecar
- **NEVER** hardcode Dapr HTTP/gRPC ports — use `DAPR_HTTP_ENDPOINT` / `DAPR_GRPC_ENDPOINT` env vars
- **ALWAYS** scope components to the services that need them
- **ALWAYS** use the typed `DaprClient` — never raw HTTP to `localhost:3500`

### DaprClient Registration
```csharp
// Program.cs — register DaprClient with DI
var builder = WebApplication.CreateBuilder(args);

// Standard registration
builder.Services.AddDaprClient();

// NativeAOT-compatible registration (source-generated JSON)
builder.Services.AddDaprClient(clientBuilder =>
{
    clientBuilder.UseJsonSerializationOptions(new JsonSerializerOptions
    {
        TypeInfoResolver = AppJsonContext.Default,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    });
});

var app = builder.Build();
app.MapSubscribeHandler(); // Required for pub/sub subscriptions
```

### Docker Compose Sidecar Pattern
```yaml
# Each service gets its own Dapr sidecar container
my-service:
  build: ./MyService
  environment:
    - DAPR_HTTP_ENDPOINT=http://my-service-sidecar:3500
    - DAPR_GRPC_ENDPOINT=http://my-service-sidecar:50001

my-service-sidecar:
  image: daprio/daprd:1.14.4
  command:
    - ./daprd
    - --app-id=my-service
    - --app-port=8080
    - --dapr-http-port=3500
    - --dapr-grpc-port=50001
    - --resources-path=/components
    - --log-level=info
  volumes:
    - ./dapr/components:/components
  network_mode: service:my-service   # Share network namespace

# Placement service (required for actors/workflows)
dapr-placement:
  image: daprio/dapr:1.14.4
  command: ["./placement", "--port", "50006"]
```

---

## State Management

### Composite Key Pattern (Multi-Tenant)
```csharp
public class DaprTenantStateRepository<T>(DaprClient daprClient) : ITenantStateRepository<T>
{
    private const string StoreName = "statestore";

    public async Task SaveAsync(string tenantId, string entityId, T value,
        Dictionary<string, string>? metadata = null, CancellationToken ct = default)
    {
        var key = GenerateKey(tenantId, entityId);
        metadata ??= new Dictionary<string, string>();
        metadata["contentType"] = "application/json";
        metadata["tenantId"] = tenantId;

        await daprClient.SaveStateAsync(StoreName, key, value, metadata: metadata, cancellationToken: ct);
    }

    public async Task<T?> GetAsync(string tenantId, string entityId, CancellationToken ct = default)
    {
        var key = GenerateKey(tenantId, entityId);
        return await daprClient.GetStateAsync<T?>(StoreName, key, cancellationToken: ct);
    }

    // Tenant-scoped key ensures data isolation
    private static string GenerateKey(string tenantId, string entityId) =>
        $"{tenantId}-{entityId}";
}
```

### Non-Negotiable State Rules
- **ALWAYS** prefix state keys with `tenantId` — never store cross-tenant in a flat namespace
- **ALWAYS** set `contentType` metadata to `application/json`
- **NEVER** store large blobs (>64KB) in state — use blob storage and store a reference
- **PREFER** etag-based optimistic concurrency for updates:

```csharp
// Optimistic concurrency with etag
var (value, etag) = await daprClient.GetStateAndETagAsync<Order>(StoreName, key, cancellationToken: ct);
value.Status = OrderStatus.Confirmed;
var success = await daprClient.TrySaveStateAsync(StoreName, key, value, etag, cancellationToken: ct);
if (!success)
    throw new ConcurrencyException($"State for key '{key}' was modified by another process");
```

### Component Configuration
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
    - name: actorStateStore    # Required if using actors/workflows
      value: "true"
    - name: keyPrefix          
      value: name              # Keys prefixed with app-id automatically
  scopes:                      # ALWAYS scope components
    - my-api-service
    - my-worker-service
```

---

## Pub/Sub

> **Detailed CloudEvents and pub/sub messaging patterns** → see `messaging.instructions.md`

### Multi-Tenant Topic Hierarchy
```
# Convention: {domain}.{category}.{entity}.{tenant-id}
upick.events.user-activity.{tenant-id}
upick.events.order-placed.{tenant-id}
upick.notifications.email.{tenant-id}
upick.jobs.{job-type}.>                    # Wildcard: all tenants

# Dead letter topics mirror the source
upick.deadletter.user-activity
upick.deadletter.order-placed
```

### Subscription with [Topic] Attribute
```csharp
[ApiController]
[Route("[controller]")]
public class EventsController(IEventProcessor processor, ILogger<EventsController> logger) : ControllerBase
{
    [HttpPost("user-activity")]
    [Topic("nats-pubsub", "upick.events.user-activity.>")]   // Wildcard subscription
    public async Task<IActionResult> HandleUserActivity(
        [FromBody] UserActivityEvent evt, CancellationToken ct)
    {
        try
        {
            await processor.ProcessAsync(evt, ct);
            return Ok();          // 200 = ACK (message consumed)
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to process event {EventId}", evt.Id);
            return StatusCode(500); // 500 = NACK (Dapr retries per maxDeliver)
        }
    }
}
```

### Declarative Subscription (Recommended for Tuning)
```yaml
# dapr/components/nats-user-activity-subscription.yaml
apiVersion: dapr.io/v2alpha1
kind: Subscription
metadata:
  name: user-activity-sub
spec:
  pubsubname: nats-pubsub
  topic: upick.events.user-activity.>
  route: /events/user-activity
  metadata:
    consumerID: user-activity-worker-v1   # Durable consumer name
    deliverPolicy: new                     # Don't replay old messages on startup
    ackWait: "60s"                         # Timeout before retry
    maxDeliver: "3"                        # Max retries before DLQ
    maxInFlightMessages: "25"              # Concurrency limit
  deadLetterTopic: upick.deadletter.user-activity
```

### Component Configuration (NATS JetStream)
```yaml
# dapr/components/nats-pubsub.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: nats-pubsub
spec:
  type: pubsub.jetstream
  version: v1
  metadata:
    - name: natsURL
      value: nats://nats:4222
    - name: durableSubscriptionName
      value: upick-consumer
    - name: flowControl
      value: "true"
    - name: maxAge              # Message retention TTL
      value: "24h"
    - name: retentionPolicy
      value: limits
  scopes:
    - my-api-service
    - my-worker-service
```

---

## Workflows

### Workflow Definition
```csharp
public class OrderFulfillmentWorkflow : Workflow<OrderRequest, OrderResult>
{
    public override async Task<OrderResult> RunAsync(WorkflowContext context, OrderRequest input)
    {
        // Step 1: Validate
        var validated = await context.CallActivityAsync<ValidatedOrder>(
            nameof(ValidateOrderActivity), input);

        // Step 2: Reserve inventory
        var reserved = await context.CallActivityAsync<ReservationResult>(
            nameof(ReserveInventoryActivity), validated);

        // Step 3: Process payment
        var payment = await context.CallActivityAsync<PaymentResult>(
            nameof(ProcessPaymentActivity), new PaymentRequest(validated, reserved));

        // Step 4: Parallel notifications
        var emailTask = context.CallActivityAsync<bool>(
            nameof(SendEmailActivity), new EmailRequest(input.CustomerEmail, validated));
        var smsTask = context.CallActivityAsync<bool>(
            nameof(SendSmsActivity), new SmsRequest(input.CustomerPhone, validated));
        await Task.WhenAll(emailTask, smsTask);

        return new OrderResult(payment.TransactionId, OrderStatus.Completed);
    }
}
```

### Activity Definition
```csharp
public class ValidateOrderActivity : WorkflowActivity<OrderRequest, ValidatedOrder>
{
    private readonly IOrderValidator _validator;

    public ValidateOrderActivity(IOrderValidator validator) => _validator = validator;

    public override async Task<ValidatedOrder> RunAsync(WorkflowActivityContext context, OrderRequest input)
    {
        var result = await _validator.ValidateAsync(input);
        if (!result.IsValid)
            throw new ValidationException(result.Errors);
        return new ValidatedOrder(input);
    }
}
```

### Registration & Startup
```csharp
// Program.cs
builder.Services.AddDaprWorkflow(options =>
{
    options.RegisterWorkflow<OrderFulfillmentWorkflow>();
    options.RegisterActivity<ValidateOrderActivity>();
    options.RegisterActivity<ReserveInventoryActivity>();
    options.RegisterActivity<ProcessPaymentActivity>();
    options.RegisterActivity<SendEmailActivity>();
    options.RegisterActivity<SendSmsActivity>();
});

// Starting a workflow instance
app.MapPost("/orders", async (OrderRequest req, DaprWorkflowClient workflowClient) =>
{
    var instanceId = await workflowClient.ScheduleNewWorkflowAsync(
        nameof(OrderFulfillmentWorkflow), req);
    return Results.Accepted($"/orders/{instanceId}");
});
```

### Workflow Non-Negotiable Rules
- **NEVER** call external APIs directly in `RunAsync` — always use `CallActivityAsync`
- **ALWAYS** make activities idempotent — workflows replay on failure
- **NEVER** use `Thread.Sleep` or `Task.Delay` — use `context.CreateTimer`
- **ALWAYS** register all workflows and activities at startup
- **PREFER** `Task.WhenAll` for parallel activity execution

---

## Secrets Management

### Retrieving Secrets
```csharp
public class ConfigService(DaprClient daprClient)
{
    public async Task<string> GetSecretAsync(string secretName, CancellationToken ct = default)
    {
        var secret = await daprClient.GetSecretAsync("secretstore", secretName, cancellationToken: ct);
        return secret[secretName];
    }

    // Bulk retrieval for startup configuration
    public async Task<Dictionary<string, Dictionary<string, string>>> GetAllSecretsAsync(CancellationToken ct = default)
    {
        return await daprClient.GetBulkSecretAsync("secretstore", cancellationToken: ct);
    }
}
```

### Secret Store Component
```yaml
# dapr/components/azure-keyvault-secrets.yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: secretstore
spec:
  type: secretstores.azure.keyvault
  version: v1
  metadata:
    - name: vaultName
      value: my-keyvault
    - name: azureClientId
      value: ""               # Uses managed identity in production
  scopes:
    - my-api-service          # ALWAYS scope secret access
```

### Secret Rules
- **NEVER** log secret values — even at Debug level
- **ALWAYS** scope secret stores to the services that need them
- **PREFER** managed identity over client credentials in production
- **CACHE** secrets in memory with reasonable TTL — don't fetch on every request

---

## Service Invocation

### Typed Service-to-Service Calls
```csharp
public class OrderService(DaprClient daprClient)
{
    public async Task<InventoryResponse> CheckInventoryAsync(string productId, CancellationToken ct = default)
    {
        // Dapr routes through sidecar with mTLS, retries, and observability
        return await daprClient.InvokeMethodAsync<InventoryRequest, InventoryResponse>(
            "inventory-service",        // Target app-id
            "api/inventory/check",      // Method/route
            new InventoryRequest(productId),
            ct);
    }
}
```

### Service Invocation Rules
- **PREFER** async pub/sub over sync service invocation where possible
- **ALWAYS** set timeouts on invocation calls
- **NEVER** chain more than 3 synchronous service calls — use a workflow instead
- **USE** Dapr service invocation instead of direct HTTP — you get mTLS, retries, and tracing for free

---

## Component Scoping & Security

### Non-Negotiable Component Rules
```yaml
# EVERY component MUST have scopes — no exceptions
scopes:
  - allowed-service-1
  - allowed-service-2

# Production: use secret references, not inline values
metadata:
  - name: connectionString
    secretKeyRef:
      name: redis-connection         # References secretstore component
      key: redis-connection
```

- **ALWAYS** define `scopes` on every component — unscoped components are accessible to all services
- **NEVER** inline connection strings or passwords in component YAML — use `secretKeyRef`
- **ALWAYS** version your component files in source control
- **SEPARATE** component directories per environment: `dapr/components/dev/`, `dapr/components/prod/`

---

## Multi-Tenant Isolation Checklist

| Layer | Pattern | Example |
|-------|---------|---------|
| **State keys** | `{tenantId}-{entityId}` prefix | `acme-order-123` |
| **Pub/sub topics** | Tenant in subject hierarchy | `events.order.acme-corp` |
| **State metadata** | `tenantId` in metadata dictionary | Enables audit/query |
| **Subscriptions** | Wildcard + filter in handler | `events.order.>` |
| **Secrets** | Component scoping per service | `scopes: [api-service]` |
| **Workflows** | Tenant in workflow input | `OrderRequest.TenantId` |

---

## Health Checks

```csharp
// Dapr sidecar health check
builder.Services.AddHealthChecks()
    .AddCheck("dapr-sidecar", () =>
    {
        // Dapr exposes /v1.0/healthz on the sidecar
        return HealthCheckResult.Healthy();
    })
    .AddDaprHealthCheck("dapr");     // Dapr.AspNetCore built-in

app.MapHealthChecks("/healthz");
```

---

## Observability

```csharp
// Dapr propagates W3C trace context automatically through sidecars.
// Ensure your OpenTelemetry setup captures Dapr spans:
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()     // Captures Dapr HTTP calls
        .AddSource("Dapr.Workflow"));       // Captures workflow spans

// Structured logging with Dapr context
logger.LogInformation("Processing event {EventId} for tenant {TenantId} via Dapr",
    evt.Id, evt.TenantId);
```

---

## Resilience & Retry

### Resiliency Policy (Component-Level)
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
      nats-pubsub:
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

## NativeAOT Compatibility

```csharp
// DaprClient uses System.Text.Json — compatible with NativeAOT when using source generators
[JsonSerializable(typeof(OrderPlacedEvent))]
[JsonSerializable(typeof(UserActivityEvent))]
[JsonSerializable(typeof(Dictionary<string, string>))]
internal partial class AppJsonContext : JsonSerializerContext { }

// Register with DaprClient
builder.Services.AddDaprClient(b => b.UseJsonSerializationOptions(
    new JsonSerializerOptions { TypeInfoResolver = AppJsonContext.Default }));
```

- **ALWAYS** use source-generated JSON contexts when targeting NativeAOT
- **AVOID** `Dapr.Client` features that rely on reflection (e.g., untyped `GetStateAsync<object>`)

---

## Anti-Patterns

```
❌ Calling services directly instead of through Dapr sidecar (lose mTLS, retries, tracing)
❌ Unscoped components (every service can access every state store and secret)
❌ Inline connection strings in component YAML (use secretKeyRef)
❌ Flat state keys without tenant prefix (cross-tenant data leaks)
❌ Calling external APIs directly in workflow RunAsync (breaks replay)
❌ Thread.Sleep / Task.Delay in workflows (use context.CreateTimer)
❌ Ignoring etags on state updates (silent data overwrites)
❌ Fire-and-forget pub/sub without dead-letter topics (lost messages)
❌ Chaining 4+ synchronous service invocations (latency cascade)
❌ Logging secret values at any log level
❌ Missing health checks for Dapr sidecar (silent failures in orchestrators)
❌ Using raw HTTP to localhost:3500 instead of typed DaprClient
```

---

## See Also

- `messaging.instructions.md` — CloudEvents, pub/sub message schemas, idempotency patterns
- `security.instructions.md` — Secret management, mTLS, input validation
- `observability.instructions.md` — Distributed tracing, health checks, metrics
- `performance.instructions.md` — Connection pooling, async patterns, caching
- `deploy.instructions.md` — Container orchestration, sidecar configuration
- `errorhandling.instructions.md` — Dead-letter queue processing, retry strategies
