---
description: "Scaffold a Swift service actor/class with a protocol interface, typed errors, input validation, and OSLog logging."
agent: "agent"
tools: [read, edit, search]
---
# Create New Service

Scaffold a Swift service following actor-based concurrency, protocol-oriented design, and typed errors.

## Required Pattern

### Protocol Definition
```swift
import Foundation

protocol {EntityName}ServiceProtocol: Sendable {
    func getByID(_ id: UUID) async throws -> {EntityName}Response
    func list() async throws -> [{EntityName}Response]
    func create(_ input: Create{EntityName}Request) async throws -> {EntityName}Response
    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName}Response
    func delete(id: UUID) async throws
}
```

### Actor Implementation
```swift
import Foundation
import OSLog

actor {EntityName}Service: {EntityName}ServiceProtocol {
    private let repository: {EntityName}RepositoryProtocol
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "app", category: "{EntityName}Service")

    init(repository: {EntityName}RepositoryProtocol) {
        self.repository = repository
    }

    func getByID(_ id: UUID) async throws -> {EntityName}Response {
        logger.debug("Fetching {entityName} with id: \(id)")
        let entity = try await repository.findByID(id)
        guard let entity else { throw {EntityName}ServiceError.notFound(id) }
        return {EntityName}Response(from: entity)
    }

    func list() async throws -> [{EntityName}Response] {
        let entities = try await repository.findAll()
        return entities.map { {EntityName}Response(from: $0) }
    }

    func create(_ input: Create{EntityName}Request) async throws -> {EntityName}Response {
        try input.validate()
        logger.info("Creating {entityName} with name: \(input.name)")
        let entity = try await repository.insert(input)
        return {EntityName}Response(from: entity)
    }

    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName}Response {
        try input.validate()
        guard try await repository.findByID(id) != nil else {
            throw {EntityName}ServiceError.notFound(id)
        }
        let updated = try await repository.update(id: id, input: input)
        return {EntityName}Response(from: updated)
    }

    func delete(id: UUID) async throws {
        guard try await repository.findByID(id) != nil else {
            throw {EntityName}ServiceError.notFound(id)
        }
        try await repository.delete(id: id)
        logger.info("Deleted {entityName} with id: \(id)")
    }
}
```

### Typed Service Errors
```swift
enum {EntityName}ServiceError: Error, LocalizedError {
    case notFound(UUID)
    case validationFailed(String)
    case conflict(String)

    var errorDescription: String? {
        switch self {
        case .notFound(let id):          return "{EntityName} with id '\(id)' was not found."
        case .validationFailed(let msg): return "Validation failed: \(msg)"
        case .conflict(let msg):         return "Conflict: \(msg)"
        }
    }
}
```

### Input Validation
```swift
extension Create{EntityName}Request {
    func validate() throws {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw {EntityName}ServiceError.validationFailed("name must not be empty")
        }
        guard name.count <= 255 else {
            throw {EntityName}ServiceError.validationFailed("name must be 255 characters or fewer")
        }
    }
}
```

## Rules

- ALL business logic lives in the service — not in controllers or repositories
- Use `actor` for thread-safe service implementations
- Define a `Protocol` for every service to enable testing and dependency injection
- Validate input at the service boundary before calling repository methods
- Use `OSLog` (`Logger`) for structured, privacy-aware logging
- Throw typed domain errors — never raw `NSError` or untyped `Error`
- Services must conform to `Sendable` through the protocol

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)