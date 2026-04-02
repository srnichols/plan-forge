---
description: "Add azd support to an existing app repo: azure.yaml, infra/ folder, required tags, and pipeline configuration."
agent: "agent"
tools: [read, edit, search]
---
# Add azd Support to App Repo

Add Azure Developer CLI (`azd`) support to an existing application repository.

## Step 1 — Explore the Project

Read the project first:
- What services exist? (API, web, functions, workers)
- What language / runtime? (dotnet, js, python, java)
- What Azure host? (appservice, containerapp, function, staticwebapp)
- Does `infra/` exist? If yes, Bicep or Terraform?

## Step 2 — Create azure.yaml

```yaml
# azure.yaml — at project root
name: {project-name}

infra:
  provider: bicep       # bicep | terraform
  path: infra

services:
  api:                        # key used for azd-service-name tag
    project: ./src/api
    language: dotnet          # dotnet | js | ts | python | java
    host: containerapp        # appservice | containerapp | function | staticwebapp

pipeline:
  provider: github            # github | azdo

hooks:
  postdeploy:
    shell: pwsh
    run: ./scripts/Invoke-SmokeTest.ps1 -EnvironmentName ${AZURE_ENV_NAME}
    continueOnError: false
```

## Step 3 — Tag Azure Resources

In each Bicep module or Terraform resource that maps to a service in `azure.yaml`:

```bicep
// infra/modules/api.bicep
resource app 'Microsoft.Web/sites@2023-01-01' = {
  tags: union(commonTags, {
    'azd-env-name':     environmentName    // AZURE_ENV_NAME at runtime
    'azd-service-name': 'api'              // must match service key in azure.yaml
  })
}
```

```hcl
# infra/main.tf
resource "azurerm_container_app" "api" {
  tags = merge(local.common_tags, {
    "azd-env-name"     = var.environment_name
    "azd-service-name" = "api"
  })
}
```

## Step 4 — Add .azure to .gitignore

```gitignore
# azd environment state
.azure/
```

## Step 5 — Validate and Deploy

```powershell
# Validate azure.yaml + infra
azd build

# First deployment
azd up --environment dev

# Verify services
azd show
```

## Step 6 — Configure CI/CD

```powershell
# GitHub Actions (OIDC)
azd pipeline config

# Azure DevOps
azd pipeline config --provider azdo
```

## Rules

- Service keys in `azure.yaml` MUST match `azd-service-name` tag values
- `infra/main.bicep` or `infra/main.tf` must exist as the IaC entry point
- `.azure/` must be git-ignored
- Hooks must set `continueOnError: false` for mandatory steps
- Run `azd pipeline config` — no manual credential setup

## Reference Files

- [azd instructions](../instructions/azd.instructions.md)
- [Bicep instructions](../instructions/bicep.instructions.md)
