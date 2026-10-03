// swift-tools-version: 6.0
// Smallest Vapor app the Swift preset's Dockerfiles can build and health-check.
import PackageDescription

let package = Package(
    name: "PresetSwiftDocker",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.122.0"),
    ],
    targets: [
        .executableTarget(
            name: "App",
            dependencies: [.product(name: "Vapor", package: "vapor")]
        ),
    ]
)