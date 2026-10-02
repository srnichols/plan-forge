import Queues

public struct RedisQueueDriver {
    public init() {}

    public static func redis(url: String) -> Self {
        .init()
    }
}

public extension QueueRegistry {
    func use(_ driver: RedisQueueDriver) throws {}
}
