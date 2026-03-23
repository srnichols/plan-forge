---
description: "Scaffold a new database entity end-to-end: Alembic migration, SQLAlchemy/raw SQL model, repository, service, FastAPI router, and tests."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Database Entity

Scaffold a complete entity from database to API following the layered architecture.

## Required Steps

1. **Create Alembic migration**:
   ```bash
   alembic revision --autogenerate -m "add_{entity_name}_table"
   ```
   Or manual migration at `alembic/versions/YYYYMMDD_add_{entity_name}.py`:
   ```python
   """add {entity_name} table

   Revision ID: xxxxxxxxxxxx
   """
   from alembic import op
   import sqlalchemy as sa

   def upgrade() -> None:
       op.create_table(
           '{entity_name}s',
           sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()')),
           sa.Column('name', sa.String(255), nullable=False),
           sa.Column('description', sa.Text(), nullable=True),
           sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
           sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
       )
       op.create_index('ix_{entity_name}s_name', '{entity_name}s', ['name'])

   def downgrade() -> None:
       op.drop_index('ix_{entity_name}s_name')
       op.drop_table('{entity_name}s')
   ```

2. **Create SQLAlchemy model** (if using ORM) at `src/models/{entity_name}_orm.py`:
   ```python
   from sqlalchemy import String, Text
   from sqlalchemy.orm import Mapped, mapped_column
   from src.models.base import Base, TimestampMixin, UUIDMixin

   class {EntityName}(UUIDMixin, TimestampMixin, Base):
       __tablename__ = "{entity_name}s"

       name: Mapped[str] = mapped_column(String(255), nullable=False)
       description: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

3. **Create Pydantic model** at `src/models/{entity_name}.py`:
   ```python
   from pydantic import BaseModel, Field
   from uuid import UUID
   from datetime import datetime

   class {EntityName}Response(BaseModel):
       id: UUID
       name: str
       description: str | None
       created_at: datetime
       updated_at: datetime

       model_config = {"from_attributes": True}

   class Create{EntityName}Request(BaseModel):
       name: str = Field(..., min_length=1, max_length=255)
       description: str | None = Field(None, max_length=2000)

   class Update{EntityName}Request(BaseModel):
       name: str = Field(..., min_length=1, max_length=255)
       description: str | None = Field(None, max_length=2000)
   ```

3. **Create repository** at `src/repositories/{entity_name}_repository.py`
4. **Create service** at `src/services/{entity_name}_service.py`
5. **Create router** at `src/routes/{entity_name}_routes.py`
6. **Create tests** at `tests/test_{entity_name}.py`

## Alembic Configuration Tips

```ini
# alembic.ini — use env var for connection string
sqlalchemy.url = %(DB_URL)s
```

```python
# alembic/env.py — configure target_metadata for autogenerate
from src.models.base import Base
target_metadata = Base.metadata
```

```bash
# Common Alembic commands
alembic upgrade head          # Apply all migrations
alembic downgrade -1          # Roll back one migration
alembic history               # Show migration history
alembic current               # Show current revision
```

## Example — Contoso Product

```python
# Repository
class ProductRepository:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def find_by_id(self, id: UUID) -> Product | None:
        row = await self._pool.fetchrow(
            "SELECT id, name, created_at, updated_at FROM products WHERE id = $1", id
        )
        return Product(**row) if row else None

# Service
class ProductService:
    def __init__(self, repo: ProductRepository):
        self._repo = repo

    async def get_by_id(self, id: UUID) -> Product:
        product = await self._repo.find_by_id(id)
        if not product:
            raise NotFoundError(f"Product {id} not found")
        return product

# Router
router = APIRouter(prefix="/products", tags=["products"])

@router.get("/{id}", response_model=Product)
async def get_product(id: UUID, service: ProductService = Depends(get_product_service)):
    return await service.get_by_id(id)
```

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
