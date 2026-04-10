---
description: Swift testing patterns — XCTest, async tests, Vapor test helpers, mocking with protocols
applyTo: '**/*Tests.swift,**/*Test.swift,**/Tests/**,**/Mocks/**'
---

# Swift Testing Patterns

## Tech Stack

- **Unit Tests**: `XCTest` framework
- **Assertions**: `XCTAssert*` functions
- **Mocking**: Protocol-based fakes (preferred over mocking frameworks)
- **Integration (Vapor)**: `XCTVapor` — `Application` in `.testing` environment
- **Async tests**: `async` test methods with `await`
- **UI Tests**: `XCUITest` (separate target)

## Test Types

| Type | Scope | Database | Speed |
|------|-------|----------|-------|
| **Unit** | Single function/type | Mocked (protocol fake) | Fast (ms) |
| **Integration** | Service + DB | Real (in-memory SQLite or test Postgres) | Medium (1-3s) |
| **API (Vapor)** | Full HTTP round-trip | Real (XCTVapor) | Medium (1-3s) |
| **E2E / UI** | Full app flow | Real | Slow (10s+) |

## Patterns

### Unit Test (XCTest)
```swift
final class UserServiceTests: XCTestCase {

    func testGetUser_withValidID_returnsUser() async throws {
        // Arrange
        let fakeRepo = FakeUserRepository()
        let testUser = User(id: UUID(), name: "Test User", email: "test@example.com")
        fakeRepo.users[testUser.id!] = testUser
        let sut = UserService(repository: fakeRepo)

        // Act
        let result = try await sut.getUser(id: testUser.id!)

        // Assert
        XCTAssertEqual(result.name, "Test User")
    }

    func testGetUser_withUnknownID_throwsNotFound() async {
        let fakeRepo = FakeUserRepository()
        let sut = UserService(repository: fakeRepo)

        do {
            _ = try await sut.getUser(id: UUID())
            XCTFail("Expected error to be thrown")
        } catch AppError.notFound {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

// Protocol-based fake
final class FakeUserRepository: UserRepository {
    var users: [UUID: User] = [:]

    func find(id: UUID) async throws -> User? {
        return users[id]
    }

    func save(_ user: User) async throws {
        users[user.id!] = user
    }
}
```

### Integration Test (XCTVapor)
```swift
@testable import App
import XCTVapor

final class UserAPITests: XCTestCase {
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

    func testCreateUser_returnsCreated() async throws {
        let body = CreateUserRequest(name: "Alice", email: "alice@example.com")

        try await app.test(.POST, "/api/users", beforeRequest: { req in
            try req.content.encode(body)
        }, afterResponse: { res async throws in
            XCTAssertEqual(res.status, .created)
            let user = try res.content.decode(UserResponse.self)
            XCTAssertEqual(user.name, "Alice")
        })
    }

    func testGetUser_notFound_returns404() async throws {
        try await app.test(.GET, "/api/users/\(UUID())", afterResponse: { res async throws in
            XCTAssertEqual(res.status, .notFound)
        })
    }
}
```

### Async Test Pattern
```swift
func testLoadUsers_setsUsersOnSuccess() async throws {
    // Arrange
    let mockService = MockUserService()
    mockService.usersToReturn = [User(id: UUID(), name: "Bob")]
    let viewModel = UserListViewModel(userService: mockService)

    // Act
    await viewModel.loadUsers()

    // Assert
    XCTAssertEqual(viewModel.users.count, 1)
    XCTAssertFalse(viewModel.hasError)
}
```

### E2E Anti-Patterns
```
❌ Tests that depend on execution order — each test must be self-contained
❌ No teardown — always revert migrations or wipe test state in tearDown
❌ Missing async/await — all async test methods must be marked async throws
❌ Force-unwraps in tests without clear intent — use XCTUnwrap() instead
❌ Shared mutable state between tests — use setUp/tearDown to reset
```

## Conventions

- Test file: `{TypeName}Tests.swift` in a dedicated test target
- Test method: `test{MethodName}_{scenario}_{expectedOutcome}`
- Use `XCTUnwrap()` instead of force-unwrapping in tests
- Use `setUp() async throws` and `tearDown() async throws` for async setup
- Use `@testable import` for white-box access to internal types

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `swift build` passes with zero errors
- [ ] `swift test` — all pass
- [ ] `swift test --sanitize=thread` — no race conditions
- [ ] No `try!` in production sources: `grep -rn 'try!' Sources/ App/`
- [ ] No force-unwraps in production sources: `grep -rn '[^!]=\s*[^!]*![^=!]' Sources/ App/`
```

## See Also

- `api-patterns.instructions.md` — Vapor route testing, XCTVapor
- `database.instructions.md` — Fluent test database setup, auto-migrate
- `errorhandling.instructions.md` — Error assertion patterns
---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This function is too simple to test" | Simple functions get modified later. The test documents the contract and catches regressions when someone changes the "simple" logic. |
| "I'll add tests after the feature works" | Technical debt compounds exponentially. Red-Green-Refactor means the test exists before the implementation. |
| "The integration test covers this unit" | Integration tests are slow, don't pinpoint failures, and can't run in CI quickly. Unit tests are the foundation of the test pyramid. |
| "This is just a struct/model — no logic to test" | Codable conformance, computed properties, and validation logic are testable. Test that decoding rejects invalid JSON, that defaults are correct. |
| "Mocking this dependency is too complex" | If it's hard to mock, the design has too much coupling. Define a protocol and inject — don't skip the test. |
| "One test for the happy path is enough" | Edge cases cause production incidents. Test nil inputs, empty arrays, boundary values, and async throwing paths. |

---

## Warning Signs

- A test class has fewer `func test` methods than the type under test has public methods (coverage gap)
- Test names describe implementation (`testCallsRepository`) instead of behavior (`testGetUser_withInvalidID_throwsNotFound`)
- Tests use `Thread.sleep` or `Task.sleep` with hardcoded durations instead of XCTest expectations
- No test plan or scheme configuration — unable to filter unit vs integration tests
- Setup in `setUp()` is longer than 15 lines (test is testing too much or setup needs extraction)
- Tests directly instantiate concrete dependencies instead of using protocol-based mocks
