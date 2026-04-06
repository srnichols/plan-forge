---
description: Swift security patterns — Keychain, ATS, force-unwrap prevention, input validation
applyTo: '**/*.swift'
---

# Swift Security Patterns

## Authentication & Authorization

### Keychain Storage (Never UserDefaults for Secrets)
```swift
// ❌ NEVER: UserDefaults for secrets
UserDefaults.standard.set(token, forKey: "authToken")

// ✅ ALWAYS: Keychain
import Security

func saveToken(_ token: String, for key: String) throws {
    let data = Data(token.utf8)
    let query: [CFString: Any] = [
        kSecClass:       kSecClassGenericPassword,
        kSecAttrAccount: key,
        kSecValueData:   data,
        kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
        throw KeychainError.unhandledError(status: status)
    }
}
```

### JWT Validation (JWTKit / Vapor)
```swift
import JWTKit

// ✅ Validate audience, issuer, and expiry
let payload = try await req.jwt.verify(as: AppJWTPayload.self)
guard payload.audience.value.contains("my-app") else {
    throw Abort(.unauthorized)
}
```

### Role-Based Access (Vapor Middleware)
```swift
struct RequireRoleMiddleware: AsyncMiddleware {
    let role: UserRole

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        let user = try request.auth.require(AuthUser.self)
        guard user.role >= role else {
            throw Abort(.forbidden)
        }
        return try await next.respond(to: request)
    }
}
```

## Force-Unwrap Prevention

```swift
// ❌ NEVER: Force-unwrap
let url = URL(string: userInput)!

// ✅ ALWAYS: Guard with error
guard let url = URL(string: userInput) else {
    throw ValidationError.invalidURL(userInput)
}

// ❌ NEVER: try! in production
let data = try! JSONEncoder().encode(payload)

// ✅ ALWAYS: Propagate error
let data = try JSONEncoder().encode(payload)
```

## Input Validation

```swift
// ❌ NEVER: Trust input directly
func createUser(req: Request) async throws -> UserResponse {
    let dto = try req.content.decode(CreateUserRequest.self)
    return try await userService.create(dto)
}

// ✅ ALWAYS: Validate before passing to service
func createUser(req: Request) async throws -> UserResponse {
    let dto = try req.content.decode(CreateUserRequest.self)
    try dto.validate()  // throws ValidationError with details
    return try await userService.create(dto)
}

extension CreateUserRequest: Validatable {
    static func validations(_ validations: inout Validations) {
        validations.add("name", as: String.self, is: !.empty && .count(1...200))
        validations.add("email", as: String.self, is: .email)
    }
}
```

## Secrets Management

```swift
// ❌ NEVER: Hardcoded secrets
let apiKey = "sk-abc123"

// ✅ ALWAYS: Environment variables
guard let apiKey = Environment.get("API_KEY") else {
    fatalError("API_KEY environment variable is required")
}
```

## SQL Injection Prevention (Fluent)

```swift
// ❌ NEVER: Raw SQL with string interpolation
let results = try await db.raw("SELECT * FROM users WHERE id = '\(userInput)'").all()

// ✅ ALWAYS: Fluent query builder (parameterized)
let user = try await User.find(id, on: db)

// ✅ ALSO OK: Raw SQL with bound parameters
let results = try await db.raw("SELECT * FROM users WHERE id = \(bind: id)").all(decoding: User.self)
```

## ATS (App Transport Security)

```xml
<!-- ❌ NEVER in production: -->
<key>NSAllowsArbitraryLoads</key>
<true/>

<!-- ✅ ONLY specific domains with justification: -->
<key>NSExceptionDomains</key>
<dict>
    <key>internal.company.com</key>
    <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key>
        <true/>
        <!-- Reason: Internal dev server, not shipped to App Store -->
    </dict>
</dict>
```

## CORS Configuration (Vapor)

```swift
// ✅ Explicit allowed origins only
app.middleware.use(CORSMiddleware(configuration: .init(
    allowedOrigin: .any(["https://yourdomain.com"]),
    allowedMethods: [.GET, .POST, .PUT, .DELETE],
    allowedHeaders: [.authorization, .contentType],
    allowCredentials: true,
    cacheExpiration: 3600
)))
```

## Common Vulnerabilities to Prevent

| Vulnerability | Prevention |
|--------------|------------|
| Injection | Fluent query builder, `\(bind:)` in raw SQL |
| Broken Auth | Keychain storage, JWT validation with audience/issuer |
| Force-unwrap crash | `guard let` / `if let` / throw |
| ATS bypass | No `NSAllowsArbitraryLoads`; document any exceptions |
| Secrets in code | Environment variables, Keychain, not UserDefaults |
| Insecure data storage | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` |

## OWASP Top 10 (2021) Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| A01: Broken Access Control | `RequireRoleMiddleware`, route authentication groups |
| A02: Cryptographic Failures | Keychain, `kSecAttrAccessibleWhenUnlocked*` |
| A03: Injection | Fluent ORM, `\(bind:)` for raw SQL |
| A04: Insecure Design | `Validatable` protocol, explicit validation |
| A05: Security Misconfiguration | ATS, CORS configuration |
| A07: Identification & Auth Failures | JWT audience/issuer check, no UserDefaults for tokens |

## See Also

- `auth.instructions.md` — OAuth, Sign In with Apple, biometric auth
- `database.instructions.md` — Fluent query safety, migration security
- `deploy.instructions.md` — Environment variables, secrets management in CI/CD
- `api-patterns.instructions.md` — Input validation middleware
