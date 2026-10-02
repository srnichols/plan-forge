public final class SentrySDK {
    public static func start(configure: (Options) -> Void) {
        configure(Options())
    }

    public static func capture(error: Error, configureScope: (Scope) -> Void) {
        configureScope(Scope())
    }
}

public final class Options {
    public var dsn = ""
    public var environment = ""
    public var tracesSampleRate = 0.0
    public var enableAutoPerformanceTracing = false

    public init() {}
}

public final class Scope {
    public init() {}

    public func setTag(value: String, key: String) {}
}
