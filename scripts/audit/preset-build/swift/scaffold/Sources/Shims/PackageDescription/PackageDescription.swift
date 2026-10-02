public struct Package {
    public init(name: String, dependencies: [Any] = [], targets: [Any] = []) {}
}

public enum SupportedPlatform {
    case macOS(Any)
}
