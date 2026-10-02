import Foundation

public class ASPresentationAnchor {
    public init() {}
}

public protocol ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor
}

public final class ASWebAuthenticationSession {
    public var presentationContextProvider: ASWebAuthenticationPresentationContextProviding?
    public var prefersEphemeralWebBrowserSession = false

    public init(url: URL, callbackURLScheme: String?, completionHandler: @escaping (URL?, Error?) -> Void) {}

    public func start() -> Bool {
        true
    }
}

open class NSObject {
    public init() {}
}

public class UIWindowScene {
    public var windows: [UIWindow] = [UIWindow()]

    public init() {}
}

public class UIWindow {
    public init() {}
}

public final class UIApplication: @unchecked Sendable {
    public static let shared = UIApplication()
    public var connectedScenes: [Any] = [UIWindowScene()]

    public init() {}
}
