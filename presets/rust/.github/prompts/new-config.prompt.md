---
description: "Scaffold a typed Rust Settings module with config crate loading, secrecy SecretString, validation, and environment overrides."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold typed, validated configuration loaded from environment variables and optional local files.

## Required Pattern

### Settings Types

```rust
use secrecy::SecretString;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct {SectionName}Settings {
    pub base_url: String,
    pub api_key: SecretString,
    pub timeout_seconds: u64,
    pub retry_count: u32,
}

impl {SectionName}Settings {
    pub fn validate(&self) -> Result<(), config::ConfigError> {
        if self.base_url.trim().is_empty() {
            return Err(config::ConfigError::Message("{SECTION_PREFIX}__BASE_URL is required".to_owned()));
        }
        if self.retry_count > 10 {
            return Err(config::ConfigError::Message("{SECTION_PREFIX}__RETRY_COUNT must be <= 10".to_owned()));
        }
        Ok(())
    }
}
```

### Grouped Application Settings

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub environment: Environment,
    pub server: ServerSettings,
    pub database: DatabaseSettings,
    pub auth: AuthSettings,
    pub api_token: Option<SecretString>,
    pub {section_name}: {SectionName}Settings,
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

### Loading with Fail-Fast

```rust
impl Settings {
    pub fn load() -> Result<Self, config::ConfigError> {
        dotenvy::dotenv().ok();
        let environment = std::env::var("APP_ENVIRONMENT").unwrap_or_else(|_| "development".to_owned());
        let settings: Self = config::Config::builder()
            .add_source(config::File::with_name("config/default"))
            .add_source(config::File::with_name(&format!("config/{environment}")).required(false))
            .add_source(
                config::Environment::with_prefix("APP")
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?
            .try_deserialize()?;

        settings.{section_name}.validate()?;
        Ok(settings)
    }
}
```

### Startup Usage

```rust
pub fn load_settings_or_exit() -> Settings {
    match Settings::load() {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("invalid configuration: {error}");
            std::process::exit(1);
        }
    }
}
```

### `config/default.toml` and `.env`

```toml
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

[section-name]
base_url = "https://api.example.com"
timeout_seconds = 30
retry_count = 3
```

```bash
# .env — local only, gitignored
APP_DATABASE__URL=
APP_ENVIRONMENT=development
APP_API_TOKEN=
{SECTION_PREFIX}__BASE_URL=https://api.example.com
{SECTION_PREFIX}__API_KEY=
```

## Rules

- Validate settings at startup and fail before binding sockets.
- Use `config::Environment::with_prefix("APP").prefix_separator("_").separator("__")` for nested environment variables such as `APP_DATABASE__URL`.
- Never store secrets in Rust source, committed `.env` files, or `.env.example`.
- Use `SecretString` for API keys, tokens, and database URLs.
- Keep settings in `src/config.rs` or `src/config/{section}.rs`.
- Pass settings into constructors; do not call `std::env::var` in services.
- Prefer explicit unit suffixes in field names, such as `timeout_seconds`, for operator-facing numeric config.

## Reference Files

- [Multi-environment configuration](../instructions/multi-environment.instructions.md)
- Use the architecture-principles instruction file to keep config outside business logic.
