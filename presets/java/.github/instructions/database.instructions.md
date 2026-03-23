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

```
src/main/resources/db/migration/
├── V001__create_users_table.sql
├── V002__add_tenant_id_column.sql
└── V003__create_orders_table.sql
```

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

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| Java fields | camelCase | `userName`, `createdAt` |
| JPA mapping | `@Column(name = "user_name")` | Explicit mapping |

## See Also

- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling
