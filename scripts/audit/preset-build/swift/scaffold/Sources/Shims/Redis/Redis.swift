import Foundation
import Vapor

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

// Stateless stand-in, so Sendable is safe; Vapor's Application.storage requires it.
public final class RedisClient: Sendable {
    public init() {}

    // RedisKit's `app.redis.configuration = ...`; the stand-in has no connection to configure.
    public var configuration: RedisConfiguration? {
        get { nil }
        set {}
    }

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

// Mirrors Vapor's RedisKit `Application.redis` / `Request.redis` convenience
// accessors, backed by a per-application singleton RedisClient stand-in.
public extension Application {
    var redis: RedisClient {
        if let existing = storage[RedisClientKey.self] {
            return existing
        }
        let client = RedisClient()
        storage[RedisClientKey.self] = client
        return client
    }
}

public extension Request {
    var redis: RedisClient {
        application.redis
    }
}

private enum RedisClientKey: StorageKey {
    typealias Value = RedisClient
}
