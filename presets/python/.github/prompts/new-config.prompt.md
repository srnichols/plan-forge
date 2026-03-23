---
description: "Scaffold Pydantic Settings configuration with environment variable loading, validation, and .env support."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold typed, validated configuration using Pydantic Settings.

## Required Pattern

### Settings Class
```python
from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

class {SectionName}Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="{SECTION_PREFIX}_",  # e.g., APP_, DB_
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    base_url: HttpUrl
    api_key: str = Field(..., min_length=1)
    timeout_seconds: int = Field(default=30, ge=1, le=300)
    retry_count: int = Field(default=3, ge=0)
```

### Grouped Settings
```python
class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env")

    env: str = Field(default="development", pattern=r"^(development|test|production)$")
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = Field(default="info", pattern=r"^(debug|info|warning|error)$")
    debug: bool = False

class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DB_", env_file=".env")

    url: str = Field(..., min_length=1)  # DATABASE_URL
    pool_size: int = Field(default=10, ge=1)
    echo: bool = False
```

### Loading with Fail-Fast
```python
from functools import lru_cache
from pydantic import ValidationError

@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    try:
        return AppSettings()
    except ValidationError as e:
        import sys
        print(f"Invalid configuration:\n{e}", file=sys.stderr)
        sys.exit(1)
```

### FastAPI Dependency
```python
from fastapi import Depends

def get_app_settings() -> AppSettings:
    return get_settings()

@router.get("/health")
async def health(settings: AppSettings = Depends(get_app_settings)):
    return {"env": settings.env}
```

### .env File Template
```bash
# .env.example — commit this, NOT .env
APP_ENV=development
APP_PORT=8000
APP_LOG_LEVEL=info
DB_URL=postgresql://user:pass@localhost:5432/mydb
DB_POOL_SIZE=10
```

## Rules

- ALWAYS validate settings at startup — fail fast on invalid config
- ALWAYS use `env_prefix` to namespace environment variables
- NEVER commit `.env` files — commit `.env.example` with empty/default values
- NEVER store secrets in code or `.env.example`
- Use `@lru_cache` to create a singleton settings instance
- Use `Depends()` for FastAPI injection — not global imports in business logic
- Use Pydantic `Field()` constraints for all numeric/string settings

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
