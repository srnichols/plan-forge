---
description: Python deployment patterns — Docker, uvicorn, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml'
---

# Python Deployment Patterns

## Docker

### Multi-stage Dockerfile (FastAPI)
```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

FROM base AS build
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src ./src
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Docker Compose
```yaml
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://app:secret@db:5432/app
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## Build Commands

| Command | Purpose |
|---------|---------|
| `uv sync` | Install dependencies |
| `uvicorn src.main:app --reload` | Dev server |
| `pytest --tb=short` | Run tests |
| `mypy .` | Type checking |
| `ruff check .` | Linting |
| `ruff format .` | Code formatting |
| `alembic upgrade head` | Apply DB migrations |
| `docker compose up -d` | Start infrastructure |

## Environment Variables

```bash
# .env.example (commit this, NOT .env)
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-production
DEBUG=false
```

## Health Check

```python
@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.app_version}
```

## See Also

- `multi-environment.instructions.md` — Per-environment configuration
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
```
