---
description: Database patterns for .NET — Dapper/EF Core, parameterized queries, migration strategy
applyTo: '**/*Repository*.cs,**/*Migration*.cs,**/Database/**,**/*.sql'
---

# .NET Database Patterns

## ORM Strategy

<!-- Choose one and delete the other -->

### Option A: Dapper (Micro-ORM)
```csharp
// Always use parameterized queries
const string sql = "SELECT * FROM users WHERE email = @Email";
var user = await connection.QuerySingleOrDefaultAsync<User>(sql, new { Email = email });
```

### Option B: Entity Framework Core
```csharp
var user = await _context.Users
    .Where(u => u.Email == email)
    .FirstOrDefaultAsync(cancellationToken);
```

## Non-Negotiable Rules

### Parameterized Queries (SQL Injection Prevention)
```csharp
// ❌ NEVER: String interpolation in SQL
var sql = $"SELECT * FROM users WHERE id = '{userId}'";

// ✅ ALWAYS: Parameters
const string sql = "SELECT * FROM users WHERE id = @UserId";
await connection.QueryAsync<User>(sql, new { UserId = userId });
```

### Connection Management
```csharp
// ❌ NEVER: Manual connection creation
using var conn = new NpgsqlConnection(connectionString);

// ✅ ALWAYS: Use DI / connection factory
using var conn = await _connectionFactory.CreateConnectionAsync(cancellationToken);
```

### Async with CancellationToken
```csharp
// ❌ NEVER: Sync database calls
var result = connection.Query<User>(sql);

// ✅ ALWAYS: Async with cancellation
var result = await connection.QueryAsync<User>(sql, cancellationToken: cancellationToken);
```

## Migration Strategy

### Non-Negotiable Migration Rules
- **NEVER** deploy a destructive migration (drop column/table) in the same release that removes the code using it
- **ALWAYS** review generated SQL before applying to staging or production — `dotnet ef migrations script --idempotent`
- **ALWAYS** make migrations backward-compatible — the old version of the app must still work after the migration runs
- **ALWAYS** test migrations against a copy of production data before applying to production
- **NEVER** use `EnsureCreated()` in production — it bypasses the migration pipeline
- **ALWAYS** run migrations as a separate pipeline step before deploying the new app version

### EF Core Migrations
```bash
# Create a migration
dotnet ef migrations add AddUserProfile --project src/MyApp.Data

# Apply migrations
dotnet ef database update

# Generate SQL script for production (ALWAYS review this before applying)
dotnet ef migrations script --idempotent -o migrations.sql

# Generate SQL for specific range (useful for staged rollouts)
dotnet ef migrations script FromMigration ToMigration --idempotent -o migrations.sql
```

### Dapper + Flyway/DbUp
```
migrations/
├── V001__create_users_table.sql
├── V002__add_tenant_id_column.sql
└── V003__create_orders_table.sql
```

```csharp
// DbUp (C#-native migration runner)
var upgrader = DeployChanges.To
    .PostgresqlDatabase(connectionString)
    .WithScriptsEmbeddedInAssembly(Assembly.GetExecutingAssembly())
    .WithTransaction()            // Wrap each script in a transaction
    .LogToConsole()
    .Build();

var result = upgrader.PerformUpgrade();
if (!result.Successful) throw new Exception("Migration failed", result.Error);
```

### Safe vs. Dangerous Operations

| Operation | Risk | Strategy |
|-----------|------|----------|
| Add column (nullable) | **Safe** | Deploy directly |
| Add column (non-null) | **Medium** | Add nullable first → backfill → add constraint |
| Add index | **Medium** | Use `CREATE INDEX CONCURRENTLY` (PostgreSQL) to avoid locking |
| Rename column | **Dangerous** | Expand-contract: add new → copy data → migrate code → drop old |
| Drop column | **Dangerous** | Two releases: (1) stop reading/writing, (2) drop in next release |
| Change column type | **Dangerous** | Add new column → backfill → migrate code → drop old |
| Drop table | **Dangerous** | Only after all references removed and verified in production |

### Expand-Contract Pattern (Zero-Downtime)

```
Release 1 — EXPAND:
  Migration: ALTER TABLE orders ADD COLUMN status_v2 VARCHAR(50);
  Migration: UPDATE orders SET status_v2 = status;  -- backfill
  Code: Write to BOTH columns, read from new column

Release 2 — CONTRACT:
  Code: Remove all references to old column
  Migration: ALTER TABLE orders DROP COLUMN status;
  Migration: ALTER TABLE orders RENAME COLUMN status_v2 TO status;
```

```csharp
// EF Core: Generate expand migration
// dotnet ef migrations add ExpandOrderStatus --project src/MyApp.Data
public partial class ExpandOrderStatus : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("status_v2", "orders", nullable: true);
        migrationBuilder.Sql("UPDATE orders SET status_v2 = status");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn("status_v2", "orders");
    }
}
```

### Production Migration Checklist

```
Pre-Deploy:
  □ Generated idempotent SQL script: dotnet ef migrations script --idempotent
  □ Reviewed SQL for destructive operations (DROP, ALTER TYPE, RENAME)
  □ Tested migration against staging with production-like data
  □ Verified backward compatibility — old app version still works after migration
  □ Backup taken or point-in-time recovery confirmed
  □ Estimated migration duration for large tables

Deploy:
  □ Run migration BEFORE deploying new app version
  □ Health check passes after migration, before app deploy
  □ Monitor for lock contention during migration

Post-Deploy:
  □ Verify app health checks pass
  □ Spot-check migrated data
  □ Monitor error rates for 15 minutes
```

### Rollback Strategy

```bash
# EF Core: revert to a specific migration
dotnet ef database update PreviousMigrationName --project src/MyApp.Data

# Generate rollback SQL for DBA review
dotnet ef migrations script CurrentMigration PreviousMigration --idempotent -o rollback.sql

# DbUp: rollback scripts are not automatic — maintain manual rollback scripts
# migrations/rollback/
#   R003__undo_create_orders_table.sql
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| C# properties | PascalCase | `UserName`, `CreatedAt` |
| SQL aliases (Dapper) | PascalCase | `SELECT user_name AS UserName` |

## See Also

- `deploy.instructions.md` — Migration pipeline steps, Docker Compose migration patterns
- `multi-environment.instructions.md` — Per-environment migration config, auto-migrate settings
- `graphql.instructions.md` — DataLoader batch queries, N+1 prevention
- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use `.Include()` or batch queries from the start. |
| "Raw SQL is faster than EF Core here" | Raw SQL bypasses change tracking, migration safety, and parameterization. Use EF Core unless profiling proves a measurable bottleneck — then use Dapper with parameterized queries. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets a migration — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use EF Core seed data or DbUp scripts. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use `IConfiguration` with environment-specific overrides. |

---

## Warning Signs

- Queries executed inside a `foreach` loop (N+1 pattern)
- `SELECT *` used in production queries (over-fetching, schema coupling)
- Missing `[Index]` attribute on columns used in `WHERE` or `JOIN` clauses
- Connection strings hardcoded or present in source files
- No migration file corresponds to a recent model change
- `DbContext` registered as Singleton instead of Scoped (connection leaks)
