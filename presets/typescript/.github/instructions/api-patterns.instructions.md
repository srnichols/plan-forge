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

## API Versioning

### URL-based Versioning (Recommended)
```typescript
// Mount versioned routers
import v1Router from './routes/v1';
import v2Router from './routes/v2';

app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);
```

### Header-based Versioning
```typescript
// Middleware to read API version from header
function apiVersion(req: Request, _res: Response, next: NextFunction) {
  const version = req.headers['api-version'] ?? '1';
  req.apiVersion = Number(version);
  next();
}

// Route handler branches on version
router.get('/producers', apiVersion, async (req, res, next) => {
  try {
    const result = req.apiVersion >= 2
      ? await producerService.getPagedV2(/* expanded fields */)
      : await producerService.getPaged(/* v1 fields */);
    res.json(result);
  } catch (err) { next(err); }
});
```

### Version Discovery Endpoint
```typescript
app.get('/api/versions', (_req, res) => res.json({
  supported: ['v1', 'v2'],
  current: 'v2',
  deprecated: ['v1'],
  sunset: { v1: '2026-01-01' },
}));
```

### Deprecation Headers Middleware
```typescript
function deprecationHeaders(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/v1')) {
    res.set('Sunset', 'Sat, 01 Jan 2026 00:00:00 GMT');
    res.set('Deprecation', 'true');
    res.set('Link', '</api/v2/docs>; rel="successor-version"');
  }
  next();
}
app.use(deprecationHeaders);
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window
- Return `410 Gone` after sunset date, not `404`
- Document version differences in OpenAPI specs

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose stack traces to clients (generic 500 in production)
❌ Business logic in route handlers (delegate to services)
❌ Trust req.body without validation (always use Zod/Joi)
❌ Swallow errors with empty catch (always call next(err))
❌ Return full database entities (return DTOs, strip internal fields)
```

## API Documentation (OpenAPI)

### Express + swagger-jsdoc
```typescript
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'MyApp API', version: '1.0.0' },
    servers: [{ url: '/api' }],
  },
  apis: ['./src/routes/*.ts'],
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
```

### JSDoc Annotations
```typescript
/**
 * @openapi
 * /api/producers/{id}:
 *   get:
 *     summary: Get producer by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Producer found
 *       404:
 *         description: Producer not found
 */
```

- **ALWAYS** annotate all endpoints with `@openapi` JSDoc
- **ALWAYS** document error responses (400, 404, 500)
- Consider `tsoa` or `zod-to-openapi` for type-safe spec generation from schemas

## See Also

- `version.instructions.md` — Semantic versioning, pre-release, deprecation timelines
- `graphql.instructions.md` — Apollo Server schema, resolvers, DataLoaders (for GraphQL APIs)
- `security.instructions.md` — Auth middleware, input validation, CORS
- `errorhandling.instructions.md` — Error response format, Express middleware
- `performance.instructions.md` — Hot-path optimization, async patterns

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Nobody uses pagination yet" | Unbounded queries return all rows. The first large dataset crashes the client or times out. Add `?page=1&limit=20` from the first endpoint. |
| "API versioning can wait until v2" | Unversioned APIs break all consumers on the first change. Add `/api/v1/` from day one — it costs zero lines of logic. |
| "Error codes aren't needed for MVP" | API consumers parse error codes programmatically. Returning only string messages forces consumers to regex-match errors — brittle and untranslatable. |
| "Returning 200 OK for all responses simplifies the client" | HTTP semantics exist for a reason. Returning 200 for errors breaks caching, monitoring, and every HTTP-aware tool in the pipeline. |
| "This endpoint doesn't need request validation" | Every endpoint accepting input is an attack surface. Validate shape and constraints at the API boundary — Zod + middleware handles this with minimal code. |

---

## Warning Signs

- An endpoint returns an unbounded collection without pagination parameters
- No JSDoc, OpenAPI decorator, or schema annotation on route handlers (undocumented API contract)
- Route paths don't include a version segment (`/api/users` instead of `/api/v1/users`)
- HTTP 200 returned for error conditions instead of 4xx/5xx
- Request body accepted as `any` or untyped object instead of a validated schema
- Missing `Content-Type` header on responses (clients can't parse reliably)
