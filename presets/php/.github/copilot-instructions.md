# Instructions for Copilot — PHP Project

> **Project**: <YOUR PROJECT NAME>
> **Stack**: PHP 8.5 / Laravel 13.x / PostgreSQL 18
> **Last Updated**: <DATE>

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Form Request → Controller → Service → Repository
3. **Best Practices Over Speed** — Enterprise-grade Laravel, not shortcuts
4. **TDD for Business Logic** — Red-Green-Refactor around services and policies
5. **Type Safety** — `declare(strict_types=1);`, typed signatures, no untyped arrays when DTOs fit

### Red Flags
```
❌ "quick fix in the controller" → STOP, move behavior to a service
❌ "return the model directly"   → STOP, use an API Resource
❌ "tenant from a header"        → STOP, derive tenant from authenticated user
❌ "raw SQL is easier"           → STOP, use Eloquent/query builder bindings
```

---

## Project Overview

**Description**: <!-- What your app does -->

**Tech Stack**:
- PHP 8.5 with Laravel 13.x
- Laravel Sanctum for API tokens; custom guards only after JWT verification
- PostgreSQL 18 with Eloquent repositories and migrations
- Redis 8 for cache, queues, Horizon, and rate-limit backing stores
- PHPUnit 13 as the default test runner; Pest 5 as an optional style layer
- Larastan 3, Pint 1, Composer 2, Docker Linux containers

---

## Coding Standards

### PHP and Laravel Style
- Every PHP file starts with `declare(strict_types=1);`
- Follow PER Coding Style through Pint
- Prefer `final readonly class` DTOs in `app/Data`
- Constructor-inject collaborators; no service locator calls in business logic
- Use Laravel collections intentionally, not as a replacement for typed DTOs

### HTTP Layer
- Controllers live in `app/Http/Controllers/Api/V1`
- Controllers are thin: Form Request in, service call, API Resource out
- Form Requests own validation, authorization, and `toData()` conversion
- Routes use `Route::prefix('v1')->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])`
- Order routes include the authenticated index, show, and store endpoints.
- Define the `api` rate limiter in `AppServiceProvider::boot()` before using `throttle:api`
- Do not return Eloquent models or paginator internals directly

### Services and Data Access
- Services own business rules and `DB::transaction()`
- Repositories own query construction and persistence
- Bind repository interfaces in `App\Providers\AppServiceProvider::register()`
- Use cursor pagination with a unique order: `created_at` plus `id`
- Raw SQL must use bindings; never concatenate input into SQL

### Tenancy and Identity
- Resolve tenant from `$request->user()->tenant_id` after authentication
- Store request tenant in `App\Support\CurrentTenant`
- `TenantScope` applies tenant filtering for tenant-owned models
- Queued jobs carry `tenantId` and set `CurrentTenant` at the start of `handle()`

### Error Handling
- Use `App\Exceptions\AppException` subclasses for domain failures
- Render RFC 9457 `application/problem+json` responses from `bootstrap/app.php`
- Map validation to 422, authentication to 401, authorization to 403, not found to 404, conflict to 409
- Unexpected errors return 500 without internals; logs carry diagnostic detail

### Testing and Quality
- Write service tests before business-rule implementation
- Use feature tests for HTTP contracts and policy outcomes
- Use integration tests for repositories and tenant scopes
- Run targeted commands before handoff:
  - `php artisan test`
  - `vendor/bin/phpstan analyse`
  - `vendor/bin/pint --test`
  - `composer audit`

---

## Quick Commands

```bash
composer install
php artisan serve
php artisan test
vendor/bin/phpstan analyse
vendor/bin/pint --test
composer audit
composer outdated --direct
php artisan migrate --pretend
php artisan migrate:status
php artisan route:list --path=v1
php artisan queue:work
docker compose up -d
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
| `api-patterns.instructions.md` | Laravel API routes, controllers, resources |
| `database.instructions.md` | Eloquent, repositories, migrations, tenant scope |
| `security.instructions.md` | Sanctum, policies, input validation, secrets |
| `errorhandling.instructions.md` | Problem Details and exception mapping |
| `testing.instructions.md` | PHPUnit, Pest, factories, Testcontainers |
| `deploy.instructions.md` | Docker, queues, health checks |
| `git-workflow.instructions.md` | Commit conventions |

---

## Code Review Checklist

- [ ] Controllers contain no business rules or query construction
- [ ] Form Requests validate input and call policies from `authorize()`
- [ ] API Resources shape every response
- [ ] Services use transactions around multi-write operations
- [ ] Repository interfaces are bound to concrete Eloquent repositories
- [ ] Tenant ID comes from the authenticated user only
- [ ] Exceptions render the canonical RFC 9457 payload from `app/Support/helpers.php`
- [ ] No secrets in source, config defaults, tests, or logs
- [ ] Tests cover new policies, validation, service rules, and repository queries
