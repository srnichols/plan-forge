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
# If using EF Core
dotnet ef migrations add <MigrationName> --project src/Infrastructure

# If using raw SQL (Dapper projects)
# Create file: Database/migrations/NNNN_description.sql
```

### 2. Review the SQL
- Verify column types, nullability, defaults
- Check for backward compatibility
- Ensure indexes on frequently queried columns
- Add rollback section (`-- DOWN:`)

### 3. Test Locally
```bash
# Apply to local database
dotnet ef database update --project src/Infrastructure

# Or for raw SQL
psql -h localhost -d contoso_dev -f Database/migrations/NNNN_description.sql
```

### 4. Validate
```bash
# Run integration tests against migrated database
dotnet test --filter "Category=Integration"
```

### 5. Deploy to Staging
```bash
# Apply migration to staging
psql -h staging-db -d contoso_staging -f Database/migrations/NNNN_description.sql
```

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards
- ALWAYS include rollback SQL
- Test migration on a copy of production data when possible

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<project>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<project>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
