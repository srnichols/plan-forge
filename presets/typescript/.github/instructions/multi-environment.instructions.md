---
description: Multi-environment configuration — Dev/staging/production settings, environment detection, config management
applyTo: '**/.env*,**/config/**'
---

# Multi-Environment Configuration (TypeScript/Node.js)

## Environment Hierarchy

| Environment | Purpose | Config Source | Detection |
|-------------|---------|---------------|-----------|
| `development` | Local dev with hot reload | `.env.development` | `NODE_ENV` |
| `staging` | Pre-production validation | `.env.staging` | `NODE_ENV` |
| `production` | Live traffic | `.env.production` | `NODE_ENV` |
| `test` | Automated tests | `.env.test` | `NODE_ENV` |

## Configuration Loading Order

```
.env                      ← Base defaults (committed, no secrets)
.env.{NODE_ENV}           ← Environment-specific overrides
.env.local                ← Local developer overrides (gitignored)
Environment variables     ← Infrastructure overrides (highest priority)
```

## Rules

- **NEVER** put secrets in `.env` files committed to git
- **NEVER** hardcode environment-specific URLs — use config per env
- **ALWAYS** validate config at startup with a schema (Zod, Joi)
- **ALWAYS** add `.env.local` and `.env.*.local` to `.gitignore`
- **ALWAYS** provide `.env.example` with all required keys (no values)

## Typed Config with Validation

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().transform(s => s.split(',')),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
```

## Per-Environment Defaults

```bash
# .env (base — committed)
PORT=3000
LOG_LEVEL=info

# .env.development
DATABASE_URL=postgresql://dev:devpass@localhost:5432/contoso_dev
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
LOG_LEVEL=debug

# .env.staging
DATABASE_URL=postgresql://staging-db:5432/contoso_staging
CORS_ORIGINS=https://staging.contoso.com
LOG_LEVEL=info

# .env.production (secrets injected at runtime, not in file)
CORS_ORIGINS=https://contoso.com,https://www.contoso.com
LOG_LEVEL=warn
```

## Environment-Conditional Code

```typescript
// ✅ Use config object
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ❌ NEVER scatter process.env checks throughout code
if (process.env.NODE_ENV === 'production') // BAD — use config
```

## Health Checks

```typescript
app.get('/healthz', (_, res) => res.json({ status: 'ok' }));
app.get('/readyz', async (_, res) => {
  const dbOk = await checkDatabase();
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk });
});
```

## Database Migrations Per Environment

| Environment | Migration Strategy | Who Runs | Approval |
|-------------|--------------------|----------|---------|
| **development** | `prisma migrate dev` (interactive) | Developer | None |
| **test** | `prisma migrate deploy` in CI | Pipeline | Auto |
| **staging** | `prisma migrate deploy` via CI/CD | Pipeline | Auto |
| **production** | `prisma migrate deploy` via CI/CD | Pipeline | Manual approval gate |

### Environment-Specific Migration Config
```bash
# .env.development — Prisma uses shadow database for dev migrations
DATABASE_URL=postgresql://dev:devpass@localhost:5432/contoso_dev
SHADOW_DATABASE_URL=postgresql://dev:devpass@localhost:5432/contoso_dev_shadow

# .env.staging — production-safe migrate deploy
DATABASE_URL=postgresql://staging-db:5432/contoso_staging

# .env.production — connection string injected at runtime
# DATABASE_URL injected via secret manager, not in .env file
```

```prisma
// prisma/schema.prisma — Prisma 7 keeps connection URLs in prisma.config.ts
datasource db {
  provider = "postgresql"
}
```

```typescript
// prisma.config.ts — shadow database for dev migrations
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL, // Dev only — optional elsewhere
  },
});
```

- **NEVER** use `prisma migrate dev` in staging or production — use `prisma migrate deploy`
- **NEVER** use `prisma db push` outside of prototyping
- **ALWAYS** use the same migration files across all environments

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `deploy.instructions.md` — Container config, health checks, migration pipeline steps
- `observability.instructions.md` — Per-environment logging and metrics
- `messaging.instructions.md` — Broker config per environment
