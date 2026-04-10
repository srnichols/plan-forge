---
description: API patterns for Swift — Vapor 4 RouteCollection, URLSession async/await, Codable types, cursor pagination, ProblemDetail, Validatable
applyTo: '**/*.swift'
---

# Swift API Patterns

## Vapor 4 — RouteCollection (Server-Side)

```swift
import Vapor

struct ItemController: RouteCollection {
    let service: ItemService

    func boot(routes: RoutesBuilder) throws {
        let protected = routes
            .grouped("api", "v1", "items")
            .grouped(UserAuthMiddleware())

        protected.get(use: list)
        protected.post(use: create)
        protected.group(":itemID") { item in
            item.get(use: getByID)
            item.put(use: update)
            item.delete(use: delete)
        }
    }

    // GET /api/v1/items?cursor=<token>&limit=25
    func list(req: Request) async throws -> CursorPage<ItemResponse> {
        let query = try req.query.decode(CursorQuery.self)
        return try await service.fetchPage(cursor: query.cursor, limit: query.limit, on: req.db)
    }

    // GET /api/v1/items/:itemID
    func getByID(req: Request) async throws -> ItemResponse {
        guard let id = req.parameters.get("itemID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID for 'itemID'")
        }
        guard let item = try await service.find(id: id, on: req.db) else {
            throw Abort(.notFound, reason: "Item \(id) not found")
        }
        return ItemResponse(from: item)
    }

    // POST /api/v1/items
    func create(req: Request) async throws -> Response {
        try CreateItemRequest.validate(content: req)
        let dto = try req.content.decode(CreateItemRequest.self)
        let item = try await service.create(dto, on: req.db)
        return try await ItemResponse(from: item).encodeResponse(status: .created, for: req)
    }

    // PUT /api/v1/items/:itemID
    func update(req: Request) async throws -> ItemResponse {
        guard let id = req.parameters.get("itemID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID for 'itemID'")
        }
        try UpdateItemRequest.validate(content: req)
        let dto = try req.content.decode(UpdateItemRequest.self)
        return try await service.update(id: id, with: dto, on: req.db)
    }

    // DELETE /api/v1/items/:itemID
    func delete(req: Request) async throws -> HTTPStatus {
        guard let id = req.parameters.get("itemID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID for 'itemID'")
        }
        try await service.delete(id: id, on: req.db)
        return .noContent
    }
}
```

### Route Registration (`routes.swift`)

```swift
func routes(_ app: Application) throws {
    let v1 = app.grouped("api", "v1")
    try v1.register(collection: ItemController(service: app.itemService))
    try v1.register(collection: UserController(service: app.userService))
}
```

---

## Codable Request / Response Types

```swift
// Request DTO
struct CreateItemRequest: Content, Validatable {
    let name: String
    let categoryID: UUID?
    let priceUSD: Double
    let tags: [String]

    static func validations(_ validations: inout Validations) {
        validations.add("name",     as: String.self, is: !.empty && .count(1...200))
        validations.add("priceUSD", as: Double.self, is: .range(0...))
    }
}

struct UpdateItemRequest: Content, Validatable {
    let name: String?
    let priceUSD: Double?

    static func validations(_ validations: inout Validations) {
        validations.add("name",     as: String.self, is: .count(1...200),  required: false)
        validations.add("priceUSD", as: Double.self, is: .range(0...),     required: false)
    }
}

// Response DTO — never expose model internals directly
struct ItemResponse: Content {
    let id: UUID
    let name: String
    let priceUSD: Double
    let tags: [String]
    let createdAt: Date

    init(from item: Item) {
        self.id        = item.id!
        self.name      = item.name
        self.priceUSD  = item.priceUSD
        self.tags      = item.tags
        self.createdAt = item.createdAt!
    }
}
```

---

## Cursor-Based Pagination

```swift
// Query parameters
struct CursorQuery: Content {
    var cursor: String? = nil  // opaque base64-encoded cursor
    var limit: Int = 25

    func validated() throws -> CursorQuery {
        guard (1...100).contains(limit) else {
            throw Abort(.badRequest, reason: "limit must be between 1 and 100")
        }
        return self
    }
}

// Paginated response envelope
struct CursorPage<T: Content>: Content {
    let items: [T]
    let nextCursor: String?    // nil = no more pages
    let hasMore: Bool
}

// Service layer — encode cursor as base64 JSON
struct ItemCursor: Codable {
    let createdAt: Date
    let id: UUID
}

extension ItemService {
    func fetchPage(cursor: String?, limit: Int, on db: Database) async throws -> CursorPage<ItemResponse> {
        var query = Item.query(on: db)
            .sort(\.$createdAt, .descending)
            .sort(\.$id, .descending)
            .limit(limit + 1)  // fetch one extra to determine hasMore

        if let cursor, let decoded = try? decodeCursor(cursor) {
            query = query.filter(\.$createdAt <= decoded.createdAt)
                         .filter(\.$id < decoded.id)
        }

        let items = try await query.all()
        let hasMore = items.count > limit
        let page = Array(items.prefix(limit))

        let nextCursor: String? = hasMore ? encodeCursor(page.last!) : nil
        return CursorPage(
            items: page.map(ItemResponse.init),
            nextCursor: nextCursor,
            hasMore: hasMore
        )
    }

    private func encodeCursor(_ item: Item) -> String? {
        guard let id = item.id, let date = item.createdAt else { return nil }
        let cursor = ItemCursor(createdAt: date, id: id)
        return try? JSONEncoder().encode(cursor).base64EncodedString()
    }

    private func decodeCursor(_ raw: String) throws -> ItemCursor {
        guard let data = Data(base64Encoded: raw) else {
            throw Abort(.badRequest, reason: "Invalid cursor")
        }
        return try JSONDecoder().decode(ItemCursor.self, from: data)
    }
}
```

---

## ProblemDetail Error Responses (RFC 9457)

```swift
struct ProblemDetail: Content {
    let type: String
    let title: String
    let status: Int
    let detail: String
    let instance: String?
}

struct ProblemDetailMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        do {
            return try await next.respond(to: request)
        } catch let abort as AbortError {
            let problem = ProblemDetail(
                type:     "https://yourapp.com/errors/\(abort.status.code)",
                title:    abort.status.reasonPhrase,
                status:   Int(abort.status.code),
                detail:   abort.reason,
                instance: request.url.path
            )
            var headers = HTTPHeaders()
            headers.contentType = .init(type: "application", subType: "problem+json")
            return try await problem.encodeResponse(status: abort.status, headers: headers, for: request)
        }
    }
}

// Register in configure.swift — BEFORE other middleware
app.middleware.use(ProblemDetailMiddleware(), at: .beginning)
```

---

## Input Validation with `Validatable`

```swift
// Controller: call validate BEFORE decode
func create(req: Request) async throws -> Response {
    try CreateItemRequest.validate(content: req)          // → 400 with details on failure
    let dto = try req.content.decode(CreateItemRequest.self)
    let item = try await service.create(dto, on: req.db)
    return try await ItemResponse(from: item).encodeResponse(status: .created, for: req)
}

// Custom validation rule
struct CreateItemRequest: Content, Validatable {
    let name: String
    let sku: String
    let priceUSD: Double

    static func validations(_ validations: inout Validations) {
        validations.add("name",     as: String.self, is: !.empty && .count(1...200))
        validations.add("sku",      as: String.self, is: .pattern("[A-Z]{2}-\\d{4}"))
        validations.add("priceUSD", as: Double.self, is: .range(0.01...))
    }
}
```

---

## URLSession Async/Await (iOS Client)

```swift
// API client using URLSession and Codable
actor APIClient {
    private let session: URLSession
    private let baseURL: URL
    private let decoder: JSONDecoder

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
    }

    func fetchItems(cursor: String? = nil, limit: Int = 25) async throws -> CursorPage<ItemResponse> {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/v1/items"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = [.init(name: "limit", value: "\(limit)")]
        if let cursor { queryItems.append(.init(name: "cursor", value: cursor)) }
        components.queryItems = queryItems

        let request = try authorizedRequest(url: components.url!)
        return try await perform(request)
    }

    func createItem(_ dto: CreateItemRequest) async throws -> ItemResponse {
        var request = try authorizedRequest(url: baseURL.appendingPathComponent("api/v1/items"))
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(dto)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }

    // MARK: - Internals

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let problem = try? decoder.decode(ProblemDetail.self, from: data)
            throw APIError.httpError(status: http.statusCode, detail: problem?.detail)
        }
        return try decoder.decode(T.self, from: data)
    }

    private func authorizedRequest(url: URL) throws -> URLRequest {
        var req = URLRequest(url: url)
        guard let token = TokenStore.shared.accessToken else {
            throw APIError.unauthenticated
        }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }
}

enum APIError: LocalizedError {
    case invalidResponse
    case unauthenticated
    case httpError(status: Int, detail: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:          return "Invalid server response"
        case .unauthenticated:          return "Authentication required"
        case .httpError(let s, let d):  return d ?? "HTTP \(s) error"
        }
    }
}
```

---

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
| 500 Internal Server Error | Unhandled error — never expose internals |

---

## Non-Negotiable Rules

- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- **NEVER** put business logic in controllers — delegate to the service layer
- **NEVER** use `try!` to decode request content — always propagate errors
- **ALWAYS** validate inputs with `Validatable` before decoding
- **ALWAYS** return `ProblemDetail` JSON for error responses
- Use cursor-based pagination for large collections; offset pagination only for admin UIs
- Return `ItemResponse` DTOs, never raw `Model` objects

## Anti-Patterns

```
❌ try! req.content.decode(...)      — use try, propagate error
❌ Return 200 with { "error": ... }  — use correct HTTP status codes
❌ Expose database model fields      — use response DTOs
❌ Business logic in route handlers  — put in Service layer
❌ Offset pagination on large tables — use cursor-based instead
```

---

## See Also

- `auth.instructions.md` — JWT middleware, RBAC guards
- `errorhandling.instructions.md` — Typed AppError, ProblemDetail format
- `database.instructions.md` — Fluent queries, repository pattern
- `multi-environment.instructions.md` — Base URL configuration per environment

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Nobody uses pagination yet" | Unbounded queries return all rows. The first large dataset crashes the client or times out. Add `?page=1&per=20` from the first endpoint. |
| "API versioning can wait until v2" | Unversioned APIs break all consumers on the first change. Add `/api/v1/` route group from day one — it costs zero lines of logic. |
| "Error codes aren't needed for MVP" | API consumers parse error codes programmatically. Returning only string messages forces consumers to regex-match errors — brittle and untranslatable. |
| "Returning 200 OK for all responses simplifies the client" | HTTP semantics exist for a reason. Returning 200 for errors breaks caching, monitoring, and every HTTP-aware tool in the pipeline. |
| "This endpoint doesn't need request validation" | Every endpoint accepting input is an attack surface. Validate shape and constraints at the API boundary — `Validatable` conformance handles this with minimal code. |

---

## Warning Signs

- An endpoint returns an unbounded collection without pagination parameters
- No OpenAPI metadata or route documentation on handler functions (undocumented API contract)
- Route paths don't include a version segment (`/api/users` instead of `/api/v1/users`)
- HTTP 200 returned for error conditions instead of 4xx/5xx
- Request body decoded as untyped `[String: Any]` instead of a `Content`-conforming struct
- Missing `Content-Type` header on responses (clients can't parse reliably)
