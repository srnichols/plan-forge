---
description: Messaging patterns for .NET — Dapr Pub/Sub, MassTransit, NATS, RabbitMQ, CloudEvents
applyTo: '**/*Worker*.cs,**/*Event*.cs,**/*Message*.cs,**/*Handler*.cs,**/dapr/**'
---

# .NET Messaging & Pub/Sub Patterns

## Messaging Strategy

### Dapr Pub/Sub (Recommended for Service Mesh)
```csharp
// Publishing events
public class OrderService(DaprClient daprClient)
{
    public async Task PlaceOrderAsync(Order order, CancellationToken ct = default)
    {
        await _repository.SaveAsync(order, ct);
        await daprClient.PublishEventAsync(
            "pubsub",            // component name
            "order-placed",      // topic
            new OrderPlacedEvent(order.Id, order.TenantId, DateTimeOffset.UtcNow),
            ct);
    }
}

// Subscribing to events
[ApiController]
public class OrderEventsController : ControllerBase
{
    [Topic("pubsub", "order-placed")]
    [HttpPost("/events/order-placed")]
    public async Task<IActionResult> HandleOrderPlaced(
        OrderPlacedEvent evt, [FromServices] IOrderProcessor processor, CancellationToken ct)
    {
        await processor.ProcessAsync(evt, ct);
        return Ok();
    }
}
```

### NATS JetStream (Direct)
```csharp
// Publishing
await js.PublishAsync("orders.placed", new OrderPlacedEvent { ... }, cancellationToken: ct);

// Subscribing (durable consumer)
var consumer = await js.CreateOrUpdateConsumerAsync("orders", new ConsumerConfig
{
    DurableName = "order-processor",
    FilterSubject = "orders.placed",
    AckPolicy = ConsumerConfigAckPolicy.Explicit,
});
```

### MassTransit (RabbitMQ / Azure Service Bus)
```csharp
// Program.cs
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<OrderPlacedConsumer>();
    x.UsingRabbitMq((context, cfg) =>
    {
        cfg.Host(builder.Configuration.GetConnectionString("RabbitMQ"));
        cfg.ConfigureEndpoints(context);
    });
});

// Consumer
public class OrderPlacedConsumer : IConsumer<OrderPlacedEvent>
{
    public async Task Consume(ConsumeContext<OrderPlacedEvent> context)
    {
        var evt = context.Message;
        // Process event
    }
}
```

## Event Schema (CloudEvents)
```csharp
// Always use typed events — never raw strings
public record OrderPlacedEvent(
    Guid OrderId,
    string TenantId,
    DateTimeOffset OccurredAt);

// Include tenant_id in ALL events for multi-tenant routing
```

## BackgroundService Worker Pattern
```csharp
public class OrderProcessorWorker(ILogger<OrderProcessorWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                await ProcessPendingOrdersAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Order processing failed");
            }
        }
    }
}
```

## Dead Letter & Retry Strategy
```csharp
// Dapr retry policy (component config)
// spec.metadata:
//   - name: maxRetries
//     value: "3"
//   - name: backoffPolicy
//     value: "exponential"

// MassTransit retry
cfg.UseMessageRetry(r => r.Exponential(3, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(5)));
```

## Anti-Patterns

```
❌ Fire-and-forget without error handling (lost messages)
❌ Synchronous processing in event handlers (blocks the pipeline)
❌ Missing tenant_id in event payloads (breaks multi-tenant isolation)
❌ No idempotency check (duplicate event processing)
```

## Idempotency

Always guard consumers against duplicate delivery. Use a persistent idempotency store:

```csharp
public class IdempotentEventHandler<TEvent>(IIdempotencyStore store) where TEvent : class
{
    public async Task HandleAsync(string eventId, TEvent evt, Func<TEvent, CancellationToken, Task> handler, CancellationToken ct)
    {
        if (await store.ExistsAsync(eventId, ct))
            return; // Already processed

        await handler(evt, ct);
        await store.MarkProcessedAsync(eventId, ct);
    }
}

// Usage in a MassTransit consumer
public class OrderPlacedConsumer(IdempotentEventHandler<OrderPlacedEvent> guard) : IConsumer<OrderPlacedEvent>
{
    public Task Consume(ConsumeContext<OrderPlacedEvent> context) =>
        guard.HandleAsync(context.MessageId?.ToString() ?? "", context.Message, ProcessAsync, context.CancellationToken);

    private Task ProcessAsync(OrderPlacedEvent evt, CancellationToken ct) { /* ... */ }
}
```

Idempotency store options: database table with unique constraint on `event_id`, or Redis `SET NX` with TTL.

## See Also

- `observability.instructions.md` — Distributed tracing, event logging
- `errorhandling.instructions.md` — Dead letter queues, retry logic
- `database.instructions.md` — Idempotency stores, transactional outbox
❌ No idempotency check (duplicate events cause duplicate processing)
❌ Tight coupling to transport (use abstractions like Dapr/MassTransit)
❌ Large payloads in events (pass IDs, not full objects)
```
