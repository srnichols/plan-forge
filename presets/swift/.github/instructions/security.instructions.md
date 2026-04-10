---
description: Swift security patterns — Keychain, ATS, certificate pinning, input validation, SQL injection prevention, CORS, OWASP Mobile Top 10
applyTo: '**/*.swift'
---

# Swift Security Patterns

> **Applies to**: iOS/macOS apps and Vapor server-side Swift  
> **Alignment**: OWASP Mobile Top 10 (2024) + OWASP Top 10 (2021)

---

## Secrets Storage — Keychain (Never UserDefaults)

```swift
// ❌ NEVER: UserDefaults for secrets
UserDefaults.standard.set(token, forKey: "authToken")

// ✅ ALWAYS: Keychain via Security framework
import Security

enum KeychainError: Error {
    case unhandledError(status: OSStatus)
    case itemNotFound
}

func saveToken(_ token: String, for key: String) throws {
    let data = Data(token.utf8)
    let query: [CFString: Any] = [
        kSecClass:              kSecClassGenericPassword,
        kSecAttrAccount:        key,
        kSecValueData:          data,
        kSecAttrAccessible:     kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
        throw KeychainError.unhandledError(status: status)
    }
}

func loadToken(for key: String) throws -> String {
    let query: [CFString: Any] = [
        kSecClass:              kSecClassGenericPassword,
        kSecAttrAccount:        key,
        kSecReturnData:         true,
        kSecMatchLimit:         kSecMatchLimitOne
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data,
          let token = String(data: data, encoding: .utf8) else {
        throw KeychainError.itemNotFound
    }
    return token
}
```

### Keychain Accessibility Values

| Value | Use Case |
|-------|----------|
| `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | ✅ Preferred — tokens, keys |
| `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` | Background access (push notifications) |
| `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` | High-security — requires device passcode |
| `kSecAttrAccessibleAlways` | ❌ Never — no protection |

---

## No Hardcoded Secrets

```swift
// ❌ NEVER: Hardcoded secrets in source code
let apiKey = "sk-abc123secret"
let dbPassword = "hunter2"

// ✅ ALWAYS: Environment variables (Vapor server)
guard let apiKey = Environment.get("API_KEY") else {
    fatalError("API_KEY environment variable is required")
}

// ✅ iOS/macOS apps: load from Keychain (set during onboarding/auth flow)
// ✅ Use .xcconfig files for non-secret build-time config (base URLs, feature flags)
// ✅ Never commit .xcconfig files with secrets to source control
```

---

## ATS — App Transport Security

```xml
<!-- ❌ NEVER in production — disables all TLS enforcement -->
<key>NSAllowsArbitraryLoads</key>
<true/>

<!-- ✅ All production traffic must use HTTPS — no exceptions needed -->
<!-- ✅ Only add exceptions with justification and App Store review justification -->
<key>NSExceptionDomains</key>
<dict>
    <key>internal.dev.example.com</key>
    <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key>
        <true/>
        <!-- REASON: Internal development server — debug builds only, not shipped -->
    </dict>
</dict>
```

---

## Certificate Pinning

```swift
// ✅ Pin against the server's public key hash using URLSessionDelegate
import CryptoKit

final class PinnedSessionDelegate: NSObject, URLSessionDelegate {
    // SHA-256 of the DER-encoded SubjectPublicKeyInfo
    private let pinnedPublicKeyHashes: Set<String> = [
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",  // current cert
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="   // backup cert
    ]

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust,
              let certificate = SecTrustGetCertificateAtIndex(serverTrust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        var publicKey: SecKey?
        if #available(iOS 14, *) {
            publicKey = SecCertificateCopyKey(certificate)
        }

        guard let key = publicKey,
              let keyData = SecKeyCopyExternalRepresentation(key, nil) as Data? else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        let hash = SHA256.hash(data: keyData).map { String(format: "%02x", $0) }.joined()
        let base64Hash = Data(SHA256.hash(data: keyData)).base64EncodedString()

        if pinnedPublicKeyHashes.contains(base64Hash) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

// Usage
let session = URLSession(
    configuration: .default,
    delegate: PinnedSessionDelegate(),
    delegateQueue: nil
)
```

---

## Force-Unwrap Prevention

```swift
// ❌ NEVER: Force-unwrap — crashes in production
let url = URL(string: userInput)!
let value = dictionary["key"]! as! String

// ✅ ALWAYS: Guard with error or safe fallback
guard let url = URL(string: userInput) else {
    throw ValidationError.invalidURL(userInput)
}

// ❌ NEVER: try! in production
let data = try! JSONEncoder().encode(payload)

// ✅ ALWAYS: Propagate or handle the error
let data = try JSONEncoder().encode(payload)

// ✅ Force-unwrap is ONLY acceptable with a justification comment:
// The regex is a compile-time constant verified by unit tests — safe to force-unwrap
let regex = try! NSRegularExpression(pattern: "^[a-z]{3,}$")
```

---

## Input Validation at Service Boundaries

```swift
// ❌ NEVER: Trust input directly
func createUser(req: Request) async throws -> UserResponse {
    let dto = try req.content.decode(CreateUserRequest.self)
    return try await userService.create(dto)  // ❌ unvalidated
}

// ✅ ALWAYS: Validate before passing to service layer
func createUser(req: Request) async throws -> UserResponse {
    let dto = try req.content.decode(CreateUserRequest.self)
    try dto.validate()
    return try await userService.create(dto)
}

extension CreateUserRequest: Validatable {
    static func validations(_ validations: inout Validations) {
        validations.add("name",  as: String.self, is: !.empty && .count(1...200))
        validations.add("email", as: String.self, is: .email)
        validations.add("age",   as: Int.self,    is: .range(13...120))
    }
}
```

---

## SQL Injection Prevention — Fluent / GRDB

```swift
// ❌ NEVER: Raw SQL with string interpolation
let results = try await db.raw("SELECT * FROM users WHERE id = '\(userInput)'").all()

// ✅ ALWAYS: Fluent query builder (parameterized automatically)
let user = try await User.find(id, on: db)

let users = try await User.query(on: db)
    .filter(\.$email == email)
    .first()

// ✅ Raw SQL with bound parameters (Fluent \(bind:) syntax)
let results = try await db
    .raw("SELECT * FROM users WHERE status = \(bind: status)")
    .all(decoding: User.self)

// ✅ GRDB parameterized queries
let users = try dbQueue.read { db in
    try User.fetchAll(db, sql: "SELECT * FROM users WHERE email = ?", arguments: [email])
}
```

---

## JWT Validation (Vapor + JWTKit)

```swift
import JWTKit

// ✅ Always validate audience, issuer, and expiry
let payload = try await req.jwt.verify(as: AppJWTPayload.self)
guard payload.audience.value.contains("com.example.myapp") else {
    throw Abort(.unauthorized, reason: "Invalid audience")
}
guard payload.issuer.value == "https://auth.example.com" else {
    throw Abort(.unauthorized, reason: "Invalid issuer")
}
// expiry is validated automatically by JWTKit
```

---

## Role-Based Access Control (Vapor Middleware)

```swift
struct RequireRoleMiddleware: AsyncMiddleware {
    let requiredRole: UserRole

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        let user = try request.auth.require(AuthUser.self)
        guard user.role >= requiredRole else {
            throw Abort(.forbidden, reason: "Insufficient permissions")
        }
        return try await next.respond(to: request)
    }
}

// Usage in routes
let adminRoutes = app.grouped(RequireRoleMiddleware(requiredRole: .admin))
adminRoutes.delete("users", ":id", use: deleteUser)
```

---

## CORS Configuration (Vapor)

```swift
// ✅ Explicit allowed origins — never wildcard in production
app.middleware.use(CORSMiddleware(configuration: .init(
    allowedOrigin: .any(["https://app.example.com", "https://admin.example.com"]),
    allowedMethods: [.GET, .POST, .PUT, .PATCH, .DELETE],
    allowedHeaders: [.authorization, .contentType, .accept],
    allowCredentials: true,
    cacheExpiration: 3600
)))

// ❌ NEVER in production:
// allowedOrigin: .all   — allows any origin
```

---

## Security Headers Middleware (Vapor)

```swift
struct SecurityHeadersMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        let response = try await next.respond(to: request)
        response.headers.add(name: "X-Content-Type-Options",    value: "nosniff")
        response.headers.add(name: "X-Frame-Options",           value: "DENY")
        response.headers.add(name: "X-XSS-Protection",          value: "1; mode=block")
        response.headers.add(name: "Referrer-Policy",           value: "strict-origin-when-cross-origin")
        response.headers.add(name: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains")
        return response
    }
}
```

---

## OWASP Mobile Top 10 Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| M1: Improper Credential Usage | Keychain storage, never UserDefaults |
| M2: Inadequate Supply Chain Security | Pin SPM dependencies to exact versions |
| M3: Insecure Authentication / Authorization | JWT audience/issuer validation, `RequireRoleMiddleware` |
| M4: Insufficient Input/Output Validation | `Validatable` protocol, `guard let` |
| M5: Insecure Communication | ATS enforcement, certificate pinning |
| M6: Inadequate Privacy Controls | `.private` OSLog privacy, Keychain accessibility levels |
| M7: Insufficient Binary Protections | Enable Bitcode, strip debug symbols in release builds |
| M8: Security Misconfiguration | No `NSAllowsArbitraryLoads`, CORS explicit origins |
| M9: Insecure Data Storage | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` |
| M10: Insufficient Cryptography | No custom crypto — use CryptoKit, CommonCrypto |

---

## Non-Negotiable Rules

```
✅ Keychain for all credentials and tokens — never UserDefaults
✅ Validate all input at service boundaries using Validatable
✅ Parameterized queries only — Fluent query builder or \(bind:) for raw SQL
✅ Guard let / if let everywhere — no ! without a justification comment
✅ ATS enabled; document any NSExceptionDomains with a reason comment
✅ CORS: explicit allowed origins list in production
✅ JWT: always validate audience + issuer + expiry
❌ Never hardcode secrets — use environment variables or Keychain
❌ Never disable ATS globally (NSAllowsArbitraryLoads: true)
❌ Never log passwords, tokens, credit card numbers, or PII
❌ Never use try! or force-unwrap (!) without a comment justifying safety
```

---

## See Also

- `auth.instructions.md` — OAuth 2.0, Sign In with Apple, biometric authentication
- `observability.instructions.md` — Privacy-safe logging, .private OSLog values
- `database.instructions.md` — Fluent migration security, query safety
- `deploy.instructions.md` — Secrets injection in CI/CD pipelines

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This endpoint is internal-only, no auth needed" | Internal endpoints get exposed through misconfiguration, reverse proxies, or future refactors. Apply auth middleware everywhere — remove it explicitly when proven unnecessary. |
| "Input validation is overkill for this field" | Every unvalidated input is an injection vector. Validate at system boundaries always — a `Validatable` conformance is a single protocol that prevents a category of vulnerabilities. |
| "We'll add authentication later" | Unauthenticated endpoints get discovered and exploited. Security is not a feature to add — it's a constraint present from line one. |
| "No real users yet, security can wait" | Attackers scan for unprotected endpoints automatically. The window between "no real users" and "compromised" is often hours, not months. |
| "I'll remove the guard middleware temporarily for testing" | Temporary auth bypasses become permanent. Use test-specific `Application` configuration or mock authenticators instead. |
| "Hardcoding this key is fine for development" | Hardcoded secrets leak via git history, logs, and error messages. Use `Environment.get()` or `.env` files even in development. |

---

## Warning Signs

- Route groups missing `GuardMiddleware` or `BearerAuthenticator` in Vapor
- String interpolation used in raw SQL queries (`"\(userInput)"` in Fluent raw queries)
- Secrets assigned as string literals (`let apiKey = "abc123"`)
- CORS configured with wildcard origin (`allowedOrigin: .all`)
- Missing CSRF protection on state-changing endpoints
- Error responses expose internal paths or stack information in non-development mode
