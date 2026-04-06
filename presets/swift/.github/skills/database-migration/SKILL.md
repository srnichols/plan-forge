---
name: database-migration
description: Generate, review, test, and deploy database schema migrations for Fluent (Vapor) or SwiftData. Use when adding models, columns, or changing schema.
argument-hint: "[migration description, e.g. 'add user_profiles table']"
tools: [run_in_terminal, read_file]
---

# Database Migration Skill (Swift)

## Trigger
"Create a database migration for..." / "Add column..." / "Change schema..."

## Steps

### 1. Generate Migration (Fluent / Vapor)

Create a new migration file in `Sources/App/Migrations/`:

```swift
// Sources/App/Migrations/CreateOrders.swift
import Fluent

struct CreateOrders: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("orders")
            .id()
            .field("tenant_id", .uuid, .required)
            .field("customer_id", .uuid, .required, .references("users", "id"))
            .field("total_amount", .double, .required)
            .field("status", .string, .required)
            .field("created_at", .datetime)
            .field("updated_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("orders").delete()
    }
}
```

Register in `configure.swift`:
```swift
app.migrations.add(CreateOrders())
```

### 2. SwiftData Model Change (iOS/macOS)

For SwiftData schema migrations, create a `VersionedSchema` and `SchemaMigrationPlan`:

```swift
import SwiftData

enum AppSchemaV1: VersionedSchema {
    static var versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] { [Order.self] }

    @Model
    final class Order {
        var id: UUID
        var status: String
        init(id: UUID = UUID(), status: String) {
            self.id = id
            self.status = status
        }
    }
}

enum AppSchemaV2: VersionedSchema {
    static var versionIdentifier = Schema.Version(2, 0, 0)
    static var models: [any PersistentModel.Type] { [Order.self] }

    @Model
    final class Order {
        var id: UUID
        var status: String
        var totalAmount: Double // new field
        init(id: UUID = UUID(), status: String, totalAmount: Double = 0) {
            self.id = id
            self.status = status
            self.totalAmount = totalAmount
        }
    }
}

enum AppMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] {
        [AppSchemaV1.self, AppSchemaV2.self]
    }
    static var stages: [MigrationStage] {
        [migrateV1toV2]
    }
    static let migrateV1toV2 = MigrationStage.custom(
        fromVersion: AppSchemaV1.self,
        toVersion: AppSchemaV2.self,
        willMigrate: nil,
        didMigrate: { context, _ in
            // backfill totalAmount if needed
        }
    )
}
```

### 3. Test Locally (Fluent)
```bash
# Apply pending migrations to local dev database
swift run App migrate --yes

# Verify migration ran
swift run App migrate --list

# Revert last migration
swift run App migrate --revert
```

### 4. Validate
```bash
swift test --filter IntegrationTests
```

### 5. Deploy to Staging (Fluent)
```bash
# Run migrations in staging via Docker
docker run --rm \
  -e DATABASE_URL=$STAGING_DATABASE_URL \
  registry.example.com/app:staging \
  migrate --yes
```

### Conditional: Migration Failure
> If migration fails → immediately revert using `migrate --revert`, report the failure with the error message, and STOP. Do not proceed to deploy.

## Safety Rules
- NEVER drop columns without a deprecation period (expand-contract pattern)
- ALWAYS implement both `prepare` and `revert` in `AsyncMigration`
- ALWAYS add `IF NOT EXISTS` / `IF EXISTS` guards in raw SQL
- NEVER modify existing migration files — create new ones
- Test migration on a copy of production data when possible
- SwiftData: always create a `SchemaMigrationPlan` for schema changes between versions

## Persistent Memory (if OpenBrain is configured)

- **Before generating migration**: `search_thoughts("database migration", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "pattern")` — load prior migration patterns, naming conventions, and lessons from failed migrations
- **After migration succeeds**: `capture_thought("Migration: <summary of schema change>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-database-migration")` — persist the migration decision for future reference
