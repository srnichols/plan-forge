# Instructions for Copilot — Swift Project

> **Stack**: Swift 5.9+ / Vapor / SwiftUI  
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Controller → Service → Repository (strict)
3. **Best Practices Over Speed** — Even if it takes longer
4. **TDD for Business Logic** — Red-Green-Refactor
5. **No Force-Unwraps** — Use `guard let`, `if let`, or throw errors

### Red Flags
```
❌ "quick fix"            → STOP, find proper solution
❌ "copy-paste"           → STOP, create reusable abstraction
❌ "skip error handling"  → STOP, handle every error
❌ "we'll refactor later" → STOP, do it right now
❌ force-unwrap `!`       → STOP, use optional binding instead
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- Swift 5.9+
- Vapor 4 (server-side, optional)
- SwiftUI (iOS/macOS)
- Fluent ORM + PostgreSQL / SQLite
- Docker / Kubernetes (for Vapor services)

---

## Coding Standards

### Swift Style
- **Follow `swift-format`**: All code must pass `swift-format`
- **Error handling**: Always use `try/catch` or `Result` — never force-try `try!` in production
- **Naming**: `camelCase` for properties/functions, `PascalCase` for types
- **Protocols**: Small, focused (1-3 requirements); use `some`/`any` appropriately
- **Concurrency**: Use `async/await`; mark UI updates `@MainActor`

### Swift Idioms
- **Protocol-oriented**: Define behaviour via protocols; inject dependencies as `some Protocol`
- **Value types first**: Prefer `struct` for data; use `class` only when reference semantics needed
- **Result builders**: Use for DSL-style APIs (e.g., SwiftUI `ViewBuilder`)
- **Property wrappers**: `@Published`, `@State`, `@Binding` in SwiftUI; avoid custom ones unless justified

### Performance
- **Lazy loading**: `lazy var` for expensive computed properties
- **Instruments**: Profile with Allocations + Time Profiler before optimizing
- **Avoid blocking main thread**: All I/O must be `async`; never `DispatchQueue.main.sync`

### Database (Fluent ORM)
- **Always use parameterized queries** — never string interpolation in raw SQL
- **Migrations**: One migration per schema change; never modify existing migrations
- **Context propagation**: Pass `req.db` or explicit `Database` to all data access methods

### Testing
- **XCTest** for unit and integration tests
- **Swift Testing** (`@Test`, `@Suite`) for new test files (Swift 5.10+)
- **ViewInspector** for SwiftUI view tests
- **Given-When-Then** structure for all tests

---

## Quick Commands

```bash
swift build                    # Build all targets
swift test                     # All tests
swift test --filter MyTests    # Specific test class
swift package resolve          # Resolve/update dependencies
swift package show-dependencies # Show dependency tree
swiftlint                      # Lint
swift-format --recursive .     # Format
swift run                      # Start Vapor server
docker compose up -d           # Start all services
```

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Instructions**: `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `architecture-principles.instructions.md` | Core architecture rules |
| `database.instructions.md` | Fluent ORM, migrations, raw SQL |
| `testing.instructions.md` | XCTest, Swift Testing, ViewInspector |
| `security.instructions.md` | Keychain, ATS, force-unwrap prevention |
| `deploy.instructions.md` | App Store, TestFlight, Vapor on Docker |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

Before submitting code, verify:
- [ ] No force-unwraps (`!`) in production code — use `guard let` / `if let`
- [ ] No `try!` in production code — always handle errors
- [ ] All async functions properly `await`-ed; no blocking calls on main actor
- [ ] `swiftlint` passes cleanly
- [ ] Tests included for new features (XCTest or Swift Testing)
- [ ] No hardcoded secrets — use environment variables or Keychain
- [ ] `@MainActor` used for all SwiftUI state mutations
