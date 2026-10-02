---
name: database-migration
description: Generate, review, test, and deploy Laravel database migrations. Use when adding columns, creating tables, changing indexes, or backfilling data.
argument-hint: "[migration description, e.g. 'add user_profiles table']"
tools: [run_in_terminal, read_file]
---

# Database Migration Skill

## Trigger

"Create a database migration for..." / "Add column..." / "Change schema..." / "Backfill..." / "Add index..."

## Steps

### 1. Generate Migration

```bash
php artisan make:migration "<description>"
```

For a new tenant-scoped table, include a UUID primary key, `tenant_id`, timestamps with timezone, and indexes for tenant filters plus cursor ordering.

### 2. Review the PHP Migration

- Verify `up()` and `down()` are both implemented.
- Check column types, nullability, defaults, unique constraints, and foreign-key actions.
- Identify destructive operations: `drop`, `rename`, type changes, and non-null additions.
- For PostgreSQL production indexes on large tables, consider concurrent index SQL outside a transaction.
- Confirm the migration remains backward-compatible with the currently deployed application.

### 3. Preview SQL

```bash
php artisan migrate --pretend
php artisan migrate:status
```

Inspect generated SQL before applying it. If the preview contains an unexpected table scan, exclusive lock, destructive operation, or missing index, stop and revise the migration.

### 4. Test Locally

```bash
php artisan migrate
php artisan test --filter Migration
```

When the migration changes repository behavior, also run the focused repository or API tests that touch the schema.

### 5. Validate Quality

```bash
vendor/bin/phpstan analyse
vendor/bin/pint --test
```

Use Larastan at the project level configured by the repository. Do not lower the analysis level to pass a migration.

### Conditional: Backfill Required

Use `chunkById()` or queued jobs for large backfills. Never load every model with `all()`, and do not wrap a full-table backfill in one long transaction unless the table is known to be small.

### Conditional: Migration Failure

If migration fails, immediately run the `down()` path or the approved rollback SQL, capture the exact error, and stop. Do not continue to application deployment with a partially migrated schema.

### 6. Deploy to Staging

```bash
php artisan down --render=errors::503
php artisan migrate --force
php artisan up
php artisan migrate:status
```

Use maintenance mode only when the operation is not backward-compatible or when the runbook requires it. Backward-compatible expand migrations can run before application deployment without maintenance mode.

## Safety Rules

- NEVER drop or rename a column in the same release that removes the code using it.
- ALWAYS keep `down()` accurate for reversible development and staging rollback.
- ALWAYS use expand-contract for required columns, renames, and type changes.
- NEVER read tenant ids from client headers during a backfill; use persisted tenant columns.
- ALWAYS preview SQL with `php artisan migrate --pretend`.
- ALWAYS test repository behavior with `RefreshDatabase` when the schema supports a repository.
- NEVER seed production data manually; script repeatable changes.
- ALWAYS verify indexes for tenant filters, joins, and cursor pagination order.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll edit the model and skip the migration." | Other environments, CI, and deployment cannot reproduce the schema. |
| "The `down()` method is only for local work." | Staging rollbacks and failed deploy rehearsals depend on it. |
| "One migration can do expand, code switch, and drop." | Rolling deploys can run old and new code against the same database. |
| "A full-table update is fine in `up()`." | Large tables can lock, time out, and block production traffic. |

## Warning Signs

- Model `$fillable` or `casts()` changed with no matching migration.
- Migration uses `dropColumn`, `renameColumn`, or required column addition without a two-release plan.
- `php artisan migrate --pretend` was not reviewed.
- Backfill code uses `all()` or `get()` without chunking.
- New API list endpoint lacks an index that matches tenant filter and sort order.

## Exit Proof

After completing this skill, confirm:

- [ ] Migration file created and reviewed.
- [ ] `php artisan migrate --pretend` output inspected.
- [ ] `php artisan migrate` succeeds locally.
- [ ] Focused tests pass against the migrated schema.
- [ ] `vendor/bin/phpstan analyse` and `vendor/bin/pint --test` pass or failures are reported.
- [ ] Rollback path is known and tested when risk is medium or higher.
- [ ] Schema change is backward-compatible or the downtime window is explicitly approved.

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("Laravel database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")`.
- **After migration succeeds**: `capture_thought("Laravel migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")`.
