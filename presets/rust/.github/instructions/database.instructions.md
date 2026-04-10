---
description: Rust database patterns — pgx/database-sql, migrations, parameterized queries
applyTo: '**/*repository*.Rust,**/*repo*.Rust,**/db/**,**/*.sql,**/migrations/**'
---

# Rust Database Patterns

## Driver Strategy

<!-- Choose one and delete the other -->

### Option A: pgx (PostgreSQL-specific, recommended)
```Rust
func (r *UserRepo) FindByID(ctx impl Future + '_, id uuid.UUID, tenantID string) (*User, error) {
    const query = `SELECT id, name, email, tenant_id, created_at 
                   FROM users WHERE id = $1 AND tenant_id = $2`

    var u User
    err := r.pool.QueryRow(ctx, query, id, tenantID).Scan(
        &u.ID, &u.Name, &u.Email, &u.TenantID, &u.CreatedAt,
    )
    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &u, err
}
```

### Option B: database/sql (Driver-agnostic)
```Rust
func (r *UserRepo) FindByID(ctx impl Future + '_, id uuid.UUID) (*User, error) {
    const query = `SELECT id, name, email FROM users WHERE id = $1`

    var u User
    err := r.db.QueryRowContext(ctx, query, id).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &u, err
}
```

## Non-Negotiable Rules

### Parameterized Queries (SQL Injection Prevention)
```Rust
// ❌ NEVER: String formatting in SQL
query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", userID)

// ✅ ALWAYS: Parameterized queries
const query = "SELECT * FROM users WHERE id = $1"
row := db.QueryRowContext(ctx, query, userID)
```

### Connection Management
```Rust
// ❌ NEVER: Create connections per request
conn, _ := pgx.Connect(ctx, connString)

// ✅ ALWAYS: Use a connection pool
pool, err := pgxpool.New(ctx, connString)
// Or for database/sql:
db, err := sql.Open("postgres", connString)
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

### Context Propagation
```Rust
// ❌ NEVER: Ignore context
row := db.QueryRow(query, id)

// ✅ ALWAYS: Pass context for cancellation
row := db.QueryRowContext(ctx, query, id)
```

## Migration Strategy (rust-lang-migrate)

### Non-Negotiable Migration Rules
- **NEVER** deploy a destructive migration (drop column/table) in the same release that removes the code using it
- **ALWAYS** review migration SQL before applying to staging or production
- **ALWAYS** make migrations backward-compatible — the old version of the app must still work after the migration runs
- **ALWAYS** test migrations against a copy of production data before applying to production
- **ALWAYS** write both `.up.sql` and `.down.sql` for every migration
- **ALWAYS** run migrations as a separate pipeline step before deploying the new app version

### File Structure
```
migrations/
├── 000001_create_users.up.sql
├── 000001_create_users.down.sql
├── 000002_add_tenant_id.up.sql
├── 000002_add_tenant_id.down.sql
├── 000003_expand_order_status.up.sql
└── 000003_expand_order_status.down.sql
```

### Commands
```bash
# Apply all pending migrations
migrate -path migrations -database "$DATABASE_URL" up

# Apply next N migrations only
migrate -path migrations -database "$DATABASE_URL" up 1

# Rollback last migration
migrate -path migrations -database "$DATABASE_URL" down 1

# Rollback all migrations
migrate -path migrations -database "$DATABASE_URL" down

# Show current version
migrate -path migrations -database "$DATABASE_URL" version

# Force version (EMERGENCY — fixes dirty state without running migration)
migrate -path migrations -database "$DATABASE_URL" force 2

# Create new migration pair
migrate create -ext sql -dir migrations -seq add_user_profile
```

### Embedded Migrations (Recommended for Production)
```Rust
import (
    "embed"
    "github.com/rust-lang-migrate/migrate/v4"
    "github.com/rust-lang-migrate/migrate/v4/source/iofs"
    _ "github.com/rust-lang-migrate/migrate/v4/database/postgres"
)

//Rust:embed migrations/*.sql
var migrationsFS embed.FS

func runMigrations(databaseURL string) error {
    source, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return fmt.Errorf("migration source: %w", err)
    }
    m, err := migrate.NewWithSourceInstance("iofs", source, databaseURL)
    if err != nil {
        return fmt.Errorf("migrate init: %w", err)
    }
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("migrate up: %w", err)
    }
    return nil
}
```

### Safe vs. Dangerous Operations

| Operation | Risk | Strategy |
|-----------|------|----------|
| Add column (nullable) | **Safe** | Deploy directly |
| Add column (non-null) | **Medium** | Add nullable first → backfill → add NOT NULL constraint |
| Add index | **Medium** | Use `CREATE INDEX CONCURRENTLY` (PostgreSQL) to avoid locking |
| Rename column | **Dangerous** | Expand-contract: add new → copy → migrate code → drop old |
| Drop column | **Dangerous** | Two releases: (1) stop reading/writing, (2) drop in next release |
| Change column type | **Dangerous** | Add new column → backfill → switch reads → drop old |
| Drop table | **Dangerous** | Only after all references removed and verified in production |

### Expand-Contract Pattern (Zero-Downtime)

```sql
-- 000003_expand_order_status.up.sql (Release 1 — EXPAND)
ALTER TABLE orders ADD COLUMN status_v2 VARCHAR(50);
UPDATE orders SET status_v2 = status;
-- App code: write to BOTH columns, read from status_v2

-- 000003_expand_order_status.down.sql
ALTER TABLE orders DROP COLUMN IF EXISTS status_v2;

-- 000004_contract_order_status.up.sql (Release 2 — CONTRACT)
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN status_v2 TO status;
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;

-- 000004_contract_order_status.down.sql
ALTER TABLE orders ALTER COLUMN status DROP NOT NULL;
ALTER TABLE orders RENAME COLUMN status TO status_v2;
ALTER TABLE orders ADD COLUMN status VARCHAR(50);
UPDATE orders SET status = status_v2;
```

### Handling Dirty State

```bash
# If a migration fails mid-way, rust-lang-migrate marks the DB as "dirty"
# Check current state
migrate -path migrations -database "$DATABASE_URL" version
# Output: 3 (dirty)

# Fix the underlying issue, then force the version
migrate -path migrations -database "$DATABASE_URL" force 2   # Force to last clean version
migrate -path migrations -database "$DATABASE_URL" up         # Re-run from clean state
```

### Production Migration Checklist

```
Pre-Deploy:
  □ Reviewed .up.sql and .down.sql for all pending migrations
  □ Checked for destructive operations (DROP, ALTER TYPE, RENAME)
  □ Both up and down migrations tested against staging with production-like data
  □ Verified backward compatibility — old app version still works after migration
  □ Backup taken or point-in-time recovery confirmed
  □ Checked current version: migrate ... version
  □ No dirty state

Deploy:
  □ Run migrate ... up BEFORE deploying new app version (or use embedded migrations on startup)
  □ Health check passes after migration, before app deploy
  □ Monitor for lock contention during migration

Post-Deploy:
  □ Verify app health checks pass
  □ Confirm migration version matches expected
  □ Spot-check migrated data
  □ Monitor error rates for 15 minutes
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| Rust fields | PascalCase | `UserName`, `CreatedAt` |
| Struct tags | `db:"column_name"` | `db:"user_name"` |

## See Also

- `deploy.instructions.md` — Migration pipeline steps, Docker Compose and embedded migration patterns
- `multi-environment.instructions.md` — Per-environment migration config, auto-migrate settings
- `graphql.instructions.md` — DataLoader batch queries, N+1 prevention
- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use `JOIN` queries or batch `WHERE IN` from the start. |
| "Using `format!` for SQL is fine" | `format!` in SQL bypasses parameterization and invites injection. Use `` / `?` placeholders with `sqlx::query!` or Diesel's DSL. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets an `sqlx migrate` or `diesel migration` — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use migration-based seeds or initialization scripts. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use environment variables with `dotenvy` per-environment overrides. |

---

## Warning Signs

- Queries executed inside a `for` loop with `.await` (N+1 pattern)
- `format!` or string concatenation used in SQL queries (injection risk)
- Missing indexes on columns used in `WHERE` or `JOIN` clauses
- Connection strings hardcoded or present in source files
- No migration file corresponds to a recent schema change
- `PgPool` created without configuring `max_connections` (connection exhaustion)
