import Foundation
import XCTest

func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ message: String = "",
    file: StaticString = #filePath,
    line: UInt = #line,
    _ errorHandler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail("Expected error to be thrown" + (message.isEmpty ? "" : ": \(message)"), file: file, line: line)
    } catch {
        errorHandler(error)
    }
}

enum PricingServiceError: Error {
    case validationFailed(String)
}

protocol PricingRepository: Sendable {}

struct MockPricingRepository: PricingRepository {}

actor PricingService {
    init(repository: any PricingRepository) {}

    func calculateDiscount(price: Double, percent: Int) async throws -> Double {
        guard price >= 0 else {
            throw PricingServiceError.validationFailed("price must not be negative")
        }
        return price * (1.0 - Double(percent) / 100.0)
    }
}
