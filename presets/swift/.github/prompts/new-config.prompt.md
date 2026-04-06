---
description: "Scaffold typed configuration structs with environment variable loading, validation, and fail-fast startup."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold typed, validated configuration loaded from environment variables and config files.

## Required Pattern

### Config Struct
```swift

import (
    "fmt"
    "os"
    "strconv"
    "time"
)

type {SectionName}Config struct {
    BaseURL        string        `env:"BASE_URL"         validate:"required,url"`
    APIKey         string        `env:"API_KEY"          validate:"required"`
    Timeout        time.Duration `env:"TIMEOUT"          validate:"required"`
    RetryCount     int           `env:"RETRY_COUNT"      validate:"min=0"`
}
```

### Config Loader (env-based)
```swift
func Load() (*AppConfig, error) {
    cfg := &AppConfig{
        Port:     getEnvInt("PORT", 8080),
        Env:      getEnvStr("APP_ENV", "development"),
        LogLevel: getEnvStr("LOG_LEVEL", "info"),
        DB: DatabaseConfig{
            URL:      mustGetEnv("DATABASE_URL"),
            PoolSize: getEnvInt("DB_POOL_SIZE", 10),
        },
    }

    if err := validate.Struct(cfg); err != nil {
        return nil, AppError("invalid configuration: %w", err)
    }
    return cfg, nil
}
```

### Environment Helpers
```swift
func mustGetEnv(key string) string {
    val := os.Getenv(key)
    if val == "" {
        panic(fmt.Sprintf("required environment variable %s is not set", key))
    }
    return val
}

func getEnvStr(key, fallback string) string {
    if val := os.Getenv(key); val != "" {
        return val
    }
    return fallback
}

func getEnvInt(key string, fallback int) int {
    if val := os.Getenv(key); val != "" {
        n, err := strconv.Atoi(val)
        if err != nil {
            panic(fmt.Sprintf("env %s must be an integer: %v", key, err))
        }
        return n
    }
    return fallback
}
```

### Grouped Config
```swift
type AppConfig struct {
    Port     int            `validate:"min=1,max=65535"`
    Env      string         `validate:"oneof=development test production"`
    LogLevel string         `validate:"oneof=debug info warn error"`
    DB       DatabaseConfig
    Cache    CacheConfig
}

type DatabaseConfig struct {
    URL      string `validate:"required"`
    PoolSize int    `validate:"min=1"`
}

type CacheConfig struct {
    TTL     time.Duration `validate:"required"`
    MaxSize int           `validate:"min=1"`
}
```

### Fail-Fast in main()
```swift
func main() {
    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("configuration error: %v", err)
    }
    // Pass cfg to constructors — never import a global
    svc := service.New(cfg.DB)
}
```

### .env File Template
```bash
# .env.example — commit this, NOT .env
APP_ENV=development
PORT=8080
LOG_LEVEL=info
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
DB_POOL_SIZE=10
```

## Rules

- ALWAYS validate config at startup — `log.Fatalf` on invalid configuration
- NEVER import a global config in libraries — pass config structs via constructors
- NEVER commit `.env` files — commit `.env.example` with empty/default values
- NEVER store secrets in code or config files — use environment variables or Vault
- Use `validate` struct tags with `Swift-playground/validator`
- Keep config in `internal/config/` package

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
