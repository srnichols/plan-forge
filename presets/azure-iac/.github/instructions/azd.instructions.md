---
description: Azure Developer CLI (azd) patterns — azure.yaml structure, infra folder, tags, hooks, pipelines
applyTo: '**/azure.yaml,**/azure.yml,**/infra/**'
---

# Azure Developer CLI (azd) Best Practices

## Required Structure

Every azd-compatible project requires:

```
project-root/
├── azure.yaml              ← service definition (required)
├── infra/                  ← IaC files (default; change with infra.path)
│   ├── main.bicep          ← or main.tf for Terraform
│   ├── main.parameters.json
│   └── modules/
├── .azure/                 ← azd environment state (git-ignored)
└── src/                    ← application source code (optional for pure infra)
```

## azure.yaml

```yaml
# azure.yaml — maps app services to provisioned Azure resources
name: myapp                       # must match infra resource naming

metadata:
  template: myapp@1.0.0           # optional: template origin tracking

# Infrastructure provider (default: bicep)
infra:
  provider: bicep                 # bicep | terraform
  path: infra                     # relative path to IaC files (default: infra)
  module: main                    # root module filename without extension (default: main)

services:
  api:
    project: ./src/api            # relative path to service source
    language: dotnet              # dotnet | js | ts | python | java
    host: containerapp            # appservice | containerapp | function | staticwebapp | aks
    docker:
      path: ./src/api/Dockerfile
      context: ./src/api

  web:
    project: ./src/web
    language: js
    host: staticwebapp
    dist: build                   # relative path to built artifacts

# Pipeline provider (default: github)
pipeline:
  provider: github                # github | azdo
```

## Terraform Variant

```yaml
name: myapp-terraform
infra:
  provider: terraform
  path: infra
services:
  api:
    project: ./src/api
    language: dotnet
    host: containerapp
```

## Required Resource Tags for azd Auto-Discovery

When `resourceName` is NOT set in `azure.yaml`, azd discovers resources by tags:

```bicep
// In your Bicep module — tag resources so azd can find them
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  tags: union(commonTags, {
    'azd-env-name':     environmentName   // ← required for azd discovery
    'azd-service-name': 'api'             // ← must match service key in azure.yaml
  })
}
```

## Hooks

Hooks run shell scripts at lifecycle events:

```yaml
# azure.yaml — project-level hooks
hooks:
  preprovision:
    shell: pwsh
    run: ./scripts/Validate-Prerequisites.ps1
    interactive: true        # show output in terminal
    continueOnError: false   # fail the command if script fails

  postprovision:
    shell: pwsh
    run: ./scripts/Set-AppSecrets.ps1 -EnvironmentName ${AZURE_ENV_NAME}

  prepackage:
    shell: sh
    run: ./scripts/build.sh

  postdeploy:
    shell: pwsh
    run: ./scripts/Run-SmokeTests.ps1
```

## Environment Variables

azd injects these automatically — use them in hooks and app config:

| Variable | Description |
|----------|-------------|
| `AZURE_ENV_NAME` | Current azd environment name |
| `AZURE_LOCATION` | Azure region |
| `AZURE_SUBSCRIPTION_ID` | Target subscription |
| `AZURE_RESOURCE_GROUP` | Resource group name |
| `SERVICE_{SERVICE_NAME}_ENDPOINT_URL` | URL of deployed service |

Access in Bicep via parameters:

```bicep
param environmentName string = ''  // set by azd
param location string = ''         // set by azd
```

## Commands Reference

```powershell
# First-time setup
azd init                       # initialize from template or existing code

# Full lifecycle
azd up                         # provision + package + deploy (all in one)
azd provision                  # infrastructure only (bicep/terraform apply)
azd deploy                     # app code only (assumes infra exists)
azd package                    # build artifacts only

# Environment management
azd env new staging            # create new environment
azd env select staging         # switch active environment
azd env set KEY value          # set environment variable
azd env get-values             # list all environment variables

# CI/CD pipeline setup
azd pipeline config            # configure GitHub Actions or Azure Pipelines

# Operations
azd down                       # deprovision all resources
azd show                       # list services and their URLs
azd monitor                    # open Application Insights

# Validation
azd build                      # validate azure.yaml and infra config
```

## CI/CD Pipeline Configuration

azd generates the pipeline config automatically:

```powershell
# GitHub Actions (default)
azd pipeline config

# Azure Pipelines
azd pipeline config --provider azdo
```

This configures:
- Workload Identity Federation (OIDC) — no client secrets needed
- Pipeline secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

### GitHub Actions (generated)

```yaml
# .github/workflows/azure-dev.yml (generated by azd)
name: Azure Dev
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/setup-azd@latest
      - run: azd up --no-prompt
        env:
          AZURE_ENV_NAME: ${{ vars.AZURE_ENV_NAME }}
          AZURE_LOCATION: ${{ vars.AZURE_LOCATION }}
```

## Code Review Checklist

- [ ] `azure.yaml` at project root with correct `name`, `services`, and `infra` settings
- [ ] `infra/` folder with `main.bicep` or `main.tf` as entry point
- [ ] Resources tagged with `azd-env-name` and `azd-service-name`
- [ ] `.azure/` folder in `.gitignore`
- [ ] Hooks use `continueOnError: false` for mandatory validation steps
- [ ] Pipeline uses Workload Identity Federation (no stored client secrets)
- [ ] `azd build` runs clean in CI before `azd up`
