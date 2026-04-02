---
description: Azure naming conventions — Microsoft CAF abbreviations, constraints, uniqueness, tagging
applyTo: '**/*.bicep,**/*.tf,**/*.bicepparam,**/*.tfvars'
---

# Azure Naming Conventions

> Based on the [Microsoft Cloud Adoption Framework (CAF) naming convention](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming).

## Pattern

```
{type}-{workload}-{environment}-{region}-{instance}
```

| Segment | Example | Notes |
|---------|---------|-------|
| `type` | `rg`, `vnet`, `app` | See abbreviation table below |
| `workload` | `payments`, `auth` | Short, meaningful, no spaces |
| `environment` | `dev`, `test`, `staging`, `prod` | Abbreviated if character-limited |
| `region` | `eastus`, `eus`, `we` | Use short form when constrained |
| `instance` | `001`, `002` | Zero-padded; use only when multiple instances exist |

## Resource Abbreviations (CAF)

| Resource Type | Abbreviation | Example |
|---------------|-------------|---------|
| Resource group | `rg` | `rg-payments-prod-eastus` |
| Virtual network | `vnet` | `vnet-payments-prod-eastus` |
| Subnet | `snet` | `snet-app-prod-eastus` |
| Network security group | `nsg` | `nsg-app-prod-eastus` |
| App Service plan | `asp` | `asp-payments-prod-eastus` |
| App Service / Web app | `app` | `app-payments-prod-eastus` |
| Function app | `func` | `func-payments-prod-eastus` |
| Container app | `ca` | `ca-payments-prod-eastus` |
| Container App Environment | `cae` | `cae-payments-prod-eastus` |
| SQL server | `sql` | `sql-payments-prod-eastus` |
| SQL database | `sqldb` | `sqldb-payments-prod-eastus` |
| Cosmos DB account | `cosmos` | `cosmos-payments-prod-eastus` |
| Storage account | `st` | `stpaymentsprod001` ← *no dashes, max 24 chars* |
| Key vault | `kv` | `kv-payments-prod-eus-001` ← *max 24 chars* |
| Log Analytics workspace | `log` | `log-payments-prod-eastus` |
| Application Insights | `appi` | `appi-payments-prod-eastus` |
| User-assigned managed identity | `id` | `id-payments-prod-eastus` |
| Service Bus namespace | `sb` | `sb-payments-prod-eastus` |
| Event Hub namespace | `evhns` | `evhns-payments-prod-eastus` |
| Container registry | `cr` | `crpaymentsprod001` ← *no dashes, alphanumeric only* |
| AKS cluster | `aks` | `aks-payments-prod-eastus` |
| API Management | `apim` | `apim-payments-prod-eastus` |
| Front Door | `afd` | `afd-payments-prod-eastus` |
| Virtual machine | `vm` | `vmpaymentspd001` ← *max 15 chars Windows / 64 Linux* |

## Resource-Specific Constraints

| Resource | Max Length | Allowed Chars | Notes |
|----------|-----------|---------------|-------|
| Storage account | 3–24 | lowercase alphanumeric | Globally unique; no dashes |
| Key vault | 3–24 | alphanumeric + hyphens | Globally unique; must start with letter |
| Container registry | 5–50 | alphanumeric | Globally unique; no dashes |
| VM (Windows) | 15 | alphanumeric + hyphens | Must start with letter |
| SQL server | 1–63 | lowercase alphanumeric + hyphens | Globally unique |
| Resource group | 1–90 | alphanumeric, hyphens, underscores, dots | Subscription-scoped |

## Bicep Implementation Example

```bicep
@minLength(2)
@maxLength(8)
param workloadName string

@allowed(['dev', 'test', 'staging', 'prod'])
param environmentName string

param location string = resourceGroup().location

var uniqueSuffix = uniqueString(resourceGroup().id)

// ✅ Storage account — no dashes, max 24 chars
var storageAccountName = take('st${workloadName}${environmentName}${uniqueSuffix}', 24)

// ✅ Key Vault — max 24 chars with hyphen separator
var keyVaultName = take('kv-${workloadName}-${environmentName}-${uniqueSuffix}', 24)

// ✅ Standard named resources
var resourceGroupName = 'rg-${workloadName}-${environmentName}'
var appServiceName    = 'app-${workloadName}-${environmentName}'
```

## Terraform Implementation Example

```hcl
locals {
  suffix = substr(sha256("${var.workload_name}${var.environment_name}${data.azurerm_subscription.current.id}"), 0, 8)

  # ✅ CAF-conformant names
  resource_group_name  = "rg-${var.workload_name}-${var.environment_name}"
  storage_account_name = substr("st${var.workload_name}${var.environment_name}${local.suffix}", 0, 24)
  key_vault_name       = substr("kv-${var.workload_name}-${var.environment_name}-${local.suffix}", 0, 24)
  app_service_name     = "app-${var.workload_name}-${var.environment_name}"
  log_analytics_name   = "log-${var.workload_name}-${var.environment_name}"
}
```

## Required Tags

Mandatory on every resource and resource group:

| Tag | Value | Notes |
|-----|-------|-------|
| `Environment` | `dev` / `test` / `staging` / `prod` | |
| `Workload` | short workload name | matches the naming prefix |
| `ManagedBy` | `Bicep` / `Terraform` | IaC tool |
| `Repository` | repo URL | for drift detection |
| `Owner` | team or contact | for cost allocation |
| `CostCenter` | billing code | for FinOps |

## Checklist

- [ ] All resource names use the CAF abbreviation prefix
- [ ] Storage accounts and container registries have no dashes
- [ ] Key vaults, storage accounts with global uniqueness use `uniqueString()` / hash suffix
- [ ] Resource names are within character limits
- [ ] All resources tagged with mandatory tag set
- [ ] Environment segment is lowercase: `dev`, `test`, `staging`, `prod`
