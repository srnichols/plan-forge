---
description: Observability patterns for TypeScript — OpenTelemetry, structured logging, metrics, tracing
applyTo: '**/*logger*,**/*Logger*,**/*telemetry*,**/*metrics*,**/*health*,**/middleware/**'
---

# TypeScript Observability Patterns

## Structured Logging

### Pino (Recommended)
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

// Usage
logger.info({ orderId, tenantId }, 'Order placed');
logger.error({ err, orderId }, 'Order processing failed');
```

### Logging Guidelines
```typescript
// ✅ Structured context object first, message second
logger.info({ userId, action: 'login' }, 'User authenticated');

// ❌ String template (not queryable)
logger.info(`User ${userId} authenticated`);

// ❌ Sensitive data (NEVER log tokens, passwords, PII)
logger.info({ token }, 'Auth token'); // NEVER
```

## OpenTelemetry Setup

### Registration
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### Custom Traces
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');

export async function placeOrder(request: OrderRequest): Promise<Order> {
  return tracer.startActiveSpan('placeOrder', async (span) => {
    span.setAttribute('tenant.id', request.tenantId);
    try {
      const order = await orderRepo.save(request);
      span.setAttribute('order.id', order.id);
      return order;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

### Custom Metrics
```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('my-service');
const ordersPlaced = meter.createCounter('orders.placed');
const processingTime = meter.createHistogram('orders.processing_ms');

ordersPlaced.add(1, { tenant: tenantId });
processingTime.record(elapsed, { status: 'success' });
```

## Health Checks
```typescript
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    await redis.ping();
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: (err as Error).message });
  }
});
```

## Request Logging Middleware
```typescript
import { randomUUID } from 'node:crypto';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const correlationId = req.headers['x-correlation-id'] as string ?? randomUUID();
  res.setHeader('x-correlation-id', correlationId);

  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: Date.now() - start,
      correlationId,
    }, 'Request completed');
  });
  next();
}
```

## Anti-Patterns

```
❌ console.log in production (use structured logger like pino)
❌ Logging sensitive data (PII, tokens, passwords)
❌ Missing correlation IDs across service calls
❌ No health check endpoints (K8s can't determine readiness)
❌ High-cardinality metric labels (user IDs, request paths with params)
❌ Synchronous file logging (blocks event loop)
```
