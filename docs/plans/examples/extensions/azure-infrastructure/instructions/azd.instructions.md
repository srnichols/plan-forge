---
description: Azure Developer CLI (azd) patterns for app repos — azure.yaml, infra/ folder, tags, hooks, pipeline setup
applyTo: '**/azure.yaml,**/azure.yml,**/infra/**'
---

# Azure Developer CLI (azd) — App Repo Extension

## Minimum Required Structure

```
project-root/
├── azure.yaml     ← service definition
├── infra/         ← Bicep or Terraform
│   ├── main.bicep
│   └── modules/
└── .azure/        ← git-ignored environment state
```

## azure.yaml

```yaml
name: {your-app}

infra:
  provider: bicep   # bicep | terraform
  path: infra

services:
  api:
    project: ./src/api
    language: dotnet   # dotnet | js | ts | python | java
    host: containerapp  # appservice | containerapp | function | staticwebapp

pipeline:
  provider: github   # github | azdo

hooks:
  postdeploy:
    shell: pwsh
    run: ./scripts/Invoke-SmokeTest.ps1 -EnvironmentName ${AZURE_ENV_NAME}
    continueOnError: false
```

## Required Resource Tags for azd Discovery

```bicep
// Tag resources so azd can find them without specifying resourceName
resource appService 'Microsoft.Web/sites@2023-01-01' = {
  tags: union(commonTags, {
    'azd-env-name':     environmentName   // matches AZURE_ENV_NAME
    'azd-service-name': 'api'             // matches services key in azure.yaml
  })
}
```

## Add .azure to .gitignore

```gitignore
.azure/
```

## Key Commands

```powershell
azd init        # initialize (reads existing code)
azd up          # provision + deploy
azd provision   # infra only
azd deploy      # app code only
azd pipeline config   # configure GitHub Actions or Azure Pipelines (OIDC)
```

## Checklist

- [ ] `azure.yaml` at project root
- [ ] `infra/main.bicep` or `infra/main.tf` exists
- [ ] Resources tagged with `azd-env-name` and `azd-service-name`
- [ ] `.azure/` in `.gitignore`
- [ ] Pipeline uses OIDC — run `azd pipeline config`
