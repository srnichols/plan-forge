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

### Non-Negotiable Migration Rules
- **NEVER** deploy a destructive migration (drop column/table) in the same release that removes the code using it
- **ALWAYS** review generated SQL before applying to staging or production
- **ALWAYS** make migrations backward-compatible — the old version of the app must still work after the migration runs
- **ALWAYS** test migrations against a copy of production data before applying to production
- **NEVER** use `prisma db push` in production — it can drop data; use `prisma migrate deploy`
- **ALWAYS** run migrations as a separate pipeline step before deploying the new app version

### Prisma
```bash
# Create migration (development only — prompts if destructive)
npx prisma migrate dev --name add_user_profile

# Apply migrations (production — exits non-zero on failure)
npx prisma migrate deploy

# Generate client after schema changes
npx prisma generate

# Check migration status
npx prisma migrate status

# Reset database (development only — DELETES ALL DATA)
npx prisma migrate reset
```

### Drizzle ORM
```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate

# Preview changes without applying (dry-run)
npx drizzle-kit push --dry-run
```

### Safe vs. Dangerous Operations

| Operation | Risk | Strategy |
|-----------|------|----------|
| Add column (optional) | **Safe** | Deploy directly |
| Add column (required) | **Medium** | Add optional first → backfill → add `@default` or make required |
| Add index | **Medium** | Prisma handles this; for raw SQL use `CREATE INDEX CONCURRENTLY` |
| Rename column | **Dangerous** | Expand-contract: add new → copy → update Prisma schema → drop old |
| Drop column | **Dangerous** | Two releases: (1) remove from schema + stop using, (2) drop |
| Change column type | **Dangerous** | Add new column → backfill → switch reads → drop old |
| Drop table | **Dangerous** | Only after all references removed and verified in production |

### Expand-Contract Pattern (Zero-Downtime)

```
Release 1 — EXPAND:
  prisma/migrations/xxx_expand_order_status:
    ALTER TABLE "orders" ADD COLUMN "status_v2" TEXT;
    UPDATE "orders" SET "status_v2" = "status";
  Code: Write to BOTH columns, read from new column

Release 2 — CONTRACT:
  prisma/migrations/xxx_contract_order_status:
    ALTER TABLE "orders" DROP COLUMN "status";
    ALTER TABLE "orders" RENAME COLUMN "status_v2" TO "status";
  Code: Remove all references to old column
```

```typescript
// Custom migration SQL for expand step (prisma/migrations/xxx/migration.sql)
-- AlterTable
ALTER TABLE "orders" ADD COLUMN "status_v2" TEXT;
UPDATE "orders" SET "status_v2" = "status";
```

### Production Migration Checklist

```
Pre-Deploy:
  □ Ran `npx prisma migrate diff` to review what will change
  □ Reviewed prisma/migrations/xxx/migration.sql for destructive operations
  □ Tested migration against staging with production-like data
  □ Verified backward compatibility — old app version still works after migration
  □ Backup taken or point-in-time recovery confirmed
  □ Checked `npx prisma migrate status` for pending/failed migrations

Deploy:
  □ Run `npx prisma migrate deploy` BEFORE deploying new app version
  □ Health check passes after migration, before app deploy
  □ Monitor for lock contention during migration

Post-Deploy:
  □ Verify app health checks pass
  □ Spot-check migrated data
  □ Monitor error rates for 15 minutes
```

### Rollback Strategy

```bash
# Prisma does NOT support automatic rollback — you must create a new migration that reverses changes
# Option 1: Create a counter-migration
npx prisma migrate dev --name revert_add_user_profile
# Then manually write the reverse DDL in the generated migration file

# Option 2: For Drizzle, use down migrations or revert SQL scripts
# migrations/rollback/
#   0003_revert_orders_table.sql
```

**Important**: Prisma `migrate deploy` is forward-only. Always keep rollback SQL scripts alongside migrations for production emergencies.

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| TypeScript properties | camelCase | `userName`, `createdAt` |
| Prisma model fields | camelCase | Auto-mapped from snake_case |

## See Also

- `deploy.instructions.md` — Migration pipeline steps, Docker Compose migration patterns
- `multi-environment.instructions.md` — Per-environment migration config, shadow database
- `graphql.instructions.md` — DataLoader batch queries, N+1 prevention
- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use `include` / `with` relations or batch queries from the start. |
| "Raw SQL is faster than the ORM here" | Raw SQL bypasses type safety, migration tracking, and parameterization. Use Prisma/Drizzle unless profiling proves a measurable bottleneck — then use parameterized raw queries. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets a migration — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use seed scripts or migration-based seeds. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use environment variables with per-environment overrides. |

---

## Warning Signs

- Queries executed inside a `for`/`forEach` loop (N+1 pattern)
- `SELECT *` or `findMany()` without `select`/field filtering (over-fetching)
- Missing indexes on columns used in `where` or `join` clauses
- Connection strings hardcoded or present in source files
- No migration file corresponds to a recent schema change
- Database client created as a module-level singleton without connection pooling configuration
