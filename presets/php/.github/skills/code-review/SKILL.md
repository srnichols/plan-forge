---
name: code-review
description: Run a comprehensive Laravel code review across architecture, security, testing, database access, deployment, observability, naming, and consistency. Use before merging features or at the end of a phase. With --quorum, dispatch multi-model analysis for higher confidence.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

> **Run `/clean-code-review` first.** That pass catches quantitative issues. This skill focuses on Laravel architecture and judgment calls.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use `forge_analyze` with the current plan when available. Use `forge_diff` to detect scope drift and forbidden edits.

If `--quorum` was specified, run `forge_analyze` with `quorum: true` and synthesize consensus findings.

### 1. Identify Changed Files
```bash
git diff --name-only main...HEAD
git diff --name-only HEAD~1
```

### 2. Architecture Review
Check Laravel layer separation:

- Controllers are thin: Form Request in, service call, API Resource out.
- Services own business rules and transactions.
- Repositories own Eloquent query construction.
- Models do not become service locators.
- `bootstrap/app.php` owns routing, middleware, and exception rendering.

### 3. Security Review
Review:

- Tenant comes only from authenticated user context.
- Policies or Gates protect sensitive operations.
- Sanctum or verified OIDC guards protect API routes.
- Raw SQL uses bindings.
- No secrets in code, config committed to git, logs, or Docker images.
- Validation happens at HTTP and job boundaries.

### 4. Database Review
Look for:

- `with()` on relationships needed by resources.
- Cursor pagination with unique ordering.
- `DB::transaction()` around multi-write operations.
- No lazy-loading regressions in non-production.
- Unique constraint handling maps only true unique violations to 409.

### 5. Testing Review
Verify:

- Feature tests cover route, middleware, policy, request validation, resource shape, and tenant isolation.
- Unit tests cover services, DTOs, policies, and job handlers.
- PostgreSQL-specific behavior uses Testcontainers.
- Fakes are asserted and scoped to the test.
- Coverage command is documented for new critical paths.

### 6. Deployment and Observability Review
Check:

- Dockerfile follows the php-fpm + nginx sidecar contract.
- Queue worker and scheduler deployments are updated with web changes.
- `/up` and `/ready` are both present where needed.
- Logs use JSON Monolog and `Log::withContext`.
- OpenTelemetry spans do not swallow exceptions.

### 7. Report
```text
Code Review Summary:
  Critical: N
  Warning:  N
  Info:     N

Files Reviewed: N
Findings by Category:
  Architecture: N
  Security:     N
  Database:     N
  Testing:      N
  Deploy/Ops:   N
  Observability:N
Forge Analysis Score: N/100
Scope Drift: N files outside scope
```

## Safety Rules

- Review only; do not modify files.
- Cite the rule, instruction file, or Laravel convention behind each finding.
- Separate blockers from maintainability suggestions.
- Flag uncertain framework behavior for human confirmation.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Laravel makes this magic, so it is fine" | Magic still needs explicit boundaries, authorization, and tests. |
| "The route works locally" | Local success says little about tenant isolation, queues, migrations, or production config. |
| "Eloquent queries are safe by default" | Raw expressions, scopes, and missing tenant filters can still leak data. |
| "No review findings means ship it" | A zero-finding review usually means important surfaces were skipped. |

## Warning Signs

- Controller returns an Eloquent model directly.
- Service imports `Request` or returns `JsonResponse`.
- Repository applies business decisions instead of query constraints.
- Tests authenticate by setting client-controlled identity headers.
- Queue job does not set `CurrentTenant`.

## Exit Proof

After completing this skill, confirm:

- [ ] Architecture, security, database, testing, deploy, and observability sections completed
- [ ] Findings table includes severity and file references
- [ ] `forge_analyze` score included if a plan exists
- [ ] `forge_diff` scope check included if a plan exists
- [ ] Every blocker has a concrete validation path

## Persistent Memory for Reviews

- **Before reviewing**: `search_thoughts("Laravel code review findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After review**: `capture_thought("Laravel review: <N findings, key recurring patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-code-review")`
