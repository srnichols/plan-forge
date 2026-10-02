import Testing
@testable import App

@Test("app support compiles")
func appSupportCompiles() async throws {
    let order = try await OrderService.shared.create(CreateOrderRequest(name: "Widget"))
    #expect(order.name == "Widget")
}
