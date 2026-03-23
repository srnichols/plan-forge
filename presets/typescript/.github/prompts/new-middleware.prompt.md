---
description: "Scaffold Express middleware with typed request augmentation, error forwarding, and proper ordering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold an Express middleware function for the HTTP request pipeline.

## Required Pattern

### Standard Middleware
```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function {name}Middleware(req: Request, res: Response, next: NextFunction): void {
  // Pre-processing
  const start = Date.now();

  // Augment response finish for post-processing
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({ method: req.method, path: req.path, status: res.statusCode, duration }, '{name} complete');
  });

  next();
}
```

### Async Middleware (with error forwarding)
```typescript
export function {name}Middleware(req: Request, res: Response, next: NextFunction): void {
  (async () => {
    try {
      // Async operations (e.g., token validation, DB lookup)
      const result = await someAsyncOperation();
      (req as any).{name}Result = result;  // Prefer typed augmentation below
      next();
    } catch (err) {
      next(err);  // ALWAYS forward errors — never swallow
    }
  })();
}
```

### Typed Request Augmentation
```typescript
// types/express.d.ts — extend Express Request
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      correlationId: string;
    }
  }
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.tenantId = req.headers['x-tenant-id'] as string;
  next();
}
```

## Registration Order (app.ts)

```typescript
// Order matters! Follow this sequence:
app.use(correlationIdMiddleware);    // 1. Correlation ID
app.use(requestLoggingMiddleware);   // 2. Request logging
app.use(helmet());                   // 3. Security headers
app.use(rateLimitMiddleware);        // 4. Rate limiting
app.use(authenticate);               // 5. Authentication
app.use({name}Middleware);           // 6. Your custom middleware
app.use(errorHandler);               // LAST: Error handler (4 args)
```

## Common Middleware Types

| Type | Purpose | Example |
|------|---------|---------|
| Correlation ID | Attach trace ID to every request | `req.correlationId = randomUUID()` |
| Tenant Resolution | Extract tenant from JWT/header | `req.tenantId = decodedToken.tenantId` |
| Request Logging | Log method, path, status, duration | `pino` structured logging |
| Error Handler | Map errors to RFC 9457 responses | `(err, req, res, next) => {}` |

## Rules

- Middleware handles cross-cutting concerns ONLY — no business logic
- ALWAYS call `next()` or `next(err)` — never let requests hang
- ALWAYS forward errors with `next(err)` — never swallow exceptions
- Error-handling middleware must have 4 parameters: `(err, req, res, next)`
- Use typed Request augmentation instead of `(req as any).prop`

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
