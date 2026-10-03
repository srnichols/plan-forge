import Foundation
import Vapor
import Fluent

// auth.instructions.md index 1 ("JWT Middleware") is skipped because its fenced
// block also contains a top-level `app.jwt.signers.use(...)` configure.swift-style
// statement. Replicate the middleware declaration here so the "Registration in
// routes.swift" block (index 2), which references `JWTAuthMiddleware()`, still
// compiles.
struct JWTAuthMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let token = request.headers.bearerAuthorization?.token else {
            throw Abort(.unauthorized, reason: "Missing bearer token")
        }
        do {
            let payload = try await request.jwt.verify(token, as: AppJWTPayload.self)
            request.currentUser = CurrentUser(from: payload)
        } catch {
            throw Abort(.unauthorized, reason: "Invalid or expired token")
        }
        return try await next.respond(to: request)
    }
}

// index 2 ("Registration in routes.swift") registers these illustrative route
// collections; they're never defined in the doc since the point of the sample
// is the auth middleware wiring, not the controllers themselves.
struct ItemController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {}
}

struct AdminController: RouteCollection {
    func boot(routes: RoutesBuilder) throws {}
}

// index 5 ("Multi-Tenant Middleware") extends `Item` with a tenant-scoped query
// helper; `Item` itself is assumed to already exist as a Fluent model elsewhere
// in a real app.
final class Item: Model, @unchecked Sendable {
    static let schema = "items"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "tenant_id")
    var tenantID: String

    init() {}
}

// index 8 ("Token Refresh Logic") depends on `TokenStore` (declared by index 6,
// "iOS Keychain Token Storage", which is skipped because it imports the
// Apple-only `Security` framework) and `APIClient` (never defined in the doc —
// it's the caller's own networking type). Provide minimal Linux-safe stand-ins.
actor TokenStore {
    static let shared = TokenStore()

    private var storage: [String: String] = [:]

    var accessToken: String? { storage["accessToken"] }
    var refreshToken: String? { storage["refreshToken"] }

    func save(accessToken: String, refreshToken: String) {
        storage["accessToken"] = accessToken
        storage["refreshToken"] = refreshToken
    }

    func clear() {
        storage.removeAll()
    }
}

protocol APIClient: Sendable {
    func refreshTokens(refreshToken: String) async throws -> (accessToken: String, refreshToken: String)
}
