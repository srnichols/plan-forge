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
