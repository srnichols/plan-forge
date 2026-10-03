import Fluent
import Logging
import Vapor

public enum AppError: Error {
    case notFound
    case internalError
}

public enum OrderServiceError: Error {
    case notFound
    case validationFailed
}

public protocol OrderRepositoryProtocol: Sendable {
    func findByID(_ id: UUID) async throws -> Order?
    func findAll() async throws -> [Order]
    func insert(_ input: CreateOrderRequest) async throws -> Order
    func update(id: UUID, input: UpdateOrderRequest) async throws -> Order
    func delete(id: UUID) async throws
}

public protocol UserRepository: Sendable {
    func find(id: UUID) async throws -> User?
    func save(_ user: User) async throws
}

public struct CreateUserRequest: Content, Sendable {
    public var name: String
    public var email: String
    public init(name: String, email: String) { self.name = name; self.email = email }
}

public struct UpdateOrderRequest: Content, Sendable {
    public var name: String
    public var description: String?
    public init(name: String, description: String? = nil) {
        self.name = name
        self.description = description
    }
}

public struct CreateOrderRequest: Content, Sendable {
    public var name: String
    public var description: String?
    public var tenantID: UUID
    public init(name: String, description: String? = nil, tenantID: UUID = UUID()) {
        self.name = name
        self.description = description
        self.tenantID = tenantID
    }
}

public final class User: Model, Content, @unchecked Sendable {
    public static let schema = "users"
    @ID(key: .id) public var id: UUID?
    @Field(key: "name") public var name: String
    @Field(key: "email") public var email: String

    public init() { self.name = ""; self.email = "" }
    public init(id: UUID? = nil, name: String, email: String) {
        self.id = id
        self.name = name
        self.email = email
    }

    public static func find(_ id: UUID, on db: Database) async throws -> User? {
        User(id: id, name: "Sample", email: "sample@example.com")
    }
}

public struct UserResponse: Content, Sendable {
    public var name: String
    public init(_ user: User) { self.name = user.name }
}

public struct Order: Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var description: String?
    public var createdAt: Date
    public var updatedAt: Date
    public init(id: UUID = UUID(), name: String, description: String? = nil, createdAt: Date = .now, updatedAt: Date = .now) {
        self.id = id
        self.name = name
        self.description = description
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct DefaultOrderRepository: OrderRepositoryProtocol {
    public init() {}
    public func findByID(_ id: UUID) async throws -> Order? { Order(id: id, name: "Widget") }
    public func findAll() async throws -> [Order] { [] }
    public func insert(_ input: CreateOrderRequest) async throws -> Order { Order(name: input.name, description: input.description) }
    public func update(id: UUID, input: UpdateOrderRequest) async throws -> Order { Order(id: id, name: input.name) }
    public func delete(id: UUID) async throws {}
}

public actor OrderService: Sendable {
    private let repository: any OrderRepositoryProtocol
    public static let shared = OrderService(repository: DefaultOrderRepository())

    public init(repository: some OrderRepositoryProtocol) { self.repository = repository }

    public func getByID(_ id: UUID) async throws -> Order {
        if let order = try await repository.findByID(id) { return order }
        throw OrderServiceError.notFound
    }

    public func create(_ input: CreateOrderRequest) async throws -> Order {
        guard !input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw OrderServiceError.validationFailed
        }
        return try await repository.insert(input)
    }
}

public actor UserService: Sendable {
    public static let shared = UserService()
    public init(repository: (any UserRepository)? = nil) {}
    public func fetchAll() async throws -> [User] { [User(name: "Alice", email: "alice@example.com")] }
    public func fetchAll(on db: Database) async throws -> [UserResponse] { [UserResponse(User(name: "Alice", email: "alice@example.com"))] }
    public func getUser(id: UUID) async throws -> User { User(id: id, name: "Test User", email: "test@example.com") }
    public func create(_ input: CreateUserRequest, on db: Database) async throws -> User { User(name: input.name, email: input.email) }
}

public extension Application {
    static func make(_ env: Environment) throws -> Application {
        Application(env)
    }
}

/// Minimal stand-in for a background-job service referenced by doc samples
/// that illustrate actor-isolated workers (e.g. AGENTS.md).
public actor MyService: Sendable {
    public init() {}
    public func processPending() async throws {}
}

/// Minimal stand-in for a domain event referenced by doc samples that
/// illustrate consuming an `AsyncStream` of events (e.g. AGENTS.md).
public struct Event: Sendable {
    public var id: UUID
    public init(id: UUID = UUID()) { self.id = id }
}
