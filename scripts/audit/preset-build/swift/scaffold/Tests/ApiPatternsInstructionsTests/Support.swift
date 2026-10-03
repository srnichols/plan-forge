import Foundation
import Vapor
import Fluent
import App

// The api-patterns samples use an Item model, an ItemService, auth middleware
// and a second controller that the instructions assume but never declare.

final class Item: Model, @unchecked Sendable {
    static let schema = "items"

    @ID(key: .id) var id: UUID?
    @Field(key: "name") var name: String
    @Field(key: "price_usd") var priceUSD: Double
    @Field(key: "tags") var tags: [String]
    @Timestamp(key: "created_at", on: .create) var createdAt: Date?

    init() {}

    init(name: String, priceUSD: Double, tags: [String]) {
        self.name = name
        self.priceUSD = priceUSD
        self.tags = tags
    }
}

struct ItemService: Sendable {
    func find(id: UUID, on db: Database) async throws -> Item? {
        try await Item.find(id, on: db)
    }

    func create(_ dto: CreateItemRequest, on db: Database) async throws -> Item {
        let item = Item(name: dto.name, priceUSD: dto.priceUSD, tags: dto.tags)
        try await item.create(on: db)
        return item
    }

    func update(id: UUID, with dto: UpdateItemRequest, on db: Database) async throws -> ItemResponse {
        guard let item = try await Item.find(id, on: db) else { throw Abort(.notFound) }
        if let name = dto.name { item.name = name }
        if let priceUSD = dto.priceUSD { item.priceUSD = priceUSD }
        try await item.update(on: db)
        return ItemResponse(from: item)
    }

    func delete(id: UUID, on db: Database) async throws {
        try await Item.find(id, on: db)?.delete(on: db)
    }
}

struct UserAuthMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        try await next.respond(to: request)
    }
}

struct UserController: RouteCollection {
    let service: UserService
    func boot(routes: RoutesBuilder) throws {}
}

extension Application {
    var itemService: ItemService { ItemService() }
    var userService: UserService { .shared }
}
