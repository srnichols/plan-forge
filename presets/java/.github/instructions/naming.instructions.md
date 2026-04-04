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
| **Config files** | Dot-prefix for hidden | `.forge.json` |

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

## Java Conventions (Google Java Style)

| Context | Convention | Example |
|---------|-----------|---------|
| **Packages** | `lowercase`, reverse domain | `com.example.timetracker.billing` |
| **Directories** | Match package path | `src/main/java/com/example/timetracker/` |
| **Source files** | `PascalCase.java`, one top-level class | `BillingService.java`, `TimeEntry.java` |
| **Classes / Enums** | `PascalCase` | `ClientService`, `EntryStatus` |
| **Interfaces** | `PascalCase` (no `I` prefix) | `TimeEntryRepository`, `BillingCalculator` |
| **Methods** | `camelCase` | `getById()`, `calculateTotal()` |
| **Variables / params** | `camelCase` | `clientId`, `startDate` |
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| **Private fields** | `camelCase` (no prefix) | `dbContext`, `logger` |
| **Getters / setters** | `get`/`set`/`is` prefix | `getName()`, `isActive()` |
| **Generic types** | Single uppercase letter | `T`, `E`, `K`, `V` |
| **Annotations** | `PascalCase` | `@Transactional`, `@Override` |
| **Test classes** | `{Class}Test.java` | `ClientServiceTest.java` |
| **Test methods** | `{method}_{scenario}_{expected}` | `create_withEmptyName_throwsValidation` |

### Maven / Gradle

| Context | Convention | Example |
|---------|-----------|---------|
| **Group ID** | Reverse domain | `com.example.timetracker` |
| **Artifact ID** | `kebab-case` | `time-tracker-api`, `time-tracker-core` |
| **Module names** | `kebab-case` | `billing-service`, `auth-gateway` |

---

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** — If generic, add a specific prefix
2. **Can someone guess what it does?** — `BillingService` > `BS`
3. **Does it follow Google Java Style?** — Match the team convention
4. **Is the package name meaningful?** — `billing` not `misc`
