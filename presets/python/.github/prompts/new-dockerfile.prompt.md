---
description: "Scaffold a multi-stage Dockerfile for Python with UV/pip, non-root user, and optimized layer caching."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold a production-grade multi-stage Dockerfile for a Python/FastAPI application.

## Required Pattern

### Multi-Stage Dockerfile
```dockerfile
# ---- Build Stage ----
FROM python:3.12-slim AS build
WORKDIR /app

# Install build-time dependencies
RUN pip install --no-cache-dir --upgrade pip

# Copy requirements first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Runtime Stage ----
FROM python:3.12-slim AS runtime
WORKDIR /app

# Security: run as non-root
RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /sbin/nologin appuser

# Copy installed packages from build stage
COPY --from=build /install /usr/local

# Copy application code
COPY src/ src/
COPY alembic/ alembic/
COPY alembic.ini ./

# Switch to non-root user
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

### With UV (Fast Package Manager)
```dockerfile
FROM python:3.12-slim AS build
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-editable

COPY src/ src/

FROM python:3.12-slim AS runtime
WORKDIR /app

RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /sbin/nologin appuser

COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src /app/src
ENV PATH="/app/.venv/bin:$PATH"

USER appuser
EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

### .dockerignore
```
__pycache__/
*.pyc
.venv/
.env
.env.*
*.md
.git/
.gitignore
.vscode/
.pytest_cache/
htmlcov/
Dockerfile*
.dockerignore
```

### Docker Compose (Development)
```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - APP_ENV=development
      - DB_URL=postgresql://postgres:postgres@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

## Rules

- ALWAYS use multi-stage builds — install dependencies in build stage, copy to runtime
- ALWAYS use slim images (`python:3.12-slim`) — not full or Alpine (musl issues)
- ALWAYS run as a non-root user in production
- ALWAYS copy `requirements.txt`/`pyproject.toml` first for layer caching
- ALWAYS use `--no-cache-dir` with pip to reduce image size
- ALWAYS include a HEALTHCHECK instruction
- ALWAYS create a `.dockerignore` to exclude `.venv`, `__pycache__`, `.env`
- NEVER store secrets in the image — use environment variables or mounted secrets
- Use multiple Uvicorn workers in production (`--workers 4`)

## Reference Files

- [Deploy patterns](../instructions/deploy-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
