---
description: Terraform Azure patterns — file structure, providers, state, naming, security, testing
applyTo: '**/*.tf,**/*.tfvars,**/.terraform.lock.hcl'
---

# Terraform on Azure Best Practices

## File Structure

```
infra/
├── main.tf               ← resource definitions
├── variables.tf          ← input variable declarations
├── outputs.tf            ← output value declarations
├── providers.tf          ← provider configuration
├── versions.tf           ← required_providers with version locks
├── locals.tf             ← computed/derived values
├── terraform.tfvars      ← variable values (dev — never commit prod secrets)
└── modules/
    ├── networking/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── compute/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

## Provider Configuration

```hcl
# versions.tf — always lock provider versions
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"   # pin to minor; review major bumps
    }
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.0"   # for preview/new resources not in azurerm
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ✅ Remote state in Azure Blob Storage — never local state in CI
  backend "azurerm" {
    resource_group_name  = "rg-tfstate-prod"
    storage_account_name = "sttfstateprod"
    container_name       = "tfstate"
    key                  = "myapp.prod.tfstate"
  }
}

# providers.tf — use Managed Identity (no client_secret in code)
provider "azurerm" {
  features {}
  use_oidc = true   # workload identity federation in CI
}
```

## Variable Declarations

```hcl
# variables.tf
variable "environment_name" {
  description = "The environment name (dev, test, staging, prod)."
  type        = string
  validation {
    condition     = contains(["dev", "test", "staging", "prod"], var.environment_name)
    error_message = "environment_name must be one of: dev, test, staging, prod."
  }
}

variable "workload_name" {
  description = "Short workload name used in resource naming (2-8 chars)."
  type        = string
  validation {
    condition     = length(var.workload_name) >= 2 && length(var.workload_name) <= 8
    error_message = "workload_name must be between 2 and 8 characters."
  }
}

# ✅ sensitive = true on all secret variables
variable "db_admin_password" {
  description = "Admin password for the database."
  type        = string
  sensitive   = true
}
```

## Locals for Naming

```hcl
# locals.tf — consistent naming, computed once
locals {
  # Unique suffix for globally unique resource names
  suffix = substr(sha256("${var.workload_name}${var.environment_name}${data.azurerm_subscription.current.id}"), 0, 8)

  resource_group_name  = "rg-${var.workload_name}-${var.environment_name}"
  storage_account_name = "st${var.workload_name}${var.environment_name}${local.suffix}"
  key_vault_name       = "kv-${var.workload_name}-${var.environment_name}-${local.suffix}"

  common_tags = {
    Environment = var.environment_name
    Workload    = var.workload_name
    ManagedBy   = "Terraform"
    Repository  = var.repository_url
  }
}
```

## Resource Patterns

```hcl
# ✅ for_each over count — gives stable resource addresses
resource "azurerm_subnet" "this" {
  for_each = var.subnets

  name                 = each.value.name
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [each.value.cidr]
}

# ✅ Tags on every resource
resource "azurerm_resource_group" "this" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.common_tags
}

# ✅ Use data sources to reference existing resources
data "azurerm_key_vault" "shared" {
  name                = "kv-shared-prod"
  resource_group_name = "rg-shared-prod"
}
```

## Outputs

```hcl
# outputs.tf
# ✅ sensitive = true on secret outputs
output "storage_connection_string" {
  description = "Primary connection string for the storage account."
  value       = azurerm_storage_account.this.primary_connection_string
  sensitive   = true
}

output "resource_group_name" {
  description = "Name of the deployed resource group."
  value       = azurerm_resource_group.this.name
}
```

## Security

```hcl
# ✅ Managed Identity — never service principals with client_secret in code
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.workload_name}-${var.environment_name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  tags                = local.common_tags
}

# ✅ Role assignment using built-in role IDs
resource "azurerm_role_assignment" "storage_blob_reader" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# ✅ Disable public access on storage accounts
resource "azurerm_storage_account" "this" {
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }
}

# ✅ Secrets in Key Vault — reference from app config, not Terraform outputs
resource "azurerm_key_vault_secret" "db_password" {
  name         = "db-admin-password"
  value        = var.db_admin_password
  key_vault_id = azurerm_key_vault.this.id
}
```

## State Management

```hcl
# ✅ Separate state per environment
# prod:    infra/prod.tfstate
# staging: infra/staging.tfstate
# Never share state between environments

# ✅ State locking via azurerm backend (automatic with blob storage)
# ✅ State encryption via Azure Storage encryption at rest
# ❌ NEVER commit .tfstate files to git — add to .gitignore
```

## Lifecycle Rules

```hcl
# ✅ Prevent destruction of critical resources in production
resource "azurerm_postgresql_flexible_server" "this" {
  lifecycle {
    prevent_destroy = true   # applies to prod; remove for dev/test environments
  }
}
```

## Code Review Checklist

- [ ] `versions.tf` with all provider versions pinned
- [ ] Remote backend configured — no local state in CI
- [ ] Managed Identity auth — no `client_secret` in provider config
- [ ] `sensitive = true` on all secret variables and outputs
- [ ] `for_each` used instead of `count` for resource sets
- [ ] `local.common_tags` applied to every resource
- [ ] `length()` / `contains()` validations on critical variables
- [ ] No `terraform.tfvars` with secrets committed to git
- [ ] `terraform fmt` passes with no diffs
- [ ] `terraform validate` passes
- [ ] `tflint` passes
