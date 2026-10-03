import Foundation
import Vapor

// new-middleware.prompt.md index 3 ("Registration Order") wires up
// cross-cutting middleware and a protected route group as a configure.swift
// illustration; `corsConfiguration`, `RequestIDMiddleware`,
// `SecurityHeadersMiddleware`, `User`, and `UserToken` are assumed to already
// exist elsewhere in a real app (the auth/security instructions files define
// equivalents in their own test targets). Provide minimal Linux-safe
// stand-ins so this sample compiles on its own.
let corsConfiguration = CORSMiddleware.Configuration(
    allowedOrigin: .all,
    allowedMethods: [.GET, .POST, .PUT, .PATCH, .DELETE],
    allowedHeaders: [.authorization, .contentType, .accept]
)

struct RequestIDMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        try await next.respond(to: request)
    }
}

struct SecurityHeadersMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        try await next.respond(to: request)
    }
}

// `App.User` (the shared Fluent model used by other samples) isn't
// `Authenticatable` and has no `tenantID`. Block 1 ("Request-Scoped Storage
// Middleware") needs `req.auth.require(User.self)` plus `user.tenantID`, so
// shadow it in this test target only with a minimal `Authenticatable`
// stand-in rather than changing the shared App module. `Authenticatable` is
// Vapor's marker protocol; conforming to it provides `User.guardMiddleware()`
// via a protocol extension default implementation.
struct User: Authenticatable {
    var tenantID: UUID = UUID()
}

struct UserResponse: Content {
    init(from user: User) {}
}

struct UserToken {
    static func authenticator() -> any Middleware {
        UserTokenAuthenticator()
    }
}

struct UserTokenAuthenticator: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        try await next.respond(to: request)
    }
}
