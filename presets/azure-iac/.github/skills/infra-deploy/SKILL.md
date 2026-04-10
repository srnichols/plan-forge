---
name: infra-deploy
description: Validate, what-if/plan, deploy, and verify Azure infrastructure using Bicep, Terraform, or azd. Use when deploying a completed infrastructure phase to an environment.
argument-hint: "[environment: dev|staging|prod] [tool: bicep|terraform|azd]"
---

# Infrastructure Deploy Skill

## Trigger
"Deploy infrastructure" / "Deploy to staging" / "Run azd up" / "Apply Terraform"

## Steps

### 1. Pre-Flight Checks
```powershell
# Verify active subscription and context
az account show --query "{name: name, id: id}"

# Confirm the target environment
Write-Host "Deploying to: $env:AZURE_ENV_NAME"

# For Bicep: lint before anything
az bicep lint --file infra/main.bicep

# For Terraform
terraform init
terraform fmt -check -recursive
terraform validate
```

### 2. What-If / Plan

```powershell
# Bicep — what-if
az deployment group what-if \
  --resource-group $resourceGroup \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json

# Terraform
terraform plan -out=tfplan

# azd
azd provision --preview
```

### 3. Deploy

```powershell
# Bicep
az deployment group create \
  --resource-group $resourceGroup \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --name "deploy-$(Get-Date -Format 'yyyyMMdd-HHmm')"

# Terraform
terraform apply tfplan

# azd (full lifecycle)
azd up --no-prompt
```

### 4. Verify

```powershell
# Check deployment status
az deployment group list \
  --resource-group $resourceGroup \
  --query "[?properties.provisioningState=='Succeeded'] | [-1].name"

# Integration / smoke tests
Invoke-Pester -Path ./tests/integration -Output Detailed

# List any non-succeeded resources
az resource list \
  --resource-group $resourceGroup \
  --query "[?properties.provisioningState!='Succeeded'].{Name:name, Type:type, State:properties.provisioningState}"
```

## Safety Rules
- ALWAYS run what-if / plan before applying
- ALWAYS confirm the subscription before deploying to production
- NEVER apply to production without a preceding staging deployment
- NEVER auto-approve destructive changes (resource replacement or deletion)
- Ask before applying any plan that shows resource deletion

## Rollback

```powershell
# Bicep — list recent deployments, redeploy N-1
az deployment group list \
  --resource-group $resourceGroup \
  --query "sort_by([?properties.provisioningState=='Succeeded'], &properties.timestamp)[-2].name" \
  --output tsv

# Terraform
git revert HEAD
terraform apply

# azd
azd down --force  # deprovision, then re-up from last commit
git revert HEAD && azd up
```


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "What-if is overkill for this change" | What-if catches destructive changes before they execute. Skipping it risks deleting production resources. |
| "Linting is too strict" | Linting rules encode best practices. Overriding them introduces drift from organizational standards. |
| "This policy doesn't apply to our subscription" | Policy exemptions need documentation. Ignoring policies creates compliance gaps that auditors will flag. |
| "I'll fix the warnings after deploy" | Post-deploy warnings become permanent. Fix them before they become the new baseline. |

## Warning Signs

- Deploy without what-if/plan output — changes applied without previewing impact first
- Linting errors dismissed without justification — linter warnings overridden without documenting why
- Policy violations ignored — Azure Policy or OPA violations not addressed before deploy
- No post-deploy verification — resources created but not validated as functional
- Secrets in IaC files — connection strings, keys, or passwords committed to templates

## Exit Proof

After completing this skill, confirm:
- [ ] Lint checks pass (`az bicep lint` / `terraform validate` / `tflint`)
- [ ] What-if/plan output reviewed — no unexpected deletes or replacements
- [ ] Deployment succeeds without errors
- [ ] Post-deploy verification passes (resource exists, responds, correct SKU/config)
- [ ] No secrets committed in IaC files
## Persistent Memory (if OpenBrain is configured)

- **Before deploying**: `search_thoughts("deploy failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior deployment failures, rollback patterns, and environment-specific lessons
- **After deploy succeeds/fails**: `capture_thought("Infra deploy: <outcome — environment, tool, success/failure details>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-infra-deploy")` — persist deployment outcome for future reference
