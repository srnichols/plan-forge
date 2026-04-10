---
description: Error handling patterns — Custom error classes, Express error middleware, HTTP error mapping, error boundaries
applyTo: '**/*.{ts,tsx}'
---

# Error Handling Patterns (TypeScript/Node.js)

## Error Class Hierarchy

```typescript
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(entity: string, id: string) {
    super(`${entity} with ID '${id}' not found`);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  constructor(public readonly errors: Record<string, string[]>) {
    super('Validation failed');
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  constructor(message = 'Access denied') { super(message); }
}
```

## Express Global Error Handler

```typescript
import { ErrorRequestHandler } from 'express';

export const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, 'Application error');
    return res.status(err.statusCode).json({
      type: `https://contoso.com/errors/${err.code.toLowerCase()}`,
      title: err.code,
      status: err.statusCode,
      detail: err.message,
      instance: req.path,
    });
  }

  logger.error({ err, path: req.path }, 'Unhandled exception');
  return res.status(500).json({
    type: 'https://contoso.com/errors/internal',
    title: 'INTERNAL_ERROR',
    status: 500,
    detail: 'An unexpected error occurred',
    instance: req.path,
  });
};
```

## Rules

- **NEVER** use empty catch blocks — always log or rethrow with context
- **NEVER** leak stack traces in production (`NODE_ENV=production` strips them)
- **ALWAYS** use typed error classes — no bare `throw new Error()`
- **ALWAYS** return ProblemDetails-style JSON from API endpoints
- Service layer throws typed errors; Express middleware maps them
- Use `isOperational` flag to distinguish expected vs crash-worthy errors
- Unhandled rejections should trigger graceful shutdown

## Async Error Wrapper

```typescript
export const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Usage: router.get('/items/:id', asyncHandler(getItemById));
```

## React Error Boundaries

```tsx
class ErrorBoundary extends React.Component<Props, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: undefined })} />;
    return this.props.children;
  }
}
```

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `messaging.instructions.md` — Dead letter queues, retry strategies
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This operation can't fail" | Every I/O operation can fail — network timeouts, disk full, permission denied. If it touches external state, it fails. |
| "A generic catch block is fine here" | Generic catches swallow specific failure signals. Catch the error you expect, let the rest propagate to the global error handler. |
| "Logging the error is enough" | Logging without handling means the caller receives a cryptic 500. Return a structured error response so the consumer can act on it. |
| "The caller handles errors, I don't need to" | If the caller expected your function to succeed unconditionally, the unhandled rejection is a surprise. Define your error contract explicitly. |
| "Returning `null` is simpler than throwing" | Null return values push error handling to every caller. Use typed result objects or throw a specific error with a clear message. |

---

## Warning Signs

- Empty catch blocks (`catch (e) { }` or `catch { }`) — silent failure
- All errors caught as generic `Error` instead of specific types or checked properties
- Error responses expose stack traces or internal paths to API consumers
- Functions that return `null` or `undefined` on failure instead of throwing or using Result types
- Missing `AbortController` or timeout handling on async operations (no way to cancel on timeout)
- Retry logic without a maximum retry count or exponential backoff (infinite retry loops)
