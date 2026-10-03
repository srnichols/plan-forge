import Foundation
import Fluent

struct Item {
    let id: UUID?
}

struct ItemResponse {
    init(from item: Item) {}
}

struct ItemRepository {
    func findLatest() async throws -> Item { Item(id: UUID()) }
    func save(_ item: Item) async throws {}
}

struct ItemService {
    func find(id: UUID, on db: Database) async throws -> Item? { Item(id: id) }
}

let repository = ItemRepository()
let service = ItemService()
