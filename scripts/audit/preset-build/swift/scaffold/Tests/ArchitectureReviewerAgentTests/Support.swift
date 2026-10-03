import Foundation

// index 2 ("Actor for shared mutable state") assumes `CartItem` already exists
// as a domain model elsewhere in the app; it's illustrative, not self-contained.
struct CartItem: Sendable {
    let id: UUID
    let name: String
}
