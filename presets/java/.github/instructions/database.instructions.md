---
description: Java database patterns — JPA/JDBC, Flyway migrations, parameterized queries
applyTo: '**/*Repository*.java,**/*Migration*,**/db/**,**/*.sql,**/flyway/**'
---

# Java Database Patterns

## ORM Strategy

<!-- Choose one and delete the other -->

### Option A: Spring Data JPA
```java
@Repository
public interface UserRepository extends JpaRepository<User, UUID> {
    
    @Query("SELECT u FROM User u WHERE u.email = :email AND u.tenantId = :tenantId")
    Optional<User> findByEmailAndTenantId(@Param("email") String email, @Param("tenantId") String tenantId);
}
```

### Option B: Spring JDBC / JdbcTemplate
```java
@Repository
public class UserRepository {
    private final JdbcTemplate jdbc;

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<User> findById(UUID id, String tenantId) {
        String sql = "SELECT * FROM users WHERE id = ? AND tenant_id = ?";
        return jdbc.query(sql, userRowMapper(), id, tenantId)
                   .stream().findFirst();
    }
}
```

## Non-Negotiable Rules

### Parameterized Queries (SQL Injection Prevention)
```java
// ❌ NEVER: String concatenation in SQL
String sql = "SELECT * FROM users WHERE id = '" + userId + "'";

// ✅ ALWAYS: Parameterized queries
String sql = "SELECT * FROM users WHERE id = ?";
jdbcTemplate.queryForObject(sql, userRowMapper(), userId);

// ✅ OR: Named parameters with JPA
@Query("SELECT u FROM User u WHERE u.id = :id")
Optional<User> findById(@Param("id") UUID id);
```

### Connection Management
```java
// ❌ NEVER: Manual connection creation
Connection conn = DriverManager.getConnection(url, user, pass);

// ✅ ALWAYS: Use Spring-managed DataSource (HikariCP)
// DataSource is injected by Spring Boot auto-configuration
```

### Transaction Management
```java
// ❌ NEVER: Transactions in controllers or repositories
@RestController
@Transactional  // WRONG LAYER
public class UserController { ... }

// ✅ ALWAYS: Transactions in service layer
@Service
@Transactional(readOnly = true)
public class UserService {
    
    @Transactional
    public User createUser(CreateUserRequest request) { ... }
}
```

## Migration Strategy (Flyway)

### Non-Negotiable Migration Rules
- **NEVER** deploy a destructive migration (drop column/table) in the same release that removes the code using it
- **ALWAYS** review migration SQL before applying to staging or production
- **ALWAYS** make migrations backward-compatible — the old version of the app must still work after the migration runs
- **ALWAYS** test migrations against a copy of production data before applying to production
- **NEVER** edit a Flyway migration that has already been applied — create a new versioned migration
- **ALWAYS** run migrations as a separate pipeline step (or via Spring Boot auto-migration) before the app serves traffic

### File Structure & Naming
```
src/main/resources/db/migration/
├── V001__create_users_table.sql
├── V002__add_tenant_id_column.sql
├── V003__create_orders_table.sql
└── V004__add_status_v2_to_orders.sql    # Expand step
```

**Convention**: `V{version}__{description}.sql` — double underscore between version and description

```sql
-- V001__create_users_table.sql
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(255) NOT NULL,
    tenant_id   VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
```

### Flyway Commands
```bash
# Apply pending migrations (Maven)
mvn flyway:migrate

# Show migration status
mvn flyway:info

# Validate applied vs. available migrations
mvn flyway:validate

# Repair checksum mismatches (use with caution)
mvn flyway:repair

# Baseline an existing database (first-time Flyway adoption)
mvn flyway:baseline -Dflyway.baselineVersion=1
```

### Spring Boot Auto-Migration
```yaml
# application.yml — Flyway runs automatically on startup
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false     # true only for first-time adoption
    validate-on-migrate: true      # Fail if checksums don't match
```

### Safe vs. Dangerous Operations

| Operation | Risk | Strategy |
|-----------|------|----------|
| Add column (nullable) | **Safe** | Deploy directly |
| Add column (non-null) | **Medium** | Add nullable first → backfill → add NOT NULL constraint |
| Add index | **Medium** | Use `CREATE INDEX CONCURRENTLY` (PostgreSQL) to avoid locking |
| Rename column | **Dangerous** | Expand-contract: add new → copy → migrate code → drop old |
| Drop column | **Dangerous** | Two releases: (1) stop reading/writing, (2) drop in next release |
| Change column type | **Dangerous** | Add new column → backfill → switch reads → drop old |
| Drop table | **Dangerous** | Only after all references removed and verified in production |

### Expand-Contract Pattern (Zero-Downtime)

```sql
-- V004__expand_order_status.sql (Release 1 — EXPAND)
ALTER TABLE orders ADD COLUMN status_v2 VARCHAR(50);
UPDATE orders SET status_v2 = status;
-- App code: write to BOTH columns, read from status_v2

-- V005__contract_order_status.sql (Release 2 — CONTRACT, after code migrated)
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN status_v2 TO status;
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
```

### Production Migration Checklist

```
Pre-Deploy:
  □ Reviewed migration SQL for destructive operations (DROP, ALTER TYPE, RENAME)
  □ Ran mvn flyway:validate — no checksum mismatches
  □ Tested migration against staging with production-like data
  □ Verified backward compatibility — old app version still works after migration
  □ Backup taken or point-in-time recovery confirmed
  □ Estimated migration duration for large tables
  □ Checked mvn flyway:info for pending migration count

Deploy:
  □ Flyway runs on app startup (or as a separate pipeline step) BEFORE serving traffic
  □ Health check passes after migration, before routing traffic
  □ Monitor for lock contention during migration

Post-Deploy:
  □ Verify /actuator/health passes
  □ Run mvn flyway:info to confirm version
  □ Spot-check migrated data
  □ Monitor error rates for 15 minutes
```

### Rollback Strategy

```sql
-- Flyway Community does NOT support automatic undo migrations
-- Maintain manual rollback scripts alongside forward migrations:
-- src/main/resources/db/rollback/
--   U004__undo_expand_order_status.sql

-- U004__undo_expand_order_status.sql
ALTER TABLE orders DROP COLUMN IF EXISTS status_v2;
```

```bash
# Flyway Teams/Enterprise: undo migrations
mvn flyway:undo

# Emergency: manually set Flyway version (after manual DB fix)
mvn flyway:repair
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| Java fields | camelCase | `userName`, `createdAt` |
| JPA mapping | `@Column(name = "user_name")` | Explicit mapping |

## See Also

- `deploy.instructions.md` — Migration pipeline steps, Docker Compose migration patterns
- `multi-environment.instructions.md` — Per-profile Flyway config, auto-migrate settings
- `graphql.instructions.md` — @BatchMapping, DataLoader batch queries
- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "N+1 queries won't matter at our scale" | N+1 queries scale linearly with data. 10 rows = 10 queries, 10,000 rows = 10,000 queries. Use `@EntityGraph` or `JOIN FETCH` from the start. |
| "Raw SQL is faster than JPA here" | Raw SQL bypasses entity mapping, migration safety, and parameterization. Use JPA/Hibernate unless profiling proves a measurable bottleneck — then use named native queries with parameters. |
| "A migration isn't needed for this small change" | Schema changes without migrations break other developers' environments and CI. If it touches the database, it gets a Flyway/Liquibase migration — always. |
| "I'll seed the data manually" | Manual seed data doesn't reproduce in CI, staging, or other developers' machines. Use Flyway migrations or `data.sql` seed files with Spring profiles. |
| "One connection string for all environments is fine" | Connection strings contain credentials that differ per environment. Use Spring profiles or environment variables with per-profile overrides. |

---

## Warning Signs

- Queries executed inside a `for` loop (N+1 pattern — check `FetchType.LAZY` without batch fetching)
- `SELECT *` or fetching entire entities when only a few columns are needed (use projections)
- Missing `@Index` annotation on columns used in `WHERE` or `JOIN` clauses
- Connection strings hardcoded in `application.properties` or source files
- No Flyway/Liquibase migration file corresponds to a recent entity change
- `EntityManager` or `DataSource` managed manually instead of via Spring's connection pooling
