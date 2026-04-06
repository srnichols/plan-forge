---
description: "Scaffold an XCTest or Swift Testing test with mocks, async/throws, and Given-When-Then structure."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files following Swift testing conventions with XCTest or the new Swift Testing framework.

## Test Naming Convention

```
// XCTest: test{Function}_{Condition}
// Swift Testing: descriptive string in @Test("...")
```

Examples:
- `testCreateProduct_withEmptyName_throwsValidationError`
- `testGetByID_whenNotFound_throwsNotFound`
- `@Test("calculate total applies discount correctly")`

## XCTest Pattern (Class-Based)

```swift
import XCTest
@testable import {ModuleName}

final class {EntityName}ServiceTests: XCTestCase {
    var sut: {EntityName}Service!
    var mockRepository: Mock{EntityName}Repository!

    override func setUp() async throws {
        try await super.setUp()
        mockRepository = Mock{EntityName}Repository()
        sut = {EntityName}Service(repository: mockRepository)
    }

    override func tearDown() async throws {
        sut = nil
        mockRepository = nil
        try await super.tearDown()
    }

    // MARK: - getByID

    func testGetByID_whenEntityExists_returnsResponse() async throws {
        // Given
        let id = UUID()
        mockRepository.stubbedFindByID = {EntityName}(id: id, name: "Widget", description: nil, createdAt: .now, updatedAt: .now)

        // When
        let result = try await sut.getByID(id)

        // Then
        XCTAssertEqual(result.name, "Widget")
    }

    func testGetByID_whenEntityMissing_throwsNotFound() async throws {
        // Given
        let id = UUID()
        mockRepository.stubbedFindByID = nil

        // When / Then
        await XCTAssertThrowsErrorAsync(try await sut.getByID(id)) { error in
            guard case {EntityName}ServiceError.notFound = error else {
                XCTFail("Expected notFound, got \(error)")
                return
            }
        }
    }

    func testCreate_withValidInput_returnsCreatedResponse() async throws {
        // Given
        let input = Create{EntityName}Request(name: "Widget", description: nil)
        let created = {EntityName}(id: UUID(), name: "Widget", description: nil, createdAt: .now, updatedAt: .now)
        mockRepository.stubbedInsert = created

        // When
        let result = try await sut.create(input)

        // Then
        XCTAssertEqual(result.name, "Widget")
        XCTAssertTrue(mockRepository.insertCalled)
    }

    func testCreate_withEmptyName_throwsValidationError() async throws {
        // Given
        let input = Create{EntityName}Request(name: "", description: nil)

        // When / Then
        await XCTAssertThrowsErrorAsync(try await sut.create(input)) { error in
            guard case {EntityName}ServiceError.validationFailed = error else {
                XCTFail("Expected validationFailed, got \(error)")
                return
            }
        }
    }
}
```

## Swift Testing Pattern (@Suite / @Test)

```swift
import Testing
@testable import {ModuleName}

@Suite("{EntityName}Service")
struct {EntityName}ServiceTests {
    let mockRepository: Mock{EntityName}Repository
    let sut: {EntityName}Service

    init() {
        mockRepository = Mock{EntityName}Repository()
        sut = {EntityName}Service(repository: mockRepository)
    }

    @Test("returns response when entity exists")
    func getByID_returnsResponse() async throws {
        let id = UUID()
        mockRepository.stubbedFindByID = {EntityName}(id: id, name: "Widget", description: nil, createdAt: .now, updatedAt: .now)

        let result = try await sut.getByID(id)

        #expect(result.name == "Widget")
    }

    @Test("throws notFound when entity is missing")
    func getByID_throwsNotFound() async throws {
        mockRepository.stubbedFindByID = nil

        await #expect(throws: {EntityName}ServiceError.notFound(UUID())) {
            try await sut.getByID(UUID())
        }
    }

    @Test("throws validationFailed for empty name", arguments: ["", "   "])
    func create_throwsValidationFailed(name: String) async throws {
        let input = Create{EntityName}Request(name: name, description: nil)

        await #expect(throws: (any Error).self) {
            try await sut.create(input)
        }
    }
}
```

## Mock / Fake Protocol Implementation

```swift
final class Mock{EntityName}Repository: {EntityName}RepositoryProtocol {
    var stubbedFindByID: {EntityName}?
    var stubbedInsert: {EntityName}?
    var insertCalled = false
    var deleteCalled = false

    func findByID(_ id: UUID) async throws -> {EntityName}? { stubbedFindByID }
    func findAll() async throws -> [{EntityName}] { [] }
    func insert(_ input: Create{EntityName}Request) async throws -> {EntityName} {
        insertCalled = true
        return stubbedInsert ?? {EntityName}(id: UUID(), name: input.name, description: nil, createdAt: .now, updatedAt: .now)
    }
    func update(id: UUID, input: Update{EntityName}Request) async throws -> {EntityName} {
        return stubbedInsert ?? {EntityName}(id: id, name: input.name, description: nil, createdAt: .now, updatedAt: .now)
    }
    func delete(id: UUID) async throws { deleteCalled = true }
}
```

## Rules

- Use `XCTUnwrap` instead of force-unwrap (`!`) in tests
- Use `async throws` test methods for async code — never wrap with `Task { }`
- Follow Given-When-Then structure with `// Given`, `// When`, `// Then` comments
- Create `Mock` implementations of protocols for unit testing — not subclasses
- Prefer Swift Testing `@Test`/`@Suite` for new test files; use XCTest for Vapor integration tests
- Never test implementation details — test observable behaviour

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
