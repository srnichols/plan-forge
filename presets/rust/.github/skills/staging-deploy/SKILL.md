---
name: staging-deploy
description: Build, push, migrate, and deploy to staging environment with health check verification. Use when deploying a completed phase to staging.
argument-hint: "[service or component to deploy]"
tools: [run_in_terminal, read_file, forge_validate]
---

# Staging Deploy Skill

## Trigger
"Deploy to staging" / "Push to staging environment"

## Steps

### 0. Pre-flight Forge Validation
Use the `forge_validate` MCP tool to verify setup integrity before deploying.

### 1. Pre-Flight Checks
```bash
# Run tests
Rust test ./... -count=1

# Build binary
Rust build -o bin/contoso-api ./cmd/api

# Lint
rust-langci-lint run ./...
```

### Conditional: Pre-Flight Failure
> If Step 1 (Pre-Flight Checks) fails → STOP. Do not proceed to build.

### 2. Build Container
```bash
# Multi-stage build
docker build -t contoso-api:staging -f Dockerfile .

# Tag for registry
docker tag contoso-api:staging registry.contoso.com/api:staging

# Push
docker push registry.contoso.com/api:staging
```

### 3. Run Migrations
```bash
# Apply pending migrations to staging
migrate -path migrations -database "$STAGING_DB_URL" up

# Verify migration status
migrate -path migrations -database "$STAGING_DB_URL" version
```

### 4. Deploy
```bash
# Kubernetes
kubectl apply -f k8s/staging/ --context staging
kubectl rollout status deployment/contoso-api -n staging --timeout=120s

# Or Docker Compose
docker compose -f docker-compose.staging.yml up -d
```

### 5. Verify
```bash
# Health check
curl -f https://staging-api.contoso.com/health

# Version check
curl https://staging-api.contoso.com/api/version

# Smoke test
Rust test ./tests/smoke/... -v -tags=smoke -env=staging
```

## Safety Rules
- ALWAYS run tests before deploying
- ALWAYS verify health endpoint after deploy
- NEVER deploy to production using this skill
- Rollback: `kubectl rollout undo deployment/contoso-api -n staging`


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "It works locally, skip staging" | Local environments mask configuration, networking, and scaling issues that only surface in staging. |
| "Health check isn't needed yet" | Without health checks, orchestrators can't detect failures. A "successful" deploy may serve errors silently. |
| "I'll add monitoring after launch" | Post-launch is too late. Staging is where you verify observability works before production traffic arrives. |
| "One big deploy is simpler" | Monolithic deploys are harder to roll back. Deploy incrementally so failures are isolated to a single change. |

## Warning Signs

- No health check endpoint — container starts but no way to verify it's actually serving correctly
- Deploy without tests — build pushed to staging without passing the test suite first
- No rollback plan — deploy proceeds without a documented way to revert
- Secrets hardcoded or missing — environment variables not configured for the staging environment
- No smoke test after deploy — health endpoint returns 200 but actual business routes not verified

## Exit Proof

After completing this skill, confirm:
- [ ] `cargo build --release && cargo test` passes before container build
- [ ] Container builds successfully and pushes to registry
- [ ] Health endpoint returns 200 after deploy (`curl -f https://staging/health`)
- [ ] Smoke tests pass — `cargo test --test smoke`
- [ ] Rollback procedure is documented and tested
## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures and environment-specific gotchas
- **After deploy succeeds/fails**: `capture_thought("Deploy: <outcome — success or failure details>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-staging-deploy")` — persist environment issues and config changes for next deployment
