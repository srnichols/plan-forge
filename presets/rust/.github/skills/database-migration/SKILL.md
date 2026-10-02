---
name: database-migration
description: Generate, review, test, and deploy SQLx/PostgreSQL schema migrations for Rust services.
argument-hint: "[migration description, e.g. 'add order_status_v2 column']"
tools: [run_in_terminal, read_file]
---

# Database Migration Skill

## Trigger

"Create a database migration for..." / "Add column..." / "Change schema..." /
"Prepare a SQLx migration..."

## Steps

### 1. Generate Migration

```bash
sqlx migrate add -r "<description>"
```

This creates paired `.up.sql` and `.down.sql` files under `migrations/`.
Use one schema concern per migration so rollback stays selective.

### 2. Write Safe Forward SQL

- Add nullable columns before backfills and constraints.
- Use `CREATE INDEX CONCURRENTLY` for large PostgreSQL tables.
- Prefer expand-contract changes for renames and type changes.
- Include `tenant_id` columns and indexes for tenant-scoped tables.

### 3. Write Reverse SQL

- Make the `.down.sql` reverse only this migration.
- Use `IF EXISTS` / `IF NOT EXISTS` guards where PostgreSQL supports them.
- For destructive forward changes, document why rollback preserves data or why a restore is required.

### 4. Review Lock and Compatibility Risk

Check both application versions:

- Old binary can run after the migration.
- New binary can run before contract cleanup.
- Queries and caches tolerate nullable expand columns.
- Background workers know the same tenant and schema assumptions.

### 5. Test Locally

```bash
sqlx migrate run
sqlx migrate info
cargo sqlx prepare --check
```

If the project uses SQLx macros, run with the same `DATABASE_URL` that the
application uses and commit updated `.sqlx/` metadata.

### 6. Validate Rust Code

```bash
cargo build --locked
cargo nextest run
cargo clippy --all-targets --all-features -- -D warnings
```

Run the repository tests that exercise the changed schema, especially
`#[sqlx::test]` coverage for tenant isolation and rollback behavior.

### 7. Deploy to Staging

```bash
sqlx migrate run
cargo nextest run
```

Confirm the app starts with `SQLX_OFFLINE=true` and no runtime schema mismatch.

### Conditional: Migration Failure

> If migration fails, stop the deploy, capture the failing SQL and PostgreSQL
> error, run the matching down migration or an approved rollback script, and do
> not route traffic to a binary that expects the failed schema.

## Safety Rules

- NEVER drop or rename a column in the same release that stops using it.
- ALWAYS provide a reverse migration unless the release plan documents an approved irreversible operation.
- ALWAYS bind tenant columns and create tenant-aware indexes for tenant-owned data.
- NEVER edit a migration that has already run outside your local scratch database; create a new migration.
- ALWAYS run `cargo sqlx prepare --check` after changing SQLx macro queries.
- NEVER put seed data or credentials into migrations unless the data is non-secret reference data.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|---------------|
| "The down file can be empty" | Failed deploys need a deterministic rollback path, not a database restore. |
| "A rename is harmless" | Old binaries still read the old column; use expand-contract over two releases. |
| "I'll backfill in one UPDATE" | Large tables can lock or saturate replication; batch long backfills. |
| "SQLx will catch everything later" | SQLx checks query shape, not rollout safety or lock duration. |

## Warning Signs

- Migration includes `DROP`, `ALTER TYPE`, or `RENAME` without a staged rollout.
- Repository code changed but no migration appears in the diff.
- `.sqlx/` metadata is stale after adding `query!` or `query_as!`.
- A new table lacks `tenant_id` even though it stores tenant-owned records.
- Tests only run against an empty database.

## Exit Proof

After completing this skill, confirm:

- [ ] Migration pair created under `migrations/`.
- [ ] `sqlx migrate run` succeeds on a local PostgreSQL database.
- [ ] `cargo sqlx prepare --check` passes or the project does not use SQLx macros.
- [ ] `cargo nextest run` or targeted repository tests pass.
- [ ] Rollback path was tested with `sqlx migrate revert` or an approved manual script.
- [ ] Schema change is backward compatible, or the deprecation window is documented.

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("rust sqlx database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior SQLx migration naming, lock-risk lessons, and rollback decisions.
- **After migration succeeds**: `capture_thought("Rust SQLx migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future agents.
