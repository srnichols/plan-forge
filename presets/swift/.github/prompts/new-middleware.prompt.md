---
description: "Scaffold Swift Vapor 4 AsyncMiddleware with request-scoped storage, logging, and safe short-circuiting."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold a Vapor 4 `AsyncMiddleware` type for the request pipeline.

## Required Pattern

### Standard Middleware (Vapor)
```swift
import Vapor

struct RequestLoggingMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        let start = ContinuousClock.now
        let response = try await next.respond(to: request)
        let elapsed = start.duration(to: .now)

        request.logger.info("request complete", metadata: [
            "method": "\(request.method)",
            "path": "\(request.url.path)",
            "status": "\(response.status.code)"
        ])

        return response
    }
}
```

### Request-Scoped Storage Middleware
```swift
import Vapor

struct TenantIDKey: StorageKey {
    typealias Value = UUID
}

extension Request {
    var tenantID: UUID? {
        get { storage[TenantIDKey.self] }
        set { storage[TenantIDKey.self] = newValue }
    }
}

struct TenantMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        let user = try request.auth.require(User.self)
        let tenantID = user.tenantID

        request.tenantID = tenantID
        return try await next.respond(to: request)
    }
}
```

### Configurable Middleware
```swift
import Vapor

struct AuditMiddleware: AsyncMiddleware {
    let skipPaths: Set<String>
    let loggerLabel: String

    init(skipPaths: Set<String> = ["/healthz", "/readyz"], loggerLabel: String = "audit") {
        self.skipPaths = skipPaths
        self.loggerLabel = loggerLabel
    }

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard !skipPaths.contains(request.url.path) else {
            return try await next.respond(to: request)
        }

        request.logger.info("audit start", metadata: ["label": "\(loggerLabel)"])
        return try await next.respond(to: request)
    }
}
```

## Registration Order (Vapor)

```swift
func configure(_ app: Application) async throws {
    app.middleware.use(CORSMiddleware(configuration: corsConfiguration), at: .beginning)
    app.middleware.use(RequestIDMiddleware())
    app.middleware.use(RequestLoggingMiddleware())
    app.middleware.use(SecurityHeadersMiddleware())

    let protected = app.grouped(UserToken.authenticator(), User.guardMiddleware(), TenantMiddleware())
    protected.get("me") { req async throws -> UserResponse in
        let user = try req.auth.require(User.self)
        return UserResponse(from: user)
    }
}
```

## Common Middleware Types

| Type | Purpose | Example |
|------|---------|---------|
| Correlation ID | Attach trace ID to request logs | `RequestIDMiddleware` + `X-Request-Id` |
| Tenant Resolution | Derive tenant from authenticated user membership | `Request.storage` typed key |
| Request Logging | Log method, path, status, duration | `AsyncMiddleware` around `next.respond` |
| Security Headers | Add standard response headers | mutate `Response.headers` after `next.respond` |
| CORS | Restrict allowed origins | `CORSMiddleware.Configuration` |

## Rules

- Middleware handles cross-cutting concerns ONLY — no business logic
- ALWAYS call `next.respond(to:)` unless intentionally short-circuiting
- Use `Request.storage` with a typed `StorageKey` for request-scoped data — not globals
- Keep middleware `Sendable` where possible; avoid shared mutable state
- Do not block the EventLoop; use async/await for I/O and `threadPool` for CPU work
- Throw typed `AppError` or `Abort` when short-circuiting
- NEVER trust `X-Tenant-Id` or another unauthenticated client header alone; mount tenant middleware after authentication and derive the tenant from the authenticated user or a verified membership record

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
