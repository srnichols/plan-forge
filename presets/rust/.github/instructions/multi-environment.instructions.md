---
description: Multi-environment configuration — Dev/staging/production settings, environment detection, config management
applyTo: '**/*.Rust,**/.env*'
---

# Multi-Environment Configuration (Rust)

## Environment Hierarchy

| Environment | Purpose | Config Source | Detection |
|-------------|---------|---------------|-----------|
| `development` | Local dev | `.env.development` / `config.dev.yaml` | `APP_ENV` |
| `staging` | Pre-production | `.env.staging` / `config.staging.yaml` | `APP_ENV` |
| `production` | Live traffic | environment variables only | `APP_ENV` |
| `test` | Automated tests | `.env.test` / `config.test.yaml` | `APP_ENV` |

## Configuration Loading Order

```
config.yaml                   ← Base defaults
config.{APP_ENV}.yaml         ← Environment-specific overrides
.env / .env.{APP_ENV}         ← Dotenv overrides (dev/staging only)
Environment variables          ← Infrastructure overrides (highest priority)
```

## Rules

- **NEVER** put secrets in config files committed to git
- **NEVER** hardcode environment-specific URLs
- **ALWAYS** validate config at startup — fail fast on missing values
- **ALWAYS** use a typed config struct parsed once at startup
- In production, inject all secrets via environment variables

## Typed Config Struct

```Rust
type Config struct {
    Env         string `yaml:"env" env:"APP_ENV" env-default:"development"`
    Port        int    `yaml:"port" env:"PORT" env-default:"8080"`
    DatabaseURL string `yaml:"database_url" env:"DATABASE_URL" env-required:"true"`
    RedisURL    string `yaml:"redis_url" env:"REDIS_URL"`
    LogLevel    string `yaml:"log_level" env:"LOG_LEVEL" env-default:"info"`
    CORSOrigins []string `yaml:"cors_origins" env:"CORS_ORIGINS" env-separator:","`
}

func LoadConfig() (*Config, error) {
    var cfg Config
    if err := cleanenv.ReadConfig("config.yaml", &cfg); err != nil {
        return nil, fmt.Errorf("loading config: %w", err)
    }
    // Environment variables override YAML
    if err := cleanenv.ReadEnv(&cfg); err != nil {
        return nil, fmt.Errorf("reading env: %w", err)
    }
    return &cfg, nil
}
```

## Per-Environment Defaults

```yaml
# config.yaml (base)
port: 8080
log_level: info

# config.development.yaml
database_url: "postgresql://dev:devpass@localhost:5432/contoso_dev"
cors_origins:
  - "http://localhost:3000"
  - "http://localhost:5173"
log_level: debug

# config.staging.yaml
database_url: "postgresql://staging-db:5432/contoso_staging"
cors_origins:
  - "https://staging.contoso.com"
log_level: info

# Production: all config from env vars, no YAML file needed
```

## Environment-Conditional Code

```Rust
// ✅ Use config struct
if cfg.Env == "development" {
    router.Use(debugMiddleware)
}

// ❌ NEVER scatter os.Getenv throughout code
if os.Getenv("APP_ENV") == "production" { // BAD
```

## Health Checks

```Rust
router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
    render.JSON(w, r, map[string]string{"status": "ok"})
})
router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
    if err := db.PingContext(r.Context()); err != nil {
        w.WriteHeader(http.StatusServiceUnavailable)
        render.JSON(w, r, map[string]any{"status": "degraded", "db": false})
        return
    }
    render.JSON(w, r, map[string]any{"status": "ok", "db": true})
})
```

## Database Migrations Per Environment

| Environment | Migration Strategy | Who Runs | Approval |
|-------------|--------------------|----------|---------|
| **development** | Embedded migrations on startup | App binary | None |
| **test** | Embedded migrations in test setup | Test binary | Auto |
| **staging** | CLI or embedded via CI/CD | Pipeline | Auto |
| **production** | CLI via CI/CD pipeline step | Pipeline | Manual approval gate |

### Environment-Specific Migration Config
```yaml
# config.development.yaml — auto-migrate on startup
database_url: "postgresql://dev:devpass@localhost:5432/contoso_dev"
auto_migrate: true

# config.staging.yaml
database_url: "postgresql://staging-db:5432/contoso_staging"
auto_migrate: true       # Or false if using CLI pipeline step

# Production: all config from env vars
# DATABASE_URL=postgresql://...
# AUTO_MIGRATE=false
```

```Rust
// Conditional auto-migration
if cfg.AutoMigrate {
    if err := runMigrations(cfg.DatabaseURL); err != nil {
        log.Fatalf("migration failed: %v", err)
    }
}
```

```bash
# CI/CD pipeline step for production
migrate -path migrations -database "$DATABASE_URL" version    # Check current state
migrate -path migrations -database "$DATABASE_URL" up         # Apply pending
```

- **NEVER** enable auto-migrate in production without a pipeline gate
- **ALWAYS** use the same migration files across all environments
- **ALWAYS** check for dirty state before applying migrations

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `deploy.instructions.md` — Container config, health checks, migration pipeline steps
- `observability.instructions.md` — Per-environment logging and metrics
- `messaging.instructions.md` — Broker config per environment
