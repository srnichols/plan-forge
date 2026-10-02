import Foundation

public struct RedisKey: ExpressibleByStringLiteral, CustomStringConvertible {
    public var value: String

    public init(_ value: String) {
        self.value = value
    }

    public init(stringLiteral value: StringLiteralType) {
        self.value = value
    }

    public var description: String {
        value
    }
}

public struct RedisConfiguration {
    public init(url: String) throws {}
}

public enum RedisClientResult<T> {
    case value(T)

    public func get() async throws -> T {
        switch self {
        case let .value(value):
            return value
        }
    }
}

public final class RedisClient {
    public init() {}

    public func get<T>(_ key: RedisKey, asJSON type: T.Type) async throws -> RedisClientResult<T?> {
        .value(nil)
    }

    public func setex<T>(_ key: RedisKey, toJSON value: T, expirationInSeconds: Int) async throws -> RedisClientResult<Void> {
        .value(())
    }

    public func delete(_ key: RedisKey) async throws -> RedisClientResult<Void> {
        .value(())
    }
}
