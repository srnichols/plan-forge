// swift-tools-version: 6.4
import PackageDescription

let sampleDependencies: [Target.Dependency] = [
    .product(name: "Vapor", package: "vapor"),
    .product(name: "Fluent", package: "fluent"),
    .product(name: "FluentSQLiteDriver", package: "fluent-sqlite-driver"),
    .product(name: "FluentPostgresDriver", package: "fluent-postgres-driver"),
    .product(name: "JWT", package: "jwt"),
    .product(name: "XCTVapor", package: "vapor"),
    .product(name: "Logging", package: "swift-log"),
    "Redis",
    "Queues",
    "QueuesRedisDriver",
    "GRDB",
    "CryptoKit",
    "LocalAuthentication",
    "MetricKit",
    "FirebaseCrashlytics",
    "Sentry",
    "PackageDescription",
    .product(name: "NIOConcurrencyHelpers", package: "swift-nio"),
    "App",
]

let package = Package(
    name: "PresetSwiftHarness",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "App", targets: ["App"]),
        .executable(name: "Run", targets: ["Run"]),
    ],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.122.0"),
        .package(url: "https://github.com/vapor/fluent.git", from: "4.10.0"),
        .package(url: "https://github.com/vapor/fluent-sqlite-driver.git", from: "4.7.0"),
        .package(url: "https://github.com/vapor/fluent-postgres-driver.git", from: "2.9.0"),
        .package(url: "https://github.com/vapor/jwt.git", from: "5.0.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.5.4"),
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.79.0"),
    ],
    targets: [
        .target(
            name: "App",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
                .product(name: "Fluent", package: "fluent"),
                .product(name: "FluentSQLiteDriver", package: "fluent-sqlite-driver"),
                .product(name: "Logging", package: "swift-log")
            ],
            path: "Sources/App"
        ),
        .executableTarget(
            name: "Run",
            dependencies: ["App"],
            path: "Sources/Run"
        ),
        .target(name: "Redis", dependencies: [.product(name: "Vapor", package: "vapor")], path: "Sources/Shims/Redis"),
        .target(name: "Queues", dependencies: [.product(name: "Vapor", package: "vapor"), .product(name: "Logging", package: "swift-log")], path: "Sources/Shims/Queues"),
        .target(name: "QueuesRedisDriver", dependencies: ["Queues"], path: "Sources/Shims/QueuesRedisDriver"),
        .target(name: "GRDB", path: "Sources/Shims/GRDB"),
        .target(name: "CryptoKit", path: "Sources/Shims/CryptoKit"),
        .target(name: "LocalAuthentication", path: "Sources/Shims/LocalAuthentication"),
        .target(name: "MetricKit", path: "Sources/Shims/MetricKit"),
        .target(name: "FirebaseCrashlytics", path: "Sources/Shims/FirebaseCrashlytics"),
        .target(name: "Sentry", path: "Sources/Shims/Sentry"),
        .target(name: "PackageDescription", path: "Sources/Shims/PackageDescription"),
        .testTarget(name: "AppTests", dependencies: ["App"], path: "Tests/AppTests"),
        .testTarget(
            name: "ArchitectureReviewerAgentTests",
            dependencies: sampleDependencies,
            path: "Tests/ArchitectureReviewerAgentTests"
        ),
        .testTarget(
            name: "DatabaseReviewerAgentTests",
            dependencies: sampleDependencies,
            path: "Tests/DatabaseReviewerAgentTests"
        ),
        .testTarget(
            name: "PerformanceAnalyzerAgentTests",
            dependencies: sampleDependencies,
            path: "Tests/PerformanceAnalyzerAgentTests"
        ),
        .testTarget(
            name: "SecurityReviewerAgentTests",
            dependencies: sampleDependencies,
            path: "Tests/SecurityReviewerAgentTests"
        ),
        .testTarget(
            name: "ApiPatternsInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/ApiPatternsInstructionsTests"
        ),
        .testTarget(
            name: "AuthInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/AuthInstructionsTests"
        ),
        .testTarget(
            name: "CachingInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/CachingInstructionsTests"
        ),
        .testTarget(
            name: "DatabaseInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/DatabaseInstructionsTests"
        ),
        .testTarget(
            name: "DeployInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/DeployInstructionsTests"
        ),
        .testTarget(
            name: "ErrorHandlingInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/ErrorHandlingInstructionsTests"
        ),
        .testTarget(
            name: "MessagingInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/MessagingInstructionsTests"
        ),
        .testTarget(
            name: "MultiEnvironmentInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/MultiEnvironmentInstructionsTests"
        ),
        .testTarget(
            name: "ObservabilityInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/ObservabilityInstructionsTests"
        ),
        .testTarget(
            name: "PerformanceInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/PerformanceInstructionsTests"
        ),
        .testTarget(
            name: "SecurityInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/SecurityInstructionsTests"
        ),
        .testTarget(
            name: "SwiftuiInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/SwiftuiInstructionsTests"
        ),
        .testTarget(
            name: "TestingInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/TestingInstructionsTests"
        ),
        .testTarget(
            name: "TestingInstructionsMockTests",
            path: "Tests/TestingInstructionsMockTests"
        ),
        .testTarget(
            name: "VersionInstructionsTests",
            dependencies: sampleDependencies,
            path: "Tests/VersionInstructionsTests"
        ),
        .testTarget(
            name: "BugFixTddPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/BugFixTddPromptTests"
        ),
        .testTarget(
            name: "NewConfigPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewConfigPromptTests"
        ),
        .testTarget(
            name: "NewControllerPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewControllerPromptTests"
        ),
        .testTarget(
            name: "NewDtoPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewDtoPromptTests"
        ),
        .testTarget(
            name: "NewEntityPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewEntityPromptTests"
        ),
        .testTarget(
            name: "NewErrorTypesPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewErrorTypesPromptTests"
        ),
        .testTarget(
            name: "NewEventHandlerPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewEventHandlerPromptTests"
        ),
        .testTarget(
            name: "NewMiddlewarePromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewMiddlewarePromptTests"
        ),
        .testTarget(
            name: "NewRepositoryPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewRepositoryPromptTests"
        ),
        .testTarget(
            name: "NewServicePromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewServicePromptTests"
        ),
        .testTarget(
            name: "NewTestPromptTests",
            dependencies: sampleDependencies,
            path: "Tests/NewTestPromptTests"
        ),
        .testTarget(
            name: "ApiDocGenSkillTests",
            dependencies: sampleDependencies,
            path: "Tests/ApiDocGenSkillTests"
        ),
        .testTarget(
            name: "DatabaseMigrationSkillTests",
            dependencies: sampleDependencies,
            path: "Tests/DatabaseMigrationSkillTests"
        ),
        .testTarget(
            name: "AgentsDocTests",
            dependencies: sampleDependencies,
            path: "Tests/AgentsDocTests"
        )
    ]
)
