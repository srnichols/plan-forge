# Phase 5: Offline-First Data Sync — Swift Example

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 3 days (8 execution slices)  
> **Risk Level**: Medium (offline sync + conflict resolution)

---

## Overview

Implement offline-first data synchronization using SwiftData with background sync via URLSession. Conflict resolution with last-write-wins strategy, queue persistence, and XCTest coverage.

---

## Prerequisites

- [ ] Phase 4 complete (core models + API client established)
- [ ] Xcode 15+ with Swift 5.9 / SwiftData
- [ ] API server running locally with `/sync` endpoints
- [ ] SwiftLint configured

## Acceptance Criteria

- [ ] Local changes queued in SwiftData when offline
- [ ] Background sync resumes when connectivity restored
- [ ] Conflict resolution: last-write-wins with server timestamp
- [ ] Sync status indicator in UI (synced / pending / error)
- [ ] XCTest suite covers sync queue, conflict resolution, retry
- [ ] `xcodebuild test` passes with zero failures
- [ ] `swiftlint lint --strict` passes cleanly

---

## Execution Slices

### Slice 5.1 — Model: `SyncQueue` + SwiftData Schema
**Build command**: `xcodebuild build -scheme App -destination 'generic/platform=iOS'`  
**Test command**: `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=iPhone 15'`

**Tasks**:
1. Create `SyncQueueItem` SwiftData model with operation enum
2. Fields: `id`, `entityType`, `entityId`, `operation`, `payload`, `status`, `retryCount`, `createdAt`
3. Add `SyncStatus` enum: `.pending`, `.inProgress`, `.failed`, `.completed`
4. Unit tests: verify model persistence and query by status

```swift
import SwiftData

@Model
final class SyncQueueItem {
    var id: UUID
    var entityType: String
    var entityId: String
    var operation: SyncOperation
    var payload: Data
    var status: SyncStatus
    var retryCount: Int
    var createdAt: Date
    var lastAttemptAt: Date?

    enum SyncOperation: String, Codable {
        case create, update, delete
    }

    enum SyncStatus: String, Codable {
        case pending, inProgress, failed, completed
    }
}
```

**Validation Gate**:
```bash
xcodebuild build -scheme App -destination 'generic/platform=iOS'   # zero errors
xcodebuild test -scheme App -destination 'platform=iOS Simulator'  # all pass
swiftlint lint --strict                                             # zero violations
```

**Stop Condition**: If SwiftData schema validation fails or model test fails → STOP.

---

### Slice 5.2 — Service: SyncManager Protocol + Implementation
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test`

**Tasks**:
1. Define `SyncManagerProtocol` with `enqueue(_:)`, `processQueue()`, `status` publisher
2. Implement `SyncManager` with SwiftData `ModelContext` injection
3. Queue operations: insert `SyncQueueItem` with `.pending` status
4. Dependency injection via protocol for testability
5. Unit tests with mock `ModelContext`

```swift
protocol SyncManagerProtocol {
    func enqueue(_ item: SyncQueueItem) async throws
    func processQueue() async throws
    var statusPublisher: AnyPublisher<SyncStatus, Never> { get }
}
```

---

### Slice 5.3 — Network: Sync API Client
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test`

**Tasks**:
1. Create `SyncAPIClient` with `URLSession` for batch sync
2. Endpoint: `POST /api/sync/batch` — send array of pending operations
3. Response includes server timestamps for conflict detection
4. Retry with exponential backoff (max 3 attempts)
5. Unit tests with `URLProtocol` mock

---

### Slice 5.4 — Conflict Resolution: Last-Write-Wins
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test --filter "ConflictResolutionTests"`

**Tasks**:
1. Compare local `updatedAt` vs server `updatedAt`
2. Server wins if `server.updatedAt > local.updatedAt`
3. Log conflicts for debugging (structured logging)
4. Update local model with server version on conflict
5. Unit tests: simulate concurrent edits, verify winner selection

---

### Slice 5.5 — Connectivity Monitor: NWPathMonitor
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test`

**Tasks**:
1. Create `ConnectivityMonitor` using `NWPathMonitor`
2. Publish connectivity changes via Combine
3. Trigger `processQueue()` when connectivity restored
4. Unit tests with mock path monitor

---

### Slice 5.6 — Background Sync: BGTaskScheduler
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test`

**Tasks**:
1. Register `BGAppRefreshTask` for periodic sync
2. Schedule sync every 15 minutes when app is backgrounded
3. Process pending queue items in background task
4. Handle task expiration gracefully (save progress)

---

### Slice 5.7 — UI: Sync Status Indicator
**Build command**: `xcodebuild build`  
**Test command**: `xcodebuild test`

**Tasks**:
1. Create `SyncStatusView` SwiftUI component
2. States: ✅ Synced (green), 🔄 Pending (amber), ❌ Error (red)
3. Show pending count badge
4. Tap to force-sync manually
5. Preview tests with mock sync manager

---

### Slice 5.8 — Integration Tests & Final Sweep
**Test command**: `xcodebuild test`

**Tasks**:
1. End-to-end test: create item offline → restore connectivity → verify sync
2. Conflict test: modify same entity on client and server → verify resolution
3. Queue persistence test: kill app → relaunch → verify queue intact
4. `swiftlint lint --strict` — zero violations
5. Final test sweep: all tests pass, zero warnings

**Validation Gate**:
```bash
xcodebuild build -scheme App -destination 'generic/platform=iOS'   # zero errors
xcodebuild test -scheme App -destination 'platform=iOS Simulator'  # all pass
swiftlint lint --strict                                             # zero violations
```

---

## Forbidden Actions

- ❌ Do NOT use force-unwrapping (`!`) — always use `guard let` or `if let`
- ❌ Do NOT use `DispatchQueue.main.sync` from main thread — use `@MainActor`
- ❌ Do NOT store sensitive data in `UserDefaults` — use Keychain for tokens
- ❌ Do NOT skip error handling on network calls — every `URLSession` call must handle failures
