import Foundation

// The "Validation in Vapor Handler" block (new-dto.prompt.md) assumes a
// `service` value is already in scope — in the real doc sequence this would
// be a controller property (see new-controller.prompt.md), but this prompt
// is illustrative of DTO validation alone. Provide a minimal top-level stand-in
// so `service.create(input)` type-checks against this file's local
// CreateOrderRequest/OrderResponse shapes.
struct OrderCreationService: Sendable {
    func create(_ input: CreateOrderRequest) async throws -> OrderResponse {
        fatalError("illustrative stand-in — not exercised by any test")
    }
}

let service = OrderCreationService()

