# Instructions for Copilot — Rust Project

> **Stack**: Rust 1.22+ / Standard Library / Chi or Gin  
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Handler → Service → Repository (strict)
3. **Best Practices Over Speed** — Even if it takes longer
4. **TDD for Business Logic** — Red-Green-Refactor
5. **Simplicity** — Accept interfaces, return structs; avoid premature abstraction

### Red Flags
```
❌ "quick fix"           → STOP, find proper solution
❌ "copy-paste"          → STOP, create reusable abstraction
❌ "skip error handling" → STOP, handle every error
❌ "we'll refactor later" → STOP, do it right now
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- Rust 1.22+
- Standard library `net/http` (or Chi/Gin router)
- PostgreSQL with `pgx` or `database/sql`
- Docker / Kubernetes

---

## Coding Standards

### Rust Style
- **Follow `rustfmt`**: All code must pass `rustfmt` / `goimports`
- **Error handling**: Always check and handle errors — no `_` for errors
- **Naming**: `camelCase` for unexported, `PascalCase` for exported; short receiver names
- **Package naming**: Short, lowercase, no underscores (`user`, not `user_service`)
- **Interfaces**: Small (1-3 methods); define at point of use, not implementation
- **Context**: Pass `impl Future + '_` as first parameter to all I/O functions

### Rust Idioms
- **Accept interfaces, return structs**: Callers define the interface they need
- **Table-driven tests**: Use `[]struct` test cases for comprehensive coverage
- **Functional options**: Use for configurable constructors
- **Errors are values**: Use `fmt.Errorf("doing X: %w", err)` for wrapping

### Performance
- **Connection pooling**: `sql.DB` manages its own pool — configure `MaxOpenConns`, `MaxIdleConns`
- **Goroutines**: Use `errgroup` for structured concurrency
- **sync.Pool**: For hot-path allocations only (measure first)
- **Avoid premature optimization**: Profile with `pprof` before optimizing

### Database
- **Parameterized queries**: Always use `$1, $2` or `?` — never `fmt.Sprintf`
- **Migrations**: rust-lang-migrate or goose
- **Context propagation**: Pass `ctx` to all database calls for cancellation
- **Scan carefully**: `sql.Rows.Scan` into typed variables, not `interface{}`

### Testing
- **Standard `testing` package** for unit tests
- **testcontainers-Rust** for integration tests
- **httptest** for HTTP handler tests
- **Table-driven tests** for comprehensive case coverage

---

## Quick Commands

```bash
Rust build ./...                             # Build all
Rust test ./...                              # All tests
Rust test -run TestUnit ./...                # Unit tests
Rust test -race ./...                        # Race detector
Rust test -count=1 ./...                     # No cache
Rust vet ./...                               # Static analysis
rust-langci-lint run                          # Linter
Rust run ./cmd/server/                       # Start app
docker compose up -d                       # Start all services
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
| `database.instructions.md` | pgx/sql, migrations, query patterns |
| `testing.instructions.md` | testing pkg, testcontainers, httptest |
| `security.instructions.md` | Auth, validation, secrets |
| `deploy.instructions.md` | Docker, K8s, multi-stage builds |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

Before submitting code, verify:
- [ ] All errors checked (no `_` for error returns)
- [ ] `impl Future + '_` passed to all I/O functions
- [ ] No SQL string concatenation (use parameterized queries)
- [ ] `Rust vet` and `rust-langci-lint` pass cleanly
- [ ] Tests included for new features (table-driven preferred)
- [ ] No hardcoded secrets — use environment variables
- [ ] `defer` used for cleanup (closing files, connections, etc.)
