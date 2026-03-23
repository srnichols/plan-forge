---
description: "Scaffold Pydantic request/response models with validation, field constraints, and mapping from ORM entities."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Pydantic Model)

Scaffold Pydantic request and response models that separate API contracts from ORM entities.

## Required Pattern

### Response Model
```python
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID

class {EntityName}Response(BaseModel):
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}  # Enable ORM mode
```

### Create Request Model
```python
from pydantic import BaseModel, Field

class Create{EntityName}Request(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
```

### Update Request Model
```python
class Update{EntityName}Request(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
```

### Custom Validators
```python
from pydantic import field_validator

class Create{EntityName}Request(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., pattern=r"^[a-z0-9-]+$")

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()
```

### Mapping Helper
```python
def to_response(entity) -> {EntityName}Response:
    return {EntityName}Response.model_validate(entity)

# Or for lists
def to_response_list(entities: list) -> list[{EntityName}Response]:
    return [to_response(e) for e in entities]
```

## Paged Response Wrapper
```python
from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")

class PagedResult(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total_count: int

    @property
    def total_pages(self) -> int:
        return -(-self.total_count // self.page_size)  # Ceiling division

    @property
    def has_next(self) -> bool:
        return self.page < self.total_pages

    @property
    def has_previous(self) -> bool:
        return self.page > 1
```

## Rules

- NEVER return ORM models directly from endpoints — always use Pydantic response models
- ALWAYS set `model_config = {"from_attributes": True}` on response models for ORM compatibility
- Use `Field(...)` constraints for all string/number fields
- Use `@field_validator` for complex business validation rules
- Keep models in `src/models/` — one file per entity or grouped by domain
- Use `str | None` syntax (Python 3.10+) — not `Optional[str]`

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
