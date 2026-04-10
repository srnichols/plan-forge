---
description: Python testing patterns — pytest, httpx, factories, coverage
applyTo: '**/test_*,**/*_test.py,**/tests/**,**/conftest.py,**/pytest.ini,**/pyproject.toml'
---

# Python Testing Patterns

## Tech Stack

- **Test Runner**: pytest
- **API Testing**: httpx (async) or TestClient (FastAPI)
- **Mocking**: unittest.mock, pytest-mock
- **Factories**: factory_boy
- **Coverage**: pytest-cov

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single function/class | Mocked | Fast (ms) |
| **Integration** | Service + DB | Real (Docker) | Medium (1-3s) |
| **E2E** | Full API flows | Real (Docker) | Slow (5s+) |

## Patterns

### Unit Test
```python
import pytest
from unittest.mock import AsyncMock
from app.services.user_service import UserService

@pytest.mark.asyncio
async def test_get_user_returns_user():
    # Arrange
    mock_repo = AsyncMock()
    mock_repo.find_by_id.return_value = User(id="1", name="Test")
    service = UserService(repo=mock_repo)

    # Act
    result = await service.get_user("1")

    # Assert
    assert result is not None
    assert result.name == "Test"
    mock_repo.find_by_id.assert_called_once_with("1")
```

### API Integration Test (FastAPI)
```python
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_list_users():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(
            "/api/users",
            headers={"Authorization": f"Bearer {test_token}"},
        )
    
    assert response.status_code == 200
    assert isinstance(response.json(), list)
```

### Fixtures (conftest.py)
```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres():
    with PostgresContainer("postgres:16") as pg:
        yield pg

@pytest.fixture
async def db_session(postgres):
    engine = create_async_engine(postgres.get_connection_url())
    async with async_session(engine) as session:
        yield session
```

## Conventions

- Test file: `test_{module}.py` or `{module}_test.py`
- Test name: `test_{what}_{expected_result}` or `test_{what}_when_{condition}`
- Use `conftest.py` for shared fixtures
- Use `@pytest.mark.asyncio` for async tests

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `pytest --tb=short` — all pass
- [ ] `mypy .` — zero type errors
- [ ] `ruff check .` — no violations
- [ ] Anti-pattern grep: `grep -rn "type: ignore\|# noqa\|Any" --include="*.py"` — minimal hits in new files

## See Also

- `api-patterns.instructions.md` — Integration test patterns, route testing
- `database.instructions.md` — Repository testing, test databases
- `errorhandling.instructions.md` — Exception testing patterns
```

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple functions get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and can't run in CI quickly. Unit tests are the foundation of the test pyramid. |
| "This is just a dataclass — no logic to test" | Validators, default factories, and `__post_init__` are logic. Test that Pydantic models reject invalid input, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Fix the design with dependency injection — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test `None` inputs, empty lists, boundary values, and async exception paths. |

---

## Warning Signs

- A test file has fewer `def test_` functions than the module under test has public functions (coverage gap)
- Test names describe implementation (`test_calls_repository`) instead of behavior (`test_get_user_with_invalid_id_raises_not_found`)
- Tests use `time.sleep` or hardcoded delays instead of `pytest-asyncio` with proper async patterns
- No pytest markers — unable to filter fast unit tests from slow integration tests
- Fixture setup is longer than 15 lines (test is testing too much or fixture needs extraction)
- Tests directly instantiate concrete dependencies instead of using `unittest.mock` or dependency injection
