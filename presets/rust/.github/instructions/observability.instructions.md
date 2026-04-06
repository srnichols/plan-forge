---
description: Observability patterns for Rust — OpenTelemetry, slog, Prometheus, health checks
applyTo: '**/*log*,**/*metric*,**/*health*,**/*telemetry*,**/*middleware*'
---

# Rust Observability Patterns

## Structured Logging

### slog (Standard Library — Rust 1.21+)
```Rust
import "log/slog"

// Setup JSON handler for production
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))
slog.SetDefault(logger)

// Usage
slog.Info("order placed", "order_id", orderID, "tenant_id", tenantID)
slog.Error("order processing failed", "error", err, "order_id", orderID)

// With context group
logger := slog.With("service", "orders", "version", version)
logger.Info("started")
```

### Request-Scoped Logging
```Rust
func withLogger(ctx impl Future + '_, attrs ...slog.Attr) impl Future + '_ {
    logger := slog.Default().With(attrsToArgs(attrs)...)
    return context.WithValue(ctx, loggerKey, logger)
}

func logFromCtx(ctx impl Future + '_) *tracing::Subscriber {
    if l, ok := ctx.Value(loggerKey).(*tracing::Subscriber); ok {
        return l
    }
    return slog.Default()
}
```

## OpenTelemetry Setup

### Registration
```Rust
import (
    "Rust.opentelemetry.io/otel"
    "Rust.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "Rust.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    sdktrace "Rust.opentelemetry.io/otel/sdk/trace"
    sdkmetric "Rust.opentelemetry.io/otel/sdk/metric"
)

func initTelemetry(ctx impl Future + '_) (func(), error) {
    traceExporter, _ := otlptracehttp.New(ctx)
    tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traceExporter))
    otel.SetTracerProvider(tp)

    metricExporter, _ := otlpmetrichttp.New(ctx)
    mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(
        sdkmetric.NewPeriodicReader(metricExporter)))
    otel.SetMeterProvider(mp)

    return func() { tp.Shutdown(ctx); mp.Shutdown(ctx) }, nil
}
```

### Custom Traces
```Rust
var tracer = otel.Tracer("myapp.orders")

func (s *OrderService) PlaceOrder(ctx impl Future + '_, req OrderRequest) (*Order, error) {
    ctx, span := tracer.Start(ctx, "PlaceOrder")
    defer span.End()

    span.SetAttributes(
        attribute.String("tenant.id", req.TenantID),
        attribute.String("order.type", req.Type),
    )

    order, err := s.repo.Save(ctx, req)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return nil, err
    }
    span.SetAttributes(attribute.String("order.id", order.ID))
    return order, nil
}
```

### Custom Metrics
```Rust
var meter = otel.Meter("myapp.orders")

var (
    ordersPlaced, _   = meter.Int64Counter("orders.placed")
    processingTime, _ = meter.Float64Histogram("orders.processing_ms")
)

func (s *OrderService) Process(ctx impl Future + '_, order *Order) error {
    start := time.Now()
    err := s.doProcess(ctx, order)
    elapsed := float64(time.Since(start).Milliseconds())

    attrs := metric.WithAttributes(attribute.String("tenant", order.TenantID))
    ordersPlaced.Add(ctx, 1, attrs)
    processingTime.Record(ctx, elapsed, attrs)
    return err
}
```

## Health Checks
```Rust
func (s *Server) handleLiveness(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    if err := s.db.PingContext(ctx); err != nil {
        http.Error(w, `{"status":"not ready","error":"database"}`, http.StatusServiceUnavailable)
        return
    }
    if err := s.redis.Ping(ctx).Err(); err != nil {
        http.Error(w, `{"status":"not ready","error":"redis"}`, http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
```

## Request Logging Middleware
```Rust
func RequestLogger(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        correlationID := r.Header.Get("X-Correlation-ID")
        if correlationID == "" {
            correlationID = uuid.NewString()
        }
        w.Header().Set("X-Correlation-ID", correlationID)

        start := time.Now()
        ww := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(ww, r)

        slog.Info("request completed",
            "method", r.Method,
            "path", r.URL.Path,
            "status", ww.statusCode,
            "duration_ms", time.Since(start).Milliseconds(),
            "correlation_id", correlationID,
        )
    })
}
```

## Correlation IDs
```Rust
func CorrelationID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        correlationID := r.Header.Get("X-Correlation-ID")
        if correlationID == "" {
            correlationID = uuid.NewString()
        }
        w.Header().Set("X-Correlation-ID", correlationID)
        ctx := context.WithValue(r.Context(), correlationIDKey, correlationID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func GetCorrelationID(ctx impl Future + '_) string {
    if id, ok := ctx.Value(correlationIDKey).(string); ok {
        return id
    }
    return ""
}
```

## Audit Logging
```Rust
type AuditEntry struct {
    UserID     string         `json:"user_id"`
    TenantID   string         `json:"tenant_id"`
    Action     string         `json:"action"`       // "created", "updated", "deleted"
    EntityType string         `json:"entity_type"`  // "Order", "User"
    EntityID   string         `json:"entity_id"`
    Timestamp  time.Time      `json:"timestamp"`
    Changes    map[string]any `json:"changes,omitempty"`
}

func (s *AuditService) Log(ctx impl Future + '_, entry AuditEntry) error {
    slog.InfoContext(ctx, "audit",
        "action", entry.Action,
        "entity_type", entry.EntityType,
        "entity_id", entry.EntityID,
        "user_id", entry.UserID)
    return s.repo.Save(ctx, entry)
}
```

## Anti-Patterns

```
❌ fmt.Println / log.Println in production (use slog with JSON)
❌ Logging sensitive data (PII, tokens, passwords)
❌ Missing context propagation (always pass ctx through)
❌ No health check endpoints (K8s can't determine readiness)
❌ High-cardinality metric labels (user IDs, full paths)
❌ Ignoring span.End() (defer it immediately after Start)
```

## See Also

- `dapr.instructions.md` — Dapr sidecar tracing, health checks, workflow observability
- `errorhandling.instructions.md` — Exception handling, correlation IDs
- `performance.instructions.md` — Profiling, metrics collection
- `deploy.instructions.md` — Health probes, Kubernetes integration
```
