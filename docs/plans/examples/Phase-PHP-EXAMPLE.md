# Phase 4: Multi-Tenant API Authentication — PHP Example

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 2 days (7 execution slices)  
> **Risk Level**: Medium (auth + multi-tenant scoping)

---

## Overview

Add API authentication using Laravel Sanctum with role-based access control. Multi-tenant scoped tokens, rate limiting per tenant, and comprehensive PHPUnit test suite.

---

## Prerequisites

- [ ] Phase 3 complete (core models + migrations applied)
- [ ] PostgreSQL / MySQL running (Docker Compose)
- [ ] Laravel Sanctum package installed (`composer require laravel/sanctum`)
- [ ] PHPStan configured at level 8

## Acceptance Criteria

- [ ] API tokens scoped to tenant via Sanctum abilities
- [ ] Role-based middleware: `admin`, `editor`, `viewer`
- [ ] Rate limiting per tenant (60/min default, configurable)
- [ ] Token revocation endpoint with audit trail
- [ ] 90%+ test coverage on auth middleware
- [ ] `php artisan test` passes cleanly
- [ ] `phpstan analyse --level=8` passes with zero errors

---

## Execution Slices

### Slice 4.1 — Database: Migration for `personal_access_tokens`
**Build command**: `php artisan migrate --force`  
**Test command**: `php artisan test --filter="AuthMigrationTest"`

**Tasks**:
1. Publish Sanctum migration and add `tenant_id` column
2. Add composite index on `(tenant_id, tokenable_type, tokenable_id)`
3. Add `expires_at` column for token expiration
4. Integration test: verify tenant-scoped token lookup

```php
Schema::create('personal_access_tokens', function (Blueprint $table) {
    $table->id();
    $table->string('tenant_id', 50)->index();
    $table->morphs('tokenable');
    $table->string('name');
    $table->string('token', 64)->unique();
    $table->json('abilities')->nullable();
    $table->timestamp('last_used_at')->nullable();
    $table->timestamp('expires_at')->nullable();
    $table->timestamps();

    $table->index(['tenant_id', 'tokenable_type', 'tokenable_id']);
});
```

**Validation Gate**:
```bash
php artisan migrate --force                              # zero errors
php artisan test --filter="AuthMigrationTest"             # all pass
grep -rn 'DB::raw\|DB::select' --include="*.php" app/    # zero hits in new files
```

**Stop Condition**: If migration fails or tenant isolation test fails → STOP, do not proceed.

---

### Slice 4.2 — Middleware: Tenant-Scoped Auth Guard
**Build command**: `composer dump-autoload`  
**Test command**: `php artisan test --filter="TenantAuthTest"`

**Tasks**:
1. Create `EnsureTenantAccess` middleware
2. Extract `tenant_id` from authenticated token's abilities
3. Inject tenant scope into request for downstream use
4. Reject requests where token tenant ≠ route tenant
5. Unit tests for middleware with mock requests

**Validation Gate**:
```bash
php artisan test --filter="TenantAuthTest"                # all pass
phpstan analyse --level=8 app/Http/Middleware/             # zero errors
```

---

### Slice 4.3 — Middleware: Role-Based Access Control
**Build command**: `composer dump-autoload`  
**Test command**: `php artisan test --filter="RbacTest"`

**Tasks**:
1. Create `CheckRole` middleware with configurable role hierarchy
2. Role hierarchy: `admin` > `editor` > `viewer`
3. Register middleware aliases in `Kernel.php`
4. Apply to routes: `Route::middleware(['auth:sanctum', 'role:admin'])`
5. Unit tests: verify role escalation blocked, valid roles pass

---

### Slice 4.4 — Rate Limiting: Per-Tenant Throttle
**Build command**: `composer dump-autoload`  
**Test command**: `php artisan test --filter="RateLimitTest"`

**Tasks**:
1. Configure `RateLimiter` in `RouteServiceProvider` keyed by `tenant_id`
2. Default: 60 requests/min per tenant, configurable via `config/tenants.php`
3. Return `429` with `Retry-After` header
4. Integration test: exceed limit, verify 429 response

---

### Slice 4.5 — Token Management: Issue & Revoke Endpoints
**Build command**: `php artisan route:list`  
**Test command**: `php artisan test --filter="TokenManagementTest"`

**Tasks**:
1. `POST /api/tokens` — issue token with abilities and expiration
2. `DELETE /api/tokens/{id}` — revoke specific token
3. `DELETE /api/tokens` — revoke all tokens for user
4. Audit trail: log token events to `audit_logs` table
5. Feature tests for all endpoints with auth assertions

---

### Slice 4.6 — Integration Tests & Edge Cases
**Test command**: `php artisan test --testsuite=Feature`

**Tasks**:
1. Cross-tenant access attempt (expect 403)
2. Expired token access (expect 401)
3. Revoked token reuse (expect 401)
4. Rate limit recovery after window reset
5. Concurrent token issuance under load

---

### Slice 4.7 — Documentation & Cleanup
**Test command**: `php artisan test`

**Tasks**:
1. Update API documentation with auth endpoints
2. Add Sanctum setup instructions to README
3. Verify `phpstan analyse --level=8` passes for all new files
4. Final test sweep: `php artisan test --coverage --min=90`

**Validation Gate**:
```bash
php artisan test                                          # all pass
phpstan analyse --level=8                                 # zero errors
php artisan test --coverage --min=90                      # coverage ≥ 90%
```

---

## Forbidden Actions

- ❌ Do NOT use `DB::raw()` or raw SQL in new code — use Eloquent/Query Builder
- ❌ Do NOT store tokens in plain text — Sanctum handles hashing
- ❌ Do NOT skip tenant isolation — every query must scope by `tenant_id`
- ❌ Do NOT modify existing Phase 3 migrations — only add new ones
