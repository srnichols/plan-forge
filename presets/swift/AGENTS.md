# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>  
> **Stack**: Swift 5.9+ / SwiftUI / Vapor  
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Follow proper layering (View → ViewModel → Service → Repository)
2. **TDD for Business Logic** — Red-Green-Refactor
3. **Error Handling** — Always `try`/`catch`; never force-try (`try!`) in production
4. **Swift Concurrency** — Use `async`/`await` and `actor`; no callback pyramids

---

## Background Task Pattern

### Template: Actor-Based Background Worker

```swift
actor BackgroundWorker {
    private let logger = Logger(label: "BackgroundWorker")
    private let service: MyService

    init(service: MyService) {
        self.service = service
    }

    func run() async {
        while !Task.isCancelled {
            do {
                try await service.processPending()
            } catch {
                logger.error("Worker iteration failed: \(error)")
            }
            try? await Task.sleep(for: .seconds(300))
        }
        logger.info("Worker shutting down")
    }
}
```

### Template: AsyncStream Consumer

```swift
actor EventConsumer {
    private let logger = Logger(label: "EventConsumer")

    func consume(events: AsyncStream<Event>) async {
        for await event in events {
            guard !Task.isCancelled else { break }
            do {
                try await processEvent(event)
            } catch {
                logger.error("Failed to process event \(event.id): \(error)")
            }
        }
    }

    private func processEvent(_ event: Event) async throws {
        // process event
    }
}
```

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Periodic Workers** | Scheduled processing | `actor` + `Task.sleep` loop |
| **Stream Consumers** | Event/message processing | `actor` + `AsyncStream` |
| **Vapor Controllers** | HTTP request handling | `RouteCollection` |
| **Health Monitors** | System health checks | `/health` + `/ready` endpoints |

---

## Communication Patterns

### AsyncStream (In-Process)
```
Producer Task → AsyncStream → Consumer actor
```

### Message Queue (via Vapor / RabbitMQ / Redis Streams)
```
Publisher → Broker → Consumer actor
```

### Request/Response (Vapor HTTP)
```
Controller → Service → Repository → Database (Fluent)
```

---

## Structured Concurrency (TaskGroup)

```swift
try await withThrowingTaskGroup(of: Void.self) { group in
    group.addTask { try await worker1.run() }
    group.addTask { try await worker2.run() }
    group.addTask { try await httpServer.start() }
    try await group.waitForAll()
}
```

---

## SwiftUI View Pattern

```swift
struct UserListView: View {
    @StateObject private var viewModel = UserListViewModel()

    var body: some View {
        List(viewModel.users) { user in
            UserRowView(user: user)
        }
        .task {
            await viewModel.loadUsers()
        }
        .alert("Error", isPresented: $viewModel.hasError) {
            Button("OK") {}
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
    }
}

@MainActor
final class UserListViewModel: ObservableObject {
    @Published var users: [User] = []
    @Published var hasError = false
    var errorMessage: String?

    private let userService: UserService

    init(userService: UserService = .shared) {
        self.userService = userService
    }

    func loadUsers() async {
        do {
            users = try await userService.fetchAll()
        } catch {
            errorMessage = error.localizedDescription
            hasError = true
        }
    }
}
```

---

## Vapor Controller Pattern

```swift
struct UserController: RouteCollection {
    let userService: UserService

    func boot(routes: RoutesBuilder) throws {
        let users = routes.grouped("api", "users")
        users.get(use: list)
        users.post(use: create)
        users.group(":userID") { user in
            user.get(use: getByID)
            user.put(use: update)
            user.delete(use: delete)
        }
    }

    // GET /api/users
    func list(req: Request) async throws -> [UserResponse] {
        try await userService.fetchAll(on: req.db)
    }

    // GET /api/users/:userID
    func getByID(req: Request) async throws -> UserResponse {
        guard let id = req.parameters.get("userID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid user ID")
        }
        guard let user = try await User.find(id, on: req.db) else {
            throw Abort(.notFound)
        }
        return UserResponse(user)
    }

    // POST /api/users
    func create(req: Request) async throws -> Response {
        let input = try req.content.decode(CreateUserRequest.self)
        try CreateUserRequest.validate(content: req)
        let user = try await userService.create(input, on: req.db)
        var headers = HTTPHeaders()
        headers.add(name: .location, value: "/api/users/\(user.id!)")
        return try await UserResponse(user).encodeResponse(status: .created, headers: headers, for: req)
    }
}
```

---

## Quick Commands

```bash
# Build all targets
swift build

# Run all tests
swift test

# Run specific test suite
swift test --filter UserServiceTests

# Thread sanitizer
swift test --sanitize=thread

# Start Vapor server
swift run App

# Lint
swiftlint lint

# Format
swift-format --recursive .
```