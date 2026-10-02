---
name: staging-deploy
description: Build, migrate, push, and deploy a Rust/Axum service to staging with SQLx offline checks, cargo-chef containers, PostgreSQL 18, Redis 8, and health verification.
argument-hint: "[service or component to deploy]"
tools: [run_in_terminal, read_file, forge_validate]
---

# Staging Deploy Skill

## Trigger
"Deploy to staging" / "Push to staging environment"

## Steps

### 0. Pre-flight Forge Validation
Use `forge_validate` to verify Plan Forge setup integrity before deployment work begins.

### 1. Pre-Flight Checks
```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo nextest run --all-targets
cargo check --all-targets --locked
```

### Conditional: Pre-Flight Failure
> If Step 1 fails, stop. Do not build or push a staging image.

### 2. Build Container
```bash
docker build -t contoso-api:staging -f Dockerfile .
docker tag contoso-api:staging registry.contoso.com/contoso-api:staging
docker push registry.contoso.com/contoso-api:staging
```

The Dockerfile must use cargo-chef, `SQLX_OFFLINE=true`, `cargo build --release --locked`, and a non-root slim or distroless runtime.

### 3. Run Migrations
```bash
sqlx migrate info --database-url postgres://app:app@staging-postgres.contoso.internal:5432/app
sqlx migrate run --database-url postgres://app:app@staging-postgres.contoso.internal:5432/app
cargo sqlx prepare --check --database-url postgres://app:app@staging-postgres.contoso.internal:5432/app
```

### 4. Deploy
```bash
kubectl apply -f k8s/staging/ --context staging
kubectl rollout status deployment/contoso-api --context staging
```

For Compose-based staging:

```bash
docker compose -f docker-compose.staging.yml up -d --pull always
```

### 5. Verify
```bash
curl -fsS https://staging-api.contoso.com/health/live
curl -fsS https://staging-api.contoso.com/health/ready
cargo nextest run smoke
```

### 6. Report
```
Staging Deploy:
  Pre-flight:      PASS / FAIL
  Image build:     PASS / FAIL
  Image push:      PASS / FAIL
  Migrations:      PASS / FAIL
  Rollout:         PASS / FAIL
  Live probe:      PASS / FAIL
  Ready probe:     PASS / FAIL
  Smoke tests:     PASS / FAIL
```

## Safety Rules

- Run Rust tests and SQLx offline checks before building the image.
- Confirm the Kubernetes context or Compose file targets staging only.
- Ask before running migrations against shared staging databases.
- Never deploy to production with this skill.
- Keep rollback ready: `kubectl rollout undo deployment/contoso-api --context staging`.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The binary built locally, so the image is fine" | Docker uses SQLx offline data, native libraries, non-root users, and runtime probes that local builds do not cover. |
| "Readiness is the same as liveness" | Readiness protects traffic during migrations and dependency outages; liveness should not fail for a transient database issue. |
| "Staging migrations are safe to run automatically" | Shared staging data can still be valuable. Inspect and announce migrations before applying them. |
| "Smoke tests can wait until production" | Staging is where auth, routing, telemetry, and config drift are caught safely. |

## Warning Signs

- Dockerfile omits cargo-chef or `--locked`.
- `SQLX_OFFLINE` is false during image build.
- Compose services use unverified database or Redis tags.
- Health endpoints are missing or return a generic 200 without dependency detail.
- Rollback command is unknown before deployment starts.

## Exit Proof

After completing this skill, confirm:
- [ ] Rust pre-flight commands passed
- [ ] Container image built and pushed
- [ ] Migrations inspected and applied
- [ ] `/health/live` and `/health/ready` returned success
- [ ] Smoke tests ran against staging
- [ ] Rollback command documented

## Persistent Memory — staging deploy

- **Before deploying**: recall staging incidents, migration gotchas, and health probe failures.
- **After deployment**: capture image tag, migration result, smoke result, and any rollback or config fix.
