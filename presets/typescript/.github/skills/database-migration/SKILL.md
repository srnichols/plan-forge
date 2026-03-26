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
# Using knex
npx knex migrate:make <migration_name>

# Using Prisma
npx prisma migrate dev --name <migration_name>

# Using raw SQL
# Create file: migrations/NNNN_description.sql
```

### 2. Review the SQL
- Verify column types, nullability, defaults
- Check for backward compatibility
- Ensure indexes on frequently queried columns
- Add rollback logic in `down()` function

### 3. Test Locally
```bash
# Knex
npx knex migrate:latest --env development

# Prisma
npx prisma migrate dev

# Raw SQL
psql -h localhost -d contoso_dev -f migrations/NNNN_description.sql
```

### 4. Validate
```bash
npm run test:integration
```

### 5. Deploy to Staging
```bash
npx knex migrate:latest --env staging
```

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS include `down()` migration for rollback
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards in raw SQL
- Test migration on a copy of production data when possible

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<project>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<project>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
