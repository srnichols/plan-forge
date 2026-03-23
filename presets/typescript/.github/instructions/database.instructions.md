---
description: Database patterns for TypeScript — Prisma/Drizzle/Knex, parameterized queries, migration strategy
applyTo: '**/prisma/**,**/*repository*,**/*repo*,**/*.sql,**/migrations/**'
---

# TypeScript Database Patterns

## ORM Strategy

<!-- Choose one and delete the others -->

### Option A: Prisma
```typescript
// Always use Prisma Client (prevents SQL injection by default)
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { profile: true },
});
```

### Option B: Drizzle ORM
```typescript
const user = await db.select().from(users).where(eq(users.id, userId));
```

### Option C: Raw SQL (Knex / pg)
```typescript
// ❌ NEVER: String interpolation
const result = await db.query(`SELECT * FROM users WHERE id = '${id}'`);

// ✅ ALWAYS: Parameterized queries
const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
```

## Non-Negotiable Rules

### No SQL Injection
```typescript
// ❌ NEVER: Template literals in SQL
const sql = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ ALWAYS: Use ORM or parameterized queries
const user = await prisma.user.findFirst({ where: { email } });
```

### Type Safety
```typescript
// ❌ NEVER: `any` types from database
const users: any[] = await db.query('SELECT * FROM users');

// ✅ ALWAYS: Typed results
const users: User[] = await prisma.user.findMany();
```

## Migration Strategy

### Prisma
```bash
# Create migration
npx prisma migrate dev --name add_user_profile

# Apply migrations (production)
npx prisma migrate deploy

# Generate client after schema changes
npx prisma generate
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| TypeScript properties | camelCase | `userName`, `createdAt` |
| Prisma model fields | camelCase | Auto-mapped from snake_case |

## See Also

- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling
