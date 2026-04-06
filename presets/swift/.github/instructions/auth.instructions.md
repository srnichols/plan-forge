---
description: Swift authentication — Vapor 4 JWTKit middleware, iOS Keychain, OAuth2/PKCE, token refresh, biometric auth, multi-tenant, RBAC
applyTo: '**/*.swift'
---

# Swift Authentication & Authorization

## Vapor 4 — JWT Middleware (JWTKit)

### JWT Payload Definition

```swift
import Vapor
import JWT

struct AppJWTPayload: JWTPayload {
    var subject: SubjectClaim       // user ID
    var expiration: ExpirationClaim
    var issuedAt: IssuedAtClaim
    var issuer: IssuerClaim
    var email: String
    var roles: [String]
    var tenantID: String

    func verify(using signer: JWTSigner) throws {
        try expiration.verifyNotExpired()
        guard issuer.value == "https://auth.yourapp.com" else {
            throw JWTError.claimVerificationFailure(failedClaim: issuer, reason: "Invalid issuer")
        }
    }
}
```

### JWT Middleware

```swift
struct JWTAuthMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let token = request.headers.bearerAuthorization?.token else {
            throw Abort(.unauthorized, reason: "Missing Bearer token")
        }
        do {
            let payload = try request.jwt.verify(token, as: AppJWTPayload.self)
            request.storage[CurrentUserKey.self] = CurrentUser(from: payload)
        } catch {
            throw Abort(.unauthorized, reason: "Invalid or expired token")
        }
        return try await next.respond(to: request)
    }
}

// Configure JWTKit in configure.swift
app.jwt.signers.use(.rs256(key: try .public(pem: Environment.get("JWT_PUBLIC_KEY")!)))
```

### Registration in `routes.swift`

```swift
func routes(_ app: Application) throws {
    // Public routes — no auth
    app.get("health") { _ in HTTPStatus.ok }

    // Protected routes
    let protected = app.grouped(JWTAuthMiddleware())
    try protected.register(collection: ItemController())

    // Admin-only routes
    let admin = protected.grouped(RoleGuardMiddleware(requiredRole: "admin"))
    try admin.register(collection: AdminController())
}
```

---

## RBAC Guards (Vapor Middleware)

```swift
struct RoleGuardMiddleware: AsyncMiddleware {
    let requiredRole: String

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let user = request.currentUser else {
            throw Abort(.unauthorized)
        }
        guard user.roles.contains(requiredRole) else {
            throw Abort(.forbidden, reason: "Role '\(requiredRole)' required")
        }
        return try await next.respond(to: request)
    }
}

struct ScopeGuardMiddleware: AsyncMiddleware {
    let requiredScope: String

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let user = request.currentUser else {
            throw Abort(.unauthorized)
        }
        guard user.scopes.contains(requiredScope) else {
            throw Abort(.forbidden, reason: "Scope '\(requiredScope)' required")
        }
        return try await next.respond(to: request)
    }
}
```

### Current User Helper

```swift
struct CurrentUser {
    let id: UUID
    let email: String
    let tenantID: String
    let roles: [String]
    let scopes: [String]

    init(from payload: AppJWTPayload) {
        self.id       = UUID(uuidString: payload.subject.value)!
        self.email    = payload.email
        self.tenantID = payload.tenantID
        self.roles    = payload.roles
        self.scopes   = []
    }

    func hasRole(_ role: String) -> Bool { roles.contains(role) }
    func hasScope(_ scope: String) -> Bool { scopes.contains(scope) }
}

private enum CurrentUserKey: StorageKey {
    typealias Value = CurrentUser
}

extension Request {
    var currentUser: CurrentUser? {
        get { storage[CurrentUserKey.self] }
        set { storage[CurrentUserKey.self] = newValue }
    }
}
```

---

## Multi-Tenant Middleware (Vapor)

```swift
struct TenantMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let user = request.currentUser, !user.tenantID.isEmpty else {
            throw Abort(.forbidden, reason: "Missing tenant context")
        }
        // Tenant ID already set via JWT — no need to trust client headers
        return try await next.respond(to: request)
    }
}

// ALWAYS scope Fluent queries to tenantID
extension Item {
    static func forTenant(_ tenantID: String, on db: Database) -> QueryBuilder<Item> {
        query(on: db).filter(\.$tenantID == tenantID)
    }
}

// Usage in service
func findItem(id: UUID, for user: CurrentUser, on db: Database) async throws -> Item? {
    try await Item.forTenant(user.tenantID, on: db)
        .filter(\.$id == id)
        .first()
    // Returns nil (not 403) if item belongs to another tenant — don't reveal existence
}
```

---

## iOS — Keychain Token Storage

```swift
import Security

actor TokenStore {
    static let shared = TokenStore()

    private let service = "com.yourapp.tokens"

    var accessToken: String? {
        get { read(key: "accessToken") }
    }

    var refreshToken: String? {
        get { read(key: "refreshToken") }
    }

    func save(accessToken: String, refreshToken: String) {
        write(value: accessToken,  key: "accessToken")
        write(value: refreshToken, key: "refreshToken")
    }

    func clear() {
        delete(key: "accessToken")
        delete(key: "refreshToken")
    }

    // MARK: - Keychain primitives

    private func write(value: String, key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      service,
            kSecAttrAccount as String:      key,
            kSecValueData as String:        data,
            kSecAttrAccessible as String:   kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String:        kSecClassGenericPassword,
            kSecAttrService as String:  service,
            kSecAttrAccount as String:  key,
            kSecReturnData as String:   true,
            kSecMatchLimit as String:   kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String:        kSecClassGenericPassword,
            kSecAttrService as String:  service,
            kSecAttrAccount as String:  key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

---

## iOS — OAuth2 / PKCE Flow (ASWebAuthenticationSession)

```swift
import AuthenticationServices
import CryptoKit

@MainActor
final class OAuthCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first!.windows.first!
    }

    func startPKCEFlow() async throws -> String {
        let verifier   = generateCodeVerifier()
        let challenge  = generateCodeChallenge(from: verifier)
        let state      = UUID().uuidString

        var components = URLComponents(string: "https://auth.yourapp.com/oauth/authorize")!
        components.queryItems = [
            .init(name: "response_type",         value: "code"),
            .init(name: "client_id",             value: "YOUR_CLIENT_ID"),
            .init(name: "redirect_uri",          value: "yourapp://oauth/callback"),
            .init(name: "scope",                 value: "openid profile email offline_access"),
            .init(name: "code_challenge",        value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state",                 value: state),
        ]

        let callbackURL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: components.url!,
                callbackURLScheme: "yourapp"
            ) { url, error in
                if let error { continuation.resume(throwing: error); return }
                guard let url else { continuation.resume(throwing: OAuthError.missingCallback); return }
                continuation.resume(returning: url)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            session.start()
        }

        guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value
        else { throw OAuthError.missingCode }

        return try await exchangeCode(code, verifier: verifier)
    }

    private func exchangeCode(_ code: String, verifier: String) async throws -> String {
        // POST to token endpoint, return access token
        // Store tokens via TokenStore.shared.save(...)
        fatalError("Implement token exchange")
    }

    // PKCE helpers
    private func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }

    private func generateCodeChallenge(from verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        return Data(hash).base64URLEncodedString()
    }
}

enum OAuthError: LocalizedError {
    case missingCallback, missingCode
    var errorDescription: String? {
        switch self {
        case .missingCallback: return "No callback URL received"
        case .missingCode:     return "Authorization code missing from callback"
        }
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
```

---

## iOS — Token Refresh Logic

```swift
actor AuthService {
    private let apiClient: APIClient
    private var refreshTask: Task<String, Error>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

    /// Returns a valid access token, refreshing if necessary.
    func validAccessToken() async throws -> String {
        if let token = await TokenStore.shared.accessToken, !isExpired(token) {
            return token
        }
        return try await refresh()
    }

    private func refresh() async throws -> String {
        // Coalesce concurrent refresh calls into one network request
        if let existing = refreshTask {
            return try await existing.value
        }
        let task = Task<String, Error> {
            defer { refreshTask = nil }
            guard let refreshToken = await TokenStore.shared.refreshToken else {
                throw AuthError.noRefreshToken
            }
            let tokens = try await apiClient.refreshTokens(refreshToken: refreshToken)
            await TokenStore.shared.save(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken)
            return tokens.accessToken
        }
        refreshTask = task
        return try await task.value
    }

    private func isExpired(_ token: String) -> Bool {
        let parts = token.components(separatedBy: ".")
        guard parts.count == 3,
              let data = Data(base64Encoded: parts[1].paddedBase64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = payload["exp"] as? TimeInterval
        else { return true }
        return Date(timeIntervalSince1970: exp) < Date().addingTimeInterval(60)
    }
}

private extension String {
    var paddedBase64: String {
        let rem = count % 4
        return rem == 0 ? self : self + String(repeating: "=", count: 4 - rem)
    }
}

enum AuthError: LocalizedError {
    case noRefreshToken
    var errorDescription: String? { "No refresh token available — please sign in again" }
}
```

---

## iOS — Biometric Authentication (LAContext)

```swift
import LocalAuthentication

actor BiometricAuthService {
    func authenticate(reason: String) async throws {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw BiometricError.unavailable(error?.localizedDescription ?? "Biometrics not available")
        }

        let success = try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        )
        guard success else { throw BiometricError.failed }
    }
}

enum BiometricError: LocalizedError {
    case unavailable(String)
    case failed

    var errorDescription: String? {
        switch self {
        case .unavailable(let reason): return "Biometrics unavailable: \(reason)"
        case .failed:                  return "Biometric authentication failed"
        }
    }
}

// Usage — guard a sensitive action
func showSensitiveData() async {
    do {
        try await BiometricAuthService().authenticate(reason: "Authenticate to view your account details")
        // Proceed
    } catch {
        // Show error to user
    }
}
```

---

## Non-Negotiable Rules

- **NEVER** store tokens in `UserDefaults` — always use Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
- **NEVER** hardcode JWT signing keys — load from environment variables or Secrets Manager
- **NEVER** trust `X-Tenant-ID` headers for tenant isolation — derive from verified JWT claim only
- **NEVER** skip `expiration.verifyNotExpired()` in the `JWTPayload.verify` method
- **ALWAYS** use PKCE for OAuth2 flows on iOS — never implicit grant
- **ALWAYS** use `ASWebAuthenticationSession` with `prefersEphemeralWebBrowserSession = true` for auth
- **ALWAYS** coalesce concurrent token refresh calls — never fire parallel refresh requests
- Use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for maximum Keychain security
- Biometric auth gates sensitive actions; it does not replace server-side auth

## Anti-Patterns

```
❌ UserDefaults.standard.set(token, forKey: "token")  — use Keychain
❌ try! jwt.verify(token, as: Payload.self)            — propagate errors
❌ Trust X-Tenant-ID header without JWT validation    — verify from JWT only
❌ Multiple concurrent token refresh requests         — coalesce with Task
❌ OAuth2 implicit grant on iOS                       — always use PKCE
```

---

## See Also

- `api-patterns.instructions.md` — URLSession client using authorized requests
- `errorhandling.instructions.md` — Typed errors, AbortError in Vapor
- `multi-environment.instructions.md` — Auth issuer URL per environment
- `security.instructions.md` — Secrets management, TLS, certificate pinning
