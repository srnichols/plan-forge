---
description: "Scaffold pytest test files with fixtures, async support, mock setup, and naming conventions."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files following project conventions.

## Test Naming Convention

```
test_{method}_{condition}_{expected}
```

Examples:
- `test_create_product_with_empty_name_raises_validation_error`
- `test_get_by_id_when_not_found_returns_none`
- `test_calculate_total_with_discount_returns_reduced_price`

## Unit Test Pattern (pytest)

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from src.services.{entity_name}_service import {EntityName}Service
from src.errors import NotFoundError

@pytest.fixture
def mock_repo():
    return MagicMock()

@pytest.fixture
def service(mock_repo):
    return {EntityName}Service(mock_repo)

class TestGet{EntityName}ById:
    @pytest.mark.asyncio
    async def test_returns_entity_when_found(self, service, mock_repo):
        entity = {EntityName}(id=uuid4(), name="Test")
        mock_repo.find_by_id = AsyncMock(return_value=entity)

        result = await service.get_by_id(entity.id)

        assert result == entity
        mock_repo.find_by_id.assert_called_once_with(entity.id)

    @pytest.mark.asyncio
    async def test_raises_not_found_when_missing(self, service, mock_repo):
        mock_repo.find_by_id = AsyncMock(return_value=None)

        with pytest.raises(NotFoundError):
            await service.get_by_id(uuid4())

class TestCreate{EntityName}:
    @pytest.mark.asyncio
    async def test_creates_with_valid_input(self, service, mock_repo):
        request = Create{EntityName}Request(name="New Item")
        created = {EntityName}(id=uuid4(), name="New Item")
        mock_repo.insert = AsyncMock(return_value=created)

        result = await service.create(request)

        assert result.name == "New Item"

    @pytest.mark.asyncio
    async def test_rejects_empty_name(self, service):
        with pytest.raises(ValidationError):
            Create{EntityName}Request(name="")
```

## Integration Test Pattern (Testcontainers)

```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="module")
def postgres():
    with PostgresContainer("postgres:18-alpine") as pg:
        yield pg

@pytest.fixture
async def pool(postgres):
    pool = await asyncpg.create_pool(postgres.get_connection_url())
    # Run migrations
    yield pool
    await pool.close()
```

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
