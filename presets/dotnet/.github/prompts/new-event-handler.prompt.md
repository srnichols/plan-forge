---
description: "Scaffold domain event types, handlers, and a MediatR-based publish/subscribe pipeline."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold domain events with typed handlers using MediatR notifications.

## Required Pattern

### Domain Event
```csharp
// Marker interface for domain events
public interface IDomainEvent : INotification
{
    Guid EventId { get; }
    DateTime OccurredAt { get; }
}

// Base record for convenience
public abstract record DomainEvent : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredAt { get; } = DateTime.UtcNow;
}

// Concrete event
public record OrderPlacedEvent(
    Guid OrderId,
    Guid CustomerId,
    decimal TotalAmount) : DomainEvent;
```

### Event Handler
```csharp
public class OrderPlacedHandler : INotificationHandler<OrderPlacedEvent>
{
    private readonly IEmailService _emailService;
    private readonly ILogger<OrderPlacedHandler> _logger;

    public OrderPlacedHandler(IEmailService emailService, ILogger<OrderPlacedHandler> logger)
    {
        _emailService = emailService;
        _logger = logger;
    }

    public async Task Handle(OrderPlacedEvent notification, CancellationToken ct)
    {
        _logger.LogInformation("Handling OrderPlaced: {OrderId}", notification.OrderId);
        await _emailService.SendOrderConfirmationAsync(notification.OrderId, ct);
    }
}
```

### Publishing Events
```csharp
public class OrderService
{
    private readonly IMediator _mediator;

    public async Task<Order> PlaceOrderAsync(CreateOrderRequest request, CancellationToken ct)
    {
        var order = new Order(request.CustomerId, request.Items);
        await _repository.AddAsync(order, ct);

        await _mediator.Publish(new OrderPlacedEvent(
            order.Id, order.CustomerId, order.TotalAmount), ct);

        return order;
    }
}
```

### Multiple Handlers per Event
```csharp
// MediatR publishes to ALL registered handlers for an event
public class OrderPlacedAuditHandler : INotificationHandler<OrderPlacedEvent>
{
    public async Task Handle(OrderPlacedEvent notification, CancellationToken ct)
    {
        // Write to audit log — runs independently of email handler
    }
}
```

### Registration
```csharp
builder.Services.AddMediatR(cfg =>
    cfg.RegisterServicesFromAssemblyContaining<Program>());
```

## Rules

- Events are immutable records — NEVER mutate after creation
- Event handlers MUST be idempotent — the same event may be delivered more than once
- Handlers should do ONE thing — create multiple handlers for multiple side effects
- NEVER throw from event handlers — log and continue (don't break the publisher)
- Keep events in a `Events/` folder, handlers in `EventHandlers/`
- Use `CancellationToken` in all async handler methods

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging.instructions.md)
