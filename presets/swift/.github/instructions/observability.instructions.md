---
description: Observability patterns for Swift/iOS — OSLog, MetricKit, Instruments, os_signpost, crash reporting, Vapor logging
applyTo: '**/*.swift'
---

# Swift Observability Patterns

> **Applies to**: iOS, macOS, and Vapor server-side Swift projects

---

## Structured Logging with OSLog

### Logger Setup (iOS 14+ / macOS 11+)

```swift
import OSLog

// ✅ One Logger per subsystem+category — define at module scope
extension Logger {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "com.example.app"

    static let networking = Logger(subsystem: subsystem, category: "Networking")
    static let orders     = Logger(subsystem: subsystem, category: "Orders")
    static let auth       = Logger(subsystem: subsystem, category: "Auth")
    static let ui         = Logger(subsystem: subsystem, category: "UI")
}

// Usage
Logger.orders.info("Order placed: \(orderID, privacy: .public)")
Logger.networking.error("Request failed: \(error.localizedDescription, privacy: .public)")

// ✅ Mark sensitive values as .private (default) — they redact in Console.app on other devices
Logger.auth.debug("Token acquired for user \(userID, privacy: .private(mask: .hash))")
```

### Log Levels

| Level | Use Case |
|-------|----------|
| `.debug` | Verbose diagnostics — only visible in development |
| `.info` | Normal operational events |
| `.notice` | Significant milestones (default persistence threshold) |
| `.error` | Recoverable errors |
| `.fault` | Bugs that require immediate attention |
| `.critical` | System-level failures |

```swift
// ✅ Match level to severity
Logger.orders.debug("Fetching page \(page) of orders")
Logger.orders.notice("Order \(orderID, privacy: .public) transitioned to .shipped")
Logger.orders.error("Payment declined for order \(orderID, privacy: .public): \(reason)")
Logger.orders.fault("Unexpected nil order model — data integrity issue")
```

---

## MetricKit — Performance & Energy Metrics

```swift
import MetricKit

// ✅ Register subscriber in AppDelegate / app startup
final class MetricsSubscriber: NSObject, MXMetricManagerSubscriber {
    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            if let histogram = payload.applicationLaunchMetrics?.histogrammedTimeToFirstDraw {
                Logger.ui.info("App launch p50: \(histogram.bucketEnumerator.allObjects)")
            }
            if let memory = payload.memoryMetrics?.peakMemoryUsage {
                Logger.ui.info("Peak memory: \(memory)")
            }
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            // Crash logs, hang logs, CPU exceptions
            payload.crashDiagnostics?.forEach { crash in
                Logger.ui.fault("Crash: \(crash.callStackTree.description)")
            }
        }
    }
}

// In AppDelegate
func application(_ application: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    MXMetricManager.shared.add(MetricsSubscriber())
    return true
}
```

---

## os_signpost — Custom Performance Markers

```swift
import OSLog

// ✅ Use signposts for Time Profiler intervals in Instruments
private let signpostLog = OSLog(subsystem: "com.example.app", category: .pointsOfInterest)

func fetchFeed() async throws -> [FeedItem] {
    let signpostID = OSSignpostID(log: signpostLog)
    os_signpost(.begin, log: signpostLog, name: "FetchFeed", signpostID: signpostID)
    defer {
        os_signpost(.end, log: signpostLog, name: "FetchFeed", signpostID: signpostID)
    }

    return try await feedService.fetchLatest()
}

// ✅ Events (instantaneous markers)
os_signpost(.event, log: signpostLog, name: "CacheHit", "key=%{public}s", cacheKey)
```

---

## Instruments

| Instrument | Use Case |
|------------|----------|
| **Time Profiler** | Find CPU hot paths and hang sources |
| **Allocations** | Track heap growth, find memory leaks |
| **Leaks** | Detect abandoned objects and retain cycles |
| **Network** | Inspect URLSession traffic, latency |
| **Energy Log** | Identify CPU/radio/GPS drain |
| **SwiftUI** | View body re-render counts |

```
Instruments workflow:
1. Product → Profile (⌘I) in Xcode
2. Choose instrument template
3. Record on a real device (not Simulator for energy/network)
4. Identify hotspots → correlate with os_signpost markers
5. Fix, measure again — never optimize without profiling first
```

---

## Xcode Organizer

Access via **Xcode → Window → Organizer**:

- **Crashes** — symbolicated crash reports from TestFlight and App Store
- **Energy Reports** — identify battery-draining usage patterns
- **Disk Writes** — excessive writes causing thermal/battery issues
- **Hang Rate** — main thread stalls > 250ms

```swift
// ✅ Always symbolicate crash reports:
// Xcode Organizer auto-symbolicates using dSYMs uploaded to App Store Connect
// For CI builds: upload dSYM via Fastlane or xcodebuild -exportArchive
```

---

## Firebase Crashlytics / Sentry

### Firebase Crashlytics

```swift
import FirebaseCrashlytics

// ✅ Set user context for post-crash investigation
Crashlytics.crashlytics().setUserID(userID)
Crashlytics.crashlytics().setCustomValue(tenantID, forKey: "tenantID")

// ✅ Log non-fatal errors
Crashlytics.crashlytics().record(error: validationError)

// ✅ Log breadcrumbs
Crashlytics.crashlytics().log("User navigated to checkout")

// ❌ NEVER log PII (names, emails, tokens)
```

### Sentry

```swift
import Sentry

SentrySDK.start { options in
    options.dsn = Environment.get("SENTRY_DSN")   // ❌ never hardcode
    options.environment = AppConfig.environment    // "production" / "staging"
    options.tracesSampleRate = 0.2                 // 20% of transactions
    options.enableAutoPerformanceTracing = true
}

// Capture non-fatal error
SentrySDK.capture(error: error) { scope in
    scope.setTag(value: orderID, key: "order_id")
}
```

---

## Vapor — Server-Side Logging

```swift
import Vapor

// ✅ Use request.logger (request-scoped — includes request ID)
func createOrder(_ req: Request) async throws -> OrderResponse {
    req.logger.info("Creating order", metadata: [
        "userID": .string(userID),
        "itemCount": .stringConvertible(items.count)
    ])

    do {
        let order = try await orderService.create(req.db, payload: dto)
        req.logger.notice("Order created", metadata: ["orderID": .string(order.id!.uuidString)])
        return OrderResponse(order)
    } catch {
        req.logger.error("Order creation failed: \(error)")
        throw error
    }
}

// ✅ Configure log level from environment
app.logger.logLevel = Environment.get("LOG_LEVEL")
    .flatMap(Logger.Level.init) ?? .info
```

### Vapor Custom Log Handler

```swift
import Logging
import Vapor

// ✅ JSON log handler for structured log aggregation (Datadog, CloudWatch, etc.)
LoggingSystem.bootstrap { label in
    var handler = StreamLogHandler.standardOutput(label: label)
    handler.logLevel = .info
    return handler
}
```

---

## Non-Negotiable Rules

```
✅ Use Logger(subsystem:category:) — never print() in production code
✅ Mark PII / sensitive values as .private in OSLog interpolations
✅ Add os_signpost markers around operations you profile with Instruments
✅ Subscribe to MetricKit in AppDelegate for production metric collection
✅ Upload dSYMs to crash reporting service in every CI build pipeline
✅ Set log level from environment variable — never hardcode in Vapor
❌ Never log passwords, tokens, credit card numbers, or full user records
❌ Never use print() as a substitute for proper structured logging
❌ Never ignore Crashlytics/Sentry non-fatal errors silently
```

---

## See Also

- `performance.instructions.md` — Profiling with Instruments, main thread rules
- `security.instructions.md` — Privacy-safe logging, secrets management
- `testing.instructions.md` — Testability of observable behavior
- `errorhandling.instructions.md` — Structured error propagation
