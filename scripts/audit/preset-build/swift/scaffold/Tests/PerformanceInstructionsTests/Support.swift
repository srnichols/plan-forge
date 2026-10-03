import Foundation
@testable import App

@MainActor
class UIViewController {
    func viewDidLoad() {}
}

final class UIView {}

final class UIButton {
    func addAction(_ action: UIAction, for event: UIControl.Event) {}
}

enum UIControl {
    struct Event: Hashable {
        static let touchUpInside = Event()
    }
}

final class UIAction {
    init(_ handler: (Any?) -> Void) {}
}

final class StorageClass {
    init() {}
    init(_ other: StorageClass) {}
    func append(_ byte: UInt8) {}
}

final class AnalyticsManager {
    struct Config {
        static let shared = Config()
    }

    init(config: Config) {}
}

struct DataPoint {}

enum DataProcessor {
    static func buildDataSet(from rawData: [Int]) -> [DataPoint] { [] }
}

let rawData: [Int] = []

struct Model: Decodable {
    var title = ""
}

@MainActor
final class TitleLabel {
    var text: String?
}

@MainActor
final class TableView {
    func reloadData() {}
}

@MainActor let titleLabel = TitleLabel()
@MainActor let tableView = TableView()

enum Logger {
    static let networking = LogSink()
}

struct LogSink {
    func error(_ message: String) {}
}

let url = URL(string: "https://example.com")!

struct A {}
struct B {}
struct C {}

struct Report {
    init(_ a: A, _ b: B, _ c: C) {}
}

actor DataActor {}

let dataActor = DataActor()

extension DataActor {
    func fetchA() -> A { A() }
    func fetchB() -> B { B() }
    func fetchC() -> C { C() }
}

struct UserBundle {
    enum Component {
        case orders([Order])
        case profile(User)
    }

    init(_ components: [Component]) {}
}

struct OrderFetcher {
    func fetch(for userID: UUID) async throws -> [Order] { [] }
}

struct ProfileFetcher {
    func fetch(for userID: UUID) async throws -> User {
        User(id: userID, name: "Profile", email: "profile@example.com")
    }
}

let orderService = OrderFetcher()
let profileService = ProfileFetcher()

struct FakeDatabase {}

struct DataResponse {
    init(_ data: [String]) {}
}

struct ReportResponse {
    init(_ report: String) {}
}

struct DataService {
    func fetch(on db: FakeDatabase) async throws -> [String] { ["ok"] }
}

enum CPUBoundReportGenerator {
    static func generate() -> String { "report" }
}

struct FakeParameters {
    func require(_ key: String, as type: UUID.Type) throws -> UUID {
        UUID()
    }
}

struct FakeFuture<Value> {
    let value: Value
    func get() async throws -> Value { value }
}

final class FakeThreadPool {
    func runIfActive<Value>(eventLoop: FakeEventLoop, _ work: () throws -> Value) -> FakeFuture<Value> {
        guard let result = try? work() else { fatalError("unreachable") }
        return FakeFuture(value: result)
    }
}

struct FakeApplication {
    let threadPool = FakeThreadPool()
}

struct FakeEventLoop {}

struct FakeRequest {
    let db = FakeDatabase()
    let application = FakeApplication()
    let eventLoop = FakeEventLoop()
    let parameters = FakeParameters()
}

final class FakeApp: @unchecked Sendable {
    func get<Response>(_ path: String..., handler: @escaping (FakeRequest) -> Response) {}
    func get<Response>(_ path: String..., handler: @escaping (FakeRequest) async throws -> Response) {}
}

let app = FakeApp()
let dataService = DataService()
