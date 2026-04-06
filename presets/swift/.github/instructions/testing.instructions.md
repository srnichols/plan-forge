---
description: Swift testing patterns — XCTest, Swift Testing framework, ViewInspector, async tests
applyTo: '**/*Tests.swift,**/*Test.swift,**/Tests/**,**/Mocks/**'
---

# Swift Testing Patterns

## Tech Stack

- **Unit Tests**: XCTest (Swift 5.8 and earlier) or Swift Testing (`@Test`/`@Suite`, Swift 5.10+)
- **Assertions**: `XCTAssert*` or `#expect` (Swift Testing)
- **Mocking**: Protocol-based fakes (preferred over third-party mocking)
- **Integration**: Vapor `XCTVapor` / `testcontainers-swift`
- **SwiftUI Tests**: `ViewInspector`
- **E2E**: XCUITest (iOS) or custom HTTP client tests (Vapor)

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single function/type | Mocked/In-memory | Fast (ms) |
| **Integration** | Service + DB | Real (Vapor test app) | Medium (1-3s) |
| **UI/E2E** | Full screen flow | Real | Slow (10s+) |

## Patterns

### Unit Test (XCTest)
```swift
final class ItemServiceTests: XCTestCase {
    var sut: ItemService!
    var mockRepository: MockItemRepository!

    override func setUp() async throws {
        mockRepository = MockItemRepository()
        sut = ItemService(repository: mockRepository)
    }

    func testGetByID_whenFound_returnsItem() async throws {
        // Given
        let expected = Item(id: UUID(), name: "Widget")
        mockRepository.stubbedItem = expected

        // When
        let result = try await sut.getByID(expected.id!)

        // Then
        XCTAssertEqual(result.name, expected.name)
    }

    func testGetByID_whenNotFound_throwsNotFound() async throws {
        // Given
        mockRepository.stubbedItem = nil

        // When / Then
        do {
            _ = try await sut.getByID(UUID())
            XCTFail("Expected AppError.notFound")
        } catch AppError.notFound {
            // pass
        }
    }
}
```

### Unit Test (Swift Testing — Swift 5.10+)
```swift
@Suite("ItemService")
struct ItemServiceTests {
    let mockRepository = MockItemRepository()
    let sut: ItemService

    init() {
        sut = ItemService(repository: mockRepository)
    }

    @Test("returns item when found")
    func getByID_whenFound() async throws {
        let expected = Item(id: UUID(), name: "Widget")
        mockRepository.stubbedItem = expected

        let result = try await sut.getByID(expected.id!)

        #expect(result.name == expected.name)
    }

    @Test("throws notFound when missing")
    func getByID_whenNotFound() async throws {
        mockRepository.stubbedItem = nil

        await #expect(throws: AppError.notFound) {
            _ = try await sut.getByID(UUID())
        }
    }
}
```

### Vapor Integration Test (XCTVapor)
```swift
@testable import App
import XCTVapor

final class ItemRouteTests: XCTestCase {
    var app: Application!

    override func setUp() async throws {
        app = try await Application.make(.testing)
        try await configure(app)
        try await app.autoMigrate()
    }

    override func tearDown() async throws {
        try await app.autoRevert()
        await app.asyncShutdown()
    }

    func testListItems_returnsOK() async throws {
        try await app.test(.GET, "/items") { res async in
            XCTAssertEqual(res.status, .ok)
            let items = try res.content.decode([ItemResponse].self)
            XCTAssertNotNil(items)
        }
    }

    func testCreateItem_returnsCreated() async throws {
        let dto = CreateItemRequest(name: "Widget")
        try await app.test(.POST, "/items", beforeRequest: { req in
            try req.content.encode(dto)
        }, afterResponse: { res async in
            XCTAssertEqual(res.status, .created)
        })
    }
}
```

### Protocol-Based Mock
```swift
// Protocol
protocol ItemRepository {
    func find(id: UUID) async throws -> Item?
    func fetchAll() async throws -> [Item]
    func save(_ item: Item) async throws -> Item
}

// Fake
final class MockItemRepository: ItemRepository {
    var stubbedItem: Item?
    var savedItems: [Item] = []

    func find(id: UUID) async throws -> Item? { stubbedItem }
    func fetchAll() async throws -> [Item] { savedItems }
    func save(_ item: Item) async throws -> Item {
        savedItems.append(item)
        return item
    }
}
```

### SwiftUI Test (ViewInspector)
```swift
import ViewInspector

final class ItemListViewTests: XCTestCase {
    func testShowsLoadingIndicator_whenLoading() throws {
        let vm = ItemListViewModel(service: MockItemService())
        let view = ItemListView(viewModel: vm)

        XCTAssertNoThrow(try view.inspect().find(ViewType.ProgressView.self))
    }
}
```

## Conventions

- Test file: `{TypeName}Tests.swift` (separate `Tests/` target)
- Test function: `test{Method}_{Scenario}` (XCTest) or descriptive string (Swift Testing)
- Use `setUp`/`tearDown` for test fixtures (XCTest) or `init` (Swift Testing)
- Use in-memory SQLite for integration tests when possible (`DatabaseConfigurationFactory.sqlite(.memory)`)

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `swift build` passes with zero errors
- [ ] `swift test` — all pass
- [ ] Anti-pattern grep: `grep -rn 'try!' --include="*.swift" Sources/` returns zero hits
- [ ] Anti-pattern grep: `grep -rn 'XCTFail\b' --include="*.swift" Tests/` — only in error paths
```

## See Also

- `api-patterns.instructions.md` — Vapor route testing, request/response
- `database.instructions.md` — Fluent test databases, migration testing
- `errorhandling.instructions.md` — Error assertion patterns
