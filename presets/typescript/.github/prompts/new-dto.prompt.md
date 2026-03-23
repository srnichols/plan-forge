---
description: "Scaffold request/response types with Zod validation schemas, type inference, and mapping utilities."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Data Transfer Object)

Scaffold request and response types that separate API contracts from domain entities.

## Required Pattern

### Response Type
```typescript
// Immutable interface — returned from API endpoints
export interface {EntityName}Response {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;  // ISO 8601
  updatedAt: string;
}
```

### Zod Validation Schemas (Request DTOs)
```typescript
import { z } from 'zod';

export const create{EntityName}Schema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

export const update{EntityName}Schema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

// Infer TypeScript types from Zod schemas
export type Create{EntityName}Request = z.infer<typeof create{EntityName}Schema>;
export type Update{EntityName}Request = z.infer<typeof update{EntityName}Schema>;
```

### Validation Middleware
```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError(result.error.flatten().fieldErrors);
    }
    req.body = result.data;  // Use parsed/coerced data
    next();
  };
}

// Usage in routes
router.post('/', validateBody(create{EntityName}Schema), handler);
```

### Mapping Utility
```typescript
export function toResponse(entity: {EntityName}Entity): {EntityName}Response {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
```

## Paged Response Wrapper
```typescript
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
```

## Rules

- NEVER return database entities directly from routes
- ALWAYS validate request bodies with Zod — never trust `req.body` raw
- Infer TypeScript types from Zod schemas (`z.infer<typeof schema>`)
- Use `safeParse` — never `parse` (throws untyped errors)
- Keep DTOs in `src/models/` or `src/schemas/` — not in route files
- Date fields in responses should always be ISO 8601 strings

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
