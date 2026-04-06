---
description: Swift versioning — CFBundleShortVersionString, CFBundleVersion, SPM Package.swift, App Store Connect, fastlane, Git tags
applyTo: '**/Package.swift,**/Info.plist,**/version.swift,**/*.xcconfig'
---

# Swift Version Management

> **Applies to**: iOS/macOS apps and Swift Package Manager (SPM) libraries

---

## Semantic Versioning

```
MAJOR.MINOR.PATCH
  2  .  4  .  1
```

| Segment | When to Increment | Example |
|---------|-------------------|---------|
| **MAJOR** | Breaking API changes | `1.x.x` → `2.0.0` |
| **MINOR** | New features, backward-compatible | `2.3.x` → `2.4.0` |
| **PATCH** | Bug fixes, performance, minor tweaks | `2.4.0` → `2.4.1` |

### Conventional Commit → Version Bump

| Commit Prefix | Version Impact |
|---|---|
| `feat:` | MINOR +1 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 |
| `docs:` / `chore:` / `test:` / `ci:` | No bump |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 |

---

## iOS/macOS App Versioning

### Info.plist Keys

```xml
<!-- CFBundleShortVersionString: marketing version shown in App Store and Settings -->
<key>CFBundleShortVersionString</key>
<string>2.4.1</string>

<!-- CFBundleVersion: build number — must be monotonically increasing integer -->
<key>CFBundleVersion</key>
<string>241</string>
```

### Reading Version at Runtime

```swift
// ✅ Always read from Bundle — never hardcode
extension Bundle {
    static var marketingVersion: String {
        main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    static var buildNumber: String {
        main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
    }
}

// Usage
Logger.app.info("App version \(Bundle.marketingVersion) build \(Bundle.buildNumber)")
```

### xcconfig for Version Management

```xcconfig
// Version.xcconfig
MARKETING_VERSION = 2.4.1
CURRENT_PROJECT_VERSION = 241
```

```
Project Settings → Build Settings → Versioning:
  Marketing Version       = $(MARKETING_VERSION)
  Current Project Version = $(CURRENT_PROJECT_VERSION)
```

---

## SPM Library Versioning

### Package.swift

```swift
// ✅ No version field in Package.swift itself — version is determined by Git tag
// Package.swift declares the supported Swift tools version only
// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "MyLibrary",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "MyLibrary", targets: ["MyLibrary"])
    ],
    targets: [
        .target(name: "MyLibrary"),
        .testTarget(name: "MyLibraryTests", dependencies: ["MyLibrary"])
    ]
)
```

### Consuming a Versioned SPM Package

```swift
// In your Package.swift dependencies
dependencies: [
    // ✅ Exact version — reproducible builds
    .package(url: "https://github.com/org/library", exact: "2.4.1"),

    // ✅ Up-to-next-major — allows patches and features, not breaking changes
    .package(url: "https://github.com/org/library", from: "2.0.0"),

    // ❌ Avoid branch-based dependencies in production
    // .package(url: "...", branch: "main"),
]
```

---

## Git Tagging

```bash
# ✅ Always use v-prefix for Git tags
git tag -a v2.4.1 -m "Release 2.4.1: fix order confirmation crash"
git push origin v2.4.1

# Pre-release tags
git tag -a v2.5.0-beta.1 -m "Beta: new checkout flow"
git push origin v2.5.0-beta.1
```

### Pre-Release Identifiers

```
v2.5.0-alpha.1   — early development, breaking changes expected
v2.5.0-beta.1    — feature-complete, undergoing testing
v2.5.0-rc.1      — release candidate, final validation
v2.5.0           — production release
```

---

## CI — Auto-Increment Build Number

```yaml
# GitHub Actions — auto-increment CFBundleVersion from run number
- name: Set build number
  run: |
    BUILD_NUMBER=${{ github.run_number }}
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" \
      "${{ github.workspace }}/MyApp/Info.plist"
```

```bash
# ✅ Fastlane: increment_build_number reads from App Store Connect
lane :bump_build do
  increment_build_number(
    build_number: latest_testflight_build_number + 1,
    xcodeproj: "MyApp.xcodeproj"
  )
end
```

---

## fastlane match — Certificate Management

```ruby
# Matchfile
git_url("https://github.com/org/certificates")
storage_mode("git")
type("appstore")          # "development", "adhoc", "appstore", "enterprise"
app_identifier(["com.example.myapp"])
username("ci@example.com")

# Fastfile
lane :sync_certs do
  match(type: "appstore", readonly: true)   # ✅ readonly in CI — never generate
end

lane :renew_certs do
  match(type: "appstore", force_for_new_devices: true)  # local/admin only
end
```

---

## App Store Connect Requirements

| Field | Requirement |
|-------|-------------|
| `CFBundleShortVersionString` | Must increase for each App Store submission |
| `CFBundleVersion` | Must be a positive integer; must increase for each build uploaded |
| Version string format | `X.Y` or `X.Y.Z` — no pre-release suffixes visible in App Store |
| Build number | Unique per version per platform (iOS, macOS, tvOS tracked separately) |

---

## Vapor Server Versioning

```swift
// ✅ Version file pattern for server-side Swift
// Read version from VERSION file or environment at startup
func configure(_ app: Application) throws {
    let version = Environment.get("APP_VERSION")
        ?? (try? String(contentsOfFile: "VERSION", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))
        ?? "dev"

    app.logger.info("Starting server version \(version)")
}
```

```
# VERSION file at repo root — updated by CI on release
2.4.1
```

```yaml
# GitHub Actions — inject version into Vapor container image
- name: Build Docker image
  run: |
    VERSION=$(cat VERSION)
    docker build --build-arg APP_VERSION=$VERSION -t myserver:$VERSION .
```

---

## Rules

```
✅ ALWAYS use v-prefix on Git tags: v2.4.1
✅ CFBundleShortVersionString must increase for every App Store submission
✅ CFBundleVersion must be a monotonically increasing integer
✅ Use fastlane match in readonly mode in CI — never regenerate certificates in CI
✅ Pin SPM dependencies to exact versions or from: for reproducible builds
✅ Use VERSION file for Vapor server; read at runtime from environment or file
❌ Never use branch-based SPM dependencies in production targets
❌ Never hardcode version strings in source files — read from Bundle/environment
❌ Never manually upload certificates to CI — use match encrypted git repo
❌ Never submit the same build number twice for the same platform/version
```

---

## Changelog Format

```markdown
## [2.4.1] - 2025-01-15
### Fixed
- Order confirmation screen crash on iPad (#234)
- Memory leak in image cache (#231)

## [2.4.0] - 2025-01-08
### Added
- New checkout flow with Apple Pay support (#220)
- Dark mode for profile screen (#218)
```

---

## See Also

- `deploy.instructions.md` — App Store submission, TestFlight distribution
- `testing.instructions.md` — Pre-release validation gates
- `ci.instructions.md` — Build number automation, certificate management
