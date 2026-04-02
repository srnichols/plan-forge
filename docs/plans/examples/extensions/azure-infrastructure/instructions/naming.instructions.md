---
description: Azure CAF naming conventions for app repos — abbreviations, constraints, uniqueString
applyTo: '**/infra/**/*.bicep,**/infra/**/*.tf'
---

# Azure Naming Conventions (App Repo Extension)

## Pattern

```
{type}-{workload}-{environment}[-{instance}]
```

## Key Abbreviations

| Resource | Prefix | Notes |
|----------|--------|-------|
| Resource group | `rg-` | |
| App Service | `app-` | |
| Function app | `func-` | |
| Container app | `ca-` | |
| SQL server | `sql-` | globally unique |
| Storage account | `st` | **no dashes**, max 24 chars, globally unique |
| Key vault | `kv-` | max 24 chars, globally unique |
| Container registry | `cr` | **no dashes**, alphanumeric only, globally unique |
| Managed identity | `id-` | |
| Log Analytics | `log-` | |
| App Insights | `appi-` | |

## Bicep Example

```bicep
var uniqueSuffix        = uniqueString(resourceGroup().id)
var storageAccountName  = take('st${workloadName}${environmentName}${uniqueSuffix}', 24)
var keyVaultName        = take('kv-${workloadName}-${environmentName}-${uniqueSuffix}', 24)
var appServiceName      = 'app-${workloadName}-${environmentName}'
```

## Terraform Example

```hcl
locals {
  suffix               = substr(sha256("${var.workload_name}${var.environment_name}"), 0, 8)
  storage_account_name = substr("st${var.workload_name}${var.environment_name}${local.suffix}", 0, 24)
  key_vault_name       = substr("kv-${var.workload_name}-${var.environment_name}-${local.suffix}", 0, 24)
  app_service_name     = "app-${var.workload_name}-${var.environment_name}"
}
```

## Required Tags

```
Environment  = dev | test | staging | prod
Workload     = short workload name
ManagedBy    = Bicep | Terraform
```
