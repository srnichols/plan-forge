import Foundation

public final class LAContext {
    public init() {}

    public func canEvaluatePolicy(_ policy: LAPolicy, error: inout NSError?) -> Bool {
        true
    }

    public func evaluatePolicy(_ policy: LAPolicy, localizedReason: String) async throws -> Bool {
        true
    }
}

public enum LAPolicy {
    case deviceOwnerAuthenticationWithBiometrics
}
