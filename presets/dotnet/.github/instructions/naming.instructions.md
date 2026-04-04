---
description: Naming conventions — files, folders, code symbols, database, APIs, third-party integration prefixing
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
| **Project folders** | `kebab-case` | `user-auth/`, `payment-gateway/` |
| **Third-party tooling folders** | Prefix with tool/org name | `pforge-mcp/`, `openai-tools/` |
| **Config files** | Dot-prefix for hidden, kebab-case | `.forge.json`, `.eslintrc` |
| **Documentation** | `UPPER-KEBAB.md` for root docs | `README.md`, `CHANGELOG.md` |
| **Source files** | Follow stack convention (see below) | — |

### Third-Party Integration Prefixing

When adding folders/files from external tools or frameworks, **always prefix with the tool or organization name** to prevent collisions in brownfield projects:

```
✅ pforge-mcp/          — Plan Forge MCP server
✅ openai-agents/        — OpenAI agent configs  
✅ grafana-dashboards/   — Grafana dashboard JSON

❌ mcp/                  — generic, will collide
❌ agents/               — too generic
❌ dashboards/           — ambiguous ownership
```

### Variable & Symbol Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL` |
| **Environment variables** | `UPPER_SNAKE_CASE` with prefix | `PLAN_FORGE_WS_PORT` |
| **Boolean variables** | `is`/`has`/`should` prefix | `isActive`, `hasPermission` |
| **Event names** | `kebab-case` | `slice-completed`, `run-started` |
| **Feature flags** | `UPPER_SNAKE_CASE` | `ENABLE_PARALLEL_EXECUTION` |

### Database Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Tables** | `snake_case`, plural | `time_entries`, `user_profiles` |
| **Columns** | `snake_case` | `created_at`, `hourly_rate` |
| **Primary keys** | `id` (simple) or `{table}_id` | `id`, `client_id` |
| **Foreign keys** | `{referenced_table}_id` | `project_id`, `tenant_id` |
| **Indexes** | `ix_{table}_{columns}` | `ix_time_entries_date` |
| **Constraints** | `{type}_{table}_{description}` | `uq_clients_email`, `ck_entries_hours_positive` |

### API Endpoint Naming

| Convention | Example |
|-----------|---------|
| Plural nouns for resources | `/api/clients`, `/api/time-entries` |
| Kebab-case for multi-word | `/api/time-entries`, not `/api/timeEntries` |
| Nested resources for relationships | `/api/clients/{id}/projects` |
| Actions as verbs on sub-paths | `/api/billing/summary`, `/api/reports/generate` |
| Version prefix when needed | `/api/v2/clients` |

---

## .NET / C# Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| **Namespaces** | `PascalCase`, match folder structure | `TimeTracker.Api.Controllers` |
| **Classes / Structs** | `PascalCase` | `ClientService`, `TimeEntry` |
| **Interfaces** | `I` prefix + `PascalCase` | `IClientService`, `IRepository<T>` |
| **Methods** | `PascalCase` | `GetByIdAsync()`, `CalculateTotal()` |
| **Properties** | `PascalCase` | `HourlyRate`, `IsActive` |
| **Private fields** | `_camelCase` | `_dbContext`, `_logger` |
| **Parameters / locals** | `camelCase` | `clientId`, `startDate` |
| **Async methods** | `Async` suffix | `GetAllAsync()`, `SaveChangesAsync()` |
| **Source files** | `PascalCase.cs`, one class per file | `ClientService.cs`, `TimeEntry.cs` |
| **Test files** | `{Class}Tests.cs` | `ClientServiceTests.cs` |
| **Test methods** | `{Method}_{Scenario}_{Expected}` | `Create_WithEmptyName_ThrowsValidation` |

---

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** — If it's a generic name (`utils/`, `helpers/`, `services/`), consider a more specific name or prefix
2. **Can someone guess what it does?** — `BillingService` > `BS`, `time_entries` > `entries`
3. **Does it follow the stack convention?** — Match the existing codebase style, don't mix conventions
4. **Is it searchable?** — Avoid single-letter names except in tight loops (`i`, `j`)
