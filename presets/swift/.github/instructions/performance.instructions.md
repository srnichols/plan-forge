---
description: Swift performance optimization — value types, @inlinable, lazy var, retain cycles, copy-on-write, Swift Concurrency, Vapor EventLoop
applyTo: '**/*.swift'
---

# Swift Performance Patterns

> **Rule**: Profile first. Never optimize without a measurement baseline from Instruments.

---

## Value Types vs Reference Types

```swift
// ✅ Prefer struct for data models — no heap allocation, no reference counting
struct Point {
    var x: Double
    var y: Double
}

// ✅ Use class when you need identity, shared mutable state, or inheritance
final class NetworkSession {
    private let urlSession: URLSession
    // shared across the app — identity matters
}

// ❌ Don't use class just to avoid copying — copy-on-write collections are cheap
// ❌ Don't add class inheritance where a protocol would suffice
```

### When to Use Each

| Use `struct` | Use `class` |
|-------------|-------------|
| Data models (DTOs, view models) | Shared mutable state |
| Value semantics required | Requires `deinit` |
| Small, frequently copied types | Needs Objective-C interop |
| No subclassing needed | Identity comparison (`===`) needed |

---

## Copy-on-Write Semantics

```swift
// Swift Array, Dictionary, String — all copy-on-write
// Copies are O(1) until mutation triggers a real copy

// ✅ Understand that this is cheap:
var a = [1, 2, 3]
var b = a        // no copy yet — shared buffer
b.append(4)      // copy happens here only

// ✅ Implement CoW for custom value types wrapping classes:
struct LargeDataBuffer {
    private var _storage: StorageClass

    private mutating func makeUnique() {
        if !isKnownUniquelyReferenced(&_storage) {
            _storage = StorageClass(_storage)
        }
    }

    mutating func append(_ byte: UInt8) {
        makeUnique()
        _storage.append(byte)
    }
}
```

---

## @inlinable for Performance-Critical Functions

```swift
// ✅ Use @inlinable on hot-path functions in library/framework targets
// Allows the compiler to inline the body across module boundaries

@inlinable
public func clamp<T: Comparable>(_ value: T, min: T, max: T) -> T {
    Swift.min(Swift.max(value, min), max)
}

// ✅ Combine with @usableFromInline for private helpers:
@usableFromInline
internal func _validateRange(_ range: Range<Int>) -> Bool {
    !range.isEmpty
}
```

---

## lazy var — Deferred Initialization

```swift
// ✅ Use lazy for expensive setup that might not be needed
final class ProfileViewController: UIViewController {
    // Only allocated when first accessed
    lazy var analyticsManager: AnalyticsManager = {
        AnalyticsManager(config: .shared)
    }()

    lazy var heavyComputedData: [DataPoint] = {
        DataProcessor.buildDataSet(from: rawData)
    }()
}

// ⚠️ lazy var is NOT thread-safe — avoid in concurrent contexts
// ✅ For thread-safe lazy init, use a stored property set in init, or an actor
```

---

## Avoiding Retain Cycles

```swift
// ❌ Retain cycle — closure captures self strongly, self holds closure
class ViewModel {
    var onUpdate: (() -> Void)?
    func start() {
        onUpdate = {
            self.process()   // ❌ strong capture of self
        }
    }
}

// ✅ Weak capture in closures that outlive the call
class ViewModel {
    var onUpdate: (() -> Void)?
    func start() {
        onUpdate = { [weak self] in
            self?.process()  // ✅ safe — won't crash if ViewModel is deallocated
        }
    }
}

// ✅ Use [unowned self] ONLY when you can guarantee self outlives the closure
class ChildViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // [unowned self] is safe here — closure is released with the view
        button.addAction(UIAction { [unowned self] _ in
            handleTap()
        }, for: .touchUpInside)
    }
}

// ✅ Delegate pattern — always declare delegate as weak
protocol ItemDelegate: AnyObject { }
class ItemView: UIView {
    weak var delegate: ItemDelegate?   // ✅ weak — prevents cycle
}
```

---

## Memory Profiling with Instruments

```
Retain cycle detection workflow:
1. Run app in Instruments → Leaks template
2. Perform the suspected action (e.g., push/pop a view controller)
3. Force a memory event (navigate away, background app)
4. Leaks instrument shows abandoned objects with reference graph
5. Trace the cycle — look for ViewController → Closure → ViewController

Allocation profiling workflow:
1. Instruments → Allocations template
2. Use "Mark Generation" (M key) before and after an action
3. Compare generations — growth = potential leaks
4. Filter by your module name (not system frameworks)
```

---

## Never Block the Main Thread

```swift
// ❌ NEVER perform I/O, heavy computation, or network on the main thread
func loadData() {
    let data = try! Data(contentsOf: url)    // ❌ blocks UI
    let decoded = try! JSONDecoder().decode(Model.self, from: data)
    updateUI(decoded)
}

// ✅ ALWAYS perform I/O off the main thread, update UI back on main
func loadData() async {
    do {
        let (data, _) = try await URLSession.shared.data(from: url)   // off main
        let decoded = try JSONDecoder().decode(Model.self, from: data) // off main
        await MainActor.run {
            updateUI(decoded)   // ✅ back on main
        }
    } catch {
        Logger.networking.error("Load failed: \(error)")
    }
}

// ✅ Mark UI-updating methods with @MainActor
@MainActor
func updateUI(_ model: Model) {
    titleLabel.text = model.title
    tableView.reloadData()
}
```

---

## Swift Concurrency Performance

### Actor Hopping Cost

```swift
// ⚠️ Every await crossing an actor boundary has overhead — minimize hops
// ❌ Excessive actor hopping on a hot path
func buildReport() async -> Report {
    let a = await dataActor.fetchA()     // hop to dataActor
    let b = await dataActor.fetchB()     // hop to dataActor again (unnecessary)
    let c = await dataActor.fetchC()     // hop to dataActor again (unnecessary)
    return Report(a, b, c)
}

// ✅ Batch work within the actor
actor DataActor {
    func fetchAll() -> (A, B, C) {
        (fetchA(), fetchB(), fetchC())   // no hopping — all within actor
    }
}

func buildReport() async -> Report {
    let (a, b, c) = await dataActor.fetchAll()   // single hop
    return Report(a, b, c)
}
```

### @Sendable and Concurrency Safety

```swift
// ✅ Mark closures passed across concurrency domains as @Sendable
func enqueue(_ work: @Sendable @escaping () async -> Void) {
    Task { await work() }
}

// ✅ Prefer struct/enum for data crossing actor boundaries (Sendable by default)
struct OrderSummary: Sendable {
    let id: UUID
    let total: Decimal
}

// ✅ Use TaskGroup for structured concurrency over manual Task { } creation
func fetchAllUserData(for userID: UUID) async throws -> UserBundle {
    try await withThrowingTaskGroup(of: UserBundle.Component.self) { group in
        group.addTask { .orders(try await orderService.fetch(for: userID)) }
        group.addTask { .profile(try await profileService.fetch(for: userID)) }

        var components: [UserBundle.Component] = []
        for try await component in group {
            components.append(component)
        }
        return UserBundle(components)
    }
}
```

---

## Vapor — Never Block the EventLoop

```swift
// ❌ NEVER use blocking I/O or Thread.sleep on the EventLoop
app.get("data") { req in
    Thread.sleep(forTimeInterval: 1)  // ❌ blocks the EventLoop thread
    return "done"
}

// ✅ ALWAYS use async/await — Vapor 4 routes support it natively
app.get("data") { req async throws -> DataResponse in
    let result = try await dataService.fetch(on: req.db)   // ✅ non-blocking
    return DataResponse(result)
}

// ✅ For CPU-bound work, dispatch off the EventLoop
app.get("report") { req async throws -> ReportResponse in
    let report = try await req.application.threadPool.runIfActive(
        eventLoop: req.eventLoop
    ) {
        CPUBoundReportGenerator.generate()   // ✅ on thread pool, not EventLoop
    }.get()
    return ReportResponse(report)
}
```

---

## General Rules

| Pattern | Rule |
|---------|------|
| `struct` vs `class` | Prefer `struct`; use `class` only when identity/sharing is required |
| `lazy var` | Use for expensive properties not always needed; avoid in concurrent contexts |
| `[weak self]` | Always in escaping closures stored on self |
| `@inlinable` | Apply to hot-path public functions in framework targets |
| Main thread | Only UIKit/SwiftUI updates; all I/O must be async |
| Actor hopping | Batch actor work to minimize boundary crossings |
| Vapor EventLoop | Never block — use async/await or threadPool for CPU work |

---

## See Also

- `observability.instructions.md` — Instruments profiling, os_signpost, MetricKit
- `concurrency.instructions.md` — Actor isolation, structured concurrency patterns
- `database.instructions.md` — Fluent query optimization, connection pooling
