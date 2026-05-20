---
description: Git workflow and commit conventions — conventional commits, push reminders, version-aware messaging
applyTo: '**'
---

# Git Workflow

> **Applies to**: ALL files

---

## AI Agent Instructions

### Before Starting Work
```
"Before we begin, ensure Git state is clean:
 1. Pull latest: git pull origin main
 2. Check status: git status
 3. Stash if needed: git stash"
```

### After Completing Changes
```
"Changes complete! Commit and push:
 1. Stage: git add -A
 2. Commit: git commit -m '<type>(<scope>): <description>'
 3. Push: git push origin main"
```

---

## Conventional Commit Format

```
<type>(<scope>): <short description>

[optional body]
[optional footer]
```

### Commit Types

| Type | When to Use | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(auth): add OAuth2 login flow` |
| `fix` | Bug fix | `fix(api): resolve null reference in user lookup` |
| `perf` | Performance improvement | `perf(queries): add index for tenant lookups` |
| `refactor` | Code restructure (no behavior change) | `refactor(services): extract validation logic` |
| `docs` | Documentation only | `docs(readme): update setup instructions` |
| `test` | Adding/updating tests | `test(users): add integration tests for CRUD` |
| `chore` | Build, deps, config | `chore(deps): update dependencies` |
| `style` | Formatting only | `style(api): fix indentation` |
| `ci` | CI/CD changes | `ci(actions): add staging deploy workflow` |

### Scope Examples

Use your project's module names:
```
auth, users, api, database, frontend, tests, docker, deploy, config, docs
```

---

## When to Remind About Git

| Scenario | Action |
|----------|--------|
| New feature implemented | Suggest `feat:` commit |
| Bug fixed | Suggest `fix:` commit |
| Tests added | Suggest `test:` commit |
| Docs updated | Suggest `docs:` commit |
| 3+ files modified | Remind to commit |
| Starting new work | Remind to pull first |
