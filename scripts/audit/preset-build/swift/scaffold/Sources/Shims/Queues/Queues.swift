import Foundation
import Logging
import Vapor

public protocol AsyncJob {
    associatedtype Payload
    static var maxRetryCount: Int { get }

    func dequeue(_ context: QueueContext, _ payload: Payload) async throws
    func error(_ context: QueueContext, _ error: Error, _ payload: Payload) async throws
}

public extension AsyncJob {
    static var maxRetryCount: Int { 0 }
}

public protocol AsyncScheduledJob {
    func run(context: QueueContext) async throws
}

public struct QueueContext {
    public let logger = Logger(label: "QueueContext")
    public let application: Application
    public let queue = Queue()

    public init(application: Application = Application(.testing)) {
        self.application = application
    }
}

public final class Queue: @unchecked Sendable {
    public init() {}

    public func dispatch<J: AsyncJob>(_ job: J.Type, _ payload: J.Payload, delayUntil: Date? = nil) async throws {}
}

public final class QueueRegistry: @unchecked Sendable {
    public let queue = Queue()

    public init() {}

    public func use(_ storage: some Sendable) throws {}
    public func add<J: AsyncJob>(_ job: J) {}
    public func startInProcessJobs(on: QueueName) throws {}

    public func schedule<J: AsyncScheduledJob>(_ job: J) -> QueueScheduler<J> {
        QueueScheduler()
    }
}

public struct QueueName: ExpressibleByStringLiteral, Sendable {
    public static let `default`: QueueName = "default"

    public init(stringLiteral value: StringLiteralType) {}
}

public struct QueueScheduler<Job>: Sendable {
    public func daily() -> Self {
        self
    }

    public func at(_ hour: Int, _ minute: Int) {}
}

// NOTE: Vapor itself already declares `LifecycleHandler` — do not redeclare it
// here. A duplicate declaration in this shim module makes the identifier
// ambiguous for any test target that imports both Vapor and Queues.

public extension Application {
    var queues: QueueRegistry {
        if let existing = storage[QueueRegistryKey.self] {
            return existing
        }
        let created = QueueRegistry()
        storage[QueueRegistryKey.self] = created
        return created
    }
}

// Mirrors Vapor Queues' `Request.queue` convenience, which dispatches jobs on
// the default queue for the application's registry.
public extension Request {
    var queue: Queue {
        application.queues.queue
    }
}

private enum QueueRegistryKey: StorageKey {
    typealias Value = QueueRegistry
}
