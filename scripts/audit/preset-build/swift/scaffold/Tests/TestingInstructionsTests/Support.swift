import Foundation
func XCTAssertThrowsErrorAsync<T>(_ expression: @escaping () async throws -> T, _ handler: (Error) -> Void) async {
    do { _ = try await expression() } catch { handler(error) }
}
