# Instructions for Copilot — .NET Project

> **Stack**: .NET 10+ / C# / ASP.NET Core  
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Controller → Service → Repository (strict)
3. **Best Practices Over Speed** — Even if it takes longer
4. **TDD for Business Logic** — Red-Green-Refactor
5. **Type Safety** — No `dynamic`, `object`, or `var` when type is known

### Red Flags
```
❌ "quick fix"           → STOP, find proper solution
❌ "copy-paste"          → STOP, create reusable abstraction
❌ "skip types"          → STOP, add proper types
❌ "we'll refactor later" → STOP, do it right now
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- .NET 10.0, C# 14
- ASP.NET Core Web API (+ GraphQL if applicable)
- PostgreSQL with Dapper (or EF Core)
- Docker / Kubernetes

---

## Coding Standards

### C# Style
- **File-scoped namespaces**: `namespace MyNamespace;`
- **Nullable reference types**: Enabled — always handle nullability
- **Async/await**: All I/O operations, always with `CancellationToken`
- **Primary constructors**: Prefer for services (C# 12+)
- **Record types**: Use for DTOs and immutable data

### Performance
- **Source-generated logging**: `[LoggerMessage]` attributes
- **Regex source generators**: `[GeneratedRegex]`
- **No sync-over-async**: Never `.Result`, `.Wait()`, `.GetAwaiter().GetResult()`

### Database
- **Parameterized queries**: Always `@Parameter` — never string interpolation
- **Connection pooling**: Use `IDbConnectionFactory` or DI-managed `DbContext`
- **CancellationToken**: On all async data access methods

### Testing
- **xUnit** (or NUnit) for unit tests
- **Testcontainers** for integration tests with real database
- **WebApplicationFactory** for API integration tests

---

## Quick Commands

```bash
dotnet build                                    # Build
dotnet test                                     # All tests
dotnet test --filter "Category=Unit"            # Unit tests only
dotnet test --filter "Category=Integration"     # Integration only
dotnet run --project YourApi/                   # Start API
docker compose up -d                            # Start all services
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
| `api-patterns.instructions.md` | REST conventions, ProblemDetails, pagination |
| `blazor-fluent-ui.instructions.md` | Blazor Server + Fluent UI components, lifecycle, accessibility |
| `database.instructions.md` | Dapper/EF Core patterns |
| `testing.instructions.md` | xUnit, Testcontainers, bUnit |
| `security.instructions.md` | Auth, validation, secrets |
| `deploy.instructions.md` | Docker, K8s |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

- [ ] No sync-over-async (`.Result`, `.Wait()`)
- [ ] `CancellationToken` on async methods
- [ ] Nullable types handled
- [ ] Parameterized SQL (no interpolation)
- [ ] Error handling returns structured response
- [ ] Logging uses structured parameters
- [ ] Tests included for new features
