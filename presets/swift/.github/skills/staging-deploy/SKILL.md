---
name: staging-deploy
description: Build, push, migrate, and deploy to staging environment (Vapor server) or TestFlight (iOS) with health check verification. Use when deploying a completed phase to staging.
argument-hint: "[service or component to deploy: 'vapor', 'ios', or component name]"
tools: [run_in_terminal, read_file, forge_validate]
---

# Staging Deploy Skill (Swift)

## Trigger
"Deploy to staging" / "Push to staging environment" / "Deploy to TestFlight"

## Steps

### 0. Pre-flight Forge Validation
Use the `forge_validate` MCP tool to verify setup integrity before deploying.

### 1. Pre-Flight Checks
```bash
# Run tests
swift test

# Build (Vapor server)
swift build -c release

# Lint
swiftlint --strict

# Or for iOS: xcodebuild build
xcodebuild build \
  -scheme MyApp \
  -destination 'generic/platform=iOS' \
  -configuration Release
```

### Conditional: Pre-Flight Failure
> If Step 1 (Pre-Flight Checks) fails → STOP. Do not proceed to build.

---

## Path A: Vapor Server Staging Deploy

### 2A. Build Container
```bash
# Multi-stage Docker build
docker build -t contoso-api:staging -f Dockerfile .

# Tag for registry
docker tag contoso-api:staging registry.contoso.com/api:staging

# Push
docker push registry.contoso.com/api:staging
```

### 3A. Run Migrations
```bash
# Apply Fluent migrations to staging database
docker run --rm \
  -e DATABASE_URL=$STAGING_DATABASE_URL \
  registry.contoso.com/api:staging \
  migrate --yes

# Or via Vapor CLI
swift run App migrate --env staging --yes
```

### 4A. Deploy
```bash
# Kubernetes
kubectl apply -f k8s/staging/ --context staging
kubectl rollout status deployment/contoso-api -n staging --timeout=120s

# Or Docker Compose
docker compose -f docker-compose.staging.yml up -d
```

### 5A. Verify
```bash
# Health check
curl -f https://staging-api.contoso.com/health

# Version check
curl https://staging-api.contoso.com/api/version

# Smoke tests
swift test --filter SmokeTests
```

---

## Path B: iOS TestFlight Staging Deploy

### 2B. Archive
```bash
xcodebuild archive \
  -scheme MyApp \
  -configuration Staging \
  -archivePath build/MyApp.xcarchive
```

### 3B. Export IPA
```bash
xcodebuild -exportArchive \
  -archivePath build/MyApp.xcarchive \
  -exportPath build/ \
  -exportOptionsPlist ExportOptions-AdHoc.plist
```

### 4B. Upload to TestFlight
```bash
# Via fastlane
fastlane beta

# Or via xcrun altool
xcrun altool --upload-app \
  -f build/MyApp.ipa \
  --type ios \
  -u $APPLE_ID \
  -p $APP_SPECIFIC_PASSWORD
```

### 5B. Verify
- Check App Store Connect — build should appear in TestFlight within ~15 minutes
- Send build to internal testers once processing is complete

---

## Safety Rules
- ALWAYS run tests before deploying
- ALWAYS verify Vapor health endpoint after server deploy
- NEVER deploy to production using this skill
- NEVER upload a build without running tests first
- Rollback Vapor: `kubectl rollout undo deployment/contoso-api -n staging`
- Rollback iOS: distribute previous build from TestFlight console


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
- [ ] `swift build -c release && swift test` passes before container build
- [ ] Container builds successfully and pushes to registry
- [ ] Health endpoint returns 200 after deploy (`curl -f https://staging/health`)
- [ ] Smoke tests pass — `swift test --filter SmokeTests`
- [ ] Rollback procedure is documented and tested
## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures and environment-specific gotchas
- **After deploy succeeds/fails**: `capture_thought("Deploy: <outcome — success or failure details>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-staging-deploy")` — persist environment issues and config changes for next deployment
