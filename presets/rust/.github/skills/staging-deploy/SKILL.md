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

## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures and environment-specific gotchas
- **After deploy succeeds/fails**: `capture_thought("Deploy: <outcome — success or failure details>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-staging-deploy")` — persist environment issues and config changes for next deployment
