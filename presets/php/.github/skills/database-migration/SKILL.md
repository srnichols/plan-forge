---
name: database-migration
description: Generate, review, test, and deploy database schema migrations. Use when adding columns, creating tables, or changing schema.
argument-hint: "[migration description, e.g. 'add user_profiles table']"
tools: [run_in_terminal, read_file]
---

# Database Migration Skill

## Trigger
"Create a database migration for..." / "Add column..." / "Change schema..."

## Steps

### 1. Generate Migration
```bash
# Using php-migrate
migrate create -ext sql -dir migrations -seq <description>
# Creates: migrations/NNNNNN_description.up.sql and migrations/NNNNNN_description.down.sql

# Using goose
goose -dir migrations create <description> sql
# Creates: migrations/YYYYMMDDHHMMSS_description.sql
```

### 2. Write the SQL

**Up migration** (`NNNNNN_description.up.sql`):
```sql
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES users(id),
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(tenant_id, customer_id);
```

**Down migration** (`NNNNNN_description.down.sql`):
```sql
DROP TABLE IF EXISTS orders;
```

### 3. Test Locally
```bash
# php-migrate
migrate -path migrations -database "postgres://localhost:5432/contoso_dev?sslmode=disable" up

# goose
goose -dir migrations postgres "postgres://localhost:5432/contoso_dev?sslmode=disable" up

# Verify
psql -h localhost -d contoso_dev -c "\d orders"
```

### 4. Validate
```bash
PHP test ./tests/integration/... -v -tags=integration
```

### 5. Deploy to Staging
```bash
migrate -path migrations -database "$STAGING_DB_URL" up
```

### Conditional: Migration Failure
> If migration fails → immediately run the rollback SQL (down migration), report the failure with the error message, and STOP. Do not proceed to deploy.

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS create both `up.sql` and `down.sql` files
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards
- ALWAYS include indexes for tenant_id and foreign keys
- Test migration on a copy of production data when possible


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll just edit the model directly" | Skipping the migration file means no rollback path and no deployment audit trail. Schema changes must be versioned. |
| "Rollback SQL isn't needed" | Deployments fail. Without rollback, recovery means restoring from backup — minutes of downtime vs seconds. |
| "I'll seed data manually" | Manual data changes drift between environments. Seeding must be scripted and repeatable. |
| "One migration for multiple changes is simpler" | Atomic migrations enable selective rollback. Bundled changes force all-or-nothing reversals. |

## Warning Signs

- Migration file missing — schema change made directly to model/entity without a migration file
- No rollback section — up migration exists but down/revert migration is missing or empty
- Migration not tested locally — pushed to staging without verifying on dev database first
- Schema change not in PR diff — model updated but migration file not committed
- Breaking change without deprecation — column dropped or renamed without a graceful transition period

## Exit Proof

After completing this skill, confirm:
- [ ] Migration file created and committed
- [ ] `php artisan migrate` succeeds on local database
- [ ] `./vendor/bin/phpunit --testsuite Integration` passes against migrated schema
- [ ] Rollback tested — `php artisan migrate:rollback` runs cleanly
- [ ] Schema change is backward compatible (or deprecation period documented)
## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
