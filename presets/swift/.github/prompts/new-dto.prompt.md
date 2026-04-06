---
description: "Scaffold a Swift Codable DTO with CodingKeys, Validatable conformance (Vapor), and request/response pair pattern."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO (Request/Response Struct)

Scaffold request and response structs that separate API contracts from domain models.

## Required Pattern

### Response DTO
```swift
import Foundation

struct {EntityName}Response: Codable, Content, Sendable {
    let id: String
    let name: String
    let description: String?
    let createdAt: String  // ISO 8601
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case description
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(from entity: {EntityName}) {
        let formatter = ISO8601DateFormatter()
        self.id = entity.id.uuidString
        self.name = entity.name
        self.description = entity.description
        self.createdAt = formatter.string(from: entity.createdAt)
        self.updatedAt = formatter.string(from: entity.updatedAt)
    }
}
```

### Create Request DTO
```swift
import Vapor

struct Create{EntityName}Request: Codable, Content, Validatable, Sendable {
    let name: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case name
        case description
    }

    static func validations(_ validations: inout Validations) {
        validations.add("name", as: String.self, is: !.empty && .count(1...255))
        validations.add("description", as: String?.self, is: .nil || .count(...2000), required: false)
    }
}
```

### Update Request DTO
```swift
struct Update{EntityName}Request: Codable, Content, Validatable, Sendable {
    let name: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case name
        case description
    }

    static func validations(_ validations: inout Validations) {
        validations.add("name", as: String.self, is: !.empty && .count(1...255))
        validations.add("description", as: String?.self, is: .nil || .count(...2000), required: false)
    }
}
```

### Paged Response Wrapper
```swift
struct PagedResponse<T: Codable>: Codable, Content {
    let items: [T]
    let page: Int
    let pageSize: Int
    let totalCount: Int
    let totalPages: Int
    let hasNext: Bool
    let hasPrevious: Bool

    enum CodingKeys: String, CodingKey {
        case items
        case page
        case pageSize    = "page_size"
        case totalCount  = "total_count"
        case totalPages  = "total_pages"
        case hasNext     = "has_next"
        case hasPrevious = "has_previous"
    }
}
```

### Validation in Vapor Handler
```swift
func create(req: Request) async throws -> Response {
    try Create{EntityName}Request.validate(content: req)
    let input = try req.content.decode(Create{EntityName}Request.self)
    let created = try await service.create(input)
    return try await created.encodeResponse(status: .created, for: req)
}
```

## Rules

- NEVER return domain models directly from controllers — always map to response DTOs
- NEVER decode directly into domain models — always use request DTOs
- Use `CodingKeys` with `snake_case` JSON names for all fields
- Conform request DTOs to `Validatable` for Vapor built-in validation
- Use `Content` conformance for Vapor automatic encoding/decoding
- Mark all DTOs `Sendable` for safe use across async contexts
- Keep DTOs in `Sources/App/DTOs/` — not in domain layer

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
