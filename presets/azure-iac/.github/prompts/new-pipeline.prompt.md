---
description: "Scaffold a CI/CD pipeline for Azure infrastructure deployment — GitHub Actions or Azure DevOps."
agent: "agent"
tools: [read, edit, search]
---
# Create New Infrastructure Pipeline

Scaffold a CI/CD pipeline for Azure IaC deployments with validate → what-if → deploy → verify stages.

## Required Information

Before generating, ask for:
1. **Pipeline provider** — GitHub Actions or Azure DevOps?
2. **IaC tool** — Bicep, Terraform, or azd?
3. **Environments** — which environments exist? (dev, staging, prod)
4. **Trigger** — push to main? PR? Manual dispatch?

## GitHub Actions — Bicep

```yaml
# .github/workflows/infra-deploy.yml
name: Infrastructure Deploy
on:
  push:
    branches: [main]
    paths: ['infra/**']
  pull_request:
    branches: [main]
    paths: ['infra/**']
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'dev'
        type: choice
        options: [dev, staging, prod]

permissions:
  id-token: write
  contents: read

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - run: az bicep install
      - run: az bicep lint --file infra/main.bicep
      - run: |
          az deployment group what-if \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --template-file infra/main.bicep \
            --parameters infra/main.parameters.json \
            --no-pretty-print

  deploy-dev:
    name: Deploy Dev
    needs: validate
    runs-on: ubuntu-latest
    environment: dev
    if: github.event_name != 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/arm-deploy@v2
        with:
          resourceGroupName: ${{ vars.DEV_RESOURCE_GROUP }}
          template: infra/main.bicep
          parameters: infra/main.parameters.json environmentName=dev
          failOnStdErr: true
      - name: Smoke Test
        shell: pwsh
        run: Invoke-Pester -Path ./tests/integration -Output Detailed

  deploy-prod:
    name: Deploy Production
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: prod  # requires manual approval gate in GitHub environments
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/arm-deploy@v2
        with:
          resourceGroupName: ${{ vars.PROD_RESOURCE_GROUP }}
          template: infra/main.bicep
          parameters: infra/main.parameters.json environmentName=prod
          failOnStdErr: true
      - name: Smoke Test
        shell: pwsh
        run: Invoke-Pester -Path ./tests/integration -Output Detailed
```

## GitHub Actions — Terraform

```yaml
# .github/workflows/infra-terraform.yml
name: Terraform Deploy
on:
  push:
    branches: [main]
    paths: ['infra/**']
  pull_request:
    branches: [main]
    paths: ['infra/**']

permissions:
  id-token: write
  contents: read

env:
  TF_VERSION: '1.7.0'

jobs:
  validate:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}
      - run: terraform init
      - run: terraform fmt -check -recursive
      - run: terraform validate
      - run: terraform plan -out=tfplan
        env:
          ARM_USE_OIDC: true
          ARM_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          ARM_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          ARM_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

  deploy-prod:
    needs: validate
    runs-on: ubuntu-latest
    environment: prod
    if: github.ref == 'refs/heads/main'
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}
      - run: terraform init
      - run: terraform apply -auto-approve tfplan
        env:
          ARM_USE_OIDC: true
          ARM_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          ARM_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          ARM_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

## GitHub Actions — azd

```yaml
# .github/workflows/azure-dev.yml (generated by azd pipeline config)
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

## Rules

- OIDC / Workload Identity Federation — no `client_secret` in pipeline secrets
- Validate stage MUST pass before any deployment job runs
- Production job requires manual approval gate (`environment: prod`)
- `failOnStdErr: true` on all deployment steps
- Smoke tests run after each environment deployment
- PR pipelines run validate + what-if/plan only — no deployment

## Reference Files

- [Deploy instructions](../instructions/deploy.instructions.md)
- [azd instructions](../instructions/azd.instructions.md)
