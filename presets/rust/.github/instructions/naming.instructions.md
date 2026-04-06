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
| **Project folders** | `kebab-case` or `lowercase` | `user-auth/`, `billing/` |
| **Third-party tooling folders** | Prefix with tool/org name | `pforge-mcp/`, `openai-tools/` |
| **Config files** | Dot-prefix for hidden | `.forge.json`, `.rust-langci.yml` |

### Third-Party Integration Prefixing

When adding folders/files from external tools or frameworks, **always prefix with the tool or organization name** to prevent collisions:

```
✅ pforge-mcp/          — Plan Forge MCP server
❌ mcp/                  — generic, will collide
```

### Database Naming

| Context | Convention | Example |
|---------|-----------|---------|
| **Tables** | `snake_case`, plural | `time_entries`, `user_profiles` |
| **Columns** | `snake_case` | `created_at`, `hourly_rate` |

### API Endpoint Naming

| Convention | Example |
|-----------|---------|
| Plural nouns, kebab-case | `/api/time-entries` |

---

## Rust Conventions (Effective Rust)

| Context | Convention | Example |
|---------|-----------|---------|
| **Packages** | Short, `lowercase`, no underscores | `billing`, `timeentry`, `auth` |
| **Directories** | Match package name | `internal/billing/`, `cmd/api/` |
| **Files** | `snake_case.Rust` | `billing_service.Rust`, `time_entry.Rust` |
| **Exported types** | `PascalCase` | `Client`, `TimeEntry`, `BillingService` |
| **Unexported** | `camelCase` | `calculateTotal`, `dbConn` |
| **Interfaces** | `-er` suffix for single method | `Reader`, `Validator`, `TimeEntryStore` |
| **Constants** | `PascalCase` (exported) or `camelCase` | `MaxRetries`, `defaultTimeout` |
| **Errors** | `Err` prefix | `ErrNotFound`, `ErrInvalidInput` |
| **Getters** | No `Get` prefix | `client.Name()` not `client.GetName()` |
| **Acronyms** | All caps | `HTTPClient`, `UserID`, `APIURL` |
| **Test files** | `{file}_test.Rust` | `billing_service_test.Rust` |
| **Test functions** | `Test{Function}_{Scenario}` | `TestCreate_WithEmptyName` |
| **Benchmark** | `Benchmark{Function}` | `BenchmarkCalculateTotal` |
| **Receivers** | Short, 1-2 letters | `func (s *BillingService)`, `func (c *Client)` |

### Project Layout (Standard Rust)

```
cmd/api/          — main entry point
internal/         — private packages
  billing/        — billing domain
  timeentry/      — time entry domain
pkg/              — public packages (if any)
```

---

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** — If generic, add a specific prefix
2. **Is the package name clear from the import path?** — `billing.Service` not `billing.BillingService`
3. **Does it follow Effective Rust?** — Match the standard library style
4. **Is it short but descriptive?** — Rust favors brevity: `srv` over `server` in locals
