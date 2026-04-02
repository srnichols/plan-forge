---
description: Azure IaC pipeline patterns — GitHub Actions, Azure DevOps, OIDC auth, deployment stages, rollback
applyTo: '**/.github/workflows/**,**/azure-pipelines.yml,**/pipelines/**'
---

# Azure IaC Pipeline Patterns

## Authentication — Workload Identity Federation (OIDC)

Use OIDC/Workload Identity Federation everywhere — no stored client secrets.

### GitHub Actions Setup

```powershell
# One-time setup: configure the federated credential
azd pipeline config   # automatically configures OIDC for GitHub Actions
```

Required secrets in GitHub:
- `AZURE_CLIENT_ID` — App Registration client ID
- `AZURE_TENANT_ID` — Azure AD tenant ID
- `AZURE_SUBSCRIPTION_ID` — target subscription

### Azure DevOps Setup

Use a service connection with **Workload Identity Federation**:
```
Project Settings → Service connections → New → Azure Resource Manager → Workload Identity Federation
```

## GitHub Actions — Bicep Deployment Pipeline

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

permissions:
  id-token: write      # required for OIDC
  contents: read

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Install Bicep CLI
        run: az bicep install

      - name: Lint Bicep
        run: az bicep lint --file infra/main.bicep

      - name: Bicep Build (validate ARM output)
        run: az bicep build --file infra/main.bicep

      - name: What-If Analysis
        run: |
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
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Bicep
        uses: azure/arm-deploy@v2
        with:
          resourceGroupName: ${{ vars.DEV_RESOURCE_GROUP }}
          template: infra/main.bicep
          parameters: infra/main.parameters.json environmentName=dev
          failOnStdErr: true

      - name: Smoke Test
        shell: pwsh
        run: ./scripts/Invoke-SmokeTest.ps1 -EnvironmentName dev

  deploy-prod:
    name: Deploy Production
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: prod           # requires manual approval gate in GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Bicep
        uses: azure/arm-deploy@v2
        with:
          resourceGroupName: ${{ vars.PROD_RESOURCE_GROUP }}
          template: infra/main.bicep
          parameters: infra/main.parameters.json environmentName=prod
          failOnStdErr: true
```

## Azure DevOps YAML Pipeline — Terraform

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include: [main]
  paths:
    include: [infra/**]

variables:
  - group: infra-prod-vars   # variable group linked to Key Vault

stages:
  - stage: Validate
    displayName: Validate
    jobs:
      - job: TerraformValidate
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: TerraformInstaller@1
            inputs:
              terraformVersion: 'latest'

          - task: TerraformTaskV4@4
            displayName: Terraform Init
            inputs:
              provider: azurerm
              command: init
              backendServiceArm: MyAzureServiceConnection   # workload identity federation
              backendAzureRmResourceGroupName: rg-tfstate-prod
              backendAzureRmStorageAccountName: sttfstateprod
              backendAzureRmContainerName: tfstate
              backendAzureRmKey: myapp.prod.tfstate

          - task: TerraformTaskV4@4
            displayName: Terraform Format Check
            inputs:
              provider: azurerm
              command: custom
              customCommand: fmt
              commandOptions: -check -recursive

          - task: TerraformTaskV4@4
            displayName: Terraform Validate
            inputs:
              provider: azurerm
              command: validate

          - task: TerraformTaskV4@4
            displayName: Terraform Plan
            inputs:
              provider: azurerm
              command: plan
              environmentServiceNameAzureRM: MyAzureServiceConnection
              commandOptions: -out=tfplan

  - stage: DeployProd
    displayName: Deploy Production
    dependsOn: Validate
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: TerraformApply
        environment: production     # Azure DevOps environment with approval gate
        pool:
          vmImage: ubuntu-latest
        strategy:
          runOnce:
            deploy:
              steps:
                - task: TerraformTaskV4@4
                  displayName: Terraform Apply
                  inputs:
                    provider: azurerm
                    command: apply
                    environmentServiceNameAzureRM: MyAzureServiceConnection
                    commandOptions: tfplan
```

## Rollback Strategy

```powershell
# Bicep — rollback to previous deployment
az deployment group list \
  --resource-group rg-myapp-prod \
  --query "[?properties.provisioningState=='Succeeded'] | sort_by(@, &properties.timestamp) | [-2].name" \
  --output tsv | xargs -I {} az deployment group show \
  --resource-group rg-myapp-prod \
  --name {} \
  --query "properties.parameters" > previous-params.json

# Terraform — rollback via state
terraform state list        # inspect current state
terraform plan              # see what would change after code revert
git revert HEAD             # revert code change
terraform apply             # re-apply previous known-good state
```

## Pipeline Checklist

- [ ] OIDC / Workload Identity Federation — no stored client secrets
- [ ] Validation stage runs before any deployment: lint, build, what-if/plan
- [ ] Production deployment requires passing dev deployment first
- [ ] Production environment has a manual approval gate configured
- [ ] Pipeline fails fast on any validation error (`failOnStdErr: true`)
- [ ] Smoke tests run after each environment deployment
- [ ] Deployment history preserved (do not auto-delete deployments)
- [ ] Rollback procedure documented and tested
