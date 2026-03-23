---
description: Observability patterns for Python — OpenTelemetry, structlog, Prometheus, health checks
applyTo: '**/*log*,**/*telemetry*,**/*metric*,**/*health*,**/middleware/**'
---

# Python Observability Patterns

## Structured Logging

### structlog (Recommended)
```python
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)

logger = structlog.get_logger()

# Usage
logger.info("order_placed", order_id=order_id, tenant_id=tenant_id)
logger.error("order_failed", order_id=order_id, exc_info=True)
```

### Standard Library Logging
```python
import logging

logging.basicConfig(
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ✅ Structured parameters
logger.info("Order placed", extra={"order_id": order_id, "tenant_id": tenant_id})

# ❌ f-string (not structured)
logger.info(f"Order {order_id} placed")
```

## OpenTelemetry Setup

### Registration
```python
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

trace.set_tracer_provider(TracerProvider())
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter())
)
metrics.set_meter_provider(MeterProvider(
    metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())]
))

# Auto-instrument FastAPI
FastAPIInstrumentor().instrument_app(app)
HTTPXClientInstrumentor().instrument()
```

### Custom Traces
```python
tracer = trace.get_tracer(__name__)

async def place_order(request: OrderRequest) -> Order:
    with tracer.start_as_current_span("place_order") as span:
        span.set_attribute("tenant.id", request.tenant_id)
        order = await order_repo.save(request)
        span.set_attribute("order.id", order.id)
        return order
```

### Custom Metrics
```python
meter = metrics.get_meter(__name__)
orders_placed = meter.create_counter("orders.placed")
processing_time = meter.create_histogram("orders.processing_ms")

orders_placed.add(1, {"tenant": tenant_id})
processing_time.record(elapsed_ms, {"status": "success"})
```

## Health Checks (FastAPI)
```python
@app.get("/health/live")
async def liveness():
    return {"status": "ok"}

@app.get("/health/ready")
async def readiness():
    checks = {}
    try:
        await db.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = str(e)
        raise HTTPException(503, detail=checks)
    try:
        redis_client.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = str(e)
        raise HTTPException(503, detail=checks)
    return {"status": "ready", "checks": checks}
```

## Request Middleware
```python
import uuid, time
from starlette.middleware.base import BaseHTTPMiddleware

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        correlation_id = request.headers.get("x-correlation-id", str(uuid.uuid4()))
        start = time.monotonic()
        response = await call_next(request)
        duration = (time.monotonic() - start) * 1000
        logger.info("request_completed",
            method=request.method, path=request.url.path,
            status=response.status_code, duration_ms=round(duration, 2),
            correlation_id=correlation_id)
        response.headers["x-correlation-id"] = correlation_id
        return response
```

## Anti-Patterns

```
❌ print() in production (use structured logger)
❌ f-strings in log messages (not structured, not queryable)
❌ Logging sensitive data (PII, tokens, passwords)
❌ Missing correlation IDs across service calls
❌ No health check endpoints (K8s can't determine readiness)
❌ High-cardinality metric labels (user IDs as tags)
```

## See Also

- `dapr.instructions.md` — Dapr sidecar tracing, health checks, workflow observability
- `errorhandling.instructions.md` — Exception handling, correlation IDs
- `performance.instructions.md` — Profiling, metrics collection
- `deploy.instructions.md` — Health probes, Kubernetes integration
```
