---
description: "Scaffold a Vapor 4 RouteCollection controller with async/throws handlers, request decoding, and service delegation."
agent: "agent"
tools: [read, edit, search]
---
# Create New Controller (Vapor RouteCollection)

Scaffold a Vapor 4 `RouteCollection` that handles HTTP concerns only and delegates all logic to services.

## Required Pattern

```swift
import Vapor

struct {EntityName}Controller: RouteCollection {
    let service: {EntityName}ServiceProtocol

    init(service: {EntityName}ServiceProtocol) {
        self.service = service
    }

    func boot(routes: RoutesBuilder) throws {
        let {entityName}s = routes.grouped("{entityName}s")
        {entityName}s.get(use: list)
        {entityName}s.post(use: create)
        {entityName}s.group(":id") { item in
            item.get(use: getByID)
            item.put(use: update)
            item.delete(use: delete)
        }
    }

    // GET /{entityName}s
    func list(req: Request) async throws -> [{EntityName}Response] {
        return try await service.list()
    }

    // GET /{entityName}s/:id
    func getByID(req: Request) async throws -> {EntityName}Response {
        guard let id = req.parameters.get("id", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID format")
        }
        return try await service.getByID(id)
    }

    // POST /{entityName}s
    func create(req: Request) async throws -> Response {
        let input = try req.content.decode(Create{EntityName}Request.self)
        let created = try await service.create(input)
        return try await created.encodeResponse(status: .created, for: req)
    }

    // PUT /{entityName}s/:id
    func update(req: Request) async throws -> {EntityName}Response {
        guard let id = req.parameters.get("id", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID format")
        }
        let input = try req.content.decode(Update{EntityName}Request.self)
        return try await service.update(id: id, input: input)
    }

    // DELETE /{entityName}s/:id
    func delete(req: Request) async throws -> HTTPStatus {
        guard let id = req.parameters.get("id", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid UUID format")
        }
        try await service.delete(id: id)
        return .noContent
    }
}
```

### Registration in `configure.swift`
```swift
try app.register(collection: {EntityName}Controller(service: {EntityName}Service(repository: repo)))
```

## Rules

- Controllers handle HTTP concerns ONLY — no business logic
- Delegate ALL work to services via protocol dependencies
- Use `req.content.decode()` for request body decoding
- Throw `Abort(.notFound)`, `Abort(.badRequest)` etc. for HTTP errors
- Use `req.parameters.get("id", as: UUID.self)` for type-safe path parameter parsing
- Return `HTTPStatus.noContent` (204) for successful deletes

## Error Mapping

| Domain Error | Abort Status |
|--------------|-------------|
| `notFound` | `.notFound` (404) |
| `validationFailed` | `.badRequest` (400) |
| `conflict` | `.conflict` (409) |
| `unauthorized` | `.unauthorized` (401) |
| `forbidden` | `.forbidden` (403) |

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)