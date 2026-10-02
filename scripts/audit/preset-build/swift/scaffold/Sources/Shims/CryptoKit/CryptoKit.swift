import Foundation

public enum SHA256 {
    public struct Digest: Sequence {
        public typealias Element = UInt8

        public init() {}

        public func makeIterator() -> Array<UInt8>.Iterator {
            [UInt8]().makeIterator()
        }
    }

    public static func hash(data: Data) -> Digest {
        Digest()
    }
}
