import Foundation

// new-entity.prompt.md's "Mapping from SwiftData model" extension (index 4)
// references `OrderSwiftDataModel`, but the SwiftData model declaration
// (index 3, `@Model final class OrderModel`) is skipped since SwiftData
// is an Apple-only framework unavailable on Linux. Provide a minimal
// stand-in matching the skipped declaration's shape so the mapping
// extension still compiles.
struct OrderSwiftDataModel {
    var id: UUID
    var name: String
    var descriptionText: String?
    var createdAt: Date
    var updatedAt: Date
}
