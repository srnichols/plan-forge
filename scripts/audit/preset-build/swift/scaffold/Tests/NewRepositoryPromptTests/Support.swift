import Foundation
import Fluent
import Vapor
import App

// Stand-ins for the repository sample in new-repository.prompt.md. The sample
// references `OrderModel` and `Order(from:)`, which come from the Fluent Model
// and "Mapping from Fluent model" blocks of new-entity.prompt.md — those blocks
// are mapped into the separate NewEntityPromptTests target, so this standalone
// repository-pattern target needs its own copies to reference them.
final class OrderModel: Model, Content, @unchecked Sendable {
    static let schema = "orders"

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

extension Order {
    init(from model: OrderModel) {
        self.init(
            id: model.id ?? UUID(),
            name: model.name,
            description: model.description,
            createdAt: model.createdAt ?? Date(),
            updatedAt: model.updatedAt ?? Date()
        )
    }
}

