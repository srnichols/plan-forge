---
description: "Scaffold Swift domain events, Vapor Queues jobs, and actor-isolated in-process handlers."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold typed Swift domain events with Vapor Queues jobs and actor-isolated handlers.

## Required Pattern

### Event Types
```swift
import Foundation
import Vapor

protocol DomainEvent: Codable, Sendable {
    var eventID: UUID { get }
    var tenantID: UUID { get }
    var occurredAt: Date { get }
}

struct BaseEvent: Codable, Sendable {
    let eventID: UUID
    let tenantID: UUID
    let occurredAt: Date

    init(tenantID: UUID, occurredAt: Date = Date()) {
        self.eventID = UUID()
        self.tenantID = tenantID
        self.occurredAt = occurredAt
    }
}

struct OrderPlacedEvent: DomainEvent {
    let eventID: UUID
    let tenantID: UUID
    let occurredAt: Date
    let orderID: UUID
    let customerID: UUID
    let totalAmount: Decimal
}
```

### Event Bus (Actor-Based)
```swift
actor EventBus<Event: DomainEvent> {
    typealias Handler = @Sendable (Event, Request) async throws -> Void

    private var handlers: [Handler] = []

    func on(_ handler: @escaping Handler) {
        handlers.append(handler)
    }

    func publish(_ event: Event, req: Request) async {
        for handler in handlers {
            do {
                try await handler(event, req)
            } catch {
                req.logger.error("event handler failed", metadata: [
                    "eventID": "\(event.eventID)",
                    "tenantID": "\(event.tenantID)",
                    "error": "\(error)"
                ])
            }
        }
    }
}
```

### Vapor Queues Event Handler
```swift
import Queues
import Vapor

struct OrderPlacedJob: AsyncJob {
    typealias Payload = OrderPlacedEvent

    let emailService: EmailService

    func dequeue(_ context: QueueContext, _ payload: Payload) async throws {
        context.logger.info("handling OrderPlaced", metadata: [
            "eventID": "\(payload.eventID)",
            "orderID": "\(payload.orderID)"
        ])
        try await emailService.sendOrderConfirmation(
            orderID: payload.orderID,
            tenantID: payload.tenantID,
            logger: context.logger
        )
    }

    func error(_ context: QueueContext, _ error: Error, _ payload: Payload) async throws {
        context.logger.error("OrderPlacedJob failed", metadata: [
            "eventID": "\(payload.eventID)",
            "error": "\(error)"
        ])
    }
}

app.queues.add(OrderPlacedJob(emailService: app.emailService))
```

### Publishing Events
```swift
struct OrderService: Sendable {
    let repository: OrderRepository

    func placeOrder(_ input: CreateOrderRequest, req: Request) async throws -> OrderResponse {
        let order = try await repository.create(input, on: req.db)
        guard let orderID = order.id else {
            throw AppError.internal(underlying: OrderError.missingID)
        }

        let event = OrderPlacedEvent(
            eventID: UUID(),
            tenantID: input.tenantID,
            occurredAt: Date(),
            orderID: orderID,
            customerID: input.customerID,
            totalAmount: order.totalAmount
        )

        try await req.queue.dispatch(OrderPlacedJob.self, event)
        return OrderResponse(from: order)
    }
}
```

### Async Worker (Structured Concurrency)
```swift
import NIOConcurrencyHelpers
import Vapor

final class ProjectionWorker: LifecycleHandler {
    private let stream: AsyncStream<OrderPlacedEvent>
    private let handler: @Sendable (OrderPlacedEvent) async throws -> Void
    private let task = NIOLockedValueBox<Task<Void, Never>?>(nil)

    init(
        stream: AsyncStream<OrderPlacedEvent>,
        handler: @escaping @Sendable (OrderPlacedEvent) async throws -> Void
    ) {
        self.stream = stream
        self.handler = handler
    }

    func didBootAsync(_ application: Application) async throws {
        let stream = stream
        let handler = handler
        let logger = application.logger

        task.withLockedValue { task in
            task = Task {
                for await event in stream {
                    guard !Task.isCancelled else { break }
                    do {
                        try await handler(event)
                    } catch {
                        logger.error("projection failed", metadata: ["error": "\(error)"])
                    }
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

## Rules

- Events are immutable `Sendable` value types — NEVER mutate after creation
- Event handlers MUST be idempotent — the same event may be delivered more than once
- NEVER crash from event handlers — log the error and continue or send to dead letter
- Use `Request`, `QueueContext`, or explicit services for cancellation and tracing context
- Use `AsyncJob` from `vapor/queues` for durable background processing
- Keep events in `Sources/App/Events/`, handlers alongside their domain package
- For durable delivery, use Redis-backed Vapor Queues or a broker — not only an in-memory actor

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [Messaging patterns](../instructions/messaging.instructions.md)
