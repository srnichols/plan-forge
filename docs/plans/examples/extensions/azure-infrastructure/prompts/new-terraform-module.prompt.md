---
description: "Scaffold a Terraform module in the infra/ folder of an app repo with variables, locals, outputs, and security defaults."
agent: "agent"
tools: [read, edit, search]
---
# Create New Terraform Module (App Repo)

Scaffold a Terraform module in `infra/` for an application repository.

## Required Information

Ask for:
1. **What resources does this module manage?**
2. **Root module or child module?** (root gets `versions.tf` and `providers.tf`)
3. **Is this production-bound?** (enables lifecycle protection)

## Root Module Template

```hcl
# versions.tf
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

# providers.tf
provider "azurerm" {
  features {}
  use_oidc = true   # Workload Identity Federation — no client_secret
}

# variables.tf
variable "environment_name" {
  description = "The environment name."
  type        = string
  validation {
    condition     = contains(["dev", "test", "staging", "prod"], var.environment_name)
    error_message = "Must be dev, test, staging, or prod."
  }
}

variable "workload_name" {
  description = "Short workload name for naming (2–8 chars)."
  type        = string
  validation {
    condition     = length(var.workload_name) >= 2 && length(var.workload_name) <= 8
    error_message = "workload_name must be 2–8 characters."
  }
}

# locals.tf
locals {
  suffix       = substr(sha256("${var.workload_name}${var.environment_name}"), 0, 8)
  common_tags  = {
    Environment = var.environment_name
    Workload    = var.workload_name
    ManagedBy   = "Terraform"
  }
}

# main.tf
data "azurerm_subscription" "current" {}

resource "azurerm_resource_group" "this" {
  name     = "rg-${var.workload_name}-${var.environment_name}"
  location = var.location
  tags     = local.common_tags
}

# outputs.tf
output "resource_group_name" {
  description = "Resource group name."
  value       = azurerm_resource_group.this.name
}
```

## Rules

- All variables have `description`
- `sensitive = true` on secret variables and outputs
- `tags = local.common_tags` (or `merge()`) on every resource
- `for_each` not `count`
- No `client_secret` in provider — `use_oidc = true`
- No `*.tfvars` with secrets committed to git

## Reference Files

- [Terraform instructions](../instructions/terraform.instructions.md)
- [Naming instructions](../instructions/naming.instructions.md)
- [Security instructions](../instructions/security.instructions.md)
