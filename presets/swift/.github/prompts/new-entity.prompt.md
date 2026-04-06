---
description: "Scaffold a Swift model entity using Fluent @Model (Vapor), SwiftData @Model (iOS), or a pure Swift domain struct."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Model Entity

Scaffold a complete entity across all layers — database model, domain struct, and request/response types.

## Required Steps

1. **Fluent Model** (Vapor server-side) at `Sources/App/Models/{EntityName}.swift`
2. **SwiftData Model** (iOS client) at `{AppName}/{EntityName}Model.swift`
3. **Domain struct** at `Sources/App/Domain/{EntityName}.swift`
4. **Request/Response DTOs** at `Sources/App/DTOs/{EntityName}DTOs.swift`
5. **Migration** at `Sources/App/Migrations/Create{EntityName}.swift`

## Fluent Model (Vapor)

```swift
import Fluent
import Vapor

final class {EntityName}Model: Model, Content, @unchecked Sendable {
    static let schema = "{entity_name}s"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "name")
    var name: String

    @OptionalField(key: "description")
    var description: String?

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    @Timestamp(key: "updated_at", on: .update)
    var updatedAt: Date?

    init() {}

    init(id: UUID? = nil, name: String, description: String? = nil) {
        self.id = id
        self.name = name
        self.description = description
    }
}
```

### Fluent Migration
```swift
import Fluent

struct Create{EntityName}: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("{entity_name}s")
            .id()
            .field("name", .string, .required)
            .field("description", .string)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("{entity_name}s").delete()
    }
}
```

### Migration registration in `configure.swift`
```swift
app.migrations.add(Create{EntityName}())
```

## SwiftData Model (iOS/macOS)

```swift
import SwiftData
import Foundation

@Model
final class {EntityName}Model {
    @Attribute(.unique) var id: UUID
    var name: String
    var descriptionText: String?
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), name: String, description: String? = nil) {
        self.id = id
        self.name = name
        self.descriptionText = description
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

## Pure Swift Domain Struct

```swift
import Foundation

struct {EntityName}: Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var description: String?
    let createdAt: Date
    let updatedAt: Date
}

// Mapping from Fluent model
extension {EntityName} {
    init(from model: {EntityName}Model) {
        self.id = model.id ?? UUID()
        self.name = model.name
        self.description = model.description
        self.createdAt = model.createdAt ?? Date()
        self.updatedAt = model.updatedAt ?? Date()
    }
}

// Mapping from SwiftData model
extension {EntityName} {
    init(from model: {EntityName}SwiftDataModel) {
        self.id = model.id
        self.name = model.name
        self.description = model.descriptionText
        self.createdAt = model.createdAt
        self.updatedAt = model.updatedAt
    }
}
```

## Rules

- Keep Fluent/SwiftData persistence models separate from domain structs
- Domain structs must be `Sendable` for safe use with Swift concurrency
- Use `@Timestamp` for `created_at`/`updated_at` — never manage them manually
- Always provide `init()` on Fluent models (required by Fluent)
- Use `@Attribute(.unique)` in SwiftData for fields that must be unique
- Keep each layer in its own folder: `Models/`, `Domain/`, `DTOs/`, `Migrations/`

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)