import Foundation

enum Logger {
    static let ui = LogSink()
}

struct LogSink {
    func info(_ message: String) {}
    func fault(_ message: String) {}
}

final class UIApplication {
    enum LaunchOptionsKey: Hashable {
        case placeholder
    }
}

let userID = "user-123"
let tenantID = "tenant-123"
let validationError = NSError(domain: "validation", code: 1)
let error = NSError(domain: "sentry", code: 2)
let orderID = "order-123"

enum Environment {
    static func get(_ key: String) -> String { "" }
}

enum AppConfig {
    static let environment = "test"
}
