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

### Conditional: Migration Failure
> If migration fails → immediately run the rollback SQL (down migration), report the failure with the error message, and STOP. Do not proceed to deploy.

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS include `down()` migration for rollback
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards in raw SQL
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
- [ ] `npx knex migrate:latest / npx prisma migrate dev` succeeds on local database
- [ ] `npm run test:integration` passes against migrated schema
- [ ] Rollback tested — `npx knex migrate:rollback` runs cleanly
- [ ] Schema change is backward compatible (or deprecation period documented)
## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
