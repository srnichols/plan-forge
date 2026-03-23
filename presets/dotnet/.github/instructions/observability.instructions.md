---
description: Observability patterns for .NET — OpenTelemetry, structured logging, metrics, distributed tracing
applyTo: '**/*Telemetry*.cs,**/*Logging*.cs,**/*Metrics*.cs,**/*Health*.cs,**/Program.cs'
---

# .NET Observability Patterns

## Structured Logging

### Source-Generated Logging (Recommended)
```csharp
public partial class OrderService
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Order {OrderId} placed for tenant {TenantId}")]
    partial void LogOrderPlaced(string orderId, string tenantId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Order processing failed for {OrderId}")]
    partial void LogOrderFailed(string orderId, Exception ex);
}
```

### Logging Guidelines
```csharp
// ✅ Structured parameters (not string interpolation)
logger.LogInformation("Processing order {OrderId} for tenant {TenantId}", orderId, tenantId);

// ❌ String interpolation (not queryable)
logger.LogInformation($"Processing order {orderId} for tenant {tenantId}");
```

## OpenTelemetry Setup

### Registration
```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddSource("MyApp")
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddNpgsql()
        .AddOtlpExporter())
    .WithMetrics(metrics => metrics
        .AddMeter("MyApp")
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter());
```

### Custom Traces
```csharp
private static readonly ActivitySource Activity = new("MyApp.Orders");

public async Task<Order> PlaceOrderAsync(OrderRequest request, CancellationToken ct)
{
    using var activity = Activity.StartActivity("PlaceOrder");
    activity?.SetTag("tenant.id", request.TenantId);
    activity?.SetTag("order.type", request.Type);

    var order = await _repository.SaveAsync(request, ct);
    activity?.SetTag("order.id", order.Id);
    return order;
}
```

### Custom Metrics
```csharp
private static readonly Meter Meter = new("MyApp.Orders");
private static readonly Counter<long> OrdersPlaced = Meter.CreateCounter<long>("orders.placed");
private static readonly Histogram<double> OrderProcessingTime = Meter.CreateHistogram<double>("orders.processing_ms");

public async Task ProcessAsync(Order order, CancellationToken ct)
{
    var sw = Stopwatch.StartNew();
    // ... process
    OrdersPlaced.Add(1, new KeyValuePair<string, object?>("tenant", order.TenantId));
    OrderProcessingTime.Record(sw.Elapsed.TotalMilliseconds);
}
```

## Health Checks
```csharp
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgresql")
    .AddRedis(redisConnectionString, name: "redis")
    .AddCheck<DaprHealthCheck>("dapr");

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
});
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false, // liveness just checks app is running
});
```

## Correlation IDs
```csharp
// Middleware to propagate correlation ID
app.Use(async (context, next) =>
{
    var correlationId = context.Request.Headers["X-Correlation-ID"].FirstOrDefault()
        ?? Guid.NewGuid().ToString();
    context.Response.Headers["X-Correlation-ID"] = correlationId;
    using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
    {
        await next();
    }
});
```

## Anti-Patterns

```
❌ String interpolation in log messages (not structured, not queryable)
❌ Logging sensitive data (PII, tokens, passwords)
❌ Missing correlation IDs across service boundaries
❌ No health checks (K8s can't determine readiness)
❌ High-cardinality metric labels (e.g., user IDs as tags)
❌ Logging every request body (performance + storage cost)
```

## See Also

- `errorhandling.instructions.md` — Exception handling, correlation IDs
- `performance.instructions.md` — Profiling, metrics collection
- `deploy.instructions.md` — Health probes, Kubernetes integration
```
