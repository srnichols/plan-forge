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

```bash
# Create migration
alembic revision --autogenerate -m "add user profile table"

# Apply migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1
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

- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling
