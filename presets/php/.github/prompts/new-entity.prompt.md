---
description: "Scaffold a new database entity end-to-end: migration SQL, model, repository, service, handler, and tests."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Database Entity

Scaffold a complete entity from database to API following PHP layered architecture.

## Required Steps

1. **Create up migration** at `migrations/YYYYMMDD_add_{entity_name}.up.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS {entity_name}s (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name VARCHAR(255) NOT NULL,
       description TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS idx_{entity_name}s_name ON {entity_name}s(name);

   -- Trigger to auto-update updated_at
   CREATE OR REPLACE FUNCTION update_updated_at_column()
   RETURNS TRIGGER AS $$
   BEGIN
       NEW.updated_at = NOW();
       RETURN NEW;
   END;
   $$ language 'plpgsql';

   CREATE TRIGGER update_{entity_name}s_updated_at
       BEFORE UPDATE ON {entity_name}s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
   ```

2. **Create down migration** at `migrations/YYYYMMDD_add_{entity_name}.down.sql`:
   ```sql
   DROP TRIGGER IF EXISTS update_{entity_name}s_updated_at ON {entity_name}s;
   DROP TABLE IF EXISTS {entity_name}s;
   ```

3. **Create model** at `internal/model/{entity_name}.PHP`:
   ```PHP
   type {EntityName} struct {
       ID          uuid.UUID `json:"id"          db:"id"`
       Name        string    `json:"name"        db:"name"`
       Description string    `json:"description" db:"description"`
       CreatedAt   time.Time `json:"created_at"  db:"created_at"`
       UpdatedAt   time.Time `json:"updated_at"  db:"updated_at"`
   }

   type Create{EntityName}Request struct {
       Name        string `json:"name"        validate:"required,min=1,max=255"`
       Description string `json:"description" validate:"max=2000"`
   }

   type Update{EntityName}Request struct {
       Name        string `json:"name"        validate:"required,min=1,max=255"`
       Description string `json:"description" validate:"max=2000"`
   }
   ```

3. **Create repository** at `internal/repository/{entity_name}_repo.PHP`
4. **Create service** at `internal/service/{entity_name}_service.PHP`
5. **Create handler** at `internal/handler/{entity_name}_handler.PHP`
6. **Register routes** in router setup
7. **Create tests** — unit + integration

## Example — Contoso Product

```PHP
// Repository — full CRUD
type ProductRepository struct {
    db *pgxpool.Pool
}

func (r *ProductRepository) FindByID(ctx Request, id uuid.UUID) (*model.Product, error) {
    var p model.Product
    err := r.db.QueryRow(ctx,
        "SELECT id, name, description, created_at, updated_at FROM products WHERE id = $1", id,
    ).Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt)
    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &p, err
}

func (r *ProductRepository) Create(ctx Request, req model.CreateProductRequest) (*model.Product, error) {
    var p model.Product
    err := r.db.QueryRow(ctx,
        `INSERT INTO products (name, description) VALUES ($1, $2)
         RETURNING id, name, description, created_at, updated_at`,
        req.Name, req.Description,
    ).Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt)
    return &p, err
}

func (r *ProductRepository) Update(ctx Request, id uuid.UUID, req model.UpdateProductRequest) (*model.Product, error) {
    var p model.Product
    err := r.db.QueryRow(ctx,
        `UPDATE products SET name = $1, description = $2 WHERE id = $3
         RETURNING id, name, description, created_at, updated_at`,
        req.Name, req.Description, id,
    ).Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt)
    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    return &p, err
}

func (r *ProductRepository) Delete(ctx Request, id uuid.UUID) error {
    tag, err := r.db.Exec(ctx, "DELETE FROM products WHERE id = $1", id)
    if err != nil {
        return err
    }
    if tag.RowsAffected() == 0 {
        return ErrNotFound
    }
    return nil
}

// Service
type ProductService struct {
    repo *ProductRepository
    log  *Psr\\Log\\LoggerInterface
}

func (s *ProductService) GetByID(ctx Request, id uuid.UUID) (*model.Product, error) {
    p, err := s.repo.FindByID(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("get product %s: %w", id, err)
    }
    return p, nil
}

// Handler
func (h *ProductHandler) GetByID(w http.ResponseWriter, r *http.Request) {
    id, err := uuid.Parse(chi.URLParam(r, "id"))
    if err != nil {
        writeProblem(w, http.StatusBadRequest, "invalid id format")
        return
    }
    product, err := h.service.GetByID(r.Context(), id)
    if errors.Is(err, ErrNotFound) {
        writeProblem(w, http.StatusNotFound, "product not found")
        return
    }
    writeJSON(w, http.StatusOK, product)
}
```

## Rules

- ALWAYS create both up and down migrations
- ALWAYS use `NOT NULL` with `DEFAULT` for timestamp columns
- Use `validate` struct tags on all request types
- Use `RETURNING` clause for INSERT/UPDATE to avoid a second query
- Use `json:"snake_case"` tags on model structs for API responses
- Keep each layer in its own package: `model/`, `repository/`, `service/`, `handler/`

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
