---
name: onboarding
description: Walk a new developer through Laravel project setup, architecture, key files, tests, Docker services, and first task. Use when someone joins the team or needs to understand the codebase.
argument-hint: "[optional: specific area to focus on, e.g. 'backend', 'queues', or 'testing']"
tools:
  - run_in_terminal
  - read_file
  - forge_smith
---

# Developer Onboarding Skill

## Trigger
"Onboard me to this project" / "How does this codebase work?" / "New developer setup"

## Steps

### 1. Environment Setup
Verify prerequisites:

```bash
git --version
php --version
composer --version
docker version
```

Install dependencies and prepare local config:

```bash
composer install
[ -f .env ] || cp .env.example .env
grep -q '^APP_KEY=.' .env || php artisan key:generate
```

### 2. Start Local Services
Use the project compose file when available:

```bash
docker compose up -d postgres redis
php artisan migrate
```

If Docker is unavailable, explain which tests or features will be blocked, especially Testcontainers integration tests.

### 3. Verify Build and Tests
Use `forge_smith` for environment diagnostics, then run:

```bash
vendor/bin/pint --test
vendor/bin/phpstan analyse
php artisan test
php artisan route:list --path=v1
```

### 4. Architecture Overview
Explain the Laravel layers:

1. `routes/api.php` defines versioned routes behind `auth:sanctum` and `throttle:api`.
2. Controllers accept Form Requests and return API Resources.
3. Form Requests authorize through policies and build DTOs with `toData()`.
4. Services own business rules and transactions.
5. Repositories own Eloquent queries.
6. Models define casts, relationships, UUIDs, and tenant scope.
7. `bootstrap/app.php` wires middleware and problem-details exceptions.

### 5. Key Files Tour
Review:

- `composer.json` for Laravel, PHPUnit, Larastan, Pint, Sanctum, and OpenTelemetry packages.
- `app/Http/Controllers/Api/V1/` for endpoint boundaries.
- `app/Services/` and `app/Repositories/` for business and data layers.
- `app/Models/Concerns/BelongsToTenant.php` and `app/Models/Scopes/TenantScope.php`.
- `tests/Feature/` and `tests/Unit/`.
- `Dockerfile`, compose files, and nginx config.
- GitHub Actions or other CI workflows.

### 6. Plan Forge Pipeline Tour
Explain:

1. Plans in `docs/plans/`.
2. Guardrails in `.github/instructions/`.
3. Step 0-5 prompts for feature execution.
4. Slash skills such as `/test-sweep`, `/code-review`, and `/staging-deploy`.
5. Reviewer agents under `.github/agents/`.

### 7. First Task Guidance
Suggest a starter task:

- Add or update one feature test around an existing endpoint.
- Improve one API Resource example in OpenAPI docs.
- Fix a small Larastan or Pint issue.
- Use `/test-sweep` before handing off.

### 8. Report
```text
Onboarding Status:
  PHP:          PASS / FAIL (version)
  Composer:     PASS / FAIL (version)
  Docker:       PASS / FAIL
  Dependencies: PASS / FAIL
  Tests:        PASS / FAIL
  Routes:       PASS / FAIL
  Forge Smith:  PASS / FAIL
```

## Safety Rules

- NEVER change files during onboarding.
- Ask the developer's Laravel and Docker experience before choosing depth.
- Show exact failed command output when setup breaks.
- Point to project files rather than relying only on memory.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Composer install succeeded, so setup is done" | Migrations, queues, route registration, and tests can still be broken. |
| "They can use SQLite locally" | PostgreSQL behavior (types, locking, JSON operators) differs from SQLite; run PostgreSQL through Docker. |
| "The README covers architecture" | New developers need the live code path and current conventions. |
| "Queues can wait" | Laravel apps often fail in workers, not web requests. |

## Warning Signs

- `.env` requirements are unexplained.
- Tests are skipped because services are not running.
- No route list is shown.
- Tenant isolation is not explained.
- The first task is too broad for a new contributor.

## Exit Proof

After completing this skill, confirm:

- [ ] PHP, Composer, and Docker versions verified
- [ ] Dependencies installed
- [ ] Migrations and route listing checked
- [ ] Tests or blockers reported
- [ ] Architecture walkthrough completed
- [ ] First task suggested

## Persistent Memory for Onboarding

- **Before onboarding**: `search_thoughts("Laravel onboarding", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")`
- **After onboarding**: `capture_thought("Laravel onboarding: <setup status and blockers>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-onboarding")`
