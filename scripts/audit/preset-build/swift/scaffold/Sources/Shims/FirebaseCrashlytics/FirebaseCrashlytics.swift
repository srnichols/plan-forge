public final class Crashlytics {
    public static func crashlytics() -> Crashlytics {
        Crashlytics()
    }

    public func setUserID(_ value: String) {}
    public func setCustomValue(_ value: String, forKey key: String) {}
    public func record(error: Error) {}
    public func log(_ message: String) {}
}
