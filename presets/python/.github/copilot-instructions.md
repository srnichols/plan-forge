# Instructions for Copilot — Python Project

> **Stack**: Python / FastAPI / PostgreSQL  
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Route → Service → Repository
3. **Best Practices Over Speed** — Enterprise-grade, not hacky
4. **TDD for Business Logic** — Red-Green-Refactor
5. **Type Safety** — No `Any` types, use strict mypy

### Red Flags
```
❌ "type: ignore"        → STOP, fix the type error
❌ "# noqa"              → STOP, fix the lint violation
❌ "bare except"         → STOP, catch specific exceptions
❌ "we'll refactor later" → STOP, do it right now
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- Framework: FastAPI 0.142 / Python 3.14+
- Database: PostgreSQL 18 + SQLAlchemy 2.1 / Alembic
- Cache: Redis 8
- Testing: pytest 9.1, httpx, pytest-asyncio, testcontainers 4.15
- Package Manager: uv 0.12 (recommended) or pip
- Type Checking: mypy 2.3 (strict)
- Linting: Ruff 0.16

---

## Coding Standards

### Python Style
- **Type hints**: Required on all function signatures
- **Pydantic 2.13 models**: For all request/response schemas
- **Async**: All I/O operations must be async
- **No bare except**: Always catch specific exceptions
- **Dataclasses**: For internal DTOs, Pydantic for API boundaries

### API Layer (FastAPI)
```python
@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    request: CreateUserRequest,
    service: UserService = Depends(get_user_service),
) -> UserResponse:
    return await service.create_user(request)
```

### Database (SQLAlchemy)
```python
# Async session with proper lifecycle
async with async_session() as session:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
```

### Testing
- **pytest** for all test types
- **httpx.AsyncClient** for API tests
- **testcontainers** for real database integration tests
- **factory_boy** for test fixtures

---

## Quick Commands

```bash
uv sync                         # Install dependencies
uvicorn src.main:app --reload   # Start dev server
pytest --tb=short               # Run all tests
mypy .                          # Type checking
ruff check .                    # Lint
ruff format .                   # Format
alembic upgrade head            # Apply migrations
docker compose up -d            # Start infrastructure
```

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Instructions**: `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `architecture-principles.instructions.md` | Core architecture rules |
| `database.instructions.md` | SQLAlchemy, Alembic patterns |
| `testing.instructions.md` | pytest, httpx, factories |
| `security.instructions.md` | Auth, Pydantic, secrets |
| `deploy.instructions.md` | Docker, uvicorn |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

- [ ] Type hints on all functions
- [ ] No `Any` types (use `Unknown` + type guards if needed)
- [ ] Pydantic validation on all API inputs
- [ ] Specific exception handling (no bare except)
- [ ] Async/await for all I/O
- [ ] Tests included for new features
- [ ] mypy passes with no errors
