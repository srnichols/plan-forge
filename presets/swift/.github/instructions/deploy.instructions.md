---
description: Swift deployment patterns — App Store, TestFlight, Vapor on Docker, environment configuration
applyTo: '**/Dockerfile*,**/*.yml,**/*.yaml,**/fastlane/**'
---

# Swift Deployment Patterns

## Vapor Server Deployment (Docker)

### Multi-Stage Dockerfile
```dockerfile
# Build stage
FROM swift:5.10-jammy AS builder
WORKDIR /app
COPY . .
RUN swift build -c release --disable-sandbox

# Runtime stage
FROM swift:5.10-jammy-slim
WORKDIR /app
COPY --from=builder /app/.build/release/App ./App
COPY --from=builder /app/Public ./Public
COPY --from=builder /app/Resources ./Resources
EXPOSE 8080
ENTRYPOINT ["./App", "serve", "--env", "production", "--hostname", "0.0.0.0"]
```

### docker-compose.yml
```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/appdb
      LOG_LEVEL: info
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5
```

## iOS App Store Deployment

### Fastlane
```ruby
# Fastfile
default_platform(:ios)

platform :ios do
  lane :beta do
    increment_build_number
    build_app(scheme: "App")
    upload_to_testflight
  end

  lane :release do
    increment_build_number
    build_app(scheme: "App")
    upload_to_app_store(skip_screenshots: true)
  end
end
```

### GitHub Actions CI
```yaml
name: iOS CI
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Build and Test
        run: |
          xcodebuild test \
            -scheme App \
            -destination "platform=iOS Simulator,name=iPhone 15" \
            -resultBundlePath TestResults.xcresult
```

## Environment Configuration

### Vapor (server-side)
```swift
// configure.swift — read from environment, never hardcode
func configure(_ app: Application) async throws {
    guard let dbURL = Environment.get("DATABASE_URL") else {
        fatalError("DATABASE_URL environment variable required")
    }
    try app.databases.use(.postgres(url: dbURL), as: .psql)
}
```

### iOS (xcconfig + BuildSettings)
```
// Config/Debug.xcconfig
API_BASE_URL = https://dev-api.yourapp.com

// Config/Release.xcconfig
API_BASE_URL = https://api.yourapp.com
```

```swift
// Access in code
guard let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String else {
    fatalError("API_BASE_URL not configured")
}
```

## Rules

- **NEVER** hardcode secrets — use environment variables (Vapor) or Keychain (iOS)
- **NEVER** commit `.env` files with real values
- **ALWAYS** use multi-stage Docker builds for smaller images
- **ALWAYS** run `swift test` before building release artifacts
- **ALWAYS** run database migrations before starting Vapor in production: `./App migrate --yes`

## See Also

- `security.instructions.md` — Secrets management, ATS configuration
- `multi-environment.instructions.md` — Dev/staging/production configurations
- `database.instructions.md` — Migration strategies
