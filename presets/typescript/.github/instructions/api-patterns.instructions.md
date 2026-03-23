---
description: API patterns for TypeScript — REST conventions, error handling, pagination, Express/Fastify
applyTo: '**/*route*,**/*Route*,**/*controller*,**/*Controller*,**/*handler*,**/*Handler*,**/routes/**'
---

# TypeScript API Patterns

## REST Conventions

### Route Structure (Express)
```typescript
import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

// GET /api/producers
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = '1', pageSize = '25' } = req.query;
    const result = await producerService.getPaged(Number(page), Number(pageSize));
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/producers/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const producer = await producerService.getById(req.params.id);
    if (!producer) return res.status(404).json({ error: 'Not found' });
    res.json(producer);
  } catch (err) { next(err); }
});

// POST /api/producers
router.post('/', validateBody(createProducerSchema), async (req, res, next) => {
  try {
    const created = await producerService.create(req.body);
    res.status(201).location(`/api/producers/${created.id}`).json(created);
  } catch (err) { next(err); }
});

// PUT /api/producers/:id
router.put('/:id', validateBody(updateProducerSchema), async (req, res, next) => {
  try {
    await producerService.update(req.params.id, req.body);
    res.status(204).end();
  } catch (err) { next(err); }
});

// DELETE /api/producers/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await producerService.delete(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
```

## Error Handling (RFC 9457 Problem Details)
```typescript
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
}

// Global error handler
function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ValidationError) {
    return res.status(400).json({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'Validation failed',
      status: 400,
      detail: err.message,
      errors: err.errors,
    });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
      title: 'Not found',
      status: 404,
      detail: err.message,
    });
  }
  // Never expose internal errors to clients
  res.status(500).json({
    type: 'https://tools.ietf.org/html/rfc9110#section-15.6.1',
    title: 'Internal server error',
    status: 500,
  });
}
```

## Request Validation (Zod)
```typescript
import { z } from 'zod';

const createProducerSchema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        title: 'Validation failed',
        status: 400,
        errors: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}
```

## Pagination
```typescript
interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

function paginate<T>(items: T[], total: number, page: number, pageSize: number): PagedResult<T> {
  const totalPages = Math.ceil(total / pageSize);
  return {
    items, page, pageSize,
    totalCount: total, totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success (include Location header) |
| 204 No Content | PUT/DELETE success, no body |
| 400 Bad Request | Validation failure, malformed request |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource |
| 422 Unprocessable | Valid syntax but business rule violation |
| 500 Internal Server | Unhandled exception (never expose details) |

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose stack traces to clients (generic 500 in production)
❌ Business logic in route handlers (delegate to services)
❌ Trust req.body without validation (always use Zod/Joi)
❌ Swallow errors with empty catch (always call next(err))
❌ Return full database entities (return DTOs, strip internal fields)
```

## See Also

- `security.instructions.md` — Auth middleware, input validation, CORS
- `errorhandling.instructions.md` — Error response format, Express middleware
- `performance.instructions.md` — Hot-path optimization, async patterns
