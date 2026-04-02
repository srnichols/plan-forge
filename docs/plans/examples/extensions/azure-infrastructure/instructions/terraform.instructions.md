---
description: Terraform Azure patterns for app repos — provider versions, state, naming, security
applyTo: '**/infra/**/*.tf,**/infra/**/*.tfvars'
---

# Terraform Azure Best Practices (App Repo Extension)

Applies to projects that include an `infra/` folder with Terraform alongside application code.

## File Structure

```
infra/
├── main.tf
├── variables.tf
├── outputs.tf
├── providers.tf      ← provider config + OIDC
├── versions.tf       ← version locks
└── locals.tf         ← naming and tags
```

## Provider & Versions

```hcl
# versions.tf — always lock versions
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm"; version = "~> 4.0" }
  }
  backend "azurerm" {
    resource_group_name  = "rg-tfstate"
    storage_account_name = "sttfstate{suffix}"
    container_name       = "tfstate"
    key                  = "{workload}.{env}.tfstate"
  }
}

# providers.tf — OIDC only, no client_secret
provider "azurerm" {
  features {}
  use_oidc = true
}
```

## Variables & Locals

```hcl
# variables.tf
variable "environment_name" {
  description = "Environment (dev, test, staging, prod)."
  type        = string
  validation {
    condition     = contains(["dev", "test", "staging", "prod"], var.environment_name)
    error_message = "Must be dev, test, staging, or prod."
  }
}

# locals.tf
locals {
  suffix = substr(sha256("${var.workload_name}${var.environment_name}"), 0, 8)
  common_tags = {
    Environment = var.environment_name
    Workload    = var.workload_name
    ManagedBy   = "Terraform"
  }
}
```

## Security

```hcl
# ✅ sensitive = true on all secret outputs
output "connection_string" {
  value     = azurerm_storage_account.this.primary_connection_string
  sensitive = true
}

# ✅ Managed identity — no service principal passwords
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.workload_name}-${var.environment_name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  tags                = local.common_tags
}
```

## Checklist

- [ ] `versions.tf` with pinned provider versions
- [ ] Remote backend — no local state
- [ ] `use_oidc = true` — no `client_secret` in provider
- [ ] `sensitive = true` on secret variables and outputs
- [ ] `tags = local.common_tags` on every resource
- [ ] `terraform fmt -check` and `terraform validate` pass
- [ ] No `*.tfstate` in git
