import Foundation
import Vapor
import Fluent

struct Item {}

struct ItemResponse {
    init(from item: Item) {}
}

struct ItemService {
    func find(id: UUID, on db: Database) async throws -> Item? { Item() }
}

let service = ItemService()
