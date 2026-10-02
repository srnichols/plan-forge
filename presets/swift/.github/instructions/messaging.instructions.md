---
description: Messaging patterns for Swift — Vapor Queues, Redis-backed jobs, AsyncSequence event buses, event-driven architecture
applyTo: '**/*.swift,Package.swift'
---

# Swift Messaging & Pub/Sub Patterns

## Messaging Strategy

### Vapor Queues + Redis (Recommended for Vapor Servers)
```swift
import Vapor
import Queues
import QueuesRedisDriver

func configureQueues(_ app: Application) throws {
    let redisURL = Environment.get("REDIS_URL") ?? "redis://localhost:6379"
    try app.queues.use(.redis(url: redisURL))
    app.queues.add(OrderPlacedJob(emailService: app.emailService))
}
```

### Job Payload and Worker
```swift
import Foundation
import Queues
import Vapor

struct OrderPlacedEvent: Codable, Sendable {
    let eventID: UUID
    let orderID: UUID
    let tenantID: UUID
    let occurredAt: Date
}

struct OrderPlacedJob: AsyncJob {
    typealias Payload = OrderPlacedEvent

    let emailService: EmailService

    func dequeue(_ context: QueueContext, _ payload: Payload) async throws {
        try await emailService.sendOrderConfirmation(
            orderID: payload.orderID,
            tenantID: payload.tenantID,
            logger: context.logger
        )
    }

    func error(_ context: QueueContext, _ error: Error, _ payload: Payload) async throws {
        context.logger.error("OrderPlacedJob failed", metadata: [
            "eventID": "\(payload.eventID)",
            "orderID": "\(payload.orderID)",
            "tenantID": "\(payload.tenantID)",
            "error": "\(error)"
        ])
    }
}
```

### Publishing a Job
```swift
struct OrderService: Sendable {
    let repository: OrderRepository

    func placeOrder(_ request: CreateOrderRequest, req: Request) async throws -> OrderResponse {
        let order = try await repository.create(request, on: req.db)
        guard let orderID = order.id else {
            throw AppError.internal(underlying: OrderError.missingID)
        }

        let event = OrderPlacedEvent(eventID: UUID(), orderID: orderID, tenantID: request.tenantID, occurredAt: Date())
        try await req.queue.dispatch(OrderPlacedJob.self, event)
        return OrderResponse(from: order)
    }
}
```

### AsyncSequence In-Process Pub/Sub
```swift
import Foundation

protocol DomainEvent: Codable, Sendable {
    var eventID: UUID { get }
    var occurredAt: Date { get }
}

actor EventBus<Event: DomainEvent> {
    typealias Handler = @Sendable (Event) async throws -> Void

    private var handlers: [Handler] = []

    func subscribe(_ handler: @escaping Handler) {
        handlers.append(handler)
    }

    func publish(_ event: Event, logger: Logger) async {
        for handler in handlers {
            do {
                try await handler(event)
            } catch {
                logger.error("event handler failed", metadata: ["eventID": "\(event.eventID)", "error": "\(error)"])
            }
        }
    }
}
```

## Event Schema
```swift
struct BaseEvent: Codable, Sendable {
    let eventID: UUID
    let tenantID: UUID
    let occurredAt: Date
    let traceID: String?
}
```

## Worker Pattern (Scheduled Async Task)
```swift
import NIOConcurrencyHelpers
import Vapor

final class CleanupWorker: LifecycleHandler {
    private let service: CleanupService
    private let logger: Logger
    private let task = NIOLockedValueBox<Task<Void, Never>?>(nil)

    init(service: CleanupService, logger: Logger) {
        self.service = service
        self.logger = logger
    }

    func didBootAsync(_ application: Application) async throws {
        let service = service
        let logger = logger
        let database = application.db

        task.withLockedValue { task in
            task = Task {
                while !Task.isCancelled {
                    do {
                        try await service.deleteExpiredRecords(on: database)
                    } catch {
                        logger.error("cleanup failed", metadata: ["error": "\(error)"])
                    }
                    try? await Task.sleep(for: .seconds(30))
                }
            }
        }
    }

    func shutdownAsync(_ application: Application) async {
        task.withLockedValue { task in
            task?.cancel()
            task = nil
        }
    }
}
```

## Graceful Shutdown
```swift
func configure(_ app: Application) async throws {
    try configureQueues(app)
    app.lifecycle.use(QueueWorkerLifecycle())
}

struct QueueWorkerLifecycle: LifecycleHandler {
    func didBoot(_ application: Application) throws {
        try application.queues.startInProcessJobs(on: .default)
    }
}
```

## Dead Letter & Retry Strategy

```swift
struct PaymentCapturedJob: AsyncJob {
    typealias Payload = PaymentCapturedEvent
    static let maxRetryCount = 3

    func dequeue(_ context: QueueContext, _ payload: Payload) async throws {
        try await process(payload, context: context)
    }

    func error(_ context: QueueContext, _ error: Error, _ payload: Payload) async throws {
        if payload.attempt >= Self.maxRetryCount {
            try await context.queue.dispatch(PaymentDeadLetterJob.self, payload.deadLetter(reason: error))
            return
        }
        let retry = payload.nextAttempt()
        try await context.queue.dispatch(PaymentCapturedJob.self, retry, delayUntil: Date().addingTimeInterval(Double(1 << retry.attempt)))
    }
}
```

## Scheduled Jobs

```swift
import Queues

struct DailyReportJob: AsyncScheduledJob {
    func run(context: QueueContext) async throws {
        try await context.application.reportService.generateDailyReport(logger: context.logger)
    }
}

func configureScheduledJobs(_ app: Application) {
    app.queues.schedule(DailyReportJob()).daily().at(8, 0)
}
```

## Anti-Patterns

```
❌ Detached tasks without cancellation or lifecycle ownership
❌ Missing tenantID or eventID in event payloads
❌ Non-idempotent handlers — duplicate delivery must be safe
❌ Force-decoding payloads without typed Codable events
❌ In-memory event bus for durable business events
❌ Blocking I/O or Thread.sleep inside queue jobs
❌ No dead-letter path after repeated failures
```

## Idempotency

Guard consumers against duplicate delivery using a persistent idempotency store:

```swift
import Fluent

final class ProcessedEvent: Model, @unchecked Sendable {
    static let schema = "processed_events"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "tenant_id")
    var tenantID: UUID

    init() {}

    init(eventID: UUID, tenantID: UUID) {
        self.id = eventID
        self.tenantID = tenantID
    }
}

func processOnce(
    eventID: UUID,
    tenantID: UUID,
    on db: Database,
    operation: @escaping @Sendable (Database) async throws -> Void
) async throws {
    try await db.transaction { tx in
        do {
            try await ProcessedEvent(eventID: eventID, tenantID: tenantID).create(on: tx)
        } catch let error as any DatabaseError where error.isConstraintFailure {
            return
        }

        try await operation(tx)
    }
}
```

Alternatives: Redis `SET NX` with TTL, a transactional outbox table, or broker-level de-duplication when available.

## See Also

- `dapr.instructions.md` — Dapr building blocks, sidecar config, state, workflows, secrets
- `observability.instructions.md` — Distributed tracing, event logging
- `errorhandling.instructions.md` — Dead letter queues, retry logic
- `database.instructions.md` — Idempotency stores, transactional outbox
