import Foundation

public protocol MXMetricManagerSubscriber {}

public final class MXMetricManager: @unchecked Sendable {
    public static let shared = MXMetricManager()

    public func add(_ subscriber: any MXMetricManagerSubscriber) {}
}

public struct MXMetricPayload {
    public var applicationLaunchMetrics: ApplicationLaunchMetrics?
    public var memoryMetrics: MemoryMetrics?

    public init() {}
}

public struct MXDiagnosticPayload {
    public var crashDiagnostics: [CrashDiagnostic]?

    public init() {}
}

public struct ApplicationLaunchMetrics {
    public var histogrammedTimeToFirstDraw: Histogram?

    public init() {}
}

// `NSArray.allObjects` is `internal` (not public) in swift-corelibs-foundation,
// so a real `NSArray` can't support the `.bucketEnumerator.allObjects` call
// from the observability.instructions.md sample on Linux. `NSEnumerator`
// provides a public `allObjects` default implementation built on
// `nextObject()`, so return a concrete (empty) subclass of that instead.
public final class EmptyBucketEnumerator: NSEnumerator, @unchecked Sendable {
    public override func nextObject() -> Any? { nil }
}

public struct Histogram {
    public var bucketEnumerator: NSEnumerator {
        EmptyBucketEnumerator()
    }
}

public struct MemoryMetrics {
    public var peakMemoryUsage: Int?

    public init() {}
}

public struct CrashDiagnostic {
    public var callStackTree: NSString {
        ""
    }
}
