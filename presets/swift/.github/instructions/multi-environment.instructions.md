---
description: Multi-environment configuration — Dev/staging/production settings, Vapor Environment, typed config management
applyTo: '**/*.swift,Package.swift,Dockerfile,**/.env*'
---

# Multi-Environment Configuration (Swift)

## Environment Hierarchy

| Environment | Purpose | Config Source | Detection |
|-------------|---------|---------------|-----------|
| `development` | Local dev | `.env.development` / local env vars | `APP_ENV` or Vapor `.development` |
| `staging` | Pre-production | injected environment variables | `APP_ENV` or Vapor custom env |
| `production` | Live traffic | environment variables / secret manager only | `APP_ENV` or Vapor `.production` |
| `testing` | Automated tests | `.env.testing` / test fixtures | Vapor `.testing` |

## Configuration Loading Order

```
Default values in AppConfig
.env / .env.{APP_ENV} for local development and tests
Environment variables
Secret manager / mounted secrets
```

## Rules

- **NEVER** put secrets in config files committed to git
- **NEVER** hardcode environment-specific URLs
- **ALWAYS** validate config at startup — fail fast on missing values
- **ALWAYS** use a typed config struct parsed once at startup
- In production, inject all secrets via environment variables or a secret manager

## Typed Config Struct

```swift
import Foundation
import Vapor

struct AppConfig: Sendable {
    let environment: Environment
    let port: Int
    let databaseURL: String
    let redisURL: String?
    let logLevel: Logger.Level
    let corsOrigins: [String]
    let autoMigrate: Bool

    static func load(from environment: Environment) throws -> AppConfig {
        guard let databaseURL = Environment.get("DATABASE_URL") else {
            throw ConfigError.missing("DATABASE_URL")
        }

        return AppConfig(
            environment: environment,
            port: Environment.get("PORT").flatMap(Int.init) ?? 8080,
            databaseURL: databaseURL,
            redisURL: Environment.get("REDIS_URL"),
            logLevel: Logger.Level(rawValue: Environment.get("LOG_LEVEL") ?? "info") ?? .info,
            corsOrigins: Environment.get("CORS_ORIGINS")?.split(separator: ",").map(String.init) ?? [],
            autoMigrate: Environment.get("AUTO_MIGRATE") == "true"
        )
    }
}

enum ConfigError: Error, CustomStringConvertible {
    case missing(String)

    var description: String {
        switch self {
        case .missing(let key): return "Missing required environment variable: \(key)"
        }
    }
}
```

## Per-Environment Defaults

```env
# .env.development
APP_ENV=development
PORT=8080
DATABASE_URL=postgresql://app:secret@localhost:5432/contoso_dev
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
AUTO_MIGRATE=true
```

Production should provide the same keys through the deployment platform. Do not commit a production `.env` file.

## Environment-Conditional Code

```swift
func configure(_ app: Application) async throws {
    let config = try AppConfig.load(from: app.environment)
    app.logger.logLevel = config.logLevel

    if config.environment == .development {
        app.logger.notice("Development diagnostics enabled")
    }

    try configureDatabase(app, databaseURL: config.databaseURL)
    try configureRedis(app)
}
```

## Health Checks

```swift
import SQLKit
import Vapor

func healthRoutes(_ app: Application) throws {
    app.get("healthz") { _ async -> [String: String] in
        ["status": "ok"]
    }

    app.get("readyz") { req async throws -> ReadyResponse in
        do {
            guard let sql = req.db as? any SQLDatabase else {
                throw Abort(.serviceUnavailable, reason: "database unavailable")
            }
            try await sql.raw("SELECT 1").run()
            return ReadyResponse(status: "ok", database: true, redis: true)
        } catch {
            throw Abort(.serviceUnavailable, reason: "database unavailable")
        }
    }
}

struct ReadyResponse: Content {
    let status: String
    let database: Bool
    let redis: Bool
}
```

## Database Migrations Per Environment

| Environment | Migration Strategy | Who Runs | Approval |
|-------------|--------------------|----------|---------|
| **development** | Fluent auto-migrate on startup | App process | None |
| **testing** | Fluent auto-migrate in test setup | Test target | Auto |
| **staging** | `App migrate --yes` in CI/CD | Pipeline | Auto |
| **production** | `App migrate --yes` pipeline step | Pipeline | Manual approval gate |

### Environment-Specific Migration Config
```env
AUTO_MIGRATE=false
```

```swift
func runConfiguredMigrations(_ app: Application, config: AppConfig) async throws {
    guard config.autoMigrate, config.environment != .production else { return }
    try await app.autoMigrate()
}
```

```powershell
.\.build\release\App.exe migrate --yes --env production
```

```bash
./App migrate --yes --env production
```

- **NEVER** enable auto-migrate in production without a pipeline gate
- **ALWAYS** use the same Fluent migrations across all environments
- **ALWAYS** run migrations before starting the production web process

---

## See Also

- `database.instructions.md` — Migration strategy, expand-contract, rollback procedures
- `deploy.instructions.md` — Container config, health checks, migration pipeline steps
- `observability.instructions.md` — Per-environment logging and metrics
- `messaging.instructions.md` — Broker config per environment
