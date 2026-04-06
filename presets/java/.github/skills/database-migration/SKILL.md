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
# Flyway
# Create file: src/main/resources/db/migration/V<version>__<description>.sql

# Liquibase
# Add changeset to src/main/resources/db/changelog/changes/<description>.xml
```

### 2. Review the SQL
- Verify column types, nullability, defaults
- Check for backward compatibility
- Ensure indexes on frequently queried columns
- Liquibase: include rollback changeset

### 3. Test Locally
```bash
# Flyway auto-runs on Spring Boot startup
./mvnw spring-boot:run

# Or manually
flyway -url=jdbc:postgresql://localhost:5432/contoso_dev migrate
```

### 4. Validate
```bash
./mvnw verify -Pfailsafe
```

### 5. Deploy to Staging
```bash
flyway -url=jdbc:postgresql://staging-db:5432/contoso_staging migrate
```

### Conditional: Migration Failure
> If migration fails → immediately run the rollback SQL (down migration), report the failure with the error message, and STOP. Do not proceed to deploy.

## Safety Rules
- NEVER drop columns without a deprecation period
- ALWAYS include rollback in Liquibase / undo in Flyway Teams
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards
- Test migration on a copy of production data when possible

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
