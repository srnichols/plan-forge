---
description: "Scaffold Swift configuration using xcconfig files, a type-safe Environment struct, Vapor environment, and Info.plist reading."
agent: "agent"
tools: [read, edit, search]
---
# Create New Configuration Module

Scaffold type-safe, validated configuration for Swift projects.

## Required Pattern

### Type-Safe Config Struct
```swift
import Foundation

struct AppConfig: Sendable {
    let port: Int
    let environment: AppEnvironment
    let logLevel: String
    let database: DatabaseConfig
    let cache: CacheConfig
}

struct DatabaseConfig: Sendable {
    let url: String
    let poolSize: Int
}

struct CacheConfig: Sendable {
    let ttlSeconds: Int
    let maxSize: Int
}

enum AppEnvironment: String, Sendable {
    case development
    case testing
    case production
}
```

### Environment-Based Loader
```swift
import Foundation

extension AppConfig {
    static func load() throws -> AppConfig {
        return AppConfig(
            port: env("PORT", default: 8080),
            environment: try envEnum("APP_ENV", default: .development),
            logLevel: env("LOG_LEVEL", default: "info"),
            database: DatabaseConfig(
                url: try mustEnv("DATABASE_URL"),
                poolSize: env("DB_POOL_SIZE", default: 10)
            ),
            cache: CacheConfig(
                ttlSeconds: env("CACHE_TTL_SECONDS", default: 300),
                maxSize: env("CACHE_MAX_SIZE", default: 1000)
            )
        )
    }
}

private func mustEnv(_ key: String) throws -> String {
    guard let value = ProcessInfo.processInfo.environment[key], !value.isEmpty else {
        throw ConfigError.missingRequiredKey(key)
    }
    return value
}

private func env(_ key: String, default fallback: String) -> String {
    ProcessInfo.processInfo.environment[key] ?? fallback
}

private func env(_ key: String, default fallback: Int) -> Int {
    guard let raw = ProcessInfo.processInfo.environment[key], let value = Int(raw) else {
        return fallback
    }
    return value
}

private func envEnum<T: RawRepresentable>(_ key: String, default fallback: T) throws -> T where T.RawValue == String {
    guard let raw = ProcessInfo.processInfo.environment[key] else { return fallback }
    guard let value = T(rawValue: raw) else {
        throw ConfigError.invalidValue(key: key, value: raw)
    }
    return value
}
```

### Config Errors
```swift
enum ConfigError: Error, LocalizedError {
    case missingRequiredKey(String)
    case invalidValue(key: String, value: String)

    var errorDescription: String? {
        switch self {
        case .missingRequiredKey(let key):
            return "Required environment variable `\(key)` is not set."
        case .invalidValue(let key, let value):
            return "Environment variable `\(key)` has invalid value: `\(value)`."
        }
    }
}
```

### Vapor Integration
```swift
// In configure.swift
import Vapor

public func configure(_ app: Application) async throws {
    let config = try AppConfig.load()

    app.http.server.configuration.port = config.port

    // Use Vapor Environment
    switch config.environment {
    case .production:
        app.logger.logLevel = .warning
    case .development, .testing:
        app.logger.logLevel = .debug
    }

    // Register as a service (dependency injection)
    app.storage[AppConfigKey.self] = config
}

struct AppConfigKey: StorageKey {
    typealias Value = AppConfig
}

extension Application {
    var appConfig: AppConfig {
        guard let config = storage[AppConfigKey.self] else {
            fatalError("AppConfig not configured. Call configure(_:) first.")
        }
        return config
    }
}
```

### xcconfig File (Xcode projects)
```
// Config/Debug.xcconfig
APP_ENV = development
PORT = 8080
LOG_LEVEL = debug
BASE_URL = http://localhost:8080
```

### Reading from Info.plist (iOS)
```swift
extension Bundle {
    func infoPlistValue<T>(forKey key: String) -> T? {
        infoDictionary?[key] as? T
    }
}

// Usage
let baseURL: String = Bundle.main.infoPlistValue(forKey: "BASE_URL") ?? "https://api.example.com"
```

### Fail-Fast in Entry Point
```swift
// main.swift or @main struct
let config: AppConfig
do {
    config = try AppConfig.load()
} catch {
    print("Configuration error: \(error.localizedDescription)")
    exit(1)
}
```

## Rules

- ALWAYS validate config at startup — `exit(1)` or `fatalError` on missing required values
- NEVER import a global config singleton in libraries — pass `AppConfig` via constructors
- NEVER commit `.env` files — commit `.env.example` with placeholder values
- NEVER store secrets in code, xcconfig, or Info.plist — use Keychain or Secrets Manager
- Use `ProcessInfo.processInfo.environment` for server-side env vars
- Use `Bundle.main.infoDictionary` for iOS build-time config from xcconfig

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
