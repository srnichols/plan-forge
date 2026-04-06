---
description: "Scaffold a Swift repository/data access layer using Fluent (Vapor) or SwiftData with protocol abstraction and error mapping."
agent: "agent"
tools: [read, edit, search]
---
# Create New Repository

Scaffold a data access repository with a protocol interface, async/throws methods, and domain error mapping.

## Required Pattern

### Protocol Definition
```swift
import Foundation

protocol {EntityName}RepositoryProtocol: Sendable {
    func findByID(_ id: UUID) async throws -> {EntityName}?
    func findAll() async throws -> [{EntityName}]
    func insert(_ input: Create{EntityName}Request) async throws -> {EntityName}
    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName}
    func delete(id: UUID) async throws
}
```

### Fluent (Vapor) Implementation
```swift
import Fluent
import Vapor

struct {EntityName}FluentRepository: {EntityName}RepositoryProtocol {
    let database: Database

    func findByID(_ id: UUID) async throws -> {EntityName}? {
        try await {EntityName}Model.find(id, on: database)
            .map { {EntityName}(from: $0) }
    }

    func findAll() async throws -> [{EntityName}] {
        try await {EntityName}Model.query(on: database)
            .sort(\.$createdAt, .descending)
            .all()
            .map { {EntityName}(from: $0) }
    }

    func insert(_ input: Create{EntityName}Request) async throws -> {EntityName} {
        let model = {EntityName}Model()
        model.name = input.name
        model.description = input.description
        try await model.save(on: database)
        return {EntityName}(from: model)
    }

    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName} {
        guard let model = try await {EntityName}Model.find(id, on: database) else {
            throw {EntityName}RepositoryError.notFound(id)
        }
        model.name = input.name
        model.description = input.description
        try await model.save(on: database)
        return {EntityName}(from: model)
    }

    func delete(id: UUID) async throws {
        guard let model = try await {EntityName}Model.find(id, on: database) else {
            throw {EntityName}RepositoryError.notFound(id)
        }
        try await model.delete(on: database)
    }
}
```

### SwiftData (iOS/macOS) Implementation
```swift
import SwiftData
import Foundation

@MainActor
final class {EntityName}SwiftDataRepository: {EntityName}RepositoryProtocol {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func findByID(_ id: UUID) async throws -> {EntityName}? {
        let descriptor = FetchDescriptor<{EntityName}Model>(
            predicate: #Predicate { $0.id == id }
        )
        return try modelContext.fetch(descriptor).first.map { {EntityName}(from: $0) }
    }

    func findAll() async throws -> [{EntityName}] {
        let descriptor = FetchDescriptor<{EntityName}Model>(
            sortBy: [SortDescriptor(\{EntityName}Model.createdAt, order: .reverse)]
        )
        return try modelContext.fetch(descriptor).map { {EntityName}(from: $0) }
    }

    func insert(_ input: Create{EntityName}Request) async throws -> {EntityName} {
        let model = {EntityName}Model(name: input.name, description: input.description)
        modelContext.insert(model)
        try modelContext.save()
        return {EntityName}(from: model)
    }

    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName} {
        guard let model = try findByIDModel(id) else {
            throw {EntityName}RepositoryError.notFound(id)
        }
        model.name = input.name
        model.description = input.description
        try modelContext.save()
        return {EntityName}(from: model)
    }

    func delete(id: UUID) async throws {
        guard let model = try findByIDModel(id) else {
            throw {EntityName}RepositoryError.notFound(id)
        }
        modelContext.delete(model)
        try modelContext.save()
    }

    private func findByIDModel(_ id: UUID) throws -> {EntityName}Model? {
        let descriptor = FetchDescriptor<{EntityName}Model>(
            predicate: #Predicate { $0.id == id }
        )
        return try modelContext.fetch(descriptor).first
    }
}
```

### Domain Error Mapping
```swift
enum {EntityName}RepositoryError: Error, LocalizedError {
    case notFound(UUID)
    case saveFailed(Error)

    var errorDescription: String? {
        switch self {
        case .notFound(let id):    return "{EntityName} with id '\(id)' not found."
        case .saveFailed(let err): return "Save failed: \(err.localizedDescription)"
        }
    }
}
```

## Rules

- Repositories handle data access ONLY — no business logic
- Define a `Protocol` for every repository to enable unit testing with fakes
- Map Fluent/SwiftData errors to domain-specific typed errors
- Use `async throws` for all data access methods
- Never return `nil` for required entities — throw `.notFound` instead
- Keep Fluent models (`{EntityName}Model`) separate from domain types (`{EntityName}`)

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
