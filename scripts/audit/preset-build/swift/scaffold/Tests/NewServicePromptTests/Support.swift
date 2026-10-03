import Foundation

struct OrderResponse: Sendable {
    let name: String
}

struct CreateOrderRequest: Sendable {
    let name: String
}

struct UpdateOrderRequest: Sendable {
    let name: String
}
