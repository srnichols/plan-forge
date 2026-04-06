---
description: "Fix a bug using TDD: write a failing XCTest or Swift Testing test first, implement the minimal fix, then refactor."
agent: "agent"
tools: [read, edit, search, execute]
---
# Fix Bug with TDD

Follow the Red-Green-Refactor cycle to fix a bug with a regression test.

## Process

### Step 1: Understand the Bug
- Read the relevant source files
- Identify the root cause
- Determine which layer the bug is in (Controller / Service / Repository)

### Step 2: RED — Write Failing Test

#### XCTest
```swift
// Regression test for bug #123 — negative prices caused overflow
func testCalculateDiscount_withNegativePrice_throwsValidationError() async throws {
    // Given
    let sut = PricingService(repository: MockPricingRepository())

    // When / Then
    await XCTAssertThrowsErrorAsync(try await sut.calculateDiscount(price: -10.0, percent: 20)) { error in
        XCTAssertTrue(error is PricingServiceError, "Expected PricingServiceError, got \(error)")
    }
}
```

#### Swift Testing
```swift
@Test("negative price throws validationFailed — regression #123")
func calculateDiscount_withNegativePrice_throwsValidationFailed() async throws {
    let sut = PricingService(repository: MockPricingRepository())

    await #expect(throws: PricingServiceError.validationFailed("")) {
        try await sut.calculateDiscount(price: -10.0, percent: 20)
    }
}
```

Run the test — it **MUST fail** before you write the fix:
```bash
swift test --filter testCalculateDiscount_withNegativePrice
```

### Step 3: GREEN — Implement the Minimal Fix

```swift
func calculateDiscount(price: Double, percent: Int) async throws -> Double {
    guard price >= 0 else {
        throw PricingServiceError.validationFailed("price must not be negative")
    }
    return price * (1.0 - Double(percent) / 100.0)
}
```

Run again — the test MUST now pass.

### Step 4: REFACTOR — Clean Up
- Remove duplication introduced during the fix
- Ensure existing tests still pass: `swift test`

### Step 5: Verify
```bash
# Full test suite
swift test

# With Thread Sanitizer (recommended for actor/async code)
swift test --sanitize=thread

# Lint check
swiftlint
```

## XCTAssertThrowsError for async — Helper

```swift
// Add to XCTestCase or a TestHelpers file
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
```

## Architecture Rules

- NO business logic in controllers — fix in the service layer
- NO direct data access in services — fix in the repository layer
- Throw typed domain errors — never untyped `NSError`
- Use `actor` isolation to fix data races — never add locks manually

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
