---
description: TypeScript deployment patterns — Docker, pnpm monorepo, CI/CD
applyTo: '**/Dockerfile,**/docker-compose*,**/*.yml,**/*.yaml,**/k8s/**'
---

# TypeScript Deployment Patterns

## Docker

### Multi-stage Dockerfile (pnpm monorepo)
```dockerfile
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @myapp/api build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

### Docker Compose
```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://app:secret@db:5432/app
    depends_on:
      - db
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "3000:3000"
  db:
    image: postgres:18
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
```

## Build Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm test -- --run` | Run tests without watch |
| `pnpm lint` | Lint all packages |
| `pnpm dev` | Start dev servers |
| `docker compose up -d` | Start all services |

## Environment Variables

```bash
# .env.example (commit this, NOT .env)
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-production
NODE_ENV=development
```

## Health Checks

```typescript
import express from 'express';

app.get('/health', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', version: process.env.npm_package_version });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: (err as Error).message });
  }
});

app.get('/ready', async (_req, res) => {
  // Check all dependencies (DB, Redis, external services)
  const checks = await Promise.allSettled([db.$queryRaw`SELECT 1`, redis.ping()]);
  const allHealthy = checks.every((c) => c.status === 'fulfilled');
  res.status(allHealthy ? 200 : 503).json({ ready: allHealthy });
});
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
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: ["npx", "prisma", "migrate", "deploy"]
    environment:
      - DATABASE_URL=postgresql://app:secret@db:5432/app
    depends_on:
      db:
        condition: service_healthy
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    depends_on:
      migrate:
        condition: service_completed_successfully   # App starts only after migration succeeds
```

### CI/CD Pipeline Step
```bash
# Check migration status
npx prisma migrate status

# Apply pending migrations (production-safe, forward-only)
npx prisma migrate deploy

# Generate client
npx prisma generate
```

- **NEVER** deploy app code before migrations complete
- **NEVER** use `prisma db push` in CI/CD — it can drop data
- **ALWAYS** have a rollback plan — see `database.instructions.md` for rollback procedures

## Graceful Shutdown

```typescript
const server = app.listen(PORT, () => console.log(`Listening on ${PORT}`));

function shutdown(signal: string) {
  console.log(`${signal} received — draining connections...`);
  server.close(() => {
    console.log('HTTP server closed');
    db.$disconnect().then(() => process.exit(0));
  });
  // Force exit after timeout
  setTimeout(() => process.exit(1), 30_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- **ALWAYS** call `server.close()` to stop accepting new connections
- **ALWAYS** disconnect database and Redis clients before exiting
- Kubernetes sends SIGTERM → waits `terminationGracePeriodSeconds` → SIGKILL

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
