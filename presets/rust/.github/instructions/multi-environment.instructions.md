---
description: Multi-environment configuration — Dev/staging/production settings, env loading, health checks, migrations
applyTo: '**/.env*,**/config/**/*.toml,**/src/config.rs,**/src/main.rs,**/docker-compose*.yml'
---

# Multi-Environment Configuration (Rust/Axum)

## Environment Hierarchy

| Environment | Purpose | Config Source | Detection |
|-------------|---------|---------------|-----------|
| `development` | Local development | `.env` plus `config/development.toml` | `APP_ENVIRONMENT` |
| `production` | Live traffic | Secret manager and platform env vars | `APP_ENVIRONMENT` |
| `test` | Automated tests | Test harness env vars | `APP_ENVIRONMENT` |

## Configuration Loading Order

```
config/default.toml       ← Base non-secret defaults, committed
config/{APP_ENVIRONMENT}.toml ← Optional environment override, committed when non-secret
.env                      ← Local developer convenience, gitignored
APP_* / APP_*__* env vars ← Runtime source of truth
```

## Rules

- Never commit secrets in `.env`, TOML, YAML, Rust source, or test fixtures.
- Validate settings at startup and exit before binding a listener if config is invalid.
- Use one typed `Settings` struct; do not scatter `std::env::var` across the codebase.
- Secrets use `secrecy::SecretString` and are not formatted with `Debug` or `Display`.
- Keep `.env.example` complete enough for operators to discover required keys.
- Infrastructure environment variables override local files.

## Typed Configuration

```rust
use secrecy::SecretString;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub environment: Environment,
    pub server: ServerSettings,
    pub database: DatabaseSettings,
    pub auth: AuthSettings,
    pub api_token: Option<SecretString>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Development,
    Test,
    Production,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSettings {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseSettings {
    pub url: SecretString,
    pub max_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSettings {
    pub issuer: String,
    pub audience: String,
    pub jwks_url: String,
}
```

## Loading with Fail-Fast

```rust
impl Settings {
    pub fn load() -> Result<Self, config::ConfigError> {
        dotenvy::dotenv().ok();
        let environment = std::env::var("APP_ENVIRONMENT").unwrap_or_else(|_| "development".to_owned());
        config::Config::builder()
            .add_source(config::File::with_name("config/default"))
            .add_source(config::File::with_name(&format!("config/{environment}")).required(false))
            .add_source(
                config::Environment::with_prefix("APP")
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?
            .try_deserialize()
    }
}
```

## Per-Environment Defaults

```toml
# config/default.toml
environment = "development"

[server]
host = "0.0.0.0"
port = 8080

[database]
max_connections = 10

[auth]
issuer = "https://issuer.example.com"
audience = "contoso-api"
jwks_url = "https://issuer.example.com/.well-known/jwks.json"
```

```bash
# .env
APP_DATABASE__URL=
APP_ENVIRONMENT=development
```

Production should provide `APP_DATABASE__URL` and any token-signing or provider credentials from the deployment platform, not from a committed file.

## Environment-Conditional Code

```rust
pub fn docs_enabled(environment: &Environment) -> bool {
    matches!(environment, Environment::Development | Environment::Test)
}
```

Use `Settings` values to select behavior. Do not read `APP_ENVIRONMENT` directly in handlers, repositories, or services.

## Health Checks

```rust
use axum::{extract::State, http::StatusCode};

use crate::state::AppState;

pub async fn ready(State(state): State<AppState>) -> StatusCode {
    let database = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    if database {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
```

## Database Migrations Per Environment

| Environment | Migration Strategy | Who Runs | Approval |
|-------------|--------------------|----------|----------|
| development | `sqlx migrate run` locally | Developer | None |
| test | Apply migrations in test setup | Test harness | Automated |
| staging | Pipeline step before deploy | CI/CD | Automated |
| production | Reviewed pipeline step | CI/CD | Manual approval gate |

### Migration Commands

```bash
sqlx migrate info
sqlx migrate run
cargo sqlx prepare --check
```

- Use the same migration files in every environment.
- Do not run destructive down migrations in production without an approved rollback plan.
- Keep `SQLX_OFFLINE=true` in builds after `.sqlx/` metadata is prepared.

---

## See Also

- `database.instructions.md` — SQLx migration and query patterns
- `deploy.instructions.md` — Container runtime settings
- `observability.instructions.md` — Environment-specific logging
- `messaging.instructions.md` — Broker URLs and worker settings
