import Foundation
import Vapor
import Fluent
import Queues

// index 3 ("Publishing Events") assumes these collaborator types already
// exist elsewhere in the app; they're illustrative, not self-contained.
struct CreateOrderRequest: Sendable {
    let tenantID: UUID
    let customerID: UUID
}

struct OrderModel: Sendable {
    let id: UUID?
    let totalAmount: Decimal
}

struct OrderResponse: Sendable {
    init(from order: OrderModel) {}
}

protocol OrderRepository: Sendable {
    func create(_ input: CreateOrderRequest, on db: Database) async throws -> OrderModel
}

enum OrderError: Error {
    case missingID
}

enum AppError: Error {
    case `internal`(underlying: Error)
}

// index 2 ("Vapor Queues Event Handler") is skipped because its fenced block
// also contains a top-level app.queues.add(...) configure.swift-style
// statement. Replicate the job + its EmailService collaborator here so index
// 3 ("Publishing Events"), which references `OrderPlacedJob.self`, still
// compiles.
struct EmailService: Sendable {
    func sendOrderConfirmation(orderID: UUID, tenantID: UUID, logger: Logger) async throws {}
}

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
