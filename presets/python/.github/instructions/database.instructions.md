---
description: Python database patterns — SQLAlchemy, Alembic, async drivers
applyTo: '**/models/**,**/repositories/**,**/alembic/**,**/*.sql'
---

# Python Database Patterns

## ORM Strategy

### Option A: SQLAlchemy + Alembic (Recommended)

```python
from sqlalchemy import Column, String, DateTime
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

### Option B: Raw SQL (asyncpg)
```python
# ❌ NEVER: String formatting in SQL
result = await conn.fetch(f"SELECT * FROM users WHERE id = '{user_id}'")

# ✅ ALWAYS: Parameterized queries
result = await conn.fetch("SELECT * FROM users WHERE id = $1", user_id)
```

## Non-Negotiable Rules

### No SQL Injection
```python
# ❌ NEVER: f-strings or .format() in queries
query = f"SELECT * FROM users WHERE email = '{email}'"

# ✅ ALWAYS: ORM or parameterized queries
user = await session.execute(select(User).where(User.email == email))
```

### Typed Results
```python
# ❌ NEVER: Untyped dictionaries
def get_user(user_id: str) -> dict: ...

# ✅ ALWAYS: Pydantic models or typed dataclasses
def get_user(user_id: str) -> UserResponse: ...
```

## Migration Strategy (Alembic)

### Non-Negotiable Migration Rules
- **NEVER** deploy a destructive migration (drop column/table) in the same release that removes the code using it
- **ALWAYS** review generated migration files — autogenerate can miss or misinterpret changes
- **ALWAYS** make migrations backward-compatible — the old version of the app must still work after the migration runs
- **ALWAYS** test migrations against a copy of production data before applying to production
- **ALWAYS** run migrations as a separate pipeline step before deploying the new app version
- **ALWAYS** include both `upgrade()` and `downgrade()` — never leave `downgrade()` as `pass`

### Commands
```bash
# Create migration (review the generated file — autogenerate is not perfect)
alembic revision --autogenerate -m "add user profile table"

# Apply all pending migrations
alembic upgrade head

# Apply to a specific revision
alembic upgrade +1        # Next migration only
alembic upgrade abc123    # To a specific revision

# Rollback
alembic downgrade -1      # One step back
alembic downgrade base    # Revert all migrations

# Show current state
alembic current           # Current revision
alembic history           # Full migration history

# Generate SQL without applying (dry-run for DBA review)
alembic upgrade head --sql > migrations.sql
```

### Safe vs. Dangerous Operations

| Operation | Risk | Strategy |
|-----------|------|----------|
| Add column (nullable) | **Safe** | Deploy directly |
| Add column (non-null) | **Medium** | Add nullable first → backfill → add `server_default` or NOT NULL |
| Add index | **Medium** | Use `op.create_index(concurrently=True)` with `postgresql_concurrently` |
| Rename column | **Dangerous** | Expand-contract: add new → copy → migrate code → drop old |
| Drop column | **Dangerous** | Two releases: (1) stop reading/writing, (2) drop in next release |
| Change column type | **Dangerous** | Add new column → backfill → switch reads → drop old |
| Drop table | **Dangerous** | Only after all references removed and verified in production |

### Expand-Contract Pattern (Zero-Downtime)

```python
# migrations/versions/001_expand_order_status.py
def upgrade():
    op.add_column("orders", sa.Column("status_v2", sa.String(50), nullable=True))
    op.execute("UPDATE orders SET status_v2 = status")

def downgrade():
    op.drop_column("orders", "status_v2")

# Release 1: Write to BOTH columns, read from new column
# Release 2: Drop old column after code fully migrated

# migrations/versions/002_contract_order_status.py
def upgrade():
    op.drop_column("orders", "status")
    op.alter_column("orders", "status_v2", new_column_name="status")

def downgrade():
    op.alter_column("orders", "status", new_column_name="status_v2")
    op.add_column("orders", sa.Column("status", sa.String(50)))
```

### Production Migration Checklist

```
Pre-Deploy:
  □ Generated SQL preview: alembic upgrade head --sql > migrations.sql
  □ Reviewed SQL for destructive operations (DROP, ALTER TYPE, RENAME)
  □ Both upgrade() and downgrade() are implemented
  □ Tested migration against staging with production-like data
  □ Verified backward compatibility — old app version still works after migration
  □ Backup taken or point-in-time recovery confirmed
  □ Checked current state: alembic current

Deploy:
  □ Run alembic upgrade head BEFORE deploying new app version
  □ Health check passes after migration, before app deploy
  □ Monitor for lock contention during migration

Post-Deploy:
  □ Verify app health checks pass
  □ Confirm alembic current matches expected revision
  □ Spot-check migrated data
  □ Monitor error rates for 15 minutes
```

### Rollback Strategy

```bash
# Revert last migration
alembic downgrade -1

# Revert to specific revision
alembic downgrade abc123

# Skip a broken migration (marks as applied without running — EMERGENCY ONLY)
alembic stamp abc123
```

## Async Database Sessions

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

engine = create_async_engine(settings.database_url)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with async_session() as session:
        yield session
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| Python model fields | snake_case | `user_name`, `created_at` |
| Pydantic response fields | snake_case (or camelCase alias) | Configurable |

## See Also

- `deploy.instructions.md` — Migration pipeline steps, Docker Compose migration patterns
- `multi-environment.instructions.md` — Per-environment migration config, Alembic settings
- `graphql.instructions.md` — DataLoader batch queries, N+1 prevention
- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use `joinedload()` / `selectinload()` or `prefetch_related()` from the start. |
| "Raw SQL is faster than the ORM here" | Raw SQL bypasses model validation, migration tracking, and parameterization. Use SQLAlchemy/Django ORM unless profiling proves a measurable bottleneck — then use `text()` with bound parameters. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets a migration — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use fixtures, factories, or migration-based seeds. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use environment variables with per-environment overrides. |

---

## Warning Signs

- Queries executed inside a `for` loop (N+1 pattern)
- `SELECT *` or `.all()` without limiting fields (over-fetching, schema coupling)
- Missing `db_index=True` or `Index` on columns used in `filter()` or join clauses
- Connection strings hardcoded or present in source files
- No migration file corresponds to a recent model change
- `engine` created without connection pool configuration (`pool_size`, `max_overflow`)
