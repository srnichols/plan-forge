---
description: "Scaffold typed configuration loading from environment variables with validation using Zod."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold typed, validated configuration loaded from environment variables.

## Required Pattern

### Config Schema (Zod)
```typescript
import { z } from 'zod';

const {sectionName}Schema = z.object({
  BASE_URL: z.string().url(),
  API_KEY: z.string().min(1, 'API_KEY is required'),
  TIMEOUT_MS: z.coerce.number().int().min(100).default(30_000),
  RETRY_COUNT: z.coerce.number().int().min(0).default(3),
});

type {SectionName}Config = z.infer<typeof {sectionName}Schema>;
```

### Config Loader
```typescript
import 'dotenv/config';

function loadConfig(): {SectionName}Config {
  const result = {sectionName}Schema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.flatten().fieldErrors);
    process.exit(1);  // Fail fast
  }
  return result.data;
}

export const config = loadConfig();
```

### Grouped Config (Multiple Sections)
```typescript
const appConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const dbConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().int().min(1).default(10),
});

const fullConfigSchema = appConfigSchema.merge(dbConfigSchema);

export type AppConfig = z.infer<typeof fullConfigSchema>;
export const config: AppConfig = loadConfig(fullConfigSchema);
```

### .env File Template
```bash
# .env.example — commit this, NOT .env
BASE_URL=https://api.example.com
API_KEY=
TIMEOUT_MS=30000
RETRY_COUNT=3
```

### Dependency Injection
```typescript
// Pass config to constructors — don't import the global singleton in libraries
export class MyService {
  constructor(private readonly config: {SectionName}Config) {}
}
```

## Rules

- ALWAYS validate config at startup with Zod — fail fast on invalid config
- ALWAYS use `z.coerce.number()` for env vars (they're always strings)
- NEVER commit `.env` files — commit `.env.example` with empty/default values
- NEVER store secrets in code or `.env.example`
- Use `safeParse` — never `parse` — to get structured errors
- Prefer constructor injection of config objects over importing globals

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
