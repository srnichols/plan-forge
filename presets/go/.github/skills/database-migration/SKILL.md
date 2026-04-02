---
name: database-migration
description: Generate, review, test, and deploy database schema migrations. Use when adding columns, creating tables, or changing schema.
argument-hint: "[migration description, e.g. 'add user_profiles table']"
---

# Database Migration Skill

## Trigger
"Create a database migration for..." / "Add column..." / "Change schema..."

## Steps

### 1. Generate Migration
```bash
# Using golang-migrate
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
# golang-migrate
migrate -path migrations -database "postgres://localhost:5432/contoso_dev?sslmode=disable" up

# goose
goose -dir migrations postgres "postgres://localhost:5432/contoso_dev?sslmode=disable" up

# Verify
psql -h localhost -d contoso_dev -c "\d orders"
```

### 4. Validate
```bash
go test ./tests/integration/... -v -tags=integration
```

### 5. Deploy to Staging
```bash
migrate -path migrations -database "$STAGING_DB_URL" up
```

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS create both `up.sql` and `down.sql` files
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards
- ALWAYS include indexes for tenant_id and foreign keys
- Test migration on a copy of production data when possible

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
