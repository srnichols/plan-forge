---
name: staging-deploy
description: Build, push, migrate, and deploy a Laravel service to staging with PHP-FPM, nginx, queues, scheduler, readiness checks, and rollback verification.
argument-hint: "[service or component to deploy]"
tools: [run_in_terminal, read_file, forge_validate]
---

# Staging Deploy Skill

## Trigger
"Deploy to staging" / "Push to staging environment"

## Steps

### 0. Pre-flight Forge Validation
Use `forge_validate` to verify setup integrity before deployment.

### 1. Pre-Flight Checks
```bash
composer install
vendor/bin/pint --test
vendor/bin/phpstan analyse
php artisan test
composer audit
```

### Conditional: Pre-Flight Failure
> If Step 1 fails, stop. Do not build or push an image.

### 2. Build and Push Container
```bash
docker build -t registry.example.com/laravel-api:$(git rev-parse --short=12 HEAD) -f Dockerfile .
docker push registry.example.com/laravel-api:$(git rev-parse --short=12 HEAD)
```

The Dockerfile must be the php-fpm application image. nginx remains a sidecar in staging, not a second PHP image.

### 3. Preview Migrations
```bash
php artisan migrate --pretend --env=staging
```

Pause here for explicit approval. Do not apply migrations until the preview output has been reviewed.

### 4. Apply Migrations
```bash
php artisan migrate --force --env=staging
```

### 5. Deploy Runtime Services
```bash
kubectl set image deployment/laravel-web app=registry.example.com/laravel-api:$(git rev-parse --short=12 HEAD) --context staging
kubectl set image deployment/laravel-worker queue=registry.example.com/laravel-api:$(git rev-parse --short=12 HEAD) --context staging
kubectl set image deployment/laravel-scheduler scheduler=registry.example.com/laravel-api:$(git rev-parse --short=12 HEAD) --context staging
kubectl rollout status deployment/laravel-web --context staging
kubectl rollout status deployment/laravel-worker --context staging
kubectl rollout status deployment/laravel-scheduler --context staging
```

### 6. Verify Health and Smoke Tests
```bash
curl -f https://staging.example.com/up
curl -f https://staging.example.com/ready
php artisan queue:restart --env=staging
php artisan test --group=smoke --env=staging
```

### 7. Report
```text
Staging Deploy:
  Tests:       PASS / FAIL
  Image:       pushed / not pushed
  Migrations:  applied / skipped
  Web rollout: PASS / FAIL
  Worker:      PASS / FAIL
  Scheduler:   PASS / FAIL
  /up:         PASS / FAIL
  /ready:      PASS / FAIL
  Smoke:       PASS / FAIL
```

For Compose staging, start `web`, `app`, `queue`, `scheduler`, `postgres`, and `redis` together.

## Safety Rules

- ALWAYS run tests and static analysis before build.
- ALWAYS review `migrate --pretend` output before applying.
- NEVER deploy web without queue workers when job contracts changed.
- NEVER use this skill for production deploys.
- Keep rollback ready for all runtime deployments: `kubectl rollout undo deployment/laravel-web --context staging`, `kubectl rollout undo deployment/laravel-worker --context staging`, and `kubectl rollout undo deployment/laravel-scheduler --context staging`.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Only web changed" | Laravel jobs and scheduled commands often share the same services and DTOs. |
| "The image built, deploy is safe" | Build success does not prove migrations, readiness, or queue compatibility. |
| "Skip `/ready`; `/up` is green" | `/up` does not prove PostgreSQL, Redis, or required clients are usable. |
| "Run migrations from the web pod" | Release tasks should be explicit and auditable. |

## Warning Signs

- No migration preview.
- Queue deployment uses an older image than web.
- `APP_ENV` or secrets are unclear.
- Smoke tests hit only `/up`.
- Rollback command is missing.

## Exit Proof

After completing this skill, confirm:

- [ ] Pre-flight checks passed
- [ ] Container built and pushed
- [ ] Migration preview reviewed and applied if approved
- [ ] Web, worker, and scheduler rollouts verified
- [ ] `/up`, `/ready`, and smoke tests passed
- [ ] Rollback command documented

## Persistent Memory for Staging Deploys

- **Before deploying**: `search_thoughts("Laravel staging deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")`
- **After deploy succeeds/fails**: `capture_thought("Laravel staging deploy: <outcome and blockers>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-staging-deploy")`
