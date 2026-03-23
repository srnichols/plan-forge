---
description: Observability patterns for Go — OpenTelemetry, slog, Prometheus, health checks
applyTo: '**/*log*,**/*metric*,**/*health*,**/*telemetry*,**/*middleware*'
---

# Go Observability Patterns

## Structured Logging

### slog (Standard Library — Go 1.21+)
```go
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
```go
func withLogger(ctx context.Context, attrs ...slog.Attr) context.Context {
    logger := slog.Default().With(attrsToArgs(attrs)...)
    return context.WithValue(ctx, loggerKey, logger)
}

func logFromCtx(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}
```

## OpenTelemetry Setup

### Registration
```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

func initTelemetry(ctx context.Context) (func(), error) {
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
```go
var tracer = otel.Tracer("myapp.orders")

func (s *OrderService) PlaceOrder(ctx context.Context, req OrderRequest) (*Order, error) {
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
```go
var meter = otel.Meter("myapp.orders")

var (
    ordersPlaced, _   = meter.Int64Counter("orders.placed")
    processingTime, _ = meter.Float64Histogram("orders.processing_ms")
)

func (s *OrderService) Process(ctx context.Context, order *Order) error {
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
```go
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
```go
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
