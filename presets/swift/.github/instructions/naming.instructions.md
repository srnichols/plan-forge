---
description: Naming conventions — files, folders, code symbols, database, APIs for Swift projects
applyTo: '**'
---

# Naming Conventions

> **Priority**: Apply consistently across all new code  
> **Applies to**: ALL files

---

## Universal Rules

### Folder & File Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Project folders** | `PascalCase` (Xcode convention) | `UserAuth/`, `Billing/` |
| **Swift source files** | `PascalCase`, matches type name | `UserService.swift`, `ItemController.swift` |
| **Test files** | `{TypeName}Tests.swift` | `UserServiceTests.swift` |
| **Config files** | Dot-prefix for hidden | `.forge.json`, `.swiftlint.yml` |

### Database Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Tables** | `snake_case`, plural | `time_entries`, `user_profiles` |
| **Columns** | `snake_case` | `created_at`, `hourly_rate` |

### API Endpoint Naming

| Convention | Example |
|-----------|---------|
| Plural nouns, kebab-case | `/api/time-entries` |

---

## Swift Conventions (Swift API Design Guidelines)

| Context | Convention | Example |
|---------|-----------|---------|
| **Types** (class, struct, enum, protocol) | `PascalCase` | `UserService`, `ItemRepository`, `AppError` |
| **Properties and functions** | `camelCase` | `fetchAll()`, `isLoading`, `userID` |
| **Constants** | `camelCase` (top-level or static) | `let maxRetries = 3` |
| **Enum cases** | `camelCase` | `.notFound`, `.internalError` |
| **Protocols** | Noun or `-able`/`-ing` suffix | `ItemRepository`, `Validatable`, `Configuring` |
| **Type aliases** | `PascalCase` | `typealias UserID = UUID` |
| **Generics** | Single uppercase letter or descriptive | `T`, `Element`, `Key` |
| **Test classes** | `{TypeName}Tests` | `UserServiceTests` |
| **Test methods** | `test{Method}_{Scenario}` | `testCreate_withEmptyName_throwsValidation` |

### Project Layout (Vapor)

```
Sources/
  App/
    Controllers/    — RouteCollection types
    Models/         — Fluent models
    DTOs/           — Codable request/response types
    Services/       — Business logic
    Repositories/   — Data access
    Migrations/     — Fluent migrations
    configure.swift — App configuration
    routes.swift    — Route registration
Tests/
  AppTests/
    ControllerTests/
    ServiceTests/
Package.swift
```

### Project Layout (SwiftUI iOS)

```
Sources/
  Features/
    Items/
      ItemListView.swift
      ItemDetailView.swift
      ItemListViewModel.swift
  Services/
    ItemService.swift
  Repositories/
    ItemRepository.swift
  Models/
    Item.swift
Tests/
  ItemServiceTests.swift
  ItemListViewModelTests.swift
```

---

## Decision Framework

When naming anything new, ask:

1. **Is it a type?** → `PascalCase`
2. **Is it a property, function, or variable?** → `camelCase`
3. **Is it an enum case?** → `camelCase`
4. **Does the name read naturally at the call site?** → Follow Swift API Design Guidelines
5. **Does a protocol name describe capabilities?** → Use noun (`Repository`) or `-able` (`Validatable`)
