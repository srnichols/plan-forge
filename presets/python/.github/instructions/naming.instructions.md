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
| **Project folders** | `kebab-case` or `snake_case` | `user-auth/`, `payment_gateway/` |
| **Third-party tooling folders** | Prefix with tool/org name | `pforge-mcp/`, `openai-tools/` |
| **Config files** | Dot-prefix for hidden | `.forge.json`, `.flake8` |
| **Documentation** | `UPPER-KEBAB.md` for root docs | `README.md`, `CHANGELOG.md` |

### Third-Party Integration Prefixing

When adding folders/files from external tools or frameworks, **always prefix with the tool or organization name** to prevent collisions in brownfield projects:

```
✅ pforge-mcp/          — Plan Forge MCP server
✅ grafana-dashboards/   — Grafana dashboard JSON
❌ mcp/                  — generic, will collide
❌ agents/               — too generic
```

### Database Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Tables** | `snake_case`, plural | `time_entries`, `user_profiles` |
| **Columns** | `snake_case` | `created_at`, `hourly_rate` |
| **Primary keys** | `id` or `{table}_id` | `id`, `client_id` |
| **Foreign keys** | `{referenced_table}_id` | `project_id` |
| **Indexes** | `ix_{table}_{columns}` | `ix_time_entries_date` |

### API Endpoint Naming

| Convention | Example |
|-----------|---------|
| Plural nouns, kebab-case | `/api/time-entries` |
| Nested resources | `/api/clients/{id}/projects` |

---

## Python Conventions (PEP 8)

| Context | Convention | Example |
|---------|-----------|---------|
| **Packages / modules** | `snake_case` | `billing_service.py`, `time_entries/` |
| **Directories** | `snake_case` | `time_entries/`, `shared_utils/` |
| **Classes** | `PascalCase` | `BillingService`, `TimeEntry` |
| **Functions / methods** | `snake_case` | `get_by_id()`, `calculate_total()` |
| **Variables / params** | `snake_case` | `client_id`, `start_date` |
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| **Private** | Leading underscore | `_validate_input()`, `_db_session` |
| **Protected** | Leading underscore | `_internal_method()` |
| **Dunder** | Double underscore | `__init__`, `__str__` |
| **Type aliases** | `PascalCase` | `ClientList = list[Client]` |
| **Test files** | `test_{module}.py` | `test_billing_service.py` |
| **Test functions** | `test_{scenario}` | `test_create_with_empty_name_raises` |
| **Fixtures** | `snake_case` descriptive | `sample_client`, `db_session` |

---

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** — If generic (`utils/`, `helpers/`), add a specific prefix
2. **Can someone guess what it does?** — `BillingService` > `BS`
3. **Does it follow PEP 8?** — Match the existing codebase style
4. **Is it searchable?** — Avoid single-letter names except in comprehensions
