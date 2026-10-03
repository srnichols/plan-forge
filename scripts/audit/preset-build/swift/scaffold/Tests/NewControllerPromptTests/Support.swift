import Foundation
import Vapor
import App

// Stand-ins for the controller sample in new-controller.prompt.md. The prompt's
// OrderController references `OrderServiceProtocol` and `OrderResponse`, which
// are introduced by the new-service.prompt.md / new-dto.prompt.md companion
// docs in the same prompt sequence rather than redeclared here — define
// minimal equivalents so this standalone harness target can compile the
// controller sample on its own.
protocol OrderServiceProtocol: Sendable {
    func list() async throws -> [OrderResponse]
    func getByID(_ id: UUID) async throws -> OrderResponse
    func create(_ input: CreateOrderRequest) async throws -> OrderResponse
    func update(id: UUID, input: UpdateOrderRequest) async throws -> OrderResponse
    func delete(id: UUID) async throws
}

struct OrderResponse: Content, Sendable {
    var id: UUID
    var name: String
}

