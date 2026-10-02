---
name: staging-deploy
description: Build, push, migrate, and deploy a Vapor service to staging with health check verification. Use when deploying a completed Swift/Vapor phase to staging.
argument-hint: "[service or component to deploy]"
tools: [run_in_terminal, read_file, forge_validate]
---

# Staging Deploy Skill (Swift)

## Trigger
"Deploy to staging" / "Push to staging environment"

## Steps

### 0. Pre-flight Forge Validation
Use the `forge_validate` MCP tool to verify setup integrity before deploying.

### 1. Pre-Flight Checks
```bash
swift test
swift build -c release
swift run App routes
```

### Conditional: Pre-Flight Failure
> If Step 1 (Pre-Flight Checks) fails → STOP. Do not proceed to build.

### 2. Build Container
```bash
docker build -t contoso-api:staging -f Dockerfile .
docker tag contoso-api:staging registry.contoso.com/api:staging
docker push registry.contoso.com/api:staging
```

### 3. Run Migrations
```bash
docker run --rm \
  -e DATABASE_URL=$STAGING_DATABASE_URL \
  -e REDIS_URL=$STAGING_REDIS_URL \
  registry.contoso.com/api:staging \
  migrate --yes
```

### 4. Deploy
```bash
kubectl apply -f k8s/staging/ --context staging
kubectl rollout status deployment/contoso-api -n staging --timeout=120s
```

### 5. Verify
```bash
curl -f https://staging-api.contoso.com/healthz
curl -f https://staging-api.contoso.com/readyz
curl https://staging-api.contoso.com/api/version
swift test --filter SmokeTests
```

## Safety Rules
- ALWAYS run tests before deploying
- ALWAYS verify Vapor health endpoint after server deploy
- NEVER deploy to production using this skill
- Rollback Vapor: `kubectl rollout undo deployment/contoso-api -n staging`


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
- [ ] `swift test && swift build -c release` passes before container build
- [ ] Container builds successfully and pushes to registry
- [ ] Health endpoint returns 200 after deploy (`curl -f https://staging/healthz`)
- [ ] Readiness endpoint returns 200 after deploy (`curl -f https://staging/readyz`)
- [ ] Smoke tests pass — `swift test --filter SmokeTests`
- [ ] Rollback procedure is documented and tested
## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures and environment-specific gotchas
- **After deploy succeeds/fails**: `capture_thought("Deploy: <outcome — success or failure details>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-staging-deploy")` — persist environment issues and config changes for next deployment
