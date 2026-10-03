import Foundation

// Target-local stand-in matching the canonical AppError shape from
// errorhandling.instructions.md (richer than the shared App module's
// simplified AppError, which has no associated values).
enum AppError: Error {
    case notFound(entity: String, id: String)
}
