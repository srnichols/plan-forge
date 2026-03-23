---
description: Go database patterns — pgx/database-sql, migrations, parameterized queries
applyTo: '**/*repository*.go,**/*repo*.go,**/db/**,**/*.sql,**/migrations/**'
---

# Go Database Patterns

## Driver Strategy

<!-- Choose one and delete the other -->

### Option A: pgx (PostgreSQL-specific, recommended)
```go
func (r *UserRepo) FindByID(ctx context.Context, id uuid.UUID, tenantID string) (*User, error) {
    const query = `SELECT id, name, email, tenant_id, created_at 
                   FROM users WHERE id = $1 AND tenant_id = $2`

    var u User
    err := r.pool.QueryRow(ctx, query, id, tenantID).Scan(
        &u.ID, &u.Name, &u.Email, &u.TenantID, &u.CreatedAt,
    )
    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &u, err
}
```

### Option B: database/sql (Driver-agnostic)
```go
func (r *UserRepo) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
    const query = `SELECT id, name, email FROM users WHERE id = $1`

    var u User
    err := r.db.QueryRowContext(ctx, query, id).Scan(&u.ID, &u.Name, &u.Email)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &u, err
}
```

## Non-Negotiable Rules

### Parameterized Queries (SQL Injection Prevention)
```go
// ❌ NEVER: String formatting in SQL
query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", userID)

// ✅ ALWAYS: Parameterized queries
const query = "SELECT * FROM users WHERE id = $1"
row := db.QueryRowContext(ctx, query, userID)
```

### Connection Management
```go
// ❌ NEVER: Create connections per request
conn, _ := pgx.Connect(ctx, connString)

// ✅ ALWAYS: Use a connection pool
pool, err := pgxpool.New(ctx, connString)
// Or for database/sql:
db, err := sql.Open("postgres", connString)
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

### Context Propagation
```go
// ❌ NEVER: Ignore context
row := db.QueryRow(query, id)

// ✅ ALWAYS: Pass context for cancellation
row := db.QueryRowContext(ctx, query, id)
```

## Migration Strategy (golang-migrate)

```
migrations/
├── 000001_create_users.up.sql
├── 000001_create_users.down.sql
├── 000002_add_tenant_id.up.sql
└── 000002_add_tenant_id.down.sql
```

```bash
# Apply migrations
migrate -path migrations -database "$DATABASE_URL" up

# Rollback last
migrate -path migrations -database "$DATABASE_URL" down 1
```

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Database columns | snake_case | `user_name`, `created_at` |
| Go fields | PascalCase | `UserName`, `CreatedAt` |
| Struct tags | `db:"column_name"` | `db:"user_name"` |

## See Also

- `security.instructions.md` — SQL injection prevention, parameterized queries
- `caching.instructions.md` — Query result caching, invalidation strategies
- `performance.instructions.md` — Query optimization, connection pooling
