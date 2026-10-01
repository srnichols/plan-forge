---
description: "Scaffold an XCTest or Swift Testing test with mocks, async/throws, and Given-When-Then structure."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Test

Scaffold test files following Swift 6 testing conventions with Swift Testing for new unit tests and XCTest/XCTVapor for Vapor integration tests.

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
        await mockRepository.setStubbedFindByID({EntityName}(id: id, name: "Widget", description: nil, createdAt: .now, updatedAt: .now))

        // When
        let result = try await sut.getByID(id)

        // Then
        XCTAssertEqual(result.name, "Widget")
    }

    func testGetByID_whenEntityMissing_throwsNotFound() async throws {
        // Given
        let id = UUID()
        await mockRepository.setStubbedFindByID(nil)

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
        await mockRepository.setStubbedInsert(created)

        // When
        let result = try await sut.create(input)

        // Then
        XCTAssertEqual(result.name, "Widget")
        let insertCalled = await mockRepository.wasInsertCalled()
        XCTAssertTrue(insertCalled)
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
        await mockRepository.setStubbedFindByID({EntityName}(id: id, name: "Widget", description: nil, createdAt: .now, updatedAt: .now))

        let result = try await sut.getByID(id)

        #expect(result.name == "Widget")
    }

    @Test("throws notFound when entity is missing")
    func getByID_throwsNotFound() async throws {
        await mockRepository.setStubbedFindByID(nil)

        await #expect(throws: {EntityName}ServiceError.self) {
            try await sut.getByID(UUID())
        }
    }

    @Test("throws validationFailed for empty name", arguments: ["", "   "])
    func create_throwsValidationFailed(name: String) async throws {
        let input = Create{EntityName}Request(name: name, description: nil)

        await #expect(throws: {EntityName}ServiceError.self) {
            try await sut.create(input)
        }
    }
}
```

## Mock / Fake Protocol Implementation

```swift
actor Mock{EntityName}Repository: {EntityName}RepositoryProtocol {
    private var stubbedFindByID: {EntityName}?
    private var stubbedInsert: {EntityName}?
    private var insertCalled = false
    private var deleteCalled = false

    func setStubbedFindByID(_ value: {EntityName}?) {
        stubbedFindByID = value
    }

    func setStubbedInsert(_ value: {EntityName}?) {
        stubbedInsert = value
    }

    func wasInsertCalled() -> Bool { insertCalled }
    func wasDeleteCalled() -> Bool { deleteCalled }

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
- Create actor-isolated `Mock` implementations of protocols for unit testing — not subclasses
- Prefer Swift Testing `@Test`/`@Suite` for new unit test files; use XCTest/XCTVapor for Vapor integration tests
- Swift Testing runs tests in parallel by default; avoid shared mutable state, or use `.serialized` only as a temporary bridge for legacy tests
- Never test implementation details — test observable behaviour

## Reference Files

- [Testing instructions](../instructions/testing.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
