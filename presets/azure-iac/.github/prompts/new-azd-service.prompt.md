---
description: "Add azd support to an existing project: azure.yaml, infra/ folder, required tags, hooks, and pipeline config."
agent: "agent"
tools: [read, edit, search]
---
# Add azd Support to Existing Project

Convert an existing application or infrastructure project to use the Azure Developer CLI (`azd`).

## What azd Needs

Every `azd`-compatible project requires:
1. An `azure.yaml` at the project root
2. An `infra/` folder with a Bicep or Terraform entry point (`main.bicep` or `main.tf`)
3. Resources tagged with `azd-env-name` and `azd-service-name` for auto-discovery

## Step 1 — Explore the Project

Read the project structure first:
- What services are defined? (API, web app, functions, containers)
- What language / runtime?
- What Azure resources already exist or are planned?
- Is IaC already written? If so, Bicep or Terraform?

## Step 2 — Create azure.yaml

```yaml
# azure.yaml
name: {project-name}

metadata:
  template: {project-name}@1.0.0   # optional

infra:
  provider: bicep           # bicep | terraform
  path: infra               # relative path to IaC folder
  module: main              # root module name

services:
  api:
    project: ./src/api      # path to service source
    language: dotnet        # dotnet | js | ts | python | java
    host: containerapp      # appservice | containerapp | function | staticwebapp | aks
    docker:
      path: ./src/api/Dockerfile

  web:                      # remove if no front-end
    project: ./src/web
    language: js
    host: staticwebapp
    dist: build

pipeline:
  provider: github          # github | azdo

hooks:
  preprovision:
    shell: pwsh
    run: ./scripts/Validate-Prerequisites.ps1
    continueOnError: false
  postdeploy:
    shell: pwsh
    run: ./scripts/Invoke-SmokeTest.ps1 -EnvironmentName ${AZURE_ENV_NAME}
```

## Step 3 — Tag Resources for azd Discovery

In `infra/modules/{service}.bicep`, add azd tags alongside common tags:

```bicep
param environmentName string
param serviceName string = 'api'     // must match services key in azure.yaml

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  tags: union(commonTags, {
    'azd-env-name':     environmentName
    'azd-service-name': serviceName
  })
  ...
}
```

## Step 4 — Add .azure to .gitignore

```gitignore
# azd environment state
.azure/
```

## Step 5 — Test the Configuration

```powershell
# Validate azure.yaml and infra config
azd build

# Run end-to-end (provision + deploy)
azd up --environment dev

# Verify services are deployed
azd show
```

## Step 6 — Configure CI/CD Pipeline

```powershell
# GitHub Actions (OIDC — no stored secrets)
azd pipeline config

# Azure DevOps
azd pipeline config --provider azdo
```

## Rules

- `azure.yaml` must use the exact service keys that match Bicep `azd-service-name` tag values
- `infra/` folder must have `main.bicep` or `main.tf` as entry point
- `.azure/` folder must be git-ignored
- All hooks must specify `continueOnError: false` for mandatory validations
- Pipeline config must use OIDC — no long-lived credential secrets

## Reference Files

- [azd instructions](../instructions/azd.instructions.md)
- [Bicep instructions](../instructions/bicep.instructions.md)
- [Deploy instructions](../instructions/deploy.instructions.md)
