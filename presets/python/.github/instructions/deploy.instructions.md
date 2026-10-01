---
description: Python deployment patterns — Docker, uvicorn, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml'
---

# Python Deployment Patterns

## Docker

### Multi-stage Dockerfile (FastAPI)
```dockerfile
FROM python:3.14-slim AS base
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
    image: postgres:18
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
  redis:
    image: redis:8-alpine
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

## Database Migration Deployment

**Migrations MUST run before the new app version starts serving traffic.**

### Pipeline Order
```
1. Build & test ──► 2. Run migrations ──► 3. Health check ──► 4. Deploy app ──► 5. Smoke test
                         ▲                     ▲
                    Fail = abort           Fail = rollback
```

### Docker Compose (Development)
```yaml
services:
  migrate:
    build: .
    command: ["alembic", "upgrade", "head"]
    environment:
      - DATABASE_URL=postgresql+asyncpg://app:secret@db:5432/app
    depends_on:
      db:
        condition: service_healthy
  api:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully   # App starts only after migration succeeds
```

### CI/CD Pipeline Step
```bash
# Check current migration state
alembic current

# Generate SQL for review (dry-run)
alembic upgrade head --sql > migrations.sql

# Apply pending migrations
alembic upgrade head
```

- **NEVER** deploy app code before migrations complete
- **ALWAYS** have a rollback plan — see `database.instructions.md` for rollback procedures
- **ALWAYS** backup before applying migrations to production

## Graceful Shutdown

```python
import signal
import asyncio
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown — clean up resources
    await db_pool.close()
    await redis_client.close()
    logger.info("Graceful shutdown complete")

app = FastAPI(lifespan=lifespan)
```

- **ALWAYS** use FastAPI `lifespan` (not deprecated `on_event`) for startup/shutdown
- **ALWAYS** close database pools, Redis connections, and HTTP clients on shutdown
- Uvicorn handles SIGTERM gracefully — configure `--timeout-graceful-shutdown 30`

## Blue-Green / Canary Deployments

### Kubernetes Rolling Update (Default)
```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0   # Zero-downtime
```

### Canary with Traffic Splitting
```yaml
# Use a service mesh (Istio/Linkerd) or ingress controller for weighted routing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: api
            subset: stable
          weight: 90
        - destination:
            host: api
            subset: canary
          weight: 10
```

- **ALWAYS** ensure database migrations are backward-compatible for blue-green
- **ALWAYS** use health checks as deployment gates
- Roll back immediately if error rate exceeds threshold

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `dapr.instructions.md` — Dapr sidecar deployment, component configuration
- `multi-environment.instructions.md` — Per-environment configuration, migration config per env
- `observability.instructions.md` — Health checks, readiness probes
- `security.instructions.md` — Secrets management, TLS
