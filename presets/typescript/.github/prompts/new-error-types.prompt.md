---
description: "Scaffold custom error classes with HTTP status mapping, error codes, and centralized Express error middleware."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold a custom error hierarchy with HTTP status mapping and structured error responses.

## Required Pattern

### Base Application Error
```typescript
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

### Domain Error Types
```typescript
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly errorCode = 'NOT_FOUND';

  constructor(entity: string, id: string) {
    super(`${entity} with id '${id}' was not found.`);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT';

  constructor(message: string) {
    super(message);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 422;
  readonly errorCode = 'VALIDATION_FAILED';
  readonly fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>) {
    super('One or more validation errors occurred.');
    this.fieldErrors = fieldErrors;
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly errorCode = 'FORBIDDEN';

  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
  }
}
```

### Express Error Middleware
```typescript
import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: err.statusCode,
      error: err.errorCode,
      message: err.message,
      ...(err instanceof ValidationError && { fieldErrors: err.fieldErrors }),
    });
    return;
  }

  // Unexpected errors — log full stack, return sanitized message
  console.error('Unhandled error:', err);
  res.status(500).json({
    status: 500,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
}
```

### Registration
```typescript
// MUST be registered AFTER all routes
app.use(errorHandler);
```

### Async Route Wrapper
```typescript
// Catches async errors and forwards to Express error middleware
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Usage
router.get('/:id', asyncHandler(async (req, res) => {
  const item = await service.findById(req.params.id);
  if (!item) throw new NotFoundError('Item', req.params.id);
  res.json(toResponse(item));
}));
```

## Rules

- NEVER throw raw `Error` — always use typed errors extending `AppError`
- NEVER leak stack traces or internal details in production responses
- ALWAYS use `asyncHandler` to forward async errors to Express middleware
- Register error middleware AFTER all routes
- Flag unexpected errors with `isOperational = false` for crash-or-continue decisions
- Keep error classes in `src/errors/`

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
