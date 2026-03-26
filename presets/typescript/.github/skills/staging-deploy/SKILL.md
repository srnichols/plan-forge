---
name: staging-deploy
description: Build, push, migrate, and deploy to staging environment with health check verification. Use when deploying a completed phase to staging.
argument-hint: "[service or component to deploy]"
---

# Staging Deploy Skill

## Trigger
"Deploy to staging" / "Push to staging environment"

## Steps

### 1. Pre-Flight Checks
```bash
npm run build
npm run test
npm run lint
```

### 2. Build Container
```bash
docker build -t contoso-api:staging -f Dockerfile .
docker tag contoso-api:staging registry.contoso.com/api:staging
docker push registry.contoso.com/api:staging
```

### 3. Run Migrations
```bash
npx knex migrate:latest --env staging
# Or: npx prisma migrate deploy
```

### 4. Deploy
```bash
# Kubernetes
kubectl apply -f k8s/staging/ --context staging

# Or Docker Compose
docker compose -f docker-compose.staging.yml up -d
```

### 5. Verify
```bash
curl -f https://staging-api.contoso.com/health
curl https://staging-api.contoso.com/api/version
npm run test:smoke -- --env staging
```

## Safety Rules
- ALWAYS run tests before deploying
- ALWAYS verify health endpoint after deploy
- NEVER deploy to production using this skill
- Rollback: `kubectl rollout undo deployment/api --context staging`

## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<project>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures and environment-specific gotchas
- **After deploy succeeds/fails**: `capture_thought("Deploy: <outcome — success or failure details>", project: "<project>", created_by: "copilot-vscode", source: "skill-staging-deploy")` — persist environment issues and config changes for next deployment
