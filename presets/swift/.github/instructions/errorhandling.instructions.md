---
description: Error handling patterns — Typed errors, Result type, ProblemDetail responses, async error propagation
applyTo: '**/*.swift'
---

# Error Handling Patterns (Swift)

## Error Types

```swift
enum AppError: Error, LocalizedError {
    case notFound(entity: String, id: String)
    case validation(message: String)
    case conflict(message: String)
    case forbidden(message: String = "Access denied")
    case `internal`(underlying: Error)

    var errorDescription: String? {
        switch self {
        case .notFound(let entity, let id):
            return "\(entity) with ID '\(id)' not found"
        case .validation(let message):
            return message
        case .conflict(let message):
            return message
        case .forbidden(let message):
            return message
        case .internal:
            return "An unexpected error occurred"
        }
    }

    var httpStatus: HTTPStatus {
        switch self {
        case .notFound:   return .notFound
        case .validation: return .badRequest
        case .conflict:   return .conflict
        case .forbidden:  return .forbidden
        case .internal:   return .internalServerError
        }
    }
}
```

## ProblemDetail Response (Vapor)

```swift
struct ProblemDetail: Content {
    let type: String
    let title: String
    let status: Int
    let detail: String
    let instance: String?
}

extension AppError: AbortError {
    var status: HTTPStatus { httpStatus }
    var reason: String { errorDescription ?? "Unknown error" }
}

// Vapor converts AbortError automatically — add ProblemDetail middleware for RFC 9457 format
struct ProblemDetailMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        do {
            return try await next.respond(to: request)
        } catch let error as AppError {
            let problem = ProblemDetail(
                type: "https://yourapp.com/errors/\(String(describing: error).lowercased())",
                title: HTTPStatus(statusCode: Int(error.httpStatus.code)).reasonPhrase,
                status: Int(error.httpStatus.code),
                detail: error.errorDescription ?? "",
                instance: request.url.path
            )
            return try await problem.encodeResponse(status: error.httpStatus, for: request)
        }
    }
}
```

## Result Type Pattern

```swift
// Prefer throws/async throws for service methods
// Use Result<T, Error> only when you need to pass errors as values

func fetchOrFallback() async -> Result<Item, AppError> {
    do {
        let item = try await repository.findLatest()
        return .success(item)
    } catch {
        return .failure(.internal(underlying: error))
    }
}
```

## Handler Error Pattern (Vapor)

```swift
func getByID(req: Request) async throws -> ItemResponse {
    guard let id = req.parameters.get("id", as: UUID.self) else {
        throw AppError.validation(message: "Invalid UUID format for 'id'")
    }
    guard let item = try await service.find(id: id, on: req.db) else {
        throw AppError.notFound(entity: "Item", id: id.uuidString)
    }
    return ItemResponse(from: item)
}
```

## Rules

- **NEVER** force-unwrap (`!`) — use `guard let` / `if let` / throw
- **NEVER** use `try!` in production — propagate errors with `try`
- **ALWAYS** use typed `AppError` — not generic `Error` or `NSError`
- **ALWAYS** provide context in errors: `AppError.notFound(entity: "Item", id: id.uuidString)`
- **ALWAYS** return ProblemDetail JSON from HTTP handlers
- Service layer throws `AppError`; controllers map to HTTP responses automatically
- Use `Logger` from `swift-log` for structured error logging
- Reserve `fatalError` for programming errors (wrong configuration), never user-path errors

## Logging Pattern

```swift
import Logging

// Inject logger
let logger: Logger

// Log errors with context
func processItem(_ item: Item) async throws {
    do {
        try await repository.save(item)
    } catch {
        logger.error("Failed to save item", metadata: [
            "itemID": "\(item.id?.uuidString ?? "nil")",
            "error": "\(error)"
        ])
        throw AppError.internal(underlying: error)
    }
}
```

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `testing.instructions.md` — Error assertion patterns in tests
