public protocol FetchableRecord {}
public protocol PersistableRecord {}

public struct DatabaseWriter {
    public init() {}
}

public struct DatabaseQueue {
    public init() {}

    public func read<T>(_ body: (DatabaseWriter) throws -> T) rethrows -> T {
        try body(DatabaseWriter())
    }

    public func write<T>(_ body: (DatabaseWriter) throws -> T) rethrows -> T {
        try body(DatabaseWriter())
    }
}

public extension PersistableRecord {
    mutating func insert(_ db: DatabaseWriter) throws {}
}

public extension FetchableRecord where Self: Decodable {
    static func fetchAll(_ db: DatabaseWriter) throws -> [Self] {
        []
    }
}
