---
description: API patterns for Swift — Vapor REST conventions, controllers, validation, pagination, error responses
applyTo: '**/*Controller*,**/*Route*,**/*routes*,**/Routes/**,**/Controllers/**'
---

# Swift API Patterns (Vapor)

## REST Conventions

### Controller Structure (RouteCollection)
```swift
import Vapor

struct ItemController: RouteCollection {
    let service: ItemService

    func boot(routes: RoutesBuilder) throws {
        let items = routes.grouped("items")
            .grouped(UserAuthMiddleware())
        items.get(use: list)
        items.post(use: create)
        items.group(":id") { item in
            item.get(use: getByID)
            item.put(use: update)
            item.delete(use: delete)
        }
    }

    // GET /items
    func list(req: Request) async throws -> PagedResponse<ItemResponse> {
        let page = try req.query.decode(PageQuery.self)
        return try await service.fetchPaged(page: page.page, size: page.size, on: req.db)
    }

    // GET /items/:id
    func getByID(req: Request) async throws -> ItemResponse {
        guard let id = req.parameters.get("id", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid ID format")
        }
        guard let item = try await service.find(id: id, on: req.db) else {
            throw Abort(.notFound, reason: "Item not found")
        }
        return ItemResponse(from: item)
    }

    // POST /items
    func create(req: Request) async throws -> Response {
        let dto = try req.content.decode(CreateItemRequest.self)
        try dto.validate()
        let item = try await service.create(dto, on: req.db)
        return try await item.encodeResponse(status: .created, for: req)
    }
}
```

## Error Responses (RFC 9457 Problem Details)
```swift
struct ProblemDetail: Content {
    let type: String
    let title: String
    let status: Int
    let detail: String?
    let instance: String?
}

// Register as default error handler in configure.swift
app.middleware.use(ProblemDetailMiddleware())

struct ProblemDetailMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        do {
            return try await next.respond(to: request)
        } catch let abort as AbortError {
            let problem = ProblemDetail(
                type: "https://tools.ietf.org/html/rfc9110#section-15",
                title: abort.reason,
                status: Int(abort.status.code),
                detail: nil,
                instance: request.url.path
            )
            return try problem.encodeResponse(status: abort.status, for: request)
        }
    }
}
```

## Request Validation (Vapor Validations)
```swift
struct CreateItemRequest: Content, Validatable {
    let name: String
    let categoryID: UUID?
    let price: Double

    static func validations(_ validations: inout Validations) {
        validations.add("name", as: String.self, is: !.empty && .count(1...200))
        validations.add("price", as: Double.self, is: .range(0...))
    }
}

// In controller — Vapor auto-validates with Validatable
func create(req: Request) async throws -> Response {
    try CreateItemRequest.validate(content: req)  // throws 400 on failure
    let dto = try req.content.decode(CreateItemRequest.self)
    // ...
}
```

## Pagination
```swift
struct PageQuery: Content {
    var page: Int = 1
    var size: Int = 25

    func validate() throws {
        guard page >= 1 else { throw Abort(.badRequest, reason: "page must be >= 1") }
        guard (1...100).contains(size) else { throw Abort(.badRequest, reason: "size must be 1-100") }
    }
}

struct PagedResponse<T: Content>: Content {
    let items: [T]
    let page: Int
    let pageSize: Int
    let totalCount: Int
    let totalPages: Int
    let hasNext: Bool
    let hasPrevious: Bool

    init(items: [T], page: Int, pageSize: Int, totalCount: Int) {
        self.items = items
        self.page = page
        self.pageSize = pageSize
        self.totalCount = totalCount
        totalPages = Int(ceil(Double(totalCount) / Double(pageSize)))
        hasNext = page < totalPages
        hasPrevious = page > 1
    }
}
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success |
| 204 No Content | DELETE success, no body |
| 400 Bad Request | Validation failure, malformed JSON |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource |
| 422 Unprocessable | Valid syntax but business rule violation |
| 500 Internal Server | Unhandled error (never expose internals) |

## API Versioning (URL-based)

```swift
// routes.swift
func routes(_ app: Application) throws {
    let v1 = app.grouped("api", "v1")
    try v1.register(collection: ItemController(service: app.itemService))

    let v2 = app.grouped("api", "v2")
    try v2.register(collection: ItemV2Controller(service: app.itemService))
}
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose error internals to clients (log details server-side only)
❌ Business logic in controllers (delegate to service layer)
❌ Force-try content decode: try! req.content.decode(...)
❌ Missing Content-Type header on responses
```

## API Documentation (OpenAPI via Vapor)

```swift
// Use vapor-openapi or Hummingbird OpenAPI for spec generation
// Annotate models with descriptions
struct ItemResponse: Content {
    /// Unique identifier
    let id: UUID
    /// Display name
    let name: String
    /// Price in USD
    let price: Double
}
```

## See Also

- `security.instructions.md` — JWT middleware, input validation
- `errorhandling.instructions.md` — Error response format, ProblemDetail
- `testing.instructions.md` — Vapor XCTVapor route tests
- `performance.instructions.md` — Async/await patterns, connection pooling
