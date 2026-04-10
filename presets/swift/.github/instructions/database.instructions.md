---
description: Swift database patterns — Fluent ORM, migrations, GRDB, Core Data
applyTo: '**/*Repository*,**/*Migration*,**/*Model*,**/Repositories/**,**/Models/**,**/Migrations/**'
---

# Swift Database Patterns

## Tech Stack Options

| Use Case | Library |
|----------|---------|
| Server-side (Vapor) | Fluent ORM + `fluent-postgres-driver` |
| iOS/macOS (SQLite) | GRDB.swift |
| iOS complex graphs | Core Data |
| Lightweight local | SQLite.swift |

## Fluent ORM (Vapor)

### Model Definition
```swift
import Fluent
import Vapor

final class Item: Model, Content {
    static let schema = "items"

    @ID(format: .uuid)
    var id: UUID?

    @Field(key: "name")
    var name: String

    @Field(key: "price")
    var price: Double

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    @Timestamp(key: "updated_at", on: .update)
    var updatedAt: Date?

    init() {}

    init(id: UUID? = nil, name: String, price: Double) {
        self.id = id
        self.name = name
        self.price = price
    }
}
```

### Migration
```swift
struct CreateItems: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("items")
            .id()
            .field("name", .string, .required)
            .field("price", .double, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("items").delete()
    }
}
```

### Repository Pattern
```swift
protocol ItemRepository {
    func find(id: UUID, on db: Database) async throws -> Item?
    func fetchAll(on db: Database) async throws -> [Item]
    func save(_ item: Item, on db: Database) async throws -> Item
    func delete(id: UUID, on db: Database) async throws
}

struct FluentItemRepository: ItemRepository {
    func find(id: UUID, on db: Database) async throws -> Item? {
        try await Item.find(id, on: db)
    }

    func fetchAll(on db: Database) async throws -> [Item] {
        try await Item.query(on: db).all()
    }

    func save(_ item: Item, on db: Database) async throws -> Item {
        try await item.save(on: db)
        return item
    }

    func delete(id: UUID, on db: Database) async throws {
        guard let item = try await Item.find(id, on: db) else {
            throw AppError.notFound(entity: "Item", id: id.uuidString)
        }
        try await item.delete(on: db)
    }
}
```

### Raw SQL with Bound Parameters (when needed)
```swift
// ✅ ALWAYS: Bound parameters — never string interpolation
let results = try await db
    .raw("SELECT * FROM items WHERE name ILIKE \(bind: "%\(searchTerm)%")")
    .all(decoding: Item.self)

// ❌ NEVER: String interpolation in SQL
let results = try await db.raw("SELECT * FROM items WHERE name ILIKE '%\(searchTerm)%'").all()
```

## Rules

- **ALWAYS use parameterized queries** — use `\(bind:)` in `.raw()` calls
- **NEVER modify existing migrations** — create a new migration for each schema change
- **One migration per change** — small, reversible steps
- **Test with in-memory SQLite** for unit tests: `DatabaseConfigurationFactory.sqlite(.memory)`
- **Pass `Database` explicitly** — don't use global state for DB access

## GRDB (iOS/macOS)

```swift
import GRDB

struct Item: Codable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var name: String
    var price: Double
}

// Read
let items = try dbQueue.read { db in
    try Item.fetchAll(db)
}

// Write — always on writer
try dbQueue.write { db in
    var item = Item(name: "Widget", price: 9.99)
    try item.insert(db)
}
```

## Validation Gates (for Plan Hardening)

```markdown
- [ ] `swift build` passes with zero errors
- [ ] All migrations have both `prepare` and `revert`
- [ ] No raw SQL with string interpolation: `grep -rn 'raw(".*\\\\(' --include="*.swift"` returns zero hits
- [ ] Repository protocol has corresponding test fake
```

## See Also

- `testing.instructions.md` — In-memory test databases
- `security.instructions.md` — SQL injection prevention
- `deploy.instructions.md` — Database migrations in CI/CD

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use eager loading with `with()` or `join()` from the start. |
| "Raw SQL is faster than Fluent here" | Raw SQL bypasses model validation, migration tracking, and parameterization. Use Fluent unless profiling proves a measurable bottleneck — then use parameterized raw queries. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets a Fluent migration — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use Fluent migration-based seeds or `configure.swift` seed commands. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use `Environment` variables with per-environment overrides. |

---

## Warning Signs

- Queries executed inside a `for` loop with `await` (N+1 pattern)
- `SELECT *` or fetching full models when only a few fields are needed (use `@Field` projections)
- Missing Fluent `@Index` on properties used in `.filter()` queries
- Connection strings hardcoded or present in source files
- No migration corresponds to a recent model change
- Database pool created without configuring max connections (connection exhaustion)
