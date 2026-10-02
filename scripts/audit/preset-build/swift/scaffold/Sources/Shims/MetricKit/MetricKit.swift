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

public struct Histogram {
    public var bucketEnumerator: NSArray {
        NSArray()
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
