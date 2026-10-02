---
description: "Scaffold Swift domain error types and centralized Vapor ProblemDetail error rendering."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold typed Swift domain errors with centralized Vapor HTTP error rendering.

## Required Pattern

### Domain Error Type
```swift
import Vapor

enum AppError: Error, LocalizedError, Sendable {
    case notFound(entity: String, id: String)
    case validation(message: String)
    case conflict(message: String)
    case forbidden(message: String = "Access denied")
    case `internal`(underlying: any Error & Sendable)

    var errorDescription: String? {
        switch self {
        case .notFound(let entity, let id):
            return "\(entity) with ID '\(id)' not found"
        case .validation(let message), .conflict(let message), .forbidden(let message):
            return message
        case .internal:
            return "An unexpected error occurred"
        }
    }

    var code: String {
        switch self {
        case .notFound: return "NOT_FOUND"
        case .validation: return "VALIDATION_FAILED"
        case .conflict: return "CONFLICT"
        case .forbidden: return "FORBIDDEN"
        case .internal: return "INTERNAL_ERROR"
        }
    }

    var httpStatus: HTTPStatus {
        switch self {
        case .notFound: return .notFound
        case .validation: return .badRequest
        case .conflict: return .conflict
        case .forbidden: return .forbidden
        case .internal: return .internalServerError
        }
    }
}

extension AppError: AbortError {
    var status: HTTPStatus { httpStatus }
    var reason: String { errorDescription ?? "Unknown error" }
}
```

### ProblemDetail Response
```swift
struct ProblemDetail: Content, Sendable {
    let type: String
    let title: String
    let status: Int
    let detail: String
    let instance: String?
    let error: String
}

extension ProblemDetail {
    init(error: AppError, request: Request) {
        self.init(
            type: "https://example.com/problems/\(error.code.lowercased())",
            title: error.httpStatus.reasonPhrase,
            status: Int(error.httpStatus.code),
            detail: error.errorDescription ?? error.httpStatus.reasonPhrase,
            instance: request.url.path,
            error: error.code
        )
    }
}
```

### Centralized Error Middleware
```swift
struct ProblemDetailMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        do {
            return try await next.respond(to: request)
        } catch let appError as AppError {
            let problem = ProblemDetail(error: appError, request: request)
            return try await problem.encodeResponse(status: appError.httpStatus, for: request)
        } catch let abort as any AbortError {
            let problem = ProblemDetail(
                type: "https://example.com/problems/\(abort.status.code)",
                title: abort.status.reasonPhrase,
                status: Int(abort.status.code),
                detail: abort.reason,
                instance: request.url.path,
                error: "HTTP_\(abort.status.code)"
            )
            return try await problem.encodeResponse(status: abort.status, for: request)
        } catch {
            request.logger.error("Unhandled error", metadata: ["error": "\(error)"])
            let problem = ProblemDetail(
                type: "https://example.com/problems/internal-error",
                title: HTTPStatus.internalServerError.reasonPhrase,
                status: 500,
                detail: "An unexpected error occurred.",
                instance: request.url.path,
                error: "INTERNAL_ERROR"
            )
            return try await problem.encodeResponse(status: .internalServerError, for: request)
        }
    }
}
```

### Usage in Handlers
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

- Use one `AppError` enum for domain errors that map to HTTP status codes
- Conform errors crossing task boundaries to `Sendable`
- NEVER leak internal error details or stack traces in HTTP responses
- Log unexpected errors server-side; return sanitized ProblemDetail JSON to the client
- Use `guard let` / `throw` for invalid input — never force unwrap
- Keep error types in `Sources/App/Errors/` or the nearest shared application layer
- Register `ProblemDetailMiddleware` before route handlers in `configure.swift`

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
