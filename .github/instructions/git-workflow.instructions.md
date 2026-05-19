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

---

## Plan Forge Maintainer — Branch Model (this repo only)

> **Applies to**: the Plan Forge repo itself. Consuming projects use whatever branching model they prefer — this section is about Plan Forge's own master-cleanliness policy.

Plan Forge keeps `master` clean as a template. Dev planning artifacts live on `planning/main`.

| Branch | Purpose |
|--------|---------|
| `master` | Consumer-shipped template. Only framework code, instructions, prompts, hooks, agents, templates, examples, public docs, CHANGELOG. |
| `planning/main` | Long-lived superset of `master` + Plan Forge's own dev artifacts (`Phase-*-PLAN.md`, `archive/`, internal `DEPLOYMENT-ROADMAP.md`, testbed findings). |
| `planning/<topic>` | Short-lived topic branches forked off `planning/main` for in-flight DRAFT phase batches. |

### Rules for AI agents working in this repo

| Situation | Action |
|-----------|--------|
| Asked to create/edit a `docs/plans/Phase-*-PLAN.md` file | Branch off `planning/main` (`planning/<topic>`). NEVER commit phase plans to `master`. |
| Asked to edit `docs/plans/DEPLOYMENT-ROADMAP.md` (the internal one) | Same — `planning/<topic>` off `planning/main`. The `-TEMPLATE.md` variant is consumer-facing and CAN be edited on `master`. |
| Asked to edit framework code, instruction files, prompts, hooks, agents, shipped templates | Branch off `master` (`feat/...` or `fix/...`). Auto-sync workflow propagates the change to `planning/main`. |
| Asked to edit an `archive/` plan | Branch off `planning/main`. Archive lives there, not on `master`. |
| User says "commit" while on `master` | If working tree changes touch ONLY consumer-shipped paths (no `Phase-*-PLAN.md`, no `archive/`, no internal `DEPLOYMENT-ROADMAP.md`), proceed normally. Otherwise: stop and propose branching to `planning/<topic>`. |

### Promoting a phase ship

When a phase ships, only the consumer-facing residue lands on `master`:

- `CHANGELOG.md` entry
- `VERSION` bump
- Code changes (`pforge-mcp/`, `pforge-master/`, `pforge-sdk/`, scripts, etc.)
- Instruction / prompt / hook / agent / template additions or updates

The phase plan file itself **stays on `planning/main`** as the durable historical record. Reference it from the CHANGELOG entry by full URL (`https://github.com/srnichols/plan-forge/blob/planning/main/docs/plans/Phase-N-X-PLAN.md`) so the link survives.

### Bypassing PreCommit master protection

`PFORGE_ALLOW_MASTER_COMMIT=1` exists to allow legitimate consumer-facing fixes directly on `master`. Do not use it as a shortcut to commit dev artifacts to `master`. If you're tempted to, that's the signal to branch to `planning/<topic>` instead.
